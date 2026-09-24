#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PRESET_IDS = ['native-harmonyos', 'liangshen-native-harmonyos']

/**
 * Host models this installer can target. DSH ≤ 0.1.5 discovers agent presets as
 * DIRECTORIES under `<DSH_HOME>/.agent-presets/`; DSH ≥ 0.1.7-rc.1 removed that
 * roster and takes presets as `@deepseek-ai/dsh-agent-preset` DECLARATIONS in
 * the profile patch. `auto` probes the profile for the declarative package and
 * falls back to the directory model, so one command works on both hosts.
 */
export const HOST_MODES = ['auto', 'directory', 'declarative']

/** Package whose presence marks a host with the declarative preset registry. */
export const DECLARATIVE_PROBE = '@deepseek-ai/dsh-agent-preset'

/**
 * Marker lines this installer owns inside a profile patch. Everything between
 * them is generated; text outside them is user content and is never rewritten.
 */
export const MANAGED_BEGIN = '# >>> dsh-hmos-sidebar presets (managed block: do not edit inside; refresh with `dsh-hmos-sidebar install-presets --force`)'
export const MANAGED_END = '# <<< dsh-hmos-sidebar presets'

/** Profile patch file the declarative rows are merged into. */
export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function presetRootFor(env = process.env, home = os.homedir()) {
  const dshHome = String(env.DSH_HOME || '').trim()
  return dshHome
    ? path.resolve(dshHome, '.agent-presets')
    : path.resolve(home, '.dsh', '.agent-presets')
}

/** The ≤ 0.1.5 payload: a preset directory the old roster scans. */
export function directoryPresetRoot(id, sourceRoot = path.join(packageRoot, 'presets')) {
  return path.join(path.resolve(sourceRoot), id)
}

/** The ≥ 0.1.7 payload: an entry list declaring this preset, mounted by `cordis:include`. */
export function declarativePresetFile(id, sourceRoot = path.join(packageRoot, 'presets')) {
  return path.join(path.resolve(sourceRoot), `${id}.declarative.yml`)
}

/** Entry id of the include row for one preset, inside the managed block. */
export function includeRowIdFor(id) {
  return `hmos-preset-${id}`
}

/** Include target, relative to the profile directory (never an absolute machine path). */
export function includePathFor(id) {
  return `./node_modules/dsh-hmos-sidebar/presets/${id}.declarative.yml`
}

export function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift()
  if (!command || command === '--help' || command === '-h') return { help: true }
  if (command !== 'install-presets') throw new Error(`未知命令：${command}`)

  const selected = []
  let force = false
  let dryRun = false
  let mode = 'auto'
  let profileDir = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--all') {
      selected.splice(0, selected.length, ...PRESET_IDS)
    } else if (arg === '--preset') {
      const id = args[++i]
      if (!id) throw new Error('--preset 需要预设 ID')
      selected.push(id)
    } else if (arg === '--mode') {
      const value = args[++i]
      if (!value) throw new Error(`--mode 需要取值：${HOST_MODES.join(' | ')}`)
      if (!HOST_MODES.includes(value)) throw new Error(`不支持的 --mode：${value}（可用：${HOST_MODES.join(' | ')}）`)
      mode = value
    } else if (arg === '--profile-dir') {
      const value = args[++i]
      if (!value) throw new Error('--profile-dir 需要目录路径')
      profileDir = value
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      return { help: true }
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }

  const presets = selected.length ? [...new Set(selected)] : [...PRESET_IDS]
  for (const id of presets) {
    if (!PRESET_IDS.includes(id)) throw new Error(`不支持的预设：${id}`)
  }
  // 梁神预设的 skills 目录来自 native-harmonyos，必须成对安装（目录型与声明式同此）。
  if (presets.includes('liangshen-native-harmonyos') && !presets.includes('native-harmonyos')) {
    presets.unshift('native-harmonyos')
  }
  return { command, presets, force, dryRun, mode, profileDir, help: false }
}

/**
 * Directories whose module resolution is probed for the declarative registry.
 *
 * The profile comes first because it is what the RUNNING host composes from: a
 * dsh profile resolves host packages through `<DSH_HOME>/profiles/node_modules`,
 * a symlink farm mirroring the running install's own package set (that is also
 * the path a declaration's bare specifiers resolve through). But that farm
 * reflects a host that has already BOOTED, so a profile sitting in front of a
 * freshly upgraded, not-yet-restarted dsh would still answer for the old
 * version. The install tree is probed as well for exactly that window — the
 * declarative package is a hard dependency of 0.1.7-rc.1, and it does not exist
 * at all on ≤ 0.1.5, so neither base can produce a false positive.
 */
export function hostProbeBases(options = {}) {
  const bases = []
  if (Array.isArray(options.probeBases)) return options.probeBases.map((dir) => path.resolve(dir))
  const profileDir = options.profileDir || options.cwd
  if (profileDir) bases.push(path.resolve(profileDir))
  const installBase = String(options.installBase ?? process.env.DSH_INSTALL ?? '').trim()
  if (installBase !== '') bases.push(path.resolve(installBase))
  // npm's global prefix on Windows, where this package runs; the env override
  // above covers any other layout.
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  bases.push(path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  return [...new Set(bases)]
}

/**
 * Which payload the target host needs.
 *
 * `auto` looks for `@deepseek-ai/dsh-agent-preset/package.json` — a package that
 * exists only on ≥ 0.1.7-rc.1 — from each base in {@link hostProbeBases}. A miss
 * everywhere means the old directory roster, which is also the safe default:
 * copying a directory onto a declarative host is a no-op, while merging a
 * declaration into a ≤ 0.1.5 host fails the whole Web boot.
 */
export function detectHostMode(options = {}) {
  const requested = options.mode ?? 'auto'
  if (!HOST_MODES.includes(requested)) throw new Error(`不支持的 --mode：${requested}`)
  if (requested !== 'auto') return requested
  for (const base of hostProbeBases(options)) {
    try {
      createRequire(path.join(base, 'package.json')).resolve(`${DECLARATIVE_PROBE}/package.json`)
      return 'declarative'
    } catch {
      // Try the next base; a miss here is expected on ≤ 0.1.5.
    }
  }
  return 'directory'
}

function backupSuffix(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

export function installPreset(id, options = {}) {
  if (!PRESET_IDS.includes(id)) throw new Error(`不支持的预设：${id}`)
  const root = path.resolve(options.root || presetRootFor())
  const source = directoryPresetRoot(id, options.sourceRoot)
  const target = path.join(root, id)
  const force = options.force === true
  const dryRun = options.dryRun === true

  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`npm 包中缺少预设目录：${id}`)
  }
  const exists = fs.existsSync(target)
  if (exists && !force) {
    throw new Error(`预设已存在，未覆盖：${target}（如需备份后替换，请使用 --force）`)
  }
  if (dryRun) return { id, target, backup: exists ? `${target}.backup-<timestamp>` : null, dryRun: true }

  fs.mkdirSync(root, { recursive: true })
  const stage = path.join(root, `.${id}.install-${process.pid}-${Date.now()}`)
  const backup = exists ? `${target}.backup-${backupSuffix(options.now)}` : null
  fs.cpSync(source, stage, { recursive: true, errorOnExist: true, force: false, dereference: true })

  try {
    if (backup) fs.renameSync(target, backup)
    fs.renameSync(stage, target)
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true })
    if (backup && fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target)
    throw error
  }

  return { id, target, backup, dryRun: false }
}

/** Validate that a directory is a DSH profile before its patch file is touched. */
export function resolveProfileDir(dir) {
  const resolved = path.resolve(dir)
  const manifestPath = path.join(resolved, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`不是 DSH profile 目录（缺少 package.json）：${resolved}；请在 profile 目录中运行，或用 --profile-dir 指定`)
  }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`profile 的 package.json 无法解析：${manifestPath}（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (!Array.isArray(manifest?.dsh?.profile?.bundles)) {
    throw new Error(`不是 DSH profile 目录（package.json 缺少 dsh.profile.bundles）：${manifestPath}`)
  }
  return resolved
}

/** The generated block: one `cordis:include` row per preset, appended to the profile patch. */
export function renderManagedBlock(presets = PRESET_IDS) {
  const lines = [MANAGED_BEGIN, '- insert:']
  for (const id of presets) {
    lines.push(`    - id: ${includeRowIdFor(id)}`)
    lines.push('      name: cordis:include')
    lines.push('      config:')
    lines.push(`        path: ${includePathFor(id)}`)
  }
  lines.push(MANAGED_END)
  return lines.join('\n')
}

function codeLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed !== '' && !trimmed.startsWith('#')
    })
}

/**
 * Merge the managed block into an existing patch document.
 *
 * A profile patch is a top-level YAML array. The empty document is written as
 * `[]`, which cannot simply be appended to, so that single line is replaced.
 * Everything else — the user's comments, blank lines, and their own entries —
 * is preserved verbatim, and a document that already carries the markers has
 * only the marked region replaced.
 */
export function mergeManagedBlock(existing, block) {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  // Match the document's own line endings: a Windows checkout of the profile
  // patch is CRLF, and splicing LF lines into it would leave a mixed file.
  const blockText = eol === '\n' ? block : block.split('\n').join(eol)
  const begin = existing.indexOf(MANAGED_BEGIN)
  const end = existing.indexOf(MANAGED_END)
  if (begin !== -1 || end !== -1) {
    if (begin === -1 || end === -1 || end < begin) {
      throw new Error('profile patch 中的 dsh-hmos-sidebar 托管块标记不完整：请人工修复（补齐或删除孤立标记）后再运行')
    }
    const after = end + MANAGED_END.length
    return { text: existing.slice(0, begin) + blockText + existing.slice(after), replaced: true }
  }

  const lines = existing.split(/\r?\n/)
  const emptyDoc = lines.findIndex((line) => line.trim() === '[]')
  if (emptyDoc !== -1) {
    const next = [...lines.slice(0, emptyDoc), ...blockText.split(eol), ...lines.slice(emptyDoc + 1)]
    return { text: next.join(eol), replaced: false }
  }
  if (existing.trim() === '' || codeLines(existing).length === 0) {
    const head = existing.trim() === '' ? '' : existing.replace(/\s*$/, '') + eol + eol
    return { text: head + blockText + eol, replaced: false }
  }
  return { text: existing.replace(/\s*$/, '') + eol + eol + blockText + eol, replaced: false }
}

/**
 * Install both presets on a host whose roster takes declarations.
 *
 * @returns the profile patch target, whether a marked block was replaced
 *   rather than appended, the generated block, and the backup path when the
 *   file was rewritten.
 */
export function installPresetsDeclarative(options = {}) {
  const profileDir = resolveProfileDir(options.profileDir ?? process.cwd())
  const target = path.join(profileDir, PROFILE_PATCH_FILENAME)
  const presets = options.presets ?? PRESET_IDS
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  const hasBlock = existing.includes(MANAGED_BEGIN)
  const manual = presets.filter((id) => !hasBlock && existing.includes(`id: ${includeRowIdFor(id)}`))
  if (manual.length > 0) {
    throw new Error(`profile patch 中已有手工添加的 preset 行（${manual.map(includeRowIdFor).join('、')}）但缺少托管块标记：请先手工删除这些行，再运行本命令`)
  }
  if (hasBlock && options.force !== true) {
    throw new Error(`预设已安装（托管块已存在），未覆盖：${target}（如需刷新，请使用 --force）`)
  }

  const block = renderManagedBlock(presets)
  const merged = mergeManagedBlock(existing, block)
  const unchanged = merged.text === existing
  const result = {
    mode: 'declarative',
    target,
    replaced: merged.replaced,
    block,
    unchanged,
    backup: null,
    dryRun: options.dryRun === true,
  }
  if (result.dryRun || unchanged) return result

  fs.mkdirSync(profileDir, { recursive: true })
  const backup = fs.existsSync(target) ? `${target}.backup-${backupSuffix(options.now)}` : null
  const stage = `${target}.dsh-hmos-sidebar-${process.pid}-${Date.now()}.tmp`
  fs.writeFileSync(stage, merged.text, 'utf8')
  try {
    if (backup) fs.copyFileSync(target, backup)
    fs.renameSync(stage, target)
  } catch (error) {
    fs.rmSync(stage, { force: true })
    throw error
  }
  result.backup = backup
  return result
}

export function usage() {
  return `dsh-hmos-sidebar

用法：
  dsh-hmos-sidebar install-presets [--all]
  dsh-hmos-sidebar install-presets --preset <id> [--preset <id>]

选项：
  --all             安装两个预设（默认行为）
  --preset ID       只安装指定预设，可重复
  --dry-run         只显示目标与将要写入的内容，不改文件
  --force           目标已存在时先创建带时间戳的备份，再替换
  --mode MODE       auto | directory | declarative（默认 auto）
  --profile-dir DIR 声明式安装的目标 profile 目录（默认当前目录）
  -h, --help        显示帮助

安装形态由宿主决定：
  DSH ≤ 0.1.5  目录型 preset：复制到 <DSH_HOME>/.agent-presets/<id>/
  DSH ≥ 0.1.7  声明式 preset：在 profile 的 cordis.patch.yml 中写入托管块，
               用 cordis:include 挂载包内的 <id>.declarative.yml
在 profile 目录中运行（pnpm exec dsh-hmos-sidebar install-presets --all --force）
即可自动识别；--mode 可强制指定。

可用预设：
  ${PRESET_IDS.join('\n  ')}
`
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    process.stdout.write(usage())
    return 0
  }

  const cwd = process.cwd()
  const profileDir = parsed.profileDir ? path.resolve(parsed.profileDir) : cwd
  const mode = detectHostMode({ mode: parsed.mode, profileDir })

  if (mode === 'declarative') {
    const result = installPresetsDeclarative({
      profileDir,
      presets: parsed.presets,
      force: parsed.force,
      dryRun: parsed.dryRun,
    })
    const label = result.dryRun ? '[预览]' : result.unchanged ? '[已是最新]' : '[已安装]'
    process.stdout.write(`${label} 声明式 preset -> ${result.target}\n`)
    if (result.dryRun) {
      process.stdout.write(`${result.block}\n`)
      for (const id of parsed.presets) {
        process.stdout.write(`  挂载：${includePathFor(id)}\n`)
      }
      return 0
    }
    if (result.backup) process.stdout.write(`  原文件备份：${result.backup}\n`)
    if (result.unchanged) return 0
    process.stdout.write('请重启 DSH Profile（或让补丁层热重载），再在新建会话时选择对应预设。\n')
    return 0
  }

  const root = presetRootFor()
  const results = parsed.presets.map((id) => installPreset(id, {
    root,
    force: parsed.force,
    dryRun: parsed.dryRun,
  }))
  for (const result of results) {
    const label = result.dryRun ? '[预览]' : '[已安装]'
    process.stdout.write(`${label} ${result.id} -> ${result.target}\n`)
    if (result.backup) process.stdout.write(`  原目录备份：${result.backup}\n`)
  }
  if (!parsed.dryRun) process.stdout.write('请重启 DSH Profile，并在新建会话时选择对应预设。\n')
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = main()
  } catch (error) {
    process.stderr.write(`安装失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
