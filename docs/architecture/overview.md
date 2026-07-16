# 系统架构

## 组件

| 组件                 | 职责                           | 保存内容                                   |
| -------------------- | ------------------------------ | ------------------------------------------ |
| 手机 PWA             | 今日计划、勾选、反馈、离线队列 | 最近计划缓存、待上传事件                   |
| Vercel               | Next.js 页面、API、定时任务    | 无持久化业务数据                           |
| Neon PostgreSQL      | 运行时主数据库                 | 计划、任务、事件、外部记录、版本与同步状态 |
| 私有 GitHub 数据仓库 | 可读、可追溯的数据镜像         | 版本化 JSON 与 Schema 快照                 |
| 原始笔记仓库         | 医疗资料和原始康复计划来源     | 原始文档；应用只读                         |
| DeepSeek             | 提出结构化计划调整建议         | 不持有数据库或 GitHub 权限                 |
| Garmin Connect       | 训练和基础睡眠辅助数据         | 通过隔离适配器读取                         |

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

页面默认使用 Server Component；浏览器状态、IndexedDB 和交互才进入 Client
Component。数据库、凭证和外部服务调用只存在于 `server-only` 模块。正式数据
API 必须在入口和数据访问层分别验证身份、资源归属和输入 Schema，并只返回界面
需要的 DTO。

## 通用核心与膝关节模块

通用核心只定义 tracker、计划版本、任务实例、事件、外部记录、关联、调整建议
和同步状态。膝关节模块定义每日反馈要求、安全信号和 Garmin 数据范围，不把
具体诊断或训练处方写进公共代码。

## 实施阶段

1. 当前：代码、数据模型、PWA 空状态、适配器边界和文档。
2. 基础设施：Neon、Vercel、GitHub OAuth、私有镜像仓库与 Secrets。
3. 数据闭环：导入当前计划，实现任务/反馈 API 与离线重放。
4. 外部集成：Garmin 同步、DeepSeek 调整建议、GitHub outbox。
5. 使用验证：按实际反馈迭代表单、提醒和安全规则。
