# AK Tracker

AK Tracker 是一个以手机 PWA 为入口的私人计划、执行与反馈追踪工具。第一
个模块用于膝关节康复；核心模型保持通用，后续可以增加其他个人追踪项目。

本仓库是公开的应用代码仓库，**不保存真实健康数据、医疗记录、私人计划、
API Key、Cookie 或 Token**。运行数据保存在 PostgreSQL，另行镜像到私有数据
仓库。

## 系统边界

- 本仓库：应用代码、匿名 Schema、产品与工程文档。
- `ak22ak_tracker-data`：私有结构化数据镜像，供审计、备份和获授权的 AI 读取。
- `zhengjing_notes`：检查、医嘱、恢复历史和初始计划等原始私人笔记，只作为固定
  来源读取。
- Neon PostgreSQL：应用在线运行时的权威数据库。

完整组件关系、数据归属和端到端运行流程见[系统架构总览](docs/architecture/overview.md)。

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

### 第一次了解项目

1. [产品需求](docs/product-requirements.md)：为什么做、用户怎样使用、第一版范围。
2. [系统架构总览](docs/architecture/overview.md)：前后端、数据库、数据仓库、笔记、
   AI 和 Garmin 怎样协作。
3. [项目计划](docs/project-plan.md)：当前完成到哪里、下一步和发布门禁。
4. [产品与 UI/UX 设计系统](docs/design/product-and-visual-system.md)：界面与交互规范。

### 参与设计与开发

- [技术选型](docs/architecture/technology-selection.md)
- [客户端数据与导航](docs/architecture/client-data-and-navigation.md)
- [数据与同步](docs/architecture/data-and-sync.md)
- [离线流程](docs/architecture/offline.md)
- [AI 计划调整](docs/architecture/ai-plan-adjustment.md)
- [安全与隐私](docs/security.md)
- [核心场景测试与发布保障](docs/testing/core-scenarios.md)
- [架构决策记录](docs/adr/README.md)

### 部署和外部集成

- [部署与运行](docs/operations/deployment.md)
- [Garmin 集成](docs/operations/garmin.md)

同一事实只由一类文档维护：产品文档定义需求，架构文档定义系统边界，项目计划
记录进度，ADR 记录重要决策原因，Runbook 记录可执行的运维步骤。

## 许可

仓库当前是 source-available 的公开项目，尚未附加开源许可证。选择许可证前，
默认版权仍归仓库所有者所有。
