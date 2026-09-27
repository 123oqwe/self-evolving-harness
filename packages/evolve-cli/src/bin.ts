#!/usr/bin/env node
// evolve · CLI bin 入口（PLG-T08）。
// 源码直发（monorepo 内 ts 直接消费，spec §PLG-T09 约定），宿主经
// tsx/ts-loader 运行；bin 只做 process.exit 透传。

import { runCli } from "./index.js";

const code = await runCli(process.argv.slice(2), process.cwd());
process.exit(code);
