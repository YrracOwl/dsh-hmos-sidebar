import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBundleName, validateSafeName } from '../lib/validate.js'

test('validateBundleName accepts valid names and returns normalized value', () => {
  assert.equal(validateBundleName('com.example.app'), 'com.example.app')
  assert.equal(validateBundleName('  com.example.app  '), 'com.example.app')
  // 首段字母开头，其余段字母/数字开头，下划线可出现在中段，段尾字母/数字
  assert.equal(validateBundleName('com.example_v2.app9'), 'com.example_v2.app9')
})

test('validateBundleName optional: empty returns undefined, required: empty throws', () => {
  assert.equal(validateBundleName(''), undefined)
  assert.equal(validateBundleName(undefined), undefined)
  assert.equal(validateBundleName(null), undefined)
  assert.throws(() => validateBundleName('', { required: true }), /bundleName 必填/)
})

test('validateBundleName rejects length violations (7..128)', () => {
  assert.throws(() => validateBundleName('a.b.c'), /长度须 7\.\.128/)
  assert.throws(() => validateBundleName('a' + '.b'.repeat(80)), /长度须 7\.\.128/)
})

test('validateBundleName rejects too few segments and double dots', () => {
  assert.throws(() => validateBundleName('com.example'), /至少 3 个点分段/)
  assert.throws(() => validateBundleName('com..example.app'), /连续点号/)
})

test('validateBundleName rejects bad segment chars and boundary rules', () => {
  assert.throws(() => validateBundleName('com.example.inj;rm -rf /'), /字母\/数字\/下划线/)
  assert.throws(() => validateBundleName('com.example.$(whoami)'), /字母\/数字\/下划线/)
  assert.throws(() => validateBundleName('com.example.inj&&echo x'), /字母\/数字\/下划线/)
  assert.throws(() => validateBundleName('com.example.app-'), /字母\/数字\/下划线/)
  assert.throws(() => validateBundleName('1com.example.app'), /首段必须以字母开头/)
  assert.throws(() => validateBundleName('com._example.app'), /非首段必须以字母\/数字开头/)
  assert.throws(() => validateBundleName('com.example.app_'), /每段必须以字母\/数字结尾/)
})

test('validateSafeName accepts and rejects per ^[A-Za-z0-9_.]+$ with 1..128 length', () => {
  assert.equal(validateSafeName('EntryAbility'), 'EntryAbility')
  assert.equal(validateSafeName('entry.module.v2'), 'entry.module.v2')
  assert.equal(validateSafeName('_private'), '_private')
  assert.equal(validateSafeName(''), undefined)
  assert.throws(() => validateSafeName('', { required: true, label: 'abilityName' }), /abilityName 必填/)
  assert.throws(() => validateSafeName('bad;name'), /只允许字母\/数字\/下划线\/点/)
  assert.throws(() => validateSafeName('bad name'), /只允许字母\/数字\/下划线\/点/)
  assert.throws(() => validateSafeName('a'.repeat(129)), /长度须 1\.\.128/)
})
