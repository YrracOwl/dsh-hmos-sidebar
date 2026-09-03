---
name: hmos-doc-research
description: HarmonyOS 官方知识检索流程：统一入口 dcli__api_lookup（SDK .d.ts 精确签名 + 本地文档库多源印证），其次 dcli__docs_search / docs_read，最后 web_search 限定 developer.huawei.com 等官方站点；查到权威定义后再写代码，禁止臆造 API。
---

# HarmonyOS 官方知识检索流程

## 原则

涉及以下任何内容时，**先检索权威来源再写代码**，不凭记忆臆造 API：

- ArkUI 组件属性、装饰器、状态管理语法
- 系统能力接口（Ability、权限、后台任务、分布式、数据管理、媒体、安全）
- SDK 版本差异与废弃 API
- 构建配置项（build-profile.json5、module.json5 字段）

## 权威来源（按优先级）

1. **SDK 类型声明（.d.ts）——精确签名，与 compileSdkVersion 零偏差**
   DevEco Studio 安装目录下，IDE 悬停提示同源：
   - `sdk/default/openharmony/ets/component/*.d.ts` — ArkUI 组件声明
   - `sdk/default/openharmony/ets/api/*.d.ts` — 系统接口（@ohos.*）
   - `sdk/default/openharmony/ets/kits/*.d.ts` — Kit 导出（@kit.*）
   - `sdk/default/openharmony/ets/arkts/*.d.ets` — ArkTS 语言扩展（@arkts.*）
   - `sdk/default/hms/ets/api/*.d.ts` — HMS API
   （目录内的文件数量随 SDK 版本变化，勿引用固定计数；以实际安装的 SDK 目录与 `dcli__api_lookup` 的命中为准）
2. **本地文档库**（deveco docs，离线官方文档全文：开发指南/API 参考/FAQ/最佳实践）
3. **官方在线站点**（web_search 限定 developer.huawei.com / docs.openharmony.cn）

## 检索步骤（按优先级）

1. **`dcli__api_lookup`（统一入口，多源印证）**：传 `name` 查组件（Button/TextInput）、接口（@ohos.arkui.UIContext）、装饰器（@ComponentV2）、Kit（@kit.ArkUI）、语言扩展（@arkts.collections）等。
   - 一次返回：SDK .d.ts 精确签名片段（含文件:行号）+ 顶层导出清单 + 本地文档库命中（documentId）。
   - 结果聚焦单个区域时传 `scope`（component/api/kits/arkts/hms/docs），默认 all。
   - 需要文档全文时，用返回的 documentId 调 `dcli__docs_read`。
2. **`dcli__docs_search` / `dcli__docs_catalog`**：按关键词检索本机离线文档索引；`documentId` 用 `dcli__docs_read` 读全文。
3. **web_search 限定官方域**：
   - 查询示例：`site:developer.huawei.com <API 名> ArkTS` 或 `<组件名> 文档 site:developer.huawei.com`
   - 备选权威来源：`docs.openharmony.cn`（OpenHarmony 文档）、HarmonyOS 官方博客/发布说明。
4. **交叉确认**：API 签名、装饰器规则、权限声明以官方文档原文与 SDK 声明为准；三方博客仅作线索。

## 环境与路径

- 工具链路径解析链（从高到低）：patch 配置 → 环境变量 `DEVECO_CLI_PATH` / `DEVECO_HOME` → `DEVECO_SDK_HOME`（官方同款变量，指向 `<Studio>/sdk`，取其父目录）→ 常见安装目录探测。
- 环境变量可在全局（setx DEVECO_HOME ...）或项目级固定，换机/换安装路径无需改 patch。
- `dcli__api_lookup` / `dcli__install_hap` / `dcli__start_app` 依赖 devEcoHome 解析到 DevEco Studio 安装根。

## 检索后落地

- 把确认的 API 签名、使用示例、注意事项写入代码注释或本会话要点，避免重复检索。
- 权限类接口：确认 `module.json5` 的 `requestPermissions` 声明与动态申请（`abilityAccessCtrl`）是否都需要。
- 版本类问题：确认目标 SDK（`compileSdkVersion`）支持后再用。

## 常见坑

- 网络上过时示例（API 9 之前的写法）与当前 SDK 不兼容——以当前 `compileSdkVersion` 的 SDK 声明与文档为准。
- ArkUI 状态管理 V1/V2 语法差异大，检索时注明版本。
- 系统接口有的需要 `system_basic` 级别权限（仅系统应用），普通应用不可用——先确认权限等级。
