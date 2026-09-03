---
name: dcli-tools-reference
description: dcli 工具参数速查：41 个原生工具的完整参数、必填项、枚举与高频示例。构建、装真机、查日志、查 API 签名、查文档前先查本技能确认参数，避免臆造。
---

# dcli 工具参数速查（原生插件）

所有 dcli__* 工具均为原生注册的结构化工具，调用时直接传 JSON 参数；projectPath 默认当前会话工程，跨工程传真实工程根。

## 使用原则

- **多工程**：构建/安装/运行/日志类工具传 projectPath 指向要操作的真实工程根；单工程会话可省略（默认当前工程）。
- **真机安装**：只装 debug 签名包（entry-debug-signed.hap），勿装 default/release 签名包（报错 9568322）。
- **双 product 工程**：debug 调试签名 = product "debug" + modules "entry@debug"；发布 = product "default"。
- **hdc 类工具**（install_hap/start_app）与 api_lookup：需要 devEcoHome（解析链：patch config.devEcoHome → DEVECO_HOME → DEVECO_SDK_HOME 父目录 → 常见安装目录探测）；hapPath 传绝对路径。
- **查 API 统一入口**：dcli__api_lookup 一次查询 SDK .d.ts 精确签名（component/api/kits/arkts/hms 五区）+ 本地文档库命中，多源印证；文档全文用 dcli__docs_read（documentId 来自 docs_search）。
- **代码静态检查**用 dcli__lsp_check（常驻实例，可指定工程；卡死用 dcli__lsp_restart）；规范检查用 dcli__check_lint。

### `dcli__create_project`

脚手架创建新的 HarmonyOS 应用工程（devecocli create）。appName 必填；可指定工程目录、包名与 API 级别。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录路径（默认 ./<app-name>） |
| `appName` | **是** | string | 应用名称（必填） |
| `bundleName` | 否 | string | 包名，省略时自动推导为 com.example.<app-name> |
| `apiLevel` | 否 | string | API 级别（默认从 SDK 自动探测，最小 17） |

示例：```json
{
  "appName": "MyApp",
  "projectPath": "<project-root>"
}
```

### `dcli__sync_project`

同步指定工程（默认当前工程）：执行 hvigor --sync 工程同步。依赖变更后需先单独执行 ohpm install，再执行同步。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `product` | 否 | string | product 名（默认 default） |
| `buildMode` | 否 | string（debug/release） | 构建模式（默认 debug） |

示例：```json
{
  "projectPath": "<project-root>"
}
```

### `dcli__build_project`

编译构建指定工程（默认当前工程）并导出构建产物（devecocli build）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `product` | 否 | string | build-profile.json5 中定义的 product 名（默认 default） |
| `modules` | 否 | array | 要构建的模块（格式 module 或 module@target） |
| `buildMode` | 否 | string（debug/release） | 构建模式 debug/release（默认 debug） |

示例：```json
{
  "projectPath": "<project-root>",
  "product": "debug",
  "modules": [
    "entry@debug"
  ],
  "buildMode": "debug"
}
```

### `dcli__clean_project`

清理指定工程（默认当前工程）构建产物（devecocli build clean）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |

示例：```json
{
  "projectPath": "<project-root>"
}
```

### `dcli__run_app`

构建并把应用安装运行到指定工程/设备（devecocli run）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `device` | 否 | string | 目标设备名称或序列号 |
| `module` | 否 | array | 要运行的模块（module 或 module@target） |
| `ability` | 否 | string | 要启动的 Ability 名称 |
| `buildMode` | 否 | string（debug/release） | 构建模式 debug/release（默认 debug） |
| `uninstall` | 否 | boolean | 安装前卸载已存在的应用 |
| `skipBuild` | 否 | boolean | 跳过构建，直接部署现有产物 |

示例：```json
{
  "projectPath": "<project-root>",
  "device": "<device-serial>"
}
```

### `dcli__generate_signature`

自动生成应用签名材料并写入工程配置（devecocli signature generate）。需先 auth_status 确认已登录华为账号；调试签名缺失/失效时使用。

无参数。

### `dcli__configure_dual_signing`

预览或写入工程根 build-profile.json5 的 release+debug 双签名配置，并安全合并 products 与模块 targets。默认只预览；apply=true 时先备份再写入。密码字段不会回显。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `releaseStoreFile` | **是** | string | 发布签名 KeyStore 文件（.p12） |
| `releaseStorePassword` | **是** | string | 发布 KeyStore 的 DevEco 加密密码（仅写入配置，不回显） |
| `releaseKeyAlias` | **是** | string | 发布签名 keyAlias |
| `releaseKeyPassword` | **是** | string | 发布私钥的 DevEco 加密密码（仅写入配置，不回显） |
| `releaseProfile` | **是** | string | 发布 Profile 文件（.p7b） |
| `releaseCertpath` | **是** | string | 发布证书文件（.cer） |
| `debugStoreFile` | **是** | string | 调试签名 KeyStore 文件（.p12；可与发布签名共用） |
| `debugStorePassword` | **是** | string | 调试 KeyStore 的 DevEco 加密密码（仅写入配置，不回显） |
| `debugKeyAlias` | **是** | string | 调试签名 keyAlias |
| `debugKeyPassword` | **是** | string | 调试私钥的 DevEco 加密密码（仅写入配置，不回显） |
| `debugProfile` | **是** | string | 调试 Profile 文件（.p7b） |
| `debugCertpath` | **是** | string | 调试证书文件（.cer） |
| `releaseProduct` | 否 | string | 发布 product / signingConfig 名（默认 default） |
| `debugProduct` | 否 | string | 调试 product / signingConfig 名（默认 debug） |
| `modules` | 否 | array | 需要拆分 release/debug targets 的应用模块；省略时优先 entry，其他模块共享现有 target |
| `apply` | 否 | boolean | 是否实际备份并写入；默认 false，只返回预览 |

### `dcli__list_devices`

列出所有已连接设备（真机与模拟器，devecocli device list）。

无参数。

### `dcli__list_emulators`

列出 DevEco Studio 中可用的模拟器实例（devecocli emulator list）。

无参数。

### `dcli__device_info`

查看指定设备的详细信息（devecocli device view）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `device` | 否 | string | 设备名称或序列号 |

### `dcli__emulator_rotate`

旋转模拟器屏幕方向（devecocli emulator rotate）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `direction` | 否 | string（left/right） | 旋转方向：left / right |

### `dcli__emulator_power`

按下模拟器电源键（切换屏幕开关，devecocli emulator power）。

无参数。

### `dcli__emulator_shake`

触发模拟器摇一摇事件（devecocli emulator shake）。

无参数。

### `dcli__emulator_volume`

调整模拟器音量（devecocli emulator volume）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `direction` | 否 | string（up/down） | 音量方向：up / down |

### `dcli__emulator_start`

启动一个或多个模拟器实例（devecocli emulator start）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `names` | **是** | array | 要启动的模拟器名称（可多个） |

示例：```json
{
  "names": [
    "<emulator-name>"
  ]
}
```

### `dcli__emulator_stop`

停止一个或多个模拟器实例，支持名称或序列号（devecocli emulator stop）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `names` | **是** | array | 要停止的模拟器名称或序列号（可多个，如 127.0.0.1:5555） |

### `dcli__emulator_fold`

设置折叠屏模拟器展开状态（devecocli emulator fold）。open/half-open/close 通用；三折屏另有 single/double/triple 等。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `state` | **是** | string（open/half-open/close/vertical-open/single/double/triple/left-folded-right-half-folded/left-half-folded-right-expanded/left-expanded-right-folded/left-half-folded-right-folded/left-expanded-right-half-folded/left-half-folded-right-half-folded） | 折叠状态 |
| `target` | 否 | string | 目标模拟器名称或序列号 |

示例：```json
{
  "state": "open",
  "target": "<emulator-name>"
}
```

### `dcli__emulator_battery`

设置模拟器电池电量或充电状态（devecocli emulator battery）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `target` | 否 | string | 目标模拟器名称或序列号 |
| `level` | 否 | string | 电池电量 0-100（充电中 0-100，未充电 1-100） |
| `status` | 否 | string（charging/discharging） | 充电状态 |

### `dcli__emulator_sensor`

向模拟器注入传感器数据（devecocli emulator sensor）：光线/湿度/温度/步数/心率。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `target` | 否 | string | 目标模拟器名称或序列号 |
| `lightIntensity` | 否 | string | 光线强度 0-100000 |
| `humidity` | 否 | string | 湿度 0-100 |
| `temperature` | 否 | string | 温度 -273.1 到 100 |
| `steps` | 否 | string | 步数 0-10000 |
| `heartrate` | 否 | string | 心率 0-255 |

### `dcli__get_device_logs`

获取设备应用运行日志（devecocli log）。支持按级别/包名/关键词过滤与时间窗。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程；日志命令的 cwd） |
| `device` | 否 | string | 目标设备名称或序列号 |
| `level` | 否 | string（D/I/W/E/F） | 日志级别过滤：D/I/W/E/F |
| `bundleName` | 否 | string | 按应用包名过滤 |
| `keyword` | 否 | string | 关键词过滤 |
| `tail` | 否 | string | 只显示最近 N 行 |
| `from` | 否 | string | 从现在起往前的时间窗，如 30s / 5m / 2.5m |
| `crash` | 否 | boolean | 只获取崩溃日志 |

示例：```json
{
  "device": "<device-serial>",
  "bundleName": "<bundle-name>",
  "tail": "200"
}
```

### `dcli__docs_search`

在本地 HarmonyOS 文档库中按关键词检索文档（devecocli docs search）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `keywords` | **是** | array | 检索关键词（可多个） |
| `limit` | 否 | string | 结果数量上限（可选） |

示例：```json
{
  "keywords": [
    "@ComponentV2",
    "状态管理"
  ]
}
```

### `dcli__docs_read`

读取本地 HarmonyOS 文档全文（devecocli docs read，documentId 来自 docs_search 结果）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `documentId` | **是** | string | 文档 ID |

### `dcli__docs_catalog`

列出本地文档库的全部目录（devecocli docs catalog）。

无参数。

### `dcli__api_lookup`

ArkTS/ArkUI API 统一速查（多源印证）：按组件/接口/装饰器/Kit 名一次查询 SDK .d.ts 精确签名（component/api/kits/arkts/hms 五区）与本地文档库命中。写代码前查 API 用这一个工具即可。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `name` | **是** | string | 查询目标：组件（Button/TextInput）、接口（@ohos.arkui.UIContext）、装饰器（@ComponentV2）、Kit（@kit.ArkUI）、语言扩展（@arkts.collections）等 |
| `scope` | 否 | string（all/component/api/kits/arkts/hms/docs） | 查询范围（默认 all） |
| `maxResults` | 否 | string | 每个来源的结果上限（默认 5，最大 10） |

示例：```json
{
  "name": "TextInput",
  "scope": "component",
  "maxResults": "5"
}
```

### `dcli__agents_md`

生成/刷新工程根 AGENTS.md（DSH 每个会话首个 pre-step 自动注入项目上下文）：读 build-profile.json5 / module.json5 / main_pages.json 自动填充概览、模块、SDK、常用命令（含 dcli__api_lookup / docs / install_hap / start_app / check_lint）；托管块 <!-- DSH-HMOS-MANAGED:START/END --> 之间刷新重建，标记之外的自定义节自动保留。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |

### `dcli__auth_status`

查看 deveco-cli 当前登录的华为账号状态（devecocli auth status，只读）。

无参数。

示例：```json
{}
```

### `dcli__skills_find`

在 HarmonyOS 技能市场按关键词搜索可用技能（devecocli skills find）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `keyword` | **是** | string | 搜索关键词 |

### `dcli__skills_list`

列出 HarmonyOS 技能市场的全部可用技能（devecocli skills list）。

无参数。

### `dcli__update_cli`

升级全局 deveco-cli/工具链（devecocli update）。会修改本机安装，仅在用户明确要求升级时调用。

无参数。

### `dcli__check_lint`

运行 DevEco Code Linter 检查 TS/ArkTS 代码规范与性能规则（devecocli check lint）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `path` | 否 | string | 要检查的文件或目录（默认整个工程） |
| `fix` | 否 | boolean | 自动修复可修复的问题 |
| `product` | 否 | string | build-profile.json5 中的 product 名（默认 default） |

示例：```json
{
  "projectPath": "<project-root>",
  "path": "entry/src/main/ets"
}
```

### `dcli__check_compat`

检查源码对目标 SDK 版本的 API 兼容性（devecocli check compat）。需要 DevEco Studio 26.0.0.810+，低版本会报版本门槛错误。sourceVersion/targetVersion 必填。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `sourceVersion` | **是** | string | 当前工程 SDK 版本（如 6.1.0(23)） |
| `targetVersion` | **是** | string | 目标 SDK 版本（如 6.1.1(24)） |
| `modules` | 否 | array | 要检查的模块（默认全部） |
| `limit` | 否 | string | 显示的最大变更记录数（默认 100） |

示例：```json
{
  "projectPath": "<project-root>",
  "sourceVersion": "6.1.0(23)",
  "targetVersion": "6.1.1(24)"
}
```

### `dcli__check_compat_versions`

列出可用于兼容性检查的目标 SDK 版本（devecocli check compat versions）。需要 DevEco Studio 26.0.0.810+。

无参数。

### `dcli__lsp_check`

LSP 静态语法检查：按工程常驻诊断实例，对 files（相对工程根）做 ArkTS/C/C++ 诊断。修改 .ets / C/C++ 后用它验证，诊断清零再继续；实例未启动时首次调用自动创建（初始化约 10-60s）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `files` | **是** | array | 要检查的源码文件（相对工程根，如 entry/src/main/ets/pages/Index.ets；工程内绝对路径也可） |
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |

### `dcli__lsp_restart`

重启指定工程的 LSP 实例：重新 sync 工程 + 初始化 LSP。LSP 卡死或工程结构变化后用；未启动的工程返回提示。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `projectPath` | 否 | string | 工程目录（默认当前会话工程） |
| `target` | 否 | string（all/arkts/cpp） | 重启范围（默认 all） |

### `dcli__start_app`

在指定真机/模拟器上启动已安装的应用（hdc aa start）。需应用已安装（dcli__install_hap 装 debug 签名包）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `bundleName` | **是** | string | 应用包名 |
| `abilityName` | 否 | string | Ability 名称（默认 EntryAbility） |
| `moduleName` | 否 | string | 模块名（多模块应用需要，如 entry） |
| `device` | 否 | string | 目标设备序列号（默认唯一在线设备） |

示例：```json
{
  "bundleName": "<bundle-name>",
  "moduleName": "entry",
  "device": "<device-serial>"
}
```

### `dcli__install_hap`

用 hdc 直连安装 HAP 到真机/模拟器（force-stop → 传输 → bm install）。真机调试必须装 debug 签名包（如 entry-debug-signed.hap）；装 default/release 签名包可能报错 9568322。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `hapPath` | **是** | string | HAP 文件绝对路径（debug 产物如 entry/build/debug/outputs/debug/entry-debug-signed.hap） |
| `device` | 否 | string | 目标设备序列号（默认唯一在线设备） |
| `bundleName` | 否 | string | 安装前 force-stop 的应用包名（如 <bundle-name>） |

示例：```json
{
  "hapPath": "<project-root>/entry/build/debug/outputs/debug/entry-debug-signed.hap",
  "device": "<device-serial>",
  "bundleName": "<bundle-name>"
}
```

### `dcli__ui_screenshot`

截取设备屏幕保存为 PNG（devecocli ui screenshot）。配合 read_image 看图做 UI 验证：操作后截图取证，用 read_image 判断界面是否符合预期。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `path` | **是** | string | PNG 文件保存路径（目录或文件，必须可写，如 <output-dir>/shot1.png） |
| `device` | 否 | string | 目标设备名称或序列号（多设备时必填） |
| `display` | 否 | string | 目标 display id（省略为默认屏） |

### `dcli__ui_layout`

检查设备屏幕 UI 节点树（devecocli ui layout）：查看控件结构/层级/坐标，配合 ui click --id 定位操作、验证界面元素存在。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `device` | 否 | string | 目标设备名称或序列号 |
| `id` | 否 | string | 布局节点 id（只查该节点） |
| `depth` | 否 | string | 树深度限制（0=无限，1=仅根，2=根+子；默认 0） |
| `format` | 否 | string（default/json） | 输出格式（json 便于解析） |
| `mode` | 否 | string（full/simplified） | 输出模式（默认 simplified） |

### `dcli__ui_click`

在设备屏幕点击（devecocli ui click）：传 x/y 坐标，或传 id 自动解析节点中心坐标（节点 id 来自 dcli__ui_layout）。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `device` | 否 | string | 目标设备名称或序列号 |
| `x` | 否 | string | X 坐标（与 y 一起传，或改传 id） |
| `y` | 否 | string | Y 坐标（与 x 一起传，或改传 id） |
| `id` | 否 | string | 布局节点 id（自动解析为中心坐标；与 x/y 二选一） |
| `window` | 否 | string | 目标 window id（与 id 配合使用） |

### `dcli__ui_swipe`

在设备屏幕滑动（devecocli ui swipe）：起点 (x1,y1) 到终点 (x2,y2)。用于列表滚动、翻页等操作验证。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `x1` | **是** | string | 起点 X 坐标 |
| `y1` | **是** | string | 起点 Y 坐标 |
| `x2` | **是** | string | 终点 X 坐标 |
| `y2` | **是** | string | 终点 Y 坐标 |
| `device` | 否 | string | 目标设备名称或序列号 |

### `dcli__ui_text`

在设备屏幕输入文本（devecocli ui text）：不传坐标时输入到当前聚焦输入框；传 x/y 指定目标位置。

| 参数 | 必填 | 类型/约束 | 说明 |
|---|---|---|---|
| `text` | **是** | string | 要输入的文本 |
| `x` | 否 | string | 目标 X 坐标（可选，不传则输入到当前聚焦输入框） |
| `y` | 否 | string | 目标 Y 坐标（可选） |
| `device` | 否 | string | 目标设备名称或序列号 |
