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
- 当前 Drizzle `neon-http` 连接不提供交互式 `db.transaction()`；能够预先构造的原子
  命令使用 `database.batch([...])`，由 Neon HTTP 执行单次非交互事务。若未来业务
  必须在事务内根据前一条查询结果继续分支，再切换到支持交互事务的服务端连接，
  不能把多次普通 HTTP 查询伪装成事务。

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
- `tracker_safety_policies`：不可变、可审计的 Tracker 私人安全策略版本。
- `plan_versions`：不可变计划版本及来源信息。
- `task_instances`：按日期展开的任务与人工确认状态。
- `events`：训练、反馈、完成和决策等追加式事件。
- `external_records`：Garmin 活动与基础睡眠、训记力量训练明细及来源版本。
- `external_record_links`：外部记录与任务的建议/确认关联。
- `plan_change_proposals`：AI 建议、上下文/模型审计、人工决定与应用结果。
- `plan_change_decisions`：每条建议唯一的人工接受或拒绝决定、决定时上下文 revision
  与可选的新计划版本引用。
- `plan_version_rollbacks`：撤销已应用 AI 版本时创建的新版本引用；源 applied plan
  唯一，原 Proposal、接受决定和旧计划保持不可变。
- `execution_contexts`：出差、器械受限、微训练和暂停等临时执行条件。
- `execution_alternative_versions`：由私人数据域导入的不可变备选方案版本；公共仓库
  只定义 Schema，不保存具体动作和剂量。
- `execution_day_decisions`：某个上下文内按计划日期保存的时间、场地、器械、健康
  状态和人工方案选择。
- `resumption_assessments` / `resumption_decisions`：结束临时上下文或暂停后的不可变
  接续快照、人工决定和计划时间线并发边界。
- `evaluation_sessions`：阶段/结项评估草稿、结果和下一阶段决定。
- `ai_analysis_jobs`：AI 请求、稳定命令、上下文 hash/范围、重试、模型、校验和完成
  状态；不保存提示词全文或模型原始响应。
- `integration_sync_state`：各外部服务的整体游标和最近成功/失败时间。
- `integration_date_sync_state`：按 Tracker、Provider 和日期保存同步结果、短期缓存、
  内容集合 hash 与错误状态。
- `integration_credentials`：认证加密后的外部 Session/Token/API Key，不保存账号密码，
  也不向客户端回传原值。
- `push_subscriptions`：用户主动授权的 Web Push 端点和失效状态。
- `github_sync_outbox`：待镜像文件、重试状态和错误代码。

每份交换数据包含 `schemaVersion`、稳定 UUID、发生时间、记录时间、本地日期和
来源信息。手机提交携带 `idempotencyKey`；Garmin 和训记使用
`provider + providerRecordId` 做 upsert，并保存规范化内容 hash，保证离线重放和
重叠窗口同步不会重复，也能识别来源内容更新。

Tracker 保存 `planningTimeZone`。事件的 `localDate` 按该时区派生，同时保存
`occurredAt`、`recordedAt`、`occurredTimeZone` 和 `occurredUtcOffsetMinutes`，以便
出差时既保持计划日期稳定，又保留事件实际发生地的时间语义。

### 临时执行上下文

出差或器械受限使用有日期范围的 `execution_contexts`，不会创建计划版本。开放范围
通过 PostgreSQL 日期范围排斥约束防止重叠；日期自然结束不要求依赖后台作业。当天
条件与方案选择写入 `execution_day_decisions`，并在同一个 Neon HTTP batch 中追加
事件和 GitHub outbox。客户端命令 ID 保证重试幂等；不同日期可以选择不同方案。

私人备选方案以稳定 ID 和不可变版本从私有数据仓库受控导入 PostgreSQL。鉴权聚合
DTO 只白名单返回当前日期可用的显示字段，命令同时保存方案 ID 和版本，不能把私人
处方写入公共代码或测试。人工选择不修改 `plan_versions`、`task_instances.status`，
也不等同于任务完成。

当天已有红灯反馈，或使用者把健康状态记录为生病/急性症状时，服务端拒绝普通方案
选择；界面进入停止和重新评估提示。该判断不依赖 AI 或外部 Provider。

结束上下文或暂停时，接续评估同时冻结目标日期的有效基础版本和创建时版本号最高的
计划时间线头。确认前若时间线头变化，旧评估必须过期并基于新时间线重建；若创建时
已经排有更晚生效的版本，首版只允许保留原计划，不能生成可能被后续版本覆盖的顺延
版本。旧快照若缺少时间线头，读取时按保守兼容策略禁用顺延，不据此推断安全可用。

## 版本化安全策略

个性化阈值不是凭证，也不是永久部署配置，而是需要版本、审计、镜像和离线读取的
私人领域数据。P0b 已将过渡环境配置迁移到 PostgreSQL 的不可变
`TrackerSafetyPolicy` 版本；后续不能通过部署环境变量静默修改策略。

公共仓库只定义通用 Schema 与规则执行器，不包含任何真实阈值。经过鉴权的聚合 DTO
可以向当前使用者返回某一策略版本的私人规则值：

```text
TrackerSafetyPolicy
  policyId       稳定 UUID
  trackerKey     Tracker 标识
  version        单调递增版本
  effectiveFrom  生效日期/时间
  hash           规范化策略文档的 SHA-256
  rules          通过通用 Schema 校验的规则参数
```

- PostgreSQL 是策略版本的在线权威来源；私有数据仓库镜像完整版本供审计和其他获
  授权的 AI 读取。
- 服务端按事件发生时间解析有效策略并进行权威评估；客户端使用同一通用执行器和已
  鉴权下发的版本做即时提示，但不能自行修改规则或取代服务端判定。
- 客户端提交它看到的 `policy version/hash`；服务端不信任该值，只用它发现缓存过期，
  并在响应中要求刷新。
- 反馈事件保存服务端实际使用的 `policyId/version/hash` 和判定结果，使历史解释不受
  后续阈值修改影响。
- P2 只把明确列入私人 IndexedDB 白名单的策略版本持久化；localStorage、Service
  Worker Cache 和公共静态资源均不得保存策略内容。

## 外部训练数据融合

外部记录和任务执行是两个不同层次：`external_records` 保存来源事实，
`external_record_links` 保存建议、人工确认、取消和需要复核等关系状态。同步不能
直接修改 `task_instances` 的完成状态。

| 数据类别                   | 首选来源 | 归一化用途                         |
| -------------------------- | -------- | ---------------------------------- |
| 活动时间、时长、距离、配速 | Garmin   | 证明活动发生并估计有氧负荷         |
| 心率和基础睡眠             | Garmin   | 作为恢复背景，不做医学因果判断     |
| 力量动作、重量、组次、次数 | 训记     | 形成康复任务的实际力量训练明细     |
| RPE、组间休息和训练备注    | 训记     | 补充执行强度和主观训练上下文       |
| 疼痛、肿胀、僵硬和异常症状 | 用户反馈 | 执行确定性安全规则并追加症状时间线 |

匹配服务可以把一条 Garmin 活动和一条训记训练同时建议关联到同一任务。人工确认时保存
关联来源、所采用的来源版本和决定时间；若后续同步发现内容 hash 改变，保留新来源版本
并把关联标记为“需要复核”，不得静默覆盖确认时的实际执行快照。

## 同步链路

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

### 训记到 PostgreSQL

- 服务端只调用 `https://trains.xunjiapp.cn` 的训练读取接口
  `POST /api_trains_for_llm_v2`。凭证只放在 `Authorization: Bearer` 请求头，不进入
  query、body 或日志。请求使用 `schema_version: train_open_api_v2`、目标 `datestr`
  和 `include_full_data: true`，从 `res.trains` 取得动作、训练组、重量、次数、RPE、
  备注和完整训练时长；不调用写回、饮食、身体数据或官方计划接口。
- 首次同步范围为 Tracker 计划开始日期至今天。后续从最近成功日期向前保留一个小的
  重叠窗口再同步到今天，以捕获训记中对近期训练的修改；范围不能早于计划开始日期。
- 训记没有增量游标，`integration_date_sync_state` 按日期保存成功、失败和内容 hash；
  `integration_sync_state` 只保留 Provider 整体最近状态。
  应用打开、每日作业和“立即同步”共用同一服务，遵守同一用户同一日期完整读取至少
  间隔 30 秒的限制，短时间内重复操作复用缓存结果。
- 使用 `localid` 等稳定记录 ID 幂等 upsert；无法取得稳定 ID 的异常记录使用受控的
  日期与内容指纹，并标记需要人工检查，不能仅凭标题合并。
- 训记 API Key 由已登录使用者在设置页录入，服务端验证只读调用后使用认证加密保存；
  Adapter 能力面只暴露读取，即使 Provider Key 本身还具有写权限也不调用写接口。
- 超过一天没有成功且最近一次失败时显示弱提醒；认证失败要求更新 Key，不影响
  Garmin、任务、反馈或手工兜底记录。

### PostgreSQL 到 GitHub

- 业务事务内写入 outbox。
- 数据库提交成功后，通过 Vercel/Next.js 的响应后任务能力尽力立即消费一个小批次；
  这一步失败或超时不改变用户操作已经成功的结果。
- 打开应用、手动“立即同步”和每日 Cron 都会再次领取到期任务；Cron 是兜底修复，
  不是唯一消费者，也不依赖平台替失败调用自动重试。
- 消费者按目标路径更新单个 JSON 文件，成功后标记完成。
- 临时错误指数退避重试；鉴权或权限错误进入可见失败状态。
- 镜像只包含结构化数据，不包含数据库连接、OAuth、Cookie 或 API Key。
- GitHub Contents API 的同一路径更新需要先读取当前 SHA；outbox 对目标路径串行
  处理，遇到 `409` 时重新读取 SHA 后重试，不并发更新或删除同一文件。
- 正常在线场景以五分钟内完成镜像为运行目标；超过 24 小时没有成功镜像时显示弱
  提醒，权限失效或不可恢复错误立即显示需要处理状态。

### AI 分析

- 反馈和执行记录先独立持久化，再创建分析任务。
- 任务保存基础计划版本、最小输入摘要和配置化模型标识。
- 超时、限流、余额或格式错误保留为可重试状态，不阻塞原始记录。
- 通过校验的输出只创建 Proposal；接受后才在事务中创建计划版本和 outbox。
- 人工决定使用稳定命令；数据库同时锁定 Tracker/Proposal 并核对上下文 revision，
  再原子写入决定、Proposal 状态、可选的新计划与未来任务、事件和 outbox。不同命令
  并发决定同一 Proposal 时只有一条唯一决定能够提交。
- 撤销只针对仍是时间线头的已应用 AI 版本。数据库从原决定的基础计划快照创建下一
  计划日生效的新版本，并原子写入回滚投影、未来任务、专用事件和 outbox；不改写原
  决定、旧版本或历史任务。

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
