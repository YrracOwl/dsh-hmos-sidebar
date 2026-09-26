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
    // The settings card creates its style tag on first render
    // (ensureCardStyles → document.createElement('style') + head.appendChild).
    head: { children: [], appendChild(child) { this.children.push(child) } },
    createElement(tag) { return { tag, dataset: {}, style: {}, textContent: '' } },
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
    // 插件真正释放掉的席位注册 disposer，按名称记录：这样测试能证明注册确实加入了
    // 插件的释放路径（register → slots.inject 的返回值 → apply 的联合 disposer）。
    disposals: [],
    effectCleanups: [],
    slots: {
      inject(name, callback) {
        ctx.slotNames.push(name)
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options) {
        ctx.registrations.push(options)
        return () => { ctx.disposals.push(options.name) }
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

// ---------------------------------------------------------------------------
// The late-transport contract of the settings card.
//
// `plugins.row.config` only waits for `slots` — the plugin-manager page declares
// it the moment it opens — while the settings transport itself (`configForms` on
// ≥ 0.1.7, `settingsScope` on ≤ 0.1.5) can land much later, and answers that do
// not carry this plugin's namespace land as a terminal non-ready snapshot. The
// card must therefore render something visible in the meantime and re-render
// itself when the transport lands; it may never sit on a silent null.
//
// The rc.2 occupant is an ordinary React function component, so a compact React
// (element objects, hook slots, deps-compared effects, sync state updates) is
// enough to mount the REAL component registered by the REAL apply() inside the vm
// sandbox and to drive that path end to end.
// ---------------------------------------------------------------------------

test('the settings card carries the late-transport contract in source', () => {
  // 1. 旧的静默分支必须消失，改成一个可见状态对象（注释里引用旧代码是允许的，
  //    所以这里只否定真正的语句行）。
  assert.doesNotMatch(source, /^\s*if \(!available\) return null\s*$/m,
    'the card must not return null when the snapshot is not ready')
  assert.match(source, /function settingsTransportState\(scope, snap\)/)
  assert.match(source, /const transport = available \? null : settingsTransportState\(scope, snap\)/)
  // 2. 诚实状态齐备，且都能被用户看见（表头 pill + 正文说明）。
  assert.match(source, /label: '等待设置传输'/)
  assert.match(source, /label: '加载中'/)
  assert.match(source, /label: '设置不可用'/)
  assert.match(source, /'宿主设置服务没有提供本插件的设置命名空间/)
  assert.match(source, /React\.createElement\('p', \{ className: 'dhssStatus', role: 'status' \}, transport\.text\)/)
  // 3. 没就绪时既不渲染字段也不渲染保存控件：绝不伪造值，也没有用不了的保存按钮。
  assert.match(source, /const fields = available \? SETTINGS_FIELDS\.map/)
  assert.match(source, /available \? React\.createElement\('div', \{ className: 'dhssFooter' \}/)
  assert.match(source, /available && !writable \? React\.createElement\('p', \{ className: 'dhssReadOnly'/)
  assert.match(source, /disabled: blocked \|\| !writable/,
    'the existing writable gate stays on the save button')
  // 4. 传输到达由 apply 拥有的等待者表广播；卡片订阅它，并在无 scope 时改订它。
  assert.match(source, /const settingsScopeWaiters = new Set\(\)/)
  assert.match(source, /const onSettingsScopeArrival = \(listener\) => \{/)
  assert.match(source, /const announceSettingsScope = \(\) => \{/)
  assert.match(source, /announceSettingsScope\(\)/,
    'the inject callback must announce the arrival')
  assert.match(source, /if \(!onScopeArrival\) return undefined/)
  assert.match(source, /return onScopeArrival\(\(\) => setTick\(\(n\) => n \+ 1\)\)/)
  assert.match(source, /const onScopeArrival = typeof props\.onScopeArrival === 'function'/)
  // 三张席位都要拿到同一个通知器（≤0.1.5 的 settings.plugin.item、rc.2 的行席位，
  // 以及附加的 settings.section 页）。
  assert.equal(
    (source.match(/onScopeArrival: onSettingsScopeArrival/g) || []).length,
    3,
    'every card seat must pass the arrival notifier',
  )
  // 5. 释放路径必须存在：卡片实例退订 + 插件卸载/更新时 apply 兜底清空。
  assert.match(source, /ctx\.effect\(\(\) => \(\) => \{ settingsScopeWaiters\.clear\(\) \}, 'dsh-hmos-sidebar: settings scope waiters'\)/)
  // 6. 解析失败留下重试机会（真值判断，不是 `!== null`）。
  assert.match(source, /if \(settingsScope \|\| disposeCard !== null\) return/)
  assert.match(source, /if \(!settingsScope\) return/)
})

/** Minimal React: elements, hook slots, deps-compared effects, sync updates. */
function createMiniReact() {
  const created = []
  const instances = new Map()
  let current = null
  let root = null
  let tree = null
  let dirty = false
  let inflight = false

  function instanceFor(path) {
    let instance = instances.get(path)
    if (instance === undefined) {
      instance = { hooks: [], effects: [], pending: [], cursor: 0 }
      instances.set(path, instance)
    }
    return instance
  }

  function renderNode(node, path) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
    if (Array.isArray(node)) {
      return node.map((child, index) => renderNode(child, path + '/' + index)).filter((child) => child !== null)
    }
    if (typeof node === 'object' && node.__element === true) {
      if (typeof node.type === 'function') {
        const instance = instanceFor(path)
        const previous = current
        current = instance
        instance.cursor = 0
        instance.pending = []
        let output
        try { output = node.type(node.props) } finally { current = previous }
        return { path, name: node.type.name || 'component', props: node.props, output: renderNode(output, path + '#') }
      }
      return {
        tag: node.type,
        props: node.props,
        children: node.children.map((child, index) => renderNode(child, path + '/' + index)).filter((child) => child !== null),
      }
    }
    return null
  }

  function runEffects() {
    for (const instance of instances.values()) {
      for (const entry of instance.pending) {
        const previous = instance.effects[entry.slot]
        const unchanged = previous !== undefined && entry.deps !== undefined && previous.deps !== undefined
          && entry.deps.length === previous.deps.length
          && entry.deps.every((dep, index) => Object.is(dep, previous.deps[index]))
        if (unchanged) continue
        if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
        instance.effects[entry.slot] = { deps: entry.deps, cleanup: entry.effect() }
      }
      instance.pending = []
    }
  }

  function flush() {
    if (inflight) { dirty = true; return tree }
    inflight = true
    try {
      let guard = 0
      do {
        dirty = false
        tree = renderNode(root, 'root')
        runEffects()
      } while (dirty && (guard += 1) < 50)
    } finally {
      inflight = false
    }
    return tree
  }

  const react = {
    createElement(type, props, ...children) {
      const element = {
        __element: true,
        type,
        props: props || {},
        children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true),
      }
      created.push(element)
      return element
    },
    useState(initial) {
      const instance = current
      const slot = instance.cursor++
      if (!(slot in instance.hooks)) instance.hooks[slot] = typeof initial === 'function' ? initial() : initial
      return [instance.hooks[slot], (next) => {
        const value = typeof next === 'function' ? next(instance.hooks[slot]) : next
        if (Object.is(value, instance.hooks[slot])) return
        instance.hooks[slot] = value
        // Real React schedules this update; the harness renders it synchronously
        // so the assertion can read the tree the card produced on its own.
        if (inflight) dirty = true
        else flush()
      }]
    },
    useEffect(effect, deps) {
      const instance = current
      const slot = instance.cursor++
      instance.pending.push({ slot, effect, deps })
    },
    useRef(initial) {
      const instance = current
      const slot = instance.cursor++
      if (!(slot in instance.hooks)) instance.hooks[slot] = { current: initial }
      return instance.hooks[slot]
    },
    useCallback(fn) { return fn },
    useMemo(fn) { return fn() },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    Fragment: 'Fragment',
  }
  react.created = created
  react.mount = (element) => { root = element; instances.clear(); return flush() }
  react.tree = () => tree
  react.unmount = () => {
    for (const instance of instances.values()) {
      for (const entry of instance.effects) if (entry !== undefined && typeof entry.cleanup === 'function') entry.cleanup()
    }
    instances.clear()
    root = null
    tree = null
  }
  return react
}

/** One settings scope: `getSnapshot()` + `subscribe()` + a test-side `emit`. */
function scopeController(initial) {
  const listeners = new Set()
  let snapshot = initial
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    emit(next) { snapshot = next; for (const listener of Array.from(listeners)) listener() },
    listenerCount: () => listeners.size,
  }
}

/**
 * fakeCtx whose optional `ctx.inject(names, cb)` waits fire only when the test
 * provides the service — exactly the rc.2 shape where the row seat (slots) is
 * declared before the settings transport exists.
 */
function deferredCtx() {
  const ctx = {
    services: {},
    waiters: [],
    registrations: [],
    components: [],
    effectCleanups: [],
    slots: {
      inject(name, callback) { callback(); return () => {} },
      register(options, component) { ctx.registrations.push(options); ctx.components.push(component) },
    },
    get(name) { const service = ctx.services[name]; return typeof service === 'function' ? service() : service },
    inject(names, callback) {
      const list = Array.isArray(names) ? names : [names]
      ctx.waiters.push({ names: list, callback })
      ctx.tryWaiters()
    },
    tryWaiters() {
      for (const waiter of ctx.waiters.slice()) {
        if (!waiter.names.every((name) => name === 'slots' || ctx.get(name) !== undefined)) continue
        ctx.waiters = ctx.waiters.filter((candidate) => candidate !== waiter)
        waiter.callback({ get: (name) => ctx.get(name), slots: ctx.slots })
      }
    },
    provide(name, service) { ctx.services[name] = service; ctx.tryWaiters() },
    effect(fn) {
      ctx.effectCleanups.push(fn())
      ctx.effectCleanup = () => {
        for (const cleanup of ctx.effectCleanups.splice(0)) {
          try { if (typeof cleanup === 'function') cleanup() } catch {}
        }
      }
    },
  }
  return ctx
}

function loadClientRenderApi() {
  const documentMock = createDocumentMock()
  const react = createMiniReact()
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
    setTimeout: () => 0,
    clearTimeout() {},
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(spec && typeof spec.factory === 'function', 'bundle factory must be captured')
  const bundleExports = spec.factory((name) => {
    if (name === 'react') return react
    if (name === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    if (name === 'react-dom') return { createPortal: (element) => element }
    throw new Error('unexpected require: ' + name)
  })
  return { apply: bundleExports.apply, ctx: deferredCtx(), react, document: documentMock }
}

function collectNodes(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collectNodes(child, out)
    return out
  }
  out.push(node)
  if (node.output !== undefined) collectNodes(node.output, out)
  if (node.children !== undefined) for (const child of node.children) collectNodes(child, out)
  return out
}

function cardText(tree) {
  return collectNodes(tree).filter((node) => typeof node.text === 'string').map((node) => node.text).join(' ')
}

function byClass(tree, className) {
  return collectNodes(tree).filter((node) => node.props !== undefined && node.props.className === className)
}

/** apply() + the REAL rc.2 row-config occupant, mounted before any transport. */
function mountRowConfigCard() {
  const api = loadClientRenderApi()
  api.apply(api.ctx)
  const index = api.ctx.registrations.findIndex((registration) => registration.name === 'plugins.row.config')
  assert.ok(index >= 0, 'apply must register the rc.2 row seat')
  api.react.mount(api.react.createElement(api.ctx.components[index], { view: 'page' }))
  const props = api.react.created.map((element) => element.props).find((candidate) => typeof candidate.onScopeArrival === 'function')
  assert.ok(props !== undefined, 'the card must receive the scope-arrival notifier')
  return { apply: api.apply, ctx: api.ctx, react: api.react, onScopeArrival: props.onScopeArrival }
}

function openCard(react) {
  const header = byClass(react.tree(), 'dhssHeader')
  assert.equal(header.length, 1, 'the card header must always render')
  // 单卡片席位（行席位的 page 视图 / settings.section 页）现在默认就展开，所以这里
  // 只保证「正文可见」，不假定初始折叠状态——手动收起/展开仍由表头按钮驱动。
  if (header[0].props['aria-expanded'] !== true) header[0].props.onClick()
  return react.tree()
}

test('an absent settings transport renders a visible waiting state, never nothing', () => {
  const { react, ctx } = mountRowConfigCard()
  const tree = react.tree()
  // 旧实现在这里返回 null：管理页的配置区整块空白，控制台一条错都没有。
  assert.ok(tree !== null, 'the row config page must render an element, not null')
  assert.equal(byClass(tree, 'dhssHeader').length, 1, 'the card header renders without any transport')
  assert.match(cardText(tree), /等待设置传输/)
  assert.deepEqual(Object.keys(ctx.services), [], 'no transport was provided in this test')

  const opened = openCard(react)
  assert.equal(byClass(opened, 'dhssStatus').length, 1, 'the expanded card explains the state')
  assert.match(cardText(opened), /设置传输尚未到达/)
  // 没有取值路径时既不渲染字段也不渲染保存按钮（没有值可伪造，也没有点不动的保存）。
  assert.equal(byClass(opened, 'dhssSwitch').length, 0)
  assert.equal(byClass(opened, 'dhssSave').length, 0)
})

test('the card re-renders when the transport arrives after mount, and its save gate still works', () => {
  const { react, ctx } = mountRowConfigCard()
  openCard(react)
  assert.match(cardText(react.tree()), /等待设置传输/)

  const controller = scopeController({
    status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host',
  })
  const readIds = []
  ctx.provide('configForms', { get: (id) => { readIds.push(id); return controller } })

  // 到达即自行重渲染，并且按 loader 入口 id 读（写地址同源由源码断言把守）。
  assert.deepEqual(readIds, ['dsh-hmos-sidebar'])
  assert.match(cardText(react.tree()), /加载中/)
  assert.doesNotMatch(cardText(react.tree()), /等待设置传输/)
  assert.equal(controller.listenerCount(), 1, 'the card subscribed to the arrived scope')

  controller.emit({
    status: 'ready',
    value: { popup: { keepCollapsed: true }, ball: { hideWithoutProject: true } },
    base: {},
    user: {},
    revision: 4,
    writable: true,
    mode: 'host',
  })
  const ready = react.tree()
  const switches = byClass(ready, 'dhssSwitch')
  assert.equal(switches.length, 2, 'both switches render once the snapshot is ready')
  assert.deepEqual(switches.map((node) => node.props.checked), [true, true], 'values come from the snapshot')
  assert.equal(byClass(ready, 'dhssStatus').length, 0, 'the status line disappears once values are live')
  assert.equal(byClass(ready, 'dhssReadOnly').length, 0)
  assert.equal(byClass(ready, 'dhssSave').length, 1)
  assert.equal(byClass(ready, 'dhssSave')[0].props.disabled, true, 'nothing staged → save stays disabled')

  // 交互不变：改一个开关 → 出现「未保存」，保存按钮变为可用；只读部署仍不可存。
  switches[0].props.onChange({ target: { checked: false } })
  const dirty = react.tree()
  assert.match(cardText(dirty), /未保存/)
  assert.doesNotMatch(cardText(dirty), /等待设置传输/)
  assert.equal(byClass(dirty, 'dhssSave')[0].props.disabled, false, 'a staged change enables save')
  assert.equal(byClass(dirty, 'dhssDiscard')[0].props.disabled, false)

  controller.emit({
    status: 'ready',
    value: { popup: { keepCollapsed: true }, ball: { hideWithoutProject: true } },
    base: {},
    user: {},
    revision: 4,
    writable: false,
    mode: 'host',
  })
  const readOnly = react.tree()
  assert.equal(byClass(readOnly, 'dhssReadOnly').length, 1, 'a read-only deployment says so')
  assert.equal(byClass(readOnly, 'dhssSave')[0].props.disabled, true, 'no save control that cannot work')
  assert.equal(byClass(readOnly, 'dhssSwitch')[0].props.disabled, true)
})

test('a transport without this namespace says so actionably instead of rendering an empty box', () => {
  // 这正是 0.1.7 走廊上的真实故障形态：宿主服务存在、mirror 也答了，但
  // describe() 跳过了本入口（Config 里没有 volatile 字段），于是快照终态是
  // `unavailable`。卡片必须把这件事说出来，而不是安静地什么都不画。
  const { react, ctx } = mountRowConfigCard()
  openCard(react)
  const controller = scopeController({
    status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host',
  })
  ctx.provide('configForms', { get: () => controller })

  const tree = react.tree()
  assert.match(cardText(tree), /设置不可用/)
  assert.match(cardText(tree), /重新安装或更新 dsh-hmos-sidebar/, 'the state must be actionable')
  assert.equal(byClass(tree, 'dhssStatus').length, 1)
  assert.equal(byClass(tree, 'dhssSwitch').length, 0, 'no fabricated values')
  assert.equal(byClass(tree, 'dhssSave').length, 0, 'no save control that cannot work')
})

test('the arrival mechanism is disposed: unsubscribe and the unload cleanup both detach listeners', () => {
  // (a) 卡片实例自己的 effect 清理：onScopeArrival 返回的退订函数必须真的摘掉监听。
  const first = mountRowConfigCard()
  const kept = []
  const removed = []
  first.onScopeArrival(() => kept.push(1))
  const off = first.onScopeArrival(() => removed.push(1))
  off()
  first.ctx.provide('configForms', { get: () => scopeController({ status: 'loading', mode: 'host' }) })
  assert.deepEqual([kept.length, removed.length], [1, 0], 'the returned disposer removed exactly its own listener')
  first.react.unmount()

  // (b) 插件卸载/更新：apply 的 ctx.effect 兜底清空等待者表，卸载前注册的监听不再被唤醒。
  const second = mountRowConfigCard()
  const stale = []
  const fresh = []
  second.onScopeArrival(() => stale.push(1))
  second.ctx.effectCleanup()
  second.onScopeArrival(() => fresh.push(1))
  second.ctx.provide('configForms', { get: () => scopeController({ status: 'loading', mode: 'host' }) })
  assert.deepEqual([stale.length, fresh.length], [0, 1], 'the unload cleanup dropped every waiter apply owned')
})

// ---------------------------------------------------------------------------
// 附加席位：settings.section（设置里的一级页面）。
//
// 0.1.7-rc.2 在带键的行席位之外还声明根级列表槽位 `settings.section`（"一个列表项 =
// 一个设置页"）。这个注册是「附加」的，绝不能门控插件：席位依赖宿主版本，用与行席位
// 完全相同的非门控 `ctx.inject(['slots'], …)` 形状等待，回调返回注册 disposer。该页
// 渲染的就是行席位 `view === 'page'` 渲染的那张 HmosSettingsCard——一套设置 UI、
// 一条传输、一条持久化路径。
// ---------------------------------------------------------------------------

test('additive settings.section seat carries the exact nav identity', () => {
  assert.match(source, /const registerSettingsSection = \(sctx\) => /)
  assert.match(source, /sctx\.slots\.inject\('settings\.section', \(\) => sctx\.slots\.register\(\{/)
  assert.match(source, /name: 'settings\.section'/)
  assert.match(source, /id: 'yotk-hmos-sidebar'/)
  assert.match(source, /order: 64/)
  // label 是 THUNK：外壳每次投影都重新读取，而不是缓存注册方本地化的文本。
  assert.match(source, /label: \(\) => 'YOTK · 鸿蒙工作台'/)
  // 从非门控的 slots 等待里注册，回调返回的 disposer 加入插件的既有释放路径。
  assert.match(source, /ctx\.inject\(\['slots'\], registerSettingsSection\)/)
  assert.match(source, /disposeSettingsSection = sctx\.slots\.inject\('settings\.section'/)
  assert.match(source, /if \(disposeSettingsSection\) disposeSettingsSection\(\)/)
  // 席位只声明 { id, order, label }——不发明契约键。
  assert.doesNotMatch(source, /name: 'settings\.section',\s*\n\s*locale:/)
})

test('settings.section fires without any settings transport and never gates', () => {
  const { apply } = loadClientDragApi()
  // 有卡片席位、但完全没有设置传输的宿主：席位注册仍必须触发（非门控），与行席位一致。
  const ctx = fakeCtx()
  ctx.services = { slots: () => ({}) }
  const dispose = apply(ctx)
  const section = ctx.registrations.find((r) => r.name === 'settings.section')
  assert.ok(section, 'the settings.section occupant must register where the seat is declared')
  // 席位声明的契约键恰好是 { id, order, label }（外加 slots 服务要求的 name）。
  assert.deepEqual(Object.keys(section).sort(), ['id', 'label', 'name', 'order'])
  assert.equal(section.id, 'yotk-hmos-sidebar')
  assert.equal(section.order, 64)
  assert.equal(typeof section.label, 'function')
  assert.equal(section.label(), 'YOTK · 鸿蒙工作台')
  // 没有传输 → 旧席位（settings.plugin.item）正确地什么都不注册。
  assert.equal(ctx.registrations.filter((r) => r.name === 'settings.plugin.item').length, 0)
  // 注册由插件拥有：释放之前没有任何注册 disposer 被调用。
  assert.deepEqual(ctx.disposals, [], 'nothing is released before the plugin is disposed')
  dispose()
  assert.ok(ctx.disposals.includes('settings.section'), 'the callback disposer joins the plugin disposal path')

  // 不声明该席位的宿主：什么都不注册，apply 照常成功——席位永远不能门控激活。
  const absent = fakeCtx()
  assert.equal(typeof apply(absent), 'function')
  assert.equal(absent.registrations.some((r) => r.name === 'settings.section'), false)
  assert.doesNotMatch(source, /exports\.inject = \[[^\]]*settings\.section/)
})

test('the settings.section page renders the same card component as the row page', () => {
  // 一张卡片、一套传输：附加页面与行席位的 page 视图必须是同一个组件，都只拿
  // 「读取器 + 展开默认」，既不消费宿主可选的 `form`，也不消费席位的 `close`。
  const api = loadClientRenderApi()
  api.ctx.provide('configForms', {
    get: () => scopeController({
      status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, mode: 'host',
    }),
  })
  api.apply(api.ctx)
  function seat(name) {
    const index = api.ctx.registrations.findIndex((registration) => registration.name === name)
    assert.ok(index >= 0, `expected a ${name} occupant`)
    return { options: api.ctx.registrations[index], component: api.ctx.components[index] }
  }
  const section = seat('settings.section')
  const row = seat('plugins.row.config')
  const legacy = seat('settings.plugin.item')

  const sectionPage = section.component({ close: () => {} })
  const rowPage = row.component({ view: 'page' })
  assert.equal(typeof sectionPage.type, 'function')
  assert.equal(sectionPage.type, rowPage.type, 'the section page renders the row page component')
  // 两类单卡片页面都要求展开；宿主可选的 `form` prop 不被消费。
  assert.deepEqual(Object.keys(sectionPage.props).sort(), ['api', 'defaultOpen', 'getScope', 'onScopeArrival'])
  assert.deepEqual(Object.keys(rowPage.props).sort(), ['api', 'defaultOpen', 'getScope', 'onScopeArrival'])
  assert.equal(sectionPage.props.defaultOpen, true)
  assert.equal(rowPage.props.defaultOpen, true)
  const passedForm = section.component({ close: () => {}, form: { state: {}, mutate() {} } })
  assert.equal(passedForm.type, sectionPage.type)
  assert.deepEqual(Object.keys(passedForm.props).sort(), ['api', 'defaultOpen', 'getScope', 'onScopeArrival'])
  // 行席位的 summary 分支仍是它的一行文字。
  assert.equal(row.component({ view: 'summary' }).type, 'span')
  // 旧列表席位是同一张卡片，但保持折叠默认（不传 defaultOpen）。
  const legacyPage = legacy.component({})
  assert.equal(legacyPage.type, sectionPage.type)
  assert.equal('defaultOpen' in legacyPage.props, false, 'the legacy list seat keeps its collapsed default')

  // 行为验证：附加页面挂载即展开，表头按钮仍能手动收起；旧列表卡片挂载后保持折叠。
  const react = api.react
  react.mount(react.createElement(section.component, {}))
  assert.equal(byClass(react.tree(), 'dhssBody').length, 1, 'the settings.section page mounts expanded')
  byClass(react.tree(), 'dhssHeader')[0].props.onClick()
  assert.equal(byClass(react.tree(), 'dhssBody').length, 0, 'the header still folds it back up')
  react.unmount()
  react.mount(react.createElement(legacy.component, {}))
  assert.equal(byClass(react.tree(), 'dhssBody').length, 0, 'the legacy list card stays collapsed')
  react.unmount()
})