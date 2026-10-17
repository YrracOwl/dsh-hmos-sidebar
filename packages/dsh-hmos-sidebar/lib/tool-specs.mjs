// tool-specs.mjs — the dcli__* TOOL TABLE, kept free of any DSH host package.
//
// `lib/dcli-tools.mjs` (the `./tools` subpath) needs `@deepseek-ai/dsh-tools`
// for `defineTool`, and that package only exists inside a DSH installation. The
// HOST half (`lib/index.js`) does not define tools at all — it only serves the
// 「速查」 panel, which renders this same table. Importing the table from
// `dcli-tools.mjs` therefore dragged `dsh-tools` into the host half's module
// graph: a missing or unresolvable peer took down the whole sidebar, not just
// the model tools, and the failure surfaced as an unrelated
// `ERR_MODULE_NOT_FOUND` at boot.
//
// This module is plain data plus `validate.js` (itself dependency-free), so both
// halves can import it. `dcli-tools.mjs` re-exports `TOOLS` to keep its own
// public surface — and every existing test — unchanged.

import { validateBundleName, validateSafeName } from './validate.js'
function s(description, extra) { return { type: 'string', description, ...extra } }
function sArr(description) { return { type: 'array', items: { type: 'string' }, description } }

// 工具表：name/description/parameters/buildArgs/kind（默认 cli，hdc 走 hdc 五步）/timeoutMs
export const TOOLS = [
  {
    name: 'dcli__create_project',
    description: '脚手架创建新的 HarmonyOS 应用工程（devecocli create）。appName 必填；可指定工程目录、包名与 API 级别。',
    parameters: {
      projectPath: s('工程目录路径（默认 ./<app-name>）'),
      appName: { type: 'string', required: true, description: '应用名称（必填）' },
      bundleName: s('包名，省略时自动推导为 com.example.<app-name>'),
      apiLevel: s('API 级别（默认从 SDK 自动探测，最小 17）'),
    },
    timeoutMs: 300000,
    buildArgs(a) {
      if (typeof a.appName !== 'string' || !a.appName.trim()) throw new Error('appName is required（create 必须提供应用名）')
      const out = ['create']
      if (a.projectPath) out.push('--project-path', a.projectPath)
      out.push('--app-name', a.appName)
      if (a.bundleName) out.push('--bundle-name', a.bundleName)
      if (a.apiLevel) out.push('--api-level', a.apiLevel)
      return out
    },
  },
  {
    name: 'dcli__sync_project',
    kind: 'hvigor',
    description: '同步指定工程（默认当前工程）：执行 hvigor --sync 工程同步。依赖变更后需先单独执行 ohpm install，再执行同步。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      product: s('product 名（默认 default）'),
      buildMode: { type: 'string', enum: ['debug', 'release'], description: '构建模式（默认 debug）' },
    },
    timeoutMs: 600000,
    buildArgs(a) {
      return ['--sync', '-p', 'product=' + (a.product || 'default'), '-p', 'buildMode=' + (a.buildMode || 'debug'), '--analyze=normal', '--parallel', '--incremental']
    },
  },
  {
    name: 'dcli__build_project',
    description: '编译构建指定工程（默认当前工程）并导出构建产物（devecocli build）。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      product: s('build-profile.json5 中定义的 product 名（默认 default）'),
      modules: sArr('要构建的模块（格式 module 或 module@target）'),
      buildMode: { type: 'string', enum: ['debug', 'release'], description: '构建模式 debug/release（默认 debug）' },
    },
    timeoutMs: 600000,
    buildArgs(a) {
      const out = ['build']
      if (a.product) out.push('--product', a.product)
      if (a.modules && a.modules.length) out.push('--modules', ...a.modules)
      if (a.buildMode) out.push('--build-mode', a.buildMode)
      return out
    },
  },
  {
    name: 'dcli__clean_project',
    description: '清理指定工程（默认当前工程）构建产物（devecocli build clean）。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
    },
    timeoutMs: 120000,
    buildArgs() { return ['build', 'clean'] },
  },
  {
    name: 'dcli__run_app',
    description: '构建并把应用安装运行到指定工程/设备（devecocli run）。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      device: s('目标设备名称或序列号'),
      module: sArr('要运行的模块（module 或 module@target）'),
      ability: s('要启动的 Ability 名称'),
      buildMode: { type: 'string', enum: ['debug', 'release'], description: '构建模式 debug/release（默认 debug）' },
      uninstall: { type: 'boolean', description: '安装前卸载已存在的应用' },
      skipBuild: { type: 'boolean', description: '跳过构建，直接部署现有产物' },
    },
    timeoutMs: 600000,
    buildArgs(a) {
      const out = ['run']
      if (a.device) out.push('--device', a.device)
      if (a.module && a.module.length) out.push('--module', ...a.module)
      if (a.ability) out.push('--ability', a.ability)
      if (a.buildMode) out.push('--build-mode', a.buildMode)
      if (a.uninstall) out.push('--uninstall')
      if (a.skipBuild) out.push('--skip-build')
      return out
    },
  },
  {
    name: 'dcli__generate_signature',
    description: '自动生成应用签名材料并写入工程配置（devecocli signature generate）。需先用 dcli__auth_status 确认已登录华为账号；调试签名缺失/失效时使用。',
    parameters: {},
    timeoutMs: 300000,
    buildArgs() { return ['signature', 'generate'] },
  },
  {
    name: 'dcli__configure_dual_signing',
    kind: 'dual-signing',
    description: '预览或写入工程根 build-profile.json5 的 release+debug 双签名配置，并安全合并 products 与模块 targets。默认只预览；apply=true 时先备份再写入。密码字段不会回显。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      releaseStoreFile: { type: 'string', required: true, description: '发布签名 KeyStore 文件（.p12）' },
      releaseStorePassword: { type: 'string', required: true, description: '发布 KeyStore 的 DevEco 加密密码（仅写入配置，不回显）' },
      releaseKeyAlias: { type: 'string', required: true, description: '发布签名 keyAlias' },
      releaseKeyPassword: { type: 'string', required: true, description: '发布私钥的 DevEco 加密密码（仅写入配置，不回显）' },
      releaseProfile: { type: 'string', required: true, description: '发布 Profile 文件（.p7b）' },
      releaseCertpath: { type: 'string', required: true, description: '发布证书文件（.cer）' },
      debugStoreFile: { type: 'string', required: true, description: '调试签名 KeyStore 文件（.p12；可与发布签名共用）' },
      debugStorePassword: { type: 'string', required: true, description: '调试 KeyStore 的 DevEco 加密密码（仅写入配置，不回显）' },
      debugKeyAlias: { type: 'string', required: true, description: '调试签名 keyAlias' },
      debugKeyPassword: { type: 'string', required: true, description: '调试私钥的 DevEco 加密密码（仅写入配置，不回显）' },
      debugProfile: { type: 'string', required: true, description: '调试 Profile 文件（.p7b）' },
      debugCertpath: { type: 'string', required: true, description: '调试证书文件（.cer）' },
      releaseProduct: s('发布 product / signingConfig 名（默认 default）'),
      debugProduct: s('调试 product / signingConfig 名（默认 debug）'),
      modules: sArr('需要拆分 release/debug targets 的应用模块；省略时优先 entry，其他模块共享现有 target'),
      apply: { type: 'boolean', description: '是否实际备份并写入；默认 false，只返回预览' },
    },
    timeoutMs: 30000,
    buildArgs() { return [] },
  },
  {
    name: 'dcli__list_devices',
    description: '列出所有已连接设备（真机与模拟器，devecocli device list）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['device', 'list'] },
  },
  {
    name: 'dcli__list_emulators',
    description: '列出 DevEco Studio 中可用的模拟器实例（devecocli emulator list）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['emulator', 'list'] },
  },
  {
    name: 'dcli__device_info',
    description: '查看指定设备的详细信息（devecocli device view）。',
    parameters: {
      device: s('设备名称或序列号'),
    },
    timeoutMs: 60000,
    buildArgs(a) {
      const out = ['device', 'view']
      if (a.device) out.push('--target', a.device)
      return out
    },
  },
  {
    name: 'dcli__emulator_rotate',
    description: '旋转模拟器屏幕方向（devecocli emulator rotate）。',
    parameters: {
      direction: { type: 'string', enum: ['left', 'right'], description: '旋转方向：left / right' },
    },
    timeoutMs: 60000,
    buildArgs(a) { return ['emulator', 'rotate', a.direction || 'left'] },
  },
  {
    name: 'dcli__emulator_power',
    description: '按下模拟器电源键（切换屏幕开关，devecocli emulator power）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['emulator', 'power'] },
  },
  {
    name: 'dcli__emulator_shake',
    description: '触发模拟器摇一摇事件（devecocli emulator shake）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['emulator', 'shake'] },
  },
  {
    name: 'dcli__emulator_volume',
    description: '调整模拟器音量（devecocli emulator volume）。',
    parameters: {
      direction: { type: 'string', enum: ['up', 'down'], description: '音量方向：up / down' },
    },
    timeoutMs: 60000,
    buildArgs(a) { return ['emulator', 'volume', a.direction || 'up'] },
  },
  {
    name: 'dcli__emulator_start',
    description: '启动一个或多个模拟器实例（devecocli emulator start）。',
    parameters: {
      names: { type: 'array', items: { type: 'string' }, required: true, description: '要启动的模拟器名称（可多个）' },
    },
    timeoutMs: 300000,
    buildArgs(a) { return ['emulator', 'start', ...a.names] },
  },
  {
    name: 'dcli__emulator_stop',
    description: '停止一个或多个模拟器实例，支持名称或序列号（devecocli emulator stop）。',
    parameters: {
      names: { type: 'array', items: { type: 'string' }, required: true, description: '要停止的模拟器名称或序列号（可多个，如 127.0.0.1:5555）' },
    },
    timeoutMs: 120000,
    buildArgs(a) { return ['emulator', 'stop', ...a.names] },
  },
  {
    name: 'dcli__emulator_fold',
    description: '设置折叠屏模拟器展开状态（devecocli emulator fold）。open/half-open/close 通用；三折屏另有 single/double/triple 等。',
    parameters: {
      state: { type: 'string', required: true, enum: ['open', 'half-open', 'close', 'vertical-open', 'single', 'double', 'triple', 'left-folded-right-half-folded', 'left-half-folded-right-expanded', 'left-expanded-right-folded', 'left-half-folded-right-folded', 'left-expanded-right-half-folded', 'left-half-folded-right-half-folded'], description: '折叠状态' },
      target: s('目标模拟器名称或序列号'),
    },
    timeoutMs: 60000,
    buildArgs(a) {
      const out = ['emulator', 'fold']
      if (a.target) out.push('--target', a.target)
      out.push(a.state)
      return out
    },
  },
  {
    name: 'dcli__emulator_battery',
    description: '设置模拟器电池电量或充电状态（devecocli emulator battery）。',
    parameters: {
      target: s('目标模拟器名称或序列号'),
      level: s('电池电量 0-100（充电中 0-100，未充电 1-100）'),
      status: { type: 'string', enum: ['charging', 'discharging'], description: '充电状态' },
    },
    timeoutMs: 60000,
    buildArgs(a) {
      if (a.level !== undefined) {
        const n = Number(a.level)
        if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('level 必须是 0-100 的整数')
      }
      const out = ['emulator', 'battery']
      if (a.target) out.push('--target', a.target)
      if (a.level !== undefined) out.push('--level', a.level)
      if (a.status) out.push('--status', a.status)
      return out
    },
  },
  {
    name: 'dcli__emulator_sensor',
    description: '向模拟器注入传感器数据（devecocli emulator sensor）：光线/湿度/温度/步数/心率。',
    parameters: {
      target: s('目标模拟器名称或序列号'),
      lightIntensity: s('光线强度 0-100000'),
      humidity: s('湿度 0-100'),
      temperature: s('温度 -273.1 到 100'),
      steps: s('步数 0-10000'),
      heartrate: s('心率 0-255'),
    },
    timeoutMs: 60000,
    buildArgs(a) {
      const map = {
        lightIntensity: '--light-intensity',
        humidity: '--humidity',
        temperature: '--temperature',
        steps: '--steps',
        heartrate: '--heartrate',
      }
      const out = ['emulator', 'sensor']
      if (a.target) out.push('--target', a.target)
      for (const [key, flag] of Object.entries(map)) {
        if (a[key] !== undefined) out.push(flag, a[key])
      }
      return out
    },
  },
  {
    name: 'dcli__get_device_logs',
    description: '获取设备应用运行日志（devecocli log）。支持按级别/包名/关键词过滤与时间窗。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程；日志命令的 cwd）'),
      device: s('目标设备名称或序列号'),
      level: { type: 'string', enum: ['D', 'I', 'W', 'E', 'F'], description: '日志级别过滤：D/I/W/E/F' },
      bundleName: s('按应用包名过滤'),
      keyword: s('关键词过滤'),
      tail: s('只显示最近 N 行'),
      from: s('从现在起往前的时间窗，如 30s / 5m / 2.5m'),
      crash: { type: 'boolean', description: '只获取崩溃日志' },
    },
    timeoutMs: 60000,
    buildArgs(a) {
      const out = ['log']
      if (a.device) out.push('--device', a.device)
      if (a.level) out.push('--level', a.level)
      if (a.bundleName) out.push('--bundle-name', a.bundleName)
      if (a.keyword) out.push('--keyword', a.keyword)
      if (a.tail) out.push('--tail', a.tail)
      if (a.from) out.push('--from', a.from)
      if (a.crash) out.push('--crash')
      return out
    },
  },
  {
    name: 'dcli__docs_search',
    description: '在本地 HarmonyOS 文档库中按关键词检索文档（devecocli docs search）。',
    parameters: {
      keywords: { type: 'array', items: { type: 'string' }, required: true, description: '检索关键词（可多个）' },
      limit: s('结果数量上限（可选）'),
    },
    timeoutMs: 60000,
    buildArgs(a) {
      const out = ['docs', 'search']
      if (a.keywords && a.keywords.length) out.push(...a.keywords)
      if (a.limit) out.push('--limit', a.limit)
      return out
    },
  },
  {
    name: 'dcli__docs_read',
    description: '读取本地 HarmonyOS 文档全文（devecocli docs read，documentId 来自 dcli__docs_search 结果）。',
    parameters: {
      documentId: { type: 'string', required: true, description: '文档 ID' },
    },
    timeoutMs: 60000,
    buildArgs(a) { return ['docs', 'read', a.documentId] },
  },
  {
    name: 'dcli__docs_catalog',
    description: '列出本地文档库的全部目录（devecocli docs catalog）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['docs', 'catalog'] },
  },
  {
    name: 'dcli__api_lookup',
    kind: 'lookup',
    description: 'ArkTS/ArkUI API 统一速查（多源印证）：按组件/接口/装饰器/Kit 名一次查询 SDK .d.ts 精确签名（component/api/kits/arkts/hms 五区）与本地文档库命中。写代码前查 API 用这一个工具即可。',
    parameters: {
      name: { type: 'string', required: true, description: '查询目标：组件（Button/TextInput）、接口（@ohos.arkui.UIContext）、装饰器（@ComponentV2）、Kit（@kit.ArkUI）、语言扩展（@arkts.collections）等' },
      scope: { type: 'string', enum: ['all', 'component', 'api', 'kits', 'arkts', 'hms', 'docs'], description: '查询范围（默认 all）' },
      maxResults: s('每个来源的结果上限（默认 5，最大 10）'),
    },
    timeoutMs: 60000,
    buildArgs() { return [] },
  },
  {
    name: 'dcli__agents_md',
    kind: 'agents-md',
    description: '预览或生成/刷新工程根 AGENTS.md：从 build-profile.json5 / AppScope/app.json5 / main_pages.json 提取事实，只替换 <!-- DSH-HMOS-MANAGED:START/END --> 托管块并保留其余全文。默认 apply=false 仅预览；apply=true 才以备份+原子替换写入。畸形或重复 marker 会拒绝写入。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      apply: { type: 'boolean', description: '是否实际备份并写入；默认 false，只返回变更预览' },
    },
    timeoutMs: 30000,
    buildArgs() { return [] },
  },
  {
    name: 'dcli__auth_status',
    description: '查看 deveco-cli 当前登录的华为账号状态（devecocli auth status，只读）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['auth', 'status'] },
  },
  {
    name: 'dcli__skills_find',
    description: '在 HarmonyOS 技能市场按关键词搜索可用技能（devecocli skills find）。',
    parameters: {
      keyword: { type: 'string', required: true, description: '搜索关键词' },
    },
    timeoutMs: 60000,
    buildArgs(a) { return ['skills', 'find', a.keyword] },
  },
  {
    name: 'dcli__skills_list',
    description: '列出 HarmonyOS 技能市场的全部可用技能（devecocli skills list）。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['skills', 'list'] },
  },
  {
    name: 'dcli__update_cli',
    description: '升级全局 deveco-cli/工具链（devecocli update）。会修改本机安装，仅在用户明确要求升级时调用。',
    parameters: {},
    timeoutMs: 600000,
    buildArgs() { return ['update'] },
  },
  {
    name: 'dcli__check_lint',
    description: '运行 DevEco Code Linter 检查 TS/ArkTS 代码规范与性能规则（devecocli check lint）。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      path: s('要检查的文件或目录（默认整个工程）'),
      fix: { type: 'boolean', description: '自动修复可修复的问题' },
      product: s('build-profile.json5 中的 product 名（默认 default）'),
    },
    timeoutMs: 180000,
    buildArgs(a) {
      const out = ['check', 'lint']
      if (a.path) out.push(a.path)
      if (a.fix) out.push('--fix')
      if (a.product) out.push('--product', a.product)
      out.push('--format', 'json')
      return out
    },
  },
  {
    name: 'dcli__check_compat',
    description: '检查源码对目标 SDK 版本的 API 兼容性（devecocli check compat）。需要 DevEco Studio 26.0.0.810+，低版本会报版本门槛错误。sourceVersion/targetVersion 必填。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      sourceVersion: { type: 'string', required: true, description: '当前工程 SDK 版本（如 6.1.0(23)）' },
      targetVersion: { type: 'string', required: true, description: '目标 SDK 版本（如 6.1.1(24)）' },
      modules: sArr('要检查的模块（默认全部）'),
      limit: s('显示的最大变更记录数（默认 100）'),
    },
    timeoutMs: 300000,
    buildArgs(a) {
      const out = ['check', 'compat']
      out.push('--source-version', a.sourceVersion)
      out.push('--target-version', a.targetVersion)
      if (a.modules && a.modules.length) out.push('--modules', ...a.modules)
      if (a.limit) out.push('--limit', a.limit)
      out.push('--format', 'json')
      return out
    },
  },
  {
    name: 'dcli__check_compat_versions',
    description: '列出可用于兼容性检查的目标 SDK 版本（devecocli check compat versions）。需要 DevEco Studio 26.0.0.810+。',
    parameters: {},
    timeoutMs: 60000,
    buildArgs() { return ['check', 'compat', 'versions'] },
  },
  {
    name: 'dcli__lsp_check',
    kind: 'lsp',
    description: 'LSP 静态语法检查：按工程常驻诊断实例，对 files（相对工程根）做 ArkTS/C/C++ 诊断。修改 .ets / C/C++ 后用它验证，诊断清零再继续；实例未启动时首次调用自动创建（初始化约 10-60s）。',
    parameters: {
      files: { type: 'array', items: { type: 'string' }, required: true, description: '要检查的源码文件（相对工程根，如 entry/src/main/ets/pages/Index.ets；工程内绝对路径也可）' },
      projectPath: s('工程目录（默认当前会话工程）'),
    },
    timeoutMs: 360000,
    buildArgs() { return [] },
  },
  {
    name: 'dcli__lsp_restart',
    kind: 'lsp-restart',
    description: '重启指定工程的 LSP 实例：重新 sync 工程 + 初始化 LSP。LSP 卡死或工程结构变化后用；未启动的工程返回提示。',
    parameters: {
      projectPath: s('工程目录（默认当前会话工程）'),
      target: { type: 'string', enum: ['all', 'arkts', 'cpp'], description: '重启范围（默认 all）' },
    },
    timeoutMs: 60000,
    buildArgs() { return [] },
  },
  {
    name: 'dcli__start_app',
    kind: 'hdc-cmd',
    description: '在指定真机/模拟器上启动已安装的应用（hdc aa start）。需应用已安装（dcli__install_hap 装 debug 签名包）。',
    parameters: {
      bundleName: { type: 'string', required: true, description: '应用包名' },
      abilityName: { type: 'string', description: 'Ability 名称（默认 EntryAbility）' },
      moduleName: { type: 'string', description: '模块名（多模块应用需要，如 entry）' },
      device: s('目标设备序列号（默认唯一在线设备）'),
    },
    timeoutMs: 30000,
    buildArgs(a) {
      const bundleName = validateBundleName(a.bundleName, { required: true })
      const abilityName = validateSafeName(a.abilityName, { label: 'abilityName' }) || 'EntryAbility'
      const moduleName = validateSafeName(a.moduleName, { label: 'moduleName' })
      const out = []
      if (a.device) out.push('-t', a.device)
      out.push('shell', 'aa', 'start')
      out.push('-a', abilityName)
      out.push('-b', bundleName)
      if (moduleName) out.push('-m', moduleName)
      return out
    },
  },
  {
    name: 'dcli__install_hap',
    kind: 'hdc',
    description: '用 hdc 直连安装 HAP 到真机/模拟器（force-stop → 传输 → bm install）。真机调试必须装 debug 签名包（如 entry-debug-signed.hap）；装 default/release 签名包可能报错 9568322。',
    parameters: {
      hapPath: { type: 'string', required: true, description: 'HAP 文件绝对路径（debug 产物如 entry/build/debug/outputs/debug/entry-debug-signed.hap）' },
      device: s('目标设备序列号（默认唯一在线设备）'),
      bundleName: s('安装前 force-stop 的应用包名（如 <bundle-name>）'),
    },
    timeoutMs: 300000,
    buildArgs() { return [] }
  },
  {
    name: 'dcli__ui_screenshot',
    description: '截取设备屏幕保存为 PNG（devecocli ui screenshot）。配合 read_image 看图做 UI 验证：操作后截图取证，用 read_image 判断界面是否符合预期。',
    parameters: {
      path: { type: 'string', required: true, description: 'PNG 文件保存路径（目录或文件，必须可写，如 <output-dir>/shot1.png）' },
      device: s('目标设备名称或序列号（多设备时必填）'),
      display: s('目标 display id（省略为默认屏）'),
    },
    timeoutMs: 30000,
    buildArgs(a) {
      const out = ['ui', 'screenshot']
      if (a.device) out.push('--device', a.device)
      if (a.display) out.push('--display', a.display)
      out.push('--path', a.path)
      return out
    },
  },
  {
    name: 'dcli__ui_layout',
    description: '检查设备屏幕 UI 节点树（devecocli ui layout）：查看控件结构/层级/坐标，配合 dcli__ui_click（传 id）定位操作、验证界面元素存在。',
    parameters: {
      device: s('目标设备名称或序列号'),
      id: s('布局节点 id（只查该节点）'),
      depth: s('树深度限制（0=无限，1=仅根，2=根+子；默认 0）'),
      format: { type: 'string', enum: ['default', 'json'], description: '输出格式（json 便于解析）' },
      mode: { type: 'string', enum: ['full', 'simplified'], description: '输出模式（默认 simplified）' },
    },
    timeoutMs: 30000,
    buildArgs(a) {
      const out = ['ui', 'layout']
      if (a.device) out.push('--device', a.device)
      if (a.id) out.push('--id', a.id)
      if (a.depth) out.push('--depth', a.depth)
      if (a.format) out.push('--format', a.format)
      if (a.mode) out.push('--mode', a.mode)
      return out
    },
  },
  {
    name: 'dcli__ui_click',
    description: '在设备屏幕点击（devecocli ui click）：传 x/y 坐标，或传 id 自动解析节点中心坐标（节点 id 来自 dcli__ui_layout）。',
    parameters: {
      device: s('目标设备名称或序列号'),
      x: s('X 坐标（与 y 一起传，或改传 id）'),
      y: s('Y 坐标（与 x 一起传，或改传 id）'),
      id: s('布局节点 id（自动解析为中心坐标；与 x/y 二选一）'),
      window: s('目标 window id（与 id 配合使用）'),
    },
    timeoutMs: 30000,
    buildArgs(a) {
      if (!a.id && (a.x === undefined || a.y === undefined)) throw new Error('click 需要 x/y 坐标或 id 节点（id 来自 dcli__ui_layout）')
      const out = ['ui', 'click']
      if (a.device) out.push('--device', a.device)
      if (a.id) out.push('--id', a.id)
      if (a.window) out.push('--window', a.window)
      if (!a.id) out.push(a.x, a.y)
      return out
    },
  },
  {
    name: 'dcli__ui_swipe',
    description: '在设备屏幕滑动（devecocli ui swipe）：起点 (x1,y1) 到终点 (x2,y2)。用于列表滚动、翻页等操作验证。',
    parameters: {
      x1: { type: 'string', required: true, description: '起点 X 坐标' },
      y1: { type: 'string', required: true, description: '起点 Y 坐标' },
      x2: { type: 'string', required: true, description: '终点 X 坐标' },
      y2: { type: 'string', required: true, description: '终点 Y 坐标' },
      device: s('目标设备名称或序列号'),
    },
    timeoutMs: 30000,
    buildArgs(a) {
      if (a.x1 === undefined || a.y1 === undefined || a.x2 === undefined || a.y2 === undefined) throw new Error('swipe 需要 x1 y1 x2 y2 四个坐标')
      const out = ['ui', 'swipe']
      if (a.device) out.push('--device', a.device)
      out.push(a.x1, a.y1, a.x2, a.y2)
      return out
    },
  },
  {
    name: 'dcli__ui_text',
    description: '在设备屏幕输入文本（devecocli ui text）：不传坐标时输入到当前聚焦输入框；传 x/y 指定目标位置。',
    parameters: {
      text: { type: 'string', required: true, description: '要输入的文本' },
      x: s('目标 X 坐标（可选，不传则输入到当前聚焦输入框）'),
      y: s('目标 Y 坐标（可选）'),
      device: s('目标设备名称或序列号'),
    },
    timeoutMs: 30000,
    buildArgs(a) {
      if (!a.text) throw new Error('text 必填')
      const out = ['ui', 'text']
      if (a.device) out.push('--device', a.device)
      out.push(a.text)
      if (a.x !== undefined && a.y !== undefined) out.push(a.x, a.y)
      return out
    },
  },
];