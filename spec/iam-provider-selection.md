# IAM Provider 选型（已冻结）

> **状态**：Accepted · **决策日**：2026-09-01  
> **不要再把「Logto vs ZITADEL」当作开放决策。**  
> 权威规格：[identity-and-permissions.md](./identity-and-permissions.md)

## 冻结结论

| 项 | 决定 |
|---|------|
| **默认统一登录中心** | **Logto**（OSS，协议 **MPL-2.0**，开发与自托管更简单） |
| **现在要不要换成 ZITADEL** | **不要。** 不迁移 `identity` compose，不把 AGPL 组件打进默认可售私有化包 |
| **抽象层** | 产品只谈 **Luminary IAM Adapter**。用 `IAM_PROVIDER` 选择插件，而不是改产品代码 |
| **ZITADEL 的位置** | **预留插件**。仅当企业客户明确需要复杂 Delegated Administration / Identity Brokering / 企业 IAM 管理，再实现真实插件 |
| **私有化接客户 IdP** | 优先 `IAM_PROVIDER=oidc`（`IDP_MODE=external_oidc`），直连客户 Entra / Okta / Keycloak，不必捆绑 ZITADEL |

```text
LuminaryWorks IAM Adapter   ← 产品只依赖这一层
       │
       ├── logto          默认 · 已交付（MPL-2.0）
       ├── oidc           已交付 · 标准 Hosted OIDC（企业 IdP）
       └── zitadel        预留插件 · 登录可走 Hosted OIDC；Management 尚未交付
```

## 为什么默认是 Logto（不再重评）

1. **协议**：MPL-2.0，适合自营 SaaS 与闭源私有化交付；ZITADEL v3 为 AGPL-3.0，默认私有化包不捆绑。
2. **开发成本**：Experience API Headless 已接入 `@luminaryworks/auth-react`；identity compose、应用注册、seed 已按 Logto Management API 落地。
3. **能力事实**（避免错误前提）：
   - Logto OSS **已支持**企业 SAML/OIDC SSO（作为 SP：按客户 Connector、域名路由、JIT）。
   - Logto OSS **没有**完整 SCIM 2.0（路线图 Planned）。需要 SCIM 时：自建同步、走客户 IdP，或以后做 ZITADEL 插件——**不是现在换掉 Logto 的理由**。
   - IdP-initiated SSO、把 Logto 当 SAML IdP 的应用数量等，属于 Cloud / 配额差异，不改变默认选型。

## 如何选择（运维开关）

| `IAM_PROVIDER` | 登录 UI | 后端验签 | 中央 Management | 状态 |
|----------------|---------|----------|-----------------|------|
| `logto`（默认） | Experience Headless | Logto claims preset | Logto Management API | 已交付 |
| `oidc` / `external_oidc` | Hosted Redirect | 标准 OIDC JWKS | 不支持（`IDENTITY_CAPABILITY_UNSUPPORTED`） | 已交付 |
| `zitadel` | Hosted Redirect（标准 OIDC） | 标准 OIDC JWKS | **未交付**；identity bootstrap 拒绝 | 预留插件 |
| `legacy` | 无统一登录 | HS256 开发 JWT | 无 | 仅开发 |

兼容别名：`IDP_MODE`（产品后端旧变量）。同时存在时 **`IAM_PROVIDER` 优先**。

SPA：`VITE_IAM_PROVIDER` / `PUBLIC_IAM_PROVIDER`。Auth Gateway：只改 `UPSTREAM_ISSUER`，产品不必绑厂商 SDK。

## 何时才实现 ZITADEL 插件

全部满足再开工，且只加插件、不替换默认：

- 付费企业合同写明需要 Delegated Administration / 复杂 Identity Brokering / 超出 Logto OSS 的 IdP 管理面；
- 客户接受 AGPL 或单独采购/托管 ZITADEL，**不**把 AGPL 打进默认闭源安装包；
- 实现真实 `IdentityManagementProvider` + 必要 Experience 能力，禁止空 adapter。

在此之前，选 `IAM_PROVIDER=zitadel` 的语义是：**按标准 OIDC Hosted Redirect 登录**（若 issuer 指向 ZITADEL），管理面明确 unsupported。

## 非目标

- 不把 Entitlement / Casbin 迁进任一 IAM 厂商。
- 不在产品仓调用 Management API。
- 不为 Casdoor / Keycloak / Entra 等未接入厂商做空 adapter。
- 不把「Logto OSS 没有企业 SAML」当作事实（该说法已核实为误）。
