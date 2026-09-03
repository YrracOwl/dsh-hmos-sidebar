---
name: hmos-debug-logs
description: HarmonyOS 调试与日志：hilog 日志分级与过滤、hdc 设备命令、dcli__get_device_logs 抓取、崩溃与卡顿分析、常用性能工具。排查运行期问题时加载本技能。
---

# HarmonyOS 调试与日志

## 1. 日志体系（hilog）

- 级别：`DEBUG < INFO < WARN < ERROR < FATAL`；命令行与日志文件用 `D/I/W/E/F` 表示。
- ArkTS 打印：`hilog.info(0x0000, 'TAG', 'message %{public}s', value)`——敏感信息用 `%{private}s`。
- 过滤：`hdc shell hilog -T <TAG>` 按标签过滤；`-e <regex>` 按内容；`-l E` 只看 ERROR 及以上。

## 2. 设备与日志命令

```text
dcli__list_devices                    # 查看连接设备（含模拟器）
dcli__get_device_logs                 # 按设备/包名/级别/关键词抓取日志
dcli__run_app                         # 构建、安装并启动应用
hdc shell hilog -T MyApp -l I              # 高级过滤；先核对 hdc --help
```

崩溃定位流程：
1. 用 `dcli__get_device_logs` 抓日志，按 `FATAL` / `ERROR`、应用包名或标签过滤堆栈。
2. 堆栈中的 `ArkTS` 异常行号对应 `src/main/ets` 源码位置。
3. 常见原因：空对象解引用、资源 id 不存在、权限未授予、UI 线程阻塞。

## 3. 运行期排查

- **应用未启动/闪退**：检查签名、`module.json5` 的 `abilities` 配置、入口 `pages` 是否存在、日志中的 `Failed to start ability`。
- **页面白屏**：看 WARN 级 `ArkTS` 异常与资源加载错误；确认 `main_pages.json` 路由注册。
- **卡顿/掉帧**：`hdc shell hilog -T ArkUI -l I` 观察帧统计；检查主线程是否做了耗时 IO/计算。
- **网络问题**：日志中的网络错误码（如 201/401 为请求失败、DNS 失败），确认权限 `ohos.permission.INTERNET` 已声明。

## 4. 性能工具（概览）

- **SmartPerf Host / `hdc shell` 下的 perf 类命令**：分析 CPU/内存热点（具体以官方工具文档为准）。
- `hdc shell dumpsys meminfo <包名>`：内存占用。
- 布局性能：避免深层嵌套与过度刷新，用 `LazyForEach` 处理长列表。

## 5. 检查清单

- 日志必须包含明确 TAG，便于 `-T` 过滤；隐私数据用 `%{private}s`。
- 修改代码后用 `dcli__run_app` 重新安装验证，再用 `dcli__get_device_logs` 抓取新日志对比。
- 排查结论要有日志证据，不猜测；关键堆栈截图/片段保留到会话要点。
