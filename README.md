# dsh-hmos-sidebar

面向 DeepSeek Harness 的原生 HarmonyOS 开发套件，包含：

- **HarmonyOS 工作台插件**：在 DSH Web 中提供悬浮面板、构建、部署、设备、日志、截图和工程探测功能。
- **41 个 `dcli__*` 工具**：供 Agent 执行构建、LSP 检查、设备控制、UI 自动化、文档查询和签名配置等任务。
- **原生鸿蒙开发预设**：提供 HarmonyOS 专家 Persona、开发流程和配套 Skills。
- **梁神模式原生鸿蒙预设**：在梁神模式晋升后启用相同的 HarmonyOS 工具链。

> 仅支持 Windows。需要已安装 DeepSeek Harness；HarmonyOS 构建和设备能力还需要 DevEco Studio、HarmonyOS SDK，以及按需安装的 deveco-cli。

## 仓库结构

```text
packages/dsh-hmos-sidebar/          DSH 插件和 41 个 dcli__* 工具
presets/native-harmonyos/           “原生鸿蒙开发”预设及 Skills
presets/liangshen-native-harmonyos/ “梁神模式-原生鸿蒙开发”预设
```

## 安装

### 1. 克隆仓库

```powershell
git clone https://github.com/YrracOwl/dsh-hmos-sidebar.git
cd dsh-hmos-sidebar
```

### 2. 安装插件

将插件安装到需要使用的 DSH Profile。以下示例使用 `web`：

```powershell
dsh plugin --profile web add .\packages\dsh-hmos-sidebar
```

安装后重启该 Profile 对应的 DSH Web 进程，再打开或刷新 DSH Web 页面。

插件会同时挂载：

- Host 端 `/hmos/api/*` 动作级 RPC
- DSH Web 的 HarmonyOS 悬浮工作台

`dcli__*` 模型工具不会全局注册，只有安装下方预设并选择相应预设的 Agent 才会看到这些工具。

### 3. 安装预设

DSH 用户预设目录为：

```text
${DSH_HOME:-$HOME/.dsh}/.agent-presets/
```

Windows 默认通常对应：

```text
%USERPROFILE%\.dsh\.agent-presets\
```

安装“原生鸿蒙开发”预设：

```powershell
$presetRoot = if ($env:DSH_HOME) {
  Join-Path $env:DSH_HOME '.agent-presets'
} else {
  Join-Path $HOME '.dsh\.agent-presets'
}

New-Item -ItemType Directory -Force $presetRoot | Out-Null
Copy-Item -Recurse .\presets\native-harmonyos (Join-Path $presetRoot 'native-harmonyos')
```

可选安装“梁神模式-原生鸿蒙开发”预设：

```powershell
Copy-Item -Recurse .\presets\liangshen-native-harmonyos (Join-Path $presetRoot 'liangshen-native-harmonyos')
```

如果目标目录已经存在，请先备份并人工合并，不要直接覆盖已有的本地定制。

安装预设后重启 DSH Profile，并在新建会话时选择：

- `原生鸿蒙开发`
- `梁神模式-原生鸿蒙开发`

预设中的 `tool-hmos-tools` 引用 `dsh-hmos-sidebar/tools`，因此必须先完成插件安装。

## 环境配置

插件会在每次调用时动态探测本机环境，不需要把个人绝对路径写入仓库。需要覆盖自动探测结果时，可在启动 DSH 的本机环境中设置：

| 环境变量 | 用途 |
| --- | --- |
| `DEVECO_CLI_PATH` | deveco-cli 的 `dist/cli.js` 路径 |
| `DEVECO_HOME` | DevEco Studio 安装目录 |
| `DEVECO_SDK_HOME` | HarmonyOS SDK 目录 |
| `PROJECT_PATH` | 默认 HarmonyOS 工程根目录 |

插件也可以从 DevEco Studio 和常见 Windows 安装位置自动发现相关工具。

## 主要能力

### DSH Web 工作台

- HarmonyOS 工程与环境探测
- Debug/Release 构建与清理
- HAP 产物查看、安装和启动
- 真机与模拟器列表
- 设备日志、崩溃日志和截图
- 41 个 `dcli__*` 工具参数速查
- 非鸿蒙工作区自动隐藏悬浮球等安静模式设置

### Agent 工具链

- ArkTS/C/C++ LSP 静态检查
- hvigor 工程同步和构建
- HAP 安装、Ability 启动和设备日志
- UI 布局读取、点击、滑动、文本输入和截图验证
- HarmonyOS SDK API 与本地文档查询
- 双签名配置预览与安全写入
- HarmonyOS 工程 `AGENTS.md` 生成和更新

## 更新与卸载

更新本地 checkout 后，重新安装插件并重启对应 DSH Profile：

```powershell
git pull
dsh plugin --profile web add .\packages\dsh-hmos-sidebar
```

卸载插件：

```powershell
dsh plugin --profile web remove dsh-hmos-sidebar
```

预设可通过删除对应的用户预设目录卸载；请先确认其中没有需要保留的本地修改。

## 开发验证

```powershell
cd packages\dsh-hmos-sidebar
npm install
npm test
node --check lib/index.js
node --check lib/client.js
node --check lib/dcli-tools.mjs
node --check lib/environment.js
node --check lib/dual-signing.js
npm pack --dry-run
```

## License

插件代码使用 [MIT License](packages/dsh-hmos-sidebar/LICENSE)。第三方来源与改编说明见各预设目录中的 `NOTICE`。
