---
name: hmos-build-sign-release
description: HarmonyOS 构建、签名与发布：HAP/HAR/HSP 产物、build-profile.json5 与 signingConfigs、debug/release 签名、dcli__* 构建工具、打包上架流程概览。
---

# HarmonyOS 构建 / 签名 / 发布

## 1. 产物类型

| 产物 | 说明 | 后缀 |
|---|---|---|
| HAP | 应用安装包（一个模块一个 HAP） | .hap |
| HAR | 静态共享库（编译期打包进 HAP） | .har |
| HSP | 动态共享库（运行时按需加载，独立分包） | .hsp |
| APP | 上架/分发包（多个 HAP 打包） | .app |

## 2. 构建配置

- **build-profile.json5（工程根）**：`app.signingConfigs`（签名配置）、`app.products`（目标产物与模块清单）、`modules`。
- **模块 build-profile.json5**：模块级 `buildOption`（自定义构建参数）、`targets`。
- **hvigorfile.ts / hvigor-config.json5**：构建脚本与 hvigor 版本（`hvigor` + `@ohos/hvigor-ohos-plugin`）。
- `compileSdkVersion` / `compatibleSdkVersion`：编译/最低兼容 SDK 版本。

## 3. 签名

- **自动签名（推荐调试）**：DevEco Studio 登录华为账号后自动管理；命令行环境优先用 `dcli__generate_signature`。
- **前置检查**：调用 generate_signature 前必须先 `dcli__auth_status` 确认已登录。若返回 `Not logged in`，**不要**调用 generate_signature（会失败），改为告知用户手动登录：在终端运行 `devecocli auth login`（交互式拉起浏览器），登录成功后再重试。
- 手动签名需要：证书（`.cer`）、Profile（`.p7b`）、KeyStore（`.p12`）与密码，配置进 `signingConfigs` 并在 `products` 中引用。
- 签名不一致的常见报错：`Install Failed: signature verification failed`、`code sign error`。
- 调试（debug）与发布（release）签名必须分开，发布签名用于上架。
- **双 product 工程（推荐结构）**：build-profile.json5 定义两个 product——default（发布签名）+ debug（调试签名），entry 模块对应两个 target（entry@default / entry@debug）。已有两组签名材料时，先用 `dcli__configure_dual_signing` 预览，确认后传 `apply: true` 备份并写入；工具会保留未知配置、合并共享模块映射，且不会回显密码。
- **签名工作流**：先 `dcli__auth_status`；缺少调试签名且已登录时运行 `dcli__generate_signature`；准备好发布/调试两组 `.p12`、`.p7b`、`.cer` 与 DevEco 加密密码后，用 `dcli__configure_dual_signing` 配置，再执行同步和构建。新工具不会登录账号、申请证书或自动构建。
- **两个维度不要混淆**：`product` 选择 signingConfig 与模块 target，`buildMode` 选择 debug/release 构建模式。调试通常传 product: "debug" + modules: ["entry@debug"] + buildMode: "debug"；发布通常传 product: "default" + modules: ["entry@default"] + buildMode: "release"。
- **产物路径**：debug → entry/build/debug/outputs/debug/entry-debug-signed.hap；release → entry/build/default/outputs/default/entry-default-signed.hap
- **真机安装**：必须装 debug 签名包（用 `dcli__install_hap`，hdc 五步：force-stop → rm → mkdir → file send → bm install，成功标志 `install bundle successfully`）。**不要**把 default/release 签名 HAP 装到真机——可能报错 `9568322`

## 4. 构建命令

```text
dcli__sync_project               # 仅 hvigor 工程同步（不执行 ohpm install；依赖变更时先单独运行 ohpm install）
dcli__build_project              # 构建（可传 product/modules/buildMode）
dcli__run_app                    # 构建 + 安装 + 启动（真机/模拟器）
dcli__generate_signature         # 生成调试签名材料
dcli__configure_dual_signing    # 预览/写入 release+debug 双签名结构
dcli__update_cli                 # 升级 CLI/工具链（有副作用，按需执行）
```

构建失败排查顺序：`oh-package.json5` 依赖版本 → `build-profile.json5` 配置 → SDK 路径/版本 → 签名 → 代码编译错误（先 `dcli__lsp_check` 清零诊断再构建）。

## 5. 打包与发布（概览）

1. 工程配置核对：`bundleName`（全局唯一）、`versionCode/versionName`、`minAPIVersion`。
2. 使用发布签名构建 release 产物（HAP/APP）。
3. 上架华为应用市场：准备应用信息、隐私声明、图标与截图，提交审核。
4. 内部测试/企业分发：使用对应的 Profile 类型（测试/企业证书）。

## 6. 检查清单

- 构建前先跑 `dcli__lsp_check` 清零源码诊断，节省构建轮次。
- 变更 `bundleName`/`versionCode` 前确认影响（升级、多包冲突）。
- 敏感信息（密码、KeyStore 口令）不进代码与配置文件明文提交。
