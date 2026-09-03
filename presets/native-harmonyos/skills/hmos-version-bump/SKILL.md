---
name: hmos-version-bump
description: HarmonyOS 工程版本号自增：AppScope/app.json5 的 versionCode（YYMMDD+当日构建序号）与 versionName（补丁位自增）更新、旧号全工程清零、构建装机与 bm dump 验证。用户要求提版本/自增版本号/发版前更新版本号时加载。
---

# HarmonyOS 版本号自增

适用：用户要求「自增版本号」「提版本」「更新 versionCode/versionName」、完成重要特性准备装机/发版前。

## 1. 核心规则

- `AppScope/app.json5` 是版本号**唯一真源**；模块级（module.json5/build-profile.json5）与文档不要维护副本。
- **versionCode** = `YYMMDD` + 两位当日构建序号（如 `26082201` = 26年08月22日第 2 次构建）。
  - 当天首次：序号 `00`；同日再次提版本：末两位 +1；跨天重置为 `00`。
  - 序号按「当日实际装机/发布构建」计数；若工程已上架，先核对 AppGallery 已有号避免冲突，宁大勿小（versionCode 必须单调递增）。
- **versionName** 同步自增**补丁位**：`x.y.z → x.y.z+1`（大/次版本变更遵循工程既有约定，不在本技能范围）。

## 2. 执行步骤（顺序执行，中途勿插入其它改动）

1. **读现状**：读 `AppScope/app.json5` 的当前 versionCode/versionName；用宿主机时间确认「今天」（`pwsh Get-Date`，勿信设备/日志时钟——真机与宿主机时钟可能差数小时）。
2. **计算新号**：按第 1 节规则算 versionCode 与 versionName。
3. **单一修改**：仅编辑 `AppScope/app.json5` 两个字段。
4. **旧号清零**：全工程 grep 旧 versionCode 与旧 versionName（含 AGENTS.md 的版本规则示例、docs/、feature-contracts、.ets/.ts 硬编码），所有引用更新为新值，grep 旧号必须 0 命中。
5. **构建装机**：`dcli__build_project`（真机调试传 product "debug" + modules ["entry@debug"] + buildMode "debug"；发布验证传对应 default/release）→ `dcli__install_hap` 装 **debug 签名包**（entry-debug-signed.hap；default/release 源装真机报 9568322）。
6. **bm dump 验证**：
   ```text
   hdc shell bm dump -n <bundleName> | grep -nE 'versionName|versionCode'
   ```
   确认输出含新 versionCode/versionName（并核 minCompatibleVersionCode 同步）。

## 3. 坑与边界（实测沉淀）

- **bm dump 假字段陷阱**：dump 里 `appQuickFix` 子块的 `"versionCode": 0, "versionName": ""` 是空占位，**不是**真实版本；真实字段在 `applicationInfo` 层（约 150 行附近）与 bundle 外层，直接用 grep 新号确认。
- 真机安装只装 debug 签名包；hdc 全路径在 SDK 工具链目录（如 `sdk/default/openharmony/toolchains/hdc.exe`）。
- 改号后必须完成 build + 装机 + bm dump 三步验证才算闭环；只改号不验证等于没改。
- json5 配置改动不触发 .ets 的 `dcli__lsp_check` 要求，但构建失败要修到 BUILD SUCCESSFUL 为止。
- 同日多次提版本：先 grep 工程内当前号，确认是今天第几次构建后再写序号，不要凭记忆。
