---
name: hmos-ui-verify
description: HarmonyOS UI 功能验证闭环：构建安装到真机/模拟器后，用 dcli__ui_layout 查节点 → dcli__ui_click/swipe/text 操作 → dcli__ui_screenshot 截图 + read_image 看图，逐项验证界面与交互是否符合需求。功能交付的验收阶段使用。
---

# HarmonyOS UI 验证闭环

在功能实现完成、静态检查（`dcli__lsp_check`）清零后，用真实设备验证界面与交互是否符合需求。

本技能用 dcli ui 工具闭环做验证：agent 通过 `dcli__ui_layout` 查节点、`dcli__ui_*` 操作、`dcli__ui_screenshot` 截图 + `read_image` 看图自行判断界面是否符合预期，无需额外服务。

## 1. 标准流程（工具闭环）

```
1. 准备：`dcli__list_devices` 确认设备在线；无设备时 `dcli__list_emulators` + `dcli__emulator_start` 启动模拟器，或提示用户连接真机并授权 HDC
2. 构建安装：`dcli__build_project`（projectPath 传工程根）构建 debug 签名包，`dcli__install_hap` 安装（hapPath 传 debug 产物，bundleName 传应用包名）
3. 启动：`dcli__start_app`（bundleName 传应用包名）启动应用
4. 查结构：`dcli__ui_layout`（format: "json"）看当前屏幕节点树——确认目标控件存在、拿 id/坐标
5. 操作：按测试步骤执行
   - 点击：`dcli__ui_click`（传 id 自动解析中心坐标，或传 x/y）
   - 滚动/翻页：`dcli__ui_swipe`（起点到终点坐标）
   - 输入：`dcli__ui_text`（不传坐标输入到当前聚焦框，或传 x/y）
   - 每步操作后 `dcli__ui_screenshot`（path 存 PNG）→ `read_image` 看图
6. 判断：对照预期逐项核对——界面元素、文案、布局、交互反馈（状态栏、弹窗、动画时序注意等待）
7. 结论：通过 / 不通过
   - 不通过：`dcli__get_device_logs` 查日志定位（崩溃堆栈、报错），修复后重新验证
```

## 2. 测试步骤编写要点

- 每步明确 **操作 + 预期结果**（"点击登录按钮，应跳转首页并显示用户昵称"）。
- 覆盖：正常路径、空输入、错误提示、返回导航、横竖屏/折叠形态（如适用）。
- 一次验证聚焦一个功能点；复杂流程拆多次验证。
- 截图命名带步骤序号（如 step1-login.png），便于回溯。

## 3. 常见问题

| 现象 | 处理 |
|---|---|
| 设备不在线 | `dcli__list_devices` 确认连接/授权；无设备时启动模拟器 |
| 应用未安装 | `dcli__install_hap` 装 debug 签名包；确认 bundleName 正确 |
| layout 拿不到节点 | 确认应用在前台；`--mode full` 或 `--depth` 调整；模拟器/真机 UI 测试服务需正常 |
| 截图与预期不符 | read_image 仔细对比；注意状态栏、弹窗、动画时序，必要时加等待 |
| 行为异常 | `dcli__get_device_logs` 查对应时间日志；检查控件是否被遮挡（弹窗/键盘） |
| 需要长按/双击/拖拽 | CLI 另有 ui doubleclick/longclick/drag/fling/dircfling（低频，可 fallback 手动 CLI） |

## 4. 与静态检查的分工

- 改代码后 → 构建前静态检查（快、无设备依赖）
- 功能完成 → 本技能（运行期行为验证，需要设备/模拟器）
- 两者都通过才算功能交付完成。
