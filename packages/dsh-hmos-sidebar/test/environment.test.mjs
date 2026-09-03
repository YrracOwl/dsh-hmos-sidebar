import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveEnv,
  cliMissingError,
  studioMissingError,
  WINDOWS_ONLY,
  DEFAULT_PROJECT_ROOTS,
} from '../lib/environment.js'

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-env-'))
}

test('is Windows-only module contract', () => {
  assert.equal(WINDOWS_ONLY, true)
})

test('default project roots are empty (no personal dirs)', () => {
  assert.equal(Array.isArray(DEFAULT_PROJECT_ROOTS), true)
  assert.equal(DEFAULT_PROJECT_ROOTS.length, 0)
})

test('resolveEnv honors config.cliPath/devEcoHome/projectPath and derives hdc/hvigor/json5', () => {
  const root = tmpRoot()
  try {
    const cliDir = path.join(root, 'node_modules', '@deveco', 'deveco-cli')
    const cli = path.join(cliDir, 'dist', 'cli.js')
    fs.mkdirSync(path.dirname(cli), { recursive: true })
    fs.writeFileSync(cli, '#!/usr/bin/env node\n')
    fs.mkdirSync(path.join(cliDir, 'node_modules', 'json5'), { recursive: true })
    fs.writeFileSync(path.join(cliDir, 'node_modules', 'json5', 'package.json'), '{}')

    const studio = path.join(root, 'DevEco Studio')
    fs.mkdirSync(path.join(studio, 'sdk'), { recursive: true })

    const e = resolveEnv({
      cliPath: cli,
      devEcoHome: studio,
      projectPath: path.join(root, 'proj'),
      projectRoots: [path.join(root, 'r1'), path.join(root, 'r2')],
    })

    assert.equal(e.cliOk, true)
    assert.equal(e.cliSource, 'config')
    assert.equal(e.CLI, cli)
    assert.equal(e.devEcoOk, true)
    assert.equal(e.devEcoSource, 'config')
    assert.equal(e.JSON5_DIR, path.join(cliDir, 'node_modules', 'json5'))
    assert.equal(e.json5Ok, true)
    assert.equal(e.PROJECT, path.join(root, 'proj'))
    assert.equal(e.projectRoots.length, 2)
    // hdc + hvigor 由 devEcoHome 派生
    assert.ok(e.HDC.endsWith('toolchains\\hdc.exe'), 'HDC path: ' + e.HDC)
    assert.ok(e.HVIGORW.endsWith('tools\\hvigor\\bin\\hvigorw.js'), 'HVIGORW path: ' + e.HVIGORW)
    // 由于真实 studio 无 hdc.exe，hdcOk 应为 false
    assert.equal(e.hdcOk, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv falls back to DEVECO_SDK_HOME for studio and reports source env:DEVECO_SDK_HOME', () => {
  const root = tmpRoot()
  const prev = process.env.DEVECO_SDK_HOME
  try {
    const sdk = path.join(root, 'sdk')
    fs.mkdirSync(path.join(sdk, 'default'), { recursive: true })
    process.env.DEVECO_SDK_HOME = sdk
    const e = resolveEnv({})
    assert.equal(e.devEcoHome, root.replace(/\//g, '\\'))
    assert.equal(e.devEcoOk, true)
    assert.equal(e.devEcoSource, 'env:DEVECO_SDK_HOME')
  } finally {
    if (prev === undefined) delete process.env.DEVECO_SDK_HOME
    else process.env.DEVECO_SDK_HOME = prev
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv with no CLI: cliOk false, no throw, actionable error mentions install', () => {
  // 机器无关：临时屏蔽会影响 CLI/Studio 探测的环境变量
  const saved = {}
  const keys = ['DEVECO_CLI_PATH', 'DEVECO_HOME', 'DEVECO_SDK_HOME', 'APPDATA', 'USERPROFILE', 'LOCALAPPDATA']
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k] }
  try {
    const e = resolveEnv({ projectPath: os.tmpdir() })
    assert.equal(e.cliOk, false)
    assert.equal(e.CLI, '')
    assert.equal(e.cliSource, 'missing')
    const msg = cliMissingError(e)
    assert.match(msg, /npm install -g @deveco\/deveco-cli/)
    assert.match(studioMissingError(e), /DevEco Studio/)
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
})

test('resolveEnv CLI detection from npm global root requires a real file', () => {
  const root = tmpRoot()
  const prevAppData = process.env.APPDATA
  try {
    const cli = path.join(root, 'npm', 'node_modules', '@deveco', 'deveco-cli', 'dist', 'cli.js')
    fs.mkdirSync(path.dirname(cli), { recursive: true })
    fs.writeFileSync(cli, '#!/usr/bin/env node\n')
    process.env.APPDATA = root
    const e = resolveEnv({ projectPath: os.tmpdir() })
    assert.equal(e.cliOk, true)
    assert.equal(e.CLI, cli.replace(/\//g, '\\'))
    assert.equal(e.cliSource, 'detected')
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = prevAppData
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv reports env:DEVECO_CLI_PATH source when env var points to an existing cli', () => {
  const root = tmpRoot()
  const saved = {}
  const keys = ['DEVECO_CLI_PATH', 'DEVECO_HOME', 'DEVECO_SDK_HOME', 'APPDATA', 'USERPROFILE', 'LOCALAPPDATA', 'PROJECT_PATH']
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k] }
  try {
    const cli = path.join(root, 'cli.js')
    fs.writeFileSync(cli, '#!/usr/bin/env node\n')
    process.env.DEVECO_CLI_PATH = cli
    const e = resolveEnv({ projectPath: os.tmpdir() })
    assert.equal(e.cliOk, true)
    assert.equal(e.cliSource, 'env:DEVECO_CLI_PATH')
    assert.equal(e.CLI, cli.replace(/\//g, '\\'))
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv reports detected source for DevEco Studio found via candidates list (junction-capable)', () => {
  const root = tmpRoot()
  const saved = {}
  const keys = ['DEVECO_HOME', 'DEVECO_SDK_HOME', 'DEVECO_CLI_PATH']
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k] }
  try {
    const studio = path.join(root, 'PD', 'Huawei', 'DevEco Studio') // 模拟 C junction / 常见安装位置
    fs.mkdirSync(path.join(studio, 'sdk', 'default'), { recursive: true })
    const e = resolveEnv(
      { projectPath: os.tmpdir() },
      { devEcoHomeCandidates: [studio] }, // 注入候选，机器无关地验证 detected
    )
    assert.equal(e.devEcoOk, true)
    assert.equal(e.devEcoSource, 'detected')
    assert.equal(e.devEcoHome, studio.replace(/\//g, '\\'))
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv reports projectSource config / env:PROJECT_PATH / cwd', () => {
  const prev = process.env.PROJECT_PATH
  try {
    delete process.env.PROJECT_PATH
    const a = resolveEnv({ projectPath: 'C:\\cfgproj' })
    assert.equal(a.projectSource, 'config')
    assert.equal(a.PROJECT, 'C:\\cfgproj')

    process.env.PROJECT_PATH = 'C:\\envproj'
    const b = resolveEnv({})
    assert.equal(b.projectSource, 'env:PROJECT_PATH')
    assert.equal(b.PROJECT, 'C:\\envproj')

    delete process.env.PROJECT_PATH
    const c = resolveEnv({})
    assert.equal(c.projectSource, 'cwd')
    assert.equal(c.PROJECT, process.cwd().replace(/\//g, '\\'))
  } finally {
    if (prev === undefined) delete process.env.PROJECT_PATH
    else process.env.PROJECT_PATH = prev
  }
})
