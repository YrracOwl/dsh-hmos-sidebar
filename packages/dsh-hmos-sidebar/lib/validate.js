// validate.js — hdc 参数校验（Host 半与 dcli 工具子模块共享）
//
// 目的：任何可能进入 hdc argv 的 bundleName / abilityName / moduleName 都必须先
// 通过这里的校验，非法值抛出可操作错误、绝不进入 hdc argv，避免命令注入
// （`;`、`$()`、`&&` 等 shell 元字符一律被拒绝）。
//
// 语义约定：
//   - 可选参数：值为空（undefined / null / 空白）时返回 undefined，不报错；
//   - 必填参数：值为空时抛错（如 start 的 bundleName 必填）。
//   - 非法值一律抛 Error（含原因与可操作提示），调用方在 buildArgs / RPC handler
//     内让错误沿既有错误通道返回，而不是把值拼进 argv。

const ALNUM = /^[A-Za-z0-9_]+$/ // 段级：仅字母/数字/下划线
const SAFE_NAME_RE = /^[A-Za-z0-9_.]+$/ // abilityName/moduleName：允许点

function rawOf(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

// bundleName 按 Deveco CLI strict 规则校验：
//   - 长度 7..128；
//   - 至少 3 个点分段；
//   - 禁止连续点 `..`；
//   - 每段仅 [A-Za-z0-9_]+；
//   - 首段以字母开头，其余段以字母/数字开头；
//   - 每段以字母/数字结尾。
export function validateBundleName(value, opts = {}) {
  const required = opts.required === true
  const label = opts.label || 'bundleName'
  const raw = rawOf(value)
  if (!raw) {
    if (required) throw new Error(label + ' 必填：启动应用需要应用包名（如 com.example.app）')
    return undefined
  }
  if (raw.length < 7 || raw.length > 128) {
    throw new Error(label + ' 非法：长度须 7..128（当前 ' + raw.length + '）：' + raw)
  }
  if (raw.includes('..')) {
    throw new Error(label + ' 非法：不得包含连续点号 ".."：' + raw)
  }
  const segments = raw.split('.')
  if (segments.length < 3) {
    throw new Error(label + ' 非法：至少 3 个点分段（当前 ' + segments.length + ' 段）：' + raw)
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg || !ALNUM.test(seg)) {
      throw new Error(label + ' 非法：每段只能由字母/数字/下划线组成（段 "' + seg + '"）：' + raw)
    }
    const first = seg[0]
    const last = seg[seg.length - 1]
    if (i === 0) {
      if (!/[A-Za-z]/.test(first)) throw new Error(label + ' 非法：首段必须以字母开头：' + raw)
    } else if (!/[A-Za-z0-9]/.test(first)) {
      throw new Error(label + ' 非法：非首段必须以字母/数字开头（段 "' + seg + '"）：' + raw)
    }
    if (!/[A-Za-z0-9]/.test(last)) {
      throw new Error(label + ' 非法：每段必须以字母/数字结尾（段 "' + seg + '"）：' + raw)
    }
  }
  return raw
}

// abilityName / moduleName 安全名：^[A-Za-z0-9_.]+$，长度 1..128。
export function validateSafeName(value, opts = {}) {
  const required = opts.required === true
  const label = opts.label || 'name'
  const raw = rawOf(value)
  if (!raw) {
    if (required) throw new Error(label + ' 必填')
    return undefined
  }
  if (raw.length < 1 || raw.length > 128) {
    throw new Error(label + ' 非法：长度须 1..128（当前 ' + raw.length + '）：' + raw)
  }
  if (!SAFE_NAME_RE.test(raw)) {
    throw new Error(label + ' 非法：只允许字母/数字/下划线/点：' + raw)
  }
  return raw
}
