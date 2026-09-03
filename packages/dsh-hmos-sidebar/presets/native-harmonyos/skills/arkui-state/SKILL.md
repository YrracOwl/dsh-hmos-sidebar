---
name: arkui-state
description: ArkUI 声明式 UI 与状态管理：页面与自定义组件、常用布局/组件、状态装饰器（V1 @State/@Prop/@Link/@Provide/@Consume，V2 @ComponentV2/@Local/@Param 等）、生命周期与常用模式。写 ArkTS UI 前加载本技能。
---

# ArkUI 声明式 UI 与状态管理

## 1. 基础模型

- UI 用 ArkTS 声明式描述：`build()` 内组合组件，状态变化驱动 UI 自动刷新。
- 组件树由 `Column/Row/Stack/Flex/Grid/List/Scroll` 等布局组件组织。
- 页面入口：`@Entry` 组件 + `build()`；每个 `pages` 目录下的 `.ets` 文件对应一个路由页面。

## 2. 布局与常用组件

| 组件 | 用途 |
|---|---|
| Column / Row | 纵向 / 横向线性布局（`justifyContent`/`alignItems`） |
| Stack | 层叠布局（`alignContent`） |
| Scroll / List | 可滚动容器 / 列表（`ForEach` 渲染） |
| Grid / GridItem | 网格布局 |
| Tabs / TabContent | 页签切换 |
| Navigation / NavDestination | 页面路由与导航 |
| Text / Image / Button / TextInput | 基础元素 |
| Blank / Divider / Space | 占位与分隔 |

常用属性：`width/height`、`padding/margin`、`backgroundColor`、`borderRadius`、`fontSize/fontColor`、
`onClick/onChange` 事件、`.stateStyles`、`.visibility`。

## 3. 状态管理（V1 装饰器）

| 装饰器 | 语义 |
|---|---|
| `@State` | 组件内可变状态，变更触发本组件刷新 |
| `@Prop` | 父→子单向传值（值拷贝），子组件内只读 |
| `@Link` | 父→子双向同步（引用），需 `$` 传递 |
| `@Provide` / `@Consume` | 跨层级祖先/后代同步（无需逐层传递） |
| `@Observed` + `@ObjectLink` | 对象/数组内嵌属性的深度观测（类需 `@Observed` 装饰） |
| `@Watch` | 监听某个状态变量的变化回调 |
| `@StorageLink` / `@StorageProp` | 与 AppStorage 持久化/全局存储同步 |

原则：状态就近存放；父子用 `@Prop/@Link`；跨层用 `@Provide/@Consume` 或 AppStorage；避免深拷贝大对象。

## 4. 状态管理（V2，推荐新工程）

V2 使用 `@ComponentV2`、`@Local`（本地状态）、`@Param`（外部传入）、`@Event`（回调）、
`@Provider/@Consumer`、`@ObservedV2`/`@Trace`（深度观测）。V1 与 V2 可共存但装饰器不可混用于同一变量。
新工程优先 V2；存量 V1 工程保持 V1 一致风格。具体语法以官方文档为准。

## 5. 生命周期与常用模式

- 组件：`aboutToAppear` / `aboutToDisappear`（V2：`aboutToAppear` 等类似）；页面：`onPageShow/onPageHide/onBackPress`。
- `ForEach` 渲染列表必须给 `keyGenerator` 稳定键；`LazyForEach` 用于长列表。
- 弹窗：`AlertDialog.show`、`@CustomDialog`、`bindSheet`/`bindContentCover`。
- 动效：`animateTo`、`transition`、`@Animatable`；性能注意 `if/else` 分支减少无效刷新。

## 6. 检查清单

- 组件必须实现 `build()`；状态变更应作用于最小粒度组件。
- 大列表用 `LazyForEach` + 明确 key；避免在 `build()` 中做耗时计算。
- 修改 UI 后必须用 `dcli__lsp_check` 验证 ArkTS 语法与类型。
- 不确定的 API（组件属性、装饰器组合、系统接口）先查官方文档再写。
