// 环境探针（申诉修订 V2-C4，同 T04a loopback 门控模式）:
// pi -p 子进程需要写 ~/.pi 会话目录; 外层沙箱未放行时 roundtrip 无法完成。
// 探测一次真实往返（带 timeout），失败 → smoke 用例 skip（CI 无 pi 自动 skip,
// 本地沙箱受限环境 skip, 宿主放行环境真跑）。
import { execSync } from "node:child_process";

function probePi(): boolean {
  try {
    execSync('pi -p "reply with exactly: PONG"', { timeout: 30000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export const canSpawnPi: boolean = probePi();
