# 部署与运行

## 服务选择

- Vercel Hobby：Next.js 页面、API 和每日 Cron。
- Neon：托管 PostgreSQL，与 Vercel 独立连接。
- GitHub 私有仓库：结构化数据镜像。
- DeepSeek：OpenAI-compatible API，按使用量计费。

第一版使用 Vercel 提供的 HTTPS `*.vercel.app` 域名即可。以后可以给 Vercel
绑定现有域名的子域名；GitHub Pages 的静态站点不能直接承载本项目的服务端 API，
但同一主域名可以通过不同子域名分别指向 GitHub Pages 和 Vercel。

免费套餐适合个人第一版，但需要关注 Neon 休眠/容量、Vercel Function 与 Cron
限制以及外部 API 用量。运行时数据不依赖 Vercel 本地文件系统。

## 部署步骤

1. 在 Neon 创建数据库并设置 `DATABASE_URL`。
2. 生成并执行 Drizzle migration。
3. 在 GitHub 创建 OAuth App，主页指向正式 Vercel 域名，回调地址使用
   `/api/auth/callback/github`；同时配置 `NEXTAUTH_URL`、`AUTH_SECRET` 和
   `ALLOWED_GITHUB_LOGIN`。
4. 在 Vercel 导入公共代码仓库并配置 `.env.example` 中的服务端变量。
5. 为私有数据仓库创建最小权限 token。
6. 配置每日 Garmin 同步和 GitHub outbox Cron；Cron 路由验证 Bearer
   `CRON_SECRET`。
7. 部署后验证 `/api/health`、未授权访问、登录白名单和 PWA 主屏安装。
8. 选择计划开始日期，按固定提交版本导入当前计划。

## 监控与恢复

- 数据库是恢复在线业务的首要来源，私有 GitHub 镜像提供第二份可读历史。
- Garmin、DeepSeek、GitHub 三类失败分别记录，不让一个集成拖垮今日页面。
- Garmin 超过一天未成功且最近尝试失败时显示弱提醒；认证错误升级为重新授权。
- GitHub outbox 监控待处理数量、最老任务年龄和最近权限错误。
- AI 任务失败保留原始反馈，允许稍后重试。
- 每次 Schema 变更先迁移数据库，再更新私有仓库 Schema 快照。

## 当前部署状态

- Vercel 正式地址：`https://ak22ak-tracker.vercel.app`。
- Neon `ak22ak-tracker` 项目已创建，首个 Drizzle migration 已执行；
  `DATABASE_URL` 只保存在 Vercel 的敏感环境变量中。
- GitHub OAuth App、`AUTH_SECRET`、`NEXTAUTH_URL` 与 `AK22AK` 账号白名单均已
  配置；未登录访问会跳转到登录页，生产环境首次登录已验证。
- Garmin、DeepSeek 和 GitHub 私有数据镜像凭证尚未配置。
- Vercel 与 GitHub 的自动部署集成尚未连接，目前由受信任的本地环境手动部署。
