# Garmin 集成

## 文档职责

本文是 Garmin Provider、数据范围、同步作业、认证和故障处理的集成 Runbook。
Garmin 在整体系统中的位置见[系统架构总览](../architecture/overview.md)，通用外部
记录和同步状态见[数据与同步](../architecture/data-and-sync.md)。

## 接入方式

现有个人自动化证明“云端直接读取、不经过 Mac mini”在技术上可行，但旧结论中
依赖的 Garth 已停止维护；Garmin 修改登录流程后，新登录不再工作。已有 OAuth1
Session 可能在有效期内继续使用，但不能作为长期唯一基础。

接入采用三层可替换策略：

1. **官方目标**：申请 Garmin Connect Developer Program 的 Activity/Health
   API；获批后作为长期 Provider。
2. **私人试验适配器**：评估仍在维护的非官方客户端，并固定版本、隔离部署、
   加密保存 Token。任何登录变化都视为预期故障，而不是核心应用故障。
3. **文件兜底**：支持 Garmin 导出的 FIT 和活动 CSV；第三方接口失效时仍能导入
   训练数据。

当前可对 `python-garminconnect` 的原生 Token 版本做部署 Spike，但其使用非官方
接口，不能据此承诺长期稳定。Vercel Python Runtime 仍处于 Beta，依赖和二进制
兼容性必须通过真实部署验证；不合适时可把同一适配器放到独立云端 worker。
Next.js 业务层始终只依赖稳定的 `GarminClient` 契约。

首次认证优先在受信任本机完成，只把生成的 Session/Token 通过受控流程写入服务
端；不在网页、日志或数据库长期保存 Garmin 密码。Token 使用 AES-GCM 等认证
加密后保存，刷新结果需要原子替换。

## 膝关节模块同步范围

同步与下肢负荷相关的活动：跑步、步行、徒步、骑行、游泳和力量训练。按可用性
保存时间、时长、距离、配速、心率、步数/步频、爬升/下降；游泳可保存泳姿。
此外保存每日总步数和步行距离。

睡眠只保存用于恢复背景的基本信息：入睡时间、醒来时间、总时长、睡眠评分和
清醒时长。暂不同步卡路里、身体成分、Body Battery、压力、血氧、呼吸等与当前
康复判断关系弱的数据。

Garmin 和睡眠都只是辅助证据。它们可以提示某项任务可能已完成，但不能改变
任务状态；用户确认关联并勾选后才算完成。

## 同步规则

- 首次从计划开始日期同步到现在。
- 后续从最近成功时间减两天同步到现在，支持分页和幂等 upsert。
- 每日自动运行一次，“立即同步”使用同一窗口算法。
- 记录最近尝试、最近成功、游标和脱敏错误代码。
- Session/token 必须认证加密保存；失效时明确提醒重新授权。
- 不在日志、GitHub 或浏览器中保存密码、Cookie 或明文 token。

## Worker 与 API 边界

```text
manual sync / daily cron
  -> acquire per-provider lock
  -> Garmin adapter or import parser
  -> normalize + validate
  -> idempotent ingestion API
  -> PostgreSQL external_records
  -> association suggestions
```

- “立即同步”与每日自动同步使用同一窗口算法；按钮不是另一套抓取逻辑。
- Worker 可以运行在 Vercel Python Function 或独立受控执行环境，但不把临时文件
  当持久 Token 存储。
- 自动任务持有 provider 级锁，避免 Cron 和手动同步同时运行。
- 抓取层保存脱敏原始响应哈希和 provider record ID；领域层只接收白名单字段。
- 每批分页提交，单页失败可从游标重试，不需要重抓全部历史。

## 失败与降级

- 超过一天没有成功且最近一次尝试失败时显示弱提醒。
- Token 失效升级为重新授权；429/5xx 使用退避，不反复尝试登录。
- 非官方登录彻底失效时自动切换为“需要导入或等待修复”，不影响任务和反馈。
- 文件导入显示来源、覆盖日期和去重预览，用户确认后入库。
- Garmin 活动、睡眠或步数缺失不能阻止 AI 分析，AI 必须明确其证据不完整。

## 当前风险记录

- Garth 已弃用，新登录失效；只能迁移现有 Session，不能新建长期依赖。
- 维护中的替代客户端仍属于非官方接口，可能受登录、MFA、限流和上游条款影响。
- Garmin 官方 API 需要申请；Health API 面向获批集成，不能假定个人项目自动
  获得生产权限。
- Vercel Hobby Cron 适合每日同步，但执行时间可能在目标小时内漂移。

## 参考

- [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/)
- [Garmin Health API](https://developer.garmin.com/gc-developer-program/health-api/)
- [Garmin activity export](https://support.garmin.com/en-US/?faq=W1TvTPW8JZ6LfJSfK512Q8)
- [Garth deprecation notice](https://garth.readthedocs.io/en/latest/)
- [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
- [Vercel Python Runtime](https://vercel.com/docs/functions/runtimes/python)
