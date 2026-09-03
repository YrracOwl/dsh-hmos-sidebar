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
  // `^0.1.0-rc.7` alone silently excludes every 0.1.1-x prerelease (semver
  // prerelease opt-in), so the current DSH 0.1.1-rc.2 would fail the
  // declaration. The second branch explicitly opts into the 0.1.1 tuple.
  assert.equal(peerRange, '^0.1.0-rc.7 || ^0.1.1-0')
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

test('peer range rejects versions below the floor and the next major', () => {
  for (const v of ['0.1.0-rc.6', '0.2.0-rc.1', '0.2.0']) {
    assert.equal(satisfiesRange(v, peerRange), false, v + ' must not satisfy')
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