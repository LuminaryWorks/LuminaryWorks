# Trial 与数据删除政策（工程模板）

**非法律意见（NOT LEGAL ADVICE）。** 工程模板（`lw-legal-v2026-09-07`），说明 LuminaryWorks Hosted SaaS 如何运行 Trial。英文：[Trial and Data Deletion](../en/trial-data-deletion.md)。

相关：[服务条款](./terms.md) · [隐私政策](./privacy.md) · [subscription-and-entitlement.md](../../subscription-and-entitlement.md)

**激活 Trial 必须显式接受本政策的当前版本。** 未接受当前 `policyVersion` 时，平台不得创建 Trial。

## 1. 无永久 Free

不存在长期有效的免费会员。无 Trial、无付费权益时，您仅可登录、查看账单并使用公共演示。

## 2. 哪些产品提供 Trial

| 产品 | Trial |
|------|--------|
| DataLuminary、BlockyEdu、VistaRemote | 每用户每产品一次：**7×24 小时** |
| DoerFlow | **无 Trial**（`trialPolicy=disabled`） |
| VistaCast、SyncroBrain | 就绪前不可售；**在后续正式政策另行规定之前不发放 Trial** |

企业合同与有效私有 License 上下文不发放 ToC Trial。

## 3. 时钟与 `endsAt`

时长为自服务端 `startsAt` 至服务端 `endsAt` 的 **整 7×24 小时**。以服务端时钟为准。产品界面必须展示精确 `endsAt` 与倒计时。重复调用「确保 Trial」不会延长窗口。

## 4. 提醒：T-3 与 T-1

若 Trial 仍有效且您尚未升级：

- **T-3**：`endsAt` 前 3 天通知
- **T-1**：`endsAt` 前 1 天通知

通知可按偏好使用站内信、电子邮件或推送。升级或合格企业权益将 **取消** 待发 Trial 通知与清理任务。

您须在 `endsAt` **之前** 使用导出功能。阻断访问之后再导出不保证成功。

## 5. `endsAt`：立即阻断访问

到达 `endsAt` 后，付费 / Trial 功能 **立即失效**。API 与界面返回权益错误（通常为 HTTP 402）。您仍可登录并查看账户、订单与发票。

物理删除 **不必** 与阻断在同一瞬间完成。

## 6. 异步且不可恢复的删除

阻断后，控制面投递带签名的 `trial.purge` 任务。产品 **异步** 删除。删除 **不可恢复**。清理完成后再付款，**不会** 重建 Trial 文件、录像、Doris 表或上传对象。

任务以 `trialRedemptionId` 与账单 owner 为键，且可幂等。已转移到 **付费组织** 的资源不会按模糊的「创建者」批量删除。

清理前再次确认该产品不存在有效付费订阅。付款与清理使用互斥锁：若已付费则取消清理；若字节已被删除，付款不能伪造数据恢复。

## 7. 删除范围与保留范围

**删除（该 Trial 的产品数据），例如：**

- 该 Trial 下创建的产品私有记录
- 同步任务与检查点
- 该 Trial 的共享 Doris 演示表 / 数据
- 该 Trial 的 MinIO 兼容对象与上传（录像、媒体、附件）

**保留：**

- Logto 身份与组织成员关系
- 订单、支付尝试、发票、退款
- 审计日志
- 用于执行「每用户每产品一次」的 Trial 兑换与用量计数

## 8. Pilot 基础设施

Trial 媒体与文件位于 **无 SLA 的单节点** 对象存储。共享 Doris 为低于厂商最低内存建议的 **Pilot**。容量限制或磁盘水位可能在 `endsAt` 之前停止新的 Trial 上传。这不延长 Trial，也不构成免费归档。

## 9. 版本

生效日：2026-09-07。版本：`lw-legal-v2026-09-07`。
