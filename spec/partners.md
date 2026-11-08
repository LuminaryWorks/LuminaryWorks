# 合作产品注册与伙伴权限

> **状态**：工程契约 · **注册表**：[`contracts/partners.manifest.json`](../contracts/partners.manifest.json)  
> **关联**：[domain-and-branding.md](./domain-and-branding.md) · [products/index.md](./products/index.md) · [identity-and-permissions.md](./identity-and-permissions.md) · [legal/README.md](./legal/README.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md)

LuminaryWorks 是平台。DataLuminary、BlockyEdu、DoerFlow、VistaCast、VistaRemote、SyncroBrain 是六家合作产品，各有自己的运营方、域名和条款。本文件是接入下一家合作产品的唯一清单。平台自己不是表里的一行。

`@luminaryworks/control-manifest` 只描述部署形态（standalone / control-plane / …）。它不是合作方目录。

## 1. 注册表

| 文件 | 作用 |
|------|------|
| `contracts/partners.manifest.schema.json` | 字段契约 |
| `contracts/partners.manifest.json` | 六家现行合作产品 |
| `scripts/partner-onboard.mjs` | 校验、干跑清单、仅在明确占位符时追加 OIDC 模板 |

每行字段：`code`、`displayName`、`operatorLabel`（法定名称未提供前用品牌）、`domains`、`githubOrg`、`oidcApps`（只引用 `identity/apps.json` 里已有的应用名和 redirect，不写 client secret）、`entitlementProductCodes`、`aiServiceCredentialHint`（只绑定 `productCodes`）、`legalTermsUrl`、`legalPrivacyUrl`、`supportEmail`、`statusPageUrl`（可空）、`sellable`、`status`（`active` | `suspended` | `retired`，省略时为 `active`）。

`status` 与 Entitlement 产品生命周期用同一组词。注册表里的值是期望状态；线上开关是 Entitlement 里该产品行的 `status`。本命令不调用那个接口。熔断、停登录和停托管 AI 的操作步骤在 [`deploy/OPERATOR.md`](../deploy/OPERATOR.md) §13。

现行事实（与 [products/index.md](./products/index.md) 和 Entitlement `SELLABLE_OFFERING_PRODUCT_CODES` 一致）：

| code | 可售 | Trial | 公开站点 | GitHub 组织 |
|------|------|-------|----------|-------------|
| `dataluminary` | 是 | 7 天 | dataluminary.dev | DataLuminary |
| `blockyedu` | 是 | 7 天 | blockyedu.com | BlockyEdu |
| `doerflow` | 是 | 无 | doerflow.dev | DoerFlow |
| `vistacast` | 否（可配置，就绪前不可售） | 无 | vistacast.dev | VistaCast |
| `vistaremote` | 是 | 7 天 | remote.vistacast.dev | VistaRemote |
| `syncrobrain` | 否（可配置，就绪前不可售） | 无 | syncrobrain.com | SyncroBrain |

VistaRemote 没有独立主域名。`remote.vistacast.dev` 是官网；应用主机名来自 `identity/apps.json` 与 `deploy/luminaryworks-install/hosts.defaults.json`。不要写成 `vistaremote.dev`。

`operatorLabel` 目前等于品牌。法律模板里的运营主体仍是占位符，本文不发明公司法定名称。`supportEmail` 与 `statusPageUrl` 在合作方公布之前保持 `null`。不要把平台信箱 `admin@luminaryworks.dev` 抄到合作产品行上。条款 URL 用该产品站点上的默认路径 `/legal/terms` 与 `/legal/privacy`（登录条款规则），不是一份已核验的线上页面声明。

[website-design.md](./website-design.md) §03 仍把 VistaCast、SyncroBrain 写成「正式可售」。目录以本注册表的 `sellable: false` 为准。官网代理改卡片时要跟着注册表，不要跟着那段旧表。

## 2. 一条命令

```bash
pnpm partner:onboard -- --list
pnpm partner:onboard -- --check <code>
pnpm partner:onboard -- --plan <code>
```

`--plan` 是默认干跑。它会：

1. 用 schema 校验注册表。
2. 核对 `identity/apps.json` 是否已有列出的应用。SPA 比对 redirect / post-logout；API 比对 `indicator`；M2M 比对 `resourceIndicator` 与公开 scope 名。缺应用时只打印要追加的片段。
3. 打印 Entitlement `POST /v1/admin/catalog/revisions` 的种子。**不写价格**。`amountMinor` 留空，`readyToPost` 为 false。运营自己填整数金额后再 POST。不可售或非 `active` 的行不给 SKU。
4. 打印 `AI_PLATFORM_SERVICE_PRODUCT_CODES` 和 `AI_PLATFORM_SERVICE_CREDENTIALS_JSON` 里的一条。`key` 用占位符 `<set outside git>`。密钥放环境或密钥库，不进 Git。
5. 打印 Account Center `ACCOUNT_CENTER_APPS_JSON` 卡片：`{code,name,url,description}`。URL 用公开站点，不猜 localhost 端口。
6. 打印官网产品卡字段（品牌、中文名、角色、一句话、chips、可售、Trial、条款、源码）。文案来自现有规格；没有文案的新产品留空，不编营销句。
7. 打印要在 Logto 创建的 scope。

`--write-apps <code>` 只有在缺应用、且该应用的 `clientId` 正好是 `PUBLIC_CLIENT_ID_PLACEHOLDER` 时，才把公开模板追加进 `identity/apps.json`。写入前会再读一次文件。已有应用不改。模板里不写 `clientId`，也不写 secret。六个现行产品的 `clientId` 都是 `null`（公开 client id 在 `identity/registered-apps.json`，由 `pnpm id:register` 产生），所以对它们运行 `--write-apps` 不会改文件。

## 3. 平台管理员与合作方运营

两类主体：

| 主体 | 谁 | 持有的 scope |
|------|----|----------------|
| 平台管理员 | LuminaryWorks 控制台超管 | `entitlement:admin`、`ai:admin` |
| 合作方运营 | 某一家产品的运营人员 | 只持有下面三枚属于自己 `productCode` 的 scope |

对每个 `productCode`：

| Scope | API resource | 允许 |
|-------|--------------|------|
| `partner:<productCode>:orders:read` | `https://entitlement.luminaryworks.dev` | 读该产品订单 |
| `partner:<productCode>:catalog:read` | 同上 | 读该产品目录 |
| `partner:<productCode>:ai:usage:read` | `https://ai.luminaryworks.dev` | 读该产品 AI 用量 |

`entitlement:admin` 可以读订单和目录，**不能**代替 `ai:admin` 读 AI 用量。`ai:admin` 也不能读订单。两枚都只给平台管理员。

合作方运营不能发布目录（`catalog.revision.publish` 仍要管理员）、不能改别的产品、不能拿 `partner:dataluminary:*` 去读 VistaCast。

这和 Entitlement 里已经存在的两套 scope 不是一回事：

- `entitlement:catalog:<productCode>`（`catalog-scope.ts`）是目录编辑范围，不是合作方只读。
- `partner:redeem`、`partner:revoke`、`partner:reconcile` 是兑换码 M2M（`RequirePartnerScopes`），不是运营人员的订单 / 用量 / 目录只读。

参考实现（纯函数，尚未接进 Entitlement Guard）：

```text
scripts/lib/partner-scopes.mjs
assertPartnerOrAdmin(principal, productCode, action)
```

`action` 为 `orders:read` | `ai:usage:read` | `catalog:read`。`kind` 为 `admin` 或 `service` 时放行，与现有 `AuthGuard` 一致。其余主体必须持有 `partner:<productCode>:<action>`；若 token 上有 `partnerCode`，还必须等于这个 productCode。

**本工作流没有改 `services/entitlement/src`。** Guard、生命周期和审计写入已经由停用开关那一侧占用。接线时把上述函数的规则放进 Guard，不要另写一套。

### Logto 里要创建的 scope

运营在 IdP 创建，不把 secret 写进 Git。

1. Entitlement API（`identity/apps.json` 已有，indicator `https://entitlement.luminaryworks.dev`）在保留 `entitlement:admin` 与 `entitlement:read` 的同时，为每个产品追加 `partner:<productCode>:orders:read` 和 `partner:<productCode>:catalog:read`。
2. AI Platform 的 audience 是 `https://ai.luminaryworks.dev`（`AI_PLATFORM_OIDC_AUDIENCE`）。资源若还没登记，按 Account Center README 的公开 indicator 补一条，再追加 `ai:admin`（仅平台管理员）和 `partner:<productCode>:ai:usage:read`。
3. 合作方角色只绑自己的三枚 scope。平台管理员角色绑 `entitlement:admin` 与 `ai:admin`。
4. 然后 `pnpm id:register`。不要把 client secret 写入 `apps.json` 或本注册表。

## 4. 审计

停用开关和合作方动作都进 **现有** `AuditService.record`（表 `audit_logs`）。不要新建日志表，也不要在本仓做审计 UI。控制台读取已有接口：

`GET /v1/admin/audit`（`entitlement:admin`；可用 `actor`、`action`、`resourceType`、`resourceId` 过滤）

已经落在这条流上的停用开关动作，控制台应直接显示，不要再发明平行动作名：

| action | 何时 | payload |
|--------|------|---------|
| `product.lifecycle` | 产品 `active` / `suspended` / `retired` 切换 | `productCode`、`previous`、`status` |
| `product.force_revoke` | 提前切断该产品已付费访问 | `productCode`、`ordersTouched`、`orderIds` |

合作方只读落地时，仍调用同一个 `AuditService.record`，建议动作名：

| action | resourceType | payload |
|--------|--------------|---------|
| `partner.orders.read` | `order` | `partnerCode`、`productCode` |
| `partner.catalog.read` | `catalog` | `partnerCode`、`productCode` |
| `partner.ai.usage.read` | `ai_usage` | `partnerCode`、`productCode` |

AI 用量如果由 AI Platform 提供，写入方仍应落到 Entitlement 这条 `audit_logs`，而不是新开一条只给控制台用的流。兑换码侧已有 `partner.register`、`partner.redemption.create`、`partner.redemption.revoke` 等动作，保持不动。

## 5. 留给其他工作流

| 工作流 | 还要做的事 |
|--------|------------|
| Control Console | 按 `GET /v1/admin/audit` 展示 `product.lifecycle`、`product.force_revoke` 和上面的 partner 读动作。不要新做一套审计产品。官网卡片用 `--plan` 打印的字段，VistaCast / SyncroBrain 跟随 `sellable: false`。 |
| Account Center | 把 `--plan` 的卡片合并进 `ACCOUNT_CENTER_APPS_JSON`。 |
| Entitlement 停用开关 | 把 `assertPartnerOrAdmin` 接进 Guard；在对应读接口上调用 `AuditService.record`。不要改兑换码 scope 的含义。新产品 code 要进 `PRODUCT_CODES` 后才能进目录校验。 |
| AI Platform | 校验服务凭证的 `productCodes` 与注册表一致；`ai:admin` 与 `partner:<code>:ai:usage:read` 分开。密钥不进注册表。 |
| 官网 | 产品卡字段以 `--plan` 的 website 段为准。 |
