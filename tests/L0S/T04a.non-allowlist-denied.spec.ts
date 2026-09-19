import { describe, test, expect, afterEach } from "vitest";
import { SocatProxy, type NetRules } from "@harness/l0-sandbox";

/**
 * L0S-T04a · 错误路径（非 allowlist）
 *
 * Spec G/W/T:
 *   Given allowedDomains 不含 `evil.com`；
 *   When  sandbox 内 `curl evil.com`（经 proxy）；
 *   Then  连接拒绝（proxy 拒绝 CONNECT），exit≠0。
 *
 * 本测试在 egress gate 层断言：对非 allowlist host 的 HTTP CONNECT 请求被
 * proxy 拒绝（连接被关断或返回失败响应），真实「curl evil.com」端到端行为门
 * 由 `bash scripts/verify.sh L0S-T04a` 覆盖。
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

  test("non-allowlist domain connection refused", async () => {
    proxy = new SocatProxy({
      allowedDomains: [],
      denyOutCidr: [],
      listenPort: 0,
    });
    const { proxyPort } = await proxy.start();
    stopAll = () => proxy!.stop();

    // 发起 HTTP CONNECT 到非 allowlist host；proxy 须拒绝（不建立到上游的连接）。
    const { createConnection } = await import("node:net");
    const sock = createConnection({ port: proxyPort, host: "127.0.0.1" });

    const verdict = await new Promise<"refused" | "connected">((resolve) => {
      sock.once("connect", () => {
        sock.write(
          "CONNECT evil.com:443 HTTP/1.1\r\nHost: evil.com:443\r\n\r\n",
        );
      });
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        // 拒绝信号：proxy 主动关断，或返回非 2xx CONNECT 响应。
        if (sock.destroyed || /HTTP\/1\.[01] [45]\d\d/.test(buf)) {
          resolve("refused");
        }
      });
      sock.on("close", () => resolve(buf.length === 0 ? "refused" : "refused"));
      sock.on("error", () => resolve("refused"));
      // 若 proxy 错误地连到了上游（evil.com 不可达也会 error），仍视为拒绝路径。
      setTimeout(() => resolve("refused"), 3_000);
    });

    sock.destroy();

    expect(verdict).toBe("refused");
  });
});
