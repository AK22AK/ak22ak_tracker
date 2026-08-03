# UI-R3b iOS 主屏 PWA 首帧诊断

状态：阻塞，尚未修复。普通桌面 Chromium 移动视口只作为回归，不再作为 iOS standalone 放行证据。

## 真机截图失败基线

两张首页截图分别来自 2026-08-03 12:49 与 13:39，原始画布均为 1179 × 2556 px。后者同时显示了新版本的计划起点文案；同期 Garmin 截图显示了新按钮样式，因此不能用旧缓存解释失败。

- 两张首页截图的底部 1179 × 656 px 区域逐像素一致。
- 底栏最后一个可见控件像素位于 y = 2276，距画布底部 280 px。
- 按 393 × 852、DPR 3 的截图边界推算，可见控件下方空带为 93.3 CSS px。
- 底栏背景与页面背景同色，截图本身无法精确定位 nav 盒模型底边；上述 280 px 是“最后可见底栏控件到物理画布底部”的可复核视觉距离，不用 DOM rect 冒充该距离。

## 可证伪假设

| 优先级 | 假设                                                                                                               | 成立时的观测                                                                                                           | 排除条件                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1      | standalone 首帧/稳定帧的 layout viewport、visual viewport 与 `100dvh` / `100svh` 不一致                            | shell/nav 贴合某个 CSS viewport，但 `screen.height` 或真实截图画布仍更高；单位探针或 visual viewport 在启动/滚动后变化 | 四类高度从首帧起一致，且 shell/nav 的视觉底边与截图底边一致 |
| 2      | startup fallback 到 protected shell 时，高度所有权从普通文档流切到 `html/body height: 100%` + shell grid，引发 CLS | visual viewport 基本稳定，但 root/startup/shell/content/nav rect 与 `layout-shift` 在切换点同步变化                    | shell 切换期间各层高度与 rect 稳定且无无输入 CLS            |
| 3      | `black-translucent`、`viewport-fit=cover` 与 standalone 状态栏映射共同触发差异                                     | 仅 standalone 命中；浏览器模式不命中；screen、outer、inner、visual viewport 的差值稳定                                 | 两种 display mode 的首帧指标与截图均一致                    |
| 4      | safe area 被重复计入                                                                                               | nav、body 或 shell 的 computed padding 中出现两次底部 inset，空带接近 inset 的整数倍                                   | `safeAreaInsetBottom` 只在 nav 内出现一次，其他容器为 0     |
| 5      | 字体、CSS 或 RSC 流式内容造成整体布局上移                                                                          | viewport 单位不变，但 fonts 状态、DOM 切换和无输入 CLS 同步                                                            | 字体与内容切换不改变 root/shell/nav rect                    |

## 真机匿名反馈环

设置 → 账号新增“iOS 布局诊断”。主屏 standalone 在用户未主动停止时自动保留最近一次冷启动样本；普通浏览器默认关闭。数据只写入本机 `localStorage`，不会请求新 API 或自动上传。

采集字段：相对时间戳、display mode、iOS user agent 与屏幕尺寸、`innerHeight`、`documentElement.clientHeight`、visual viewport、`100vh/svh/dvh` 探针、safe-area 探针，以及 document/body/root/startup/shell/content/nav 的 rect 与关键 computed style。另记录不含 DOM 文本的 CLS 值。

不采集：账号 ID、Tracker、健康反馈、训练记录、Provider、Token、API Key、页面正文或输入内容。

真机采集步骤：

1. 在设置 → 账号点击“准备下一次冷启动采集”。
2. 从多任务界面完全关闭 PWA，再从 iOS 主屏打开。
3. 不滚动，等待页面稳定并截图。
4. 轻微滚动一次，等待稳定并再次截图。
5. 回到设置 → 账号，复制或下载匿名诊断 JSON。

拿到 JSON 与两张对应截图前，不修改 shell CSS，也不宣称根因或修复完成。

## iOS 26.5 Simulator standalone 证据

已在 iPhone 17 Pro、iOS 26.5 Simulator 中从主屏冷启动本地受保护 PWA。该链路为真实 WebKit standalone，不是 Safari 标签页或桌面 Chromium。匿名报告确认：

- 环境：`displayMode=standalone`、`navigatorStandalone=true`、screen 402 × 874、DPR 3、`black-translucent`、`viewport-fit=cover`。
- bootstrap（266 ms）：`innerHeight=visualViewport.height=100vh=100svh=100dvh=812`，safe area bottom 为 0。
- DOM ready（323 ms）：startup fallback 与 protected shell 同时处于切换期；shell 还没有可见尺寸。
- load（1284 ms）：shell 812px，content 755px，nav 57px，nav bottom 812px；safe area 仍为 0。
- layout change（1633 ms）：`100vh` 单独变为 874px，`100svh/100dvh` 与 inner/visual viewport 仍为 812px。
- resize（1720 ms）：safe area bottom 从 0 变为 34px；nav 从 57px 增至 85px，nav top 从 755px 上移到 727px；shell 与 nav bottom 仍保持 812px。

这组数据确认了 WebKit standalone 首次启动时，`100vh` 与 safe-area 分阶段初始化；它足以解释用户看到的启动位移。Simulator 稳定后 nav 仍贴合 CSS viewport，未复现真机截图中稳定后的 93.3 CSS px 视觉空带，因此不能把 Simulator 当作最终放行。真机报告需要继续验证：

1. 用户设备是否同样先报告 safe area 0，且未在无滚动时完成 34px 校准；
2. shell/nav DOM bottom 是否等于 inner/visual viewport，但合成后的截图仍留空；
3. 用户设备的 screen、outer、inner 与 visual viewport 差值是否不同于 Simulator 的 874/812。
