/**
 * L0S-T04a — socat 风格 egress proxy（Node net 实现）
 *
 * 作 sandbox 唯一网络出口（brain 域运行）。实现 HTTP CONNECT 方法 + 域名/CIDR
 * 双层 gate（门逻辑集中在 dns-trap.ts 的 `resolveAndCheck` 纯函数中）：
 *   1. host ∈ allowlist（后缀点号 / 精确匹配，见 allowlist.ts）
 *   2. 若 denyOutCidr 非空：dns.lookup(host) → IP 再过 CIDR（见 dns-trap.ts）
 *   通过双层 gate 后放行到上游，egress log（append-only JSONL）记一条命中。
 *   任一 gate 失败 → 返回 HTTP 403 并关断连接（fail-closed）。
 *
 * ERRATA-w2plus L0S-T04a：
 *   - CONNECT 门逻辑委托 `resolveAndCheck`（默认 resolver），移除内联
 *     `await import("node:dns")`，使门逻辑可经 resolveAndCheck 的注入 resolver 直测。
 *   - egress log 改为 append-only JSONL（`{ts,host,verdict,reason?}`），供 T05 grep 消费。
 *   - `stop()` 不再删除 egressLogPath 所在目录（仅关闭 fd + server），把日志
 *     清理职责交给调用方/T06 lifecycle，保证 T05 verifyAfterRun 时日志仍存在。
 *
 * Spec 裁决：socat 作 fallback，Node net 更可控；本实现用 Node net。
 */

import { createServer, type Server, type Socket } from "node:net";
import {
  mkdtempSync,
  openSync,
  writeFileSync,
  appendFileSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAndCheck } from "./dns-trap.js";
import { createConnection } from "node:net";
import type { NetRules } from "../os-sandbox/types.js";

export interface SocatProxyOpts {
  allowedDomains: string[];
  denyOutCidr: string[];
  listenPort: number;
}

export interface SocatProxyHandle {
  proxyPort: number;
  egressLogPath: string;
}

interface ConnectTarget {
  host: string;
  port: number;
}

function parseConnect(line: string): ConnectTarget | null {
  // 形如 `CONNECT api.github.com:443 HTTP/1.1`
  const m = line.match(/^CONNECT\s+(\S+):(\d+)\s+HTTP\/1\.[01]\r?$/i);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { host: m[1], port: Number.parseInt(m[2], 10) };
}

export class SocatProxy {
  private readonly opts: SocatProxyOpts;
  private server: Server | undefined;
  private egressLogPath = "";
  private egressLogFd = 0;

  constructor(opts: SocatProxyOpts) {
    this.opts = opts;
  }

  async start(): Promise<SocatProxyHandle> {
    const logDir = mkdtempSync(join(tmpdir(), "l0s-egress-"));
    this.egressLogPath = join(logDir, "egress.log");
    // 创建空文件以便测试 readFileSync 不抛。
    writeFileSync(this.egressLogPath, "", { flag: "w" });
    this.egressLogFd = openSync(this.egressLogPath, "a");

    return new Promise<SocatProxyHandle>((resolve, reject) => {
      const server = createServer((sock: Socket) => this.handleConnection(sock));
      server.on("error", reject);
      server.listen(this.opts.listenPort, "127.0.0.1", () => {
        const addr = server.address();
        const port =
          addr && typeof addr === "object"
            ? (addr as { port: number }).port
            : this.opts.listenPort;
        this.server = server;
        resolve({ proxyPort: port, egressLogPath: this.egressLogPath });
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // 强制关闭所有现存连接。
        (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
    }
    if (this.egressLogFd) {
      try {
        closeSync(this.egressLogFd);
      } catch {
        // ignore
      }
      this.egressLogFd = 0;
    }
    // ERRATA：不再 rmSync egressLogPath 所在目录。日志（append-only JSONL）
    // 须保留供 T05 grep 消费；清理职责交给调用方/T06 lifecycle。
  }

  private appendEgressLog(host: string, verdict: string, reason?: string): void {
    const base = { ts: new Date().toISOString(), host, verdict };
    const line =
      reason === undefined
        ? JSON.stringify(base)
        : JSON.stringify({ ...base, reason });
    try {
      appendFileSync(this.egressLogPath, line + "\n", { encoding: "utf8" });
    } catch {
      // 落盘失败不阻断 proxy 主流程。
    }
  }

  private refuse(sock: Socket): void {
    try {
      sock.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    } catch {
      // ignore
    }
    sock.destroy();
  }

  private async handleConnection(sock: Socket): Promise<void> {
    let connectLine: string | null = null;
    let buffered = "";

    const onHeaderData = (data: Buffer): void => {
      buffered += data.toString("latin1");
      if (connectLine === null) {
        const nl = buffered.indexOf("\r\n");
        if (nl < 0) return;
        connectLine = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 2);
      }
      // 等到 CONNECT 行 + 空行（headers 结束）。
      if (buffered.indexOf("\r\n\r\n") < 0 && buffered.length < 8192) return;

      sock.removeListener("data", onHeaderData);
      void this.handleConnect(sock, connectLine);
    };

    sock.on("data", onHeaderData);
    sock.on("error", () => sock.destroy());
  }

  private async handleConnect(sock: Socket, connectLine: string | null): Promise<void> {
    if (!connectLine) {
      this.refuse(sock);
      return;
    }
    const target = parseConnect(connectLine);
    if (!target) {
      this.refuse(sock);
      return;
    }

    // 双层门（allowlist + DNS rebinding CIDR）集中在 resolveAndCheck。
    const rules: NetRules = {
      allowedDomains: this.opts.allowedDomains,
      denyOutCidr: this.opts.denyOutCidr,
    };
    const result = await resolveAndCheck(target.host, rules);
    if (!result.allowed) {
      this.appendEgressLog(target.host, "denied", result.reason);
      this.refuse(sock);
      return;
    }

    // allowlist + CIDR 双门通过：记一条 egress 命中（append-only JSONL）。
    this.appendEgressLog(target.host, "allowed");

    // 连接到上游。失败则关断（fail-closed）。
    let upstream: Socket;
    try {
      upstream = createConnection({ host: target.host, port: target.port });
    } catch {
      this.refuse(sock);
      return;
    }

    upstream.on("connect", () => {
      try {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      } catch {
        // ignore
      }
      sock.pipe(upstream);
      upstream.pipe(sock);
    });
    upstream.on("error", () => {
      sock.destroy();
    });
    sock.on("error", () => upstream.destroy());
    sock.on("close", () => upstream.destroy());
    upstream.on("close", () => sock.destroy());
  }
}
