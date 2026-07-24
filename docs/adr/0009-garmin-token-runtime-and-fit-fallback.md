# ADR-0009：Garmin 使用 Token-only 可替换运行时并保留 FIT 兜底

## 状态

2026-07-24 接受为 P3b 的架构边界。只代表可行性与安全边界已锁定，不代表官方 API
获批、真实 Token 已连接或真实数据已验证。

## 背景

AK Tracker 需要 Garmin 提供活动时间、时长、距离、配速和心率，并在以后按需增加
基础睡眠与步数。训记仍是力量训练动作、重量和组次的主要来源。Garmin 官方
Developer Program 只面向业务使用，获批后才提供 Activity API 评估环境；个人项目
不能预设已经获得官方 API 权限。

维护中的 `python-garminconnect` 可以通过本机认证/MFA 生成原生 token bundle，但它
使用非官方接口，并带有 Python 和 `curl_cffi` 运行时依赖。系统需要在不保存 Garmin
密码、不绑定第三方响应结构的前提下验证它是否能部署。

## 决策

1. 业务层只依赖 server-only 的 `GarminClient` 契约。活动、步数和睡眠是外部证据，
   不携带任务完成状态，也不能直接修改任务。
2. 私人自动读取候选固定为 `python-garminconnect==0.3.6`；版本变化必须重新评审和
   部署验证，不使用浮动版本。
3. 首次账号认证和 MFA 只在受信任本机完成。云端只接收严格版本化的 token bundle
   凭证信封，不接收或持久化 Garmin 密码。
4. Token 复用通用集成凭证的 AES-256-GCM、随机 nonce、`keyVersion` 和 provider AAD；
   浏览器只得到脱敏连接状态。
5. 第三方客户端隔离在可替换运行时。P3b-1 的真实 Vercel Preview 已证明 Python
   3.12.13、`garminconnect 0.3.6`、`curl_cffi` 和匿名 token 解析可以构建、启动和安全
   分类失败；临时验证 Route 不进入正式代码。
6. Garmin 官方 Activity API 在项目获批后成为长期首选。正式获批前，文档和 UI 都
   不得把它描述为已连接。
7. Garmin 官方 JavaScript FIT SDK 是无凭证兜底。如果真实 token 路线在 Vercel 上
   失败，先比较独立受控 Worker 与 FIT 导入，不把账号密码移到云端补救。
8. P3b-2a 先交付 token-only 单日预览：本机助手处理账号、密码和 MFA；网页只导入
   token 文件；Node 与 Python Runtime 以独立 Secret、固定协议、短超时和大小上限
   通信。预览不持久化活动，也不改变任务状态。

## 结果

- 当前不需要数据库 migration；通用凭证表可直接承载加密 Garmin Token。
- P3b-2 已选择先实现单日 token-only Adapter，FIT 导入继续作为真实验证失败时的兜底。
- 非官方接口变化只会让 Garmin Provider 降级，不会影响任务、反馈和训记。
- Vercel Python Runtime 仍是 Beta；真实 Token、刷新、网络/WAF、地区账号和数据字段
  必须在后续受控试验中验证。
- FIT 导入稳定且官方支持，但不能提供自动睡眠和步数。

## 参考

- [Garmin Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [Garmin Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Garmin FIT SDK](https://developer.garmin.com/fit/get-the-sdk/)
- [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
- [Vercel Python Runtime](https://vercel.com/docs/functions/runtimes/python)
