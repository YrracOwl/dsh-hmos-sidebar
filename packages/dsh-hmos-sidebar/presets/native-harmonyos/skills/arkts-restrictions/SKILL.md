---
name: arkts-restrictions
description: ArkTS 与 TypeScript 的高频差异清单：禁 any/unknown、对象字面量需具名类型、不支持解构与对象展开、不支持工具类型与索引签名等。写 .ets 代码前先加载，避免写出"合法 TS 但非法 ArkTS"的代码后被 LSP 反复打回。
---

# ArkTS 与 TypeScript 的差异

ArkTS 是 TypeScript 的受限子集。绝大多数"写得很顺但编译不过"的问题，都来自下面这份清单——
这些限制**无法从工程代码里推断**，只能事先知道，或者被 `dcli__lsp_check` 反复打回。

> 本清单覆盖高频项，不是完整规则表。规则随 SDK 版本演进，遇到清单之外的报错时用
> `dcli__api_lookup` 查 SDK 声明、`dcli__docs_search` 查「ArkTS 适配规则」原文，不要凭 TS 经验硬改。

## 1. 类型系统

| 规则 | 错误写法 | 正确写法 |
|---|---|---|
| **禁 `any` / `unknown`** | `function f(x: any)` | 写具体类型；确实未知时用 `Object` 或明确的联合类型 |
| **无结构化类型** | 直接传形状匹配的对象字面量 | 先声明 `interface` / `class`，再按该类型构造 |
| **对象字面量必须可推断到具名类型** | `const o = { a: 1 }` 后当 `SomeType` 用 | `const o: SomeType = { a: 1 }` |
| **不支持 TS 工具类型** | `Partial<T>` / `Pick<T,K>` / `Omit<T,K>` / `Readonly<T>` | 手写一个专用类型，或用 `Record<K,V>` |
| **不支持映射类型 / 条件类型** | `{ [K in keyof T]: ... }`、`T extends U ? X : Y` | 展开成具体类型，或用泛型 + 重载 |
| **不支持交叉类型** | `A & B` | 合并成一个 interface，或用继承 |
| **接口不能有构造签名** | `interface F { new (): T }` | 用工厂函数或 class |
| **不支持 `as const`** | `const x = [...] as const` | 显式声明只读类型 |

## 2. 语法结构

| 规则 | 错误写法 | 正确写法 |
|---|---|---|
| **不支持解构** | `const { a, b } = obj`、`const [x, y] = arr` | `const a = obj.a; const b = obj.b` |
| **对象展开不支持** | `{ ...obj, c: 1 }` | 逐字段赋值，或用 class 构造 |
| **数组展开仅限数组字面量与调用实参** | `f(...arr)` 可用；`[...a, ...b]` 视版本而定 | 不确定就用 `concat` 或 `push` |
| **不支持 `arguments`** | `function f() { arguments[0] }` | 用 rest 参数 `(...args: T[])` |
| **不支持 `eval`** | `eval(code)` | 无法替代，重构逻辑 |
| **不支持对属性 `delete`** | `delete obj.key` | 用 `Map` / `Record`，或置 `undefined` 并调整类型 |
| **不支持 `in` 运算符** | `if ('k' in obj)` | 用 `Object.keys(obj).includes('k')` |
| **不支持索引签名** | `interface D { [k: string]: string }` | `Record<string, string>` 或 `Map<string, string>` |
| **不支持独立 `this`** | 函数内直接用外层 `this` | 箭头函数，或显式传参 |
| **`Function` 类型不可用** | `let f: Function` | `let f: (a: number) => void` |
| **不支持多重继承** | `class C extends A, B` | 单继承 + interface 组合 |

## 3. 类与对象

- **字段必须初始化或在构造函数中赋值**；需要"稍后赋值"时声明为 optional（`x?: T`）或用确定值占位。
- **不能用 `apply` / `call` / `bind` 改变 `this`**（受限），需要时改写为普通函数参数传递。
- **`instanceof` 可用**，是运行时类型判断的推荐手段；`typeof` 只适合基本类型。
- 字典/映射场景优先 `Map<K,V>` 或 `Record<K,V>`，不要用对象字面量当哈希表。

## 4. 模块与工程

- **不能 import `.ts` 文件**：ArkTS 工程里源码是 `.ets`，共享代码放 `.ets` 或 `.d.ets` 声明文件。
- **不支持 `export =` / `import x = require()`**：统一用 ESM 语法 `export` / `import`。
- **不支持顶层可执行语句**：初始化逻辑放进函数，由入口调用。
- **资源引用走 `$r('app.media.xxx')` / `$r('app.string.xxx')`**，不要写文件路径字符串。

## 5. 自查流程

写完一批 `.ets` 后、构建之前：

```
dcli__lsp_check  (files: 本次改动的 .ets，projectPath: 工程根)
```

- 诊断清零再进构建。ArkTS 的限制会在 LSP 阶段就以明确规则名报出（如 `arkts-no-any-unknown`）。
- 报错信息里带规则名时，按规则名对照本清单；清单里没有的，用 `dcli__docs_search` 查规则名原文。
- 不要为了消除诊断而加 `any` 或 `@ts-ignore` —— ArkTS 不支持这两条退路，只会把错误推到构建期。

## 6. 与 ArkUI 的关系

状态管理与组件语法见 `arkui-state`，高频 API 见 `arkui-api-quickref`。本技能只管**语言层**
限制：同一段逻辑用 TS 写得出来不代表 ArkTS 能编译。
