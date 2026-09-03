---
name: hmos-agents-md
description: 鸿蒙工程 AGENTS.md 项目约定：DSH 每个会话首个 pre-step 自动注入项目根 AGENTS.md 作为持久上下文；用 preview-first 的 dcli__agents_md 从工程配置生成/刷新（默认 apply=false，apply=true 才以备份和原子替换写入；托管块 <!-- DSH-HMOS-MANAGED:START/END --> 之间重建，标记之外全文保留），沉淀模块结构、构建/运行命令、签名配置、代码规范与特性清单。
---

# AGENTS.md 工程约定

在**工程根目录**维护 `AGENTS.md`，
把"只有人知道"的项目上下文写进去。DSH 的 `dsh-agent-instructions` 插件在
**每个会话的第一个 pre-step** 自动读取并注入持久历史（用户全局
`~/.dsh/AGENTS.md` 若存在，外加项目根到 cwd 每层 `AGENTS.md`/`CLAUDE.md`，
项目根以 `.git` 标记识别），
文件系统调用成功后还会动态报告新增/修改/删除。**AI 无需手动"读"AGENTS.md，
但要保证它始终准确。**

## 1. 何时创建/更新

- 新工程通过 `dcli__create_project` 创建后
- 接手不熟悉的工程时（先读 AGENTS.md，没有则帮用户创建）
- 工程结构、命令、规范变化时同步更新
- **优先用 `dcli__agents_md` 工具**：自动读 build-profile.json5 / AppScope/app.json5 /
  module.json5 / main_pages.json 填充工程概览、模块、SDK、products、页面路由，
  并生成常用命令清单（api_lookup / docs / check / sync / build / install_hap /
  start_app / logs）。托管块（`<!-- DSH-HMOS-MANAGED:START -->` 至 `<!-- DSH-HMOS-MANAGED:END -->`
  之间）每次刷新重建，旧文件中**标记之外的全文自动保留**。默认先以 `apply=false` 预览；确认后才以 `apply=true` 写入。

## 2. 建议内容模板（与 dcli__agents_md 输出一致）

dcli__agents_md 的产物分三部分：标记之前（head，可放自定义节）、托管块
（`<!-- DSH-HMOS-MANAGED:START -->` 与 `<!-- DSH-HMOS-MANAGED:END -->` 之间，
每次刷新按工程配置重建、勿手改）、标记之后（tail，可放自定义节）。
自定义节必须放在两个标记之外，否则刷新时会被覆盖。

```markdown
<!-- DSH-HMOS-MANAGED:START -->
# <项目名> AGENTS.md

## 工程概览
- 应用类型：HarmonyOS 原生应用（Stage 模型，ArkTS）
- bundleName：<com.example.xxx>
- 模块：<entry / har / hsp 及职责>
- SDK：targetSdk <x>，compatibleSdkVersion <y>
- products：<name(signingConfig)>（调试用 debug，发布用 default）

## 常用命令（经 DSH 原生 dcli 插件调用；projectPath 传本工程根）
- 查 API：`dcli__api_lookup`（SDK .d.ts 精确签名 + 本地文档库多源印证，写代码前查）
- 文档：`dcli__docs_search` / `dcli__docs_read`（documentId 来自 search）
- 静态检查：`dcli__lsp_check`（files 传相对工程根，修改 .ets / C/C++ 后必须执行、诊断清零再继续）
- 规范检查：`dcli__check_lint`（Code Linter）
- 同步：`dcli__sync_project`
- 构建：`dcli__build_project`（product 与模块按本工程实际配置，见 build-profile.json5）
- 安装：`dcli__install_hap`（hapPath 传构建产物路径）
- 启动：`dcli__start_app`
- 日志：`dcli__get_device_logs`

## 结构与约定
- 页面路由：<main_pages.json 的 src>（main_pages.json）
- 状态管理：先读现有代码确认 V1 / V2；新代码优先 V2（@ComponentV2/@Local/@Param）

## 签名与构建
- products 与签名配置、目标产物 HAP 路径
- **真机安装只装 debug 签名包**（release/default 签名源装真机可能报错 9568322）
- 敏感信息警告：build-profile.json5 中 storePassword/keyPassword 为加密串，勿复制到聊天/日志/文档

## 维护约定
- 本文件托管块由 dcli__agents_md 自动刷新（marker 之间不可手改）；marker 之外可自由追加自定义节
- 不写敏感信息（密码、签名 KeyStore 口令）
- 完成重要特性后，把可复用知识（踩坑、命令）追加到 marker 之外的自定义节
<!-- DSH-HMOS-MANAGED:END -->

## 特性清单（自定义节，可选，只做索引，不倒完整场景）
- F1 <特性名>：<一句话>（docs/feature-contracts/<slug>.md）
- F2 ...

## 当前验收契约（自定义节，在两个标记之外，刷新会保留）
- Active contract: docs/feature-contracts/<slug>.md
- 只索引正在进行的契约；完成后删除该索引行，契约文件保持原路径
```

## 3. 使用原则

- AGENTS.md 是**事实来源之一**，与代码冲突时以代码实际行为为准并提示用户更新文档。
- 不把敏感信息写进 AGENTS.md（密码、签名 KeyStore 口令）。
- 托管块由 `dcli__agents_md` 统一管理：两个标记之间（`工程概览 / 常用命令 / 结构与约定 / 签名与构建 / 维护约定`）
  是托管内容，刷新时按工程配置重建；**标记之外的其他标题节（如 `## 当前验收契约`、`## 特性清单`）属于自定义节，刷新时原样保留**。
  旧文件没有标记时，工具保留原文全文并在末尾追加托管块；marker 缺失配对、重复或反序时拒绝写入。默认 `apply=false` 预览，`apply=true` 才创建单份备份并原子替换。
- 验收契约索引必须放在两个标记之外的自定义节里（例如上面的 `## 当前验收契约`），不能放进托管块——
  否则 `dcli__agents_md` 刷新会把索引覆盖掉。索引行用 `- Active contract: docs/feature-contracts/<slug>.md`。
- 每完成一个重要特性，把可复用的知识（踩坑、命令）回写 AGENTS.md（放标记之外的自定义节，
  `dcli__agents_md` 刷新时会保留）。
- 读取优先级：项目根 AGENTS.md > 用户/全局配置；子模块可在模块目录放自己的 AGENTS.md（内容较少时不必）。
- 工具链路径解析链：patch 配置 → `DEVECO_CLI_PATH` / `DEVECO_HOME` → `DEVECO_SDK_HOME` 父目录 → 常见安装目录；工程根：config.projectPath → `PROJECT_PATH` → 进程 cwd。
