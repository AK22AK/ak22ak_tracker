# 系统架构总览

## 文档职责

本文是 AK Tracker 的权威系统蓝图，回答系统由什么组成、各部分怎样协作、数据存放
在哪里，以及用户操作如何变成计划、记录和后续调整。产品范围以
[产品需求](../product-requirements.md)为准，当前实现进度以[项目计划](../project-plan.md)
为准；前端、数据同步、离线和 AI 的实现细节由对应专题架构文档维护。

本文描述已经确认的目标架构。尚未接入或只完成骨架的能力不会因为出现在架构图中
被视为已经交付，实际状态统一记录在项目计划中。

## 系统上下文

AK Tracker 是一个单用户、手机优先的私人追踪系统。膝关节康复是第一个 Tracker，
但计划版本、任务、执行、反馈、外部记录和调整建议属于通用核心。

```mermaid
flowchart LR
    USER["使用者"] --> PWA["AK Tracker 手机 PWA"]
    PWA --> AUTH["GitHub OAuth"]
    PWA <--> APP["AK Tracker 应用服务"]

    APP <--> DB["Neon PostgreSQL<br/>运行时主数据库"]
    APP --> AI["DeepSeek<br/>结构化调整建议"]
    APP --> GARMIN["Garmin Connect<br/>活动与基础睡眠"]
    APP --> XUNJI["训记<br/>力量训练明细"]

    subgraph KNOWLEDGE["个人知识域"]
        direction TB
        NOTES["zhengjing_notes<br/>完整个人笔记上下文<br/>原始医疗资料与初始计划"]
        DATA["ak22ak_tracker-data<br/>独立私有结构化追踪仓库"]
        NOTES -.->|"康复追踪入口引用"| DATA
    end

    NOTES -->|"固定版本导入"| APP
    DB -->|"异步镜像"| DATA
    OTHER_AI["其他获授权的 AI"] -->|"从个人笔记入口读取"| NOTES
```

三个 GitHub 仓库承担不同职责：

| 仓库                  | 职责                                              | 运行时写入方式                        |
| --------------------- | ------------------------------------------------- | ------------------------------------- |
| `ak22ak_tracker`      | 公共应用代码、匿名 Schema、产品与工程文档         | 由开发流程维护，不保存真实健康数据    |
| `ak22ak_tracker-data` | 被个人笔记引用的结构化扩展、Schema 快照和可读历史 | 应用通过 GitHub Contents API 异步更新 |
| `zhengjing_notes`     | 完整个人知识入口、原始私人笔记和康复追踪索引      | 应用只读固定来源，不自动改写笔记仓库  |

从个人知识组织角度看，`ak22ak_tracker-data` 不是与 `zhengjing_notes` 平行且互不相关的
信息源，而是由后者稳定引用的结构化追踪扩展。其他获授权的 AI 默认先从
`zhengjing_notes` 获取检查、医嘱、恢复历史和其他个人上下文，再沿康复追踪入口读取数据
私仓中的计划版本、执行、反馈和外部记录，合并两部分信息后分析。两个仓库在 Git
存储和权限上仍彼此独立；这里的引用不复制数据，也不要求应用改写笔记仓库。

## 容器与部署架构

```mermaid
flowchart TB
    subgraph PHONE["iPhone / 浏览器"]
        UI["PWA 界面与 App Shell"]
        QUERY["查询缓存与本地交互状态"]
        IDB["IndexedDB<br/>离线快照与待同步命令"]
        SW["Service Worker<br/>公共应用壳与静态资源"]
        UI <--> QUERY
        QUERY <--> IDB
        UI <--> SW
    end

    subgraph VERCEL["Vercel"]
        WEB["Next.js 页面"]
        API["认证 API 与应用服务"]
        JOBS["Cron / 后台作业入口"]
        WEB --> API
        JOBS --> API
    end

    subgraph NEON["Neon"]
        PG["PostgreSQL"]
    end

    subgraph EXTERNAL["外部服务"]
        GH["GitHub 数据私仓"]
        DS["DeepSeek API"]
        GC["Garmin Provider / 导入"]
        XJ["训记训练数据 API"]
    end

    UI <--> WEB
    QUERY <--> API
    API <--> PG
    API <--> DS
    JOBS <--> GC
    JOBS <--> XJ
    PG -->|"outbox"| JOBS
    JOBS --> GH
```

- 手机 PWA 负责交互、短期查询缓存、离线队列和同步状态展示。
- Vercel 承载 Next.js 页面、API、身份验证和定时任务入口，不保存持久业务数据。
- Neon PostgreSQL 是运行时权威数据库，承担事务、查询、幂等、版本和同步状态。
- GitHub 数据私仓是 PostgreSQL 的最终一致镜像，不参与页面在线查询。
- DeepSeek、Garmin 和训记通过隔离 Adapter 接入，任何一个外部服务都不能阻塞核心
  闭环。

## 领域与模块边界

| 领域模块       | 负责内容                                          | 主要数据                                                |
| -------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Tracker 核心   | Tracker 生命周期、计划时间线和计划版本            | `trackers`、`plan_versions`                             |
| 每日执行       | 按日期展开任务、完成/跳过和实际训练               | `task_instances`、训练事件                              |
| 身体反馈与安全 | 多次反馈、疼痛/肿胀/功能表现和确定性红黄绿规则    | 反馈事件、安全级别                                      |
| 执行上下文     | 出差、器械受限、零碎时间、暂停和接续              | `execution_contexts`、暂停/恢复事件                     |
| 计划调整       | 汇总上下文、AI Proposal、差异确认、版本应用和回滚 | `ai_analysis_jobs`、`plan_change_proposals`、新计划版本 |
| 外部记录与关联 | Garmin 活动/睡眠、训记训练明细及人工确认关联      | `external_records`、`external_record_links`             |
| 数据同步与镜像 | 离线重放、外部游标、GitHub outbox 和镜像重建      | `integration_sync_state`、`github_sync_outbox`          |
| 阶段评估       | 目标日期评估、有效训练周和下一阶段决定            | `evaluation_sessions`、决定事件                         |

公共代码只保存通用 Schema、流程和匿名规则接口。膝关节模块保存反馈字段、安全规则以及
外部数据白名单范围；私人处方、诊断、阈值和医嘱仍属于私人数据域。

## 时间与日期语义

- 每个 Tracker 拥有固定的 `planningTimeZone`；当前膝关节 Tracker 使用
  `Asia/Shanghai`，短期出差不自动修改它。
- “今天”、计划版本生效日、任务所属日和反馈 `localDate` 都按计划时区计算，避免
  跨时区时重复或跳过任务。
- 每条事件同时保存绝对发生时间、记录时间以及发生地设备报告的 IANA 时区和 UTC
  偏移。设备时区与计划时区不同时，界面显示提示，但仍把记录归入明确的计划日。
- 修改 Tracker 的计划时区属于显式设置变更，需要预览受影响日期，不能根据浏览器
  时区静默切换。

详细决策见[ADR-0007：Tracker 使用固定计划时区](../adr/0007-fixed-planning-time-zone.md)。

## 核心运行流程

### 1. 查看今日计划

1. PWA 先显示本机已有的页面框架和允许缓存的最近数据。
2. 在线时向应用 API 请求指定日期的聚合结果。
3. API 验证 GitHub Session 和账号白名单，从 PostgreSQL 解析该日期有效的计划版本、
   任务、反馈和待处理事项。
4. 返回结果更新查询缓存和白名单 IndexedDB 快照；页面保持任务、来源和更新时间
   可见。

日期选择、Tab、折叠和表单输入先在客户端响应，网络只决定内容何时刷新，不决定
界面是否能够操作。

### 2. 记录训练与身体反馈

```mermaid
sequenceDiagram
    participant U as 使用者
    participant P as 手机 PWA
    participant A as 应用 API
    participant D as PostgreSQL
    participant O as GitHub outbox

    U->>P: 勾选任务或提交反馈
    P->>P: 生成 UUID 与 idempotency key
    P->>P: 本机记录并立即更新界面
    P->>A: 提交结构化命令
    A->>A: 鉴权、Schema 与领域规则校验
    A->>D: 原子写入任务投影和追加事件
    D->>O: 同事务创建镜像任务
    D-->>A: 返回服务器确认状态
    A-->>P: 已同步结果与安全级别
    P-->>U: 显示已同步或需要处理
```

- 每项任务只能由使用者确认完成；Garmin、训记记录和 AI 不能代替勾选。
- 反馈可以在一天内多次追加，突发反馈不会覆盖晨间或训练后记录。
- 红黄绿安全分级先由确定性规则产生，不依赖 AI 是否可用。
- 离线时命令保留在 IndexedDB；恢复联网后使用同一 API 和幂等键按序重放。

### 3. AI 调整计划

```text
已保存的计划、执行和反馈
  -> 确定性安全规则
  -> 使用者明确请求分析并创建 AI 任务
  -> 服务端组织最小化上下文
  -> DeepSeek 返回受限结构化 Proposal
  -> Schema、红黄绿规则、日期和基础版本校验
  -> 使用者查看原因与逐项差异
  -> 接受 / 拒绝 / 稍后处理
  -> 接受后由应用服务创建新的不可变计划版本
  -> 重建受影响的未来任务并创建 GitHub outbox
```

DeepSeek 不持有 PostgreSQL、GitHub、Garmin 或训记凭证，也不直接执行数据库操作。建议
绑定基础计划版本；等待确认期间计划已变化时，旧建议过期并重新分析。红灯状态由
确定性规则优先处理，不能被模型降低等级。

### 4. PostgreSQL 更新 GitHub 数据镜像

1. 每次业务写入在数据库事务中同时创建 `github_sync_outbox`。
2. 后台任务读取 outbox，通过 GitHub Contents API 只更新目标 JSON 文件。
3. 成功后记录完成；临时错误自动退避重试，权限错误进入可见失败状态。
4. 页面提交在 PostgreSQL 成功时即完成，镜像延迟不会让反馈或任务退回未保存。
5. 私人笔记中的康复追踪入口始终指向这套结构化镜像；其他获授权的 AI 从个人笔记
   进入后，可以继续读取计划版本、事件、外部记录和快照，并与原始笔记上下文合并。

原始笔记仓库不参与每次运行时同步。它既是初始资料和人工维护原始记录的来源，也是
其他个人 AI 的知识入口；其中只维护指向数据私仓的稳定引用。应用不会自动改写它，
从而避免与 Mac mini、iCloud 或其他 Agent 的笔记工作流发生冲突。

### 5. Garmin、训记与任务关联

1. 每日作业、应用打开或“立即同步”调用隔离的 Garmin 与训记只读 Adapter。
2. Garmin 负责活动时间、时长、距离、配速、心率和基础睡眠；训记负责力量训练的
   动作、重量、组次、次数、RPE 和训练备注。数据经过白名单、标准化和 Schema 校验
   后，以 provider 和稳定外部 ID 幂等写入 `external_records`。
3. 匹配服务以计划日、时间和训练内容提出“这些来源记录可能对应某项任务”的关联
   建议。同一任务可以同时关联 Garmin 活动和训记训练详情。
4. 使用者确认、修改或取消关联，并自行勾选任务完成状态；确认后的实际执行引用
   来源快照。来源随后变化时进入“需要复核”，不能静默改写已确认结果。

任一 Provider 同步失败只影响对应外部记录区域，不影响计划查看、手工兜底记录、
反馈和安全规则。训记第一版不读取饮食、身体数据或官方计划，也不执行写回。

## 数据所有权与存储位置

| 信息                     | 权威来源                    | 副本或派生数据                        |
| ------------------------ | --------------------------- | ------------------------------------- |
| 检查、医嘱、恢复历史     | `zhengjing_notes`           | 不自动复制到公共代码仓库              |
| 初始康复计划文档         | `zhengjing_notes` 固定提交  | 导入为 PostgreSQL 不可变计划版本      |
| 当前计划版本与未来任务   | Neon PostgreSQL             | GitHub 私仓 JSON 镜像、手机白名单快照 |
| 实际训练、反馈和人工决定 | Neon PostgreSQL 追加事件    | GitHub 私仓事件镜像、手机待同步副本   |
| AI 请求、Proposal 和决定 | Neon PostgreSQL             | GitHub 私仓可读镜像                   |
| Garmin 活动与基础睡眠    | Garmin                      | PostgreSQL 标准化记录、GitHub 镜像    |
| 力量训练明细             | 训记                        | PostgreSQL 标准化记录、GitHub 镜像    |
| 离线未同步命令           | 手机 IndexedDB              | 服务端确认后删除                      |
| 数据格式                 | 公共代码仓库 Zod Schema     | 私有数据仓库 JSON Schema 快照         |
| OAuth/API/数据库凭证     | Vercel Secrets 或加密数据库 | 不进入浏览器、日志或 GitHub 数据文件  |

PostgreSQL、IndexedDB 和 GitHub 镜像的边界详见[数据与同步](data-and-sync.md)与
[离线流程](offline.md)。

## 代码边界

```text
src/app                 页面、Route Handler 和 HTTP 入口
src/components          客户端交互组件
src/domain              通用 Tracker Schema 与纯领域规则
src/modules             膝关节等 Tracker 模块策略
src/offline             IndexedDB 缓存与待同步队列
src/server/auth         身份和账号白名单
src/server/db           PostgreSQL Schema 与数据访问
src/server/integrations 外部 Provider 契约和 Adapter
src/server/mirror       GitHub 数据镜像
src/server/sync         同步窗口与后台编排规则
schemas                 对外交换 JSON Schema
```

数据库、凭证和外部服务调用只存在于服务端边界。正式数据 API 在 HTTP 入口和数据
访问层分别验证身份、资源归属和输入 Schema，只返回页面需要的聚合 DTO。

## 可靠性与安全边界

- 今日计划、训练记录、身体反馈和确定性安全规则构成核心闭环。
- Garmin、训记、DeepSeek、GitHub 镜像、Web Push 和 Cron 都是可独立失败的集成。
- 数据库写入采用幂等命令；离线重放、Cron 重复触发和外部同步重叠窗口不能产生
  重复业务记录。
- 所有计划变更生成不可变版本，保存来源、基础版本、差异、人工决定和应用结果。
- 公共代码、自动化测试和文档不包含真实计划、反馈、Token 或原始医疗内容。
- 自动化测试覆盖领域不变量、数据库事务、离线重放和核心用户旅程；iOS PWA 特有
  行为使用真机验收。

## 专题文档

- [产品需求](../product-requirements.md)：目标、用户旅程、范围与成功标准。
- [项目计划](../project-plan.md)：当前状态、里程碑、风险与下一步。
- [产品与 UI/UX 设计系统](../design/product-and-visual-system.md)：页面与交互规范。
- [客户端数据与导航](client-data-and-navigation.md)：App Shell、查询缓存和即时交互。
- [数据与同步](data-and-sync.md)：实体、事务、同步链路和私有仓库布局。
- [离线流程](offline.md)：本机快照、离线队列、重放与冲突。
- [AI 计划调整](ai-plan-adjustment.md)：Provider、结构化输出和建议生命周期。
- [技术选型](technology-selection.md)：技术栈、职责和替换边界。
- [安全与隐私](../security.md)：身份、Secrets 和私人数据边界。
- [核心场景测试](../testing/core-scenarios.md)：系统不变量、测试分层和发布门禁。
- [部署与运行](../operations/deployment.md)：部署、监控、恢复和回滚 Runbook。
- [Garmin 集成](../operations/garmin.md)：同步范围、Provider 和失效处理。
- [架构决策记录](../adr/README.md)：已经接受的重要决策及其原因。
