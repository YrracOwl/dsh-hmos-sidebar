import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('client mounts through official shell.overlay slot', () => {
  assert.match(source, /ctx\.slots\.inject\('shell\.overlay'/)
  assert.match(source, /name: 'shell\.overlay', id: 'dsh-hmos-sidebar'/)
  assert.match(source, /exports\.inject = \['slots'\]/)
  assert.doesNotMatch(source, /document\.body\.appendChild\(host\)/)
})

// ---- 官方设置（设置 → 插件）：卡片注册、安静默认值、可见性门控、自动展开 ----

test('official settings card registers under settings.plugin.item keyed by the namespace', () => {
  assert.match(source, /const SETTINGS_NS = 'hmos-sidebar'/)
  assert.match(source, /ctx\.slots\.inject\('settings\.plugin\.item'/)
  assert.match(source, /name: 'settings\.plugin\.item', key: SETTINGS_NS, label: 'HarmonyOS 工作台'/)
  // 卡片走官方 settings 写路径（api.settings.mutate），不私设持久化。
  assert.match(source, /const payload = \{ ns: SETTINGS_NS, ops \}/)
  assert.match(source, /api\.settings\.mutate\(payload\)/)
  assert.match(source, /plugin-config-hmos-sidebar-/)
})

test('two behavior toggles ship with quiet defaults (both ON)', () => {
  // 1. 默认不展开弹窗 2. 在非鸿蒙工作区，默认不展示悬浮球
  assert.match(source, /\['popup', 'keepCollapsed'\]/)
  assert.match(source, /\['ball', 'hideWithoutProject'\]/)
  assert.match(source, /\{ ready: false, keepCollapsed: true, hideWithoutProject: true \}/,
    'fallback defaults must match the host DEFAULT_SETTINGS quiet mode')
})

test('floating ball hides until the workspace probe confirms a HarmonyOS project', () => {
  assert.match(source, /const ballVisible = !settings\.hideWithoutProject \|\| \(probed && projectValid\)/)
  assert.match(source, /\(!ballVisible \|\| open\) \? 'none' : 'flex'/)
})

test('panel auto-expands only when 默认不展开弹窗 is OFF and a project was found', () => {
  assert.match(source, /if \(found && settingsRef\.current\.keepCollapsed === false && !openRef\.current\) setOpen\(true\)/)
})

test('settings scope stays optional (absent service degrades to defaults)', () => {
  assert.match(source, /const binder = ctx\.get\('settingsScope'\)/)
  assert.match(source, /const connection = ctx\.get\('connection'\)/)
  assert.doesNotMatch(source, /inject: \['slots', 'settingsScope'\]/,
    'settingsScope must stay optional: no hard injection of it')
})

test('client resolves the current session cwd and probes it', () => {
  assert.match(source, /useSessions\(\(snapshot\) => snapshot\.current\)/)
  assert.match(source, /snapshot\.byId\[current\].*\.cwd/)
  assert.match(source, /api\('hmos\/probe', \{ path: requestedPath \|\| undefined \}\)/)
  assert.match(source, /\}, \[workspacePath\]\)/)
})

test('select popup uses adaptive background and text colors', () => {
  assert.match(source, /--popup-bg/)
  assert.match(source, /--popup-text/)
  assert.match(source, /getPopupTheme/)
  assert.match(source, /select\.hmos-input option/)
})

test('no extreme z-index values are shipped', () => {
  // The int32-overflow class of values (2147483647-ish) is banned outright,
  // and no z-index declaration may reach the DSH dialog/toast tier (1000+):
  // menus, system dialogs and toasts must always be able to cover the panel.
  assert.doesNotMatch(source, /214748\d*/)
  assert.doesNotMatch(source, /z-index\s*:\s*\d{4,}/)
})

test('workbench layers through the shell.overlay tier with modest internal levels', () => {
  // shell.overlay renders inside the DSH layout overlay layer (z-index:20),
  // which covers shell content while menus (~20–100), dialogs (1000) and
  // toasts (1100) stack above it. Internal levels only order ball vs panel.
  function zIndexOf(className) {
    const m = new RegExp('\\.' + className + '\\{[^}]*z-index:(\\d+)').exec(source)
    assert.ok(m, className + ' must declare a z-index')
    return Number(m[1])
  }
  assert.equal(zIndexOf('hmos-root'), 1)
  assert.equal(zIndexOf('hmos-panel'), 1)
  assert.equal(zIndexOf('hmos-ball'), 2)
})

test('all three drag handlers delegate to the shared lifecycle (no inline document listeners)', () => {
  assert.match(source, /const onBarDown = \(ev\) => beginPanelDrag\(ev, dragRef, setPos\)/)
  assert.match(source, /const onResizeDown = \(ev\) => beginResizeDrag\(ev, size, setSize\)/)
  assert.match(source, /const onBallDown = \(ev\) => beginBallDrag\(ev, ballRef, ballDrag, setBallPos\)/)
  // apply() registers the unload-path cleanup that ends in-flight drags.
  assert.match(source, /ctx\.effect\(\(\) => \(\) => disposeAllActiveDrags\(\), 'dsh-hmos-sidebar: active drags'\)/)
  // The only document mousemove/mouseup registration site left is inside the
  // single shared beginDrag; the per-handler inline add/remove pairs are gone.
  assert.equal((source.match(/document\.addEventListener\('mousemove'/g) || []).length, 1)
  assert.equal((source.match(/document\.removeEventListener\('mousemove'/g) || []).length, 1)
  assert.equal((source.match(/document\.addEventListener\('mouseup'/g) || []).length, 1)
  assert.equal((source.match(/document\.removeEventListener\('mouseup'/g) || []).length, 1)
})

// ---------------------------------------------------------------------------
// Executable drag-lifecycle tests.
//
// The client bundle is browser-only, but the drag lifecycle is plain
// document/window code. Evaluate the bundle in a vm sandbox with a
// listener-tracking document mock, capture the __ModuleLoader__ spec, run the
// factory, and drive the REAL beginPanelDrag / beginResizeDrag / beginBallDrag
// plus the REAL apply() ctx.effect cleanup (the Cordis unload path) — so the
// unload trigger is exercised, not guessed from regex counts.
// ---------------------------------------------------------------------------

function createDocumentMock() {
  const listeners = new Map()
  const body = { style: { userSelect: '', cursor: '' } }
  return {
    body,
    documentElement: { style: {} },
    querySelector() { return null },
    querySelectorAll() { return [] },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type)
      if (set) set.delete(fn)
    },
    dispatch(type, event) {
      for (const fn of Array.from(listeners.get(type) || [])) fn(event)
    },
    listenerCount(type) {
      return (listeners.get(type) || new Set()).size
    },
  }
}

function loadClientDragApi() {
  const documentMock = createDocumentMock()
  const timers = []
  let spec = null
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (loaded) => { spec = loaded } },
      innerWidth: 1280,
      innerHeight: 800,
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    },
    document: documentMock,
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ backgroundColor: 'rgba(0,0,0,0)' }),
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) }),
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout() {},
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(spec && typeof spec.factory === 'function', 'bundle factory must be captured')
  const bundleExports = spec.factory((name) => {
    // React is only consumed at render time; the drag lifecycle never renders.
    if (name === 'react' || name === 'react-dom/client') return {}
    throw new Error('unexpected require: ' + name)
  })
  assert.equal(typeof bundleExports.apply, 'function', 'apply must be exported')
  assert.equal(typeof bundleExports.__dragLifecycle.beginPanelDrag, 'function')
  assert.equal(typeof bundleExports.__dragLifecycle.beginResizeDrag, 'function')
  assert.equal(typeof bundleExports.__dragLifecycle.beginBallDrag, 'function')
  assert.equal(typeof bundleExports.__dragLifecycle.disposeAllActiveDrags, 'function')
  return { api: bundleExports.__dragLifecycle, apply: bundleExports.apply, document: documentMock, timers }
}

function fakeCtx() {
  const ctx = {
    slotNames: [],
    registrations: [],
    effectCleanups: [],
    slots: {
      inject(name, callback) {
        ctx.slotNames.push(name)
        callback()
        return () => {}
      },
      register(options) {
        ctx.registrations.push(options)
      },
    },
    // 默认没有任何可选服务：apply 必须在 settingsScope/connection 缺失时照常工作。
    get() { return undefined },
    // apply 注册多个 effect（拖拽兜底 + 设置卡片样式清理）：聚合所有清理函数，
    // effectCleanup() 一次性全部执行，模拟 Cordis 卸载路径。
    effect(fn) {
      const cleanup = fn()
      ctx.effectCleanups.push(cleanup)
      ctx.effectCleanup = () => {
        for (const c of ctx.effectCleanups.splice(0)) {
          try { if (typeof c === 'function') c() } catch {}
        }
      }
    },
  }
  return ctx
}

function fakeEvent(x, y, target) {
  return {
    target: target || { closest: () => null },
    clientX: x,
    clientY: y,
    preventDefault() {},
    stopPropagation() {},
  }
}

test('panel drag: normal mouseup removes document listeners idempotently and restores body state', () => {
  const { api, apply, document: doc } = loadClientDragApi()
  const ctx = fakeCtx()
  const dispose = apply(ctx)
  assert.ok(ctx.slotNames.includes('shell.overlay'))
  assert.deepEqual(ctx.slotNames.slice().sort(), ['settings.plugin.item', 'shell.overlay'],
    'apply registers the overlay and the official plugin settings card')
  assert.equal(typeof dispose, 'function', 'combined slot disposer returned')

  doc.body.style.userSelect = 'text'
  doc.body.style.cursor = 'grab'
  const panelRef = { current: { getBoundingClientRect: () => ({ left: 100, top: 50 }) } }
  const positions = []
  api.beginPanelDrag(fakeEvent(10, 20), panelRef, (p) => positions.push(p))

  assert.equal(api.activeDragCount(), 1)
  assert.equal(doc.listenerCount('mousemove'), 1)
  assert.equal(doc.listenerCount('mouseup'), 1)
  assert.equal(doc.body.style.userSelect, 'none', 'temporary drag selection suppression')

  doc.dispatch('mousemove', { clientX: 30, clientY: 40 })
  // Field-level asserts: values are created inside the vm realm, so
  // deepStrictEqual against host-realm objects would fail on prototype identity.
  assert.equal(positions[0].x, 120)
  assert.equal(positions[0].y, 70)
  assert.equal(Object.keys(positions[0]).length, 2, 'panel position math unchanged')

  doc.dispatch('mouseup', {})
  assert.equal(api.activeDragCount(), 0)
  assert.equal(doc.listenerCount('mousemove'), 0)
  assert.equal(doc.listenerCount('mouseup'), 0)
  assert.equal(doc.body.style.userSelect, 'text', 'body userSelect restored')
  assert.equal(doc.body.style.cursor, 'grab', 'body cursor restored')

  // Idempotent: a repeated mouseup or the unload cleanup must be no-ops.
  doc.dispatch('mouseup', {})
  ctx.effectCleanup()
  assert.equal(api.activeDragCount(), 0)
  assert.equal(doc.listenerCount('mousemove'), 0)
  assert.equal(doc.listenerCount('mouseup'), 0)
  assert.equal(doc.body.style.userSelect, 'text')
  assert.equal(doc.body.style.cursor, 'grab')
})

test('unload path (ctx.effect cleanup) releases all three concurrent drags and restores body state', () => {
  const { api, apply, document: doc, timers } = loadClientDragApi()
  const ctx = fakeCtx()
  apply(ctx)

  const panelRef = { current: { getBoundingClientRect: () => ({ left: 100, top: 50 }) } }
  const ballRef = { current: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 48, height: 48 }) } }
  const movingRef = { current: { moving: false } }

  api.beginPanelDrag(fakeEvent(10, 20), panelRef, () => {})
  api.beginResizeDrag(fakeEvent(0, 0), { w: 430, h: 640 }, () => {})
  api.beginBallDrag(fakeEvent(0, 0), ballRef, movingRef, () => {})

  assert.equal(api.activeDragCount(), 3, 'three drags in flight')
  assert.equal(doc.listenerCount('mousemove'), 3)
  assert.equal(doc.listenerCount('mouseup'), 3)
  assert.equal(doc.body.style.userSelect, 'none')

  // Plugin unload/update mid-drag: the effect cleanup registered by apply()
  // is exactly what Cordis runs on unload — no mouseup is ever dispatched.
  ctx.effectCleanup()

  assert.equal(api.activeDragCount(), 0, 'all active drags disposed')
  assert.equal(doc.listenerCount('mousemove'), 0, 'no leaked mousemove listeners')
  assert.equal(doc.listenerCount('mouseup'), 0, 'no leaked mouseup listeners')
  assert.equal(doc.body.style.userSelect, '', 'body userSelect restored')
  assert.equal(doc.body.style.cursor, '', 'body cursor restored')

  // The ball end-hook still resets the click-vs-drag flag after unload.
  assert.equal(timers.length, 1)
  timers.shift()()
  assert.equal(movingRef.current.moving, false)

  // Late pointer events after unload must not reach any drag handler, and a
  // second unload cleanup is a no-op.
  doc.dispatch('mousemove', { clientX: 500, clientY: 500 })
  doc.dispatch('mouseup', {})
  ctx.effectCleanup()
  assert.equal(doc.listenerCount('mousemove'), 0)
  assert.equal(doc.listenerCount('mouseup'), 0)
  assert.equal(doc.body.style.userSelect, '')
})

test('resize and ball drag math unchanged (clamps and 3px click threshold)', () => {
  const { api, document: doc, timers } = loadClientDragApi()

  // resize: 430x640 base + (50, 40) → 480x680 (320/260 floor still applies below).
  const sizes = []
  api.beginResizeDrag(fakeEvent(0, 0), { w: 430, h: 640 }, (s) => sizes.push(s))
  doc.dispatch('mousemove', { clientX: 50, clientY: 40 })
  assert.equal(sizes[0].w, 480)
  assert.equal(sizes[0].h, 680)
  doc.dispatch('mouseup', {})
  assert.equal(doc.listenerCount('mousemove'), 0)

  // ball: 3px total threshold flips moving, position clamps into the viewport.
  const ballRef = { current: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 48, height: 48 }) } }
  const movingRef = { current: { moving: false } }
  const positions = []
  api.beginBallDrag(fakeEvent(0, 0), ballRef, movingRef, (p) => positions.push(p))
  doc.dispatch('mousemove', { clientX: 2, clientY: 1 }) // 3px total → still a click
  assert.equal(movingRef.current.moving, false)
  assert.equal(positions[0].x, 12)
  assert.equal(positions[0].y, 21)
  doc.dispatch('mousemove', { clientX: 3, clientY: 1 }) // 4px total → drag
  assert.equal(movingRef.current.moving, true)
  assert.equal(positions[1].x, 13)
  assert.equal(positions[1].y, 21)
  doc.dispatch('mouseup', {})
  assert.equal(timers.length, 1)
  timers.shift()()
  assert.equal(movingRef.current.moving, false, 'click-vs-drag flag resets after mouseup')
  assert.equal(doc.listenerCount('mousemove'), 0)
  assert.equal(doc.listenerCount('mouseup'), 0)
  assert.equal(doc.body.style.userSelect, '', 'body state restored after mouseup')
})

test('bar action buttons never start a drag (closest guard preserved)', () => {
  const { api, document: doc } = loadClientDragApi()
  const panelRef = { current: { getBoundingClientRect: () => ({ left: 100, top: 50 }) } }
  api.beginPanelDrag(fakeEvent(0, 0, { closest: () => '.hmos-bar-actions' }), panelRef, () => {})
  assert.equal(api.activeDragCount(), 0)
  assert.equal(doc.listenerCount('mousemove'), 0)
  assert.equal(doc.listenerCount('mouseup'), 0)
  assert.equal(doc.body.style.userSelect, '', 'no temporary body state without a drag')
})

test('apply binds the hmos-sidebar settings scope and registers the settings card when services exist', () => {
  const { apply } = loadClientDragApi()
  const ctx = fakeCtx()
  const bound = []
  ctx.get = (name) => {
    if (name === 'settingsScope') {
      return { bind: (spec) => { bound.push(spec); return { namespace: spec.namespace } } }
    }
    if (name === 'connection') return { api: { settings: {} } }
    return undefined
  }
  const dispose = apply(ctx)
  // bound 的对象创建于 vm realm，不能与宿主 realm 对象做 deepEqual（原型不同）。
  assert.equal(bound.length, 1)
  assert.equal(bound[0].namespace, 'hmos-sidebar', 'scope bound for exactly our namespace')
  const cardReg = ctx.registrations.find((r) => r.name === 'settings.plugin.item')
  assert.ok(cardReg, 'settings card registered')
  assert.equal(cardReg.key, 'hmos-sidebar')
  const overlayReg = ctx.registrations.find((r) => r.name === 'shell.overlay')
  assert.ok(overlayReg && overlayReg.id === 'dsh-hmos-sidebar', 'overlay registration unchanged')

  // 联合 disposer：两次 inject 的 disposer 都被调用且不抛错。
  dispose()
  assert.equal(ctx.slotNames.length, 2, 'dispose ran without throwing')
})