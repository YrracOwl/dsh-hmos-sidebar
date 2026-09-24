import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  PRESET_IDS,
  PROFILE_PATCH_FILENAME,
  detectHostMode,
  hostProbeBases,
  installPreset,
  installPresetsDeclarative,
  mergeManagedBlock,
  parseArgs,
  presetRootFor,
  renderManagedBlock,
  resolveProfileDir,
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

// ---------------------------------------------------------------------------
// Declarative installation (DSH >= 0.1.7-rc.1)
//
// That release removed the directory roster: a preset is now an
// `@deepseek-ai/dsh-agent-preset` declaration inside the profile patch. The
// installer must reach the right payload without being told the host version,
// and must never damage the user's own patch content.
// ---------------------------------------------------------------------------

function profileFixture({ patch, probe = false, manifest = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-profile-'))
  const profile = path.join(root, 'web')
  fs.mkdirSync(profile, { recursive: true })
  if (manifest) {
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }, null, 2) + '\n')
  }
  if (patch !== undefined) fs.writeFileSync(path.join(profile, PROFILE_PATCH_FILENAME), patch)
  if (probe) {
    const dir = path.join(profile, 'node_modules', '@deepseek-ai', 'dsh-agent-preset')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-agent-preset',
      version: '0.1.7-rc.1',
    }))
  }
  return { root, profile, dispose() { fs.rmSync(root, { recursive: true, force: true }) } }
}

test('parseArgs accepts the host-mode and profile-directory flags', () => {
  assert.equal(parseArgs(['install-presets']).mode, 'auto')
  assert.equal(parseArgs(['install-presets']).profileDir, null)
  const parsed = parseArgs(['install-presets', '--mode', 'declarative', '--profile-dir', 'C:\\profiles\\web'])
  assert.equal(parsed.mode, 'declarative')
  assert.equal(parsed.profileDir, 'C:\\profiles\\web')
  assert.throws(() => parseArgs(['install-presets', '--mode', 'nope']), /不支持的 --mode/)
  assert.throws(() => parseArgs(['install-presets', '--mode']), /--mode 需要取值/)
  assert.throws(() => parseArgs(['install-presets', '--profile-dir']), /--profile-dir 需要目录路径/)
})

test('detectHostMode picks the payload the profile can actually mount', () => {
  const plain = profileFixture()
  try {
    assert.equal(detectHostMode({ probeBases: [plain.profile] }), 'directory', 'no declarative registry in the profile')
    assert.equal(detectHostMode({ mode: 'declarative', profileDir: plain.profile }), 'declarative', 'an explicit mode wins over the probe')
    assert.equal(detectHostMode({ mode: 'directory', profileDir: plain.profile }), 'directory')
  } finally { plain.dispose() }

  const declarative = profileFixture({ probe: true })
  try {
    assert.equal(detectHostMode({ probeBases: [declarative.profile] }), 'declarative', 'the probe package marks a >= 0.1.7 host')
  } finally { declarative.dispose() }
})

test('the probe also reads the dsh install tree, for a profile ahead of its host', () => {
  // A profile resolves host packages through a symlink farm mirroring the
  // RUNNING install, so a profile still in front of a not-yet-restarted <= 0.1.5
  // host would answer "directory" for a dsh that has already been upgraded.
  // The install tree must therefore be probed as well, and only a miss on every
  // base may fall back to the directory roster.
  const staleFarm = profileFixture()
  const upgradedInstall = profileFixture({ probe: true })
  try {
    assert.equal(detectHostMode({ probeBases: [staleFarm.profile] }), 'directory')
    assert.equal(
      detectHostMode({ probeBases: [staleFarm.profile, upgradedInstall.profile] }),
      'declarative',
      'a miss on the first base must not decide on its own',
    )
  } finally {
    staleFarm.dispose()
    upgradedInstall.dispose()
  }
})

test('hostProbeBases covers the profile, an explicit install, and npm\'s global prefix', () => {
  const bases = hostProbeBases({ profileDir: 'C:\\profiles\\web', installBase: 'C:\\dsh-install' })
  assert.equal(bases[0], path.resolve('C:\\profiles\\web'), 'the running host comes first')
  assert.ok(bases.includes(path.resolve('C:\\dsh-install')), 'an explicit install base is honored')
  assert.ok(
    bases.some((base) => base.includes(path.join('npm', 'node_modules', '@deepseek-ai', 'dsh'))),
    'npm\'s global prefix is the last resort',
  )
  assert.deepEqual(hostProbeBases({ probeBases: ['C:\\only'] }), [path.resolve('C:\\only')], 'tests can pin the chain')
})

test('renderManagedBlock writes one cordis:include row per preset and no machine path', () => {
  const block = renderManagedBlock()
  assert.match(block, /^- insert:$/m)
  assert.match(block, /^ {4}- id: hmos-preset-native-harmonyos$/m)
  assert.match(block, /^ {4}- id: hmos-preset-liangshen-native-harmonyos$/m)
  assert.match(block, /^ {6}name: cordis:include$/m)
  assert.match(block, /^ {8}path: \.\/node_modules\/dsh-hmos-sidebar\/presets\/native-harmonyos\.declarative\.yml$/m)
  assert.ok(block.startsWith(MANAGED_BEGIN + '\n'))
  assert.ok(block.endsWith(MANAGED_END))
  assert.doesNotMatch(block, /[A-Za-z]:[\\/]/, 'an include target must stay profile-relative')
})

test('mergeManagedBlock replaces the empty document and keeps every user comment', () => {
  const original = '# user note\n# 第二行注释\n\n[]\n'
  const result = mergeManagedBlock(original, renderManagedBlock())
  assert.equal(result.replaced, false)
  assert.match(result.text, /^# user note$/m)
  assert.match(result.text, /^# 第二行注释$/m)
  assert.doesNotMatch(result.text, /^\[\]$/m, 'the empty flow document cannot be appended to and must be replaced')
  assert.match(result.text, /^- insert:$/m)
  assert.match(result.text, /hmos-preset-liangshen-native-harmonyos/)
})

test('mergeManagedBlock appends to a document that already carries entries', () => {
  const original = '- id: subagent-conductor\n  disabled: false\n'
  const result = mergeManagedBlock(original, renderManagedBlock())
  assert.ok(result.text.startsWith(original.trimEnd()), 'existing entries keep their place')
  assert.match(result.text, /- id: subagent-conductor\n  disabled: false\n\n# >>> dsh-hmos-sidebar presets/)
})

test('mergeManagedBlock owns only its marked region and preserves CRLF', () => {
  const original = [
    '# keep me',
    MANAGED_BEGIN,
    '- insert:',
    '    - id: stale-row',
    MANAGED_END,
    '- id: tail',
    '  disabled: false',
    '',
  ].join('\r\n')
  const result = mergeManagedBlock(original, renderManagedBlock())
  assert.equal(result.replaced, true)
  assert.doesNotMatch(result.text, /stale-row/, 'the previously generated rows are regenerated')
  assert.match(result.text, /^# keep me\r\n/)
  assert.match(result.text, /- id: tail\r\n  disabled: false\r\n$/)
  assert.equal(/[^\r]\n/.test(result.text), false, 'no lone LF inside a CRLF document')
})

test('mergeManagedBlock refuses a half-written marker pair instead of guessing', () => {
  assert.throws(() => mergeManagedBlock(`${MANAGED_BEGIN}\n- insert:\n`, renderManagedBlock()), /托管块标记不完整/)
  assert.throws(() => mergeManagedBlock(`- insert:\n${MANAGED_END}\n`, renderManagedBlock()), /托管块标记不完整/)
})

test('declarative install merges the managed block, then refuses without --force', () => {
  const f = profileFixture({ patch: '# 用户注释\n[]\n' })
  try {
    const stamp = new Date('2026-01-02T03:04:05.000Z')
    const first = installPresetsDeclarative({ profileDir: f.profile, presets: PRESET_IDS, now: stamp })
    assert.equal(first.mode, 'declarative')
    assert.equal(first.target, path.join(f.profile, PROFILE_PATCH_FILENAME))
    assert.ok(first.backup, 'modifying a user patch always leaves a backup')
    assert.equal(fs.readFileSync(first.backup, 'utf8'), '# 用户注释\n[]\n')

    const text = fs.readFileSync(first.target, 'utf8')
    assert.match(text, /^# 用户注释$/m, 'user comments survive the merge')
    assert.match(text, /hmos-preset-native-harmonyos/)
    assert.doesNotMatch(text, /^\[\]$/m)

    assert.throws(
      () => installPresetsDeclarative({ profileDir: f.profile, presets: PRESET_IDS }),
      /预设已安装（托管块已存在）/,
    )

    // Re-running with --force and identical content must not churn the file.
    const again = installPresetsDeclarative({ profileDir: f.profile, presets: PRESET_IDS, force: true })
    assert.equal(again.unchanged, true)
    assert.equal(again.backup, null)
    assert.equal(fs.readFileSync(again.target, 'utf8'), text)
  } finally { f.dispose() }
})

test('declarative install creates the profile patch when the profile has none', () => {
  const f = profileFixture()
  try {
    const result = installPresetsDeclarative({ profileDir: f.profile, presets: PRESET_IDS })
    assert.equal(result.backup, null, 'nothing existed to back up')
    assert.equal(fs.readFileSync(result.target, 'utf8'), renderManagedBlock() + '\n')
  } finally { f.dispose() }
})

test('declarative dry-run shows the block and touches nothing', () => {
  const f = profileFixture({ patch: '[]\n' })
  try {
    const result = installPresetsDeclarative({ profileDir: f.profile, dryRun: true })
    assert.equal(result.dryRun, true)
    assert.match(result.block, /hmos-preset-liangshen-native-harmonyos/)
    assert.equal(fs.readFileSync(result.target, 'utf8'), '[]\n')
    assert.equal(fs.readdirSync(f.profile).some((name) => name.includes('.backup-')), false)
  } finally { f.dispose() }
})

test('declarative install refuses a directory that is not a DSH profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-noprofile-'))
  try {
    assert.throws(() => resolveProfileDir(root), /不是 DSH profile 目录/)
    assert.throws(() => installPresetsDeclarative({ profileDir: root }), /不是 DSH profile 目录/)

    const manifestOnly = path.join(root, 'manifest-only')
    fs.mkdirSync(manifestOnly, { recursive: true })
    fs.writeFileSync(path.join(manifestOnly, 'package.json'), '{"name":"not-a-profile"}\n')
    assert.throws(() => resolveProfileDir(manifestOnly), /缺少 dsh\.profile\.bundles/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('declarative install refuses to duplicate rows that were added by hand', () => {
  const f = profileFixture({
    patch: '- insert:\n    - id: hmos-preset-native-harmonyos\n      name: cordis:include\n',
  })
  try {
    assert.throws(
      () => installPresetsDeclarative({ profileDir: f.profile, presets: PRESET_IDS }),
      /手工添加的 preset 行.*hmos-preset-native-harmonyos/,
    )
    assert.equal(
      fs.readFileSync(path.join(f.profile, PROFILE_PATCH_FILENAME), 'utf8'),
      '- insert:\n    - id: hmos-preset-native-harmonyos\n      name: cordis:include\n',
      'the refused run must not have modified the file',
    )
  } finally { f.dispose() }
})

test('declarative install preserves a CRLF profile patch', () => {
  const f = profileFixture({ patch: '# note\r\n- id: subagent-conductor\r\n  disabled: false\r\n' })
  try {
    const result = installPresetsDeclarative({ profileDir: f.profile, presets: PRESET_IDS })
    const text = fs.readFileSync(result.target, 'utf8')
    assert.equal(/[^\r]\n/.test(text), false, 'no lone LF inside a CRLF document')
    assert.match(text, /^- id: subagent-conductor\r\n/m)
    assert.match(text, /^- insert:\r\n/m)
  } finally { f.dispose() }
})
