# AI 计划调整

## 文档职责

本文是外部 AI 如何参与计划调整的权威架构说明，负责最小上下文、Provider 契约、
结构化 Proposal、校验、确认、版本和失败边界。系统端到端流程见
[系统架构总览](overview.md)，交付状态见[项目计划](../project-plan.md)。

## 受约束的变更能力

AI 不是数据库操作者。DeepSeek 只接收最小化上下文并返回 `PlanChangeProposal`，
其操作限定为增加任务、替换任务、移除任务或修改计划备注。返回结果必须通过
Zod Schema、安全规则和当前计划版本检查。

```text
反馈/执行数据
  -> 确定性安全分级
  -> 最小化 AI 上下文
  -> DeepSeek 结构化建议
  -> Schema + 安全规则校验
  -> 差异预览
  -> 使用者接受/拒绝
  -> 软件生成新的不可变计划版本
```

AI 不获得 PostgreSQL、GitHub、Garmin 或部署环境凭证。接受按钮调用的是应用
自己的计划变更服务，不是让 AI 直接执行工具调用。

## Provider 与结构化输出

AI 层通过 `PlanAdvisor` 适配器调用 OpenAI-compatible API，服务端配置至少包含
`baseUrl`、`apiKey`、`model`、超时和最大输出长度。领域代码不引用具体模型名。

DeepSeek 支持 JSON Output，但官方文档仍要求提示词包含 `json` 和输出示例、请求设置
`response_format: { type: "json_object" }` 并合理配置 `max_tokens`，同时说明 JSON
Output 偶尔可能返回空内容。因此实现必须：

1. 明确请求 JSON，提供最小输出示例，并且不向模型开放工具调用。
2. 对空内容、截断、非法 JSON、未知操作和越界字段分别记录错误代码。
3. 使用 Zod 重新校验，不直接执行模型返回的函数名或参数。
4. 模型名、超时和最大输出长度全部配置化并记录到建议；模型升级不改变历史建议的
   解释。

Provider 模型名和能力是部署配置，不属于领域规则。部署时从官方文档选择当前模型，
通过环境变量更新，并在切换前运行结构化输出契约测试；历史建议继续保留当时使用的
模型标识。

## 请求生命周期

```text
saved feedback/training
  -> persisted analysis job
  -> bounded provider attempt
  -> provider response stored with redaction/hash
  -> schema and safety validation
  -> proposed / failed / expired
```

- 保存原始反馈成功后才允许创建 AI 任务。
- 第一版由用户明确点击“分析并生成建议”，避免无意义费用和重复建议。
- 第一版先持久化任务，再在发起请求中执行一次有超时上限的 Provider 调用；页面显示
  运行状态，但不承诺离开页面后仍能在后台完成推理。
- 页面离开或请求中断不会删除任务；未完成、超时、限流或服务过载保留可重试状态；
  认证、余额或配置错误保留明确状态，修复配置后由使用者重新发起，不会重放用户
  原始写入。
- 只有出现明确的跨页面持续运行需求时才增加持久任务队列或独立 Worker；执行器改变
  不改变任务、Proposal、校验和人工确认契约。
- 发送给第三方的上下文只包含必要的计划片段、近期结构化事件和规则摘要，不包含
  姓名、GitHub login、仓库、原始医疗文档或外部 Token。

## 安全优先级

1. 明确的医嘱和人工维护的红黄绿规则。
2. 当天与 24 小时后的疼痛、肿胀和功能反馈。
3. 人工确认的实际训练记录。
4. Garmin 活动、基础睡眠和训记力量训练明细等带来源的辅助证据。
5. AI 推理结果。

AI 不能把红灯改成黄灯或绿灯。红灯建议不能自动应用；页面应转为停止相关训练、
记录情况和寻求专业判断的流程。所有建议保存使用的基础计划版本、输入摘要、模型
标识、输出、校验结果和人工决定，以便审计和回滚。

## 并发与过期

建议同时绑定 `basePlanVersionId` 和创建时的计划时间线头。若等待确认期间新增任何
计划版本，即使新版本尚未生效，旧建议也会标记为过期并要求重新分析，避免基于旧
时间线的修改覆盖或随后被未来版本覆盖。

出差、临时器械不足和暂停优先使用确定性执行上下文，不要求 AI 每天重写计划。
只有返程接续、连续反馈或阶段评估确实影响未来任务时才创建调整建议。

## 参考

- [DeepSeek API compatibility](https://api-docs.deepseek.com/)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [DeepSeek Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion)
