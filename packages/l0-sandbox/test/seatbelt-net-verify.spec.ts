/**
 * L0S seatbelt 网络拒绝 surfacing 收集逻辑单测（本地可跑等价验证）。
 *
 * 背景（cloud CI 实证 bug，macos-latest 真实非嵌套 seatbelt 路径）：
 * 逃逸门测试跑 `curl -s --max-time 5 https://evil.com`——`-s` 抑制错误
 * 输出，`(deny network*)` 确实拒绝了 DNS/connect（curl exit 6），但 stderr
 * 为空 → `expected '' to match /Could not resolve|.../` 失败。修复 = 失败
 * 且无可见拒绝签名时用自有 loopback 探针复测，把真实探针拒绝输出合并进
 * stderr。本单测验证合并逻辑本身（本地嵌套沙箱无法验证真实 sealed 路径，
 * 真实验证靠 push 后 CI macos-latest）。
 *
 * 运行：pnpm vitest run --config packages/l0-sandbox/vitest.config.ts
 */

import { describe, it, expect } from "vitest";

import {
  extractNetDenyHits,
  mergeNetVerifyEvidence,
} from "../src/index.js";

// 逃逸门测试的可接受模式（tests/L0S/T02.sandbox-deny-egress.spec.ts）。
const ESCAPE_GATE_RE =
  /Could not resolve|Connection refused|Could not connect|Network is unreachable|Operation not permitted/i;

// 真实 macOS 上 (deny network*) 拒绝 loopback connect 时 curl 的实际输出
// 形态（connect() → EPERM，strerror 进消息）。
const PROBE_EPERM_STDERR =
  "curl: (7) Failed to connect to 127.0.0.1 port 1 after 0 ms: Operation not permitted\n";

// 未沙箱化环境（端口关闭）的探针输出——不是拒绝证据，绝不能采纳。
const PROBE_REFUSED_STDERR =
  "curl: (7) Failed to connect to 127.0.0.1 port 1 after 0 ms: Connection refused\n";

// DNS 被拒形态（参考）：sandbox 拒 mDNSResponder unix socket（macos）/
// --unshare-net 空 netns 无路由（linux）→ 解析失败。
const PROBE_DNS_STDERR = "curl: (6) Could not resolve host: example.com\n";

// Linux bwrap --unshare-net 空 netns（lo DOWN、无默认路由）内 loopback
// connect 的实际输出形态（connect() → ENETUNREACH）。
const PROBE_NETUNREACH_STDERR =
  "curl: (7) Failed to connect to 127.0.0.1 port 1 after 0 ms: Network is unreachable\n";

describe("seatbelt net-verify surfacing · extractNetDenyHits", () => {
  it("EPERM 拒绝签名被采纳", () => {
    const hits = extractNetDenyHits(PROBE_EPERM_STDERR);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/Operation not permitted/i);
  });

  it("DNS 拒绝签名被采纳", () => {
    const hits = extractNetDenyHits(PROBE_DNS_STDERR);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/Could not resolve/i);
  });

  it("Linux netns 无路由签名（Network is unreachable）被采纳", () => {
    // bwrap --unshare-net 空 netns 内 loopback connect → ENETUNREACH。
    const hits = extractNetDenyHits(PROBE_NETUNREACH_STDERR);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/Network is unreachable/i);
  });

  it("Connection refused（未沙箱化噪音）不被采纳为拒绝证据", () => {
    // 关键：未沙箱化的 loopback connect（端口关闭）同样产出 Connection
    // refused——采纳它会伪造沙箱拒绝记录（round 2 缺陷 3）。
    expect(extractNetDenyHits(PROBE_REFUSED_STDERR)).toHaveLength(0);
  });

  it("空 stderr / 无关输出产出空列表", () => {
    expect(extractNetDenyHits("")).toHaveLength(0);
    expect(extractNetDenyHits("some unrelated failure\n")).toHaveLength(0);
  });
});

describe("seatbelt net-verify surfacing · mergeNetVerifyEvidence", () => {
  it("cloud CI 失败形态：用户命令 stderr 为空 + 探针 EPERM → 合并后命中逃逸门模式", () => {
    // 精确复现 CI annotation 的形态：result.stderr === ''，探针产出真实
    // 内核拒绝签名。合并后 stderr 必须命中逃逸门可接受模式之一。
    const merged = mergeNetVerifyEvidence("", [], PROBE_EPERM_STDERR);
    expect(merged.stderr).not.toBe("");
    expect(merged.stderr).toMatch(ESCAPE_GATE_RE);
    // 探针行带区分前缀，不冒充用户命令输出。
    expect(merged.stderr).toContain("[sandbox-net-verify]");
    expect(merged.stderr).toContain("Operation not permitted");
    // epermHits 同步包含标记后的探针行。
    expect(merged.epermHits).toHaveLength(1);
    expect(merged.epermHits[0]).toContain("[sandbox-net-verify]");
  });

  it("用户 stderr 已有内容时保留原文并换行追加", () => {
    const merged = mergeNetVerifyEvidence(
      "sh: some error\n",
      ["sh: some error"],
      PROBE_EPERM_STDERR,
    );
    expect(merged.stderr.startsWith("sh: some error\n")).toBe(true);
    expect(merged.stderr).toMatch(ESCAPE_GATE_RE);
    expect(merged.epermHits).toHaveLength(2);
  });

  it("探针无可采纳证据（Connection refused）时结果原样透传", () => {
    const merged = mergeNetVerifyEvidence("", [], PROBE_REFUSED_STDERR);
    expect(merged.stderr).toBe("");
    expect(merged.epermHits).toHaveLength(0);
  });
});
