# L1-T21 · prompt template 基质（prompts/get 返回的 PromptMessage 模板体）
#
# 作 slash-command 基质。prompts 永不自动作 system context 注入——保持
# user-controlled（02-tools-mcp 组件6）。破坏性 prompt（含 execute 指令）须人审
# （assertDestructivePromptHumanGated）。
#
# 进化信号 = user-task 成功率（evolvePromptTemplate）。

## Steps
1. Gather the necessary context for the user task.
2. Execute the planned action step by step.
3. Verify the result against the acceptance criteria.
