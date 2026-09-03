---
name: hmos-system-capabilities
description: HarmonyOS 系统能力开发指引：Ability 生命周期与页面路由、权限模型（静态/动态申请）、后台任务、数据管理、通知、分布式等能力的使用框架。涉及系统接口时先查官方文档。
---

# HarmonyOS 系统能力开发指引

## 1. Ability 与页面路由

- **Stage 模型**：应用由 `module.json5` 中的 `abilities` 声明能力；UIAbility 承载界面，`EntryAbility` 为典型入口。
- UIAbility 生命周期：`onCreate / onWindowStageCreate / onForeground / onBackground / onDestroy`。
- 页面跳转：`router.pushUrl({ url: 'pages/xxx' })` 或 Navigation 组件；返回 `router.back()`。
- 多模块（HAR/HSP）：跨模块页面路由与资源引用需注意模块路径前缀。

## 2. 权限模型

- **声明**：`module.json5` 的 `requestPermissions` 列出权限（name、reason、usedScene）。
- **分级**：`normal`（应用安装即授予，如 INTERNET）、`system_basic`/`system_core`（系统应用或受限）。
- **动态申请**：用户授权类权限（如相机、位置、麦克风）用 `abilityAccessCtrl.createAtManager().requestPermissionsFromUser()`，
  并在 `onPermissionRequestResult` 处理结果；拒绝时给出引导。
- 检查：`AppStorage`/`abilityAccessCtrl` 的 `checkAccessToken` 判断是否已授权。

## 3. 常用能力框架

| 能力 | 推荐 Kit / 服务（精确导入以目标 SDK 文档为准） |
|---|---|
| 通知 | Notification Kit：本地通知、通知授权与渠道 |
| 后台任务 | Background Tasks Kit：长时/短时任务；先确认系统限制 |
| 数据管理 | ArkData：RDB、Preferences 与分布式数据 |
| 文件 | Core File Kit：应用沙箱文件访问（`context.filesDir` 等） |
| 网络 | Network Kit：HTTP、Socket；需 INTERNET 权限 |
| 媒体 | Camera Kit、Audio Kit、Image Kit |
| 分布式 | Distributed Service Kit / Device Discovery 等对应 Kit |
| 安全 | Universal Keystore Kit 等安全能力 |

HarmonyOS SDK 正在从旧式 `@ohos.*` 模块迁移到 Kit 聚合导入。不要按名称猜测 `@kit.*` 导出；先用 `dcli__api_lookup` 确认当前 `compileSdkVersion` 的准确模块与符号（需要全文时再用返回的 documentId 调 `dcli__docs_read`），再写 import。

## 4. 应用上下文

- 在 UIAbility 内通过 `this.context` 获取 UIAbilityContext（文件目录、权限请求、startAbility 等）。
- 全局单例：`AppStorage`（应用级状态）、`common.UIAbilityContext` 传递注意生命周期泄漏。

## 5. 实践原则

- **先查文档**：所有系统接口以官方 API 参考为准（见 hmos-doc-research 技能），不臆造参数。
- **权限最小化**：只申请必要权限，动态权限必须处理拒绝分支。
- **生命周期配对**：资源（定时器、监听、数据库连接）在 onDestroy/onBackground 释放，防止泄漏。
- 后台任务与长驻能力受系统管控，先确认目标场景是否被允许，再设计实现。
