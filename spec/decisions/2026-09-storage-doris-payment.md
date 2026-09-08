# ADR：对象存储、Doris Pilot 与支付地域（2026-09）

> **状态**：Accepted · **决策日**：2026-09-07 · **工作包**：决策冻结（不改运行时代码）  
> **权威落地**：[subscription-and-entitlement.md](../subscription-and-entitlement.md) · [payment-platform.md](../payment-platform.md) · [legal/](../legal/README.md) · [products/index.md](../products/index.md)

本文是架构与 AI 决策记录。许可证事实以官方文本为准；本文是工程约束，不是法律意见。

## 1. 背景（Context）

Hosted SaaS 需要统一的会员、支付、对象存储与共享分析演示，但不能把控制面绑到公有云对象存储，也不能在单台 OVH 24 GB VPS 上按 Apache Doris 官方生产规格独占内存。旧社区版 `minio/minio` 已停止维护；支付渠道必须按市场启用，且 IP 不能单独充当加密支付合规证明。Trial 不能留下永久免费档，到期必须立即停权并异步永久删除产品数据。

同期约束：

- 会员、价格、订单、支付回调、配额继续由中央 Entitlement 权威；产品只发起结算并执行本地门禁 / 清理。
- 工作区已有未提交的 deploy / remote 改动；本决策只冻结契约，不改 Compose、包或运行时代码。
- DoerFlow 既有权威规范已冻结 `trialPolicy=disabled`；本决策不改变该产品试用政策。

## 2. 决策（Decisions）

### D-STOR-1 · 自建 MinIO 兼容对象存储，禁止公有云 S3 / R2

对象数据使用自建、S3 兼容的 MinIO API。Hosted SaaS 首发与产品同机；后续只更换 MinIO endpoint 迁往独立存储节点，应用契约不变。

**禁止**：Amazon S3、Cloudflare R2、GCS、OSS 等公有云对象存储作为权威数据面。CDN 只缓存回源，不是对象权威。

### D-STOR-2 · Hosted SaaS 使用官方 AIStor Free 单节点

2026 年旧 `minio/minio` Community Edition 已停止维护。禁止继续拉取历史 `minio/minio:latest` 或未固定摘要的社区镜像。

Hosted SaaS 首选官方 [AIStor Free](https://www.min.io/legal/aistor-free-agreement)（协议最近公开更新：2026-01-30）：

- 允许单节点（standalone，无分布式集群 / HA）商业生产使用。
- 无 HA、无 SLA / SLO、无官方生产支持承诺。
- 官方文档明确：AIStor Free **不包含**分布式多节点、复制、对象分层 / lifecycle transition 等企业能力。
- 许可证限制：**不得**向第三方分发、再许可、出租、转售或再分发该软件（全部或部分）。
- 私有化交付 **不得**把 AIStor 受限二进制打进产品包转售。客户必须自行下载、接受 AIStor Free（或其他合法许可证）并安装，或提供自己的 MinIO 兼容 endpoint。

内部仍只依赖 S3 兼容 API（`put` / `get` / `delete` / `head` / `presign` / `listPrefix`）。后续独立节点迁移：停写 → 校验复制 → 切换 endpoint → 回滚窗口。

### D-STOR-3 · CDN 不减少冷数据磁盘占用

浏览器可用短时 presigned PUT 直传；播放走 CDN 域名与短时签名 URL / cookie。MinIO API 与 Console 不直接公网暴露。

CDN **只降低回源带宽与延迟**，**不减少**本地冷数据占用。磁盘水位与配额必须按 MinIO 数据卷计算，不能因为「已接 CDN」而放宽 Trial 录像或对象保留。

建议水位（实现工作包落地，本决策冻结语义）：约 120 GB 硬预算；70% 停止新 Trial 录像；80% 停止所有 Trial 上传；90% 停止非删除类对象写入并告警。超额存储包在独立 MinIO 节点上线前不可售。

### D-DORIS-1 · 按需共享演示，硬上限 25% / 6 GB

Doris 按需启动，不常驻。FE + BE 的 Docker cgroup **合计**硬上限为主机内存 25%（OVH 24 GB → 6 GB）。默认 FE 2 GB、BE 4 GB，限制 2 vCPU、同步并发 1。

**禁止**：为启动 Doris 自动停止 ThingsBoard、媒体、AI、TURN 或其他产品服务。空闲 30 分钟后可关闭 Doris。

Entitlement feature：`analytical.shared_demo`（Trial / Pro / Ultra 默认可申请共享演示）；`analytical.dedicated_service` 仅人工订单 / 销售线索开通，绑定外部 engine endpoint。

第一个请求可返回 `202 DORIS_WARMING`；超时、队列满、OOM 或慢查询返回稳定业务码 `DORIS_DEMO_BUSY`。

### D-DORIS-2 · 低于官方最低规格，只能标 Pilot

Apache Doris 官方环境检查（4.x）将同机开发 / 资源紧张部署的**最低**配置写为约 FE 8 GB + BE 16 GB，生产 FE 建议至少 16 GB。本部署 FE+BE 合计 6 GB，**低于官方最低参考**。

因此：

- 只能标记为 **共享演示 Pilot**，不承诺 HA、SLA、查询时延或数据持久保证。
- 未通过 24 小时混合负载测试前，不得去掉 `pilot` 标识。
- 升级路径：先把 Doris 迁到独立主机并达到官方最低内存；再评估多 BE / 副本；专属实例走 `analytical.dedicated_service`，不在本 VPS 上升级为「生产分析集群」。

### D-PAY-1 · 中央、可配置的支付编排

支付编排在 Entitlement：provider 配置、凭证信封加密、市场路由、验签回调、订单状态机、对账与退款。产品不自行验签、不定价、不持久化支付密钥。

服务端 SKU / offering 决定金额、币种和期限。客户端不得提交 `amountCents` 作为权威价格。付费成功生成带具体 `endsAt` 的 30 / 365 天订阅；续费从 `max(now, currentEndsAt)` 延长。

契约细节：[payment-platform.md](../payment-platform.md)。

### D-PAY-2 · 可信地理路由；IP 不是加密合规证明

地域来源优先使用仅由可信 CDN / Caddy 注入的 `CF-IPCountry` 或连接 IP。回源必须拒绝客户端伪造的转发头。无 CDN 时使用本地 GeoIP。

Hosted SaaS：

- `CN` 默认只展示已启用的支付宝；必要时超管可人工确认例外。
- 海外展示超管已启用的全部渠道。
- Coinbase / OKX / BitPay：同时检查 IP 与账户 billing country；**任一为 CN** 即隐藏并拒绝创建订单（防止仅靠 VPN 绕过）。IP **不能**单独作为加密支付合规证明。

私有化客户可在自己的部署政策中配置市场规则。

### D-TRIAL-1 · 无永久 Free；适用产品 7 天 Trial

不存在永久 `free` / `planCode=free` 套餐。无有效会员的账号只能登录、查看账单与公共演示。

适用产品（`trialPolicy=standard_7d`）提供一次性 7×24 小时 Pro Trial。DoerFlow 继续 `disabled`，本决策不改写既有权威规范。VistaCast / SyncroBrain 可进入中央目录配置，但在产品就绪前 **不可售**，也 **不发放 Trial**。

### D-TRIAL-2 · 到期立即阻断，异步永久清理

`endsAt` 到达后权限同步失效（402）。中央 outbox 投递签名 `trial.purge`；物理删除异步开始。清理前再次确认不存在有效付费订阅。

删除范围：该 Trial 产生的产品私有资源、同步任务 / 检查点、Doris 表、MinIO 对象与上传文件。

**保留**：Logto 身份、订单、支付、审计、Trial 使用 / 兑换记录。

T-3 与 T-1 通知；持续展示倒计时与导出入口。用户对导出自己的数据负责。清理带 `trialRedemptionId` / billing owner，幂等、可重试、可审计；不得按模糊 `creator` 批量删除已转移到付费组织的资源。

首次注册与每个产品第一次激活 Trial 时，必须显式接受当前版本的《服务条款》《隐私政策》《Trial 与数据删除政策》。未接受不得创建 Trial。

## 3. 后果（Consequences）

- Hosted SaaS 对象存储与同机应用争用磁盘 / IO；必须有水位与 Trial 配额，而不是假设 CDN 会「把冷数据带走」。
- 私有化安装包、场景包、产品 pack **不得**内嵌 AIStor 二进制或暗示「开箱即含官方存储引擎」。文档必须写清客户自装或自带 endpoint。
- 共享 Doris 是演示，不是分析 SLA。产品文案与 DataView CTA 必须导向「联系管理员购买专属 Doris」，不得写成已上线的生产数仓。
- 支付渠道代码内置 ≠ 运营启用。没有 live / sandbox 凭证的 provider 不得显示为 enabled。
- Entitlement 种子目录与测试目前仍只含 `dataluminary` / `blockyedu` / `vistaremote` / `doerflow`。本决策允许 `vistacast` / `syncrobrain` 作为**可配置、默认不可售**的目录码；实现工作包再改种子，不得在本文件声称代码已同步。
- 法律文档是工程模板，上线前须由合格律师审阅。

## 4. 风险（Risks）

| 风险 | 缓解 |
|------|------|
| AIStor Free 无 HA：单盘 / 单进程故障导致对象不可用 | 专用数据卷、备份 staging bucket、独立节点迁移出口；不承诺对象 SLA |
| AIStor 许可证变更或终止免费商业使用权 | 固定版本 / 摘要；保留「客户自带 MinIO 兼容 endpoint」逃生舱；不把二进制打进私有包 |
| 误把 AIStor 打进私有化 pack | 打包清单与手册显式排除；私有客户单独接受许可证 |
| 6 GB Doris OOM 拖垮同机控制面 | cgroup 硬限制；禁止停其他服务来让路；失败返回 `DORIS_DEMO_BUSY` |
| GeoIP / CDN 头被伪造导致渠道绕过 | 只信任已配置的入站代理；加密渠道双重检查 billing country |
| Trial 清理误删付费组织数据 | 清理键必须是 `trialRedemptionId` + owner；付款与清理互斥锁 |
| 把「无套餐」写成 Free 档 | 规范禁止 `planCode=free`；UI 用升级 / 公共演示，不用 Free 会员 |

## 5. 许可证事实（License facts）

事实来源为 MinIO 公开文本，**不是**法律意见。实施前以 [AIStor Free Agreement](https://www.min.io/legal/aistor-free-agreement) 与 [AIStor license docs](https://docs.min.io/aistor/operations/licenses/) 原文核对。

| 事实 | 工程含义 |
|------|----------|
| 旧 `minio/minio` CE 已停止维护 | 禁止再用历史 `latest` 社区镜像作为生产对象存储 |
| AIStor Free 允许 standalone 商业生产 | Hosted SaaS 单节点可用，但仅此拓扑 |
| 禁止 distribute / sublicense / rent / lease / resell / redistribute | 私有化 pack **不得**转售或附带该二进制 |
| 无 SLA / SLO | 对外必须披露单节点 Pilot，不得承诺存储可用性 |
| Free 不含分布式、复制、tiering 等企业能力 | 独立 HA 存储节点需要客户自备合法许可证或自有 endpoint |
| 客户须自行下载并接受协议 | 私有化：客户安装 / 接受，或提供 MinIO 兼容 endpoint |

Apache Doris 官方最低参考（4.x 环境检查）：同机紧张部署约 FE 8 GB + BE 16 GB；生产 FE 建议 ≥ 16 GB。本方案合计 6 GB，故只能 Pilot。

## 6. 升级路径

1. **存储**：同机 AIStor Free → 停写与校验复制 → 切换独立 MinIO 兼容 endpoint（客户自有许可证）。应用只改配置，不改 API。
2. **Doris**：保持 Pilot → 独立主机达到官方最低内存 → 可选多 BE / 副本；或开通 `analytical.dedicated_service`。
3. **支付**：先落地 adapter、验签、对账；每个 provider 在取得凭证前保持 `enabled=false`。
4. **售卖边界**：VistaCast / SyncroBrain 就绪并经显式决策后，才把 `sellable` 设为 true 并决定 `trialPolicy`。

## 7. 相关文档

- [subscription-and-entitlement.md](../subscription-and-entitlement.md)
- [payment-platform.md](../payment-platform.md)
- [legal/README.md](../legal/README.md)
- [products/index.md](../products/index.md)
- [composable-deployment.md](../composable-deployment.md)
- 官方：[AIStor Free Agreement](https://www.min.io/legal/aistor-free-agreement) · [Doris env-checking 4.x](https://doris.apache.org/docs/4.x/install/preparation/env-checking/)
