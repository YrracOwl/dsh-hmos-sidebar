---
name: sdd-feature
description: 为跨模块、新能力、外部行为变更或用户明确要求规格/验收的 HarmonyOS 特性建立可持久的验收契约。复用 DSH 的 plan mode、todo、goal 与设备工具，不建立独立流程仪式；局部修复不需要加载本技能。
---

# 验收契约式特性交付

本技能只定义可持久的验收契约，以及它与 DSH 原生机制的边界。

## 1. 使用边界

满足任一条件时使用：

- 新能力、跨模块改动、权限/数据模型变更，或影响用户可观察行为
- 用户明确要求 spec、验收标准、SDD 或跨会话交接
- 需要让独立 review、设备验证或后续会话对照同一组成功条件

单文件的局部修复、文案或纯样式调整通常不需要契约；仍按风险执行 `dcli__lsp_check`，并在行为可能受影响时补 build 或 UI 验证。

## 2. DSH 原生机制分工

| 机制 | 职责 |
|---|---|
| plan mode | 仅在用户已开启时使用。计划中写范围、风险和场景草稿；获批前不得写盘 |
| 当前普通模式 | 范围已清楚时可先落盘契约再实现；不要为了写契约强行进入 plan mode |
| `todo_write` | 当前会话的执行任务板；不落盘为第二份 tasks 文件 |
| `create_goal` | 当前会话内的长期完成目标，适用于跨多轮或 compaction；不是跨会话记忆 |
| 契约文件 | 跨会话、进程和代理的持久验收来源 |
| `subagent` / `workflow` | 接收契约路径和验收条件；主会话拥有并维护契约 |
| `ralph` | 仅在用户明确要求 Ralph / 新鲜代理迭代时调用。特性实现的 objective 应引用契约；探索或排障则使用用户给出的不可变目标 |

## 3. 契约位置与格式

默认使用 `docs/feature-contracts/<slug>.md`。仅当用户明确指定其他位置时（例如工程已有 `specs/` 目录），才遵循该指定并在 `AGENTS.md` 自定义节记录一次；没有指定就一律用默认路径，不自行探测或模仿外部规格体系。

一个特性默认只有**一个** Markdown 契约文件。不要默认创建 `README.md`、`tasks.md`、`design.md` 或 `proposal.md`；不要在完成时移动或归档文件。稳定路径比人为归档更利于续会话、review 和 Git 历史追溯。

```markdown
# Feature Contract: <feature name>

Status: active

## Objective
<用户要获得的结果>

## Scope
- <要做的>

## Non-goals
- <明确不做的>

## Constraints and decisions
- <权限、Kit、兼容性或必须跨会话保留的决策；没有则省略>

## Acceptance scenarios
### S1 <short name>
Precondition: <起始状态>
Action: <用户或系统触发的行为>
Expected: <可观察结果>
Evidence: <截图 / UI layout / 构建结果 / 日志 / 数据输出>
```

场景描述行为和可观察结果，不写猜测的控件 id、坐标或工具调用语法。执行时再通过 `dcli__ui_layout` 等真实结果选择参数。

## 4. 执行与证据

1. 若 plan mode 已启用，先把场景草稿放入 plan；`exit_plan_mode` 获批后再创建或更新契约。
2. 普通模式下，范围清楚后创建或更新契约，再开始实现；存在实质歧义时先向用户澄清。
3. 每改一个 `.ets` / C/C++ 源文件，执行 `dcli__lsp_check` 并处理诊断。
4. `hmos-code-review` 对照契约的 Scope、Non-goals 和 S1..Sn 审查。
5. UI 场景由 `hmos-ui-verify` 执行；根据实时 layout 选择 `dcli__ui_*` 参数，并以 `s1-<name>.png` 等路径保存证据。
6. 非 UI 场景使用匹配的可复现证据，例如 build 输出、结构化日志、测试结果或数据输出；不要为了套流程强行跑 UI 验证。

所有必需场景都要有对应证据，才能把 `Status` 更新为 `verified`。失败时保留 `active` 或标为 `blocked`，修复后重跑受影响场景。

## 5. 跨会话与完成

- 新会话从项目约定或 `AGENTS.md` 中的**当前验收契约索引**找到文件，再读原文；不要依赖聊天摘要或旧 todo。
- 索引放在 `AGENTS.md` 的**自定义节 `## 当前验收契约`**（位于 `dcli__agents_md` 托管标记
  `<!-- DSH-HMOS-MANAGED:START/END -->` 之外，刷新时原样保留），例如：
  `- Active contract: docs/feature-contracts/login.md`。不要写进两个标记之间的托管块
  （`工程概览 / 常用命令 / 结构与约定 / 签名与构建 / 维护约定`）——那会被刷新重建并覆盖。
- 完成后移除此索引行，契约文件保持原路径；用 `dcli__agents_md` 刷新需确认 `## 当前验收契约` 仍在其自定义节中。
- 交付完成时，在同一文件记录简短验证结果和证据路径，再把 `Status` 改为 `verified`。无需创建 archive 或合并第二份主规格。

## 6. 禁止事项

- 将 plan mode、`exit_plan_mode` 当作每个任务的必经门
- 将 `todo_write`、goal 状态复制到 `tasks.md`
- 在场景中虚构 `dcli__ui_*` 参数、控件 id 或坐标
- 未获用户明确要求就调用 `ralph`
- 在用户明确指定的规格体系旁另起一套目录
