# L1-T19 · node 幂等 self-check 清单 baseline
#
# node 幂等 = resume 前后 side-effect 计数差 == 0（02-orchestration §6(e)）。
# 进化的对象 = 本清单的条目；幂等事故 = contract 违反，hard constraint = 0。
# checkpoint 在 super-step 边界（非 node 内部）= static-core。
#
# candidate 复用方向：候选加条目（如「用 upsert」）且事故率↓ → 允许入选。
# 绝不允许放松幂等约束（hard constraint 不可被软目标加权抵消）。

## 恢复前必检

- [ ] node 是否用 upsert / idempotency-key 写入（非裸 insert）？
- [ ] node 是否对外发请求前持 idempotency-key？
- [ ] node 是否避免读后写竞态（side-effect 计数 resume 前后可重放）？
- [ ] node 的 side-effect（commit / charge / send）是否在 checkpoint 边界可回放？

## checkpoint 边界

- [ ] checkpoint 是否落在 super-step 边界（非 node 内部）？
- [ ] resume 是否从最近 super-step checkpoint 重放（而非 node 中途）？
- [ ] resume 前后 side-effect 计数差 == 0？

## 恢复后必检

- [ ] resume 后 acceptance 是否达标（post-recovery acceptance）？
- [ ] 无 double-commit / double-charge / duplicate-send？
