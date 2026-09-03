---
name: arkui-api-quickref
description: ArkUI 高频 API 速查：常用组件与属性、状态装饰器对照、资源引用与格式化、高频报错与修复。写常见 UI 代码时快速参考，减少检索往返；非常见 API 仍需查官方文档。
---

# ArkUI 高频 API 速查

> 速查表覆盖高频用法；不确定的签名、新版本特性以官方文档为准（见 hmos-doc-research 技能）。

## 1. 常用组件速查

| 组件 | 高频属性/用法 |
|---|---|
| `Text` | `textContent` 或子串；`fontSize/fontColor/fontWeight`、`maxLines`、`textOverflow({overflow: TextOverflow.Ellipsis})` |
| `Image` | `src`（`$r('app.media.xxx')`）、`objectFit`、`width/height`、`interpolation` |
| `Button` | `type`（`ButtonType.Normal/Capsule/Circle`）、`backgroundColor`、`onClick`；带图标用 `Button({ type }) { Row(...) }` |
| `TextInput` | `placeholder`、`text/onChange`、`type`（`InputType.Password` 等）、`maxLength` |
| `Column/Row` | `justifyContent`/`alignItems`、`space`（子组件间距）、`padding` |
| `Stack` | `alignContent`（对齐）、层叠内容 |
| `List` + `ListItem` | `ForEach` 渲染；`LazyForEach` 长列表；`scrollBar` |
| `Grid` + `GridItem` | `columnsTemplate('1fr 1fr')`、`rowsGap/columnsGap` |
| `Tabs` + `TabContent` | `barPosition`、`scrollable`；每 TabContent 一个子页面 |
| `Navigation` | `NavDestination` 页面栈；`mode`（Stack/ Split） |

## 2. 资源与引用

- 图片：`$r('app.media.<name>')`；字符串：`$r('app.string.<name>')`；颜色：`$r('app.color.<name>')` 或 `ResourceColor`。
- 系统资源：`$r('sys.media.xxx')` / `$r('sys.string.xxx')`（谨慎使用，随版本变化）。
- 格式化：`资源字符串 + %s/%d` 用 `$r('app.string.x', param)` 占位传参。

## 3. 高频报错速查

| 报错/现象 | 常见原因 | 修复 |
|---|---|---|
| `Cannot find name 'xxx'` | 未 import / 拼写错误 | 先查官方文档确认目标 SDK 对应的 Kit 与导出符号，再补 `@kit.*` import |
| 资源找不到（编译/运行） | `$r('app.media.xxx')` 名称与 resources 不一致 | 核对 `resources/base/media` 文件名与引用 |
| `Property 'xxx' does not exist` | 组件不支持该属性/方法 | 查官方文档确认 API 名与版本 |
| 页面空白/路由失败 | `main_pages.json` 未注册 / pages 路径错 | 核对 `resources/base/profile/main_pages.json` 与 `router.pushUrl` 的 url |
| 状态不刷新 | 修改了非 @State 的普通字段 / 对象属性未观测 | V1：@State/@Observed+@ObjectLink；V2：@Local/@Trace |
| 布局错乱 | 未设主轴对齐/未用 Flex | 检查 `justifyContent/alignItems`、外层容器宽度 |

## 4. 常用模式片段

**列表加载态**：
```ts
if (this.loading) { LoadingProgress().width(32) }
else if (this.items.length === 0) { Text('暂无数据').fontColor($r('app.color.gray')) }
else { List() { ForEach(this.items, (it) => { ListItem() { /* row */ } }, (it) => it.id) } }
```

**输入校验**：
```ts
TextInput({ placeholder: '请输入', text: this.input })
  .onChange((v) => { this.input = v })
Button('提交').enabled(this.input.trim().length > 0).onClick(() => { /* submit */ })
```

**导航返回**：`router.back()`（router 模式）或 `this.getUIContext().getRouter()...`（组件内）。

## 5. 原则

- 先确认工程的 SDK 版本与状态管理风格（V1/V2），再选 API 写法。
- 速查表没有的 API：走 hmos-doc-research 流程，禁止臆造。
- 写完后 `dcli__lsp_check` 验证。
