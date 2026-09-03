import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PRESET_IDS,
  installPreset,
  parseArgs,
  presetRootFor,
} from '../bin/dsh-hmos-sidebar.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-presets-'))
  const sourceRoot = path.join(root, 'source')
  const targetRoot = path.join(root, 'target')
  for (const id of PRESET_IDS) {
    fs.mkdirSync(path.join(sourceRoot, id), { recursive: true })
    fs.writeFileSync(path.join(sourceRoot, id, 'preset.yml'), `name: ${id}\n`)
  }
  return {
    root,
    sourceRoot,
    targetRoot,
    dispose() { fs.rmSync(root, { recursive: true, force: true }) },
  }
}

test('presetRootFor respects DSH_HOME and otherwise uses the user home', () => {
  assert.equal(presetRootFor({ DSH_HOME: 'C:\\dsh-home' }, 'C:\\Users\\example'), path.resolve('C:\\dsh-home', '.agent-presets'))
  assert.equal(presetRootFor({}, 'C:\\Users\\example'), path.resolve('C:\\Users\\example', '.dsh', '.agent-presets'))
})

test('parseArgs installs both presets by default and supports a selection', () => {
  assert.deepEqual(parseArgs(['install-presets']).presets, PRESET_IDS)
  assert.deepEqual(parseArgs(['install-presets', '--preset', 'native-harmonyos']).presets, ['native-harmonyos'])
  assert.deepEqual(
    parseArgs(['install-presets', '--preset', 'liangshen-native-harmonyos']).presets,
    ['native-harmonyos', 'liangshen-native-harmonyos'],
    '梁神预设必须同时安装它相对引用的 native skills',
  )
  assert.equal(parseArgs(['--help']).help, true)
  assert.throws(() => parseArgs(['install-presets', '--preset', 'unknown']), /不支持的预设/)
})

test('installPreset copies a bundled preset into an empty target', () => {
  const f = fixture()
  try {
    const result = installPreset('native-harmonyos', { root: f.targetRoot, sourceRoot: f.sourceRoot })
    assert.equal(result.backup, null)
    assert.match(fs.readFileSync(path.join(result.target, 'preset.yml'), 'utf8'), /native-harmonyos/)
  } finally { f.dispose() }
})

test('installPreset refuses to overwrite an existing user preset by default', () => {
  const f = fixture()
  try {
    const target = path.join(f.targetRoot, 'native-harmonyos')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'user.txt'), 'keep me')
    assert.throws(
      () => installPreset('native-harmonyos', { root: f.targetRoot, sourceRoot: f.sourceRoot }),
      /预设已存在，未覆盖/,
    )
    assert.equal(fs.readFileSync(path.join(target, 'user.txt'), 'utf8'), 'keep me')
  } finally { f.dispose() }
})

test('force mode backs up the existing preset before replacement', () => {
  const f = fixture()
  try {
    const target = path.join(f.targetRoot, 'native-harmonyos')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'user.txt'), 'keep me')
    const result = installPreset('native-harmonyos', {
      root: f.targetRoot,
      sourceRoot: f.sourceRoot,
      force: true,
      now: new Date('2026-01-02T03:04:05.000Z'),
    })
    assert.ok(result.backup)
    assert.equal(fs.readFileSync(path.join(result.backup, 'user.txt'), 'utf8'), 'keep me')
    assert.match(fs.readFileSync(path.join(target, 'preset.yml'), 'utf8'), /native-harmonyos/)
  } finally { f.dispose() }
})

test('dry-run reports the target without modifying it', () => {
  const f = fixture()
  try {
    const result = installPreset('liangshen-native-harmonyos', {
      root: f.targetRoot,
      sourceRoot: f.sourceRoot,
      dryRun: true,
    })
    assert.equal(result.dryRun, true)
    assert.equal(fs.existsSync(result.target), false)
  } finally { f.dispose() }
})
