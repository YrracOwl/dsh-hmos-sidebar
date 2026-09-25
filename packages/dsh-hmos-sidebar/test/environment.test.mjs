import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveEnv,
  cliMissingError,
  studioMissingError,
  cliCandidates,
  cliEntryFromManifest,
  cliPackageRootFromEntry,
  json5Candidates,
  isVolatileRef,
  configString,
  configStringList,
  WINDOWS_ONLY,
  DEFAULT_PROJECT_ROOTS,
} from '../lib/environment.js'

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-env-'))
}

// 会影响 CLI 自动探测的环境变量：夹具里全部清空，只留下一个临时 npm 全局根，
// 保证这些断言与本机真实安装无关。
const CLI_ENV_KEYS = [
  'DEVECO_CLI_PATH', 'DEVECO_HOME', 'DEVECO_SDK_HOME', 'PROJECT_PATH',
  'APPDATA', 'USERPROFILE', 'LOCALAPPDATA', 'PROGRAMFILES',
]

// 机器无关夹具：临时目录当作 %APPDATA%（npm 全局根 = <root>/npm）。
function withFakeNpmRoot(fn) {
  const root = tmpRoot()
  const saved = {}
  for (const k of CLI_ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.APPDATA = root
  try {
    return fn(root)
  } finally {
    for (const k of CLI_ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

// 在临时 npm 全局根里造一个 deveco-cli 包目录，manifest 内容由调用方决定。
function fakeCliPkgDir(root) {
  return path.join(root, 'npm', 'node_modules', '@deveco', 'deveco-cli')
}

function writeFakeCliPackage(pkgDir, manifest, entries) {
  fs.mkdirSync(pkgDir, { recursive: true })
  if (manifest !== undefined) {
    fs.writeFileSync(path.join(pkgDir, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  }
  for (const rel of entries) {
    const target = path.join(pkgDir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '#!/usr/bin/env node\n')
  }
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

// ---------------------------------------------------------------------------
// CLI 入口布局无关性（@deveco/deveco-cli 1.3.4 起入口从 dist/cli.js 变成 cli.js）
//
// 入口不再写死，而是读安装包自己的 package.json#bin；旧布局只作兜底候选。
// 以下夹具全部在临时 npm 全局根里构造，不触碰本机真实安装。
// ---------------------------------------------------------------------------

test('cliCandidates resolves the ≥1.3.4 entry (bin: cli.js) from the installed manifest', () => {
  withFakeNpmRoot((root) => {
    const pkgDir = fakeCliPkgDir(root)
    writeFakeCliPackage(pkgDir, { name: '@deveco/deveco-cli', version: '1.3.4', bin: { devecocli: 'cli.js' } }, ['cli.js'])
    const json5Dir = path.join(pkgDir, 'node_modules', 'json5')
    fs.mkdirSync(json5Dir, { recursive: true })
    fs.writeFileSync(path.join(json5Dir, 'package.json'), '{}')

    const candidates = cliCandidates()
    assert.equal(candidates[0], path.join(pkgDir, 'cli.js'), 'manifest 解析的入口必须排在第一位')
    assert.ok(candidates.includes(path.join(pkgDir, 'dist', 'cli.js')), '旧布局候选仍保留作兜底')

    const e = resolveEnv({ projectPath: os.tmpdir() })
    assert.equal(e.cliSource, 'detected')
    assert.equal(e.cliOk, true)
    assert.equal(e.CLI, path.join(pkgDir, 'cli.js'))
    // json5：从 cli.js 向上定位包根，命中包内 node_modules/json5
    assert.equal(json5Candidates(path.join(pkgDir, 'cli.js'))[0], json5Dir)
    assert.equal(e.JSON5_DIR, json5Dir)
    assert.equal(e.json5Ok, true)
  })
})

test('cliCandidates still resolves the legacy ≤1.3.3 dist/cli.js layout without duplicates', () => {
  withFakeNpmRoot((root) => {
    const pkgDir = fakeCliPkgDir(root)
    writeFakeCliPackage(pkgDir, { name: '@deveco/deveco-cli', version: '1.3.3', bin: { devecocli: 'dist/cli.js' } }, [path.join('dist', 'cli.js')])
    const json5Dir = path.join(pkgDir, 'node_modules', 'json5')
    fs.mkdirSync(json5Dir, { recursive: true })
    fs.writeFileSync(path.join(json5Dir, 'package.json'), '{}')

    const legacyEntry = path.join(pkgDir, 'dist', 'cli.js')
    const candidates = cliCandidates()
    assert.equal(candidates[0], legacyEntry)
    assert.equal(candidates.filter((p) => p === legacyEntry).length, 1, 'manifest 与兜底候选重合时必须去重')

    const e = resolveEnv({ projectPath: os.tmpdir() })
    assert.equal(e.cliSource, 'detected')
    assert.equal(e.CLI, legacyEntry)
    // json5：dist/cli.js 需向上两层才到包根
    assert.equal(json5Candidates(legacyEntry)[0], json5Dir)
    assert.equal(e.JSON5_DIR, json5Dir)
  })
})

test('cliCandidates falls back to the legacy candidate when the manifest is absent or unreadable (no throw)', () => {
  withFakeNpmRoot((root) => {
    const pkgDir = fakeCliPkgDir(root)
    // 只有旧布局文件，没有 package.json
    writeFakeCliPackage(pkgDir, undefined, [path.join('dist', 'cli.js')])
    const legacyEntry = path.join(pkgDir, 'dist', 'cli.js')
    assert.deepEqual(cliCandidates(), [legacyEntry])

    // manifest 存在但不是合法 JSON：同样安静回退，绝不抛
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{ not json')
    assert.deepEqual(cliCandidates(), [legacyEntry])

    // manifest 合法但没有 bin：仍然回退到兜底候选
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deveco/deveco-cli' }))
    assert.deepEqual(cliCandidates(), [legacyEntry])

    const e = resolveEnv({ projectPath: os.tmpdir() })
    assert.equal(e.cliSource, 'detected')
    assert.equal(e.cliOk, true)
    assert.equal(e.CLI, legacyEntry)
  })
})

test('cliEntryFromManifest handles string/object bin forms and never throws on bad input', () => {
  const root = tmpRoot()
  try {
    const pkgDir = path.join(root, 'pkg')
    fs.mkdirSync(pkgDir, { recursive: true })
    const write = (value) => fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(value))

    write({ name: '@deveco/deveco-cli', bin: 'cli.js' }) // 字符串形式
    assert.equal(cliEntryFromManifest(pkgDir), path.join(pkgDir, 'cli.js'))

    write({ name: '@deveco/deveco-cli', bin: { devecocli: 'bin\\cli.js' } }) // 反斜杠相对路径
    assert.equal(cliEntryFromManifest(pkgDir), path.join(pkgDir, 'bin', 'cli.js'))

    write({ name: '@deveco/deveco-cli', bin: { 'deveco-cli': './cli.js' } }) // 包名键 + ./ 前缀
    assert.equal(cliEntryFromManifest(pkgDir), path.join(pkgDir, 'cli.js'))

    write({ name: '@deveco/deveco-cli', bin: { somethingElse: 'main.js' } }) // 唯一值
    assert.equal(cliEntryFromManifest(pkgDir), path.join(pkgDir, 'main.js'))

    write({ name: '@deveco/deveco-cli' }) // 没有 bin
    assert.equal(cliEntryFromManifest(pkgDir), '')

    fs.writeFileSync(path.join(pkgDir, 'package.json'), 'not json at all')
    assert.equal(cliEntryFromManifest(pkgDir), '')

    fs.rmSync(path.join(pkgDir, 'package.json'))
    assert.equal(cliEntryFromManifest(pkgDir), '')
    assert.equal(cliEntryFromManifest(path.join(root, 'does-not-exist')), '')
    assert.equal(cliEntryFromManifest(''), '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('cliPackageRootFromEntry walks up to the CLI package root for both layouts', () => {
  const root = tmpRoot()
  try {
    const pkgDir = path.join(root, 'node_modules', '@deveco', 'deveco-cli')
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deveco/deveco-cli' }))

    assert.equal(cliPackageRootFromEntry(path.join(pkgDir, 'cli.js')), pkgDir)
    assert.equal(cliPackageRootFromEntry(path.join(pkgDir, 'dist', 'cli.js')), pkgDir)
    // 不是 deveco-cli 的祖先目录不会被误认
    fs.mkdirSync(path.join(root, 'other'), { recursive: true })
    fs.writeFileSync(path.join(root, 'other', 'package.json'), JSON.stringify({ name: 'some-other-pkg' }))
    assert.equal(cliPackageRootFromEntry(path.join(root, 'other', 'cli.js')), '')
    assert.equal(cliPackageRootFromEntry(''), '')

    // 找不到包根时 json5Candidates 仍能退回旧形状 + npm 全局根候选，不抛异常
    assert.ok(json5Candidates(path.join(root, 'other', 'cli.js')).length > 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('cliMissingError names the manifest-based discovery, the global install and both overrides', () => {
  const msg = cliMissingError({})
  assert.match(msg, /未找到 deveco-cli 入口/)
  assert.match(msg, /npm install -g @deveco\/deveco-cli/)
  assert.match(msg, /DEVECO_CLI_PATH/)
  assert.match(msg, /cliPath/)
  assert.doesNotMatch(msg, /dist[\\/]cli\.js/, '不得再把旧布局写成唯一入口路径')
})

// ---------------------------------------------------------------------------
// volatile 配置读取（0.1.7 线回归：面板出现 "[object Object] … [config]"）
//
// schemastery ≥ 3.18.4 把标记了 `.volatile()` 的字段解析成 cosmokit 的不可变引用
// 对象 `{ get(), [Symbol.for('cosmokit.volatile.write')] }`，而不是原始值；
// cordis 的 resolveConfig() 又对**每个**入口 config 无条件跑一遍入口 `Config`
// （连没有 `config:` 的行也一样），所以 0.1.7 线上 `config.cliPath` 永远是包装对象。
// 宿主必须按共享 symbol 判定并 `.get()` 取原值，否则 `norm()` 会把它变成
// "[object Object]"：cliSource 报成 'config'，CLI 探活、json5 定位一起失败。
//
// 夹具是就地手写的**等价形状**（取自 cosmokit createVolatile 的实现），既不依赖
// 本机 schemastery 版本，也不触碰真实安装目录。
// ---------------------------------------------------------------------------

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function volatileRef(value) {
  let current = value
  return Object.freeze({
    get: () => current,
    [VOLATILE_WRITE]: (next) => { current = next },
  })
}

test('configString/configStringList/isVolatileRef are the single unwrap gate for config values', () => {
  const wrapper = volatileRef('C:\\cli\\cli.js')

  // 普通字符串原样通过；包装解出原值
  assert.equal(configString('C:\\plain\\cli.js'), 'C:\\plain\\cli.js')
  assert.equal(configString(wrapper), 'C:\\cli\\cli.js')
  assert.equal(isVolatileRef(wrapper), true)
  assert.equal(isVolatileRef('C:\\plain'), false)

  // 未配置：undefined / null / 空串 / 包装里的空串或未定义
  for (const absent of [undefined, null, '', volatileRef(''), volatileRef(undefined), volatileRef(null)]) {
    assert.equal(configString(absent), '')
  }

  // 不是 volatile 包装的对象一律当作未配置：绝不 stringify 成 "[object Object]"
  for (const bogus of [{ path: 'C:\\x' }, { get: () => 'C:\\x' }, { get: 'C:\\x' }, { [Symbol.for('other')]: 1 }, 123, true, ['C:\\x']]) {
    assert.equal(isVolatileRef(bogus), false)
    assert.equal(configString(bogus), '')
  }

  // 非对象列表 / 混合列表：逐项解包并丢弃非字符串与空值
  assert.deepEqual(configStringList(undefined), [])
  assert.deepEqual(configStringList('C:\\not-a-list'), [])
  assert.deepEqual(
    configStringList([volatileRef('D:\\a'), 'D:\\b', { path: 'D:\\bogus' }, '', volatileRef('')]),
    ['D:\\a', 'D:\\b'],
  )
  // 包装只按共享 symbol 识别，仿冒对象（有 get 无 symbol）不得被解包
  assert.equal(configString({ get: () => 'C:\\fake' }), '')
})

test('resolveEnv accepts a volatile-wrapped cliPath exactly like a plain string', () => {
  const root = tmpRoot()
  try {
    const cliDir = path.join(root, 'node_modules', '@deveco', 'deveco-cli')
    const cli = path.join(cliDir, 'dist', 'cli.js')
    fs.mkdirSync(path.dirname(cli), { recursive: true })
    fs.writeFileSync(cli, '#!/usr/bin/env node\n')
    fs.mkdirSync(path.join(cliDir, 'node_modules', 'json5'), { recursive: true })
    fs.writeFileSync(path.join(cliDir, 'node_modules', 'json5', 'package.json'), '{}')

    const wrapped = resolveEnv({ cliPath: volatileRef(cli) })
    const plain = resolveEnv({ cliPath: cli })

    assert.notEqual(wrapped.CLI, '[object Object]', 'volatile 包装绝不能被 stringify 成假路径')
    assert.equal(wrapped.CLI, cli.replace(/\//g, '\\'))
    assert.equal(wrapped.cliSource, 'config')
    assert.equal(wrapped.cliOk, true, '包装的 cliPath 必须能通过探活')
    assert.equal(wrapped.JSON5_DIR, path.join(cliDir, 'node_modules', 'json5'))
    assert.equal(wrapped.json5Ok, true, 'json5 由 CLI 入口派生，包装必须一并修复')
    // 包装与非包装必须解析出完全相同的形状
    assert.deepEqual({ ...wrapped, cfg: null }, { ...plain, cfg: null })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv unwraps volatile projectPath/devEcoHome/projectRoots and keeps plain strings', () => {
  const root = tmpRoot()
  try {
    const studio = path.join(root, 'DevEco Studio')
    fs.mkdirSync(path.join(studio, 'sdk', 'default'), { recursive: true })
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj, { recursive: true })

    const e = resolveEnv({
      projectPath: volatileRef(proj),
      devEcoHome: volatileRef(studio),
      projectRoots: [volatileRef(path.join(root, 'r1')), path.join(root, 'r2')],
    })

    assert.equal(e.PROJECT, proj.replace(/\//g, '\\'))
    assert.equal(e.projectSource, 'config')
    assert.equal(e.DEVECO_HOME, studio.replace(/\//g, '\\'))
    assert.equal(e.devEcoOk, true)
    assert.equal(e.devEcoSource, 'config')
    assert.deepEqual(e.projectRoots.map((p) => p.toLowerCase()), [
      path.join(root, 'r1').replace(/\//g, '\\').toLowerCase(),
      path.join(root, 'r2').replace(/\//g, '\\').toLowerCase(),
    ])
    assert.ok(!JSON.stringify(e.projectRoots).includes('[object Object]'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveEnv treats absent, empty and volatile-wrapped-empty cliPath as unset (detection still works)', () => {
  withFakeNpmRoot((root) => {
    const pkgDir = fakeCliPkgDir(root)
    writeFakeCliPackage(pkgDir, { name: '@deveco/deveco-cli', version: '1.3.4', bin: { devecocli: 'cli.js' } }, ['cli.js'])
    const json5Dir = path.join(pkgDir, 'node_modules', 'json5')
    fs.mkdirSync(json5Dir, { recursive: true })
    fs.writeFileSync(path.join(json5Dir, 'package.json'), '{}')
    const entry = path.join(pkgDir, 'cli.js')

    const unsetCases = [
      ['undefined', undefined],
      ['empty string', ''],
      ['wrapper around empty string', volatileRef('')],
      ['wrapper around undefined', volatileRef(undefined)],
    ]
    for (const [label, cliPath] of unsetCases) {
      const e = resolveEnv({ cliPath })
      assert.equal(e.cliSource, 'detected', '缺省/空值必须继续走自动探测: ' + label)
      assert.equal(e.CLI, entry)
      assert.equal(e.cliOk, true)
      assert.equal(e.json5Ok, true, '探测到的 CLI 仍要派生出 json5: ' + label)
    }
  })
})

test('resolveEnv ignores a cliPath object that is not a volatile wrapper instead of stringifying it', () => {
  withFakeNpmRoot((root) => {
    const pkgDir = fakeCliPkgDir(root)
    writeFakeCliPackage(pkgDir, { name: '@deveco/deveco-cli', version: '1.3.4', bin: { devecocli: 'cli.js' } }, ['cli.js'])
    const entry = path.join(pkgDir, 'cli.js')

    // 普通对象、带 get() 但没有 volatile symbol 的仿冒对象、数字、数组：都不是路径
    const bogus = [
      { path: 'C:\\bogus\\cli.js' },
      { get: () => 'C:\\bogus\\cli.js' },
      { get: 'C:\\bogus\\cli.js' },
      123,
      ['C:\\bogus\\cli.js'],
    ]
    for (const cliPath of bogus) {
      const e = resolveEnv({ cliPath })
      assert.notEqual(e.CLI, '[object Object]', '对象绝不能进 norm(): ' + JSON.stringify(cliPath))
      assert.ok(!String(e.CLI).includes('bogus'), '非包装对象必须被忽略: ' + JSON.stringify(cliPath))
      assert.equal(e.CLI, entry, '忽略后回落到自动探测: ' + JSON.stringify(cliPath))
      assert.equal(e.cliSource, 'detected')
      assert.equal(e.cliOk, true)
    }
  })
})

test('resolveEnv with a non-wrapper object cliPath and no detection reports missing, never [object Object]', () => {
  const saved = {}
  const keys = ['DEVECO_CLI_PATH', 'APPDATA', 'USERPROFILE', 'LOCALAPPDATA', 'PROGRAMFILES']
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k] }
  try {
    const e = resolveEnv({ cliPath: { path: 'C:\\bogus\\cli.js' } })
    assert.equal(e.CLI, '')
    assert.equal(e.cliOk, false)
    assert.equal(e.cliSource, 'missing')
    assert.equal(e.json5Ok, false)
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
})

