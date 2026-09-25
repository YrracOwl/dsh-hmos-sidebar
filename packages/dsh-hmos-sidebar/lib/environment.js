// environment.js — 统一的 HarmonyOS 工具链环境解析
//
// 供 host 半（lib/index.js）与 dcli 工具子模块（lib/dcli-tools.mjs）共享：
//   cli（deveco-cli 入口）/ DevEco Studio / hdc / hvigor / json5 / 工程根
// 全部统一在这里解析，两个消费方候选一致，不重复维护。
//
// 设计要点：
//   - 每次调用都实时解析（fs 探活 + 环境变量 + config），不缓存。
//     因此 CLI/Studio 在运行期装好或路径变更后，「无需重启」即可被识别。
//   - 解析在任何阶段都不抛异常：缺 CLI 只是把对应路径置空并给出 source=missing，
//     由具体调用方在真正执行时抛出「可操作错误」（含修复提示）。
//   - 平台明确为 Windows-only（与 package os / README 一致）。候选路径用常见安装
//     位置，不含任何个人绝对路径；PROJECT_ROOTS 默认留空、由 config.projectRoots 提供。
//   - 不手工复制 process.env：环境变量仅作为解析输入读取，子进程 env 由 DSH subprocess
//     清理合并，这里不做整份拷贝。
//
// CLI 入口布局不固定（实测）：
//   @deveco/deveco-cli ≥ 1.3.4  package.json#bin = { "devecocli": "cli.js" }
//                               → <root>\node_modules\@deveco\deveco-cli\cli.js
//   @deveco/deveco-cli ≤ 1.3.3  → <root>\node_modules\@deveco\deveco-cli\dist\cli.js
// 所以入口**不写死 dist/cli.js**：先读安装包自己的 package.json#bin 解析真实入口，
// 旧布局仅作为兜底候选。manifest 读不到时安静回退（本模块在宿主启动期与每次工具
// 调用中都会执行，任何一步都不得抛异常）。

import path from 'node:path'
import fs from 'node:fs'

export const WINDOWS_ONLY = true

const DEVECO_CLI_PKG = '@deveco/deveco-cli'
// 官方命令名 = bin 对象的首选键（1.3.4 实测：{ "devecocli": "cli.js" }）
const DEVECO_CLI_BIN = 'devecocli'

function fsExists(p) {
  try { return fs.existsSync(p) } catch { return false }
}

// 读一个 JSON 文件；不存在 / 非法 JSON / 权限不足一律返回 null，绝不抛。
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

// 归一化 bin 的相对路径：兼容 `\` 与 `/`，丢弃 `.` 与空段。
function entrySegments(rel) {
  return String(rel).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.')
}

// ---- 常见安装位置候选（Windows-only，不含个人路径） ----
// deveco-cli 全局 npm 安装根（每个根含 node_modules/@deveco/deveco-cli）。
// %APPDATA%\npm（npm 全局根）→ 入口由该包自身的 package.json#bin 决定，见 cliCandidates()。
export function npmGlobalRoots() {
  const out = []
  const seen = new Set()
  const push = (p) => { if (p && !seen.has(p)) { seen.add(p); out.push(p) } }
  if (process.env.APPDATA) push(path.join(process.env.APPDATA, 'npm'))
  if (process.env.USERPROFILE) push(path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm'))
  if (process.env.LOCALAPPDATA) push(path.join(process.env.LOCALAPPDATA, 'npm'))
  if (process.env.PROGRAMFILES) push(path.join(process.env.PROGRAMFILES, 'nodejs'))
  return out
}

// 从安装包自己的 manifest 解析真实入口（布局无关）：
//   bin 字符串形式 → 直接使用；
//   bin 对象形式   → 优先取键名等于官方命令名 / 包目录名的那一项，
//                    否则取唯一一项（多项且都不匹配时取第一项，反正下游按存在性过滤）。
// manifest 不可读、没有 bin、bin 内无字符串值时返回 ''，由调用方回退旧布局候选。
export function cliEntryFromManifest(pkgDir) {
  if (!pkgDir) return ''
  const manifest = readJsonSafe(path.join(pkgDir, 'package.json'))
  if (!manifest || typeof manifest !== 'object') return ''
  const bin = manifest.bin
  let rel = ''
  if (typeof bin === 'string') {
    rel = bin
  } else if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    const entries = Object.entries(bin).filter(([, value]) => typeof value === 'string')
    const matched = entries.find(([key]) => key === DEVECO_CLI_BIN || key === path.basename(pkgDir))
    if (matched) rel = matched[1]
    else if (entries.length) rel = entries[0][1]
  }
  const parts = entrySegments(rel)
  if (!parts.length) return ''
  return path.join(pkgDir, ...parts)
}

// deveco-cli 入口候选：每个 npm 全局根先给出**由安装包 manifest 解析**的入口，
// 再补旧布局 dist/cli.js 兜底；去重并保持顺序。任何异常都退化成候选不完整。
export function cliCandidates() {
  const out = []
  const seen = new Set()
  const push = (p) => { if (p && !seen.has(p)) { seen.add(p); out.push(p) } }
  for (const root of npmGlobalRoots()) {
    const pkgDir = path.join(root, 'node_modules', '@deveco', 'deveco-cli')
    push(cliEntryFromManifest(pkgDir))
    push(path.join(pkgDir, 'dist', 'cli.js')) // ≤ 1.3.3 旧布局
  }
  return out
}

// DevEco Studio 安装根（存在 <root>/sdk 即视为有效）
export const DEVECO_HOME_CANDIDATES = [
  'C:\\Program Files\\Huawei\\DevEco Studio',
  'D:\\Program Files\\Huawei\\DevEco Studio',
  'C:\\Huawei\\DevEco Studio',
]

// 工程自动发现根目录：默认不硬编码任何个人目录，由 config.projectRoots 提供。
export const DEFAULT_PROJECT_ROOTS = []

// 从已解析的 CLI 入口向上找**最近的**祖先目录，其 package.json#name 是
// @deveco/deveco-cli —— 那就是 CLI 包根。两种布局都成立：
//   <pkg>\cli.js（≥ 1.3.4）与 <pkg>\dist\cli.js（≤ 1.3.3）。
// 找不到（manifest 不可读 / 自定义路径）时返回 ''，调用方退回旧形状推导。
export function cliPackageRootFromEntry(cliPath) {
  if (!cliPath) return ''
  let dir = path.dirname(path.resolve(String(cliPath)))
  for (let depth = 0; depth < 8; depth++) {
    const manifest = readJsonSafe(path.join(dir, 'package.json'))
    if (manifest && manifest.name === DEVECO_CLI_PKG) return dir
    const parent = path.dirname(dir)
    if (!parent || parent === dir) break
    dir = parent
  }
  return ''
}

// json5 随 deveco-cli 安装：包根由入口向上定位（布局无关），json5 在
// deveco-cli 自己的 node_modules 或其上层 @deveco / npm 全局根。
export function json5Candidates(cliPath) {
  const out = []
  const seen = new Set()
  const push = (p) => { if (p && !seen.has(p)) { seen.add(p); out.push(p) } }
  // 1) 布局无关：入口向上定位 CLI 包根（<pkg>\cli.js 与 <pkg>\dist\cli.js 都成立）
  let cliPkgRoot = cliPackageRootFromEntry(cliPath)
  // 2) 兜底：manifest 读不到时按旧形状推导（入口在 dist/ 下时 dirname(dirname()) 即包根）
  if (!cliPkgRoot && cliPath) cliPkgRoot = path.dirname(path.dirname(path.resolve(String(cliPath))))
  if (cliPkgRoot) {
    push(path.join(cliPkgRoot, 'node_modules', 'json5'))
    push(path.join(path.dirname(cliPkgRoot), 'node_modules', 'json5')) // @deveco/node_modules
  }
  // 3) npm 全局根下的 json5（原有兜底）
  for (const root of npmGlobalRoots()) {
    push(path.join(root, 'node_modules', 'json5'))
  }
  return out
}

// 归一化一条路径：反斜杠结尾保留（目录友好）
function norm(p) { return p ? String(p).replace(/\//g, '\\') : '' }

// ---- volatile 配置引用（0.1.7 线）----
// schemastery ≥ 3.18.4 把标记了 `.volatile()` 的字段解析成 cosmokit 的「不可变引用」
// 对象，而不是原始值：
//   createVolatile(value) → Object.freeze({ get: () => current, [write]: (v) => { current = v } })
//   write = Symbol.for('cosmokit.volatile.write')
// cordis 的 resolveConfig() 对**每个**入口 config 都无条件跑一遍入口 `Config`
// （连 cordis.patch.yml 里没有 `config:` 的行也一样），所以 0.1.7 线上
// `config.cliPath` 恒为包装对象：它 truthy → cliSource 记成 'config'，
// `norm()` 再把它变成 "[object Object]" → CLI 探活与 json5 定位一起失效。
// 读法唯一：用共享 symbol 判定（同 dsh-mcp-pill 读 `pill.enabled`、工作区 AGENTS.md
// 的 settings 陷阱），再 `.get()` 取原值；wrapper 上**没有** `.set`，服务是就地改值。
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

// 是否 cosmokit volatile 引用（跨 ESM/CJS 副本用共享 symbol 识别，不看原型）。
export function isVolatileRef(value) {
  return value !== null && typeof value === 'object' &&
    typeof value.get === 'function' && VOLATILE_WRITE in value
}

// 唯一的配置读取口：接受普通字符串、volatile 包装（逐层解包）、
// undefined / 空串（都算「未配置」）；其他任何对象、数字、数组一律当作未配置。
// 因此调用方永远拿不到对象，`norm()` / `path.resolve()` 不会再见到 "[object Object]"。
export function configString(value) {
  let raw = value
  // volatile 不得套 volatile（schema 侧已禁止），这里仍按有界循环防御异常形状。
  for (let i = 0; i < 4 && isVolatileRef(raw); i++) raw = raw.get()
  return typeof raw === 'string' ? raw : ''
}

// 字符串列表配置（如 projectRoots）：逐项走同一个读取口，丢弃非字符串与空串。
export function configStringList(value) {
  return (Array.isArray(value) ? value : []).map(configString).filter(Boolean)
}

// 统一环境解析。
//   config    —— patch/bundle 传入（cliPath / projectPath / devEcoHome / projectRoots）
//   overrides —— 测试或调用方显式覆盖（同名字段；cliCandidatesList / devEcoHomeCandidates
//                可在测试中注入候选清单，以机器无关地验证 detected 来源）
// 返回：paths + ok 标志 + 来源标注（config/env:* / detected / missing）。
export function resolveEnv(config = {}, overrides = {}) {
  // 每个字段都过 configString()/configStringList()：0.1.7 线上它们是 volatile 包装对象，
  // 直接交给 norm()/path.resolve() 会得到 "[object Object]"。缺省/空值仍等于「未配置」，
  // 因此自动探测与环境变量回退完全不变。
  const cfg = {
    cliPath: configString(overrides.cliPath !== undefined ? overrides.cliPath : config.cliPath),
    projectPath: configString(overrides.projectPath !== undefined ? overrides.projectPath : config.projectPath),
    devEcoHome: configString(overrides.devEcoHome !== undefined ? overrides.devEcoHome : config.devEcoHome),
    projectRoots: configStringList(overrides.projectRoots !== undefined ? overrides.projectRoots : config.projectRoots),
  }
  const cliList = overrides.cliCandidatesList || cliCandidates()
  const studioList = overrides.devEcoHomeCandidates || DEVECO_HOME_CANDIDATES

  // -------- cli --------
  let CLI = norm(cfg.cliPath || process.env.DEVECO_CLI_PATH || '')
  let cliSource = cfg.cliPath
    ? 'config'
    : process.env.DEVECO_CLI_PATH ? 'env:DEVECO_CLI_PATH' : ''
  // 既无 config 也无环境变量时，走常见安装位置自动探测；命中即标注 detected
  if (!CLI) {
    cliSource = 'missing'
    for (const candidate of cliList) {
      if (fsExists(candidate)) { CLI = candidate; cliSource = 'detected'; break }
    }
  }
  const cliOk = !!CLI && fsExists(CLI)

  // -------- DevEco Studio --------
  let DEVECO_HOME = norm(cfg.devEcoHome || process.env.DEVECO_HOME || '')
  let devEcoSource = ''
  if (!DEVECO_HOME) {
    const sdkHome = process.env.DEVECO_SDK_HOME
    if (sdkHome && fsExists(path.join(sdkHome, 'default'))) {
      DEVECO_HOME = path.dirname(sdkHome)
      devEcoSource = 'env:DEVECO_SDK_HOME'
    }
  }
  if (!DEVECO_HOME) {
    for (const candidate of studioList) {
      if (fsExists(path.join(candidate, 'sdk'))) {
        DEVECO_HOME = norm(candidate)
        devEcoSource = 'detected'
        break
      }
    }
  }
  if (!devEcoSource) devEcoSource = cfg.devEcoHome
    ? 'config'
    : process.env.DEVECO_HOME ? 'env:DEVECO_HOME' : 'missing'
  const devEcoOk = !!DEVECO_HOME && fsExists(path.join(DEVECO_HOME, 'sdk'))

  // -------- 派生路径 --------
  const PROJECT = norm(cfg.projectPath || process.env.PROJECT_PATH || process.cwd())
  // PROJECT 的来源标注：config（显式 config.projectPath）→ env:PROJECT_PATH → cwd（fallback）。
  // 只有 config / env:PROJECT_PATH 是「显式」来源；cwd 仅保证工具 cwd 可用，
  // 不得被当作可信根（trustedRoots 只收显式根）。
  const projectSource = cfg.projectPath
    ? 'config'
    : process.env.PROJECT_PATH ? 'env:PROJECT_PATH' : 'cwd'
  const HDC = DEVECO_HOME
    ? path.join(DEVECO_HOME, 'sdk', 'default', 'openharmony', 'toolchains', 'hdc.exe')
    : ''
  const HVIGORW = DEVECO_HOME
    ? path.join(DEVECO_HOME, 'tools', 'hvigor', 'bin', 'hvigorw.js')
    : ''
  const TAR = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
    : 'C:\\Windows\\System32\\tar.exe'

  const JSON5_CANDIDATES = json5Candidates(CLI)
  const JSON5_DIR = JSON5_CANDIDATES.find((p) => fsExists(p)) || ''
  const json5Ok = !!JSON5_DIR

  const projectRoots = Array.isArray(cfg.projectRoots) && cfg.projectRoots.length
    ? cfg.projectRoots.map(norm)
    : DEFAULT_PROJECT_ROOTS

  return {
    cfg,
    CLI,
    PROJECT,
    projectSource,
    DEVECO_HOME,
    HDC,
    HVIGORW,
    TAR,
    JSON5_DIR,
    json5Ok,
    projectRoots,
    cliOk,
    devEcoOk,
    cliSource,
    devEcoSource,
    // 小写别名（便于调用方/测试统一访问）
    cliPath: CLI,
    projectPath: PROJECT,
    devEcoHome: DEVECO_HOME,
    hdc: HDC,
    hvigor: HVIGORW,
    tar: TAR,
    json5: JSON5_DIR,
    get hdcOk() { return !!HDC && fsExists(HDC) },
    get hvigorOk() { return !!HVIGORW && fsExists(HVIGORW) },
  }
}

// 可操作错误（缺 CLI 时给修复提示）：具体调用方在真正执行时报出，而非挂在挂载阶段。
export function cliMissingError(env, hint = '') {
  return '未找到 deveco-cli 入口' +
    (hint || '。请先 npm install -g @deveco/deveco-cli（插件从安装包自身的 package.json#bin 解析入口，新旧布局都支持），或设置环境变量 DEVECO_CLI_PATH / 入口配置 cliPath，安装后无需重启 DSH 即可识别。')
}

export function studioMissingError(env, hint = '') {
  return '未找到 DevEco Studio（' + (hint || '需要 hdc/hvigor/SDK。请安装 DevEco Studio 或设置 DEVECO_HOME / config.devEcoHome / DEVECO_SDK_HOME') + '）'
}
