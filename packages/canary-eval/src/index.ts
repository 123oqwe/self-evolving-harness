// @harness/canary-eval — Canary 评估集与验证器 harness（CE 模块）。
//
// CE-T01a 落地：canary 集加载（frozen release）+ SWE-rebench 风格去污染
// （repo 结构定位 = 仓库名相等，ERRATA-w2plus CE-02）。

export {
  loadCanary,
  isDecontaminated,
} from "./canary/loader.js";

export {
  computeManifestSha256,
  verifyManifestSha256,
} from "./canary/manifest-hash.js";

export type {
  CanaryTask,
  CanaryManifest,
  Trajectory,
} from "./canary/types.js";
