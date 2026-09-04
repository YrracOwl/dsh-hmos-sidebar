import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanEvents } from '../presets/liangshen-native-harmonyos/tool-bootstrap.mjs'

function state() {
  return { next: 0, toolCalled: false, steps: 0, turnEnded: false, responded: false, anchored: false }
}

const events = [
  { type: 'step/start' },
  { type: 'tool/call' },
  { type: 'turn/end' },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'We need inspect and implement.' }] } } },
]

test('梁神预设使用 DSH 0.1.2 的 immutable session snapshot API', () => {
  const value = state()
  let snapshots = 0
  scanEvents(value, {
    snapshotEvents() { snapshots += 1; return Object.freeze(events.map(Object.freeze)) },
    get events() { throw new Error('removed DSH API must not be touched') },
  })
  assert.equal(snapshots, 1)
  assert.equal(value.next, events.length)
  assert.equal(value.steps, 1)
  assert.equal(value.toolCalled, true)
  assert.equal(value.turnEnded, true)
  assert.equal(value.responded, true)
})

test('梁神预设保留旧版 DSH RC 的 session.events 回退兼容', () => {
  const value = state()
  scanEvents(value, { events })
  assert.equal(value.next, events.length)
  assert.equal(value.toolCalled, true)
})
