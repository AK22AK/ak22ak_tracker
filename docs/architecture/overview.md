# 系统架构

## 组件

| 组件                 | 职责                             | 保存内容                                   |
| -------------------- | -------------------------------- | ------------------------------------------ |
| 手机 PWA             | 应用壳、交互、查询缓存、离线队列 | 最近计划/查询缓存、待上传事件              |
| Vercel               | Next.js 页面、API、定时任务      | 无持久化业务数据                           |
| Neon PostgreSQL      | 运行时主数据库                   | 计划、任务、事件、外部记录、版本与同步状态 |
| 私有 GitHub 数据仓库 | 可读、可追溯的数据镜像           | 版本化 JSON 与 Schema 快照                 |
| 原始笔记仓库         | 医疗资料和原始康复计划来源       | 原始文档；应用只读                         |
| DeepSeek             | 提出结构化计划调整建议           | 不持有数据库或 GitHub 权限                 |
| Garmin Connect       | 训练和基础睡眠辅助数据           | 通过隔离适配器读取                         |

Vercel 和 Neon 是两个独立服务。PostgreSQL 不在 Vercel 内，也不保存在 GitHub
仓库里。GitHub 数据仓库是 PostgreSQL 的异步镜像，不承担在线查询数据库的
职责。

## 代码边界

```text
src/app                 页面和 HTTP 入口
src/components          客户端交互组件
src/domain              通用 tracker Schema 和纯业务规则
src/modules             各追踪模块的策略配置
src/offline             IndexedDB 缓存与待同步队列
src/server/db           PostgreSQL Schema 和数据访问层
src/server/integrations 外部服务适配器
src/server/mirror       GitHub 数据镜像
src/server/sync         同步窗口与编排规则
```

受保护区域使用共享 Client Layout 作为 App Shell，保持底部导航、网络状态和查询
缓存。TanStack Query 管理服务端状态，Dexie 管理跨重启的私人缓存和离线队列。
Server Component 可为首次打开预取，但日期选择和顶层导航不能依赖整页服务器
重渲染。详见[客户端数据与导航](client-data-and-navigation.md)。

数据库、凭证和外部服务调用只存在于 `server-only` 模块。正式数据 API 必须在
入口和数据访问层分别验证身份、资源归属和输入 Schema，并只返回界面需要的聚合
DTO。

## 通用核心与膝关节模块

通用核心只定义 tracker、计划版本、任务实例、事件、外部记录、关联、调整建议
和同步状态。膝关节模块定义每日反馈要求、安全信号和 Garmin 数据范围，不把
具体诊断或训练处方写进公共代码。

临时出差、器械受限和暂停使用执行上下文覆盖层；只有真正改变未来任务时才创建
计划版本。目标日期进入评估流程而不是自动完成。完整能力边界见
[功能实现总图](feature-implementation-map.md)。

## 实施阶段

1. 交互基础：共享 App Shell、客户端查询缓存、聚合 API 和即时导航。
2. 当前闭环：任务/反馈、出差覆盖层、暂停/接续和当前计划更新。
3. 离线可靠性：Dexie 队列、缓存恢复、幂等重放和 PWA 更新。
4. 外部集成：GitHub outbox、Garmin 适配器/导入和 DeepSeek 建议。
5. 洞察与扩展：趋势、阶段评估、可选通知和第二个 Tracker。
