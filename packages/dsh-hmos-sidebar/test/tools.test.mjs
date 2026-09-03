import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply as applyDcliTools, applyForPlatform, TOOLS, toolsSupportedOn, disposeLspInstance } from '../lib/dcli-tools.mjs'

test('module exports 41 tools with unique dcli__ names', () => {
  assert.equal(TOOLS.length, 41)
  const names = TOOLS.map((t) => t.name)
  assert.equal(new Set(names).size, names.length, 'names unique')
  for (const n of names) assert.ok(n.startsWith('dcli__'), 'prefix: ' + n)
})

test('toolsSupportedOn: Windows-only runtime guard', () => {
  assert.equal(toolsSupportedOn('win32'), true)
  assert.equal(toolsSupportedOn('linux'), false)
  assert.equal(toolsSupportedOn('darwin'), false)
})

// 递归收集工具自身描述与每个参数描述，用于敏感信息/环境特指字符串扫描。
function collectDescriptions() {
  const out = []
  for (const t of TOOLS) {
    if (typeof t.description === 'string') out.push({ where: 'tool:' + t.name, text: t.description })
    for (const [pname, p] of Object.entries(t.parameters || {})) {
      if (p && typeof p.description === 'string') out.push({ where: 'tool:' + t.name + ' parameter:' + pname, text: p.description })
    }
  }
  return out
}

// 环境/个人特指字符串：任何 tool.description 或 parameter.description 都不得包含。
const FORBIDDEN = [
  'CarryWho', 'C:/Users', 'C:\\Users', 'D:/Resources', 'D:\\Resources',
  'com.yrracowl', '2PM0223', 'LingJing', 'DevecoCode_PRJ', 'HMOS_PRJ',
  'Pura X Max', 'mcp__deveco', 'serve mcp', 'verifyUI',
].map((w) => w.toLowerCase())

test('every tool and parameter description avoids sensitive / machine-specific strings', () => {
  const descs = collectDescriptions()
  assert.ok(descs.length > 0, 'at least one tool/parameter description collected')
  for (const { where, text } of descs) {
    const lower = text.toLowerCase()
    for (const w of FORBIDDEN) {
      assert.ok(!lower.includes(w), 'forbidden "' + w + '" in ' + where + ': ' + text)
    }
  }
})

test('every tool and parameter description avoids absolute drive-letter paths (placeholders allowed)', () => {
  for (const { where, text } of collectDescriptions()) {
    // 盘符绝对路径：单个字母 + 冒号 + 反斜杠/正斜杠。占位符（<bundle-name>、<output-dir>/...）不含盘符，天然放行。
    assert.ok(!/[A-Za-z]:[\\/]/.test(text), 'drive-letter path in ' + where + ': ' + text)
  }
})

test('clean references cross-check', () => {
  // 兼容旧断言：mcp server 别名与 serve mcp 字样不得出现在任何描述里
  for (const { where, text } of collectDescriptions()) {
    assert.ok(!/mcp__deveco|serve\s+mcp/i.test(text), 'cross-reference in ' + where + ': ' + text)
  }
})

test('no tool/parameter description contains bare MCP (case-insensitive)', () => {
  for (const { where, text } of collectDescriptions()) {
    assert.ok(!/\bMCP\b/i.test(text), 'bare MCP wording in ' + where + ': ' + text)
  }
})

test('key tool kinds and required params are stable (acceptance contract)', () => {
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]))
  assert.equal(byName.dcli__agents_md.kind, 'agents-md')
  assert.equal(byName.dcli__agents_md.parameters.apply.type, 'boolean')
  assert.equal(byName.dcli__configure_dual_signing.kind, 'dual-signing')
  assert.equal(byName.dcli__configure_dual_signing.parameters.apply.type, 'boolean')
  assert.equal(byName.dcli__lsp_check.kind, 'lsp')
  assert.equal(byName.dcli__lsp_check.parameters.files.required, true)
  assert.equal(byName.dcli__install_hap.kind, 'hdc')
  assert.equal(byName.dcli__start_app.kind, 'hdc-cmd')
  assert.equal(byName.dcli__sync_project.kind, 'hvigor')
  assert.equal(byName.dcli__api_lookup.kind, 'lookup')
  assert.equal(byName.dcli__api_lookup.parameters.name.required, true)
  // 普通命令工具无 kind 字段，运行时按默认 CLI 路径走
  assert.equal(byName.dcli__list_emulators.kind, undefined)
})

// CLI 缺失时 apply 不抛错（挂载不阻塞），也无需真实 cliPath
test('apply mounts even when CLI is missing (non-blocking mount)', () => {
  const registered = []
  const ctx = {
    tools: { register: (d) => { registered.push(d.name); return () => {} } },
    subprocess: { spawn: () => { throw new Error('should not spawn on mount') }, resolveExecutable: async () => 'node' },
    effect: (cb) => { cb() },
  }
  assert.doesNotThrow(() => applyDcliTools(ctx, {}))
  // effect 已触发，41 个工具全部注册，且全程未 spawn CLI
  assert.equal(registered.length, 41)
})

test('apply with a cliPath config also mounts and registers 41 tools', () => {
  const registered = []
  const ctx = {
    tools: { register: (d) => { registered.push(d.name); return () => {} } },
    subprocess: { resolveExecutable: async () => 'node' },
    effect: (cb) => { cb() },
  }
  applyDcliTools(ctx, { cliPath: 'C:\\npm\\deveco-cli\\dist\\cli.js' })
  assert.equal(registered.length, 41)
})

// 普通 CLI 工具未显式传 projectPath 时，spawn cwd 应使用 exec.agent.session.header.cwd。
function buildExecCtx(tempRoot) {
  const cli = path.join(tempRoot, 'cli.js')
  fs.writeFileSync(cli, '#!/usr/bin/env node\n')
  const defs = []
  const spawned = []
  const ctx = {
    tools: { register: (d) => { defs.push(d); return () => {} } },
    subprocess: {
      spawn: (spec) => {
        spawned.push(spec)
        const done = Promise.resolve({ exitCode: 0 })
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: '' }) },
            stderr: { readFrom: () => ({ text: '' }) },
          },
        }
      },
      resolveExecutable: async () => 'node',
    },
    effect: (cb) => { cb() },
  }
  applyDcliTools(ctx, { cliPath: cli })
  return { defs, spawned }
}

test('plain CLI tool spawn uses agent session header cwd when projectPath not passed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-cli-'))
  try {
    const { defs, spawned } = buildExecCtx(root)
    const sessionCwd = path.join(root, 'session-cwd')
    fs.mkdirSync(sessionCwd, { recursive: true })
    const tool = defs.find((d) => d.name === 'dcli__list_emulators')
    assert.ok(tool, 'plain CLI tool present')
    const exec = { agent: { session: { header: { cwd: sessionCwd } } }, signal: undefined }
    const out = await tool.execute({}, exec)
    assert.equal(spawned.length, 1, 'one spawn for one cli call')
    assert.equal(spawned[0].cwd, sessionCwd.replace(/\//g, '\\'))
    assert.equal(out.exitCode, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('explicit projectPath overrides agent session cwd on CLI spawn', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-cli2-'))
  try {
    const { defs, spawned } = buildExecCtx(root)
    const explicit = path.join(root, 'explicit-proj')
    const sessionCwd = path.join(root, 'session-cwd')
    fs.mkdirSync(explicit, { recursive: true })
    fs.mkdirSync(sessionCwd, { recursive: true })
    const tool = defs.find((d) => d.name === 'dcli__list_emulators')
    const exec = { agent: { session: { header: { cwd: sessionCwd } } }, signal: undefined }
    await tool.execute({ projectPath: explicit }, exec)
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].cwd, explicit.replace(/\//g, '\\'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---- 非 win32 平台可测试分支（applyForPlatform）----
test('applyForPlatform registers 41 tools on win32, 0 on linux/darwin', () => {
  const make = () => {
    const registered = []
    const ctx = {
      tools: { register: (d) => { registered.push(d.name); return () => {} } },
      subprocess: { resolveExecutable: async () => 'node' },
      effect: (cb) => { cb() },
    }
    return { ctx, registered }
  }
  const w = make()
  applyForPlatform(w.ctx, {}, 'win32')
  assert.equal(w.registered.length, 41, 'win32 registers all 41')
  for (const platform of ['linux', 'darwin']) {
    const m = make()
    applyForPlatform(m.ctx, {}, platform)
    assert.equal(m.registered.length, 0, platform + ' registers none')
  }
})

// ---- dcli__start_app：bundleName/abilityName/moduleName 校验 + 注入拒绝 ----
test('dcli__start_app buildArgs rejects injection characters and invalid bundleName', () => {
  const start = TOOLS.find((t) => t.name === 'dcli__start_app')
  assert.ok(start, 'start_app present')
  for (const bad of ['com.example;rm -rf /', 'com.example.$(whoami)', 'com.example&&echo x', 'a.b.c.d..e']) {
    assert.throws(() => start.buildArgs({ bundleName: bad }), /bundleName/, 'reject: ' + bad)
  }
  assert.throws(() => start.buildArgs({}), /bundleName 必填/, 'required bundleName')
  assert.throws(() => start.buildArgs({ bundleName: 'com.example.app', abilityName: 'bad;name' }), /abilityName/)
  assert.throws(() => start.buildArgs({ bundleName: 'com.example.app', moduleName: 'bad name' }), /moduleName/)
  const argv = start.buildArgs({ bundleName: 'com.example.app', abilityName: 'EntryAbility', moduleName: 'entry' })
  assert.deepEqual(argv, ['shell', 'aa', 'start', '-a', 'EntryAbility', '-b', 'com.example.app', '-m', 'entry'])
})

// ---- installHap：可选 bundleName 非法时在 spawn 前拒绝 ----
test('installHap rejects invalid optional bundleName before any spawn', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-inst-'))
  try {
    const hap = path.join(root, 'x.hap')
    fs.writeFileSync(hap, 'x')
    const cli = path.join(root, 'cli.js')
    fs.writeFileSync(cli, '#!/usr/bin/env node\n')
    const defs = []
    const spawned = []
    const ctx = {
      tools: { register: (d) => { defs.push(d); return () => {} } },
      subprocess: {
        spawn: (spec) => {
          spawned.push(spec)
          return {
            done: Promise.resolve({ exitCode: 0 }),
            collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
          }
        },
        resolveExecutable: async () => 'node',
      },
      effect: (cb) => { cb() },
    }
    applyDcliTools(ctx, { cliPath: cli })
    const tool = defs.find((d) => d.name === 'dcli__install_hap')
    assert.ok(tool, 'install_hap present')
    await assert.rejects(
      () => tool.execute({ hapPath: hap, bundleName: 'bad..name' }, { signal: undefined }),
      /bundleName/,
    )
    assert.equal(spawned.length, 0, 'no hdc spawn when bundleName invalid')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---- LSP dispose helper ----
test('disposeLspInstance reads public pid, closes client, kills tree, catches rejection', async () => {
  let unhandled = false
  const onUnhandled = () => { unhandled = true }
  process.on('unhandledRejection', onUnhandled)
  try {
    const calls = []
    let killed = null
    const inst = {
      closed: false,
      transport: { pid: 4242, close: () => { calls.push('transport.close') } },
      client: { close: () => { calls.push('client.close'); return Promise.reject(new Error('boom')) } },
    }
    disposeLspInstance(inst, { platform: 'win32', killTree: (pid) => { killed = pid } })
    await new Promise((r) => setTimeout(r, 30))
    assert.deepEqual(calls, ['client.close'], 'client.close called, transport.close not (no competitive close)')
    assert.equal(killed, 4242, 'killTree called with public transport.pid')
    assert.equal(inst.closed, true)
    assert.equal(unhandled, false, 'rejected close promise is caught')
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('disposeLspInstance closes transport when no client, catches rejection, no killTree on non-win32', async () => {
  let unhandled = false
  const onUnhandled = () => { unhandled = true }
  process.on('unhandledRejection', onUnhandled)
  try {
    const calls = []
    let killed = null
    const instNoClient = {
      closed: false,
      transport: { pid: 1, close: () => { calls.push('transport.close'); return Promise.reject(new Error('close boom')) } },
      client: null,
    }
    disposeLspInstance(instNoClient, { platform: 'linux', killTree: (pid) => { killed = pid } })
    await new Promise((r) => setTimeout(r, 30))
    assert.deepEqual(calls, ['transport.close'])
    assert.equal(killed, null, 'non-win32 must not killTree')
    assert.equal(instNoClient.closed, true)
    assert.equal(unhandled, false, 'rejected transport.close promise is caught')

    const instWin = { closed: false, transport: { pid: 7 }, client: { close: () => {} } }
    disposeLspInstance(instWin, { platform: 'linux', killTree: (pid) => { killed = pid } })
    assert.equal(killed, null)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
