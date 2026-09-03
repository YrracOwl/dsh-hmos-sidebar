// dsh-hmos-sidebar — client half (v0.5: official Settings card + quiet defaults)
//
// 浏览器专用 bundle：顶层依赖 window.__ModuleLoader__.load，仅由 DSH web loader 消费。
// exports "./client" 不可在 Node 中直接 import（会抛 ReferenceError: window is not defined）。
//
// Fully independent of dsh-better-sidebar: renders its own floating panel
// (drag-able, non-modal, tabbed) + a minimized floating ball in the page
// corner. No ctx.betterSidebar dependency, no inject.
//
// Tabs: 构建 / 部署 / 设备 / 输出. Deploy & device actions show their output
// inline in their own tab (no tab jumping); build actions feed the 输出 tab.
//
// 官方设置（设置 → 插件 → HarmonyOS 工作台，keyed slot key=hmos-sidebar）：
//   popup.keepCollapsed      默认不展开弹窗（true：探测到鸿蒙工程也不自动展开面板）
//   ball.hideWithoutProject  在非鸿蒙工作区默认不展示悬浮球（true：未探测到工程即隐藏）
// 安静默认值与 Host 半 DEFAULT_SETTINGS 一致；settings 服务缺失时整体回退默认。

window.__ModuleLoader__.load({
  id: 'dsh-hmos-sidebar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const ReactDOM = require('react-dom/client')

    const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.hmos-root{--accent:#2563eb;--accent-strong:#1d4ed8;--danger:#dc2626;--card-bg:rgba(127,127,127,.06);--border:rgba(127,127,127,.18);--hover:rgba(127,127,127,.12);--muted:rgba(127,127,127,.55);--field-bg:rgba(127,127,127,.05);--shadow:0 8px 32px rgba(0,0,0,.22);--text-color:#fff}
@media (prefers-color-scheme:dark){.hmos-root{--accent:#60a5fa;--accent-strong:#3b82f6;--danger:#f87171}}
/* 层叠契约：整个工作台渲染在官方 shell.overlay 层（DSH layout 的 z-index:20 overlayLayer）内，
   因此覆盖 shell 内容；菜单(z≈20–100)、dialog(1000)、toast(1100) 等更高 overlay 仍覆盖本面板。
   层内只用低数值层级（ball 2 > panel 1），禁止 int32 上限级极端 z-index。 */
.hmos-root{position:fixed;z-index:1;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;color:var(--text-color,#fff);pointer-events:auto}
.hmos-ball{position:fixed;right:18px;bottom:18px;z-index:2;width:48px;height:48px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:var(--accent,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);user-select:none;transition:background .15s,transform .15s,box-shadow .15s;font-family:system-ui,sans-serif}
.hmos-ball:hover{background:var(--accent-strong,#1d4ed8);transform:scale(1.06);box-shadow:0 6px 18px rgba(0,0,0,.34)}
.hmos-panel{position:fixed;z-index:1;width:430px;max-width:94vw;height:min(78vh,640px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#222);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#222) 92%, transparent);backdrop-filter:blur(14px);border:1px solid var(--dsw-alias-border-l1,#444);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden;color:var(--text-color,#fff)}
.hmos-panel.ball-mode{display:none}
.hmos-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(127,127,127,.07);border-bottom:1px solid var(--border,rgba(127,127,127,.2));cursor:grab;user-select:none;flex-shrink:0;color:var(--text-color,#fff)}
.hmos-bar:active{cursor:grabbing}
.hmos-bar-logo{width:24px;height:24px;border-radius:7px;background:var(--accent,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;overflow:hidden}
.hmos-bar-logo img{width:100%;height:100%;object-fit:cover;display:block}
.hmos-bar-title{font-weight:650;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hmos-bar-sub{font-size:11px;opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.hmos-bar-actions{margin-left:auto;display:flex;gap:4px;flex-shrink:0}
.hmos-icon-btn{width:24px;height:24px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--text-color,#fff);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:.65}
.hmos-icon-btn:hover{background:rgba(127,127,127,.15);opacity:1}
.hmos-tabs{display:flex;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--border,rgba(127,127,127,.2));flex-shrink:0;overflow-x:auto}
.hmos-tab{padding:6px 12px;border-radius:8px 8px 0 0;font-size:12px;font-weight:550;cursor:pointer;opacity:.6;border:1px solid transparent;border-bottom:none;white-space:nowrap;user-select:none}
.hmos-tab:hover{opacity:.9;background:rgba(127,127,127,.08)}
.hmos-tab.active{opacity:1;background:var(--card-bg,rgba(127,127,127,.06));border-color:var(--border,rgba(127,127,127,.2));color:var(--accent,#60a5fa)}
.hmos-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px;color:var(--text-color,#fff)}
.hmos-card{background:var(--card-bg,rgba(127,127,127,.06));border:1px solid var(--border,rgba(127,127,127,.2));border-radius:12px;padding:10px 12px;color:var(--text-color,#fff)}
.hmos-card-title{font-size:11px;font-weight:600;opacity:.6;margin-bottom:8px;letter-spacing:.2px;display:flex;align-items:center;gap:6px}
.hmos-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.hmos-chip{display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--border,rgba(127,127,127,.3));background:transparent;color:var(--text-color,#fff);transition:background .12s,border-color .12s;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hmos-chip:hover:not(:disabled){background:var(--hover,rgba(127,127,127,.12))}
.hmos-chip:disabled{opacity:.4;cursor:default}
.hmos-chip-primary{background:var(--accent,#2563eb);border-color:var(--accent,#2563eb);color:#fff}
.hmos-chip-primary:hover:not(:disabled){background:var(--accent-strong,#1d4ed8);border-color:var(--accent-strong,#1d4ed8)}
.hmos-chip-danger{background:transparent;border-color:var(--danger,#dc2626);color:var(--danger,#dc2626)}
.hmos-chip-danger:hover:not(:disabled){background:rgba(220,38,38,.08)}
.hmos-input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;font-size:12px;background:var(--field-bg,rgba(127,127,127,.05));border:1px solid var(--border,rgba(127,127,127,.28));color:var(--text-color,#fff);outline:none;transition:border-color .12s}
.hmos-input:focus{border-color:var(--accent,#2563eb)}
.hmos-input::placeholder{opacity:.38}
select.hmos-input{background-color:var(--popup-bg,#222);color:var(--popup-text,#fff);color-scheme:var(--popup-color-scheme,dark)}
select.hmos-input option,select.hmos-input optgroup{background-color:var(--popup-bg,#222);color:var(--popup-text,#fff)}
select.hmos-input option:disabled{color:color-mix(in srgb,var(--popup-text,#fff) 48%,var(--popup-bg,#222))}
.hmos-field{margin-bottom:7px}
.hmos-field:last-child{margin-bottom:0}
.hmos-label{font-size:11px;opacity:.5;margin-bottom:3px;display:block}
.hmos-pre{margin:8px 0 0;padding:8px 10px;background:var(--field-bg,rgba(127,127,127,.05));border:1px solid var(--border,rgba(127,127,127,.2));border-radius:8px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;color:var(--text-color,#fff)}
.hmos-log{margin:0;padding:10px 12px;background:#0b0f14;border:1px solid rgba(127,127,127,.16);border-radius:8px;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--text-color,#fff);white-space:pre-wrap;word-break:break-all;max-height:100%;overflow:auto}
.hmos-kv{display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border,rgba(127,127,127,.18));font-size:12px;color:var(--text-color,#fff)}
.hmos-kv:last-child{border-bottom:none}
.hmos-kv-key{flex:0 0 110px;opacity:.55;overflow:hidden;text-overflow:ellipsis}
.hmos-kv-val{flex:1;min-width:0;word-break:break-all}
.hmos-empty{opacity:.5;font-size:12px;padding:4px 0}
.hmos-log-card{flex:1;min-height:80px;display:flex;flex-direction:column;margin-bottom:0}
.hmos-log-card .hmos-log{flex:1;max-height:none;min-height:60px}
.hmos-resize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;cursor:se-resize;opacity:.5;z-index:5}
.hmos-resize:hover{opacity:1}
.hmos-resize::before{content:'';position:absolute;right:3px;bottom:3px;width:10px;height:10px;border-right:2px solid var(--accent,#60a5fa);border-bottom:2px solid var(--accent,#60a5fa);border-radius:0 0 4px 0}
`

    const LS_POS = 'dsh-hmos-panel-pos'

    function parseCssColor(bg) {
      if (!bg || typeof bg !== 'string') return null
      const s = bg.trim().toLowerCase()
      if (!s || s === 'transparent' || s === 'none' || s === 'inherit' || s === 'initial') return null
      if (s.charAt(0) === '#') {
        let hex = s.slice(1)
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
        if (hex.length === 8) hex = hex.slice(0, 6)
        if (hex.length !== 6) return null
        const n = parseInt(hex, 16)
        if (Number.isNaN(n)) return null
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
      }
      const m = s.match(/rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)/)
      if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
      return null
    }

    function relativeLuminance(r, g, b) {
      const lin = [r, g, b].map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }

    function getOptimalTextColor(bg) {
      const rgb = parseCssColor(bg)
      if (!rgb) return '#fff'
      return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.55 ? '#111' : '#fff'
    }

    function getPopupTheme(bg) {
      const rgb = parseCssColor(bg) || { r: 34, g: 34, b: 34 }
      const r = Math.max(0, Math.min(255, Math.round(rgb.r)))
      const g = Math.max(0, Math.min(255, Math.round(rgb.g)))
      const b = Math.max(0, Math.min(255, Math.round(rgb.b)))
      const dark = relativeLuminance(r, g, b) <= 0.55
      return {
        background: 'rgb(' + r + ' ' + g + ' ' + b + ')',
        text: dark ? '#fff' : '#111',
        scheme: dark ? 'dark' : 'light',
      }
    }

    function resolvePanelBg(el) {
      try {
        if (el) {
          const painted = getComputedStyle(el).backgroundColor
          if (parseCssColor(painted)) return painted
        }
      } catch {}
      try {
        const fromDoc = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-layer-1').trim()
        if (fromDoc) return fromDoc
        const fromBody = document.body ? getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim() : ''
        if (fromBody) return fromBody
      } catch {}
      return '#222'
    }

    function api(method, payload) {
      return fetch('/hmos/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      }).then((r) => r.json())
    }

    // ---- 官方设置（设置 → 插件 → HarmonyOS 工作台）----
    // Host 半注册 hmos-sidebar 命名空间；这里绑定同一命名空间的 scope 读取解析值。
    // scope 缺失 / 未就绪 / 值缺失时一律回退默认值（与 Host DEFAULT_SETTINGS 一致）：
    // 设置是可选增强，绝不影响工作台主功能。
    const SETTINGS_NS = 'hmos-sidebar'

    function readHmosSettings(scope) {
      const fallback = { ready: false, keepCollapsed: true, hideWithoutProject: true }
      if (!scope || typeof scope.getSnapshot !== 'function') return fallback
      let snap = null
      try { snap = scope.getSnapshot() } catch { return fallback }
      if (!snap || snap.status !== 'ready' || !snap.value || typeof snap.value !== 'object') return fallback
      const v = snap.value
      return {
        ready: true,
        keepCollapsed: !(v.popup && v.popup.keepCollapsed === false),
        hideWithoutProject: !(v.ball && v.ball.hideWithoutProject === false),
      }
    }

    // ── 设置卡片：官方 PluginCard 同款折叠卡片 ─────────────────────────────
    // 官方 PluginCard 组件不对仓外插件开放（bundle purity），这里按相同结构自绘
    // 折叠卡，让 HarmonyOS 工作台以一个可展开 <li> 出现在「设置 → 插件」列表。

    const SETTINGS_FIELDS = [
      {
        path: ['popup', 'keepCollapsed'],
        kind: 'bool',
        label: '默认不展开弹窗',
        hint: '开启时即使当前工作区检测到鸿蒙工程也不自动展开工作台面板（默认）。关闭后，探测到鸿蒙工程时会自动展开一次。',
      },
      {
        path: ['ball', 'hideWithoutProject'],
        kind: 'bool',
        label: '在非鸿蒙工作区，默认不展示悬浮球',
        hint: '开启时当前工作区未探测到鸿蒙工程则隐藏右下角悬浮球，探测完成前同样隐藏（默认）。关闭后悬浮球始终显示。',
      },
    ]

    function isPlainObjectValue(v) {
      return v !== null && typeof v === 'object' && !Array.isArray(v)
    }

    function getAt(obj, path) {
      let cur = obj
      for (const key of path) {
        if (!isPlainObjectValue(cur) || !(key in cur)) return undefined
        cur = cur[key]
      }
      return cur
    }

    function formatSettingValue(field, value) {
      if (field.kind === 'bool') return value ? 'true' : 'false'
      return ''
    }

    function parseSettingValue(field, text) {
      if (field.kind === 'bool') return text === true || text === 'true'
      return undefined
    }

    function fieldKey(path) {
      return path.join('.')
    }

    const CARD_CSS_ID = 'dsh-hmos-sidebar/plugin-card'
    const CARD_CSS = [
      '.dhssCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}',
      '.dhssCard:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.dhssCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dhssHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
      '.dhssHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dhssHeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
      '.dhssName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.dhssDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.dhssChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.dhssChevronOpen{transform:rotate(180deg)}',
      '.dhssBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.dhssReadOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}',
      '.dhssPending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
      '.dhssFooter{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
      '.dhssFailed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
      '.dhssDiscard,.dhssSave{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
      '.dhssDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
      '.dhssDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.dhssSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.dhssDiscard:disabled,.dhssSave:disabled{opacity:.4;cursor:default}',
      '.dhssDiscard:focus-visible,.dhssSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dhssField{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
      '.dhssField+.dhssField{border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dhssFieldHead{align-items:center;gap:8px;display:flex}',
      '.dhssLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}',
      '.dhssBadges{align-items:center;gap:8px;display:inline-flex}',
      '.dhssBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
      '.dhssReset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
      '.dhssReset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dhssHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.dhssSwitch{appearance:none;width:36px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);position:relative;cursor:pointer;flex:none}',
      '.dhssSwitch::after{content:"";width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);position:absolute;top:2px;left:2px;transition:transform .16s,background .16s}',
      '.dhssSwitch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dhssSwitch:checked::after{background:var(--dsw-alias-bg-layer-3);transform:translateX(16px)}',
      '.dhssSwitch:disabled{opacity:.4;cursor:default}',
      '.dhssSwitch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
    ].join('')

    function ensureCardStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CARD_CSS_ID) + ']')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-hmos-sidebar'
      tag.dataset.pluginCss = CARD_CSS_ID
      tag.textContent = CARD_CSS
      document.head.appendChild(tag)
    }

    // ensureCardStyles 的幂等逆操作：stop / update / HMR 时移除样式标签，稍后重挂再重建。
    function removeCardStyles() {
      if (typeof document === 'undefined') return
      const tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(CARD_CSS_ID) + ']')
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    }

    function CardChevron(props) {
      return React.createElement('svg', {
        width: 14,
        height: 14,
        className: props.className,
        viewBox: '0 0 14 14',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
      }, React.createElement('path', {
        d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
        fill: 'currentColor',
      }))
    }

    function SettingsFieldRow(props) {
      const head = [
        React.createElement('label', { key: 'lab', className: 'dhssLabel', htmlFor: props.id }, props.label),
      ]
      if (props.overridden) {
        head.push(React.createElement('span', { key: 'badges', className: 'dhssBadges' },
          React.createElement('span', { className: 'dhssBadge' }, '已覆盖'),
          React.createElement('button', {
            type: 'button',
            className: 'dhssReset',
            disabled: props.disabled,
            onClick: props.onReset,
          }, '恢复默认'),
        ))
      }
      return React.createElement('div', { className: 'dhssField' },
        React.createElement('div', { className: 'dhssFieldHead' }, head),
        React.createElement('input', {
          id: props.id,
          className: 'dhssSwitch',
          type: 'checkbox',
          checked: props.text === 'true',
          disabled: props.disabled,
          onChange: (ev) => props.onEdit(ev.target.checked ? 'true' : 'false'),
        }),
        React.createElement('p', { className: 'dhssHint' }, props.hint || null),
      )
    }

    function HmosSettingsCard(props) {
      ensureCardStyles()
      const scope = props.scope
      const api = props.api
      const [tick, setTick] = React.useState(0)
      const [open, setOpen] = React.useState(false)
      const [staged, setStaged] = React.useState({})
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        if (!scope || typeof scope.subscribe !== 'function') return undefined
        return scope.subscribe(() => setTick((n) => n + 1))
      }, [scope])

      const snap = scope && typeof scope.getSnapshot === 'function'
        ? scope.getSnapshot()
        : { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false }

      const available = snap.status === 'ready'
      const writable = !!snap.writable
      const value = snap.value || {}
      const base = snap.base || {}
      const user = snap.user || {}

      const plan = []
      for (const field of SETTINGS_FIELDS) {
        const key = fieldKey(field.path)
        const draft = staged[key]
        if (!draft) continue
        if (draft.clear) {
          if (getAt(user, field.path) !== undefined) plan.push({ op: 'unset', path: field.path })
          continue
        }
        const parsed = parseSettingValue(field, draft.text)
        if (formatSettingValue(field, getAt(value, field.path)) === formatSettingValue(field, parsed)) continue
        plan.push({ op: 'set', path: field.path, value: parsed })
      }

      const dirty = plan.length > 0
      const blocked = !dirty || saving

      function stage(field, next) {
        setFailed(false)
        setStaged((prev) => Object.assign({}, prev, { [fieldKey(field.path)]: next }))
      }

      function discard() {
        if (!dirty && !failed) return
        setStaged({})
        setFailed(false)
      }

      async function save() {
        if (!api || !api.settings || saving || !dirty || !writable) return
        setSaving(true)
        setFailed(false)
        try {
          const ops = plan.map((item) => (
            item.op === 'unset'
              ? { op: 'unset', path: item.path }
              : { op: 'set', path: item.path, value: item.value }
          ))
          const payload = { ns: SETTINGS_NS, ops }
          if (snap.revision !== undefined) payload.expectedRevision = snap.revision
          const response = await api.settings.mutate(payload)
          const ok = !!(response && response.result && response.result.ok)
          if (ok) setStaged({})
          else setFailed(true)
        } catch (_) {
          setFailed(true)
        }
        setSaving(false)
      }

      void tick
      if (!available) return null

      const fields = SETTINGS_FIELDS.map((field) => {
        const key = fieldKey(field.path)
        const draft = staged[key]
        const current = getAt(value, field.path)
        const stored = getAt(user, field.path) !== undefined
        const overridden = draft
          ? !draft.clear
          : stored
        const text = draft ? draft.text : formatSettingValue(field, current)
        return React.createElement(SettingsFieldRow, {
          key,
          id: 'plugin-config-hmos-sidebar-' + key.replace(/\./g, '-'),
          kind: field.kind,
          label: field.label,
          hint: field.hint,
          text,
          overridden,
          disabled: !writable || saving,
          onEdit: (next) => stage(field, { text: next, clear: false }),
          onReset: () => stage(field, { text: formatSettingValue(field, getAt(base, field.path)), clear: true }),
        })
      })

      const body = open ? React.createElement('div', { className: 'dhssBody' },
        writable ? null : React.createElement('p', { className: 'dhssReadOnly', role: 'status' }, '本部署的设置为只读。'),
        fields,
        React.createElement('div', { className: 'dhssFooter' },
          failed ? React.createElement('p', { className: 'dhssFailed', role: 'status' }, '本部署没有接受这些值，已保留供你修改。') : null,
          React.createElement('button', {
            type: 'button',
            className: 'dhssDiscard',
            disabled: !dirty || saving,
            onClick: discard,
          }, '放弃修改'),
          React.createElement('button', {
            type: 'button',
            className: 'dhssSave',
            disabled: blocked || !writable,
            onClick: save,
          }, saving ? '保存中…' : '保存'),
        ),
      ) : null

      return React.createElement('li', { className: open ? 'dhssCard dhssCardOpen' : 'dhssCard' },
        React.createElement('button', {
          type: 'button',
          className: 'dhssHeader',
          'aria-expanded': open,
          'aria-label': (open ? '收起设置' : '展开设置') + ': HarmonyOS 工作台',
          onClick: () => setOpen(!open),
        },
          React.createElement('span', { className: 'dhssHeadText' },
            React.createElement('span', { className: 'dhssName' }, 'HarmonyOS 工作台'),
            React.createElement('span', { className: 'dhssDescription' }, '鸿蒙工程悬浮球与弹窗的默认行为。默认安静：非鸿蒙工作区不展示悬浮球，也不自动展开弹窗。'),
          ),
          dirty ? React.createElement('span', { className: 'dhssPending' }, '未保存') : null,
          React.createElement(CardChevron, { className: open ? 'dhssChevron dhssChevronOpen' : 'dhssChevron' }),
        ),
        body,
      )
    }

    // ---- document 级拖拽生命周期（面板移动 / resize / 悬浮球三组共用）----
    // 三组拖拽都在 document 上挂 mousemove+mouseup；正常 mouseup 结束拖拽，
    // 但插件在拖拽中途 unload/update 时 mouseup 永远不来，监听器会残留。
    // 每一组拖拽登记一个幂等 disposer 到模块局部的 activeDrags 集合，
    // apply 的 ctx.effect cleanup 统一兜底：正常 mouseup 与卸载走同一释放路径。
    const activeDrags = new Set()
    let bodyDragSnapshot = null // 首个拖拽开始时 body 的临时样式快照

    function disposeAllActiveDrags() {
      for (const dispose of Array.from(activeDrags)) dispose()
    }

    // 开启一组 document 级拖拽：onMove 跟随指针；onEnd 在拖拽结束时调用一次
    // （无论正常 mouseup 还是被卸载路径强制结束）。返回幂等 disposer。
    function beginDrag(onMove, onEnd) {
      let done = false
      const onUp = () => dispose()
      const dispose = () => {
        if (done) return
        done = true
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        activeDrags.delete(dispose)
        if (activeDrags.size === 0 && bodyDragSnapshot) {
          // 最后一组拖拽结束时恢复 body 临时 userSelect/cursor 状态
          const body = document.body
          const snap = bodyDragSnapshot
          bodyDragSnapshot = null
          if (body && snap) {
            body.style.userSelect = snap.userSelect
            body.style.cursor = snap.cursor
          }
        }
        if (onEnd) onEnd()
      }
      if (activeDrags.size === 0) {
        const body = document.body
        if (body) {
          bodyDragSnapshot = {
            userSelect: body.style.userSelect || '',
            cursor: body.style.cursor || '',
          }
          body.style.userSelect = 'none'
        }
      }
      activeDrags.add(dispose)
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      return dispose
    }

    // 拖动面板（非模态）：与 onBarDown 行为逐字等价，仅把 document 监听换成
    // beginDrag 生命周期（位置计算、bar-actions 守卫、持久化均不变）。
    function beginPanelDrag(ev, panelRef, setPos) {
      if (ev.target.closest('.hmos-bar-actions')) return
      const startX = ev.clientX
      const startY = ev.clientY
      const base = panelRef.current ? panelRef.current.getBoundingClientRect() : null
      if (!base) return
      beginDrag((mv) => {
        setPos({ x: base.left + mv.clientX - startX, y: base.top + mv.clientY - startY })
      })
    }

    // 右下角缩放：拖动调整面板宽高（320/260 下限与窗口上限不变）。
    function beginResizeDrag(ev, size, setSize) {
      ev.preventDefault()
      ev.stopPropagation()
      const startX = ev.clientX
      const startY = ev.clientY
      const base = size
      beginDrag((mv) => {
        const w = Math.max(320, Math.min(window.innerWidth - 20, base.w + mv.clientX - startX))
        const h = Math.max(260, Math.min(window.innerHeight - 40, base.h + mv.clientY - startY))
        setSize({ w, h })
      })
    }

    // 悬浮球拖动：自由移动（3px 阈值区分点击与拖动），结束时复位 moving。
    function beginBallDrag(ev, ballRef, movingRef, setBallPos) {
      ev.preventDefault()
      const startX = ev.clientX
      const startY = ev.clientY
      const base = ballRef.current ? ballRef.current.getBoundingClientRect() : null
      if (!base) return
      beginDrag((mv) => {
        const dx = mv.clientX - startX
        const dy = mv.clientY - startY
        if (Math.abs(dx) + Math.abs(dy) > 3) movingRef.current.moving = true
        setBallPos({
          x: Math.max(0, Math.min(window.innerWidth - base.width, base.left + dx)),
          y: Math.max(0, Math.min(window.innerHeight - base.height, base.top + dy)),
        })
      }, () => {
        setTimeout(() => { movingRef.current.moving = false }, 50)
      })
    }

    function HmosOverlay(props) {
      const hostRef = React.useRef(null)
      const rootRef = React.useRef(null)
      React.useLayoutEffect(() => {
        const host = hostRef.current
        if (!host) return undefined
        const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
        const styleEl = document.createElement('style')
        styleEl.textContent = CSS
        shadow.appendChild(styleEl)
        const mount = document.createElement('div')
        shadow.appendChild(mount)
        const root = ReactDOM.createRoot(mount)
        rootRef.current = root
        root.render(React.createElement(HmosApp, { workspacePath: props.workspacePath, settingsScope: props.settingsScope }))
        return () => {
          rootRef.current = null
          try { root.unmount() } catch {}
          try { mount.remove() } catch {}
          try { styleEl.remove() } catch {}
        }
      }, [])
      React.useEffect(() => {
        if (rootRef.current) rootRef.current.render(React.createElement(HmosApp, { workspacePath: props.workspacePath, settingsScope: props.settingsScope }))
      }, [props.workspacePath])
      return React.createElement('div', { ref: hostRef, 'data-dsh-hmos-sidebar': '' })
    }

    function HmosSlotEntry({ useSessions, settingsScope }) {
      const current = useSessions((snapshot) => snapshot.current)
      const workspacePath = useSessions((snapshot) => current === undefined ? '' : (snapshot.byId[current] && snapshot.byId[current].cwd) || '')
      return React.createElement(HmosOverlay, { workspacePath, settingsScope })
    }

    function apply(ctx) {
      // 官方设置 scope（可选）：settingsScope / connection 服务缺失时保持 null，
      // 悬浮球与弹窗按内置默认值（安静模式）工作。
      let settingsScope = null
      try {
        const binder = ctx.get('settingsScope')
        if (binder && typeof binder.bind === 'function') settingsScope = binder.bind({ namespace: SETTINGS_NS })
      } catch { settingsScope = null }
      let connectionApi = null
      try {
        const connection = ctx.get('connection')
        if (connection && connection.api) connectionApi = connection.api
      } catch { connectionApi = null }

      const disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-hmos-sidebar', order: 80, label: 'HarmonyOS 工作台' },
        (props) => React.createElement(HmosSlotEntry, { useSessions: props.useSessions, settingsScope }),
      ))
      // 设置卡片：注册进官方「设置 → 插件」列表（keyed slot，key=设置命名空间）。
      const disposeCard = ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
        { name: 'settings.plugin.item', key: SETTINGS_NS, label: 'HarmonyOS 工作台' },
        () => React.createElement(HmosSettingsCard, { scope: settingsScope, api: connectionApi }),
      ))
      // 拖拽可能跨 apply 生命周期：插件在拖拽中途 unload/update 时，
      // ctx.effect cleanup 兜底强制结束仍在飞行的 document 拖拽并恢复 body 状态。
      ctx.effect(() => () => disposeAllActiveDrags(), 'dsh-hmos-sidebar: active drags')
      // 设置卡片样式标签：卡片渲染时惰性创建，卸载/更新时移除，不留全局残留。
      ctx.effect(() => () => removeCardStyles(), 'dsh-hmos-sidebar: plugin card style')
      return () => {
        try { disposeOverlay() } catch {}
        try { disposeCard() } catch {}
      }
    }

    // ---- 主应用：悬浮球 + 非模态面板 ----
    const HmosApp = ({ workspacePath, settingsScope }) => {
      const [open, setOpen] = React.useState(false)
      const [tab, setTab] = React.useState('build')
      const [pos, setPos] = React.useState(() => {
        try {
          const saved = JSON.parse(localStorage.getItem(LS_POS) || 'null')
          if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return saved
        } catch {}
        return { x: null, y: null }
      })
      const [info, setInfo] = React.useState(null)
      const [devices, setDevices] = React.useState([])
      const [buildOut, setBuildOut] = React.useState('')
      const [deployOut, setDeployOut] = React.useState('')
      const [devOut, setDevOut] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [hapPath, setHapPath] = React.useState('')
      const [bundleName, setBundleName] = React.useState('')
      const [device, setDevice] = React.useState('')
      const [shotPath, setShotPath] = React.useState('')
      const [projectPath, setProjectPath] = React.useState(workspacePath || '')
      const [probed, setProbed] = React.useState(false)
      const [projectValid, setProjectValid] = React.useState(false)
      const [artifacts, setArtifacts] = React.useState([])
      const [manualHap, setManualHap] = React.useState(false)
      const [hapInfo, setHapInfo] = React.useState(null)
      const [size, setSize] = React.useState(() => {
        try {
          const saved = JSON.parse(localStorage.getItem('dsh-hmos-panel-size') || 'null')
          if (saved && typeof saved.w === 'number' && typeof saved.h === 'number') return saved
        } catch {}
        return { w: 430, h: 640 }
      })
      const [ballPos, setBallPos] = React.useState(() => {
        try {
          const saved = JSON.parse(localStorage.getItem('dsh-hmos-ball-pos') || 'null')
          if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return saved
        } catch {}
        return { x: null, y: null }
      })
      const dragRef = React.useRef(null)
      const ballRef = React.useRef(null)
      const [tools, setTools] = React.useState(null)
      const [toolQuery, setToolQuery] = React.useState('')
      const [appIcon, setAppIcon] = React.useState('')
      const [textColor, setTextColor] = React.useState('#fff')
      const [popupTheme, setPopupTheme] = React.useState(() => getPopupTheme('#222'))

      // ---- 官方设置：解析值 + 订阅（scope 缺失/未就绪时保持安静默认值）----
      const [settings, setSettings] = React.useState(() => readHmosSettings(settingsScope))
      React.useEffect(() => {
        setSettings(readHmosSettings(settingsScope))
        if (!settingsScope || typeof settingsScope.subscribe !== 'function') return undefined
        return settingsScope.subscribe(() => setSettings(readHmosSettings(settingsScope)))
      }, [settingsScope])
      // 探测回调里读到的必须是最新设置与最新 open 状态：用 ref 镜像（与 posRef 同一惯用法）。
      const settingsRef = React.useRef(settings)
      settingsRef.current = settings
      const openRef = React.useRef(open)
      openRef.current = open

      const syncTextColor = React.useCallback(() => {
        const background = resolvePanelBg(dragRef.current)
        const next = getOptimalTextColor(background)
        const nextPopup = getPopupTheme(background)
        setTextColor((prev) => (prev === next ? prev : next))
        setPopupTheme((prev) => (
          prev.background === nextPopup.background && prev.text === nextPopup.text && prev.scheme === nextPopup.scheme
            ? prev
            : nextPopup
        ))
      }, [])

      React.useLayoutEffect(() => {
        syncTextColor()
        const obs = new MutationObserver(syncTextColor)
        try {
          obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
          if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        } catch {}
        const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        const onMq = () => syncTextColor()
        if (mq) {
          if (mq.addEventListener) mq.addEventListener('change', onMq)
          else if (mq.addListener) mq.addListener(onMq)
        }
        const id = setInterval(syncTextColor, 2000)
        return () => {
          try { obs.disconnect() } catch {}
          if (mq) {
            if (mq.removeEventListener) mq.removeEventListener('change', onMq)
            else if (mq.removeListener) mq.removeListener(onMq)
          }
          clearInterval(id)
        }
      }, [syncTextColor, open])

      const appendBuild = (s) => setBuildOut((prev) => (prev + '\n' + s).slice(-16000))
      const appendDeploy = (s) => setDeployOut((prev) => (prev + '\n' + s).slice(-12000))
      const appendDev = (s) => setDevOut((prev) => (prev + '\n' + s).slice(-12000))

      const refresh = () => {
        api('hmos/info').then((r) => setInfo(r)).catch((er) => appendBuild('info: ' + String(er)))
        api('hmos/devices').then((r) => {
          if (r && r.ok) setDevices(r.devices || [])
        }).catch(() => {})
      }

      React.useEffect(() => {
        refresh()
        api('hmos/devices').then((r) => {
          if (r && r.ok && r.devices && r.devices.length) setDevice(r.devices[0].serial)
        }).catch(() => {})
        api('hmos/tools').then((r) => {
          if (r && r.ok) setTools(r.tools)
        }).catch(() => {})
      }, [])

      // shell.overlay 的标准 useSessions 属性给出当前会话 cwd。首次挂载及切换会话时，
      // 都以该路径重新探测；Host process.cwd 只作为没有当前会话时的最后兜底。
      React.useEffect(() => {
        let active = true
        const requestedPath = workspacePath || ''
        setProjectPath(requestedPath)
        setBundleName('')
        setHapPath('')
        setArtifacts([])
        setAppIcon('')
        setProbed(false)
        setProjectValid(false)
        api('hmos/probe', { path: requestedPath || undefined }).then((r) => {
          if (!active) return
          setProbed(true)
          if (!r || !r.ok) return
          const found = r.foundRoot || ''
          setProjectValid(!!found)
          // 「默认不展开弹窗」关闭且本次探测发现鸿蒙工程时，自动展开一次面板。
          // openRef 反映最新面板状态：用户已手动展开时不重复干预；每次工作区
          // 探测至多触发一次（effect 以 workspacePath 为依赖）。
          if (found && settingsRef.current.keepCollapsed === false && !openRef.current) setOpen(true)
          if (found) setProjectPath(found)
          if (r.bundleName) setBundleName(r.bundleName)
          if (r.hapPath) setHapPath(r.hapPath)
          if (Array.isArray(r.artifacts)) setArtifacts(r.artifacts)
          if (r.versionName) setInfo((prev) => ({ ...(prev || {}), projectPath: found || (prev && prev.projectPath), versionName: r.versionName, versionCode: r.versionCode }))
          if (found) api('hmos/app-icon', { path: found }).then((ir) => {
            if (active && ir && ir.ok && ir.dataUrl) setAppIcon(ir.dataUrl)
          }).catch(() => {})
        }).catch(() => { if (active) setProbed(true) })
        return () => { active = false }
      }, [workspacePath])

      // 拖动面板（非模态）
      const posRef = React.useRef(pos)
      posRef.current = pos
      const onBarDown = (ev) => beginPanelDrag(ev, dragRef, setPos)
      React.useEffect(() => {
        try { localStorage.setItem(LS_POS, JSON.stringify(pos)) } catch {}
      }, [pos])
      // 保存窗口大小
      React.useEffect(() => {
        try { localStorage.setItem('dsh-hmos-panel-size', JSON.stringify(size)) } catch {}
      }, [size])

      // ---- 构建：输出就地展示（构建 Tab 底部）----
      const doBuild = (buildMode) => {
        if (busy) return
        setBusy(true)
        appendBuild('$ devecocli build --build-mode ' + buildMode + (projectPath ? '  (cwd: ' + projectPath + ')' : ''))
        api('hmos/build', { buildMode, cwd: projectPath || undefined }).then((r) => {
          if (r.stdout) appendBuild(r.stdout.slice(-16000))
          if (r.stderr) appendBuild('[stderr] ' + r.stderr.slice(-4000))
          appendBuild(r.ok ? '[构建完成]' : '[构建失败] ' + (r.error || ('exit ' + r.exitCode)))
        }).catch((er) => appendBuild('ERROR: ' + String(er))).finally(() => setBusy(false))
      }
      const doClean = () => {
        if (busy) return
        setBusy(true)
        appendBuild('$ devecocli build clean  (cwd: ' + (projectPath || '默认工程') + ')')
        api('hmos/clean', { cwd: projectPath || undefined }).then((r) => {
          if (r.stdout) appendBuild(r.stdout.slice(-16000))
          if (r.stderr) appendBuild('[stderr] ' + r.stderr.slice(-4000))
          appendBuild(r.ok ? '[清理完成]' : '[清理失败] ' + (r.error || ('exit ' + r.exitCode)))
        }).catch((er) => appendBuild('ERROR: ' + String(er))).finally(() => setBusy(false))
      }
      // 同步：走 hvigorw.js（hmos/sync RPC），非 devecocli
      const doSync = () => {
        if (busy) return
        setBusy(true)
        appendBuild('$ hvigor --sync  (cwd: ' + (projectPath || '默认工程') + ')')
        api('hmos/sync', { cwd: projectPath || undefined, product: 'default', buildMode: 'debug' }).then((r) => {
          if (r.stdout) appendBuild(r.stdout.slice(-16000))
          if (r.stderr) appendBuild('[stderr] ' + r.stderr.slice(-4000))
          if (r.ok) appendBuild('[sync 完成]')
          else appendBuild('[sync 失败] ' + (r.error || ('exit ' + r.exitCode)))
        }).catch((er) => appendBuild('ERROR: ' + String(er))).finally(() => setBusy(false))
      }

      // 右下角缩放：拖动调整面板宽高
      const onResizeDown = (ev) => beginResizeDrag(ev, size, setSize)

      // 悬浮球拖动：可自由移动位置，点击仍可展开
      const ballDrag = React.useRef({ moving: false })
      const onBallDown = (ev) => beginBallDrag(ev, ballRef, ballDrag, setBallPos)
      React.useEffect(() => {
        try { localStorage.setItem('dsh-hmos-ball-pos', JSON.stringify(ballPos)) } catch {}
      }, [ballPos])

      // ---- 部署：输出就地展示（部署 Tab 底部）----
      const doInstall = () => {
        if (busy || !hapPath) return
        setBusy(true)
        appendDeploy('$ install ' + hapPath)
        api('hmos/install', { hapPath, bundleName: bundleName || undefined, device: device || undefined }).then((r) => {
          if (Array.isArray(r.steps)) r.steps.forEach((s) => appendDeploy(s))
          appendDeploy(r.ok ? '[install OK]' : '[install FAILED]')
        }).catch((er) => appendDeploy('ERROR: ' + String(er))).finally(() => setBusy(false))
      }
      const doStart = () => {
        if (busy || !bundleName) return
        setBusy(true)
        appendDeploy('$ hdc shell aa start -a EntryAbility -b ' + bundleName + (device ? ' -t ' + device : ''))
        api('hmos/start', { device: device || undefined, bundleName }).then((r) => {
          if (r.stdout) appendDeploy(r.stdout.slice(-8000))
          if (r.stderr) appendDeploy('[stderr] ' + r.stderr.slice(-2000))
          appendDeploy(r.ok ? '[启动成功]' : '[启动失败] ' + (r.error || ('exit ' + r.exitCode)))
        }).catch((er) => appendDeploy('ERROR: ' + String(er))).finally(() => setBusy(false))
      }
      const showHapInfo = () => {
        if (!hapPath) return
        appendDeploy('$ hap-info ' + hapPath)
        api('hmos/hap-info', { path: hapPath }).then((r) => {
          setHapInfo(r)
        }).catch((er) => appendDeploy('ERROR: ' + String(er)))
      }

      // ---- 环境：安装 deveco-cli / 刷新检测 ----
      const installCli = () => {
        if (busy) return
        setBusy(true)
        appendBuild('$ npm install -g @deveco/deveco-cli（自动安装中…）')
        api('hmos/install-cli').then((r) => {
          if (r.stdout) appendBuild(r.stdout.slice(-8000))
          if (r.stderr) appendBuild('[stderr] ' + r.stderr.slice(-2000))
          if (r.ok) {
            appendBuild(r.globalOk
              ? '[安装完成] 已全局安装 @deveco/deveco-cli' + (r.globalVersion ? '@' + r.globalVersion : '')
              : '[安装完成] 请重试或手动执行 npm install -g @deveco/deveco-cli')
          } else {
            appendBuild('[安装失败] ' + (r.error || ('exit ' + r.exitCode)) + (r.platform !== 'win32' ? '（Linux/macOS 可能需要 sudo：sudo npm install -g @deveco/deveco-cli）' : ''))
          }
          // 重查环境
          api('hmos/info').then((ri) => setInfo(ri)).catch(() => {})
        }).catch((er) => appendBuild('ERROR: ' + String(er))).finally(() => setBusy(false))
      }
      const refreshEnv = () => {
        api('hmos/info').then((r) => setInfo(r)).catch((er) => appendBuild('info: ' + String(er)))
      }

      // ---- 设备：输出就地展示（设备 Tab 底部）----
      const doLogs = (crash) => {
        if (busy) return
        setBusy(true)
        appendDev('$ devecocli log ' + (crash ? '--crash' : '--tail 50') + (device ? ' --device ' + device : ''))
        api('hmos/logs', { device: device || undefined, crash: crash || undefined, tail: crash ? undefined : '50' }).then((r) => {
          if (r.stdout) appendDev(r.stdout.slice(-12000))
          if (r.stderr) appendDev('[stderr] ' + r.stderr.slice(-3000))
          appendDev(r.ok ? ('[exit ' + r.exitCode + ']') : ('[失败] ' + (r.error || ('exit ' + r.exitCode))))
        }).catch((er) => appendDev('ERROR: ' + String(er))).finally(() => setBusy(false))
      }
      const takeShot = () => {
        if (busy) return
        setBusy(true)
        const path = shotPath || undefined
        appendDev('$ devecocli ui screenshot' + (device ? ' --device ' + device : '') + (path ? ' --path ' + path : ' (默认目录)'))
        api('hmos/screenshot', { device: device || undefined, path }).then((r) => {
          if (r.path) setShotPath(r.path)
          if (r.stdout) appendDev(r.stdout.slice(-12000))
          if (r.stderr) appendDev('[stderr] ' + r.stderr.slice(-3000))
          appendDev(r.ok ? ('[截图已保存] ' + (r.path || '') + (r.error ? '' : '')).trim() : ('[截图失败] ' + (r.error || ('exit ' + r.exitCode))))
        }).catch((er) => appendDev('ERROR: ' + String(er))).finally(() => setBusy(false))
      }

      const e = React.createElement
      const btn = (label, onClick, extra, key) => e('button', { key, className: 'hmos-chip' + (extra ? ' ' + extra : ''), onClick, disabled: busy }, label)
      const input = (value, onChange, placeholder) => e('input', { className: 'hmos-input', value, placeholder, onChange: (ev) => onChange(ev.target.value) })
      const field = (label, node, key) => e('div', { key, className: 'hmos-field' }, e('label', { className: 'hmos-label' }, label), node)
      const card = (title, children, key) => e('div', { key, className: 'hmos-card' }, e('div', { className: 'hmos-card-title' }, title), children)
      const logCard = (title, text, key) => text ? e('div', { key, className: 'hmos-card hmos-log-card' },
        e('div', { className: 'hmos-card-title' }, title),
        e('pre', { className: 'hmos-log' }, text)) : null

      // ---- Tab 内容 ----
      const buildTab = e('div', { className: 'hmos-body', key: 'tab-build' },
        card('环境', [
          e('div', { className: 'hmos-kv', key: 'e1' },
            e('span', { className: 'hmos-kv-key' }, 'deveco-cli'),
            e('span', { className: 'hmos-kv-val' },
              (info && info.cliPath ? info.cliPath : '—') + (info && info.cliOk ? '' : '  ⚠️ 未找到'),
              e('span', { className: 'hmos-empty' }, info ? '  [' + (info.cliSource || '?') + ']' : ''))),
          e('div', { className: 'hmos-kv', key: 'e2' },
            e('span', { className: 'hmos-kv-key' }, 'DevEco Studio'),
            e('span', { className: 'hmos-kv-val' },
              (info && info.devEcoHome ? info.devEcoHome : '—') + (info && info.devEcoOk ? '' : '  ⚠️ 未找到'),
              e('span', { className: 'hmos-empty' }, info ? '  [' + (info.devEcoSource || '?') + ']' : ''))),
          e('div', { className: 'hmos-kv', key: 'e3' },
            e('span', { className: 'hmos-kv-key' }, 'json5 解析'),
            e('span', { className: 'hmos-kv-val' }, info ? (info.json5Ok ? '可用' : '⚠️ 未找到（bundleName 探测会失败）') : '…')),
          // 环境修复引导：cli 缺失可一键安装；Studio 缺失给下载链接；都支持重新检测
          info && !info.cliOk ? e('div', { className: 'hmos-grid', key: 'fix-cli', style: { marginTop: 8 } },
            btn('安装 deveco-cli（npm 全局）', installCli, 'hmos-chip-primary'),
            btn('重新检测', refreshEnv)) : null,
          info && info.cliOk && info.cliSource === 'detected' ? e('div', { key: 'cli-note', className: 'hmos-empty', style: { marginTop: 6 } },
            '已从 npm 全局位置自动识别（无需环境变量）') : null,
          info && !info.devEcoOk ? e('div', { className: 'hmos-grid', key: 'fix-studio', style: { marginTop: 8 } },
            e('button', { key: 'dl', className: 'hmos-chip', onClick: () => { try { window.open('https://developer.huawei.com/consumer/cn/deveco-studio/', '_blank') } catch {} } }, '去下载 DevEco Studio'),
            btn('重新检测', refreshEnv)) : null,
        ], 'env'),
        card('工程', [
          field('工程目录' + (projectValid ? ' ✓' : ''), input(projectPath, (value) => { setProjectPath(value); setProjectValid(false) }, probed ? '当前工作区未找到工程，请手动填写' : '自动探测当前工作区中…'), 'f1'),
          field('bundleName' + (bundleName ? ' ✓' : ''), input(bundleName, setBundleName, probed ? (bundleName ? '' : '未找到，请手动填写') : '自动探测中…'), 'f2'),
        ], 'proj'),
        card('构建', [
          e('div', { className: 'hmos-grid' },
            btn('构建 Debug', () => doBuild('debug'), 'hmos-chip-primary'),
            btn('构建 Release', () => doBuild('release')),
            btn('清理', doClean),
            btn('同步', doSync)),
          e('div', { className: 'hmos-grid', style: { marginTop: 8 } },
            btn('查看包信息', showHapInfo)),
        ]),
        hapInfo ? card('HAP 包信息', [
          hapInfo.ok
            ? [
                hapInfo.bundleName ? e('div', { className: 'hmos-kv', key: 'k1' }, e('span', { className: 'hmos-kv-key' }, 'bundleName'), e('span', { className: 'hmos-kv-val' }, hapInfo.bundleName)) : null,
                hapInfo.versionName ? e('div', { className: 'hmos-kv', key: 'k2' }, e('span', { className: 'hmos-kv-key' }, '版本'), e('span', { className: 'hmos-kv-val' }, hapInfo.versionName + (hapInfo.versionCode ? ' (' + hapInfo.versionCode + ')' : ''))) : null,
                hapInfo.moduleName ? e('div', { className: 'hmos-kv', key: 'k3' }, e('span', { className: 'hmos-kv-key' }, '模块'), e('span', { className: 'hmos-kv-val' }, hapInfo.moduleName + ' / ' + (hapInfo.moduleType || ''))) : null,
                hapInfo.deviceTypes && hapInfo.deviceTypes.length ? e('div', { className: 'hmos-kv', key: 'k4' }, e('span', { className: 'hmos-kv-key' }, '设备类型'), e('span', { className: 'hmos-kv-val' }, hapInfo.deviceTypes.join(', '))) : null,
                hapInfo.abilities && hapInfo.abilities.length ? e('div', { className: 'hmos-kv', key: 'k5' }, e('span', { className: 'hmos-kv-key' }, '能力'), e('span', { className: 'hmos-kv-val' }, hapInfo.abilities.map((a) => a.name || a).join(', '))) : null,
                hapInfo.raw ? e('div', { key: 'k6', className: 'hmos-kv' }, e('span', { className: 'hmos-kv-key' }, '原始 JSON'), e('pre', { className: 'hmos-pre', style: { marginTop: 4 } }, hapInfo.raw)) : null,
              ]
            : e('div', { className: 'hmos-empty', key: 'e' }, hapInfo.error || '解析失败'),
        ], 'hap') : null,
        logCard('构建输出', buildOut, 'build-out'))

      const deployTab = e('div', { className: 'hmos-body', key: 'tab-deploy' },
        card('部署', [
          field('HAP 路径' + (hapPath ? ' ✓' : ''), artifacts.length && !manualHap
            ? e('select', {
                key: 'hapselect', className: 'hmos-input', value: hapPath,
                onChange: (ev) => {
                  if (ev.target.value === '__manual__') { setManualHap(true) }
                  else setHapPath(ev.target.value)
                },
              }, [
                e('option', { key: 'ph', value: '', disabled: true }, '选择构建产物…'),
                ...artifacts.map((a) => e('option', { key: a.path, value: a.path },
                  a.name + (a.kind === 'app' ? ' (App Pack)' : a.kind === 'har' ? ' (归档)' : ''))),
                e('option', { key: 'm', value: '__manual__' }, '手动输入路径…'),
              ])
            : input(hapPath, setHapPath, probed ? (hapPath ? '' : '未找到构建产物，请先构建') : '自动探测构建产物…'), 'f1'),
          // 部署设备：下拉选择已连接设备（serial），可手动输入
          field('部署设备' + (device ? ' ✓' : ''), devices.length
            ? e('select', {
                key: 'devselect', className: 'hmos-input', value: device,
                onChange: (ev) => {
                  if (ev.target.value === '__manual__') { setDevice('') }
                  else setDevice(ev.target.value)
                },
              }, [
                e('option', { key: 'ph', value: '', disabled: true }, '选择设备…'),
                ...devices.map((d) => e('option', { key: d.serial, value: d.serial },
                  d.serial + '  [' + d.kind + ' · ' + d.state + ']')),
                e('option', { key: 'm', value: '__manual__' }, '手动输入序列号…'),
              ])
            : input(device, setDevice, '留空 = 唯一在线设备'), 'f2'),
          e('div', { className: 'hmos-grid', key: 'ops', style: { marginTop: 8 } },
            btn('安装 HAP', doInstall, 'hmos-chip-primary'),
            btn('启动应用', doStart, 'hmos-chip-danger')),
        ], 'deploy'),
        logCard('部署输出', deployOut, 'deploy-out'))

      const devTab = e('div', { className: 'hmos-body', key: 'tab-dev' },
        card('已连接设备', [
          devices.length ? e('pre', { className: 'hmos-pre', key: 'p' },
            devices.map((d) => d.serial + '  [' + d.kind + ' · ' + d.state + (d.transport ? ' · ' + d.transport : '') + ']').join('\n'))
            : e('div', { key: 'e', className: 'hmos-empty' }, '暂无已连接设备'),
        ], 'devs'),
        card('操作', [
          e('div', { className: 'hmos-grid', key: 'g1', style: { marginBottom: 8 } },
            btn('设备日志', () => doLogs(false), 'hmos-chip-primary'),
            btn('崩溃日志', () => doLogs(true))),
          field('截图保存路径', input(shotPath, setShotPath, '留空 = host 默认目录'), 'f2'),
          e('div', { className: 'hmos-grid', key: 'g2', style: { marginTop: 8 } },
            btn('截取屏幕', takeShot, 'hmos-chip-primary')),
        ], 'ops'),
        logCard('设备输出', devOut, 'dev-out'))

      // ---- 速查 Tab：全部 dcli__* 命令 ----
      const quickTab = e('div', { className: 'hmos-body', key: 'tab-quick' },
        card('dcli__ 命令速查', [
          input(toolQuery, setToolQuery, '搜索命令，如 build / device / lsp…'),
        ], 'search'),
        (tools || []).filter((t) => !toolQuery || t.name.includes(toolQuery.toLowerCase()) || (t.description || '').toLowerCase().includes(toolQuery.toLowerCase()))
          .map((t, i) => card(t.name, [
            e('div', { key: 'd', className: 'hmos-empty' }, t.description),
            t.params && t.params.length ? e('div', { key: 'p', style: { marginTop: 6 } },
              t.params.map((p, pi) => e('div', { key: pi, className: 'hmos-kv' },
                e('span', { className: 'hmos-kv-key' }, p.name + (p.required ? ' *' : '')),
                e('span', { className: 'hmos-kv-val' }, p.description + (p.enum ? '（' + p.enum.join('/') + '）' : '') + (p.required ? ' 必填' : ' 可选')))))
              : null,
          ], 'tool-' + i)))

      const tabs = [
        { id: 'build', label: '构建' },
        { id: 'deploy', label: '部署' },
        { id: 'dev', label: '设备' },
        { id: 'quick', label: '速查' },
      ]
      const tabContent = {
        build: buildTab,
        deploy: deployTab,
        dev: devTab,
        quick: quickTab,
      }

      const bar = e('div', { className: 'hmos-bar', onMouseDown: onBarDown, ref: dragRef },
        e('div', { className: 'hmos-bar-logo' }, appIcon ? e('img', { className: 'hmos-bar-icon', src: appIcon, alt: '' }) : 'H'),
        e('div', { className: 'hmos-bar-title' }, bundleName || '鸿蒙工程'),
        e('div', { className: 'hmos-bar-sub' }, info && info.versionName ? 'v' + info.versionName : ''),
        e('div', { className: 'hmos-bar-actions' },
          e('button', { className: 'hmos-icon-btn', title: '最小化', onClick: () => setOpen(false) }, '—'),
          e('button', { className: 'hmos-icon-btn', title: '关闭', onClick: () => setOpen(false) }, '✕')))

      const panel = e('div', {
        className: 'hmos-panel' + (open ? '' : ' ball-mode'),
        ref: dragRef,
        style: Object.assign(
          {
            width: size.w,
            height: size.h,
            color: textColor,
            '--text-color': textColor,
            '--popup-bg': popupTheme.background,
            '--popup-text': popupTheme.text,
            '--popup-color-scheme': popupTheme.scheme,
          },
          pos.x !== null && pos.y !== null ? { left: pos.x, top: pos.y } : { right: 20, bottom: 76 }),
      },
        bar,
        e('div', { className: 'hmos-tabs' }, tabs.map((t) => e('div', {
          key: t.id, className: 'hmos-tab' + (tab === t.id ? ' active' : ''), onClick: () => setTab(t.id),
        }, t.label))),
        tabContent[tab],
        e('div', { className: 'hmos-resize', title: '拖动调整大小', onMouseDown: onResizeDown }))

      // 悬浮球可见性：「在非鸿蒙工作区，默认不展示悬浮球」开启时，只有探测确认
      // 当前工作区存在鸿蒙工程后才显示；探测进行中同样隐藏（安静优先）。
      // 设置关闭（hideWithoutProject=false）时回到旧行为：始终显示。
      const ballVisible = !settings.hideWithoutProject || (probed && projectValid)

      return e('div', {
        className: 'hmos-root',
        style: {
          '--text-color': textColor,
          '--popup-bg': popupTheme.background,
          '--popup-text': popupTheme.text,
          '--popup-color-scheme': popupTheme.scheme,
          color: textColor,
        },
      },
        e('button', {
          ref: ballRef,
          className: 'hmos-ball', title: '鸿蒙工程工作台',
          onClick: () => { if (!ballDrag.current.moving) setOpen(true) },
          onMouseDown: onBallDown,
          style: Object.assign(
            { display: (!ballVisible || open) ? 'none' : 'flex' },
            ballPos.x !== null && ballPos.y !== null ? { left: ballPos.x, top: ballPos.y, right: 'auto', bottom: 'auto' } : {}),
        },
          e('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
            e('rect', { x: 7, y: 2.5, width: 10, height: 19, rx: 2.2 }),
            e('line', { x1: 11, y1: 18.5, x2: 13, y2: 18.5 }))),
        panel)
    }

    exports.apply = apply
    exports.inject = ['slots']
    // 仅测试出口：DSH loader 只读取 apply/inject，忽略其余键。
    // test/client-source.test.mjs 用它真实执行三组拖拽并触发卸载路径，
    // 验证 cleanup 幂等且无 document 监听/body 状态残留。
    exports.__dragLifecycle = {
      beginPanelDrag,
      beginResizeDrag,
      beginBallDrag,
      disposeAllActiveDrags,
      activeDragCount: () => activeDrags.size,
    }
    return module.exports
  },
})
