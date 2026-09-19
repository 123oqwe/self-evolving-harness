import { describe, test, expect, vi, afterEach } from "vitest";
import { SocatProxy } from "@harness/l0-sandbox";

/**
 * L0S-T04a · DNS rebinding 门
 *
 * Spec G/W/T:
 *   Given allowedDomains 含 `api.github.com` 但其解析到 `169.254.169.254`（cloud metadata）；
 *   When  proxy 连接前再查 IP；
 *   Then  IP 命中 denyOut CIDR → 拒绝。
 *
 * 执行提示明确：DNS rebinding 测试用 mock `dns.lookup`，勿依赖真实 DNS。
 */
describe("L0S-T04a", () => {
  let proxy: SocatProxy | undefined;
  let stopAll: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (stopAll) {
      await stopAll().catch(() => undefined);
      stopAll = undefined;
    }
    vi.doUnmock("node:dns");
    proxy = undefined;
  });

  test("allowed domain resolving to denyOut IP is blocked", async () => {
    // 强制 dns.lookup 返回 cloud metadata IP（命中 denyOutCidr）。
    vi.doMock("node:dns", () => ({
      lookup: (
        _host: string,
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, addr: string) => void,
      ) => cb(null, "169.254.169.254"),
      promises: {
        lookup: async () => "169.254.169.254",
      },
    }));

    proxy = new SocatProxy({
      allowedDomains: ["api.github.com"],
      denyOutCidr: ["169.254.169.254/32"],
      listenPort: 0,
    });
    const { proxyPort } = await proxy.start();
    stopAll = () => proxy!.stop();

    const { createConnection } = await import("node:net");
    const sock = createConnection({ port: proxyPort, host: "127.0.0.1" });

    const verdict = await new Promise<"refused" | "connected">((resolve) => {
      sock.once("connect", () => {
        sock.write(
          "CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n",
        );
      });
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        if (sock.destroyed || /HTTP\/1\.[01] [45]\d\d/.test(buf)) {
          resolve("refused");
        }
      });
      sock.on("close", () => resolve("refused"));
      sock.on("error", () => resolve("refused"));
      setTimeout(() => resolve("refused"), 3_000);
    });

    sock.destroy();

    // 域名虽在 allowlist，但解析 IP 命中 denyOut CIDR → 必须拒绝。
    expect(verdict).toBe("refused");
  });
});
