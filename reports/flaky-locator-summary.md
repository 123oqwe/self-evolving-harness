# OPS-T03 · flaky 用例定位 — 结论摘要

> 原始运行日志（5 次 run JSON + 详细矩阵）不再入库，见 CI artifact（ISS-32）。

## 结论

- 5 次连续全套件运行，检测到 **1 个 flake 用例**：`tests/L0C/T01-scaffold.spec.ts` 的
  `pnpm -r build succeeds for all 7 packages`（5 次中 failed×4 / passed×1）。
- **根因**：资源竞争型——`pnpm install` 与并发 `pnpm -r build` 争抢 CPU/IO + node_modules 写竞态，
  触发 180s timeout 或瞬时 tsc 失败。单独串行跑 3 次全过，证实非逻辑错误。
- **处置**：该用例在 TEST-LOCK 锁定文件内，implementer 不可改；走申诉通道
  （加串行隔离或 skipIf），由 test-author 修订重锁。
- **容差**：GREENS.baseline 容差从 5 收紧到 2（唯一 flake 仅 ±1 green，容差 2 足以吸收
  且仍挡 ≥2 的批量回归）。
