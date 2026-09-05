// dcli-tools.mjs — 原生 DSH 插件：devecocli 命令封装（41 个工具，宿主进程内）
//
// 在 web profile patch 中以文件插件加载：
//   - insert:
//       - id: dcli-tools
//         name: ./plugins/dcli-tools.mjs
//         config: { cliPath, projectPath, devEcoHome }
//
// 路径解析链（cliPath / devEcoHome），优先级从高到低：
//   cliPath:    patch config.cliPath → 环境变量 DEVECO_CLI_PATH
//   devEcoHome: patch config.devEcoHome → 环境变量 DEVECO_HOME →
//               DEVECO_SDK_HOME 的父目录（deveco-cli 官方同款变量，指向 sdk/）→
//               常见安装目录探测（C:\Program Files\Huawei\DevEco Studio 等）
// 环境变量在全局（setx）或项目级固定后，换机/换安装路径无需改 patch。
//
// dcli__api_lookup 为 ArkTS/ArkUI 统一速查入口：一次查询聚合 SDK .d.ts 精确签名
// （component/api/kits/arkts/hms 五区）与本地文档库命中，多源互相印证。
//
// 相比 MCP server（devecocli-cmd.mjs）：无 stdio transport 层，故障即插件错误；
// 子进程由 subprocess 服务管理（树级终止）；参数由 DSH ToolRuntime 校验。

import path from 'node:path'
import fs from 'node:fs'
import { spawnSync as cpSpawnSync } from 'node:child_process'
// 依赖解析：@deepseek-ai/dsh-tools 由 DSH 宿主提供（可选 peerDependency），
// @modelcontextprotocol/sdk 随包安装；分发无需硬编码 npx 路径。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
// 统一环境解析（cli / Studio / hdc / hvigor / json5 / 工程根）。
// cliPath 缺失不阻止本插件挂载：具体工具在真正执行时动态解析，报可操作错误。
import { resolveEnv, cliMissingError, studioMissingError, WINDOWS_ONLY } from './environment.js'
import { validateBundleName, validateSafeName } from './validate.js'
import { configureDualSigning } from './dual-signing.js'

export const name = 'dcli-tools'
export const inject = ['tools', 'subprocess']

// Windows-only 运行时守卫：npm 的 "os":["win32"] 在安装期 EBADPLATFORM 硬拒，
// 但 git/link 安装可绕过；注册层再拦一道——非 win32 不注册任何 dcli__*，
// 避免非 Windows 会话挂出 41 个注定失败的误导性工具。WINDOWS_ONLY 来自
// environment.js 的产品契约（Windows-only），在此处被真正消费。
export function toolsSupportedOn(platform) {
  return WINDOWS_ONLY && platform === 'win32'
}

// 单实例 LSP dispose（可测试）：只读公开 transport.pid，client.close() 的 Promise
// 统一 .catch() 防未处理 rejection；只在无 client 时才单独 close transport（避免
// 与 SDK Client.close 内部对 transport 的 close 竞争）；Windows 上用捕获的 pid 做
// taskkill /T /F 树级兜底（serve mcp 会拉起 ace-server/clangd 子进程，仅 close 可能残留）。
export function disposeLspInstance(inst, deps = {}) {
  if (!inst) return
  const platform = deps.platform !== undefined ? deps.platform : process.platform
  const killTree = deps.killTree
  const pid = inst.transport ? inst.transport.pid : undefined
  if (inst.client) {
    try {
      const closed = inst.client.close()
      if (closed && typeof closed.then === 'function') closed.catch(() => {})
    } catch { /* 忽略 */ }
  } else if (inst.transport && typeof inst.transport.close === 'function') {
    try {
      const closed = inst.transport.close()
      if (closed && typeof closed.then === 'function') closed.catch(() => {})
    } catch { /* 忽略 */ }
  }
  if (platform === 'win32' && pid) {
    try {
      if (killTree) killTree(pid)
      else cpSpawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    } catch { /* 忽略 */ }
  }
  inst.closed = true
}

const MAX_OUTPUT = 200000
const MAX_STDERR = 50000

// 剥离 ANSI 彩码：devecocli/hvigor/hdc 的终端着色对模型无意义，且会污染文本解析
// （CSI 序列，覆盖颜色/样式/光标控制等）
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
function stripAnsi(text) {
  return text ? String(text).replace(ANSI_RE, '') : text
}

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
    description: '自动生成应用签名材料并写入工程配置（devecocli signature generate）。需先 auth_status 确认已登录华为账号；调试签名缺失/失效时使用。',
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
    description: '读取本地 HarmonyOS 文档全文（devecocli docs read，documentId 来自 docs_search 结果）。',
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
    description: '检查设备屏幕 UI 节点树（devecocli ui layout）：查看控件结构/层级/坐标，配合 ui click --id 定位操作、验证界面元素存在。',
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
const OUTPUT = {
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      exitCode: { type: 'integer' },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
    },
    additionalProperties: false,
  },
  render(_args, value) {
    const parts = []
    if (value.command) parts.push('$ ' + value.command)
    if (value.stdout) parts.push(value.stdout)
    if (value.stderr) parts.push('[stderr]\n' + value.stderr)
    if (value.exitCode !== undefined && value.exitCode !== null) parts.push('[exit code: ' + value.exitCode + ']')
    return [{ type: 'text', text: parts.join('\n') || '(no output)' }]
  },
}

// ── dcli__agents_md 纯函数（模块级，供 apply 与 test/ 共用） ──
// JSON5 简易解析：支持双引号字符串、// 与 /* */ 注释、尾逗号（build-profile.json5 由 DevEco 生成）
export function parseJson5(text) {
  let out = ''
  let inStr = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') { out += text[i + 1] || ''; i += 2; continue }
      if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') { inStr = true; out += c; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue }
    out += c
    i++
  }
  out = out.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(out)
}

export const MANAGED_OPEN = '<!-- DSH-HMOS-MANAGED:START -->'
export const MANAGED_CLOSE = '<!-- DSH-HMOS-MANAGED:END -->'
export const AGENTS_BACKUP_SUFFIX = '.dsh-agents-backup'

// 严格解析唯一的一对 managed marker。空文件/无 marker 是合法的“尚未接管”状态；
// 缺失、重复或反序必须拒绝，避免刷新时静默丢失人工内容。
export function splitManaged(existing) {
  const text = existing == null ? '' : String(existing)
  const openCount = text.split(MANAGED_OPEN).length - 1
  const closeCount = text.split(MANAGED_CLOSE).length - 1
  if (openCount === 0 && closeCount === 0) return { found: false, head: text, tail: '' }
  if (openCount !== 1 || closeCount !== 1) {
    throw new Error('AGENTS.md managed marker 异常：START=' + openCount + '，END=' + closeCount + '；请修复标记后重试')
  }
  const oi = text.indexOf(MANAGED_OPEN)
  const ci = text.indexOf(MANAGED_CLOSE)
  if (ci < oi) throw new Error('AGENTS.md managed marker 异常：END 位于 START 之前；请修复标记后重试')
  return { found: true, head: text.slice(0, oi), tail: text.slice(ci + MANAGED_CLOSE.length) }
}

// 托管块正文（只放自动生成的事实，不含任何硬编码的 debug/default/entry 断言）。
export function renderManaged(facts) {
  const pages = facts.pages || '（未读取到 main_pages.json）'
  const prodList = ((facts.products || []).map((p) => p.name + (p.signingConfig ? '(' + p.signingConfig + ')' : '')).join(' / ')) || '（未读取到）'
  const prodNames = ((facts.products || []).map((p) => p.name).join(' / '))
  const firstMod = (facts.modules && facts.modules[0]) || '<module>'
  return [
    '# ' + facts.name + ' AGENTS.md',
    '',
    '## 工程概览',
    '- 应用类型：HarmonyOS 原生应用（Stage 模型，ArkTS）',
    '- bundleName：' + (facts.bundleName || '（未读取到）'),
    '- 模块：' + (facts.modules || []).join(' / '),
    '- SDK：targetSdk ' + facts.targetSdk + '，compatibleSdkVersion ' + facts.compatSdk,
    '- products：' + prodList,
    '',
    '## 常用命令（经 DSH 原生 dcli 插件调用；projectPath 传本工程根）',
    '- 查 API：`dcli__api_lookup`（SDK .d.ts 精确签名 + 本地文档库多源印证，写代码前查）',
    '- 文档：`dcli__docs_search` / `dcli__docs_read`（documentId 来自 search）',
    '- 静态检查：`dcli__lsp_check`（files 传相对工程根，修改 .ets / C/C++ 后必须执行、诊断清零再继续）',
    '- 规范检查：`dcli__check_lint`（Code Linter）',
    '- 同步：`dcli__sync_project`',
    '- 构建：`dcli__build_project`（product 与模块按本工程实际配置，见 build-profile.json5）',
    '- 安装：`dcli__install_hap`（hapPath 传构建产物路径，bundleName 传 ' + (facts.bundleName || '<bundleName>') + '）',
    '- 启动：`dcli__start_app`（bundleName 传 ' + (facts.bundleName || '<bundleName>') + '）',
    '- 日志：`dcli__get_device_logs`',
    '',
    '## 结构与约定',
    '- 页面路由：' + pages + '（main_pages.json）',
    '- 状态管理：先读现有代码确认 V1 / V2；新代码优先 V2（@ComponentV2/@Local/@Param）',
    '- 首模块：' + firstMod + '（其余模块见 build-profile.json5 的 modules）',
    '',
    '## 签名与构建',
    '- products：' + (prodNames || '（未读取到）') + '；实际可用 product 以 build-profile.json5 为准',
    '- 目标产物：各模块构建目录下的 signed 产物（如 ' + firstMod + '/build/<product>/outputs/<product>/），安装配套用 dcli__install_hap 传实际路径',
    '- **真机安装只装 debug 签名包**（未签名的 default/release 源装真机可能报错 9568322）',
    '- 敏感信息警告：build-profile.json5 中 storePassword/keyPassword 为加密串，勿复制到聊天/日志/文档',
    '',
    '## 维护约定',
    '- 本文件托管块由 dcli__agents_md 自动刷新（marker 之间不可手改）；marker 之外可自由追加自定义节',
    '- 不写敏感信息（签名口令、KeyStore 密码）',
    '- 完成重要特性后，把可复用知识（踩坑、命令）追加到 marker 之外的自定义节',
    '',
  ].join('\n')
}

// 组装完整 AGENTS.md：只替换 managed 块，保留 marker 之外的用户内容。
// 首次接管无 marker 的既有文件时保留全文并在末尾追加托管块；不再按标题猜测并删除内容。
export function renderAgentsMdContent(facts, existing) {
  const text = existing == null ? '' : String(existing)
  const { found, head, tail } = splitManaged(text)
  const block = MANAGED_OPEN + '\n' + renderManaged(facts).replace(/\n+$/, '') + '\n' + MANAGED_CLOSE
  if (!found) {
    const existingTrim = text.replace(/\s+$/, '')
    return (existingTrim ? existingTrim + '\n\n' : '') + block + '\n'
  }
  const headTrim = head.replace(/\s+$/, '')
  const tailTrim = tail.replace(/^\s+/, '')
  return (headTrim ? headTrim + '\n\n' : '') + block + (tailTrim ? '\n\n' + tailTrim : '') + '\n'
}

export function summarizeAgentsMdChange(existing, next) {
  const before = String(existing == null ? '' : existing)
  const after = String(next == null ? '' : next)
  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix)
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return {
    changed: before !== after,
    beforeChars: before.length,
    afterChars: after.length,
    removedChars: before.length - prefix - suffix,
    addedChars: after.length - prefix - suffix,
  }
}

export function atomicWriteAgentsMd(filePath, content) {
  const tempPath = filePath + '.tmp-' + process.pid
  try {
    fs.writeFileSync(tempPath, content, 'utf8')
    fs.renameSync(tempPath, filePath)
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch { /* best-effort cleanup */ }
  }
}

export function writeAgentsMdWithBackup(filePath, existing, content) {
  let backupPath = ''
  let backupCreated = false
  if (existing) {
    backupPath = filePath + AGENTS_BACKUP_SUFFIX
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, existing, { encoding: 'utf8', flag: 'wx' })
      backupCreated = true
    }
  }
  atomicWriteAgentsMd(filePath, content)
  return { backupPath, backupCreated }
}

export function apply(ctx, config) {
  return applyForPlatform(ctx, config, process.platform)
}

// 可测试入口：把 platform 从 process.platform 抽出，非 win32 不注册任何 dcli__*。
// apply() 仅是它的 process.platform 特例。
export function applyForPlatform(ctx, config, platform) {
  if (!toolsSupportedOn(platform)) return {}
  // 环境在每次工具调用时动态解析（enable.js）：CLI/Studio 安装后无需重启即可识别。
  const env = () => resolveEnv(config || {})

  async function runCli(argv, cwdOverride, signal) {
    const e = env()
    if (!e.cliOk) throw new Error(cliMissingError(e))
    const handle = ctx.subprocess.spawn({
      argv: [process.execPath, e.CLI, ...argv],
      cwd: cwdOverride || e.PROJECT,
      env: { DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 3000,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { exitCode: outcome.exitCode === null ? 1 : outcome.exitCode, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) }
  }

  // hvigorw（工程同步/构建底层）：与 devecocli 内部 HvigorAdapter 同款（node hvigorw.js + DEVECO_SDK_HOME）
  async function runHvigor(argv, cwdOverride, signal) {
    const e = env()
    if (!e.hvigorOk) throw new Error(studioMissingError(e, '需要 DevEco Studio 自带 hvigor（tools/hvigor/bin/hvigorw.js）'))
    const handle = ctx.subprocess.spawn({
      argv: [process.execPath, e.HVIGORW, ...argv],
      cwd: cwdOverride || e.PROJECT,
      env: { DEVECO_SDK_HOME: path.join(e.DEVECO_HOME, 'sdk'), DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 3000,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { exitCode: outcome.exitCode === null ? 1 : outcome.exitCode, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) }
  }

  async function hdcRun(argv, signal) {
    const e = env()
    if (!e.hdcOk) throw new Error(studioMissingError(e, '需要可用的 hdc（DevEco Studio SDK 的 toolchains/hdc.exe）'))
    const handle = ctx.subprocess.spawn({
      argv: [e.HDC, ...argv],
      cwd: e.PROJECT,
      env: { DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 3000,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { exitCode: outcome.exitCode === null ? 1 : outcome.exitCode, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) }
  }

  async function installHap(args, signal) {
    if (!fs.existsSync(args.hapPath)) throw new Error('HAP 文件不存在: ' + args.hapPath)
    // force-stop 的可选 bundleName 在 spawn 前校验：非法值拒绝、不进 hdc argv。
    const bundleName = validateBundleName(args.bundleName)
    // hdc 的 file send 不认正斜杠绝对路径：转反斜杠
    const sendPath = String(args.hapPath).replace(/\//g, '\\')
    const dev = args.device ? ['-t', args.device] : []
    const tmp = 'data/local/tmp/' + path.basename(args.hapPath, '.hap').replace(/[^A-Za-z0-9_-]/g, '_') + '-install'
    const steps = []
    if (bundleName) steps.push({ label: 'force-stop', argv: ['shell', 'aa', 'force-stop', bundleName] })
    steps.push({ label: 'rm old dir', argv: ['shell', 'rm', '-rf', tmp] })
    steps.push({ label: 'mkdir', argv: ['shell', 'mkdir', '-p', tmp] })
    steps.push({ label: 'file send', argv: ['file', 'send', sendPath, tmp] })
    steps.push({ label: 'bm install', argv: ['shell', 'bm', 'install', '-p', tmp] })
    const out = []
    for (const step of steps) {
      const full = [...dev, ...step.argv]
      const r = await hdcRun(full, signal)
      out.push('$ hdc ' + full.join(' '))
      if (r.stdout.trim()) out.push(r.stdout.trim())
      if (r.stderr.trim()) out.push('[stderr] ' + r.stderr.trim())
      if (r.exitCode !== 0) throw new Error('[' + step.label + ' failed, exit ' + r.exitCode + ']\n' + out.join('\n'))
    }
    const text = out.join('\n')
    if (!/install bundle successfully/i.test(text)) throw new Error(text)
    return { command: 'hdc install ' + sendPath, exitCode: 0, stdout: text, stderr: '' }
  }

  // ── dcli__api_lookup：ArkTS/ArkUI 统一速查（SDK 签名 + 文档库多源印证） ──
  const SDK_AREAS = {
    component: { rel: ['openharmony', 'ets', 'component'], ext: '.d.ts' },
    api: { rel: ['openharmony', 'ets', 'api'], ext: '.d.ts' },
    kits: { rel: ['openharmony', 'ets', 'kits'], ext: '.d.ts' },
    arkts: { rel: ['openharmony', 'ets', 'arkts'], ext: '.d.ets' },
    hms: { rel: ['hms', 'ets', 'api'], ext: '.d.ts' },
  }
  function toSnake(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase()
  }
  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  // 从命中行向上回溯声明起始，截取完整声明片段
  function extractSnippet(lines, hit) {
    let start = hit
    for (let i = hit; i >= 0; i--) {
      if (/^\s*(declare\s+)?(interface|class|enum|namespace|function|type|const)\b/.test(lines[i])) { start = i; break }
    }
    const end = Math.min(start + 20, lines.length)
    return { start: start + 1, text: lines.slice(start, end).join('\n') }
  }
  function lookupSdkArea(area, name, limit) {
    const e = env()
    const areaCfg = SDK_AREAS[area]
    const dir = e.DEVECO_HOME ? path.join(e.DEVECO_HOME, 'sdk', 'default', ...areaCfg.rel) : ''
    if (!dir || !fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(areaCfg.ext))
    const snake = toSnake(name)
    const bare = String(name).replace(/^@/, '')
    const isModule = String(name).startsWith('@')
    // 查询语义分三类：
    //  - 模块名（@ohos.* / @kit.* / @arkts.*，含点号）：模块名与文件名一一对应，只走文件名层；输出精确声明或导出清单
    //  - 装饰器名（@ComponentV2 等，无点号）：无对应文件，必须全量内容 grep 精确声明（如 common.d.ts 的 declare const ComponentV2）
    //  - 普通名（Button/TextInput）：文件名层优先，再全量内容 grep（精确名 → 名前缀 → 宽松）
    const isScoped = String(name).startsWith('@')
    const isModuleName = isScoped && String(name).includes('.')
    // 文件优先级：精确（含 @ 前缀）→ 文件名模糊 → 全部（内容 grep）
    const exact = files.filter((f) => {
      const core = f.slice(0, -areaCfg.ext.length)
      return core === name || core.toLowerCase() === name.toLowerCase() || core === '@' + name
    })
    const fuzzy = exact.length ? [] : files.filter((f) => {
      const core = f.slice(0, -areaCfg.ext.length).replace(/^@/, '').toLowerCase()
      return core.includes(snake) || snake.includes(core)
    })
    const ordered = isModuleName
      ? (exact.length ? exact : fuzzy.slice(0, limit))
      : (exact.length ? exact : fuzzy.length ? fuzzy.slice(0, limit) : files)
    const hits = []
    // 正则均锚定行首（^\s*）：排除 JSDoc 注释行（如 "* @interface TextInputOptions"）
    const fullNameRe = new RegExp('^\\s*(declare\\s+)?(interface|class|enum|namespace|function|type|const)\\s+' + escapeRegExp(bare) + '\\b')
    const prefixedRe = new RegExp('^\\s*(declare\\s+)?(interface|class|enum|namespace|function|type|const)\\s+' + escapeRegExp(bare) + '[A-Z][A-Za-z0-9_]*\\b')
    const looseRe = new RegExp('^\\s*(interface|class|enum|type|const)\\s+[A-Za-z0-9_]*' + escapeRegExp(bare) + '[A-Za-z0-9_]*\\b')
    // 带 @ 前缀的查询：先跨文件找"精确声明"命中（@ComponentV2 → declare const ComponentV2；
    // @ohos.arkui.UIContext 文件的声明名是 UIContext，走清单）。装饰器名无命中即结束（不做清单）。
    if (isScoped) {
      const declHits = []
      const scanFiles = isModuleName ? ordered : (ordered.length ? ordered : files)
      for (const file of scanFiles) {
        if (declHits.length >= limit) break
        let text
        try { text = fs.readFileSync(path.join(dir, file), 'utf8') } catch { continue }
        const ls = text.split('\n')
        for (let i = 0; i < ls.length; i++) {
          if (fullNameRe.test(ls[i])) { declHits.push({ file, lines: ls, i }); break }
        }
      }
      if (declHits.length) {
        for (const h of declHits.slice(0, limit)) {
          const snip = extractSnippet(h.lines, h.i)
          hits.push({ file: areaCfg.rel.slice(2).join('/') + '/' + h.file, start: snip.start, text: snip.text })
        }
        return hits
      }
      if (!isModuleName) return hits
    }
    for (const file of ordered) {
      if (hits.length >= limit) break
      let text
      try { text = fs.readFileSync(path.join(dir, file), 'utf8') } catch { continue }
      const relPath = areaCfg.rel.slice(2).join('/') + '/' + file
      // 模块名查询：顶层导出与声明名清单
      if (isModuleName) {
        const out = []
        const declNames = []
        for (const line of linesOf(text)) {
          const t = line.trim()
          if (t.startsWith('export ') && !t.startsWith('export *')) out.push(t.slice(0, 400))
          const m = line.match(/^\s*(export\s+)?(declare\s+)?(interface|class|enum|namespace|function|type|const)\s+([A-Za-z0-9_]+)/)
          if (m && !declNames.includes(m[4])) declNames.push(m[4])
        }
        const block = []
        if (declNames.length) block.push('顶层声明：' + declNames.slice(0, 40).join(' / '))
        if (out.length) block.push('导出行：\n' + out.slice(0, limit).join('\n'))
        if (block.length) hits.push({ file: relPath, start: 1, text: block.join('\n') })
        continue
      }
      // 组件/接口查询：先精确名，再 Name+大写后缀（ButtonInterface/ButtonOptions），最后宽松包含
      if (!text.includes(bare)) continue
      const lines = linesOf(text)
      const found = []
      lines.forEach((line, i) => {
        if (fullNameRe.test(line)) found.push({ i, prio: 0 })
        else if (prefixedRe.test(line)) found.push({ i, prio: 1 })
      })
      if (!found.length) lines.forEach((line, i) => { if (looseRe.test(line)) found.push({ i, prio: 2 }) })
      found.sort((a, b) => a.prio - b.prio || a.i - b.i)
      for (const f of found) {
        if (hits.length >= limit) break
        const snip = extractSnippet(lines, f.i)
        hits.push({ file: relPath, start: snip.start, text: snip.text })
      }
    }
    return hits
  }
  function linesOf(text) { return text.split('\n') }
  async function apiLookup(args, signal) {
    const e = env()
    const name = String(args.name || '').trim()
    if (!name) throw new Error('name 必填：组件/接口/装饰器/Kit 名，如 Button、@ohos.arkui.UIContext、@ComponentV2、@kit.ArkUI')
    if (!e.devEcoOk) throw new Error(studioMissingError(e, 'api_lookup 需要 DevEco Studio SDK'))
    const limit = Math.max(1, Math.min(10, Number(args.maxResults) || 5))
    const scope = args.scope || 'all'
    const areas = scope === 'all' ? Object.keys(SDK_AREAS) : SDK_AREAS[scope] ? [scope] : []
    const sdkMatches = {}
    for (const area of areas) sdkMatches[area] = lookupSdkArea(area, name, limit)
    // 文档库命中（失败不阻断 SDK 结果）
    let docsText = ''
    if (scope === 'all' || scope === 'docs') {
      try {
        const dr = await runCli(['docs', 'search', name, '--limit', String(limit)], env().PROJECT, signal)
        if (dr.exitCode === 0 && dr.stdout.trim()) docsText = dr.stdout.trim()
        else if (dr.stderr.trim()) docsText = '[docs stderr] ' + dr.stderr.trim()
      } catch (err) {
        docsText = '[docs 检索失败] ' + (err && err.message ? err.message : String(err))
      }
    }
    const parts = ['$ dcli__api_lookup name=' + name + (scope !== 'all' ? ' scope=' + scope : '')]
    let sdkTotal = 0
    for (const area of areas) {
      if (!sdkMatches[area].length) continue
      parts.push('\n## SDK 签名（' + area + '）')
      for (const m of sdkMatches[area]) {
        parts.push('[' + m.file + ':' + m.start + ']')
        parts.push(m.text)
        parts.push('')
      }
      sdkTotal += sdkMatches[area].length
    }
    if (!sdkTotal) parts.push('\n## SDK 签名：无命中（可换关键词，或 scope=docs 只查文档库）')
    if (scope === 'all' || scope === 'docs') {
      parts.push('\n## 本地文档库（用 dcli__docs_read 读全文）')
      parts.push(docsText || '（无命中）')
    }
    parts.push('\n[SDK 根: ' + path.join(env().DEVECO_HOME, 'sdk', 'default') + ']')
    return { command: 'dcli__api_lookup ' + name, exitCode: 0, stdout: parts.join('\n'), stderr: '' }
  }
  // ── dcli__agents_md：生成/刷新工程根 AGENTS.md（managed markers 只替换托管块） ──
  // 纯函数（可被 test/ 直接导入）：见模块级 AGENTS_* / splitManaged / renderAgentsMdContent。
  async function agentsMd(args) {
    const root = (args && args.projectPath) || env().PROJECT
    const bpPath = path.join(root, 'build-profile.json5')
    if (!fs.existsSync(bpPath)) throw new Error('未找到 build-profile.json5（' + bpPath + '），不是有效的 HarmonyOS 工程根')
    let bp
    try { bp = parseJson5(fs.readFileSync(bpPath, 'utf8')) } catch (err) { throw new Error('build-profile.json5 解析失败：' + err.message) }
    const products = ((bp.app && bp.app.products) || []).map((p) => ({ name: p.name, signingConfig: p.signingConfig || '', targetSdkVersion: p.targetSdkVersion || '', compatibleSdkVersion: p.compatibleSdkVersion || '' }))
    const modules = (bp.modules || []).map((m) => m.name)
    if (!modules.length) throw new Error('build-profile.json5 中无 modules 数组')
    const firstMod = modules[0]
    const bundleName = (() => {
      // bundleName 在工程根 AppScope/app.json5（module.json5 没有）
      try {
        const j = parseJson5(fs.readFileSync(path.join(root, 'AppScope', 'app.json5'), 'utf8'))
        if (j.app && j.app.bundleName) return j.app.bundleName
      } catch { /* 回退到 module.json5 */ }
      try {
        const j = parseJson5(fs.readFileSync(path.join(root, firstMod, 'src', 'main', 'module.json5'), 'utf8'))
        return (j.app && j.app.bundleName) || ''
      } catch { return '' }
    })()
    const pages = (() => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(root, firstMod, 'src', 'main', 'resources', 'base', 'profile', 'main_pages.json'), 'utf8'))
        return (j.src || []).join(', ')
      } catch { return '' }
    })()
    const targetSdk = (products[0] && products[0].targetSdkVersion) || ''
    const compatSdk = (products[0] && products[0].compatibleSdkVersion) || ''
    const facts = { name: path.basename(root), bundleName, modules, products, targetSdk, compatSdk, pages }
    const oldPath = path.join(root, 'AGENTS.md')
    const existing = fs.existsSync(oldPath) ? fs.readFileSync(oldPath, 'utf8') : ''
    const content = renderAgentsMdContent(facts, existing)
    const change = summarizeAgentsMdChange(existing, content)
    const apply = args && args.apply === true
    const summary = [
      (apply ? '写入模式' : '预览模式（未写入；apply=true 才应用）') + '：' + oldPath,
      '变化：' + (change.changed ? '是' : '否') + '；字符 ' + change.beforeChars + ' → ' + change.afterChars + '；替换区 -' + change.removedChars + '/+' + change.addedChars,
      '模块：' + modules.join(', '),
      'bundleName：' + (bundleName || '（未读取到）'),
      'SDK：targetSdk ' + targetSdk + ' / compatible ' + compatSdk,
      'products：' + products.map((p) => p.name).join(', '),
      'marker 外内容：完整保留',
    ]
    if (!apply && change.changed) {
      summary.push('托管块预览：\n' + MANAGED_OPEN + '\n' + renderManaged(facts).replace(/\n+$/, '') + '\n' + MANAGED_CLOSE)
    }
    if (apply && change.changed) {
      const writeResult = writeAgentsMdWithBackup(oldPath, existing, content)
      if (writeResult.backupPath) summary.push('备份：' + (writeResult.backupCreated ? '' : '沿用已有 ') + writeResult.backupPath)
      summary.push('结果：managed 块已通过原子替换刷新')
    } else if (apply) {
      summary.push('结果：内容已是最新，无需写入')
    }
    return { command: 'dcli__agents_md ' + root + (apply ? ' --apply' : ' --preview'), exitCode: 0, stdout: summary.join('\n'), stderr: '' }
  }


  // ── dcli__lsp_check / dcli__lsp_restart：LSP 常驻实例池（每工程一个诊断实例） ──
  // 协议交互用官方 MCP SDK Client（与 dsh-mcp-client 同款）：手写 stdio framing 无法完成
  // initialize（实测超时），SDK Client 1 秒内连接成功。实例在宿主进程内 spawn 并常驻复用。
  const LSP_INSTANCES = new Map() // projectPath -> instance
  async function lspInstance(projectPath) {
    const existing = LSP_INSTANCES.get(projectPath)
    if (existing && !existing.closed) return existing
    const e = env()
    if (!e.cliOk) throw new Error(cliMissingError(e, 'LSP 检查需要 deveco-cli'))
    const inst = { closed: false, client: null, transport: null }
    // 不手工复制 process.env：SDK 的 StdioClientTransport 会用白名单默认环境合并我们
    // 注入的覆盖项（PROJECT_PATH/DEVECO_CLI_SKIP_VERSION_CHECK），避免整份拷贝。
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [e.CLI, 'serve', 'mcp'],
      cwd: projectPath,
      env: { PROJECT_PATH: projectPath, DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'dcli-tools', version: '1' }, { capabilities: {} })
    transport.onerror = (e) => { inst.closed = true }
    try {
      await client.connect(transport)
    } catch (err) {
      inst.closed = true
      try {
        const closed = transport.close()
        if (closed && typeof closed.then === 'function') closed.catch(() => {})
      } catch { /* 忽略 */ }
      throw new Error('LSP 实例连接失败（' + projectPath + '）：' + (err && err.message ? err.message : String(err)))
    }
    inst.client = client
    inst.transport = transport
    LSP_INSTANCES.set(projectPath, inst)
    return inst
  }
  async function lspCallTool(projectPath, name, args, timeoutMs) {
    const inst = await lspInstance(projectPath)
    const result = await inst.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs })
    return result || {}
  }
  function lspResultText(result) {
    return (Array.isArray(result.content) ? result.content : []).map((c) => c.text || '').filter(Boolean).join('\n')
  }
  async function lspCheck(args) {
    const root = (args && args.projectPath) || env().PROJECT
    if (!fs.existsSync(path.join(root, 'build-profile.json5'))) throw new Error('未找到 build-profile.json5（' + path.join(root, 'build-profile.json5') + '），请传 projectPath 指向工程根')
    if (!args.files || !args.files.length) throw new Error('files 必填（相对工程根的文件路径列表）')
    const t0 = Date.now()
    const result = await lspCallTool(root, 'check', { files: args.files }, 300000)
    const out = lspResultText(result)
    if (result.isError) throw new Error('$ dcli__lsp_check ' + root + '\n' + (out || '(LSP check 失败)'))
    return { command: 'dcli__lsp_check ' + root, exitCode: 0, stdout: (out || '（无诊断）') + '\n[耗时 ' + (Date.now() - t0) + 'ms]', stderr: '' }
  }
  async function lspRestart(args) {
    const root = (args && args.projectPath) || env().PROJECT
    if (!fs.existsSync(path.join(root, 'build-profile.json5'))) throw new Error('未找到 build-profile.json5（' + path.join(root, 'build-profile.json5') + '），请传 projectPath 指向工程根')
    const inst = LSP_INSTANCES.get(root)
    if (!inst || inst.closed) return { command: 'dcli__lsp_restart ' + root, exitCode: 0, stdout: '该工程 LSP 实例尚未启动（首次 dcli__lsp_check 时自动创建）', stderr: '' }
    const result = await lspCallTool(root, 'restart', { target: args.target || 'all' }, 30000)
    const out = lspResultText(result)
    if (result.isError) throw new Error('$ dcli__lsp_restart ' + root + '\n' + (out || '(restart 失败)'))
    return { command: 'dcli__lsp_restart ' + root, exitCode: 0, stdout: out || '（已请求重启）', stderr: '' }
  }
  function disposeLspInstances() {
    for (const inst of LSP_INSTANCES.values()) {
      disposeLspInstance(inst)
    }
    LSP_INSTANCES.clear()
  }

  function makeExecutor(tool) {
    return async (args, exec) => {
      // 参数安全 + 工程 cwd：浅拷贝 args 构造 effectiveArgs；未显式传 projectPath 时，
      // 用当前 agent session 的 cwd（exec.agent.session.header.cwd）兜底。所有 kind 都用 effectiveArgs。
      const effective = Object.assign({}, args || {})
      if (!effective.projectPath && exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd) {
        effective.projectPath = exec.agent.session.header.cwd
      }
      if (tool.kind === 'hdc') return installHap(effective, exec.signal)
      if (tool.kind === 'lookup') return apiLookup(effective, exec.signal)
      if (tool.kind === 'agents-md') return agentsMd(effective)
      if (tool.kind === 'dual-signing') return configureDualSigning(effective)
      if (tool.kind === 'lsp') return lspCheck(effective)
      if (tool.kind === 'lsp-restart') return lspRestart(effective)
      let argv
      try {
        argv = tool.buildArgs(effective)
      } catch (err) {
        throw new Error(err && err.message ? err.message : String(err))
      }
      if (tool.kind === 'hdc-cmd') {
        const hr = await hdcRun(argv, exec.signal)
        if (hr.exitCode !== 0) throw new Error('$ hdc ' + argv.join(' ') + '\n' + hr.stdout + (hr.stderr ? '\n[stderr]\n' + hr.stderr : '') + '\n[exit code: ' + hr.exitCode + ']')
        return { command: 'hdc ' + argv.join(' '), exitCode: hr.exitCode, stdout: hr.stdout, stderr: hr.stderr }
      }
      if (tool.kind === 'hvigor') {
        const hr = await runHvigor(argv, effective.projectPath, exec.signal)
        if (hr.exitCode !== 0) throw new Error('$ hvigorw ' + argv.join(' ') + '\n' + hr.stdout + (hr.stderr ? '\n[stderr]\n' + hr.stderr : '') + '\n[exit code: ' + hr.exitCode + ']')
        return { command: 'hvigorw ' + argv.join(' '), exitCode: hr.exitCode, stdout: hr.stdout, stderr: hr.stderr }
      }
      const result = await runCli(argv, effective.projectPath, exec.signal)
      if (result.exitCode !== 0) throw new Error('$ devecocli ' + argv.join(' ') + '\n' + result.stdout + (result.stderr ? '\n[stderr]\n' + result.stderr : '') + '\n[exit code: ' + result.exitCode + ']')
      return { command: 'devecocli ' + argv.join(' '), exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
    }
  }

  // PTC Mode 兼容（run_code）：绑定桥要求工具参数必须是 lossless JSON，模型省略参数
  // （tools.name() 传 undefined）会被拒。给无参工具注入一个可选 exec 字段，让 SDK
  // 签名非空、模型更倾向传参数对象（{} 或 { exec: ... }）；executor 一律忽略该字段。
  // TOOLS 的 parameters 是参数 spec 格式（字段映射），无参工具为空对象 {}。
  const normalizeParams = (tool) => {
    const spec = tool.parameters || {}
    if (Object.keys(spec).length > 0) return spec
    return {
      exec: { type: 'string', description: '调用上下文标识（可选，通常传空对象 {}）' },
    }
  }

  const definitions = TOOLS.map((tool) => defineTool({
    name: tool.name,
    description: tool.description,
    parameters: normalizeParams(tool),
    output: OUTPUT,
    timeoutMs: tool.timeoutMs,
    execute: makeExecutor(tool),
  }))

  ctx.effect(() => {
    const disposers = definitions.map((d) => ctx.tools.register(d))
    return () => {
      for (const dispose of disposers) dispose()
      disposeLspInstances()
    }
  }, 'dcli-tools')
}
