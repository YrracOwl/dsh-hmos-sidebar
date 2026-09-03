---
name: native-harmonyos
description: 原生鸿蒙（HarmonyOS）应用开发工作流：工程结构解读、DevEco CLI 命令、ArkTS/C++ 静态检查（dcli__lsp_check）与常见问题处理。鸿蒙开发任务默认加载本技能。
---

# 原生鸿蒙开发工作流

面向 HarmonyOS 原生应用（Stage 模型）的开发流程。涉及 ArkTS 源码修改时，**每次改动后必须用 `dcli__lsp_check` 验证**。

## 1. 工程结构速览

```
project/
├── AppScope/app.json5          # 应用级配置（bundleName、icon、label）
├── build-profile.json5         # 工程级配置：signingConfigs / products / modules
├── oh-package.json5            # 工程级依赖声明（@ohos 三方包）
├── hvigorfile.ts               # 工程级构建脚本
├── hvigor/hvigor-config.json5  # hvigor 版本与依赖
├── entry/                      # 典型模块（entry / har / hsp）
│   ├── build-profile.json5     # 模块级构建配置
│   ├── oh-package.json5
│   ├── hvigorfile.ts
│   └── src/main/
│       ├── module.json5        # 模块清单：abilities、requestPermissions、deviceTypes
│       ├── ets/                # ArkTS 源码
│       │   ├── entryability/EntryAbility.ets
│       │   └── pages/Index.ets
│       └── resources/          # base/element(json)、base/media、base/profile
└── local.properties            # sdk.dir 等本地配置
```

关键文件含义：
- `module.json5` 的 `abilities` 定义页面能力（entryAbility 与 `pages` 一一对应），`requestPermissions` 声明权限
- `build-profile.json5` 的 `products` 定义构建产物（签名配置引用 `signingConfigs`）
- `oh-package.json5` 管理 `@ohos/hypium`、`@ohos/hamock` 等测试与三方依赖

## 2. 静态检查（dcli 原生 LSP 工具）

`dcli__lsp_check` 按工程常驻 LSP 实例，首次调用自动创建（初始化约 10-60s），可指定任意工程。

- `dcli__lsp_check`：`files` 传 `.ets` 或 C/C++ 源文件路径（相对工程根），`projectPath` 传工程根（默认当前会话工程）。返回结构化诊断。
  - 诊断未清零前不要提交/继续；先修编译器指出的类型、import、资源引用问题。
- `dcli__lsp_restart`：`target` 取 `arkts` / `cpp` / `all`。当 check 卡死、返回"LSP 未初始化"或报
  环境错误（如 ohpm/hvigor 同步失败）时使用；**不要反复调用**，先修根因（工程配置、SDK 路径）。

## 3. DevEco CLI 工具（原生插件）

优先调用宿主已注册的结构化工具；全部 `dcli__*` 均为宿主原生插件：

| 任务 | 工具 |
|---|---|
| 创建/同步工程 | `dcli__create_project` / `dcli__sync_project` |
| 构建/清理/运行 | `dcli__build_project` / `dcli__clean_project` / `dcli__run_app` |
| 设备/模拟器 | `dcli__list_devices` / `dcli__device_info` / `dcli__list_emulators` / `dcli__emulator_*` |
| 日志 | `dcli__get_device_logs` |
| 文档 | `dcli__docs_search` / `dcli__docs_read` / `dcli__docs_catalog` |
| 签名/升级 | `dcli__generate_signature` / `dcli__update_cli` |
| 安装/启动 | `dcli__install_hap`（hdc 直装 HAP；真机调试装 debug 签名包，勿装 default/release 签名包） / `dcli__start_app`（hdc aa start 启动已装应用，bundleName 必填，abilityName 默认 EntryAbility，多模块传 moduleName） |
| 检查 | `dcli__lsp_check`（LSP 实时诊断，可指定工程）/ `dcli__check_lint`（规范+性能）/ `dcli__check_compat`（SDK 兼容，先 `dcli__check_compat_versions` 查版本） |

仅当所需能力没有封装工具时才直接调用 `devecocli`，并先运行相应的 `--help` 核对当前版本参数。Windows 上工具链由 DevEco Studio 提供；`DEVECO_CLI_CPP_ENABLED=false` 可禁用 C++ LSP。

## 4. 常见问题

| 现象 | 处理 |
|---|---|
| check 报 "no C++ code" / "ArkTS LSP 未初始化" | 确认工程根存在 `build-profile.json5`，必要时用 `dcli__sync_project` 后调用 `dcli__lsp_restart` |
| ohpm 依赖安装失败 | 检查 `oh-package.json5` 版本号与 registry 网络，先单独执行 ohpm install 修复，再运行 `dcli__sync_project` 同步 |
| 构建失败：签名错误 | 检查 `build-profile.json5` signingConfigs，必要时用 `dcli__generate_signature` |
| 真机运行失败 | 用 `dcli__list_devices` 确认连接与授权（HDC），再调用 `dcli__run_app` |
| 页面/资源找不到 | 检查 `module.json5` abilities.pages 与 `resources/base/profile/main_pages.json` 一致 |

## 5. Ralph 新鲜迭代

`ralph` 工具在预设中可用（spawn 后端，上限 64 轮）。适合主会话"陷进去"的工作。

> ⚠️ **前置条件**：仅在**用户明确要求 Ralph / 新鲜代理迭代**时才调用 ralph
> （工具契约限制）。普通长任务用 goal，有限委派用 subagent / workflow；
> 认为适合时可向用户建议该方案，等确认后再启动。

- **何时用**：跨模块大规模重构（验收契约已定）、构建/验证反复失败的根因排查、陌生工程逆向理解。
- **怎么写 objective**：不可变目标 + 完成标准 + 验收命令。例：
  `将 entry 模块的 List 页改为 LazyForEach 懒加载并保持行为一致；完成标准：dcli__lsp_check 0 条诊断 + dcli__build_project 通过。`
- **跨轮记忆**：工作区即共享记忆——要求每轮把进展写入工程 `AGENTS.md` 或备注文件，下一轮先读再动。
- **注意**：ralph 轮是全新上下文，不能依赖本会话历史；复杂验收（UI 验证）由主会话在最终轮后执行。
