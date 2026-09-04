# dsh-hmos-sidebar

## English

**Current release: 0.3.3** — includes the legacy-host startup fix: optional Remote capability detection no longer blocks older DSH releases.

A Windows-only HarmonyOS development workbench for DeepSeek Harness Web. One package bundles the Host RPC, 41 `dcli__*` tools, floating Web UI, and two installable HarmonyOS agent presets: `native-harmonyos` and `liangshen-native-harmonyos`. The Liangshen preset uses a capability-detected compatibility layer: DSH 0.1.2+ uses `session.snapshotEvents()`, while older RC releases fall back to `session.events`.

Install with `dsh plugin --profile web add dsh-hmos-sidebar`, then run `npx --yes dsh-hmos-sidebar install-presets`. Windows only; restart the DSH Web Profile after installation.

## 中文

> 0.3.2 兼容层：按能力检测选择 DSH 0.1.2 的 `session.snapshotEvents()` 或旧版 `session.events`，避免「梁神+鸿蒙」预设在会话回合启动时因 API 变更崩溃；并明确声明支持 DSH 0.1.2-rc.1。

HarmonyOS 开发工作台（DSH Web 悬浮窗，**Windows-only**）。一个 npm 包 = Host RPC + 41 个 `dcli__*` 模型工具 + 浏览器悬浮 UI。**工具、界面、命令通道单一分发单元**。

> ⚠️ 平台：**Windows-only**（`package.json` 的 `"os": ["win32"]`、cordis.patch.yml 与本文一致）。不提供 POSIX/Linux/macOS 支持。npm 对 `os` 不匹配会 **EBADPLATFORM 硬拒**安装；若用 git/link 绕过，工具模块（`./tools`）在非 win32 上**不注册任何 `dcli__*`**（运行时守卫 `toolsSupportedOn`），host RPC 仍会挂载但各动作返回缺 CLI 的可操作错误。

在 DSH Web 页面右下角提供一个**可拖动的悬浮球**（手机图标），点击展开非模态面板，分四个 Tab：

默认**安静模式**（v0.3+）：当前工作区未探测到鸿蒙工程时不展示悬浮球，也绝不自动展开弹窗；探测到鸿蒙工程时显示悬浮球。两类行为都可在 **设置 → 插件 → HarmonyOS 工作台** 调整（见下文）。

| Tab | 功能 |
| --- | --- |
| 构建 | 环境检测（deveco-cli / DevEco Studio / json5 / hvigor，缺失可一键安装或跳官方下载页）、工程目录与 bundleName、构建 Debug/Release、清理、同步（hvigor）、HAP 包信息查看（含格式化原始 JSON） |
| 部署 | HAP 产物下拉（自动探测并排序）、部署设备下拉（已连接真机/模拟器）、安装 HAP、启动应用 |
| 设备 | 已连接设备列表、设备日志/崩溃日志、屏幕截图（默认路径由 host 提供） |
| 速查 | 41 个 `dcli__*` 命令速查（搜索过滤、参数/必填/枚举） |

弹窗标题显示 **bundleName + 工程应用图标 + 版本号**；面板位置/大小、悬浮球位置均有记忆。

## 设置 → 插件：HarmonyOS 工作台

插件在官方「设置 → 插件」页注册一张可展开的设置卡片（设置命名空间 `hmos-sidebar`），两个开关默认均为**开**（安静模式）：

| 配置 | 默认 | 行为 |
| --- | --- | --- |
| 默认不展开弹窗（`popup.keepCollapsed`） | 开 | 即使当前工作区探测到鸿蒙工程也不自动展开面板；关闭后，探测到鸿蒙工程时自动展开一次 |
| 在非鸿蒙工作区，默认不展示悬浮球（`ball.hideWithoutProject`） | 开 | 当前工作区未探测到鸿蒙工程则隐藏悬浮球（探测完成前同样隐藏）；关闭后悬浮球始终显示 |

- 开关通过官方 settings 服务持久化（保存/放弃修改/恢复默认/只读提示与官方卡片一致），客户端经 `settingsScope` 实时订阅生效。
- 设置服务不可用时整体回退到上表默认值，主功能不受影响。

## 工具与 RPC 的分离

- **41 个 `dcli__*` 模型工具**：由**预设单独挂载**，不再由主入口全局注册。包导出 `./tools` → `lib/dcli-tools.mjs`，预设以文件插件形式 `insert` 挂载即可。工具在**每次调用时动态解析环境**（`lib/environment.js`），CLI 缺失不阻止插件挂载，真正调用时才会报「可操作错误」；安装好 deveco-cli 后**无需重启 DSH** 即可识别。
- **主入口 `lib/index.js`**：只服务浏览器 RPC `/hmos/api/*`，不注册任何模型工具。RPC 只暴露动作级方法，不接受任意 argv。

## 安装

### 从 npm 安装（推荐）

```powershell
dsh plugin --profile web add dsh-hmos-sidebar
```

### 从 GitHub 源码安装

克隆本仓库后，在仓库根目录执行：

```powershell
dsh plugin --profile web add .\packages\dsh-hmos-sidebar
```

官方 `dsh plugin add` 会自动完成：登记依赖 → 识别包内 `dsh.bundle.patch` → 注册进 `dsh.profile.bundles`（host 半 + client 半一起挂载）。安装后重启对应的 DSH Web Profile。卸载：`dsh plugin --profile web remove dsh-hmos-sidebar`。

> 41 个 `dcli__*` 工具需由包内的 `native-harmonyos` 或 `liangshen-native-harmonyos` 预设通过 `./tools` 单独挂载；主插件不会向所有 Agent 全局注册工具。

安装插件后，运行预设安装器（默认安装两个预设）：

```powershell
npx --yes dsh-hmos-sidebar install-presets
```

可先执行 `npx --yes dsh-hmos-sidebar install-presets --dry-run` 查看目标路径；已有同名预设时默认拒绝覆盖。确认替换可加 `--force`，安装器会先备份原目录。也可用 `--preset native-harmonyos` 只安装一个预设。完成后重启 DSH Profile。

包内直接依赖仅 `@modelcontextprotocol/sdk`。`@deepseek-ai/dsh-tools` 是 DSH 共享宿主包，声明为可选 `peerDependency`，不随插件单独安装，避免在插件内复制并遮蔽宿主版本；`./tools` 入口仅在 DSH 宿主提供该包时使用。

包为 **ESM-only**（`"type":"module"`，exports 无 `require` 条件）：Node ≥22.12 可原生 `require()`，更早版本 `require` 会 `ERR_REQUIRE_ESM`；`engines` 要求 Node ≥18（`npm test` 使用 `node --test`，Node 18 兼容，自动发现 `test/*.test.mjs`）。`./client` 导出是浏览器专用 bundle，**不可在 Node 中 import**。

依赖脚本白名单：pnpm 11 若拦构建脚本，参照 dsh-better-sidebar 的安装脚本在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds` / `minimumReleaseAgeExclude`；npm 12 若报 `EALLOWSCRIPTS`，是 `@modelcontextprotocol/sdk`→express 传递依赖的 `prepare` 脚本被 `allow-scripts` 白名单拦下，把相关包（`path-to-regexp content-type eventsource express-rate-limit ip-address`）加进 `~/.npmrc` 的 `allow-scripts`，或直接走官方 `dsh plugin add` 的安装流程。

## 配置

`lib/environment.js` 统一解析 cli / DevEco Studio / hdc / hvigor / json5 / 工程根，优先级 **config → 环境变量 → 常见安装位置探测**，**每次调用实时解析**（不缓存，安装/变更路径后无需重启）。全部字段可省略。

| 字段 | 说明 | 缺省行为（探测源） |
| --- | --- | --- |
| `cliPath` | deveco-cli 入口（dist/cli.js） | 环境变量 `DEVECO_CLI_PATH` → `%APPDATA%\npm\node_modules\@deveco\deveco-cli\dist\cli.js` 等常见位置 |
| `projectPath` | Host 默认鸿蒙工程根 | 环境变量 `PROJECT_PATH` → Host 进程 cwd；Web 浮窗会优先传当前 GUI session 的 cwd |
| `devEcoHome` | DevEco Studio 安装目录 | `DEVECO_HOME` → `DEVECO_SDK_HOME` 父目录 → 常见安装路径（`C:\Program Files\Huawei\DevEco Studio` 等） |
| `projectRoots` | 当前工作区以外的附加工程发现根目录列表 | 默认**空**；Web 浮窗仍会有界递归扫描当前 GUI session 的 cwd |
| `screenshotDir` | 截图默认保存目录 | 工程下 `.dsh-screenshots` → OS 临时目录 `dsh-hmos-screenshots` |

> 包内**不硬编码任何个人绝对路径**。Web 浮窗通过官方 `shell.overlay` Slot 的 `useSessions` 标准属性取得当前 session cwd，并在首次挂载或切换会话时重新探测；若 cwd 是工程父目录，会跳过依赖/构建目录并进行有界递归查找。`projectRoots` 仅用于补充扫描当前工作区以外的位置。

## RPC 动作级方法

`POST /hmos/api/<method>`，JSON body。**不再接受任意 argv**（删除了旧 `hmos/run` / `hmos/hdc`）：

| 方法 | 动作 | 主要参数 |
| --- | --- | --- |
| `hmos/info` | 环境信息 | — |
| `hmos/install-cli` | 安装 deveco-cli | — |
| `hmos/tools` | dcli 工具速查清单 | — |
| `hmos/devices` | 已连接设备列表 | — |
| `hmos/probe` | 工程探测（bundleName/HAP 产物） | `path` |
| `hmos/app-icon` | 应用图标 | `path` |
| `hmos/hap-info` | HAP 包信息 | `path` |
| `hmos/sync` | hvigor 同步 | `product`,`buildMode` |
| `hmos/build` | 构建 | `buildMode` (`debug`/`release`) |
| `hmos/clean` | 清理构建产物 | — |
| `hmos/logs` | 设备日志 | `device`,`crash`,`tail` |
| `hmos/screenshot` | 屏幕截图 | `device`,`path`,`display` |
| `hmos/start` | 启动应用 | `bundleName`,`device`,`abilityName` |
| `hmos/install` | 安装 HAP | `hapPath`,`device`,`bundleName` |

安全边界：请求体上限 **64KiB**（超限 413）、非法 JSON **400**、方法未注册 404、非 POST 405、**同源 fence**（loopback + http/https origin 与 Host 头完全一致，跨站拒绝）。

路径围栏：可信根只取**显式来源**——`config.projectPath`、环境变量 `PROJECT_PATH`、`config.projectRoots`（`process.cwd()` 兜底不作为可信根）。配置了可信根时，`hmos/install`（hapPath）、`hmos/hap-info`（path）、`hmos/screenshot`（path，含默认/配置目录生成的路径）的目标必须落在可信根内，否则拒绝；围栏用 `path.win32.resolve` + `realpath`/最近存在父目录策略，拒绝 `C:\proj\..\outside\x.hap`、UNC `..` 逃逸与 junction/reparse point 逃逸。未配置可信根时保持后缀+存在校验。`hmos/logs` 的 `tail` 钳制在 1..10000。数据披露：`hmos/info` / `hmos/devices` / `hmos/screenshot` 会向页面返回本机绝对路径与设备序列号——仅同源页面（用户本人）可见，README 在此明示。

## 结构

```
lib/
  index.js         Host 半：webServer 路由 /hmos/api/*（动作级 RPC）+ loopback fence + 64KiB 限制
  dcli-tools.mjs   ./tools 导出点：41 个 dcli__* 工具子模块（含 managed-markers AGENTS 生成）
  environment.js   共享环境解析：cli/Studio/hdc/hvigor/json5/projectRoots（config→env→探测，动态）
  client.js        Client 半（web）：悬浮球 + 面板 UI（Shadow DOM，独立于 better-sidebar；层叠走官方 shell.overlay 层，可覆盖 shell 内容，菜单/dialog/toast 等更高 overlay 仍覆盖面板，禁止极端 z-index）+ 官方「设置 → 插件」设置卡片
cordis.patch.yml   bundle patch（insert 行，无个人配置，Windows-only）
test/              node:test 单测（环境解析 / CLI 缺失挂载 / 工具定义 / managed AGENTS / RPC helper）
```

## 双签名配置（dcli__configure_dual_signing）

`dcli__configure_dual_signing` 为工程根 `build-profile.json5` 合并 release（默认 `default`）与 debug 双签名、products 和模块 target 映射：

- 默认 `apply=false`，只校验材料并返回变更预览；`apply=true` 才写入。
- 写入前生成单份 `build-profile.json5.dsh-backup`，临时文件通过解析后再替换正式文件。
- `.p12` / `.p7b` / `.cer` 必须存在且后缀正确；`signAlg` 固定为 `SHA256withECDSA`。
- 密码只写入目标配置，不在工具结果或错误中回显；备份同样包含签名配置，必须与正式文件按同等敏感级别保护且不得提交。
- 指定 `modules` 时为这些应用模块拆 release/debug targets；省略时优先处理 `entry`，其他模块复用现有 target 到两个 products。
- 当前版本写入时会把文件规范化为双引号、2 空格缩进；原始文本保存在备份中。

## AGENTS.md（dcli__agents_md）

`dcli__agents_md` 生成/刷新工程根 `AGENTS.md`，以 **managed markers** 区分托管区与用户区：

```markdown
<!-- DSH-HMOS-MANAGED:START -->
自动生成的事实：概览、模块、SDK、常用命令、结构约定、签名与构建
<!-- DSH-HMOS-MANAGED:END -->
```

- 默认 `apply=false`，只返回事实摘要和变更规模；`apply=true` 才写入。
- 只替换 marker 之间的托管块；marker 之外的用户内容在每次刷新时**原样保留**。首次接管无 marker 的既有文件时保留全文并在末尾追加托管块。
- marker 缺失配对、重复或反序时拒绝写入，不猜测修复；实际写入前创建单份 `AGENTS.md.dsh-agents-backup`，再通过同目录临时文件原子替换。
- 事实（module/bundleName/product/SDK/页面）全部来自 `build-profile.json5` / `AppScope/app.json5` / `main_pages.json`，**不硬编码 debug/default/entry 产物路径**。
- 静态检查命令用 `dcli__lsp_check`（而非 `mcp__deveco__*`）。

## 开发维护

- 改 `lib/*.js` / `lib/*.mjs` 后需**重启 web** 生效（client bundle 由 web 按需服务）。
- 改动后跑：
  ```bash
  npm run test                 # node --test
  node --check lib/index.js lib/dcli-tools.mjs lib/environment.js
  npm pack --dry-run           # 校验打包内容
  ```
- 环境要求：deveco-cli（UI 可一键 npm 全局安装）、DevEco Studio（UI 引导官方下载页）、hdc 随 Studio SDK。工具与 RPC 均在调用时动态解析，CLI/Studio 装好后无需重启 DSH。
- 已知限制：LSP 检查走原生子进程实例池（`dcli__lsp_check`），不复用 MCP 通道。
- 参考：安装/卸载/挂载机制与 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)、[dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 一致（官方 `dsh plugin add`，识别 `dsh.bundle.patch` 自动挂载）。
