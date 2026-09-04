import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import {
  defaultScreenshotDir,
  isHarmonyProjectRoot,
  findHarmonyProjectRoots,
  validateInstallHap,
  validateHapInfo,
  withinTrusted,
  isWithinAny,
  trustedRoots,
  resolveRealWinPath,
  sanitizeTail,
  fence,
  apply,
  SETTINGS_NS,
  DEFAULT_SETTINGS,
} from '../lib/index.js'

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hmos-index-'))
}

function normalizedWinPath(value) {
  return value.replace(/\//g, '\\').toLowerCase()
}

// Windows exposes both the short 8.3 path (realpathSync) and the native long
// path (realpathSync.native). Production code deliberately uses the native
// form, so test expectations must resolve through the same API to avoid
// runner-name differences such as RUNNER~1 versus RunnerAdmin.
function nativeRealpath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value)
}

test('defaultScreenshotDir is neutral (no D:/tmp), prefers config.screenshotDir', () => {
  const d = defaultScreenshotDir({ screenshotDir: 'C:\\shots' }, 'C:\\project')
  assert.equal(d, 'C:\\shots')
})

test('defaultScreenshotDir falls back to project .dsh-screenshots (no personal path)', () => {
  const d = defaultScreenshotDir({}, 'C:\\proj\\Demo')
  assert.ok(!/D:\\tmp|D:\/tmp/i.test(d), 'no D:/tmp personal path: ' + d)
  assert.match(d, /\.dsh-screenshots$/)
})

test('defaultScreenshotDir falls back to OS temp dir when no project path', () => {
  const d = defaultScreenshotDir({}, '')
  assert.ok(d.includes('dsh-hmos-screenshots'), 'tmp-based: ' + d)
  assert.ok(os.platform() === 'win32' ? /\\/.test(d) : true)
})

test('index module loads and exports helpers as functions', () => {
  for (const fn of [defaultScreenshotDir, isHarmonyProjectRoot, validateInstallHap, validateHapInfo, withinTrusted, sanitizeTail, fence]) {
    assert.equal(typeof fn, 'function')
  }
})

// ---- 官方设置命名空间（设置 → 插件 → HarmonyOS 工作台）----

test('settings namespace contract: hmos-sidebar with quiet defaults', () => {
  assert.equal(SETTINGS_NS, 'hmos-sidebar')
  assert.deepEqual(DEFAULT_SETTINGS, { popup: { keepCollapsed: true }, ball: { hideWithoutProject: true } })
})

test('apply registers the hmos-sidebar settings namespace on the settings service', () => {
  const registered = []
  const sctx = {
    settings: {
      register(ns, schema, options) {
        registered.push({ ns, schema, options })
        return { get: () => null, watch: () => () => {} }
      },
    },
    effect(fn) { return fn() },
  }
  const ctx = {
    subprocess: undefined,
    get: () => undefined,
    inject(deps, cb) {
      assert.deepEqual(deps, ['settings'], 'settings stays an optional nested dependency')
      cb(sctx)
    },
    effect(fn) { return fn() },
    webServer: { register() {} },
  }
  apply(ctx)
  assert.equal(registered.length, 1)
  const reg = registered[0]
  assert.equal(reg.ns, 'hmos-sidebar')
  assert.equal(reg.options.applies, 'live')
  assert.deepEqual(reg.options.base, DEFAULT_SETTINGS, 'composition base layers the quiet defaults')
  assert.equal(typeof reg.options.validate, 'function')
  // schema 是 schemastery 实例（describe() 会调用 toJSON()）
  assert.equal(typeof reg.schema.toJSON, 'function')

  // validate 接受合法值、拒绝缺字段/非布尔
  reg.options.validate(DEFAULT_SETTINGS)
  reg.options.validate({ popup: { keepCollapsed: false }, ball: { hideWithoutProject: true } })
  assert.throws(() => reg.options.validate({}))
  assert.throws(() => reg.options.validate({ popup: { keepCollapsed: 'yes' }, ball: { hideWithoutProject: true } }))
})

// ---- 路径围栏（withinTrusted / validateInstallHap / validateHapInfo + 可信根） ----

test('withinTrusted allows empty roots (no fence configured)', () => {
  assert.equal(withinTrusted('D:\\anywhere\\x.hap', []).ok, true)
})

test('withinTrusted rejects paths outside trusted roots', () => {
  const r = withinTrusted('D:\\evil\\x.hap', ['C:\\proj'], 'HAP 文件')
  assert.equal(r.ok, false)
  assert.match(r.error, /可信根/)
})

test('withinTrusted accepts inside paths (case-insensitive, slash-normalized)', () => {
  assert.equal(withinTrusted('c:/proj/entry/build/out.hap', ['C:\\proj']).ok, true)
  assert.equal(withinTrusted('C:\\proj', ['C:\\proj']).ok, true)
  assert.equal(withinTrusted('C:\\proj2', ['C:\\proj']).ok, false, 'prefix sibling not inside')
})

test('validateInstallHap enforces containment when roots provided', () => {
  const tmp = tmpRoot()
  const hap = path.join(tmp, 'out.hap')
  fs.writeFileSync(hap, 'x')
  assert.equal(validateInstallHap(hap, [tmp]).ok, true)
  const outside = validateInstallHap(hap, ['C:\\other-root'])
  assert.equal(outside.ok, false)
  assert.match(outside.error, /可信根/)
  assert.equal(validateInstallHap(hap).ok, true, 'no roots: permissive')
})

test('validateHapInfo enforces containment when roots provided', () => {
  const tmp = tmpRoot()
  const p = path.join(tmp, 'x.app')
  fs.writeFileSync(p, 'x')
  assert.equal(validateHapInfo(p, [tmp]).ok, true)
  assert.equal(validateHapInfo(p, ['C:\\other']).ok, false)
})

// ---- 路径逃逸（drive + slash + UNC）与兄弟前缀 ----
test('isWithinAny rejects drive-letter .. escape (backslash and forward-slash)', () => {
  assert.equal(isWithinAny('C:\\proj\\..\\outside\\x.hap', ['C:\\proj']), false)
  assert.equal(isWithinAny('C:/proj/../outside/x.hap', ['C:\\proj']), false)
})

test('isWithinAny rejects UNC .. escape', () => {
  assert.equal(isWithinAny('\\\\server\\share\\proj\\..\\..\\outside\\x.hap', ['\\\\server\\share\\proj']), false)
})

test('isWithinAny allows inside (case-insensitive) and rejects sibling prefix', () => {
  assert.equal(isWithinAny('c:/proj/entry/build/out.hap', ['C:\\proj']), true)
  assert.equal(isWithinAny('C:\\proj', ['C:\\proj']), true)
  assert.equal(isWithinAny('C:\\proj2', ['C:\\proj']), false, 'prefix sibling not inside')
})

test('isWithinAny treats ..foo as a legitimate inside name, still rejects .. escape', () => {
  assert.equal(isWithinAny('C:\\proj\\..foo\\x.hap', ['C:\\proj']), true, '..foo is a legal directory name, not a .. escape')
  assert.equal(isWithinAny('C:\\proj\\..\\outside\\x.hap', ['C:\\proj']), false, '..\\outside still escapes')
})

// ---- realpath 最近父目录 helper ----
test('resolveRealWinPath resolves lexical .. and nearest-existing ancestor (no junction required)', () => {
  // C:\proj\..\outside\x.hap 词法归一化为 C:\outside\x.hap（C:\ 存在即可，proj/outside 无需存在）
  assert.equal(resolveRealWinPath('C:\\proj\\..\\outside\\x.hap').toLowerCase(), 'c:\\outside\\x.hap')
  // 已存在路径返回真实路径
  const tmp = tmpRoot()
  const f = path.join(tmp, 'real.hap')
  fs.writeFileSync(f, 'x')
  try {
    assert.equal(normalizedWinPath(resolveRealWinPath(f)), normalizedWinPath(nativeRealpath(f)))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ---- 临时 junction 逃逸（Windows 权限不允许创建时跳过） ----
test('junction escape is rejected (skips if junction creation not permitted)', (t) => {
  const root = tmpRoot()
  try {
    const inside = path.join(root, 'inside')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(inside, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, 'x.hap'), 'x')
    const link = path.join(inside, 'link')
    try {
      fs.symlinkSync(outside, link, 'junction')
    } catch (e) {
      t.skip('junction creation not permitted: ' + e.message)
      return
    }
    // 经 junction 指向 outside 的 x.hap，真实位置在 outside，不在 inside 根内
    assert.equal(isWithinAny(path.join(link, 'x.hap'), [inside]), false, 'junction escape rejected')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---- 显式可信根语义（trustedRoots） ----
test('trustedRoots({}) is empty when PROJECT_PATH cleared (cwd not mixed in)', () => {
  const prev = process.env.PROJECT_PATH
  delete process.env.PROJECT_PATH
  try {
    assert.deepEqual(trustedRoots({}), [])
  } finally {
    if (prev === undefined) delete process.env.PROJECT_PATH
    else process.env.PROJECT_PATH = prev
  }
})

test('trustedRoots includes only explicit config.projectPath / env PROJECT_PATH / projectRoots', () => {
  const prev = process.env.PROJECT_PATH
  try {
    process.env.PROJECT_PATH = 'C:\\envproj'
    const roots = trustedRoots({ projectPath: 'C:\\cfgproj', projectRoots: ['D:\\roots\\a'] })
    const lower = roots.map((r) => r.toLowerCase())
    assert.ok(lower.includes('c:\\cfgproj'))
    assert.ok(lower.includes('c:\\envproj'))
    assert.ok(lower.includes('d:\\roots\\a'))
    assert.ok(!lower.includes(process.cwd().replace(/\//g, '\\').toLowerCase()), 'cwd is not a trusted root')
  } finally {
    if (prev === undefined) delete process.env.PROJECT_PATH
    else process.env.PROJECT_PATH = prev
  }
})

test('trustedRoots with projectRoots but no projectPath does not add cwd', () => {
  const prev = process.env.PROJECT_PATH
  delete process.env.PROJECT_PATH
  try {
    assert.deepEqual(trustedRoots({ projectRoots: ['D:\\roots\\b'] }).map((r) => r.toLowerCase()), ['d:\\roots\\b'])
  } finally {
    if (prev === undefined) delete process.env.PROJECT_PATH
    else process.env.PROJECT_PATH = prev
  }
})

// ---- install/hap-info 端到端：已存在文件经 .. 逃逸被拒 ----
test('install/hap-info reject an existing file whose path escapes via ..', () => {
  const root = tmpRoot()
  try {
    const inner = path.join(root, 'inner')
    const outsideDir = path.join(root, 'outside')
    fs.mkdirSync(inner, { recursive: true })
    fs.mkdirSync(outsideDir, { recursive: true })
    const outsideHap = path.join(outsideDir, 'escape.hap')
    fs.writeFileSync(outsideHap, 'x')
    const escPath = path.join(inner, '..', 'outside', 'escape.hap')
    assert.equal(fs.existsSync(escPath), true, 'escape path resolves to an existing file')
    const ri = validateInstallHap(escPath, [inner])
    assert.equal(ri.ok, false, 'install rejects .. escape')
    assert.match(ri.error, /可信根/)
    const rh = validateHapInfo(escPath, [inner])
    assert.equal(rh.ok, false, 'hap-info rejects .. escape')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---- logs tail 钳制 ----

test('sanitizeTail clamps and defaults', () => {
  assert.equal(sanitizeTail(500), 500)
  assert.equal(sanitizeTail('999999999'), 10000)
  assert.equal(sanitizeTail(0), 1)
  assert.equal(sanitizeTail(-5), 1)
  assert.equal(sanitizeTail('abc'), 200)
  assert.equal(sanitizeTail(3.7), 3)
})

// ---- 有效 Harmony 工程根 helper ----
test('isHarmonyProjectRoot accepts a dir with build-profile.json5 + AppScope/app.json5', () => {
  const root = tmpRoot()
  try {
    assert.equal(isHarmonyProjectRoot(root), false, 'bare dir is not a project root')
    fs.mkdirSync(path.join(root, 'AppScope'), { recursive: true })
    assert.equal(isHarmonyProjectRoot(root), false, 'only AppScope dir is not enough')
    fs.writeFileSync(path.join(root, 'AppScope', 'app.json5'), '{}')
    assert.equal(isHarmonyProjectRoot(root), false, 'missing build-profile.json5 still not valid')
    fs.writeFileSync(path.join(root, 'build-profile.json5'), '{}')
    assert.equal(isHarmonyProjectRoot(root), true, 'both markers present')
    // 正斜杠路径也接受
    assert.equal(isHarmonyProjectRoot(root.replace(/\\/g, '/')), true, 'forward-slash path accepted')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('isHarmonyProjectRoot rejects missing/empty paths', () => {
  assert.equal(isHarmonyProjectRoot(''), false)
  assert.equal(isHarmonyProjectRoot(undefined), false)
  assert.equal(isHarmonyProjectRoot(null), false)
})

test('findHarmonyProjectRoots detects current root and nested workspace projects', () => {
  const workspace = tmpRoot()
  try {
    const nested = path.join(workspace, 'apps', 'demo')
    fs.mkdirSync(path.join(nested, 'AppScope'), { recursive: true })
    fs.writeFileSync(path.join(nested, 'build-profile.json5'), '{}')
    fs.writeFileSync(path.join(nested, 'AppScope', 'app.json5'), '{}')
    const expected = normalizedWinPath(nativeRealpath(nested))
    assert.deepEqual(findHarmonyProjectRoots(nested).map(normalizedWinPath), [expected])
    assert.deepEqual(findHarmonyProjectRoots(workspace).map(normalizedWinPath), [expected])
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('findHarmonyProjectRoots skips heavy directories and respects depth', () => {
  const workspace = tmpRoot()
  try {
    const skipped = path.join(workspace, 'node_modules', 'fake')
    fs.mkdirSync(path.join(skipped, 'AppScope'), { recursive: true })
    fs.writeFileSync(path.join(skipped, 'build-profile.json5'), '{}')
    fs.writeFileSync(path.join(skipped, 'AppScope', 'app.json5'), '{}')
    const deep = path.join(workspace, 'a', 'b', 'c', 'demo')
    fs.mkdirSync(path.join(deep, 'AppScope'), { recursive: true })
    fs.writeFileSync(path.join(deep, 'build-profile.json5'), '{}')
    fs.writeFileSync(path.join(deep, 'AppScope', 'app.json5'), '{}')
    assert.deepEqual(findHarmonyProjectRoots(workspace), [])
    const expected = normalizedWinPath(nativeRealpath(deep))
    assert.deepEqual(findHarmonyProjectRoots(workspace, { maxDepth: 4 }).map(normalizedWinPath), [expected])
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

// ---- HAP 校验 helper ----
test('validateInstallHap requires an existing .hap file', () => {
  const root = tmpRoot()
  try {
    const hap = path.join(root, 'entry-debug-signed.hap')
    fs.writeFileSync(hap, 'x')
    let r = validateInstallHap(hap)
    assert.equal(r.ok, true, 'existing .hap accepted')
    assert.equal(r.path, hap.replace(/\//g, '\\'))
    // 不存在但扩展符 .hap → 文件不存在
    r = validateInstallHap(path.join(root, 'missing.hap'))
    assert.equal(r.ok, false)
    assert.match(r.error, /文件不存在/)
    // 非 .hap 扩展 → 只接受 .hap
    const notHap = path.join(root, 'bundle.app')
    fs.writeFileSync(notHap, 'x')
    r = validateInstallHap(notHap)
    assert.equal(r.ok, false, '.app rejected for install')
    assert.match(r.error, /只接受 \.hap/)
    // 缺路径
    assert.match(validateInstallHap('').error, /需要 hapPath/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('validateHapInfo requires an existing .hap or .app file', () => {
  const root = tmpRoot()
  try {
    const hap = path.join(root, 'a.hap')
    const app = path.join(root, 'b.app')
    const txt = path.join(root, 'c.txt')
    fs.writeFileSync(hap, 'x')
    fs.writeFileSync(app, 'x')
    fs.writeFileSync(txt, 'x')
    let r = validateHapInfo(hap)
    assert.equal(r.ok, true)
    assert.equal(r.app, false)
    r = validateHapInfo(app)
    assert.equal(r.ok, true)
    assert.equal(r.app, true)
    r = validateHapInfo(txt)
    assert.equal(r.ok, false)
    assert.match(r.error, /只接受 \.hap\/\.app/)
    r = validateHapInfo('')
    assert.equal(r.ok, false)
    assert.match(r.error, /hap-info 需要 path/)
    r = validateHapInfo(path.join(root, 'missing.app'))
    assert.equal(r.ok, false)
    assert.match(r.error, /文件不存在/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---- fence 矩阵 ----
function reqWith(headers) {
  const req = {}
  const add = (k, v) => { req[k] = v }
  // 同时暴露 headers 与顶层属性，按实现读取方式断言
  return { headers: Object.assign({}, headers) }
}

test('fence rejects non-loopback host', () => {
  assert.equal(fence(reqWith({ host: 'evil.example.com' })), false)
  assert.equal(fence({ headers: {} }), false, 'no host')
})

test('fence allows loopback host with no origin when sec-fetch-site is same-origin', () => {
  assert.equal(fence(reqWith({ host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(fence(reqWith({ host: 'localhost:3080', 'sec-fetch-site': 'same-site' })), true)
  assert.equal(fence(reqWith({ host: '[::1]:3080', 'sec-fetch-site': 'same-origin' })), true)
})

test('fence rejects loopback with no origin and cross-site sec-fetch', () => {
  assert.equal(fence(reqWith({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })), false)
  // 无 origin 且无 sec-fetch-site 的非浏览器探针拒绝
  assert.equal(fence(reqWith({ host: '127.0.0.1:3080' })), false)
})

test('fence matches same-origin Origin host:port exactly', () => {
  const host = '127.0.0.1:3080'
  assert.equal(fence(reqWith({ host, origin: 'http://127.0.0.1:3080' })), true)
  // https 协议同 host 也放行
  assert.equal(fence(reqWith({ host, origin: 'https://127.0.0.1:3080' })), true)
  // port 不同拒绝
  assert.equal(fence(reqWith({ host, origin: 'http://127.0.0.1:9999' })), false)
  // host 不同拒绝
  assert.equal(fence(reqWith({ host, origin: 'http://localhost:3080' })), false)
})

test('fence rejects non-http(s) origins even when host matches', () => {
  assert.equal(fence(reqWith({ host: '127.0.0.1:3080', origin: 'ftp://127.0.0.1:3080' })), false)
  assert.equal(fence(reqWith({ host: '127.0.0.1:3080', origin: 'file:///x' })), false)
})

test('fence rejects malformed host or origin', () => {
  assert.equal(fence(reqWith({ host: 'not a host' })), false)
  assert.equal(fence(reqWith({ host: '127.0.0.1:3080', origin: '::garbage' })), false)
})

// ---- 源码级：sync 方法不接受 args.argv ----
test('hmos/sync source constructs argv from product/buildMode only (no args.argv branch)', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const start = src.indexOf("'hmos/sync'")
  assert.ok(start >= 0, 'hmos/sync method present')
  // 取到下一个 async 方法（'hmos/start'）之前即为 sync 方法体，避免魔法窗口偏移
  const next = src.indexOf('async ', start + 1)
  const syncBlock = next === -1 ? src.slice(start) : src.slice(start, next)
  assert.ok(!/args\s*\.\s*argv/.test(syncBlock), 'sync must not read args.argv')
  assert.match(syncBlock, /'--sync'/)
  assert.match(syncBlock, /product=/)
  assert.match(syncBlock, /buildMode=/)
})
