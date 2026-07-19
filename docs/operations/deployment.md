# 部署与运行 Runbook

## 文档职责

本文维护 AK Tracker 的部署、配置、验证、监控、恢复和回滚步骤。平台选择原因见
[技术选型](../architecture/technology-selection.md)，当前环境完成度和风险见
[项目计划](../project-plan.md)。

## 生产拓扑

| 服务            | 运行职责                               | 持久化内容                       |
| --------------- | -------------------------------------- | -------------------------------- |
| Vercel          | Next.js 页面、API、静态资源和每日 Cron | 不保存持久业务数据               |
| Neon            | PostgreSQL 主数据库                    | 计划、任务、事件、版本和状态     |
| GitHub OAuth    | 单用户身份登录                         | OAuth 授权关系                   |
| GitHub 数据私仓 | PostgreSQL 的结构化异步镜像            | 版本化 JSON 与 Schema 快照       |
| DeepSeek        | 受约束的计划调整建议                   | 不持有本系统数据写权限           |
| Garmin Provider | 活动、基础睡眠和步数输入               | 由 Adapter 读取后写入 PostgreSQL |
| 训记            | 力量训练动作、组次与重量输入           | 只读 Adapter 写入 PostgreSQL     |

正式地址为 `https://ak22ak-tracker.vercel.app`。Vercel Function 应与 Neon 部署在
同一区域；区域变更必须先以生产追踪确认数据库往返是主要瓶颈，再进行对比和迁移。

## 环境配置

具体变量名以 `.env.example` 为准。生产环境变量只保存在 Vercel Secrets，不进入
GitHub、构建日志、浏览器或数据镜像。

| 类别         | 配置内容                                           |
| ------------ | -------------------------------------------------- |
| 数据库       | Neon `DATABASE_URL`                                |
| 应用身份     | `NEXTAUTH_URL`、`AUTH_SECRET`、`ALLOWED_GITHUB_ID` |
| GitHub OAuth | OAuth Client ID 与 Client Secret                   |
| Tracker 策略 | PostgreSQL 不可变私人策略版本，不进入公共代码      |
| 数据镜像     | 只允许目标私仓 Contents 权限的 fine-grained token  |
| DeepSeek     | Base URL、API Key、模型、超时和最大输出长度        |
| Garmin       | 认证加密密钥及加密后的 Provider Session/Token      |
| 训记         | 数据库中认证加密的 API Key，不使用公开环境变量明文 |
| 凭证加密     | `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY`           |
| 定时任务     | `CRON_SECRET`                                      |

变更 Secret 时同步更新本地示例中的变量名，但不记录真实值。Token 轮换后必须验证旧值
已经失效，并检查对应集成最近一次成功状态。

当前膝关节模块已使用版本化 `TrackerSafetyPolicy`。公共仓库只保留通用 Schema、
规则执行器和受控导入工具；真实规则文档位于私人数据域。新版本必须先执行正式
migration（如需要），再通过 `pnpm safety-policy:import -- <private-policy.json>` 导入，
最后部署读取新表的应用。导入命令只输出策略 ID、版本和 hash，不输出规则值。

## 首次部署

1. 在 Neon 创建数据库，选择与预期 Vercel Function 相同或相近的区域。
2. 配置本地 `DATABASE_URL`，生成并检查 Drizzle migration。
3. 对目标数据库执行 migration，并验证 Schema 与 migration journal。
4. 在 GitHub 创建 OAuth App，主页使用正式域名，回调地址使用
   `/api/auth/callback/github`。
5. 在 Vercel 导入公共代码仓库，配置应用身份、数据库和账号白名单变量。
6. 部署应用，验证健康检查、未授权访问和允许账号登录。
7. 选择 Tracker 开始日期，从原始笔记固定提交导入计划版本。
8. 按需配置 GitHub 数据镜像、Garmin、训记、DeepSeek 和 Cron；每项集成独立启用和
   验证。训记由已登录使用者在设置页录入轮换后的 Key，服务端完成只读验证后加密保存。

外部集成不作为首次登录、查看今日计划、记录训练和提交反馈的前置条件。

## 常规发布

1. 确认[项目计划](../project-plan.md)中的对应里程碑和
   [发布门禁](../testing/core-scenarios.md#发布判定)。
2. 运行静态检查、类型检查、自动化测试和生产构建。
3. 如果包含数据库变更，检查 migration 的前向兼容性、锁影响和回滚策略。
4. 先执行兼容的数据库 migration，再部署能够同时读取旧/新状态的应用版本。
   对安全策略切换，必须在旧版本仍可服务时先完成策略导入并只读验证，禁止先部署会
   因策略缺失而拒绝反馈的新代码。
5. 部署后执行生产冒烟：健康检查、身份门禁、今日读取和本次变更的最小旅程。
6. 观察错误率、数据库延迟和相关集成状态，确认没有新增待处理积压。

Schema 快照的顺序是：公共代码 Schema 与 migration 先完成，数据库升级并验证后，
再更新私有数据仓库中的 JSON Schema 快照。

正式 migration 只能通过 `pnpm db:migrate` 所代表的 Drizzle 迁移入口或等价的受控
运维流程执行。禁止使用“拆分 SQL 后逐条执行”的通用脚本绕过
`drizzle.__drizzle_migrations`。发布验证必须读取 journal 最新记录，将 `created_at`
与 `drizzle/meta/_journal.json` 对应，并用 Drizzle `readMigrationFiles()` 的 SHA-256
结果核对 hash；仅看到列或索引存在不代表迁移账本完整。检查结果不得输出连接串或
任何 Secret。配置目标数据库的 `DATABASE_URL` 后使用 `pnpm db:journal:check` 执行
这一只读校验；不匹配时命令失败，不自动修改账本。

## 定时任务

- Vercel Hobby Cron 最多每日执行一次，且可能在目标小时内漂移。
- Vercel 不会替失败的 Cron 调用自动重试；任务自身必须持久化状态和下次重试时间。
- 适合每日 Garmin/训记同步、GitHub outbox 消费和弱提醒，不用于分钟级精确调度。
- 每个任务验证 `CRON_SECRET`，使用 provider 或任务类型级锁，并持有幂等键。
- Cron 重复触发、超时后重跑和手动同步不能产生重复记录。
- GitHub outbox 由业务写入后的响应后任务、应用启动、手动同步和每日 Cron 共同
  消费；AI 第一版由用户请求内执行一次，失败后保留任务供手动重试。
- 长时间或依赖不兼容运行时的任务可以迁移到独立受控 Worker，但仍通过相同应用
  契约写入 PostgreSQL。

平台限制以 [Vercel Cron 用量与计划](https://vercel.com/docs/cron-jobs/usage-and-pricing)
和 [Cron 管理与失败行为](https://vercel.com/docs/cron-jobs/manage-cron-jobs)为准。

## 监控

### 核心应用

- `/api/health` 可用且不泄露配置、身份或业务统计。
- 登录失败、白名单拒绝、API 401/403 和服务端 5xx。
- 页面/API 延迟与数据库查询延迟分开观察。
- 数据库连接、migration 版本和存储容量。

### 后台与集成

- GitHub outbox：待处理数量、最老任务年龄、最近成功和权限错误。
- Garmin：最近尝试、最近成功、同步游标、认证失效和 429/5xx。
- 训记：最近尝试、最近成功、按日期同步状态、认证失效、限流和来源变更待复核数。
- AI：排队/运行/失败数量、超时、限流、余额和结构校验失败。
- PWA：新版本发布后旧客户端资源错误和关键前端异常。

Vercel Runtime Logs 保留时间有限。需要重试、审计和用户可见的状态必须写入数据库，
不能只存在平台日志。

## 故障处理

| 故障            | 用户侧行为                         | 处理入口                                    |
| --------------- | ---------------------------------- | ------------------------------------------- |
| Neon 不可用     | 展示缓存；新记录保留在本机待同步   | 数据库状态、连接和区域；恢复后幂等重放      |
| GitHub 镜像失败 | 数据库写入仍成功；显示镜像延迟     | outbox 错误、Token 权限、SHA 冲突和重试     |
| Garmin 失效     | 核心流程正常；显示弱提醒或重新授权 | Provider 状态、Token、退避或文件导入        |
| 训记失效        | 保留计划和手工兜底；显示弱提醒     | Key 状态、日期缓存、限流、更新凭证或重试    |
| DeepSeek 失败   | 原始反馈保留；建议任务可稍后重试   | 分析作业错误、限流、余额、超时和 Schema     |
| OAuth 配置错误  | 无法进入受保护页面                 | 回调 URL、应用 Secret、正式域名和账号白名单 |
| PWA 版本不一致  | 提示刷新；保留未同步本机数据       | Service Worker 版本、静态资源和部署 ID      |

任一外部集成故障不采用全屏级联错误，也不清空当前计划、表单或离线队列。

## 恢复与回滚

### 应用版本

1. 判断问题是否涉及数据库 Schema 或只涉及应用代码。
2. 仅应用代码问题可回滚到最近通过冒烟的 Vercel 部署。
3. 已执行 migration 时，不直接回滚到无法理解新 Schema 的旧版本；先发布兼容修复或
   执行经过验证的前向恢复 migration。
4. 回滚后重新执行身份、今日读取和受影响旅程的冒烟测试。

### 数据与镜像

- PostgreSQL 是恢复在线业务的首要来源，优先使用数据库备份和事件历史恢复。
- GitHub 私仓提供可读历史和第二份结构化记录，但不是直接恢复在线查询的数据库。
- GitHub 镜像可以从 PostgreSQL 和当前 Schema 全量重建；派生快照可以删除后重算。
- 恢复演练验证稳定 UUID、幂等键、引用完整性、计划版本顺序和 Schema 版本。

### Secrets

- 疑似泄露时先吊销或轮换对应 Secret，再恢复服务。
- 检查日志、Git 历史和数据仓库是否出现敏感值；必要时清理历史并重新生成凭证。
- Garmin、训记、GitHub、DeepSeek、OAuth 和数据库凭证分别处理，不因为一个集成泄露而
  暴露其他服务权限。

## 相关文档

- [系统架构总览](../architecture/overview.md)
- [项目计划](../project-plan.md)
- [技术选型](../architecture/technology-selection.md)
- [数据与同步](../architecture/data-and-sync.md)
- [安全与隐私](../security.md)
- [核心场景测试与发布保障](../testing/core-scenarios.md)
- [Garmin 集成](garmin.md)
