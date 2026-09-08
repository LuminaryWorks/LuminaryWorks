# 法律政策工程模板（Legal policy templates）

> **状态**：工程草案 · **版本**：`lw-legal-v2026-09-07` · **不是法律意见**  
> **关联**：[subscription-and-entitlement.md](../subscription-and-entitlement.md) · [payment-platform.md](../payment-platform.md) · [decisions/2026-09-storage-doris-payment.md](../decisions/2026-09-storage-doris-payment.md)

本目录是 Hosted SaaS **工程契约模板**，供注册与 Trial 激活勾选、Entitlement 持久化 `policyVersion` 使用。  
**NOT LEGAL ADVICE / 非法律意见。** 上线前必须由合格律师按适用法域审阅、本地化并替换占位运营主体。

| 政策 | 中文 | English | 当前版本 |
|------|------|---------|----------|
| 服务条款 | [zh/terms.md](./zh/terms.md) | [en/terms.md](./en/terms.md) | `lw-legal-v2026-09-07` |
| 隐私政策 | [zh/privacy.md](./zh/privacy.md) | [en/privacy.md](./en/privacy.md) | `lw-legal-v2026-09-07` |
| Trial 与数据删除 | [zh/trial-data-deletion.md](./zh/trial-data-deletion.md) | [en/trial-data-deletion.md](./en/trial-data-deletion.md) | `lw-legal-v2026-09-07` |

## 接受与版本

- 首次注册须显式接受当前《服务条款》与《隐私政策》。
- 每个适用产品 **第一次** 激活 Trial 还须显式接受当前《Trial 与数据删除政策》。
- Entitlement 保存 `policyVersion`、`acceptedAt`、`ip`、`userAgent`、`logtoSub`。未接受当前 Trial 政策版本不得创建 Trial。
- 政策 bump 版本后，已注册用户继续使用账号；**再次激活 Trial**（若仍有资格）须接受新版本。DoerFlow 无 Trial，不走 Trial 接受流。

不存在永久 Free 套餐。无会员账号仅可登录、查看账单与公共演示。
