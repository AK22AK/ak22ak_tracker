# UI-R3b 设置详情与根 Tab 导航竞态

状态：代码与匿名 production-build 门禁完成，待项目经理独立生产复核。

## 现象与根因

设置详情由 Next App Router/RSC 导航，根 Tab 原先只调用 `history.pushState` 并切换持久
Tab Host。详情导航稳定后路径通常正确；但在详情 pathname/children 准备提交、共享壳仍持有
上一帧 pathname 的窗口里，后点的根 Tab 没有参加 App Router 的 transition 仲裁。迟到详情
因此可能覆盖最后一次点击，或把 `/settings/garmin` 一类详情 URL 误存成设置根 Tab 的回退地址，
造成 URL、`aria-current` 与可见面板不一致。

纯粹冻结详情网络响应不会稳定触发旧缺陷，因为 Next 会丢弃明显过期的未提交响应。确定性 RED
进一步固定“详情 URL/路由状态已前进、共享壳仍是上一帧”的提交窗口；旧实现返回设置时同时
存在 14 个 `.settings-row`，证明持久 Host 与迟到 children 已经分叉。

## 修复

1. 根壳在捕获阶段记录内部非根 Link 导航；从已加载详情、pending 详情或未完成的根逃逸意图
   点击根 Tab 时，建立单调递增的根导航代次。
2. URL、`aria-current`、持久 Host 可见面板在同一用户事件中同步。详情尚未写 URL 时由最新
   代次独占 History；详情已加载或进入 commit 时只发起一次 App Router `push`。两种 transport
   不叠加，避免共享壳收到交叉的 pathname 与 children，同时保留正确 history tree。
3. 新根意图提交完成前，迟到的 pathname/children 不得隐藏持久 Host；只有 pathname 与完整
   目标 URL 都命中最新代次时才清除意图。
4. 根 Tab 之间继续走既有快速 History 路径；设置根 URL 不接收详情 URL。日历日期 query、
   持久 DOM、草稿、滚动和 back/forward 行为保持不变。

## RED / GREEN 门禁

- 组件门禁固定 pending、loaded、迟到 pathname/children 和快速连续点击；20 次根 Tab 意图后
  只允许最后一次成为可见面板及 `aria-current`。
- production-build Playwright 冻结 Garmin、历史数据补录、DeepSeek、账号详情的真实 RSC
  请求，分别在 320/375/390/430px 与 0/20/60/120ms 窗口点击今日、日历或趋势。
- 每条路径都冻结真实详情 RSC 请求，并在释放旧详情响应前后保持 URL、`aria-current`、可见
  面板一致；可见设置详情数量必须为 0。随后再次进入设置必须恢复唯一的 7 行根列表，
  不能把前一个根面板误装入设置 Tab。
- DeepSeek 详情加载失败时同样覆盖根 Tab 逃逸；既有详情返回、browser back/forward、日历
  query 与持久 Tab 测试继续通过；浏览器 history 恢复根 URL 时，即使 Next children 暂时仍是
  详情，根壳也以浏览器位置恢复对应持久 Tab。

本返修不改变 DB、Schema、Provider、计划、安全、离线命令或 P5b 领域语义。
