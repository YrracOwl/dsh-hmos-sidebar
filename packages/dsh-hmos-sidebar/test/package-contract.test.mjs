import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

// ---------------------------------------------------------------------------
// Dependency-free mini-semver subset (validated 1:1 against node-semver 7.8.5
// over 390 version × range checks). Supports exactly the grammar this
// manifest uses: X.Y.Z[-pre] versions and ranges of whitespace-separated
// comparators (^ >= > <= < =) joined by `||`, including semver's caret
// desugaring and the prerelease opt-in rule. Unsupported syntax throws
// instead of guessing.
// ---------------------------------------------------------------------------

function parseVersion(input) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input)
  if (!m) throw new Error('mini-semver: unsupported version ' + input)
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] === undefined ? [] : m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
  }
}

function compareIdentifiers(a, b) {
  const an = typeof a === 'number'
  const bn = typeof b === 'number'
  if (an && bn) return a - b
  if (an) return -1 // numeric identifiers sort below alphanumeric ones
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePre(a, b) {
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0
    return a.length === 0 ? 1 : -1 // a released version ranks above any prerelease
  }
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdentifiers(a[i], b[i])
    if (c !== 0) return c
  }
  return a.length - b.length
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePre(a.pre, b.pre)
}

function parseComparator(text) {
  const m = /^(\^|>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(text)
  if (!m) throw new Error('mini-semver: unsupported comparator ' + text)
  return { op: m[1] || '=', version: parseVersion(m[2]) }
}

// Caret desugaring per semver spec: upper bound is the next bump with prerelease 0.
function caretUpper(v) {
  if (v.major === 0 && v.minor === 0) return { major: 0, minor: 0, patch: v.patch + 1, pre: [0] }
  if (v.major === 0) return { major: 0, minor: v.minor + 1, patch: 0, pre: [0] }
  return { major: v.major + 1, minor: 0, patch: 0, pre: [0] }
}

function expand(c) {
  if (c.op !== '^') return [c]
  return [
    { op: '>=', version: c.version },
    { op: '<', version: caretUpper(c.version) },
  ]
}

function sameTuple(a, b) {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch
}

function comparatorHolds(v, c) {
  const d = compareVersions(v, c.version)
  switch (c.op) {
    case '>=': return d >= 0
    case '>': return d > 0
    case '<=': return d <= 0
    case '<': return d < 0
    case '=': return d === 0
    default: throw new Error('mini-semver: unknown op ' + c.op)
  }
}

function setHolds(v, comparators) {
  for (const c of comparators) if (!comparatorHolds(v, c)) return false
  // Prerelease opt-in (semver rule): a prerelease version only satisfies a set
  // when some comparator in that set carries a prerelease on the same tuple.
  // This is why `^0.1.0-rc.7` alone cannot see `0.1.1-rc.2`: its comparators
  // anchor tuples 0.1.0 and 0.2.0, never 0.1.1.
  if (v.pre.length > 0) {
    const optedIn = comparators.some((c) => c.version.pre.length > 0 && sameTuple(c.version, v))
    if (!optedIn) return false
  }
  return true
}

function satisfiesRange(version, range) {
  const v = parseVersion(version)
  return range
    .split('||')
    .map((alt) => alt.trim().split(/\s+/).filter(Boolean).map(parseComparator).flatMap(expand))
    .some((comparators) => setHolds(v, comparators))
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

const peerRange = pkg.peerDependencies['@deepseek-ai/dsh-tools']

test('optional peer @deepseek-ai/dsh-tools uses the clear prerelease-safe OR range', () => {
  // Each prerelease line is explicitly opted into so npm can validate the
  // migrated compatibility floor without silently excluding RC versions, and
  // so every DSH line the plugin supports has its own branch. `dsh-app-boot`
  // rejects a bundle when `semver.satisfies(runtimeVersion, thisRange, {
  // includePrerelease: true })` is false for a `@deepseek-ai/dsh-*` peer name,
  // which is why the released 0.1.x branches alone excluded the 0.2 host.
  assert.equal(peerRange, '^0.1.0-rc.7 || ^0.1.1-0 || ^0.1.2-rc.1 || ^0.2.0-rc.1')
})

test('peer range covers the existing minimum 0.1.0-rc.7 and current DSH 0.1.1-rc.2', () => {
  assert.equal(satisfiesRange('0.1.0-rc.7', peerRange), true, '0.1.0-rc.7 must satisfy')
  assert.equal(satisfiesRange('0.1.1-rc.2', peerRange), true, '0.1.1-rc.2 must satisfy')
})

test('peer range stays open across the whole 0.1.1 prerelease line and released 0.1.x', () => {
  for (const v of [
    '0.1.0-rc.8', '0.1.0',
    '0.1.1-0', '0.1.1-rc.1', '0.1.1-rc.3', '0.1.1-rc.10', '0.1.1',
    '0.1.2', '0.1.9',
  ]) {
    assert.equal(satisfiesRange(v, peerRange), true, v + ' must satisfy')
  }
})

test('peer range admits the 0.2 line the 0.2.0-rc.2 host gate evaluates', () => {
  for (const v of [
    '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.10',
    '0.2.0', '0.2.1',
  ]) {
    assert.equal(satisfiesRange(v, peerRange), true, v + ' must satisfy')
  }
})

test('peer range rejects versions below the floor and the next major', () => {
  for (const v of ['0.1.0-rc.6', '0.3.0-rc.1', '0.3.0']) {
    assert.equal(satisfiesRange(v, peerRange), false, v + ' must not satisfy')
  }
})

// ---------------------------------------------------------------------------
// Optional peer: @modelcontextprotocol/sdk
// Needed only by the ./tools entry (LSP tools) and resolved from the host
// profile. It must NEVER be a hard dependency: pnpm then materializes its own
// isolated store inside the package, and DSH's package-closure walk dies with
// EPERM realpath over that nested .pnpm tree on Windows before boot.
// ---------------------------------------------------------------------------

const mcpPeerRange = pkg.peerDependencies['@modelcontextprotocol/sdk']

test('optional peer @modelcontextprotocol/sdk keeps its range and stays optional', () => {
  assert.equal(mcpPeerRange, '^1.12.0')
  assert.equal(pkg.peerDependenciesMeta['@modelcontextprotocol/sdk'].optional, true)
})

test('@modelcontextprotocol/sdk is never a hard dependency and schemastery still is', () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(pkg.dependencies ?? {}, '@modelcontextprotocol/sdk'),
    false,
    'a private copy makes pnpm nest an isolated store DSH cannot realpath',
  )
  // @deepseek-ai/schemastery stays exactly where it was: the one runtime dependency.
  // The FLOOR matters, not the caret alone: the profile root hoists the older 3.18.2
  // line, and `^3.18.1` is *satisfied* by that hoisted copy — so pnpm never
  // materializes a volatile-capable copy, `SettingsForms.describe()` skips this entry
  // (no volatile field), and the settings card is left without a namespace. Measured
  // on the live rc.2 profile: this package resolved 3.18.2 while the three sibling
  // pills resolved their own 3.18.4. `.volatile()` exists from 3.18.4 on.
  const schemasteryRange = pkg.dependencies['@deepseek-ai/schemastery']
  assert.match(schemasteryRange, /^\^3\.\d+\.\d+$/, 'keep the private dependency a caret range on the 3.x line')
  const [major, minor, patch] = schemasteryRange.slice(1).split('.').map(Number)
  assert.ok(
    major > 3 || (major === 3 && (minor > 18 || (minor === 18 && patch >= 4))),
    `the declared floor must exclude schemastery lines without .volatile() (got ${schemasteryRange})`,
  )
})

test('SDK peer range is satisfied by the host-hoisted 1.x copy and rejects the next major', () => {
  for (const v of ['1.12.0', '1.30.0', '1.30.1', '1.99.9']) {
    assert.equal(satisfiesRange(v, mcpPeerRange), true, v + ' must satisfy')
  }
  for (const v of ['1.11.9', '2.0.0']) {
    assert.equal(satisfiesRange(v, mcpPeerRange), false, v + ' must not satisfy')
  }
})

test('Windows-only, exports, and tools-separation contracts unchanged', () => {
  assert.deepEqual(pkg.os, ['win32'])
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.exports['./tools'], './lib/dcli-tools.mjs')
  assert.equal(pkg.exports['./package.json'], './package.json')
  // The peer stays optional and is never a hard dependency: dsh-tools is the
  // DSH shared host package and must not be copied/shadowed by this plugin.
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-tools'].optional, true)
  assert.equal(
    Object.prototype.hasOwnProperty.call(pkg.dependencies ?? {}, '@deepseek-ai/dsh-tools'),
    false,
  )

  // Main bundle must not register the dcli__* model tools; the ./tools export
  // is the only mounting surface (preset-side).
  const indexSource = fs.readFileSync(path.join(packageRoot, 'lib', 'index.js'), 'utf8')
  assert.match(indexSource, /export const inject = \['webServer', 'subprocess'\]/)
  assert.doesNotMatch(indexSource, /\.tools\.register/)
})

test('bundled HarmonyOS presets use the current native presentation identifier', () => {
  const nativeComposition = fs.readFileSync(
    path.join(packageRoot, 'presets', 'native-harmonyos', 'agent.cordis.yml'),
    'utf8',
  )
  const liangshenComposition = fs.readFileSync(
    path.join(packageRoot, 'presets', 'liangshen-native-harmonyos', 'agent.cordis.yml'),
    'utf8',
  )
  const bootstrapSource = fs.readFileSync(
    path.join(packageRoot, 'presets', 'liangshen-native-harmonyos', 'tool-bootstrap.mjs'),
    'utf8',
  )

  // 2026-09-30: both presets are native coding verticals. The twin declares the
  // presentation statically, Liangshen selects it through its bootstrap config —
  // and that config still routes through the imperative `presentAs` switch, so
  // the source contract below stays pinned even though `native` never fires it.
  assert.match(nativeComposition, /^\s+mode: native$/m)
  assert.match(liangshenComposition, /^\s+promotedPresentation: native$/m)
  assert.match(bootstrapSource, /tools\.presentAs\('ptc'\)/)
  assert.match(bootstrapSource, /promotedPresentation must be "native" or "ptc"/)

  for (const source of [nativeComposition, liangshenComposition, bootstrapSource]) {
    assert.doesNotMatch(source, /(?:mode|promotedPresentation): code\b/)
    assert.doesNotMatch(source, /presentAs\(['"]code['"]\)/)
  }
})

test('bundled HarmonyOS presets use the current dsh-persona config contract', () => {
  const presets = ['native-harmonyos', 'liangshen-native-harmonyos']
  for (const preset of presets) {
    const composition = fs.readFileSync(
      path.join(packageRoot, 'presets', preset, 'agent.cordis.yml'),
      'utf8',
    )
    // The persona row plus its config block: from its `- id: persona` row up to
    // the next top-level row. Every line in between is indented. Match CRLF and
    // LF: a Windows checkout with core.autocrlf=true converts the file.
    const row = /\r?\n- id: persona\r?\n(?:[ \t].*\r?\n|\r?\n)*/.exec(composition)
    assert.ok(row, preset + ': expected a persona row')
    const rowText = row[0].replace(/\r\n/g, '\n')

    // `prefix` is REQUIRED since @deepseek-ai/dsh-persona 0.1.5-rc.1; the
    // pre-0.1.5 `text` key is unrecognized, so the mount fails with
    // "- $.prefix missing required value (at prefix)" and the preset cannot be
    // switched to at all.
    assert.match(rowText, /^\s+prefix: /m, preset + ': persona config needs the required `prefix` key')
    assert.doesNotMatch(rowText, /^\s+text: /m, preset + ': the pre-0.1.5 `text` persona key is not a valid config key')
  }

  // The Liangshen bootstrap filters the phase-1 assembly by section name, so it
  // must know the split persona-section names of the installed host.
  const bootstrapSource = fs.readFileSync(
    path.join(packageRoot, 'presets', 'liangshen-native-harmonyos', 'tool-bootstrap.mjs'),
    'utf8',
  )
  assert.match(bootstrapSource, /PERSONA_SECTION_NAMES = new Set\(\['deployment:persona-prefix', 'deployment:persona', 'persona'\]\)/)
})

// ---------------------------------------------------------------------------
// Declarative payloads (DSH >= 0.1.7-rc.1)
//
// That release removed the directory roster. Each bundled preset therefore
// ships a second payload: an entry list declaring `@deepseek-ai/dsh-agent-preset`,
// mounted by a `cordis:include` row that `install-presets` writes into the
// profile patch. These assertions are text-level guards for CI; the workspace
// script `scripts/preset-declarative-check.mjs` parses both payloads with the
// loader's YAML dialect and compares them row by row.
// ---------------------------------------------------------------------------

function declarativeSource(id) {
  return fs.readFileSync(path.join(packageRoot, 'presets', `${id}.declarative.yml`), 'utf8').replace(/\r\n/g, '\n')
}

test('each bundled preset ships a declarative payload the installer can include', () => {
  assert.equal(pkg.files.includes('presets'), true, 'the payloads must ship in the tarball')

  const orders = { 'native-harmonyos': 5, 'liangshen-native-harmonyos': 6 }
  for (const [id, order] of Object.entries(orders)) {
    const flat = declarativeSource(id)

    // One top-level declaration row, whose config carries the identity that
    // used to live in preset.yml.
    assert.match(flat, /^- id: preset-[a-z0-9-]+\n {2}name: '@deepseek-ai\/dsh-agent-preset'\n/m, id + ': expected a top-level declaration row')
    assert.match(flat, new RegExp(`^ {4}id: ${id}$`, 'm'), id + ': config.id must equal the preset id')
    assert.match(flat, new RegExp(`^ {4}order: ${order}$`, 'm'), id + ': roster order')
    assert.match(flat, /^ {4}name: ".+"$/m, id + ': display name must be inline')
    assert.match(flat, /^ {4}description: ".+"$/m, id + ': description must be inline')
    assert.match(flat, /^ {4}plugins:$/m, id + ': the declaration needs its child plugin list')

    // DSH 0.1.7-rc.1 renamed the workflow backend and ships no alias. The
    // header comment records the rename, so assert on ROWS, not raw text.
    assert.doesNotMatch(flat, /name: '@deepseek-ai\/dsh-workflow-worker-thread'/, id + ': rc.1 has no workflow-worker-thread alias')
    assert.doesNotMatch(flat, /- id: workflow-worker-thread$/, id + ': rc.1 has no workflow-worker-thread row id')
    assert.match(flat, /name: '@deepseek-ai\/dsh-workflow-ptc'/, id + ': must name the renamed backend')
    assert.match(flat, /^ {10}- id: workflow-ptc$/m, id + ': renamed row id')

    // A declaration has no directory of its own: skills resolve from the
    // installed package, and nothing may be relative to a preset directory.
    assert.match(
      flat,
      /createRequire\(baseUrl\)\.resolve\('dsh-hmos-sidebar\/package\.json'\)/,
      id + ': skills must resolve from the installed package',
    )
    assert.match(flat, /'presets', 'native-harmonyos', 'skills'/, id + ': skills point at the shared catalog')
    assert.doesNotMatch(flat, /!!js[^\n]*new URL\(/, id + ': no directory-relative URL in a row expression')
    assert.doesNotMatch(flat, /^\s+- id: \S+\n\s+name: '\.\//m, id + ': no directory-relative module specifier')
    assert.doesNotMatch(flat, /[A-Za-z]:[\\/]/, id + ': no absolute machine path in a shipped payload')

    // Realms decide which plane a row publishes into; losing one leaks a
    // service into the root realm and the roster rejects the mount.
    for (const realm of ['planMode: true', 'compaction: true', 'toolResultPruner: true', 'workflowEngine: true']) {
      assert.match(flat, new RegExp(`^ +${realm}$`, 'm'), `${id}: missing isolate realm ${realm}`)
    }
    assert.match(flat, /^ {8}name: cordis:group$/m, id + ': realms only apply to a group row')
  }
})

test('declarative payloads keep the current persona and presentation contracts', () => {
  for (const id of ['native-harmonyos', 'liangshen-native-harmonyos']) {
    const flat = declarativeSource(id)
    const row = /\n {6}- id: persona\n([\s\S]*?)(?=\n {6}- id: )/.exec(flat)
    assert.ok(row, id + ': expected a persona row in the declaration')
    assert.match(row[0], /^\s+prefix: /m, id + ': persona config needs the required `prefix` key')
    assert.doesNotMatch(row[0], /^\s+text: /m, id + ': the pre-0.1.5 `text` persona key is not a valid config key')

    assert.doesNotMatch(flat, /(?:mode|promotedPresentation): code\b/, id + ': `code` is not a presentation identifier')
  }

  // native-harmonyos declares `native` statically and keeps the presentation row
  // explicit rather than dropping it, so the preset never inherits a deployment
  // default it did not choose. The two dcli__* tool mounts make it the shipped
  // HarmonyOS vertical.
  const native = declarativeSource('native-harmonyos')
  assert.match(native, /^ {10}mode: native$/m)
  assert.match(native, /name: '@deepseek-ai\/dsh-agent-tool-presentation'/)
  assert.match(native, /name: 'dsh-hmos-sidebar\/tools'/)

  // Liangshen must NOT declare a static mode: rc.1's `tools.presentAs()` throws
  // when the scope already has one, and the bootstrap owns the (now unused)
  // switch. Its config selects `native`, which the bootstrap validates.
  const liangshen = declarativeSource('liangshen-native-harmonyos')
  assert.match(liangshen, /^ {10}promotedPresentation: native$/m)
  assert.doesNotMatch(liangshen, /- id: tool-presentation/, 'a static mode would conflict with tools.presentAs()')
  assert.match(liangshen, /name: 'dsh-hmos-sidebar\/presets\/liangshen-tool-bootstrap'/)
})

test('Liangshen preset modules are reachable as package subpaths', () => {
  // A declarative row's baseUrl is the declaration file, so `./tool-bootstrap.mjs`
  // would only resolve while the preset was a directory. The modules stay where
  // they are and become subpath exports instead.
  const liangshen = declarativeSource('liangshen-native-harmonyos')
  for (const [subpath, target] of [
    ['./presets/liangshen-tool-bootstrap', './presets/liangshen-native-harmonyos/tool-bootstrap.mjs'],
    ['./presets/liangshen-custom-bash', './presets/liangshen-native-harmonyos/custom-bash.mjs'],
  ]) {
    assert.equal(pkg.exports[subpath], target, 'export ' + subpath + ' must exist')
    assert.equal(fs.existsSync(path.join(packageRoot, target)), true, target + ' must exist')
  }
  assert.match(liangshen, /name: 'dsh-hmos-sidebar\/presets\/liangshen-tool-bootstrap'/)
  assert.match(liangshen, /name: 'dsh-hmos-sidebar\/presets\/liangshen-custom-bash'/)

  // The bootstrap keeps importing its sibling by relative path: only the
  // module SPECIFIER changed, the files did not move.
  assert.match(
    fs.readFileSync(path.join(packageRoot, 'presets', 'liangshen-native-harmonyos', 'tool-bootstrap.mjs'), 'utf8'),
    /import \{ sessionEvents \} from '\.\/dsh-compat\.mjs'/,
  )
})

// ---------------------------------------------------------------------------
// Host settings on the 0.1.7 corridor
//
// `ctx.settings.register` exists only on ≤ 0.1.5. On 0.1.7+ a settings namespace
// IS the plugin entry's own `Config`, keyed by the loader entry id, and only
// `.volatile()` fields are exposed — an entry with no volatile field gets no form
// at all. `volatile()` itself arrives with schemastery 3.18.4 on that corridor
// while the 0.1.5 line resolves 3.18.2, so the marker must be applied by
// capability; calling it unconditionally throws at module load and takes the
// whole host half down.
// ---------------------------------------------------------------------------

test('host half declares a capability-detected volatile Config for the newer settings host', () => {
  // Normalize to LF: this package's CI runs on windows-latest, where the checkout is CRLF,
  // and every `^…$`/`m` assertion below silently changes meaning on CRLF (run 36130050135
  // failed on exactly that after passing locally on an LF working tree).
  const source = fs.readFileSync(path.join(packageRoot, 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

  // The namespace on 0.1.7+ is the entry Config, keyed by this row's id.
  // Line-ending agnostic on purpose: this package's CI runs on windows-latest, where the
  // checkout is CRLF, so a hard-coded `\n` here silently matches nothing there (it did:
  // run 36130050135 failed on exactly this, after passing locally on an LF working tree).
  assert.equal(
    /- id: ([\w-]+)\r?\n\s+name: 'dsh-hmos-sidebar'/.exec(
      fs.readFileSync(path.join(packageRoot, 'cordis.patch.yml'), 'utf8'),
    )?.[1],
    'dsh-hmos-sidebar',
    'the loader entry id is the ≥ 0.1.7 namespace; the client must look it up by this id',
  )
  assert.match(source, /^export const Config = Schema\.object\(\{/m, 'host half must export the entry Config')
  assert.match(
    source,
    /typeof schema\?\.volatile === 'function' \? schema\.volatile\(\) : schema/,
    'volatile() must be applied only when the installed schemastery provides it',
  )
  assert.doesNotMatch(
    source,
    /\.default\([^\n]*\)\.volatile\(\)/,
    'never call .volatile() unconditionally: the 0.1.5 schemastery has no such method',
  )

  // The optional `cliPath` override lives in the entry Config so a row config /
  // profile-patch `config.cliPath` (and the preset's `./tools` row config) passes
  // schema validation on both corridors without an environment variable. It is
  // deliberately NOT part of the settings CARD UI — the card renders only the two
  // boolean switches — but it must still be declared here or the host rejects the
  // whole section (`Config field "cliPath" is not volatile`).
  assert.match(
    source,
    /cliPath: volatileField\(Schema\.string\(\)/,
    'the entry Config must declare an optional volatile cliPath override',
  )

  // The optional settings transport must never become a hard inject gate.
  assert.match(source, /^export const inject = \['webServer', 'subprocess'\]$/m)
  assert.doesNotMatch(source, /export const inject = \[[^\]]*'settings'/)

  // Declarative host: declare that this plugin renders its own page, so the
  // official UI does not also generate a generic form beside the card.
  assert.match(source, /typeof settingsApi\.configure === 'function'/, 'configure must be capability-detected too')
  assert.match(source, /configure\(\{ auto: false \}, ctx\.fiber\)/, 'owner must be this plugin fiber, not the inject child')
})

test('the host Config loads and resolves on the installed schemastery line', async () => {
  // Executable evidence, not a source assertion: import the real host half and
  // resolve an empty entry config. On this 0.1.5 machine that exercises the
  // no-volatile path, which is the one that would throw if the marker were
  // unconditional.
  const host = await import('../lib/index.js')
  assert.equal(host.name, 'dsh-hmos-sidebar')
  assert.ok(host.Config, 'Config must be exported')
  // A schemastery schema is a callable object, not a plain one.
  assert.ok(['function', 'object'].includes(typeof host.Config), 'Config must be a schema')
  const value = host.Config({})
  // Version-agnostic on purpose: on the 0.1.5 line (no `volatile`) the leaves are
  // plain booleans, while a 3.18.4 install wraps each volatile leaf. Both must
  // carry the same two default-true switches the client reads.
  const read = (v) => (v !== null && typeof v === 'object' && typeof v.get === 'function' && Symbol.for('cosmokit.volatile.write') in v ? v.get() : v)
  assert.deepEqual(
    { popup: { keepCollapsed: read(value.popup.keepCollapsed) }, ball: { hideWithoutProject: read(value.ball.hideWithoutProject) } },
    { popup: { keepCollapsed: true }, ball: { hideWithoutProject: true } },
  )

  // The optional cliPath override resolves on BOTH schemastery lines: a plain
  // string where `volatile()` is absent (≤ 0.1.5 install), and a cosmokit
  // volatile wrapper on the 0.1.7 corridor, which `read` unwraps.
  assert.equal(read(value.cliPath), undefined, 'cliPath is optional and omitted by default')
  assert.equal(
    read(host.Config({ cliPath: 'C:\\npm\\cli.js' }).cliPath),
    'C:\\npm\\cli.js',
    'a row/patch config.cliPath must survive entry-Config validation',
  )
  assert.throws(() => host.Config({ cliPath: 123 }), /cliPath expected string/i)
})

// ---------------------------------------------------------------------------
// Always-on prompt hygiene
//
// The persona is the KV-cache prefix and the model's standing attention budget.
// Naming a tool the preset does not mount costs tokens AND invites an
// `UNKNOWN_TOOL` call, so every stable name in that text must be real for THIS
// preset. These guards cover the three ways that drifts: a `dcli__*` name that
// left the tool module, a skill name that left the skills directory, and a name
// belonging to a feature this preset switched off.
// ---------------------------------------------------------------------------

/** Read one `key:` value, whether inline or a `>-` block, by indentation. */
function personaField(source, key) {
  const lines = source.split('\n')
  const out = []
  const head = new RegExp(`^(\\s*)${key}:\\s*(.*)$`)
  for (let i = 0; i < lines.length; i += 1) {
    const match = head.exec(lines[i])
    if (!match) continue
    const indent = match[1].length
    const inline = match[2].trim()
    if (inline !== '' && inline !== '>-' && inline !== '>') {
      out.push(inline)
      continue
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]
      if (line.trim() === '') {
        out.push('')
        continue
      }
      if (line.length - line.trimStart().length <= indent) break
      out.push(line.trim())
    }
  }
  return out.join('\n')
}

/** The persona text each payload injects for the whole session. */
function personaText(preset) {
  const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const sources = [
    read(path.join(packageRoot, 'presets', preset, 'agent.cordis.yml')),
    read(path.join(packageRoot, 'presets', `${preset}.declarative.yml`)),
  ]
  const texts = sources.map((source) => [
    personaField(source, 'prefix'),
    personaField(source, 'promotedPersonaText'),
  ].join('\n'))
  for (const text of texts) assert.ok(text.trim().length > 0, preset + ': expected persona prompt text')
  return texts
}

test('every dcli__* name in the always-on prompt exists in the tool module', () => {
  const toolsSource = fs.readFileSync(path.join(packageRoot, 'lib', 'dcli-tools.mjs'), 'utf8')
  const declared = new Set(
    [...toolsSource.matchAll(/name:\s*'(dcli__[a-z_]+)'/g)].map((m) => m[1]),
  )
  assert.equal(declared.size, 41, 'the tool module should still declare 41 dcli__* tools')

  for (const preset of ['native-harmonyos', 'liangshen-native-harmonyos']) {
    for (const text of personaText(preset)) {
      const mentioned = new Set([...text.matchAll(/\bdcli__[a-z_]+/g)].map((m) => m[0]))
      // Guard against a vacuous pass: the persona does name these tools, so an
      // empty extraction means the reader broke, not that the prompt is clean.
      assert.ok(mentioned.size >= 5, `${preset}: expected the persona to name the dcli__* tools it uses`)
      for (const name of mentioned) {
        assert.ok(declared.has(name), `${preset}: persona names ${name}, which the tool module does not declare`)
      }
    }
  }
})

test('every skill named in the always-on prompt exists in the skills directory', () => {
  const skillsRoot = path.join(packageRoot, 'presets', 'native-harmonyos', 'skills')
  const shipped = new Set(fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name))

  for (const preset of ['native-harmonyos', 'liangshen-native-harmonyos']) {
    for (const text of personaText(preset)) {
      const marker = '按需加载技能：'
      const start = text.indexOf(marker)
      assert.ok(start >= 0, preset + ': the persona must advertise its on-demand skills')
      const rest = text.slice(start + marker.length)
      const stop = rest.indexOf('。')
      const names = (stop < 0 ? rest : rest.slice(0, stop))
        .split('/')
        .map((part) => part.replace(/（[^）]*）/g, '').trim())
        .filter(Boolean)
      assert.ok(names.length >= 10, preset + ': unexpectedly short skill list')
      for (const name of names) {
        assert.ok(shipped.has(name), `${preset}: persona advertises skill ${name}, which the package does not ship`)
      }
    }
  }
})

test('the always-on prompt names nothing the native presets switched off', () => {
  // Both presets select `native` and disable `tool-ralph`: `run_code` (the PTC
  // transport) is not in a native catalog at all, so naming either would be a
  // guaranteed UNKNOWN_TOOL.
  for (const preset of ['native-harmonyos', 'liangshen-native-harmonyos']) {
    for (const text of personaText(preset)) {
      assert.doesNotMatch(text, /\brun_code\b/, preset + ': run_code does not exist under the native presentation')
      assert.doesNotMatch(text, /PTC Mode|PTC 模式|PTC SDK/, preset + ': the persona still describes PTC execution')
      assert.doesNotMatch(text, /\bralph\b/i, preset + ': tool-ralph is disabled in this preset')
      // `goal` alone is not a tool: the plugin registers get_goal/create_goal/update_goal.
      assert.doesNotMatch(text, /(?:^|[^_a-zA-Z])goal(?![_a-zA-Z])/i, preset + ': `goal` is not a tool name')
      assert.match(text, /create_goal/, preset + ': goal work should name the real tool')
    }
  }
})
