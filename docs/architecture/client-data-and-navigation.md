# 客户端数据与导航

## 文档职责

本文是手机 PWA 前端架构的权威说明，负责 App Shell、页面导航、客户端状态、查询
缓存、局部加载和浏览器持久化边界。系统全景见[系统架构总览](overview.md)，服务端
写入与同步见[数据与同步](data-and-sync.md)，离线重放细节见[离线流程](offline.md)。

## 背景

当前页面把日期选择和顶层导航直接绑定到动态 Server Component。一次日期点击会
重新执行身份校验、当天查询和整月查询，服务器返回前页面没有可提交的新状态。
这不是浏览器主线程被数据库阻塞，而是界面提交被服务端结果延后。

生产测量确认动态路由和数据库往返会让日期与 Tab 出现可感知等待。具体决策背景和
结果记录在
[ADR-0004：客户端应用壳与服务端状态缓存](../adr/0004-client-app-shell-and-server-state-cache.md)。
即使以后缩短网络时间，交互仍不应依赖这次往返。

## 决策

应用采用 **App Shell + 客户端服务端状态缓存 + 后台同步**：

```text
React 本地交互状态
  -> TanStack Query 内存缓存
  -> Next.js API 聚合层
  -> Neon PostgreSQL

Dexie / IndexedDB
  <-> 最近读取数据、待同步写入和查询缓存快照
```

- `今日 / 日历 / 趋势 / 设置` 位于受保护的共享 Layout。Layout 在顶层导航时
  保持挂载，底部 Tab、网络状态和查询缓存不随页面重建。
- TanStack Query 管理远端数据的读取、去重、取消、后台刷新和精确失效。
- Dexie 管理需要跨重启保留的私人缓存和离线写入；Query Cache 本身不是权威
  数据库。
- Server Component 可以为首次打开预取并脱水必要查询，但不得让每次本地交互
  都重新执行整页服务器渲染。
- Service Worker 只缓存应用外壳和静态资源，不缓存已认证 API 响应。

Next.js 官方 Layout 在导航时保持状态和交互；原生 `history.pushState()` 与
`history.replaceState()` 可以同步 URL 而不重新加载页面。TanStack Query 支持
Next.js App Router 水合、后台刷新、乐观更新和查询失效。

## 查询边界

第一版使用以下稳定 Query Key；过期时间是起始值，真实使用后再调：

| Query Key                         | 内容                        | 初始 `staleTime`   |
| --------------------------------- | --------------------------- | ------------------ |
| `['tracker', key]`                | 名称、开始日、当前状态      | 30 分钟            |
| `['safety-policy', key, version]` | 已鉴权的不可变安全策略      | 无限，版本变更失效 |
| `['plan', key, version]`          | 不可变计划版本              | 无限，版本变更失效 |
| `['today', key, localDate]`       | 今日聚合与完整有效安全策略  | 1 分钟             |
| `['calendar', key, month]`        | 当月任务和反馈摘要          | 5 分钟             |
| `['day', key, localDate]`         | 某日任务、实际记录和反馈    | 1 分钟             |
| `['integrations', key]`           | Garmin、GitHub、AI 同步状态 | 1 分钟             |
| `['proposals', key, status]`      | 计划调整建议                | 1 分钟             |

日历不下载整月所有详情。月查询只返回每一天的计数、状态和标记；某日详情按日期读取，
读取后留在缓存中。相邻日期或存在任务的日期可以在浏览器空闲时预取。

### P0b 数据契约

P0b 已在建立页面 Query 前定义经过鉴权的聚合 DTO。今日 DTO 同时返回 Tracker
摘要、目标日期的有效计划引用、任务/反馈，以及版本化 `TrackerSafetyPolicy`。策略对象
包含 `policyId`、`version`、`effectiveFrom`、`hash` 和通用 `rules`，但公共源码、夹具
和测试不得包含真实规则值。

客户端把策略按不可变版本单独写入 Query Cache，使用与服务端相同的通用规则执行器
提供即时提示。服务端仍做权威重算；DTO 或请求中的版本/hash 只用于缓存一致性和审计，
不能成为客户端绕过安全规则的授权凭据。该契约通过匿名策略夹具完成 Schema 与执行器
测试，真实策略只从私人数据域进入运行时。

## 交互规则

### 日期选择

1. 点击后同步更新 `selectedDate` 和高亮，目标小于 100 ms。
2. 使用 `history.replaceState()` 同步 `?date=`，不触发 RSC 导航。
3. 命中缓存时立即显示旧数据，并在后台刷新。
4. 未命中时只给详情区显示骨架；月历和底部导航继续可操作。
5. 快速连续选择日期时取消已经无用的请求，迟到响应不能覆盖新日期。

### 顶层 Tab

- 共享 Layout 永远保留底部导航。
- Tab 路由使用客户端导航并预取页面代码；页面数据来自 Query Cache。
- 未加载页面先显示稳定的页面框架，再独立加载内容。
- 每个 Tab 保留自己的滚动位置和临时状态；退出登录时清空全部用户状态。

### 写入

训练、反馈和关联操作采用“本地已记录”和“服务器已同步”两个状态：

1. 本地生成 UUID 与 idempotency key，立即写入 Dexie。
2. 立刻更新相关日期和月摘要缓存，显示“待同步”，而不是虚假显示“已保存到
   云端”。
3. 在线时提交 API；成功后以服务器响应替换缓存并移除本地队列项。
4. 失败时保留本地记录、错误代码和重试入口。
5. 相关写入只失效精确 Query，例如一天的任务变更只更新该日和对应月份。

## API 聚合

页面不直接拼接多组数据库调用。目标 API 边界为：

```text
GET  /api/trackers/:key/today?date=
GET  /api/trackers/:key/calendar?month=
GET  /api/trackers/:key/days/:date
GET  /api/trackers/:key/integrations
POST /api/events
PATCH /api/tasks/:id
```

`today` 聚合响应负责下发目标日期对应的安全策略版本；后续日详情可以只返回策略引用，
由 Query Cache 按 `trackerKey + version` 复用不可变策略。

数据访问层先一次取得 tracker 和当前计划上下文，再并行或合并读取任务与事件。
同一个请求不能像当前实现一样重复查询 tracker 和计划版本。数据库索引、SQL
数量和 Vercel/Neon 区域需要在生产追踪中单独测量。

## iOS PWA 离线限制

不能把 Background Sync 当成可靠前提；它并未在所有主流浏览器中普遍可用。
队列重放至少在以下时机触发：应用启动、`online`、页面重新可见、窗口获得焦点、
用户点击“立即同步”。应用关闭时可能不会自动上传，界面必须如实显示本地待同步
数量。

## 性能验收

- 点击日期或 Tab 后 100 ms 内出现新的选中状态或页面框架。
- 已缓存页面不等待网络即可查看。
- 未缓存数据只阻塞自己的内容区，不阻塞导航和其他控件。
- 同月份切换日期不重新获取月摘要。
- 快速切换日期不会出现旧响应覆盖新选择。
- 离线、慢速网络和服务器错误均有可重复的组件测试与真机验证。

## 参考

- [Next.js Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages)
- [Next.js Native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api)
- [TanStack Query Advanced Server Rendering](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr)
- [TanStack Query Optimistic Updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates)
- [MDN Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [web.dev Offline data](https://web.dev/learn/pwa/offline-data)
