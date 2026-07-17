# AK Tracker

AK Tracker 是一个以手机 PWA 为入口的私人计划、执行与反馈追踪工具。第一
个模块用于膝关节康复；核心模型保持通用，后续可以增加其他个人追踪项目。

本仓库是公开的应用代码仓库，**不保存真实健康数据、医疗记录、私人计划、
API Key、Cookie 或 Token**。运行数据保存在 PostgreSQL，另行镜像到私有数据
仓库。

## 当前能力

- Next.js 16 App Router 全栈 PWA
- Neon PostgreSQL + Drizzle 数据模型
- 私有计划版本导入与按日期读取
- 今日任务勾选、跳过、逐项实际训练数据和主观感受
- 月历查看未来计划、历史完成状态和症状反馈
- 每日症状反馈与红黄绿安全分级
- IndexedDB 离线队列与计划缓存边界（待接入页面）
- Garmin、DeepSeek 和 GitHub 镜像适配器边界
- 受约束、需人工确认的计划变更模型
- 数据 Schema、核心同步规则与单元测试

生产环境已完成私人登录、数据库和第一份计划接入。Garmin、GitHub 数据镜像、
AI 调整建议和完整离线写入仍在后续阶段。

## 本地开发

要求 Node.js 20+ 与 pnpm。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

常用检查：

```bash
pnpm check
pnpm build
```

数据库迁移需要先配置 `DATABASE_URL`：

```bash
pnpm db:generate
pnpm db:migrate
```

导入私有计划版本：

```bash
pnpm plan:import /absolute/path/to/plan-version.json
```

## 文档

- [产品范围](docs/product-requirements.md)
- [系统架构](docs/architecture/overview.md)
- [数据与同步](docs/architecture/data-and-sync.md)
- [离线流程](docs/architecture/offline.md)
- [AI 计划调整](docs/architecture/ai-plan-adjustment.md)
- [安全与隐私](docs/security.md)
- [部署与运行](docs/operations/deployment.md)
- [Garmin 集成](docs/operations/garmin.md)
- [架构决策记录](docs/adr/README.md)

## 许可

仓库当前是 source-available 的公开项目，尚未附加开源许可证。选择许可证前，
默认版权仍归仓库所有者所有。
