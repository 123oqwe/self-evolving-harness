import { describe, test, expect, afterEach } from "vitest";
import { canHostLoopback } from "./t04a-env";
import { readFileSync } from "node:fs";
import { SocatProxy } from "@harness/l0-sandbox";

/**
 * L0S-T04a · 正常路径（egress log）
 *
 * Spec G/W/T:
 *   Given allowedDomains `['api.github.com']`；
 *   When  sandbox 内 `curl https://api.github.com`（经 proxy）；
 *   Then  请求经 proxy 放行，egress log 记一条命中。
 *
 * eggress log 是 append-only 的出站审计日志（SocatProxy.start 返回 egressLogPath）。
 */
describe("L0S-T04a", () => {
  let proxy: SocatProxy | undefined;
  let stopAll: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (stopAll) {
      await stopAll().catch(() => undefined);
      stopAll = undefined;
    }
    proxy = undefined;
  });

  test.skipIf(!canHostLoopback)("
    // loopback socket 内核级被拒时跳过(嵌套沙箱环境); CI 干净环境覆盖
    "egress log records allowlist hit", async () => {
    proxy = new SocatProxy({
      allowedDomains: ["api.github.com"],
      denyOutCidr: [],
      listenPort: 0,
    });
    const { proxyPort, egressLogPath } = await proxy.start();
    stopAll = () => proxy!.stop();

    expect(typeof egressLogPath).toBe("string");
    expect(egressLogPath.length).toBeGreaterThan(0);

    // 触发一次到 allowlist host 的 CONNECT，使 proxy 记录一条 egress 命中。
    const { createConnection } = await import("node:net");
    await new Promise<void>((resolve) => {
      const sock = createConnection({ port: proxyPort, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.write(
          "CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n",
        );
      });
      // 不等握手完成（真实 api.github.com 不可控），只要 proxy 记录即足够。
      sock.on("data", () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => resolve());
      sock.on("close", () => resolve());
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 2_000);
    });

    // 给 proxy 一点时间落盘 egress log。
    await new Promise((r) => setTimeout(r, 200));

    let log = "";
    try {
      log = readFileSync(egressLogPath, "utf8");
    } catch {
      log = "";
    }

    // egress log 必须记录了这次 allowlist 命中（含 host）。
    expect(log).toContain("api.github.com");
  });
});
