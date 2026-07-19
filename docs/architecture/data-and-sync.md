# 数据与同步

## 文档职责

本文是应用后端、数据模型和同步链路的权威架构说明。它负责 API 写入如何进入领域
服务和 PostgreSQL、外部作业如何编排，以及 PostgreSQL 如何更新私有数据镜像。
系统级关系见[系统架构总览](overview.md)，浏览器缓存和离线队列见
[客户端数据与导航](client-data-and-navigation.md)与[离线流程](offline.md)。

## 后端服务边界

```text
Next.js Route Handler / Cron
  -> 身份、账号白名单或 Cron Secret
  -> Zod 输入校验
  -> 应用命令或查询服务
  -> 通用领域规则 + Tracker 模块规则
  -> PostgreSQL Repository / 外部 Adapter
  -> 聚合 DTO、命令回执或作业状态
```

- Route Handler 只处理 HTTP、身份和输入输出映射，不在页面层拼接业务事务。
- 查询服务按页面返回聚合 DTO，统一解析 Tracker、目标日期和有效计划版本。
- 命令服务负责幂等、基础版本、任务投影、追加事件和 outbox 的原子边界。
- `src/domain` 只包含纯 Schema 与规则；`src/modules` 提供膝关节等模块策略；数据库、
  Provider 和 Secrets 只存在于 `src/server`。
- Cron 和手动操作调用相同的同步服务与幂等规则，不维护第二套业务逻辑。

当前服务端实现仍处于基础切片，目标 API、事务和作业的交付状态以
[项目计划](../project-plan.md)为准。

## 权威数据与镜像

PostgreSQL 是应用运行时的主数据库。每次计划、任务状态或反馈更新先以事务写入
数据库，同时创建 GitHub outbox 任务。后台任务随后通过 GitHub Contents API
只创建或更新目标 JSON 文件，不需要克隆整个笔记或数据仓库。

GitHub 镜像是最终一致的：数据库写入成功即代表用户操作成功；镜像失败会重试，
不会阻塞当天计划和反馈。页面可以显示“待镜像”或“镜像失败”，通常不要求用户
手动处理。

在个人知识体系中，这个独立数据私仓由 `zhengjing_notes` 中的康复追踪入口引用。
获授权的个人 AI 默认先读取笔记中的医疗、恢复和生活上下文，再沿引用读取结构化
镜像；数据私仓不是脱离原始笔记单独解释康复情况的唯一信息源。该引用只负责知识
导航，不进入 PostgreSQL 到 GitHub 的运行时同步链路。

## 主要实体

- `trackers`：追踪项目及开始日期。
- `plan_versions`：不可变计划版本及来源信息。
- `task_instances`：按日期展开的任务与人工确认状态。
- `events`：训练、反馈、完成和决策等追加式事件。
- `external_records`：Garmin 活动、基础睡眠和每日步数。
- `external_record_links`：外部记录与任务的建议/确认关联。
- `plan_change_proposals`：AI 建议、人工决定与应用结果。
- `execution_contexts`：出差、器械受限、微训练和暂停等临时执行条件。
- `evaluation_sessions`：阶段/结项评估草稿、结果和下一阶段决定。
- `ai_analysis_jobs`：AI 请求、重试、模型、校验和完成状态。
- `integration_sync_state`：各外部服务的游标和最近成功/失败时间。
- `integration_credentials`：认证加密后的外部 Session/Token，不保存账号密码。
- `push_subscriptions`：用户主动授权的 Web Push 端点和失效状态。
- `github_sync_outbox`：待镜像文件、重试状态和错误代码。

每份交换数据包含 `schemaVersion`、稳定 UUID、发生时间、记录时间、本地日期和
来源信息。手机提交携带 `idempotencyKey`；Garmin 使用 provider record ID 做
upsert，保证离线重放和重叠窗口同步不会重复。

## 三条同步链路

### 手机到 PostgreSQL

- 在线：提交后立即校验、鉴权并写入数据库。
- 离线：事件以原始 UUID 和 idempotency key 进入 IndexedDB 队列。
- 恢复联网：按创建顺序重放；服务端对已接收事件返回成功，不重复写入。
- Query Cache 在交互后立即更新，但界面区分“本机已记录”和“服务器已同步”。
- iOS 不假设可靠 Background Sync；启动、联网、重新可见、获得焦点和手动同步都
  会触发重放。

### Garmin 到 PostgreSQL

- 每天自动同步一次，也提供“立即同步”。
- 首次范围：计划开始日期到当前时间。
- 后续范围：最近成功时间减两天到当前时间，并且不早于计划开始日期。
- 分页读取并按 provider record ID 幂等 upsert。
- 超过一天没有成功且最近一次失败时，页面显示弱提醒；鉴权失效时要求重新登录。

### PostgreSQL 到 GitHub

- 业务事务内写入 outbox。
- 后台按目标路径更新单个 JSON 文件，成功后标记完成。
- 临时错误指数退避重试；鉴权或权限错误进入可见失败状态。
- 镜像只包含结构化数据，不包含数据库连接、OAuth、Cookie 或 API Key。
- GitHub Contents API 的同一路径更新需要先读取当前 SHA；outbox 对目标路径串行
  处理，遇到 `409` 时重新读取 SHA 后重试，不并发更新或删除同一文件。

### AI 分析

- 反馈和执行记录先独立持久化，再创建分析任务。
- 任务保存基础计划版本、最小输入摘要和配置化模型标识。
- 超时、限流、余额或格式错误保留为可重试状态，不阻塞原始记录。
- 通过校验的输出只创建 Proposal；接受后才在事务中创建计划版本和 outbox。

### 临时执行上下文

- 上下文有开始/结束日期和模块私有选项标识，不复制私人处方到公共 Schema。
- 当天实际训练引用所用上下文，便于区分正常计划、维持方案和暂停。
- 上下文结束不自动推进计划；接续决定需要人工确认，必要时创建新版本。

## 私有数据仓库布局

```text
schemas/v1/
trackers/<tracker-key>/plan-versions/
trackers/<tracker-key>/events/YYYY/MM/
trackers/<tracker-key>/external/<provider>/YYYY/MM/
trackers/<tracker-key>/snapshots/
_meta/
```

公共代码仓库中的 Zod Schema 是开发权威定义。发布数据格式时，将 JSON Schema
快照复制到私有数据仓库；数据文件通过 `schemaVersion` 指向对应版本。

私有仓库的数据使用规则、目录边界和安全要求由
[AK Tracker Data README](https://github.com/AK22AK/ak22ak_tracker-data)维护。
