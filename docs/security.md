# 安全与隐私

## 仓库边界

公共代码仓库允许公开，但必须只包含通用代码、匿名示例、Schema 和脱敏文档。
以下内容不得提交：

- 诊断、影像/检查、医嘱、真实康复计划、反馈和训练历史；
- Garmin、GitHub、DeepSeek、Neon 或 OAuth 凭证；
- Cookie、Token、Session、私人仓库内容或本机绝对路径；
- 从原始笔记复制的可识别内容。

真实数据只进入 Neon 和私有数据仓库。原始笔记仓库保持只读来源，不由此应用
自动改写，避免与其他设备或 Agent 的笔记同步产生冲突。

## 单用户身份

第一版使用 GitHub OAuth，是标准第三方登录流程。服务端不只判断“已登录”，还
必须把 GitHub login 与 `ALLOWED_GITHUB_LOGIN` 精确匹配；所有数据 API 和变更
入口都重复验证。OAuth App 的 client secret 只配置在 Vercel 环境变量。

公开网址不等于公开数据：未授权访问只得到登录页或 401，不返回计划、反馈、
同步状态或可推断的统计数据。健康检查接口不得包含配置或用户信息。

## Secrets

- 所有机密使用 Vercel/本地环境变量，禁止 `NEXT_PUBLIC_` 前缀。
- GitHub 使用只对私有数据仓库 Contents 有权限的 fine-grained token。
- Garmin session/token 写入数据库前使用 AES-GCM 等认证加密；Base64 不是加密。
- 集成加密密钥、OAuth secret、数据库密码和 cron secret 定期轮换。
- 日志只记录错误代码和关联 ID，不记录身体反馈原文或外部响应全文。

## 应用边界

- 所有客户端输入使用 Zod 校验，并限制文本长度和枚举范围。
- 数据访问集中到 `server-only` DAL，返回最小 DTO。
- 变更接口校验身份、资源归属、idempotency key 和基础版本。
- Service Worker 不缓存 `/api` 响应；离线私人数据只进入 IndexedDB。
- GitHub 镜像路径由受限标识符生成，不能接受任意用户路径。
- 数据库写入与 outbox 创建同事务完成，防止已保存数据永久漏镜像。

正式部署前应完成威胁模型、依赖扫描、恢复演练和真实 iPhone 上的退出/清除数据
验证。
