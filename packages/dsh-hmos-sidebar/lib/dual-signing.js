import fs from 'node:fs'
import path from 'node:path'

const MATERIAL_FIELDS = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword', 'profile', 'certpath']
const SAFE_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

export function parseBuildProfileJson5(text) {
  let out = ''
  let quote = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (quote) {
      out += c
      if (c === '\\') { out += text[i + 1] || ''; i += 2; continue }
      if (c === quote) quote = ''
      i++
      continue
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  // DevEco-generated build profiles use quoted keys. Accept their comments and trailing commas;
  // reject other JavaScript syntax rather than evaluating project-controlled text.
  out = out.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(out)
}

function assertSafeName(value, label) {
  if (!SAFE_NAME_RE.test(value)) throw new Error(label + ' 必须以英文字母开头，且只能包含字母、数字、_、-')
}

function assertMaterial(material, label, projectPath) {
  for (const field of MATERIAL_FIELDS) {
    if (typeof material[field] !== 'string' || !material[field].trim()) throw new Error(label + field + ' 必填')
  }
  const checks = [['storeFile', '.p12'], ['profile', '.p7b'], ['certpath', '.cer']]
  for (const [field, ext] of checks) {
    const configuredPath = material[field]
    const resolvedPath = path.resolve(projectPath || process.cwd(), configuredPath)
    if (path.extname(configuredPath).toLowerCase() !== ext) throw new Error(label + field + ' 必须是 ' + ext + ' 文件')
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) throw new Error(label + field + ' 文件不存在: ' + configuredPath)
  }
}

function materialFromArgs(args, prefix) {
  const cap = (name) => name[0].toUpperCase() + name.slice(1)
  return Object.fromEntries(MATERIAL_FIELDS.map((field) => [field, args[prefix + cap(field)]]))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function upsertByName(list, value) {
  const index = list.findIndex((item) => item && item.name === value.name)
  if (index < 0) list.push(value)
  else {
    const current = list[index]
    list[index] = Object.assign({}, current, value, {
      material: Object.assign({}, current.material || {}, value.material || {}),
    })
  }
}

function unique(values) {
  return [...new Set(values)]
}

function configureSplitTarget(module, releaseProduct, debugProduct) {
  const targets = Array.isArray(module.targets) ? module.targets : (module.targets = [])
  let releaseTarget = targets.find((target) => target && target.name === releaseProduct)
  if (!releaseTarget) releaseTarget = targets.find((target) => target && Array.isArray(target.applyToProducts) && target.applyToProducts.includes(releaseProduct))
  if (!releaseTarget) releaseTarget = targets[0]
  if (!releaseTarget) {
    releaseTarget = { name: releaseProduct, applyToProducts: [releaseProduct] }
    targets.push(releaseTarget)
  }
  releaseTarget.applyToProducts = unique((releaseTarget.applyToProducts || []).filter((name) => name !== debugProduct).concat(releaseProduct))
  let debugTarget = targets.find((target) => target && target.name === debugProduct)
  if (!debugTarget) {
    debugTarget = clone(releaseTarget)
    debugTarget.name = debugProduct
    targets.push(debugTarget)
  }
  debugTarget.applyToProducts = [debugProduct]
  return '拆分 ' + releaseTarget.name + '/' + debugTarget.name + ' targets'
}

function configureSharedTarget(module, releaseProduct, debugProduct) {
  const targets = Array.isArray(module.targets) ? module.targets : []
  if (targets.some((target) => target && Array.isArray(target.applyToProducts) && target.applyToProducts.includes(debugProduct))) return '已支持两个 products'
  const target = targets.find((item) => item && Array.isArray(item.applyToProducts) && item.applyToProducts.includes(releaseProduct))
  if (!target) return '未找到 release target，保持不变'
  target.applyToProducts = unique(target.applyToProducts.concat(debugProduct))
  return '复用 target ' + target.name + ' 到两个 products'
}

export function buildDualSigningProfile(profile, args) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('build-profile.json5 根节点必须是对象')
  if (!profile.app || typeof profile.app !== 'object') throw new Error('build-profile.json5 缺少 app 对象')
  if (!Array.isArray(profile.app.products) || !profile.app.products.length) throw new Error('build-profile.json5 缺少 app.products')
  if (!Array.isArray(profile.modules) || !profile.modules.length) throw new Error('build-profile.json5 缺少 modules')

  const releaseProduct = args.releaseProduct || 'default'
  const debugProduct = args.debugProduct || 'debug'
  assertSafeName(releaseProduct, 'releaseProduct')
  assertSafeName(debugProduct, 'debugProduct')
  if (releaseProduct === debugProduct) throw new Error('releaseProduct 与 debugProduct 不能相同')

  const releaseMaterial = materialFromArgs(args, 'release')
  const debugMaterial = materialFromArgs(args, 'debug')
  assertMaterial(releaseMaterial, 'release', args.projectPath)
  assertMaterial(debugMaterial, 'debug', args.projectPath)
  assertSafeName(releaseMaterial.keyAlias, 'releaseKeyAlias')
  assertSafeName(debugMaterial.keyAlias, 'debugKeyAlias')

  const next = clone(profile)
  const signingConfigs = Array.isArray(next.app.signingConfigs) ? next.app.signingConfigs : (next.app.signingConfigs = [])
  upsertByName(signingConfigs, { name: releaseProduct, type: 'HarmonyOS', material: Object.assign({}, releaseMaterial, { signAlg: 'SHA256withECDSA' }) })
  upsertByName(signingConfigs, { name: debugProduct, type: 'HarmonyOS', material: Object.assign({}, debugMaterial, { signAlg: 'SHA256withECDSA' }) })

  const products = next.app.products
  const release = products.find((product) => product && product.name === releaseProduct)
  if (!release) throw new Error('app.products 中未找到 release product: ' + releaseProduct)
  release.signingConfig = releaseProduct
  let debug = products.find((product) => product && product.name === debugProduct)
  if (!debug) {
    debug = clone(release)
    debug.name = debugProduct
    products.push(debug)
  }
  debug.signingConfig = debugProduct

  const requested = Array.isArray(args.modules) ? unique(args.modules.map(String)) : []
  for (const name of requested) assertSafeName(name, 'modules 中的模块名')
  const known = new Set(next.modules.map((module) => module && module.name).filter(Boolean))
  const missing = requested.filter((name) => !known.has(name))
  if (missing.length) throw new Error('build-profile.json5 中不存在模块: ' + missing.join(', '))
  let splitNames = requested
  if (!splitNames.length) {
    splitNames = next.modules.filter((module) => module && /^entry$/i.test(module.name || '')).map((module) => module.name)
    if (!splitNames.length && next.modules[0] && next.modules[0].name) splitNames = [next.modules[0].name]
  }
  const splitSet = new Set(splitNames)
  const moduleChanges = next.modules.map((module) => ({
    name: module.name || '(unnamed)',
    change: splitSet.has(module.name)
      ? configureSplitTarget(module, releaseProduct, debugProduct)
      : configureSharedTarget(module, releaseProduct, debugProduct),
  }))

  return { profile: next, releaseProduct, debugProduct, splitNames, moduleChanges }
}

function previewText(filePath, plan, applied) {
  const lines = [
    applied ? '双签名配置已写入' : '双签名配置检查通过（尚未写入）',
    '文件：' + filePath,
    '签名配置：' + plan.releaseProduct + '（release） / ' + plan.debugProduct + '（debug）',
    '签名材料：两组 p12/p7b/cer 已校验；密码字段已接收但不会回显',
    'Products：' + plan.releaseProduct + ' -> signingConfig=' + plan.releaseProduct + '；' + plan.debugProduct + ' -> signingConfig=' + plan.debugProduct,
    '模块变更：',
    ...plan.moduleChanges.map((item) => '- ' + item.name + '：' + item.change),
    '格式说明：写入时会将 build-profile.json5 规范化为双引号、2 空格缩进；原文件保存在 build-profile.json5.dsh-backup',
  ]
  if (!applied) lines.push('传 apply=true 才会备份并写入。')
  else lines.push('建议依次执行 dcli__sync_project，再分别验证 debug product 与 release product 构建。')
  return lines.join('\n')
}

export function configureDualSigning(args) {
  const root = path.resolve(args.projectPath || process.cwd())
  const filePath = path.join(root, 'build-profile.json5')
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('未找到 build-profile.json5（' + filePath + '），请传 projectPath 指向工程根')
  let source
  let profile
  try {
    source = fs.readFileSync(filePath, 'utf8')
    profile = parseBuildProfileJson5(source)
  } catch (error) {
    throw new Error('build-profile.json5 解析失败：' + (error && error.message ? error.message : String(error)))
  }
  const plan = buildDualSigningProfile(profile, args)
  if (!args.apply) return { command: 'dcli__configure_dual_signing ' + root, exitCode: 0, stdout: previewText(filePath, plan, false), stderr: '' }

  const rendered = JSON.stringify(plan.profile, null, 2) + '\n'
  const tempPath = filePath + '.dsh-tmp-' + process.pid + '-' + Date.now()
  const backupPath = filePath + '.dsh-backup'
  let originalMoved = false
  try {
    fs.writeFileSync(tempPath, rendered, { encoding: 'utf8', flag: 'wx' })
    parseBuildProfileJson5(fs.readFileSync(tempPath, 'utf8'))
    if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true })
    fs.renameSync(filePath, backupPath)
    originalMoved = true
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }) } catch { /* ignore cleanup failure */ }
    if (originalMoved && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, filePath) } catch { /* preserve original error */ }
    }
    throw new Error('写入 build-profile.json5 失败，原文件未被替换：' + (error && error.message ? error.message : String(error)))
  }
  return { command: 'dcli__configure_dual_signing ' + root, exitCode: 0, stdout: previewText(filePath, plan, true), stderr: '' }
}
