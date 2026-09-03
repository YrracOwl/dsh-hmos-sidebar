import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDualSigningProfile, configureDualSigning, parseBuildProfileJson5 } from '../lib/dual-signing.js'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dual-sign-'))
  const files = {}
  for (const [name, ext] of [['releaseStoreFile', '.p12'], ['releaseProfile', '.p7b'], ['releaseCertpath', '.cer'], ['debugStoreFile', '.p12'], ['debugProfile', '.p7b'], ['debugCertpath', '.cer']]) {
    files[name] = path.join(root, name + ext)
    fs.writeFileSync(files[name], 'fixture')
  }
  const profile = {
    app: {
      signingConfigs: [{ name: 'other', type: 'HarmonyOS', material: { preserved: true } }],
      products: [{ name: 'default', signingConfig: 'old', targetSdkVersion: '6.1.0(23)', custom: { keep: true } }],
    },
    modules: [
      { name: 'entry', srcPath: './entry', targets: [{ name: 'default', custom: 1, applyToProducts: ['default'] }] },
      { name: 'shared', srcPath: './shared', targets: [{ name: 'default', custom: 2, applyToProducts: ['default'] }] },
    ],
    customRoot: { keep: true },
  }
  fs.writeFileSync(path.join(root, 'build-profile.json5'), '// fixture\n' + JSON.stringify(profile, null, 2).replace(/\n}/g, ',\n}'))
  const args = {
    projectPath: root,
    ...files,
    releaseStorePassword: 'release-secret', releaseKeyAlias: 'release', releaseKeyPassword: 'release-key-secret',
    debugStorePassword: 'debug-secret', debugKeyAlias: 'debug', debugKeyPassword: 'debug-key-secret',
  }
  return { root, profile, args }
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }) }

test('parseBuildProfileJson5 accepts comments and trailing commas', () => {
  assert.deepEqual(parseBuildProfileJson5('{// c\n"a": 1,}'), { a: 1 })
})

test('buildDualSigningProfile preserves unknown fields and configures split/shared targets', () => {
  const f = fixture()
  try {
    const plan = buildDualSigningProfile(f.profile, f.args)
    assert.equal(plan.profile.customRoot.keep, true)
    assert.equal(plan.profile.app.products.find((p) => p.name === 'default').custom.keep, true)
    assert.equal(plan.profile.app.products.find((p) => p.name === 'debug').targetSdkVersion, '6.1.0(23)')
    assert.ok(plan.profile.app.signingConfigs.some((s) => s.name === 'other'))
    assert.deepEqual(plan.profile.modules[0].targets.map((t) => t.name), ['default', 'debug'])
    assert.deepEqual(plan.profile.modules[1].targets[0].applyToProducts, ['default', 'debug'])
  } finally { cleanup(f.root) }
})

test('merge is idempotent and explicit modules are validated', () => {
  const f = fixture()
  try {
    const once = buildDualSigningProfile(f.profile, { ...f.args, modules: ['entry'] }).profile
    const twice = buildDualSigningProfile(once, { ...f.args, modules: ['entry'] }).profile
    assert.deepEqual(twice, once)
    assert.throws(() => buildDualSigningProfile(f.profile, { ...f.args, modules: ['missing'] }), /不存在模块/)
  } finally { cleanup(f.root) }
})

test('preview does not write or leak passwords', () => {
  const f = fixture()
  try {
    const file = path.join(f.root, 'build-profile.json5')
    const before = fs.readFileSync(file, 'utf8')
    const result = configureDualSigning(f.args)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert.match(result.stdout, /尚未写入/)
    assert.ok(!result.stdout.includes('release-secret'))
    assert.ok(!result.stdout.includes('debug-key-secret'))
    assert.equal(fs.existsSync(file + '.dsh-backup'), false)
  } finally { cleanup(f.root) }
})

test('apply writes parseable profile, creates backup, and remains idempotent', () => {
  const f = fixture()
  try {
    const file = path.join(f.root, 'build-profile.json5')
    const original = fs.readFileSync(file, 'utf8')
    configureDualSigning({ ...f.args, apply: true })
    assert.equal(fs.readFileSync(file + '.dsh-backup', 'utf8'), original)
    const once = fs.readFileSync(file, 'utf8')
    configureDualSigning({ ...f.args, apply: true })
    assert.equal(fs.readFileSync(file, 'utf8'), once)
    assert.deepEqual(parseBuildProfileJson5(once).modules[0].targets.map((t) => t.name), ['default', 'debug'])
  } finally { cleanup(f.root) }
})

test('rejects bad material suffix, missing files, and product conflicts without password leakage', () => {
  const f = fixture()
  try {
    assert.throws(() => buildDualSigningProfile(f.profile, { ...f.args, debugProduct: 'default' }), /不能相同/)
    assert.throws(() => buildDualSigningProfile(f.profile, { ...f.args, debugCertpath: f.args.debugProfile }), /debugcertpath 必须是 \.cer/i)
    fs.rmSync(f.args.releaseStoreFile)
    let message = ''
    try { buildDualSigningProfile(f.profile, f.args) } catch (error) { message = error.message }
    assert.match(message, /文件不存在/)
    assert.ok(!message.includes('release-secret'))
  } finally { cleanup(f.root) }
})
