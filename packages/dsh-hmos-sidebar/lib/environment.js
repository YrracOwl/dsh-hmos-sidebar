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

import path from 'node:path'
import fs from 'node:fs'

export const WINDOWS_ONLY = true

function fsExists(p) {
  try { return fs.existsSync(p) } catch { return false }
}

// ---- 常见安装位置候选（Windows-only，不含个人路径） ----
// deveco-cli 全局 npm 安装根（每个根含 node_modules/@deveco/deveco-cli/dist/cli.js）。
// %APPDATA%\npm（npm 全局根）→ cliPath = %APPDATA%\npm\node_modules\@deveco\deveco-cli\dist\cli.js
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

export function cliCandidates() {
  const out = []
  for (const root of npmGlobalRoots()) {
    out.push(path.join(root, 'node_modules', '@deveco', 'deveco-cli', 'dist', 'cli.js'))
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

// json5 随 deveco-cli 安装：cliPath 是 <npm>/node_modules/@deveco/deveco-cli/dist/cli.js，
// json5 在 deveco-cli 的 node_modules 或其上层 @deveco / npm 全局根。
export function json5Candidates(cliPath) {
  const cliPkgRoot = cliPath ? path.dirname(path.dirname(cliPath)) : '' // .../deveco-cli
  const out = []
  if (cliPkgRoot) {
    out.push(path.join(cliPkgRoot, 'node_modules', 'json5'))
    out.push(path.join(path.dirname(cliPkgRoot), 'node_modules', 'json5')) // @deveco/node_modules
  }
  for (const root of npmGlobalRoots()) {
    out.push(path.join(root, 'node_modules', 'json5'))
  }
  return out
}

// 归一化一条路径：反斜杠结尾保留（目录友好）
function norm(p) { return p ? String(p).replace(/\//g, '\\') : '' }

// 统一环境解析。
//   config    —— patch/bundle 传入（cliPath / projectPath / devEcoHome / projectRoots）
//   overrides —— 测试或调用方显式覆盖（同名字段；cliCandidatesList / devEcoHomeCandidates
//                可在测试中注入候选清单，以机器无关地验证 detected 来源）
// 返回：paths + ok 标志 + 来源标注（config/env:* / detected / missing）。
export function resolveEnv(config = {}, overrides = {}) {
  const cfg = {
    cliPath: overrides.cliPath !== undefined ? overrides.cliPath : config.cliPath,
    projectPath: overrides.projectPath !== undefined ? overrides.projectPath : config.projectPath,
    devEcoHome: overrides.devEcoHome !== undefined ? overrides.devEcoHome : config.devEcoHome,
    projectRoots: overrides.projectRoots !== undefined ? overrides.projectRoots : config.projectRoots,
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
    (hint || '。请先 npm install -g @deveco/deveco-cli，或设置环境变量 DEVECO_CLI_PATH / config.cliPath，安装后无需重启 DSH 即可识别。')
}

export function studioMissingError(env, hint = '') {
  return '未找到 DevEco Studio（' + (hint || '需要 hdc/hvigor/SDK。请安装 DevEco Studio 或设置 DEVECO_HOME / config.devEcoHome / DEVECO_SDK_HOME') + '）'
}
