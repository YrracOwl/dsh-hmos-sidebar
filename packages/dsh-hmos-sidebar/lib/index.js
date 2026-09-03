// dsh-hmos-sidebar — host half
//
// Serves POST /hmos/api/<method> JSON RPC for the client half.
// 动作级方法（不再接受任意 argv）：
//   info / install-cli / tools / devices / probe / app-icon / hap-info /
//   sync / build / clean / logs / screenshot / start / install
//
// 本文件不再注册 41 个 dcli__* 模型工具：工具由预设单独通过 package export
// "./tools"（lib/dcli-tools.mjs）挂载，host 半只保留浏览器 RPC 通道。
//
// No dynamic-plugin harness here: npm-package host halves talk to their
// client half over webServer routes (same pattern as dsh-better-sidebar).
// Installed via dsh.profile.bundles (or a patch insert row), survives web
// restarts, no approval needed.

import path from 'node:path'
import fs from 'node:fs'
import Schema from '@deepseek-ai/schemastery'
import { TOOLS } from './dcli-tools.mjs'
import {
  resolveEnv,
  cliMissingError,
  studioMissingError,
} from './environment.js'
import { validateBundleName, validateSafeName } from './validate.js'

export const name = 'dsh-hmos-sidebar'
export const inject = ['webServer', 'subprocess']

// ---- 官方设置命名空间（设置 → 插件 → HarmonyOS 工作台）----
// 两个布尔开关（默认均为 true，安静模式）：
//   popup.keepCollapsed      默认不展开弹窗：检测到鸿蒙工程也不自动展开工作台面板；
//                            关闭后，当前工作区探测到鸿蒙工程时客户端自动展开一次。
//   ball.hideWithoutProject  在非鸿蒙工作区默认不展示悬浮球；关闭后悬浮球始终显示。
// 注册保持可选：settings 服务不存在时，客户端回退到这里的内置默认值。
export const SETTINGS_NS = 'hmos-sidebar'

export const DEFAULT_SETTINGS = {
  popup: { keepCollapsed: true },
  ball: { hideWithoutProject: true },
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function cloneSettings(value) {
  return JSON.parse(JSON.stringify(value || DEFAULT_SETTINGS))
}

function createSettingsSchema() {
  return Schema.object({
    popup: Schema.object({
      keepCollapsed: Schema.boolean().default(DEFAULT_SETTINGS.popup.keepCollapsed),
    }).default(cloneSettings(DEFAULT_SETTINGS.popup)),
    ball: Schema.object({
      hideWithoutProject: Schema.boolean().default(DEFAULT_SETTINGS.ball.hideWithoutProject),
    }).default(cloneSettings(DEFAULT_SETTINGS.ball)),
  })
}

function validateSettings(value) {
  if (!isPlainObject(value)) throw new Error('settings must be a JSON object')
  if (!isPlainObject(value.popup) || typeof value.popup.keepCollapsed !== 'boolean') {
    throw new Error('popup.keepCollapsed must be a boolean')
  }
  if (!isPlainObject(value.ball) || typeof value.ball.hideWithoutProject !== 'boolean') {
    throw new Error('ball.hideWithoutProject must be a boolean')
  }
}

function fsExists(p) {
  try { return fs.existsSync(p) } catch { return false }
}

// 有效 Harmony 工程根：同时存在 build-profile.json5 与 AppScope/app.json5。
// 浏览器传 cwd/path 时按此校验——比仅限 Host process.cwd 更可用（公共无配置包可手动选工程），
// 又拒绝任意目录。
export function isHarmonyProjectRoot(p) {
  const root = String(p || '').replace(/\//g, '\\')
  if (!root) return false
  return fsExists(path.join(root, 'build-profile.json5')) && fsExists(path.join(root, 'AppScope', 'app.json5'))
}

// 从一个工作区目录有界查找 Harmony 工程。当前会话 cwd 往往是工程根，
// 也可能是装有多个工程的父目录；旧实现只扫 config.projectRoots 第一层，
// 因而既看不到当前 session cwd，也漏掉更深一层的工程。
export function findHarmonyProjectRoots(start, options = {}) {
  const root = String(start || '').replace(/\//g, '\\')
  if (!root || !fsExists(root)) return []
  const maxDepth = Number.isInteger(options.maxDepth) ? Math.max(0, Math.min(8, options.maxDepth)) : 3
  const maxProjects = Number.isInteger(options.maxProjects) ? Math.max(1, Math.min(100, options.maxProjects)) : 20
  const maxVisited = Number.isInteger(options.maxVisited) ? Math.max(1, Math.min(10000, options.maxVisited)) : 1000
  const found = []
  const queue = [{ dir: root, depth: 0 }]
  const seen = new Set()
  while (queue.length && seen.size < maxVisited && found.length < maxProjects) {
    const item = queue.shift()
    let real
    try { real = fs.realpathSync.native ? fs.realpathSync.native(item.dir) : fs.realpathSync(item.dir) } catch { continue }
    const key = String(real).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (isHarmonyProjectRoot(real)) {
      found.push(projRootDir(real))
      continue
    }
    if (item.depth >= maxDepth) continue
    let entries
    try { entries = fs.readdirSync(real, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
      queue.push({ dir: path.join(real, entry.name), depth: item.depth + 1 })
    }
  }
  return found
}

const projRootDir = (p) => String(p || '').replace(/\//g, '\\')

// install 校验：必须现存 .hap 文件；配置了可信根（projectPath/projectRoots）时还须落在根内。
export function validateInstallHap(hap, roots) {
  const p = projRootDir(hap)
  if (!p) return { ok: false, error: 'install 需要 hapPath' }
  if (!p.toLowerCase().endsWith('.hap')) return { ok: false, error: 'install 只接受 .hap 文件: ' + p }
  if (!fsExists(p)) return { ok: false, error: 'HAP 文件不存在: ' + p }
  const inside = withinTrusted(p, roots, 'HAP 文件')
  if (!inside.ok) return inside
  return { ok: true, path: p }
}

// hap-info 校验：必须现存 .hap/.app 文件；配置了可信根时还须落在根内。
export function validateHapInfo(pathVal, roots) {
  const p = projRootDir(pathVal)
  if (!p) return { ok: false, error: 'hap-info 需要 path' }
  const lower = p.toLowerCase()
  if (!lower.endsWith('.hap') && !lower.endsWith('.app')) return { ok: false, error: 'hap-info 只接受 .hap/.app 文件: ' + p }
  if (!fsExists(p)) return { ok: false, error: '文件不存在: ' + p }
  const inside = withinTrusted(p, roots, 'HAP/App 文件')
  if (!inside.ok) return inside
  return { ok: true, path: p, app: lower.endsWith('.app') }
}

const SKIP_DIRS = new Set(['node_modules', 'oh_modules', '.hvigor', '.idea', '.git', 'build', '.cxx', '.preview'])
const SKIP_FILES = new Set(['.DS_Store'])

const MAX_BODY = 64 * 1024 // 请求体上限 64KiB
const MAX_OUTPUT = 4000000
const MAX_STDERR = 2000000

// 中性截图目录：不写任何个人绝对路径。优先级 config.screenshotDir → 工程下 .dsh-screenshots
// → OS 临时目录下 dsh-hmos-screenshots。host 提供，client 端到端不关心具体盘符。
export function defaultScreenshotDir(cfg, projectPath) {
  if (cfg && typeof cfg.screenshotDir === 'string' && cfg.screenshotDir) return cfg.screenshotDir
  if (projectPath) return path.join(projectPath, '.dsh-screenshots')
  return path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'dsh-hmos-screenshots')
}

// Windows 路径归一化：正斜杠→反斜杠、去尾部反斜杠（比较用，不含 realpath）
function normWin(p) {
  return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '')
}

// realpath 最近存在父目录策略：
//   - 目标存在 → fs.realpathSync 跟随 junction/reparse point 解析真实位置；
//   - 目标尚不存在（如 screenshot 目标）→ 向上找到最近存在的祖先做 realpath，
//     再拼回剩余段，防止「工程内 junction 指向外部 + 尚不存在的尾段」逃逸。
export function resolveRealWinPath(p) {
  const raw = String(p || '').trim()
  if (!raw) return ''
  let lexical
  try {
    lexical = path.win32.resolve(raw)
  } catch {
    lexical = normWin(raw)
  }
  let cur = lexical
  const tail = []
  for (let i = 0; i < 64; i++) {
    let real
    try {
      real = fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur)
      return tail.length ? path.win32.join(real, ...tail) : real
    } catch {
      const parent = path.win32.dirname(cur)
      if (parent === cur) return lexical // 已到根仍不存在：退回词法归一化结果
      tail.unshift(path.win32.basename(cur))
      cur = parent
    }
  }
  return lexical
}

// 判断 target 是否位于任一允许根（或其自身=该根）内。
// 大小写不敏感（path.win32.relative 内部 lowercases）；用 realpath + 词法归一化
// 拒绝 `C:\proj\..\outside\x.hap`、UNC `..` 逃逸与兄弟前缀（`C:\proj2` 之于 `C:\proj`）。
export function isWithinAny(target, roots) {
  const t = resolveRealWinPath(target)
  if (!t) return false
  for (const r of roots || []) {
    const base = resolveRealWinPath(r)
    if (!base) continue
    let rel
    try { rel = path.win32.relative(base, t) } catch { continue }
    if (rel === '') return true
    if (rel !== '..' && !rel.startsWith('..\\') && !path.win32.isAbsolute(rel)) return true
  }
  return false
}

// 取给定动作的可信根集合（去重、Windows 归一化）。
// 只收「显式」来源：config.projectPath、环境变量 PROJECT_PATH、config.projectRoots。
// resolveEnv 的 PROJECT 会兜底到 process.cwd()，但 cwd 不是显式根，绝不混入——
// 有 projectRoots 而无 projectPath 时也不偷偷加入 cwd。
export function trustedRoots(config) {
  const cfg = config || {}
  const list = []
  const seen = new Set()
  const push = (p) => {
    if (!p) return
    const key = normWin(p).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    list.push(normWin(p))
  }
  if (cfg.projectPath) push(cfg.projectPath)
  if (process.env.PROJECT_PATH) push(process.env.PROJECT_PATH)
  for (const r of (Array.isArray(cfg.projectRoots) ? cfg.projectRoots : [])) push(r)
  return list
}

// 路径围栏：配置了可信根（projectPath/projectRoots）时，目标路径必须落在其中；
// 无可信根时保持宽松（仅后缀+存在校验），不破坏无配置用法。
export function withinTrusted(p, roots, label) {
  if (!roots || !roots.length) return { ok: true }
  const what = label || '路径'
  if (!isWithinAny(p, roots)) return { ok: false, error: what + '不在可信根内（projectPath/projectRoots）: ' + String(p) + '；可信根: ' + roots.join('; ') }
  return { ok: true }
}

// logs 端点 tail 钳制：页面值可任意大，输出虽有 MAX_OUTPUT 兜底，仍显式钳制在 1..10000。
export function sanitizeTail(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 200
  return Math.max(1, Math.min(10000, Math.floor(n)))
}

// ---- loopback / same-origin fence (mirrors dsh-better-sidebar, tightened) ----
export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}
// 同源 fence：
//   - Host 须为 loopback；
//   - 浏览器 sec-fetch-site 若存在，仅允许 same-origin / same-site；
//   - 有 Origin：仅 http/https 且 host:port 与 Host 完全一致；
//   - 无 Origin（非浏览器探针或没有同源声明的浏览器请求）：必须同时带
//     sec-fetch-site=same-origin/same-site，否则拒绝。
export function fence(req) {
  const host = req.headers && req.headers.host
  if (!host) return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  const secFetchSite = req.headers['sec-fetch-site']
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site') return false
  const origin = req.headers.origin
  if (origin === undefined) {
    // 无 Origin：仅当浏览器明确声明同源才放行，否则拒绝非浏览器请求
    return secFetchSite === 'same-origin' || secFetchSite === 'same-site'
  }
  try {
    const o = new URL(origin)
    if (o.protocol !== 'http:' && o.protocol !== 'https:') return false
    return o.host === hostUrl.host
  } catch { return false }
}

export function apply(ctx, config) {
  const env = () => resolveEnv(config || {})
  const sub = ctx.subprocess

  // 官方设置（设置 → 插件 → HarmonyOS 工作台）：注册命名空间供设置卡片读写，
  // 客户端半直接通过 settingsScope 订阅解析值。settings 服务缺失时静默跳过——
  // 悬浮球/弹窗回退到 DEFAULT_SETTINGS 的安静默认值，主功能不受影响。
  ctx.inject(['settings'], (sctx) => {
    try {
      sctx.settings.register(SETTINGS_NS, createSettingsSchema(), {
        base: cloneSettings(DEFAULT_SETTINGS),
        applies: 'live',
        validate: validateSettings,
      })
    } catch {
      // 设置保持可选：重复注册或服务异常时，客户端仍按默认值工作。
    }
  })

  // 校验并归一化浏览器传入的工程目录；未传时回退到环境 PROJECT（也须是有效工程根）。
  function resolveProjectDir(requested) {
    const root = projRootDir(requested) || env().PROJECT
    if (!root) throw new Error('未指定工程目录')
    if (!isHarmonyProjectRoot(root)) throw new Error('不是有效的 Harmony 工程根（需同时存在 build-profile.json5 与 AppScope/app.json5）: ' + root)
    return root
  }

  // 读取请求体，限制 64KiB；超限稳定 reject(statusCode=413)。
  // 超限只 pause、不 destroy：连接保持到 413 响应写完，再由 handler 的
  // res.end 回调里 destroy，避免 413 随连接拆除而丢。
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      let settled = false
      const fail = (er) => { if (!settled) { settled = true; reject(er) } }
      const done = (body) => { if (!settled) { settled = true; resolve(body) } }
      req.on('data', (c) => {
        if (settled) return
        size += c.length
        if (size > MAX_BODY) {
          fail(Object.assign(new Error('request body too large'), { statusCode: 413 }))
          try { req.pause() } catch {}
          return
        }
        chunks.push(c)
      })
      req.on('end', () => { if (!settled) done(Buffer.concat(chunks).toString('utf8')) })
      req.on('error', (er) => fail(er))
    })
  }

  async function spawnAndRead(spec) {
    const handle = sub.spawn(spec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { exitCode: outcome.exitCode === null ? 1 : outcome.exitCode, stdout, stderr }
  }

  // devecocli 动作（build/clean/logs/screenshot 等共用）——CLI 缺失报可操作错误
  async function runDcli(argv, cwdOverride, extraEnv) {
    const e = env()
    if (!e.cliOk) throw new Error(cliMissingError(e))
    return spawnAndRead({
      argv: [process.execPath, e.CLI, ...argv],
      cwd: cwdOverride || e.PROJECT,
      env: Object.assign({ DEVECO_CLI_SKIP_VERSION_CHECK: '1' }, extraEnv || {}),
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 3000,
    })
  }

  async function runHdc(argv) {
    const e = env()
    if (!e.hdcOk) throw new Error(studioMissingError(e, '需要可用的 hdc（DevEco Studio SDK 的 toolchains/hdc.exe）'))
    return spawnAndRead({
      argv: [e.HDC, ...argv],
      cwd: e.PROJECT,
      env: { DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 3000,
    })
  }

  async function runHvigor(argv, cwdOverride) {
    const e = env()
    if (!e.hvigorOk) throw new Error(studioMissingError(e, '需要 DevEco Studio 自带 hvigor（tools/hvigor/bin/hvigorw.js）'))
    return spawnAndRead({
      argv: [process.execPath, e.HVIGORW, ...argv],
      cwd: cwdOverride || e.PROJECT,
      env: { DEVECO_SDK_HOME: path.join(e.DEVECO_HOME, 'sdk'), DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 3000,
    })
  }

  async function tarExtract(hapPath, member) {
    const e = env()
    const handle = sub.spawn({
      argv: [e.TAR, '-xOf', hapPath, member],
      cwd: e.PROJECT,
      env: {},
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1000000 }, stderr: { maxBytes: 200000 } },
      graceMs: 3000,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { ok: outcome.exitCode === 0, exitCode: outcome.exitCode, stdout, stderr }
  }

  async function parseJson5File(filePath) {
    const e = env()
    if (!e.json5Ok) return { ok: false, error: '未找到 json5 模块（deveco-cli 未安装或路径异常）' }
    const script = [
      'const J = require(' + JSON.stringify(e.JSON5_DIR) + ')',
      "const fs = require('fs')",
      'const p = process.argv[1]',
      'try {',
      "  const v = J.parse(fs.readFileSync(p, 'utf8'))",
      '  process.stdout.write(JSON.stringify({ ok: true, value: v }))',
      '} catch (e) {',
      '  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) }))',
      '}',
    ].join('\n')
    const node = await sub.resolveExecutable('node')
    const handle = sub.spawn({
      argv: [node, '-e', script, filePath],
      cwd: e.PROJECT,
      env: {},
      stdio: { stdin: 'ignore', stdout: { maxBytes: 2000000 }, stderr: { maxBytes: 100000 } },
      graceMs: 3000,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    if (outcome.exitCode !== 0) return null
    try { return JSON.parse(stdout) } catch { return null }
  }

  // 递归扫描工程根下所有 build 产物（多模块：entry/feature 各自 build 目录；多模式：default/debug/release）
  async function findArtifacts(root) {
    const fsSvc = ctx.get('fs')
    const found = []
    const seen = new Set()
    const starts = [root + '\\build']
    try {
      const rt = await fsSvc.resolve(root)
      const entries = await fsSvc.listDir(rt)
      for (const entry of entries) {
        if (entry.type !== 'directory') continue
        if (entry.name === 'AppScope' || entry.name === '.git' || entry.name === '.idea' || entry.name === '.hvigor') continue
        starts.push(root + '\\' + entry.name + '\\build')
      }
    } catch {}
    async function walk(dir, depth) {
      if (depth <= 0) return
      let entries = []
      try {
        const target = await fsSvc.resolve(dir)
        entries = await fsSvc.listDir(target)
      } catch { return }
      for (const entry of entries) {
        const full = dir.replace(/\\+$/, '') + '\\' + entry.name
        if (entry.type === 'directory') {
          if (entry.name === 'node_modules' || entry.name === 'oh_modules' || entry.name === '.hvigor' || entry.name === '.cxx' || entry.name === '.preview') continue
          await walk(full, depth - 1)
        } else if (entry.type === 'file' && /\.(hap|har|app)$/i.test(entry.name)) {
          if (seen.has(full)) continue
          seen.add(full)
          const lower = entry.name.toLowerCase()
          let kind = 'app'
          if (lower.endsWith('.hap')) kind = 'hap'
          else if (lower.endsWith('.har')) kind = 'har'
          found.push({ name: entry.name, path: full, kind })
        }
      }
    }
    for (const start of starts) await walk(start, 6)
    return found
  }

  // 安装候选排序：.hap 模块包优先于 .app App Pack（.har 归档排最后）；
  // 模式 debug > default > release；签名 signed > unsigned
  function rankArtifact(a) {
    const n = a.name.toLowerCase()
    const kindRank = a.kind === 'hap' ? 0 : a.kind === 'app' ? 1 : 2
    const modeRank = n.includes('debug') ? 0 : n.includes('default') ? 1 : 2
    const signedRank = n.includes('signed') ? 0 : 1
    return kindRank * 100 + modeRank * 10 + signedRank
  }

  const api = {
    async 'hmos/info'(args) {
      const e = env()
      const requestedProject = projRootDir(args && args.path)
      return {
        projectPath: requestedProject || e.PROJECT,
        cliPath: e.CLI,
        devEcoHome: e.DEVECO_HOME,
        hdc: e.HDC,
        hvigor: e.HVIGORW,
        json5: e.JSON5_DIR,
        json5Ok: e.json5Ok,
        cliOk: e.cliOk,
        devEcoOk: e.devEcoOk,
        cliSource: e.cliSource,
        devEcoSource: e.devEcoSource,
        shotDir: defaultScreenshotDir(config, e.PROJECT),
      }
    },
    // 安装 deveco-cli（npm 全局包，可自动装；DevEco Studio 是 GUI 安装包，只能引导下载）
    async 'hmos/install-cli'() {
      try {
        const e = env()
        const isWin = process.platform === 'win32'
        let argv = []
        if (isWin) {
          const npmCliCandidates = [
            path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
            path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
            path.join(process.env.PROGRAMFILES || '', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
            path.join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          ]
          const npmCli = npmCliCandidates.find((p) => fsExists(p))
          if (!npmCli) return { ok: false, error: '未找到 npm（npm-cli.js），请先安装 Node.js 或手动运行：npm install -g @deveco/deveco-cli' }
          argv = [process.execPath, npmCli, 'install', '-g', '@deveco/deveco-cli']
        } else {
          argv = ['npm', 'install', '-g', '@deveco/deveco-cli']
        }
        const handle = sub.spawn({
          argv,
          cwd: e.PROJECT,
          env: { DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
          stdio: { stdin: 'ignore', stdout: { maxBytes: 2000000 }, stderr: { maxBytes: 200000 } },
          graceMs: 5000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
        const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
        const ok = outcome.exitCode === 0
        let globalVersion = ''
        let globalOk = false
        try {
          const vh = sub.spawn({
            argv: isWin ? [process.execPath, argv[1], 'ls', '-g', '@deveco/deveco-cli'] : ['npm', 'ls', '-g', '@deveco/deveco-cli'],
            cwd: e.PROJECT,
            env: { DEVECO_CLI_SKIP_VERSION_CHECK: '1' },
            stdio: { stdin: 'ignore', stdout: { maxBytes: 200000 }, stderr: { maxBytes: 50000 } },
            graceMs: 3000,
          })
          const vo = await vh.done
          const vout = vh.collected.stdout ? vh.collected.stdout.readFrom(0).text : ''
          if (vo.exitCode === 0 || vout.includes('@deveco/deveco-cli')) {
            const m = vout.match(/@deveco\/deveco-cli@([\d.]+)/)
            if (m) globalVersion = m[1]
            globalOk = true
          }
        } catch {}
        const e2 = env()
        return {
          ok,
          exitCode: outcome.exitCode,
          stdout,
          stderr,
          cliOk: e2.cliOk,
          cliPath: e2.CLI,
          globalOk,
          globalVersion,
          platform: process.platform,
        }
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    // dcli__* 命令速查清单（供 UI「速查」Tab）：从子模块 TOOLS 表映射
    async 'hmos/tools'() {
      try {
        const list = TOOLS.map((t) => {
          const params = []
          const pdefs = t.parameters || {}
          for (const pname of Object.keys(pdefs)) {
            const p = pdefs[pname] || {}
            params.push({
              name: pname,
              description: p.description || '',
              required: p.required === true,
              type: p.type || 'string',
              enum: Array.isArray(p.enum) ? p.enum : undefined,
            })
          }
          return { name: t.name, description: t.description, kind: t.kind || 'cli', timeoutMs: t.timeoutMs, params }
        })
        return { ok: true, tools: list }
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    // 结构化设备列表：hdc list targets -v（制表符分隔，剥 ANSI）
    async 'hmos/devices'() {
      try {
        const r = await runHdc(['list', 'targets', '-v'])
        const text = r.stdout.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '')
        const devices = []
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          const cols = line.split('\t').map((c) => c.trim())
          if (!cols[0]) continue
          const state = (cols[3] || '').toLowerCase()
          if (state && state !== 'connected' && state !== 'ready') continue
          devices.push({
            serial: cols[0],
            transport: cols[2] || '',
            state: state || 'connected',
            connect: cols[4] || '',
            kind: (cols[5] || cols[2] || '').toLowerCase().includes('emulator') ? 'emulator' : 'device',
          })
        }
        return { ok: true, devices }
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    // 构建（动作级）：devecocli build --build-mode <debug|release>
    async 'hmos/build'(args) {
      try {
        const buildMode = (args && args.buildMode) === 'release' ? 'release' : 'debug'
        const r = await runDcli(['build', '--build-mode', buildMode], resolveProjectDir((args && args.cwd)))
        return Object.assign({ ok: r.exitCode === 0, action: 'build', buildMode }, r)
      } catch (er) {
        return { ok: false, action: 'build', error: String((er && er.message) || er) }
      }
    },
    // 清理构建产物（动作级）
    async 'hmos/clean'(args) {
      try {
        const r = await runDcli(['build', 'clean'], resolveProjectDir((args && args.cwd)))
        return Object.assign({ ok: r.exitCode === 0, action: 'clean' }, r)
      } catch (er) {
        return { ok: false, action: 'clean', error: String((er && er.message) || er) }
      }
    },
    // 设备日志（动作级）：devecocli log，支持 tail / crash
    async 'hmos/logs'(args) {
      try {
        const argv = ['log']
        if (args && args.device) argv.push('--device', args.device)
        if (args && args.crash) argv.push('--crash')
        if (args && args.tail !== undefined && args.tail !== null && args.tail !== '') argv.push('--tail', String(sanitizeTail(args.tail)))
        const r = await runDcli(argv, (args && args.cwd) || undefined)
        return Object.assign({ ok: r.exitCode === 0, action: 'logs' }, r)
      } catch (er) {
        return { ok: false, action: 'logs', error: String((er && er.message) || er) }
      }
    },
    // 屏幕截图（动作级）：devecocli ui screenshot；path 缺省用 host 提供的中性目录
    async 'hmos/screenshot'(args) {
      try {
        const e = env()
        if (!e.cliOk) return { ok: false, action: 'screenshot', error: cliMissingError(e) }
        const shotDir = defaultScreenshotDir(config, e.PROJECT)
        if (!fsExists(shotDir)) { try { fs.mkdirSync(shotDir, { recursive: true }) } catch {} }
        const pathVal = (args && args.path) || path.join(shotDir, 'shot_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png')
        // 即使 path 来自默认/配置目录，只要配置了可信根就校验，杜绝 junction 逃逸。
        const roots = trustedRoots(config)
        if (roots.length) {
          const inside = withinTrusted(pathVal, roots, '截图路径')
          if (!inside.ok) return Object.assign(inside, { action: 'screenshot' })
        }
        const argv = ['ui', 'screenshot', '--path', pathVal]
        if (args && args.device) argv.push('--device', args.device)
        if (args && args.display) argv.push('--display', args.display)
        const r = await runDcli(argv, undefined)
        return Object.assign({ ok: r.exitCode === 0, action: 'screenshot', path: pathVal }, r)
      } catch (er) {
        return { ok: false, action: 'screenshot', error: String((er && er.message) || er) }
      }
    },
    // 工程同步：走 hvigorw.js（devecocli 无 --sync；hvigor 是同步的唯一正确通道）。
    // 不接受 args.argv——只允许通过 product/buildMode 构造，杜绝任意 argv 注入。
    async 'hmos/sync'(args) {
      try {
        const argv = ['--sync', '-p', 'product=' + ((args && args.product) || 'default'), '-p', 'buildMode=' + ((args && args.buildMode) || 'debug'), '--analyze=normal', '--parallel', '--incremental']
        const r = await runHvigor(argv, resolveProjectDir((args && args.cwd)))
        return Object.assign({ ok: r.exitCode === 0 }, r)
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    // 启动应用（动作级）：hdc shell aa start -a EntryAbility -b <bundleName>
    async 'hmos/start'(args) {
      try {
        const bundleName = validateBundleName(args && args.bundleName, { required: true })
        const abilityName = validateSafeName(args && args.abilityName, { label: 'abilityName' }) || 'EntryAbility'
        const moduleName = validateSafeName(args && args.moduleName, { label: 'moduleName' })
        const argv = []
        if (args && args.device) argv.push('-t', args.device)
        argv.push('shell', 'aa', 'start', '-a', abilityName, '-b', bundleName)
        if (moduleName) argv.push('-m', moduleName)
        const r = await runHdc(argv)
        return Object.assign({ ok: r.exitCode === 0, action: 'start' }, r)
      } catch (er) {
        return { ok: false, action: 'start', error: String((er && er.message) || er) }
      }
    },
    async 'hmos/install'(args) {
      try {
        const chk = validateInstallHap(args && args.hapPath, trustedRoots(config))
        if (!chk.ok) return chk
        const hap = chk.path
        const bundleName = validateBundleName(args && args.bundleName)
        const dev = args.device ? ['-t', args.device] : []
        const base = hap.split('\\').pop() || 'app'
        const tmp = 'data/local/tmp/' + base.replace(/[^A-Za-z0-9_-]/g, '_') + '-install'
        const steps = []
        if (bundleName) steps.push(['shell', 'aa', 'force-stop', bundleName])
        steps.push(['shell', 'rm', '-rf', tmp], ['shell', 'mkdir', '-p', tmp], ['file', 'send', hap, tmp], ['shell', 'bm', 'install', '-p', tmp])
        const out = []
        for (const step of steps) {
          const full = dev.concat(step)
          out.push('$ hdc ' + full.join(' '))
          const r = await runHdc(full)
          if (r.stdout.trim()) out.push(r.stdout.trim())
          if (r.stderr.trim()) out.push('[stderr] ' + r.stderr.trim())
          if (r.exitCode !== 0) return { ok: false, steps: out, exitCode: r.exitCode }
        }
        return { ok: true, steps: out }
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    async 'hmos/probe'(args) {
      try {
        let root = projRootDir((args && args.path)) || env().PROJECT
        const result = { ok: true, root, foundRoot: '', projects: [], bundleName: '', versionName: '', versionCode: '', hapPath: '', appPath: '', artifacts: [] }
        if (!root || !isHarmonyProjectRoot(root)) {
          // 首先扫描浏览器传入的当前 session cwd；再扫描显式 projectRoots。
          // 去重后保留稳定顺序，首个命中作为当前工程，其余供 UI 后续扩展选择。
          const starts = [root, ...env().projectRoots].filter(Boolean)
          const seen = new Set()
          for (const start of starts) {
            for (const project of findHarmonyProjectRoots(start)) {
              const key = project.toLowerCase()
              if (seen.has(key)) continue
              seen.add(key)
              result.projects.push(project)
              if (!result.foundRoot) result.foundRoot = project
            }
          }
          if (result.foundRoot && root !== result.foundRoot) root = result.foundRoot
        } else {
          result.foundRoot = root
          result.projects.push(root)
        }
        result.root = root
        try {
          const appJson = await parseJson5File(root + '\\AppScope\\app.json5')
          if (appJson && appJson.ok && appJson.value && appJson.value.app) {
            result.bundleName = appJson.value.app.bundleName || ''
            result.versionName = appJson.value.app.versionName || ''
            result.versionCode = String(appJson.value.app.versionCode || '')
          }
        } catch {}
        const artifacts = await findArtifacts(root)
        const ranked = artifacts.slice().sort((a, b) => rankArtifact(a) - rankArtifact(b))
        const installable = ranked.filter((a) => a.kind !== 'har')
        result.artifacts = ranked
        result.hapPath = installable.length ? installable[0].path : ''
        result.appPath = ranked.find((a) => a.kind === 'app') ? ranked.find((a) => a.kind === 'app').path : ''
        return result
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    async 'hmos/app-icon'(args) {
      try {
        const root = projRootDir((args && args.path)) || env().PROJECT || ''
        if (!root || !isHarmonyProjectRoot(root)) return { ok: false, error: '不是有效的 Harmony 工程根（需同时存在 build-profile.json5 与 AppScope/app.json5）: ' + root }
        const candidates = [
          root + '\\AppScope\\resources\\base\\media\\app_icon.png',
          root + '\\AppScope\\resources\\base\\media\\foreground.png',
          root + '\\AppScope\\resources\\base\\media\\app.png',
          root + '\\AppScope\\resources\\base\\media\\icon.png',
          root + '\\AppScope\\resources\\base\\media\\background.png',
          root + '\\entry\\src\\main\\resources\\base\\media\\app_icon.png',
          root + '\\entry\\src\\main\\resources\\base\\media\\foreground.png',
          root + '\\entry\\src\\main\\resources\\base\\media\\startIcon.png',
          root + '\\entry\\src\\main\\resources\\base\\media\\icon.png',
        ]
        let found = candidates.find((p) => fsExists(p)) || ''
        if (!found) {
          try {
            const mods = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
            for (const mod of mods) {
              if (SKIP_DIRS.has(mod)) continue
              const media = root + '\\' + mod + '\\src\\main\\resources\\base\\media'
              if (!fsExists(media)) continue
              const files = fs.readdirSync(media)
              const pick = files.find((f) => /\.(png|jpe?g|webp)$/i.test(f) && /app|icon|logo/i.test(f))
                || files.find((f) => /\.(png|jpe?g|webp)$/i.test(f))
              if (pick) { found = media + '\\' + pick; break }
            }
          } catch {}
        }
        if (!found) return { ok: false, error: '未找到应用图标（AppScope/resources/base/media/ 或模块 media/ 下）' }
        const buf = fs.readFileSync(found)
        if (buf.length > 512 * 1024) return { ok: false, error: '图标过大（' + buf.length + 'B），跳过' }
        const ext = path.extname(found).toLowerCase().replace('.', '')
        const mime = ext === 'jpg' ? 'jpeg' : (ext || 'png')
        return { ok: true, path: found, dataUrl: 'data:image/' + mime + ';base64,' + buf.toString('base64'), size: buf.length }
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
    async 'hmos/hap-info'(args) {
      try {
        const chk = validateHapInfo(args && args.path, trustedRoots(config))
        if (!chk.ok) return chk
        const hap = chk.path
        const member = chk.app ? 'pack.info' : 'module.json'
        const t = await tarExtract(hap, member)
        if (!t.ok) return { ok: false, error: 'tar 抽取 ' + member + ' 失败: ' + (t.stderr || t.stdout || ('exit ' + t.exitCode)) }
        const json = t.stdout.replace(/^\uFEFF/, '').trim()
        let parsed
        try { parsed = JSON.parse(json) } catch (er) {
          return { ok: false, error: '包内 JSON 解析失败: ' + String((er && er.message) || er) + '\n' + json.slice(0, 300) }
        }
        const app = parsed.app || (parsed.summary && parsed.summary.app) || {}
        const mod = parsed.module || (parsed.summary && parsed.summary.modules && parsed.summary.modules[0]) || {}
        const distro = mod.distro || {}
        return {
          ok: true,
          bundleName: app.bundleName || parsed.bundleName,
          versionName: app.versionName || (app.version && app.version.name) || (parsed.summary && parsed.summary.app && parsed.summary.app.version && parsed.summary.app.version.name),
          versionCode: app.versionCode || (app.version && app.version.code) || (parsed.summary && parsed.summary.app && parsed.summary.app.version && parsed.summary.app.version.code),
          moduleName: mod.name || distro.moduleName,
          moduleType: mod.type || distro.moduleType,
          deviceTypes: mod.deviceTypes || mod.deviceType,
          abilities: mod.abilities,
          raw: (() => { try { return JSON.stringify(parsed, null, 2) } catch { return json } })(),
        }
      } catch (er) {
        return { ok: false, error: String((er && er.message) || er) }
      }
    },
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/hmos/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let method = ''
      try { method = decodeURIComponent(new URL(req.url, 'http://dsh.internal').pathname.replace(/^\/hmos\/api\//, '')) } catch { method = '' }
      const handler = api[method]
      if (!handler) {
        res.writeHead(404)
        res.end(JSON.stringify({ ok: false, error: 'unknown method: ' + method }))
        return
      }
      let payload = {}
      let raw = ''
      try {
        raw = await readBody(req)
      } catch (er) {
        const status = er && er.statusCode ? er.statusCode : 400
        res.writeHead(status, { 'content-type': 'application/json' })
        // 响应写完再拆连接：保证 413/400 送达后再释放未读完的请求体
        res.end(JSON.stringify({ ok: false, error: status === 413 ? 'request body too large (>64KiB)' : 'unreadable body' }), () => { try { req.destroy() } catch {} })
        return
      }
      if (raw) {
        try {
          payload = JSON.parse(raw)
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'invalid JSON body' }))
          return
        }
      }
      try {
        const value = await handler(payload)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      } catch (er) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String((er && er.message) || er) }))
      }
    },
  }), 'dsh-hmos-sidebar: /hmos/api routes')
}
