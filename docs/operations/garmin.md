# Garmin 集成

## 文档职责

本文是 Garmin Provider、凭证、运行时、数据范围和故障降级的集成 Runbook。Garmin
在系统中的位置见[系统架构总览](../architecture/overview.md)，通用外部记录见
[数据与同步](../architecture/data-and-sync.md)，关键决策见
[ADR-0009](../adr/0009-garmin-token-runtime-and-fit-fallback.md)。

截至 2026-07-24，P3b-1 只完成契约、安全边界和匿名部署可行性验证；项目尚未接入
真实 Garmin Token，也没有读取任何私人 Garmin 数据。

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
  -> 已鉴权的服务端导入接口（后续切片）
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
- 临时 Python Route、`requirements.txt` 和 `.python-version` 已在验证后删除，不进入
  正式应用或 Production。

上述证据只证明“固定版本可在 Vercel Python Runtime 加载并解析匿名 Token”。以下
内容仍需使用者以后在本机生成 Token 后另行受控验证：

- 真实 Token 是否可在 Vercel 网络环境完成验证和刷新；
- 全球区/中国区账号差异、MFA 后 Token 生命周期和撤销恢复；
- 单日活动接口的真实字段、延迟、限流和 Cloudflare/WAF 行为；
- 刷新后的 Token 能否安全回传给 Node 服务并原子重新加密。

因此 P3b-1 不是“Garmin 已连接”，也不授权使用账号密码在云端重新登录。

## 运行时选择

### Vercel Python Function

当前首选候选。它与现有项目同平台，Preview 已证明 Python 3.12、固定客户端及
`curl_cffi` 可以构建和启动。Vercel 官方仍将 Python Runtime 标为 Beta；正式 Adapter
还需要一个只允许 Node 服务调用的认证边界、请求上限、超时和 Token 轮换协议。

### 独立受控 Worker

如果真实 Token 在 Vercel 上遇到网络、WAF、运行时体积或生命周期问题，再把相同
`GarminClient` 实现移到独立 Worker。它能隔离 Python 依赖和故障，但会增加一套部署、
鉴权、监控和密钥轮换，因此不在没有实证问题时提前引入。

### FIT 文件导入

这是不依赖非官方登录的稳定兜底。官方 JavaScript FIT SDK 可直接在现有 Node 运行时
解码活动文件，适合活动时间、时长、距离、配速和心率；它不能替代自动睡眠和步数。

下一切片应在“Token-only 单日只读验证”和“FIT 导入”之间由项目经理择一。若继续
自动路线，先验证一日匿名化投影，不直接展开历史追赶同步。

## 数据职责

- Garmin：活动开始时间、时长、距离、配速、心率；以后按必要性增加基础步数和睡眠。
- 训记：力量训练动作、重量、单位、组次、完成状态和备注等精确信息。
- 同一训练可以同时拥有 Garmin 活动证据和训记力量明细，使用者决定如何关联。
- Garmin 记录只能提供关联建议，绝不能自动把康复任务改成完成。
- 卡路里、身体成分、Body Battery、压力、血氧等当前无明确用途的数据不进入项目。

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
