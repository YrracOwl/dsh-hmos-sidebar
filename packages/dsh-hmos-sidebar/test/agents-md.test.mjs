import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  renderAgentsMdContent,
  splitManaged,
  renderManaged,
  MANAGED_OPEN,
  MANAGED_CLOSE,
  summarizeAgentsMdChange,
  writeAgentsMdWithBackup,
  AGENTS_BACKUP_SUFFIX,
} from '../lib/dcli-tools.mjs'

const FACTS = {
  name: 'DemoApp',
  bundleName: 'com.example.demo',
  modules: ['entry', 'feature'],
  products: [{ name: 'prod1', signingConfig: 'debug' }, { name: 'prod2', signingConfig: '' }],
  targetSdk: '6.1.0(23)',
  compatSdk: '6.1.0(23)',
  pages: 'pages/Index, pages/Second',
}

test('managed block renders dcli__lsp_check and no hardcoded debug/default/entry facts', () => {
  const managed = renderManaged(FACTS)
  assert.ok(managed.includes('`dcli__lsp_check`'), 'uses dcli__lsp_check, not mcp__deveco__check')
  assert.ok(!managed.includes('mcp__deveco__check'), 'no mcp__deveco__check remnant')
  // facts-driven: real module/product names appear
  assert.ok(managed.includes('entry / feature'), 'modules from facts')
  assert.ok(managed.includes('prod1'), 'product from facts')
  // no hardcoded entry-product or fixed debug/default artifact path
  assert.ok(!/entry-debug-signed\.hap|entry-default-signed\.hap/.test(managed), 'no hardcoded artifact path')
  assert.ok(!/entry\/build\/debug/.test(managed), 'no hardcoded output path')
})

test('buildAgents: user content outside markers is preserved on refresh', () => {
  const first = renderAgentsMdContent(FACTS, '')
  const userCustom = first + '\n## 我的自定义节\n- 用户内容\n'
  const refreshed = renderAgentsMdContent(FACTS, userCustom)
  assert.ok(refreshed.includes('## 我的自定义节'), 'keeps user section')
  assert.ok(refreshed.includes('- 用户内容'), 'keeps user body')
  assert.equal(1, (refreshed.match(/DSH-HMOS-MANAGED:START/g) || []).length)
  assert.equal(1, (refreshed.match(/DSH-HMOS-MANAGED:END/g) || []).length)
})

test('splitManaged returns head/tail around markers and reports absence', () => {
  const text = '## 头部\n' + MANAGED_OPEN + '\nM\n' + MANAGED_CLOSE + '\n## 尾部\n'
  const { found, head, tail } = splitManaged(text)
  assert.equal(found, true)
  assert.ok(head.includes('## 头部'))
  assert.ok(tail.includes('## 尾部'))
  assert.deepEqual(splitManaged('plain'), { found: false, head: 'plain', tail: '' })
})

test('managed content is idempotent under refresh', () => {
  const once = renderAgentsMdContent(FACTS, '')
  const twice = renderAgentsMdContent(FACTS, once)
  assert.equal(once, twice)
})

test('first adoption of an unmarked file preserves the entire original text', () => {
  const existing = '# 人工标题\n\n重要前言。\n\n## 工程概览\n- 人工内容\n## 用户自留\n- 保留我\n'
  const out = renderAgentsMdContent(FACTS, existing)
  assert.ok(out.startsWith(existing.trimEnd()))
  assert.ok(out.includes('# 人工标题'))
  assert.ok(out.includes('重要前言。'))
  assert.ok(out.includes('- 人工内容'))
  assert.ok(out.includes('- 保留我'))
  assert.equal(1, (out.match(/DSH-HMOS-MANAGED:START/g) || []).length)
})

test('malformed, duplicate, and reversed markers are rejected without guessing', () => {
  assert.throws(() => renderAgentsMdContent(FACTS, MANAGED_OPEN + '\nmissing close'), /marker 异常/)
  assert.throws(() => renderAgentsMdContent(FACTS, MANAGED_OPEN + '\na\n' + MANAGED_CLOSE + '\n' + MANAGED_OPEN + '\nb\n' + MANAGED_CLOSE), /marker 异常/)
  assert.throws(() => renderAgentsMdContent(FACTS, MANAGED_CLOSE + '\n' + MANAGED_OPEN), /END 位于 START 之前/)
})

test('change summary reports stable no-op and bounded replacement', () => {
  assert.deepEqual(summarizeAgentsMdChange('same', 'same'), {
    changed: false, beforeChars: 4, afterChars: 4, removedChars: 0, addedChars: 0,
  })
  const changed = summarizeAgentsMdChange('abcOLDxyz', 'abcNEWERxyz')
  assert.deepEqual(changed, {
    changed: true, beforeChars: 9, afterChars: 11, removedChars: 3, addedChars: 5,
  })
})

test('apply helper creates one backup and atomically replaces the target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcli-agents-md-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, 'AGENTS.md')
  fs.writeFileSync(target, 'original\n')
  const first = writeAgentsMdWithBackup(target, 'original\n', 'first\n')
  assert.equal(first.backupCreated, true)
  assert.equal(fs.readFileSync(target, 'utf8'), 'first\n')
  assert.equal(fs.readFileSync(target + AGENTS_BACKUP_SUFFIX, 'utf8'), 'original\n')
  const second = writeAgentsMdWithBackup(target, 'first\n', 'second\n')
  assert.equal(second.backupCreated, false)
  assert.equal(fs.readFileSync(target, 'utf8'), 'second\n')
  assert.equal(fs.readFileSync(target + AGENTS_BACKUP_SUFFIX, 'utf8'), 'original\n')
  assert.equal(fs.readdirSync(root).some((name) => name.includes('.tmp-')), false)
})
