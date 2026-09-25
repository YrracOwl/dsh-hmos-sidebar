import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// ── rc.2 settings seat: DSH 0.1.7-rc.2 REMOVED settings.plugin.item ──────────

test('the settings card also registers on the rc.2 row seat with the ledger key', () => {
  // The key IS the contract: the official plugin-manager renders a bundle row's
  // configure control only while `rowConfigKey(pkg.name, row.rowId)` sits on the
  // `plugins.row.config` ledger. For this package the row id equals the package
  // name, and the manifest plus cordis.patch.yml are the authority for both halves.
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const rowIds = [...patch.matchAll(/^\s*- id: (\S+)\s*$/gm)].map((match) => match[1])
  assert.ok(rowIds.includes(manifest.name), `cordis.patch.yml must declare the ${manifest.name} row; saw ${rowIds.join(', ')}`)
  const expected = `${manifest.name}#${manifest.name}`
  assert.equal(expected, 'dsh-hmos-sidebar#dsh-hmos-sidebar')
  assert.ok(
    source.includes(`const ROW_CONFIG_KEY = '${expected}'`),
    `client.js must carry the ledger key derived from package.json#name plus the patch row id (${expected})`,
  )
  assert.match(source, /sctx\.slots\.inject\('plugins\.row\.config'/)
  assert.match(source, /name: 'plugins\.row\.config'/)
  assert.match(source, /key: ROW_CONFIG_KEY/)
  assert.match(source, /props\.view === 'summary'/)
  assert.match(source, /ctx\.inject\(\['slots'\], registerRowConfig\)/)
  // The ≤ 0.1.5 seat stays declared, and the host-owned optional `form` prop is not
  // consumed: both seats keep the single resolved transport.
  assert.match(source, /settings\.plugin\.item/)
  assert.doesNotMatch(source, /props\.form/)
})

test('the card writes to the same id it resolved the scope from', () => {
  // Reads and writes must address ONE id. The two hosts key settings differently:
  // ≤ 0.1.5 by settings namespace (`hmos-sidebar`), ≥ 0.1.7 by the loader ENTRY id
  // (`dsh-hmos-sidebar`) — different strings for this package. Addressing the write by
  // the namespace on the corridor makes the host throw
  // `No configurable plugin entry "hmos-sidebar"`: a card that displays values it
  // cannot save.
  assert.match(source, /let settingsWriteNs = SETTINGS_NS/)
  assert.match(source, /settingsWriteNs = SETTINGS_ENTRY_ID/)
  assert.match(source, /ns: settingsWriteNs/)
  assert.doesNotMatch(source, /ns: SETTINGS_NS/)
})

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
  // 写地址必须与解析出的读地址同源：≤ 0.1.5 是命名空间，≥ 0.1.7 是 loader 入口 id
  // ——本插件两者不同（hmos-sidebar vs dsh-hmos-sidebar），写成命名空间会让走廊上的
  // 宿主抛 `No configurable plugin entry "hmos-sidebar"`（卡片看得见、存不进）。
  assert.match(source, /const payload = \{ ns: settingsWriteNs, ops \}/)
  assert.match(source, /api\.settings\.mutate\(payload\)/)
  assert.match(source, /plugin-config-hmos-sidebar-/)
})

test('two behavior toggles ship with quiet defaults (both ON)', () => {
  // 1. 默认不展开弹窗 2. 在非鸿蒙工作区，悬浮球默认显示为「待命」（降级，不是隐藏）
  assert.match(source, /\['popup', 'keepCollapsed'\]/)
  assert.match(source, /\['ball', 'hideWithoutProject'\]/)
  assert.match(source, /\{ ready: false, keepCollapsed: true, hideWithoutProject: true \}/,
    'fallback defaults must match the host DEFAULT_SETTINGS quiet mode')
})

test('quiet mode never hides the floating ball: it renders a faded idle ball instead', () => {
  // 悬浮球是工作台面板唯一入口（面板只能由它打开）。安静模式（hideWithoutProject=true，
  // 默认）在探测链路（当前会话 cwd → WorkspaceReporter → /hmos/probe）任何一环不可用时
  // 都不能让它消失——那会让面板在任何工作区都打不开。正确行为是同一元素只做视觉降级。
  assert.match(source, /const ballFaded = settings\.hideWithoutProject && !\(probed && projectValid\)/,
    'ballFaded must be derived exactly as quiet-mode-on AND not(probed && projectValid)')
  assert.doesNotMatch(source, /ballVisible/, 'the old hide-the-ball flag must be gone entirely')
  // 唯一剩余的 display 判据：面板已展开时藏球（面板自身接管显示）。
  assert.equal((source.match(/\{ display: open \? 'none' : 'flex' \}/g) || []).length, 1,
    'the only display:none left is the panel-open case')
  assert.equal((source.match(/'none'\s*:\s*'flex'/g) || []).length, 1,
    'no second visibility ternary may gate the ball')
})

test('the faded ball carries the dimming style, an accessible idle label, and unchanged behavior', () => {
  // 降级只走内联自定义属性 + CSS var()：这样 :hover/:focus-visible 无需 !important
  // 就能恢复全不透明度；点击/拖拽行为与层级（z-index:2）原样保留。
  assert.match(source, /className: 'hmos-ball' \+ \(ballFaded \? ' hmos-ball-idle' : ''\)/)
  assert.match(source, /ballFaded \? \{ '--ball-idle-opacity': 0\.38, '--ball-idle-scale': 0\.72 \} : \{\}/)
  assert.match(source, /\.hmos-ball\{[^}]*opacity:var\(--ball-idle-opacity,1\);transform:scale\(var\(--ball-idle-scale,1\)\)/)
  assert.match(source, /\.hmos-ball-idle:hover,\.hmos-ball-idle:focus-visible\{opacity:1;/,
    'hover/focus-visible must restore full opacity for the idle ball')
  assert.match(source, /\.hmos-ball:focus-visible\{outline:/)
  // 可发现性 + 无障碍：待命球说明未检测到鸿蒙工程，并说明点击仍可打开工作台。
  assert.match(source, /'鸿蒙工程工作台（待命：当前工作区未检测到鸿蒙工程；点击仍可打开工作台）'/)
  assert.match(source, /title: ballLabel/)
  assert.match(source, /'aria-label': ballLabel/)
  // 降级绝不能变成隐藏：命中/可见性与原点击、拖拽行为都不能被关掉。
  assert.doesNotMatch(source, /pointer-events:\s*none/)
  assert.doesNotMatch(source, /visibility:\s*hidden/)
  assert.match(source, /onClick: \(\) => \{ if \(!ballDrag\.current\.moving\) setOpen\(true\) \}/)
  assert.match(source, /onMouseDown: onBallDown/)
  // 层级策略不变（ball 2 > panel 1，菜单/对话框/提示仍可覆盖）。
  assert.match(source, /\.hmos-ball\{[^}]*z-index:2/)
})

test('panel auto-expands only when 默认不展开弹窗 is OFF and a project was found', () => {
  assert.match(source, /if \(found && settingsRef\.current\.keepCollapsed === false && !openRef\.current\) setOpen\(true\)/)
})

test('settings scope stays optional and is never a hard inject gate', () => {
  // 两个设置传输都**不能**出现在 exports.inject 里：cordis 把每个 inject 名当作
  // 硬门槛（Fiber._refresh() 在任一名无提供者时把 fiber 置为 INACTIVE），声明可选
  // 传输会让插件永久 pending，并让整个 Web boot 报
  // "N entries did not activate / waiting for service: configForms"。
  // 可选性由 apply 内的 ctx.inject([...], cb) 非阻塞等待保证。
  assert.match(source, /function resolveSettingsScopeFrom\(sctx\)/)
  assert.match(source, /ctx\.inject\(\['settingsScope'\], registerCard\)/)
  assert.match(source, /ctx\.inject\(\['configForms'\]/)
  assert.match(source, /const connection = ctx\.get\('connection'\)/)
  assert.match(source, /exports\.inject = \['slots'\]/)
  assert.doesNotMatch(source, /exports\.inject = \[[^\]]*settingsScope/)
  assert.doesNotMatch(source, /exports\.inject = \[[^\]]*configForms/)
  // 卡片必须在「拥有设置传输的上下文」里注册，否则「设置 → 插件」页的账本看不到它：
  // 该页在自己的上下文里读 ctx.slots.entries('settings.plugin.item')，会拿到空数组，
  // 卡片永远不渲染，尽管 register 正常返回。
  assert.match(source, /sctx\.slots\.inject\('settings\.plugin\.item'/)
  assert.doesNotMatch(source, /^\s{6}ctx\.slots\.inject\('settings\.plugin\.item'/m)
})

test('client resolves the current session cwd and probes it', () => {
  // ≤ 0.1.5 的会话列表快照自带 `current`；0.1.7-rc.2 的 SessionListState 没有它（只有
  // { ids, byId, phase, projectionsBySession }，view selection 被移出了会话控制器），而
  // root 槽位（shell.overlay）的标准属性里没有"当前会话"来源。所以额外由会话作用域的
  // WorkspaceReporter 发布"正在被查看会话的 cwd"，覆盖层订阅它。
  assert.match(source, /useSessions\(\(snapshot\) => snapshot && snapshot\.current\)/)
  assert.match(source, /snapshot\.byId\[legacyCurrent\]/)
  assert.match(source, /function WorkspaceReporter\(props\)/)
  assert.match(source, /snapshot\.byId\[props\.sessionId\]/)
  assert.match(source, /name: 'conversation\.input\.left', id: 'dsh-hmos-sidebar-workspace'/)
  assert.match(source, /const workspacePath = legacyPath \|\| reported/)
  assert.match(source, /api\('hmos\/probe', \{ path: requestedPath \|\| undefined \}\)/)
  assert.match(source, /\}, \[workspacePath\]\)/)
  // 探测到的工程根必须与"当前工作区"相关：宿主在没有 workspace 时会回退到配置的 projectPath
  // （也会扫描显式 projectRoots），认下来会让悬浮球在任何会话都显示。
  assert.match(source, /const related = isWorkspaceProject\(found, requestedPath\)/)
  assert.match(source, /if \(!related\) return/)
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
  // 默认没有任何可选服务：apply 必须在 settingsScope / configForms 缺失时照常工作。
  // 测试通过 ctx.services 注入可选服务；ctx.get 与 ctx.inject 共用同一张表。
  const lookup = (name) => {
    const svc = ctx.services ? ctx.services[name] : undefined
    return typeof svc === 'function' ? svc() : svc
  }
  const ctx = {
    services: {},
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
    get(name) { return lookup(name) },
    // 可选、非阻塞的传输等待：cordis 的 ctx.inject(names, cb) 只在服务就绪时触发
    // 回调；这里同步调用，让 resolveSettingsScopeFrom 立即解析。子上下文必须同时
    // 提供 get 与 slots —— 设置卡片正是通过 sctx.slots 注册到 scoped 上下文，
    // 这样「设置 → 插件」页的账本才看得到它。
    inject(names, callback) {
      const list = Array.isArray(names) ? names : [names]
      if (!list.some((n) => lookup(n) !== undefined)) return
      callback({ get: (n) => lookup(n), slots: ctx.slots })
    },
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
  // 设置卡片只在设置传输存在时注册（它属于传输），这里给出传输以便断言两张表都就位。
  ctx.services = {
    settingsScope: () => ({ bind: (spec) => ({ namespace: spec.namespace }) }),
  }
  const dispose = apply(ctx)
  assert.ok(ctx.slotNames.includes('shell.overlay'))
  assert.deepEqual(ctx.slotNames.slice().sort(), ['conversation.input.left', 'settings.plugin.item', 'shell.overlay'],
    'apply registers the overlay, the official plugin settings card, and the session-scoped workspace reporter')
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
  // 可选服务表：settingsScope / connection 由 ctx.get 与 ctx.inject 共用。
  ctx.services = {
    settingsScope: () => ({
      bind: (spec) => { bound.push(spec); return { namespace: spec.namespace } },
    }),
    connection: () => ({ api: { settings: {} } }),
  }
  const dispose = apply(ctx)
  // bound 的对象创建于 vm realm，不能与宿主 realm 对象做 deepEqual（原型不同）。
  assert.equal(bound.length, 1)
  assert.equal(bound[0].namespace, 'hmos-sidebar', 'scope bound for exactly our namespace')
  const cardReg = ctx.registrations.find((r) => r.name === 'settings.plugin.item')
  assert.ok(cardReg, 'settings card registered')
  assert.equal(cardReg.key, 'hmos-sidebar')
  // 惰性绑定的证明：注册选项里没有捕获的 scope（getter 在组件工厂闭包里，见源码断言），
  // 且 getter 不会被重复求值 —— 设置传输从头到尾只 bind 一次。
  assert.equal(cardReg.scope, undefined, 'registration must not capture a scope value')
  assert.equal(bound.length, 1, 'scope bound exactly once (lazy getter, no re-bind)')
  const overlayReg = ctx.registrations.find((r) => r.name === 'shell.overlay')
  assert.ok(overlayReg && overlayReg.id === 'dsh-hmos-sidebar', 'overlay registration unchanged')

  // 联合 disposer：两次 inject 的 disposer 都被调用且不抛错。
  dispose()
  assert.ok(ctx.slotNames.includes('conversation.input.left'), 'session-scoped workspace reporter registered')
  assert.equal(ctx.slotNames.length, 3, 'dispose ran without throwing')
})

test('a host with no settings transport still activates and registers only the overlay', () => {
  // 这是把 Web boot 打挂的那类回归：两个设置传输都不在 exports.inject 里，
  // 可选等待不应阻塞激活。没有传输时工作台照常挂载（shell.overlay 立即注册），
  // 而设置卡片正确地不注册 —— 它属于设置传输，账本在没有传输时看不到它。
  const { apply } = loadClientDragApi()
  const ctx = fakeCtx() // services 为空
  const dispose = apply(ctx)
  const overlayReg = ctx.registrations.find((r) => r.name === 'shell.overlay')
  assert.ok(overlayReg && overlayReg.id === 'dsh-hmos-sidebar', 'overlay registers without any transport')
  assert.equal(
    ctx.registrations.filter((r) => r.name === 'settings.plugin.item').length,
    0,
    'no settings card without a settings transport',
  )
  dispose()
})