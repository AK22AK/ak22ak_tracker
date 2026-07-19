# 技术选型总表

## 文档职责

本文维护已经选择的技术、它们在系统中的职责、选择原因和替换边界。具体版本以
`package.json` 和 lockfile 为准，当前未决项和实施状态由[项目计划](../project-plan.md)
维护，重要决策原因由[ADR](../adr/README.md)维护。

## 目标与约束

AK Tracker 第一版是单用户、手机优先的私人追踪应用。技术选择优先满足：快速进入、
可安装 PWA、认证数据不公开、离线记录不丢、计划版本可审计、外部服务故障不阻塞
核心流程，以及公共代码与私人数据彻底分离。

本文不重复维护易过期的依赖版本号。

## 已确定的技术栈

| 范围           | 选择                                                    | 职责                                          | 选择原因                                                           |
| -------------- | ------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| 应用形态       | 手机优先 PWA                                            | 主屏安装、网页更新、有限离线能力              | 第一版无需 App Store，iPhone 可直接使用，同时保留服务端能力        |
| 全栈框架       | Next.js App Router + React + TypeScript                 | 页面、共享 Layout、Route Handler、构建        | 一个公开仓库完成前后端；适合 Vercel；共享 App Shell 可保留导航状态 |
| 部署           | Vercel                                                  | HTTPS、Next.js Functions、静态资源、每日 Cron | 已完成部署和 GitHub OAuth 回调；个人第一版运维成本低               |
| 主数据库       | Neon PostgreSQL                                         | 计划、任务、事件、版本、同步状态、outbox      | 支持事务、约束、关联查询和恢复；不依赖 Vercel 本地文件系统         |
| 数据访问       | Drizzle ORM + Neon serverless driver                    | Schema、migration、类型化查询                 | 数据模型与 SQL 保持可见；适合 PostgreSQL 和 serverless 环境        |
| 身份           | GitHub OAuth + NextAuth + 数字 ID 白名单                | 只允许指定 GitHub 账号进入                    | 不自建密码体系；公开网址仍保持数据私有                             |
| 输入校验       | Zod                                                     | HTTP 输入、领域文档、AI 输出和镜像 Schema     | 客户端、服务端和数据导出共用结构；可导出 JSON Schema               |
| 客户端远端状态 | TanStack Query                                          | 查询缓存、取消、刷新、乐观更新、精确失效      | 日期和 Tab 不再等待整页服务端渲染；可验证慢网与迟到响应            |
| 本机持久化     | Dexie / IndexedDB                                       | 私人查询白名单、离线命令队列、重放状态        | 适合结构化敏感数据；不使用 localStorage 保存康复记录               |
| PWA 缓存       | Service Worker + Cache Storage                          | 公共离线壳、带内容哈希的静态资源              | 与私人 IndexedDB 分开；不缓存认证首页和 API 响应                   |
| 私有数据镜像   | GitHub 私仓 + Octokit Contents API                      | 可读 JSON、版本追踪、供其他 AI 读取           | 只更新目标文件，不克隆笔记仓库；不承担在线数据库职责               |
| AI             | DeepSeek OpenAI-compatible 接口 + `PlanAdvisor` Adapter | 生成结构化调整建议                            | 复用现有按量 API；模型只建议，不持有写权限，Provider 可替换        |
| Garmin         | `GarminClient` Adapter + 独立同步作业                   | 活动、基础睡眠、同步游标和导入                | 非官方接口风险隔离；保留官方接口和 FIT/CSV 替代路径                |
| 训记           | 训练数据 REST Adapter + 按日期同步作业                  | 力量训练明细、来源版本和人工关联              | 复用既有训练记录避免重复录入；只读能力隔离写接口和无关数据         |
| 单元与契约测试 | Vitest                                                  | 领域规则、Module Interface、故障注入          | 运行快，适合每次提交                                               |
| 交互测试       | Testing Library + Vitest                                | 表单、本地状态、慢网、迟到响应                | 验证用户可见行为，不依赖实现细节                                   |
| 浏览器测试     | Playwright                                              | 核心旅程、离线、缓存、移动视口                | 覆盖完整 PWA 数据流；iPhone 特有行为仍需真机验收                   |
| 数据库集成测试 | 临时 PostgreSQL + 正式 migration                        | 事务、约束、并发和 outbox                     | 不用私人 Neon 数据；验证真实 PostgreSQL 语义                       |

## 设计约束的权威位置

技术选型只维护采用的技术、职责、选择原因和替换边界。具体运行规则由专题架构文档
维护，避免同一约束在多处分别更新：

- 页面读取、App Shell 和 Query Cache：[客户端数据与导航](client-data-and-navigation.md)
- PostgreSQL、幂等写入、同步和 GitHub outbox：[数据与同步](data-and-sync.md)
- IndexedDB、Service Worker、离线重放和冲突：[离线流程](offline.md)
- DeepSeek Proposal、校验、确认和计划版本：[AI 计划调整](ai-plan-adjustment.md)
- Garmin Provider、同步范围和失败处理：[Garmin 集成](../operations/garmin.md)
- 训记训练读取、按日期同步和关联规则：[数据与同步](data-and-sync.md)
- 当前未决项、部署 Spike 和实施顺序：[项目计划](../project-plan.md)

## 明确未选择的方案

| 未选择                            | 原因                                                                  |
| --------------------------------- | --------------------------------------------------------------------- |
| 第一版直接开发原生 iOS App        | 安装、签名和双端维护成本高于个人 PWA 的收益；当前能力不依赖原生硬件   |
| GitHub Pages 承载整个应用         | 只能托管静态站点，无法安全承载认证 API、数据库和 AI 调用              |
| GitHub 私仓直接作为在线数据库     | 并发写入、事务、查询、幂等和离线重放都不合适                          |
| 只把数据存在浏览器本地            | 无法可靠跨设备、审计、恢复或供其他 AI 使用                            |
| 让 AI 直接操作数据库或 GitHub     | 无法可靠校验、确认、审计和回滚高风险计划变更                          |
| 正式链路依赖 Mac mini 中转 Garmin | 手机应用会受一台本地机器在线状态影响；Mac mini 只可用于迁移或开发辅助 |
| 把全部健康数据同步进项目          | 增加隐私和复杂度；只保留康复相关活动、步行与基础睡眠背景              |
| 读取训记全部数据或执行写回        | 只需要力量训练明细；饮食、身体、官方计划和训练写回均超出当前职责      |

## 关联决策

- [系统架构](overview.md)
- [项目计划](../project-plan.md)
- [客户端数据与导航](client-data-and-navigation.md)
- [数据与同步](data-and-sync.md)
- [离线流程](offline.md)
- [核心场景测试与发布保障](../testing/core-scenarios.md)
- [ADR-0001：公开应用与私有数据分离](../adr/0001-public-app-private-data.md)
- [ADR-0002：PostgreSQL 为主、GitHub 为镜像](../adr/0002-postgres-primary-github-mirror.md)
- [ADR-0003：AI 建议由软件执行且需人工确认](../adr/0003-ai-proposal-user-confirmation.md)
- [ADR-0004：客户端应用壳与服务端状态缓存](../adr/0004-client-app-shell-and-server-state-cache.md)
- [ADR-0005：临时执行条件使用覆盖层](../adr/0005-execution-context-overlays.md)
- [ADR-0006：外部集成不得阻塞核心闭环](../adr/0006-integrations-cannot-block-core-loop.md)
- [ADR-0007：Tracker 使用固定计划时区](../adr/0007-fixed-planning-time-zone.md)
- [ADR-0008：训练数据按来源融合并由使用者确认](../adr/0008-training-source-fusion.md)
