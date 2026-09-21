// tests/L0S/t04a-env.ts · 环境探测（申诉修订配套，与 T02 skipIf(noBackend) 同模式）
// 外层沙箱（如嵌套 seatbelt）可能内核级拒绝 loopback listen/connect。
// 收集期同步探测（子进程退出码），使 skipIf 可用；探测失败 → skip 本组用例。
import { execSync } from "node:child_process";

const PROBE = `const n=require('node:net');const s=n.createServer();`
  + `s.listen(0,'127.0.0.1',()=>{const c=n.connect({port:s.address().port,host:'127.0.0.1'});`
  + `c.on('connect',()=>process.exit(0));c.on('error',()=>process.exit(3));});`
  + `s.on('error',()=>process.exit(3));setTimeout(()=>process.exit(3),2000);`;

function probeLoopback(): boolean {
  try {
    execSync(`node -e "${PROBE}"`, { timeout: 5000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** 当前环境能否承载 loopback socket（SocatProxy 前提）。 */
export const canHostLoopback: boolean = probeLoopback();
