# Garmin 集成

## 文档职责

本文是 Garmin Provider、凭证、运行时、数据范围和故障降级的集成 Runbook。Garmin
在系统中的位置见[系统架构总览](../architecture/overview.md)，通用外部记录见
[数据与同步](../architecture/data-and-sync.md)，关键决策见
[ADR-0009](../adr/0009-garmin-token-runtime-and-fit-fallback.md)。

截至 2026-07-24，P3b-1 与 P3b-2a 的契约、安全边界、匿名测试及 Preview/Production
部署已由项目经理验收。中国区真实 Token 导入、刷新、Node 到 Python Runtime 和生产
单日白名单活动摘要链路已完成受控验证；长期 Token 生命周期、增量同步及故障恢复仍未
验证。账号、密码和 MFA 始终只由使用者本人在受信任本机输入。

## 接入路线

采用三层可替换路线：

1. **长期官方路线**：获批后使用 Garmin Connect Developer Program 的 Activity API，
   再按实际授权评估 Health API。官方 FAQ 明确该计划只面向业务/企业使用；申请获批后
   才能进入评估环境，因此当前不能把官方 API 视为已连接能力。
2. **私人只读候选**：隔离运行固定版本 `python-garminconnect==0.3.6`。它是维护中的
   第三方客户端，不是 Garmin 官方 API；登录、MFA、上游接口或限流变化都属于预期
   集成故障。
3. **官方文件兜底**：使用 Garmin 官方 FIT SDK 解析使用者主动导出的 FIT 文件。优先
   采用官方 JavaScript 包 `@garmin/fitsdk`，避免引入第二个运行时；该路径不提供自动
   睡眠或步数同步。

应用的业务层只依赖 `GarminClient`，不会把任何第三方客户端的响应结构、异常类型或
Token 格式扩散到计划、任务和反馈领域。

## 凭证与认证流程

优先流程是“受信任本机完成一次认证，云端只接收 Token”：

```text
受信任本机认证与 MFA
  -> 生成客户端原生 token bundle
  -> 已鉴权的服务端导入接口
  -> 固定版本和结构校验
  -> AES-256-GCM + 随机 nonce + provider AAD
  -> integration_credentials
  -> Garmin 运行时按需解密使用
```

- 网页和服务端不接收、不保存 Garmin 密码。
- 明文 Token 只允许在服务端内存中短暂出现；浏览器 DTO 永远只返回连接状态。
- Token 刷新后必须把新 bundle 作为同一凭证的新密文原子替换，不能写临时文件作为
  持久存储。
- 加密沿用通用集成凭证底座：随机 12-byte nonce、AES-256-GCM、`keyVersion` 和包含
  provider 的 AAD。真实 Token、Cookie、Authorization 和加密主密钥不得进入源码、
  文档、测试、日志、构建产物、GitHub 镜像或 Git 历史。
- 当前固定客户端凭证信封为版本化、严格白名单结构，只允许客户端 ID、固定版本、
  账号区域和原生 token bundle；用户名、密码及任意额外字段会被拒绝。

## P3b-1 部署 Spike 证据

2026-07-24 使用临时 Vercel Preview 部署
`dpl_APHB4xwbBJw8f4zcKQgzmxETb5pW` 验证了真实 Python Runtime，而不是用单元 Mock
代替部署验证：

- Preview 构建和启动成功，状态为 `READY`。
- Vercel 实际使用 Python `3.12.13`。
- 固定依赖 `garminconnect==0.3.6` 安装并加载成功。
- 它依赖的 `curl_cffi` 原生运行时成功加载。
- 客户端自己的 `Client.loads()` 成功解析匿名 token bundle。
- 损坏 bundle、认证、限流、超时和 Provider 不可用被映射为有限的安全错误代码。
- P3b-1 的临时 Python Route 和依赖文件已在验证后删除；P3b-2a 后来新增的是经过契约、
  鉴权和大小限制审查的正式 Runtime 与锁定依赖，不沿用临时诊断接口。

上述 P3b-1 证据只证明“固定版本可在 Vercel Python Runtime 加载并解析匿名 Token”。
P3b-2a 后续已经完成真实中国区 Token 的受控单日链路验证，但以下能力仍未验证：

- 长期 Token 生命周期、撤销和恢复；
- 增量同步、连续运行时的延迟和限流；
- 全球区账号差异及持续运行时的 Cloudflare/WAF 行为。

P3b-1 的匿名证据本身不等于真实连接；P3b-2a 的受控验证也不授权使用账号密码在云端
重新登录或提前扩展批量同步。

## P3b-2a 本机授权与单日预览

### 本机一次性授权助手

授权助手只在使用者自己的 Mac 上运行：

```bash
./scripts/garmin-authorize-local.sh --region global
```

中国区账号使用 `--region china`。助手会在临时虚拟环境安装锁定依赖，在终端中读取
账号、隐藏输入密码并按需隐藏输入 MFA 验证码；完成后删除临时环境。默认只生成权限为
`0600` 的 `~/.ak22ak_tracker/garmin-token-bundle.json`，终端不输出 Token 内容。

本机助手与 Vercel Runtime 使用职责分离的固定依赖清单，不能通过 Python 版本猜测
运行环境。根目录 `requirements.txt` 只服务 Vercel Python Runtime，固定
`cffi==2.1.0`；`scripts/requirements-garmin-local.txt` 只服务本机授权助手，固定
`cffi==2.0.0`。两者都固定 `garminconnect==0.3.6` 和 `curl_cffi==0.15.0`，版本不得
漂移。2026-07-24 已分别在 arm64 Mac 的 Python 3.13.12 和 3.14.3 全新 venv 完整安装
本机依赖，并完成中国区客户端匿名 Token 解析，未调用 Garmin。

随后在设置页选择该 JSON 文件进行导入。网页只把严格 token 信封经 HTTPS 发送给已
鉴权后端；后端重新校验客户端、版本、区域和三个 token 字段后加密保存。页面返回的
状态只有“未连接、待验证、已连接、需要更新、需要处理”及安全错误分类，永不回传原值。
Token 文件不应发送到聊天、放入项目目录或提交到 Git。

该文件只是临时导入凭证。设置页确认“Token 已加密保存”后，浏览器不会也不能自动删除
本机文件；使用者应手动执行：

```bash
rm ~/.ak22ak_tracker/garmin-token-bundle.json
```

不要长期保留该文件，不要同步到 iCloud 或其他云盘，也不要发送到聊天或复制进仓库。
这里使用普通文件删除，不声称能在 APFS 上安全覆写原有存储块。

### 单日活动预览

设置页允许选择一天并请求预览。该操作：

1. 只读取使用者明确选择的一个过去或当日日期，不追赶历史；未来日期会在调用
   Provider 前拒绝。同步与历史回填仍使用各自独立的范围边界。
2. Node 后端解密 Token，通过独立 `GARMIN_RUNTIME_SECRET` 调用同一部署中的 Python
   Runtime；Secret 只存在服务端。
3. Python Runtime 固定请求版本、最大请求体、最多 100 条活动；Node 使用 12 秒超时
   和 128 KiB 响应上限。
4. 页面只得到活动类型、开始时间、时长、距离、配速和平均心率，不得到 Provider raw
   payload、内部记录 ID 或刷新后的 Token。
5. 预览不写入 `external_records`，不建立任务关联，更不能改变任务完成状态。

若读取过程中客户端刷新了 token bundle，刷新结果只回到 Node 内存并原子重新加密；
不会经过浏览器。每次真实预览都必须由使用者明确触发。

正式 Runtime 已由 Vercel Preview `dpl_FzhmN4y1aDPnCJvQYVLoxCbZHzeE` 验证：Python
3.12、锁定依赖和 Route 构建成功；未携带内部 Secret 的 POST 由 Runtime 返回 401。
本次没有调用 Garmin，也没有使用匿名假 Token 对 Garmin 发请求，因此该证据只覆盖
部署、鉴权门禁和运行时装载，不覆盖真实账号、刷新、WAF 或活动字段。

Production `dpl_3ocqbQM9zLKxeh7PneCgnUiivaQS` 已 Ready 并绑定正式域名；健康检查为
`database=ok`，未登录的 Garmin 导入与预览接口返回 401，未携带内部 Secret 的 Python
Runtime 也返回安全的 401。该生产门禁没有导入 Token、读取活动或触发 Garmin 请求。

## 运行时选择

### Vercel Python Function

当前首选。它与现有项目同平台，Preview 已证明 Python 3.12、固定客户端及 `curl_cffi`
可以构建和启动。P3b-2a 已增加只允许 Node 服务调用的独立 Secret、固定协议版本、
请求/响应大小限制、短超时和刷新 Token 回收边界，并完成生产受控单日链路验证。
Vercel 官方仍将 Python Runtime 标为 Beta，长期 Token 生命周期、限流和持续运行时的
网络/WAF 行为仍需后续验证。

### 独立受控 Worker

如果真实 Token 在 Vercel 上遇到网络、WAF、运行时体积或生命周期问题，再把相同
`GarminClient` 实现移到独立 Worker。它能隔离 Python 依赖和故障，但会增加一套部署、
鉴权、监控和密钥轮换，因此不在没有实证问题时提前引入。

### FIT 文件导入

这是不依赖非官方登录的稳定兜底。官方 JavaScript FIT SDK 可直接在现有 Node 运行时
解码活动文件，适合活动时间、时长、距离、配速和心率；它不能替代自动睡眠和步数。

项目经理已选择先完成 Token-only 单日受控验证。若真实环境遇到不可接受的 WAF、区域
或刷新阻塞，再比较独立受控 Worker 与 FIT 导入；当前不直接展开历史追赶同步。

## 数据职责

- Garmin：活动开始时间、时长、距离、配速、心率，以及用户明确选择日期后同步的基础
  步数和睡眠恢复参考。
- 训记：力量训练动作、重量、单位、组次、完成状态和备注等精确信息。
- 同一训练可以同时拥有 Garmin 活动证据和训记力量明细，使用者决定如何关联。
- Garmin 记录只能提供关联建议，绝不能自动把康复任务改成完成。
- 睡眠与步数使用独立的 `daily_wellness` 外部记录和日期同步状态，不进入训练任务关联，
  不改变红黄绿结果，也不替代使用者反馈。缺失数据不会补成零或解释为状态良好。
- 卡路里、身体成分、Body Battery、压力、血氧等当前无明确用途的数据不进入项目。

### 睡眠与步数同步

P5a-2a 提供用户明确选择一天后的只读同步。固定客户端的 `get_user_summary(date)`
（`get_stats` 是其兼容别名）提供步数和可选目标，`get_sleep_data(date)` 提供该日期归属
的睡眠摘要。两个 Provider 请求在同一次受控 Runtime 调用中完成；任一技术失败都让该
日同步失败并保留安全错误码，不把失败解释成“没有数据”。

持久化只保留步数、可选步数目标、睡眠起止、总时长、深睡/浅睡/REM/清醒时长、可选
睡眠评分和同步时间。步数是截至最近同步的快照；真实零步与字段缺失分别保存。页面只
在今日和日历单日详情显示恢复参考，月历汇总、趋势与 AI 上下文不读取本切片数据。
该链路复用活动凭证和 Python Runtime，但使用独立的 `garmin_wellness` 日期状态、
追赶游标和自动恢复租约。P5a-2b 增加服务端权威的有限追赶：首次从 Tracker 开始日到
计划时区今天，单批最多五天；完成覆盖后重叠两天重新读取近期睡眠和步数。首个失败日
停止并成为下次游标，已成功日期不会回滚。

受保护 App 只在首次在线挂载和离线恢复联网时通过一个协调入口尝试前台恢复。协调器
严格依次请求 activity 和 wellness，各自仍只执行一个有界批次；activity 未到期、跳过
或发生非认证类临时失败不会阻断 wellness，凭证失效才停止当前 App Shell 生命周期。
客户端 60 秒内合并重复触发；首次遇到共享 I/O 租约正忙时只安排一次 60 秒后的完整
协调重试，不忙等或循环重试。服务端以 30 分钟到期和两分钟业务租约抑制多页面并发，
两类业务租约、游标及状态仍完全隔离。普通聚焦、页面可见、路由切换和 Query 刷新不
触发；前台路径不自动循环，也没有为 wellness 增加 Cron。

activity 与 wellness 虽然保持独立业务游标，但会刷新同一份 Garmin Token。所有预览、
单日、追赶和恢复操作因此还要先领取 `tracker + Garmin credential` 共享 I/O 租约；租约
使用随机 owner、两分钟到期和 owner 条件写回/释放。只有当前 owner 可以保存刷新后的
密文；用户导入或替换 Token 会清除租约，使此前已经发出的请求无法覆盖新凭证。租约忙
只表示另一项同步正在进行，不写成认证失败、Provider 故障或失败日期。

## 增量同步与自动恢复

Garmin activity 与 daily wellness 均使用通用的日期同步、追赶游标和外部记录幂等
边界，但各自保存独立的 scope、cursor 和 claim：

- 手工追赶和前台恢复每次最多处理五天；首次范围只从 Tracker 开始日到计划时区今天，
  完成首次覆盖后使用两天重叠窗口检查近期修改。
- 前台恢复只在受保护 App Shell 首次在线打开或离线恢复联网时触发；一个客户端协调器
  依次推进 activity 与 wellness，服务端各自使用 30 分钟到期判断和两分钟原子业务租约。
  普通 Tab 切换、聚焦与 Query 刷新不会重复触发。
- activity 与 wellness 的前台恢复每次最多五天，彼此不能抢占或改写业务状态；两类
  Provider I/O 仍由共享凭证租约串行保护。wellness 成功后只精确更新相应今日/单日
  缓存，不修改当前未包含恢复参考的月摘要。
- 每日 Cron 复用同一到期判断、租约、日期状态、游标和 Garmin Runtime，不建立第二套
  队列。它固定只处理 `knee-rehab` 的 activity，每次最多三天，Route 总时限为 45 秒；
  某日失败立即停批，不在同一次 Cron 中重试。
- GitHub 镜像与 Garmin 使用两个独立 Cron，并安排在不同 UTC 小时。Garmin Cron 通过
  Vercel 现有 `CRON_SECRET` 的 Bearer Header 鉴权，在任何数据库、凭证或 Provider
  读取前失败关闭；它不使用用户 Session。
- Cron 只返回跳过原因、本批日期范围、计数、游标和安全错误代码，不返回活动明细、
  Provider 内部 ID、raw payload、Token、Authorization 或第三方错误原文。

Vercel Hobby 当前每项目最多 100 个 Cron，但单个 Cron 最多每日一次，且只提供小时级
精度：例如 `0 21 * * *` 可能在 21:00 至 21:59 UTC 之间运行。因此每日 Cron 是持久
同步状态的尽力修复触发器，不是精确分钟调度、队列或自动重试系统。项目部署后只通过
未授权 401、Route 注册和健康检查做人工门禁；首次授权平台调用必须等待 Vercel 自动
触发并单独观察，不人工携带 Secret 调用。

参考：[Vercel Cron 使用与计费](https://vercel.com/docs/cron-jobs/usage-and-pricing)、
[Vercel Cron 管理与鉴权](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。

## 错误与降级

公开状态只允许以下安全分类，不展示第三方原始响应：

- `invalid_token_bundle`：导入内容无效，停止使用；
- `unsupported_client_version`：需要按受控流程迁移版本；
- `authentication`：Token 已失效或被撤销，需要重新生成；
- `rate_limited`：停止本轮，稍后重试；
- `timeout`、`provider_unavailable`：保留既有数据并按上限退避；
- `invalid_response`：拒绝写入无法验证的数据。

Garmin 故障不能阻止今日计划、任务记录、身体反馈、训记或手工训练兜底。重试使用
通用 Provider 锁、日期状态和幂等外部记录边界，不在 Adapter 内另建队列。

## 版本复核与回滚

- 私有客户端必须固定准确版本；升级前重新检查原仓库变更、安全公告和匿名 Preview。
- 生产使用前需要把 Python 直接依赖和传递依赖锁定，而不是使用浮动的 `latest`。
- 任何版本升级都不得自动迁移真实 Token；先在隔离环境验证旧 bundle 的兼容性。
- 非官方路径失效时，将连接状态降级为“需要处理”，不删除历史记录，并保留 FIT 导入。

## 参考

- [Garmin Connect Developer Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [Garmin Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Garmin FIT SDK](https://developer.garmin.com/fit/get-the-sdk/)
- [Garmin FIT activity decoding](https://developer.garmin.com/fit/cookbook/decoding-activity-files/)
- [python-garminconnect 原始仓库](https://github.com/cyberjunky/python-garminconnect)
- [python-garminconnect 0.3.6](https://github.com/cyberjunky/python-garminconnect/releases/tag/0.3.6)
- [Vercel Python Runtime](https://vercel.com/docs/functions/runtimes/python)
