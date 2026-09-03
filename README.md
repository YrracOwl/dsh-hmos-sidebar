# DSH HarmonyOS Developer Pack

用于分发两个可选组件：

- `packages/dsh-hmos-sidebar`：Windows-only DSH Web 插件，提供 HarmonyOS 工作台悬浮面板、Host RPC 和 41 个 `dcli__*` 工具。
- `presets/native-harmonyos`：原生鸿蒙开发专家预设。
- `presets/liangshen-native-harmonyos`：梁神模式 + 原生鸿蒙工具链预设。

> 本仓库不包含 HarmonyOS 工程、签名材料、设备数据、DSH 用户数据或本机安装产物。

## 安装插件

在 Windows、Node.js >= 18 的 DSH 环境中，从 GitHub checkout 后：

```powershell
# 在插件包目录执行
cd packages/dsh-hmos-sidebar
npm install
npm test
npm pack --dry-run

# 安装到 DSH Web profile（将路径替换为本机 checkout 路径）
dsh plugin --profile web add .
```

也可以发布到 npm 后直接安装：

```powershell
npm publish
dsh plugin --profile web add dsh-hmos-sidebar
```

插件有意声明为 Windows-only；Linux/macOS 会被 npm 平台检查拒绝。

## 安装原生鸿蒙预设

预设不是 npm 插件，而是 DSH 用户级 preset。将对应目录复制到：

```text
${DSH_HOME:-$HOME/.dsh}/.agent-presets/<preset-id>/
```

例如 PowerShell：

```powershell
$target = "$HOME\.dsh\.agent-presets"
Copy-Item -Recurse .\presets\native-harmonyos "$target\native-harmonyos"
# 如果目标已存在，请先备份并人工合并，不要直接覆盖本地定制
```

然后重启 DSH profile，在 preset picker 中选择“原生鸿蒙开发”。两个预设中的 `customSkillDirs` 使用相对 `baseUrl` 的路径，不依赖发布者机器路径。

### 预设依赖插件包

预设的 `tool-hmos-tools` 行引用 `dsh-hmos-sidebar/tools`。因此先把插件安装到同一 DSH profile，再启用预设。预设不会携带 CLI、DevEco Studio、华为账号登录态或签名文件。

## 环境变量

插件运行时动态解析本机环境，可按需设置：

- `DEVECO_CLI_PATH`
- `DEVECO_HOME`
- `DEVECO_SDK_HOME`
- `PROJECT_PATH`

不要把这些变量的真实值提交到仓库；可在本机 shell/profile 中设置。

## 安全与隐私边界

- 不提交 `local.properties`、`.env*`、HAP/APP 和 `.p12/.p7b/.cer`。
- `build-profile.json5` 只属于 HarmonyOS 工程，不应从用户工程复制进本仓库；尤其不要提交 `storePassword` / `keyPassword` 或签名备份。
- 工具的双签名流程默认 preview-only，密码不会回显；只有用户明确传入 `apply: true` 才改写用户工程。
- Host RPC 仅 action-level、POST-only、同源/loopback fence，且不接受任意 argv。
- 提交前请运行 secret scanner（例如 GitHub secret scanning、gitleaks 或 trufflehog）；历史提交也必须扫描。

## 发布前检查

```powershell
cd packages/dsh-hmos-sidebar
npm test
node --check lib/index.js
node --check lib/client.js
node --check lib/dcli-tools.mjs
node --check lib/environment.js
node --check lib/dual-signing.js
npm pack --dry-run
```

另外确认：

1. `git status --ignored` 中没有误纳入 node_modules、artifacts、签名文件或用户工程。
2. `git diff --check` 通过。
3. 远程仓库使用 HTTPS/SSH，GitHub Actions 不把 secrets 打印到日志。
4. 首次公开发布建议先创建 private repository，完成审阅后再切换 visibility。

## License

插件代码沿用 MIT；仓库根目录的组合文档按仓库维护者选择的许可证发布。请在公开仓库中补充贡献者、第三方声明和联系方式。
