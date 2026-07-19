# 安全与隐私

## 文档职责

本文是身份、权限、Secrets、私人数据和客户端清理要求的权威安全基线。系统组件和
数据归属见[系统架构总览](architecture/overview.md)，发布验证见
[核心场景测试](testing/core-scenarios.md)。

## 仓库边界

公共代码仓库允许公开，但必须只包含通用代码、匿名示例、Schema 和脱敏文档。
以下内容不得提交：

- 诊断、影像/检查、医嘱、真实康复计划、反馈和训练历史；
- Garmin、训记、GitHub、DeepSeek、Neon 或 OAuth 凭证；
- Cookie、Token、Session、私人仓库内容或本机绝对路径；
- 从原始笔记复制的可识别内容。

真实运行数据只进入 Neon 和私有数据仓库。原始笔记仓库既是应用的只读导入来源，
也是个人 AI 的知识入口，但不由此应用自动改写，避免与其他设备或 Agent 的笔记
同步产生冲突。笔记中的数据仓库引用不传递权限；个人 AI 必须分别获得两个私有
仓库的访问权，才能联合读取原始上下文与结构化追踪数据。

## 单用户身份

第一版使用 GitHub OAuth，是标准第三方登录流程。服务端不只判断“已登录”，还
必须把 GitHub Profile 的不可变数字用户 ID 与 `ALLOWED_GITHUB_ID` 精确匹配；login
只用于显示、日志脱敏后的诊断或迁移期附加校验，不能作为唯一授权标识。所有数据
API 和变更入口都重复验证。OAuth App 的 client secret 只配置在 Vercel 环境变量。

公开网址不等于公开数据：未授权访问只得到登录页或 401，不返回计划、反馈、
同步状态或可推断的统计数据。健康检查接口不得包含配置或用户信息。

## Secrets

- 所有机密使用 Vercel/本地环境变量，禁止 `NEXT_PUBLIC_` 前缀。
- GitHub 使用只对私有数据仓库 Contents 有权限的 fine-grained token。
- Garmin session/token 写入数据库前使用 AES-GCM 等认证加密；Base64 不是加密。
- Garmin 密码不持久化；首次 Session 尽量在受信任本机生成后导入。
- 训记 API Key 只允许从已认证设置页提交到服务端，使用通用集成加密主密钥认证加密
  后写入数据库；保存后 API 只返回掩码、状态和更新时间，不返回密钥原值。
- 集成凭证使用 AES-256-GCM、每次写入独立随机 nonce 和 provider 绑定的附加认证数据；
  密文同时保存 `keyVersion`，主密钥由 Vercel Secret
  `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY` 提供，以便轮换时重新加密而不是明文导出。
- 训记 Adapter 第一版只暴露训练读取能力，不调用写回、饮食、身体数据或官方计划
  接口。Provider Key 即使技术上具备更宽权限，也不能扩大应用的代码能力边界。
- 集成加密密钥、OAuth secret、数据库密码和 cron secret 定期轮换。
- 日志只记录错误代码和关联 ID，不记录身体反馈原文、外部响应全文、Authorization
  请求头或 API Key。

### 外部凭证发布门禁

请求方式、Adapter、固定 endpoint contract 和通用集成 UI 可以进入公共仓库。任何真实
Garmin Session/Token、训记 API Key、集成加密主密钥、Cookie 或 Authorization 值均
不得进入源码、文档、测试夹具、日志、构建产物、GitHub 镜像或 Git 历史。测试只使用
明确标记的匿名假凭证。每次涉及外部集成的提交在推送前必须分别审查 staged diff，并
对当前仓库和 Git 历史执行 credential scan；发现疑似真实值时停止发布并先完成轮换。

## 应用边界

- 所有客户端输入使用 Zod 校验，并限制文本长度和枚举范围。
- 数据访问集中到 `server-only` DAL，返回最小 DTO。
- 变更接口校验身份、资源归属、idempotency key 和基础版本。
- Service Worker 不缓存 `/api` 响应；离线私人数据只进入 IndexedDB。
- TanStack Query 的持久化采用私人数据白名单，不能把 Session、Token、AI 原始
  上下文或任意 API 响应整体落盘。
- GitHub 镜像路径由受限标识符生成，不能接受任意用户路径。
- 数据库写入与 outbox 创建同事务完成，防止已保存数据永久漏镜像。
- 发给 DeepSeek 的上下文移除身份、仓库和原始医疗文档，只包含完成任务所需的
  结构化计划片段、近期事件和安全规则摘要。
- 个性化安全策略不是 Secret，但属于私人领域数据：公共仓库只保存通用 Schema 和
  执行器；真实策略仅通过鉴权 DTO、PostgreSQL、私人 IndexedDB 白名单和私有镜像
  流转。每次判定记录策略版本/hash，客户端值不能取代服务端权威重算。
- Web Push payload 使用抽象提醒文案，不把疼痛、诊断、训练备注放到锁屏通知。
- 退出登录、身份变化和“清除本机数据”必须共同清理 Query Cache、IndexedDB、
  Cache Storage 中的用户专属状态和跨标签页状态。

正式部署前应完成威胁模型、依赖扫描、恢复演练和真实 iPhone 上的退出/清除数据
验证。
