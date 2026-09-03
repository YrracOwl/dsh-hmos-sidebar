#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PRESET_IDS = ['native-harmonyos', 'liangshen-native-harmonyos']

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function presetRootFor(env = process.env, home = os.homedir()) {
  const dshHome = String(env.DSH_HOME || '').trim()
  return dshHome
    ? path.resolve(dshHome, '.agent-presets')
    : path.resolve(home, '.dsh', '.agent-presets')
}

export function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift()
  if (!command || command === '--help' || command === '-h') return { help: true }
  if (command !== 'install-presets') throw new Error(`未知命令：${command}`)

  const selected = []
  let force = false
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--all') {
      selected.splice(0, selected.length, ...PRESET_IDS)
    } else if (arg === '--preset') {
      const id = args[++i]
      if (!id) throw new Error('--preset 需要预设 ID')
      selected.push(id)
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
  // 梁神预设通过相对路径复用 native-harmonyos/skills，必须成对安装。
  if (presets.includes('liangshen-native-harmonyos') && !presets.includes('native-harmonyos')) {
    presets.unshift('native-harmonyos')
  }
  return { command, presets, force, dryRun, help: false }
}

function backupSuffix(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

export function installPreset(id, options = {}) {
  if (!PRESET_IDS.includes(id)) throw new Error(`不支持的预设：${id}`)
  const root = path.resolve(options.root || presetRootFor())
  const sourceRoot = path.resolve(options.sourceRoot || path.join(packageRoot, 'presets'))
  const source = path.join(sourceRoot, id)
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

export function usage() {
  return `dsh-hmos-sidebar

用法：
  dsh-hmos-sidebar install-presets [--all]
  dsh-hmos-sidebar install-presets --preset <id> [--preset <id>]

选项：
  --all          安装两个预设（默认行为）
  --preset ID    只安装指定预设，可重复
  --dry-run      只显示目标路径，不写文件
  --force        目标已存在时先创建带时间戳的备份，再替换
  -h, --help     显示帮助

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

  const root = presetRootFor()
  const results = parsed.presets.map((id) => installPreset(id, {
    root,
    force: parsed.force,
    dryRun: parsed.dryRun,
  }))
  for (const result of results) {
    const mode = result.dryRun ? '[预览]' : '[已安装]'
    process.stdout.write(`${mode} ${result.id} -> ${result.target}\n`)
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
