# LuminaryWorks 身份与权限体系（Identity & Authorization）

> **状态**：Accepted · **决策日**：2024-04-24 · **修订**：2024-05-08（`HeadlessLoginPanel.showSocialConnectors`）  
> **关联**：[ecosystem-refactoring.md](./ecosystem-refactoring.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md) · [identity 仓](https://github.com/LuminaryWorks/identity) · 开发者文档 [unified-login](https://github.com/LuminaryWorks/docs)

## 0. 决策摘要（TL;DR）

| # | 决策 | 落地 |
|---|------|------|
| D-IAM-1 | **Logto** 作为全生态唯一 IdP（OIDC） | `LuminaryWorks/identity` Docker 服务 |
| D-IAM-2 | 登录 UI 采用 **Experience API（Headless）**，各产品自建品牌登录页 | Passport / 产品登录 SPA，不 fork Logto 体验层 |
| D-IAM-3 | **认证与授权解耦**：Logto 只管身份与产品准入；业务资源权限由各产品自管 | AuthN ≠ AuthZ |
| D-IAM-4 | 产品资源权限引擎采用 **Casbin**（`node-casbin`），NestJS 集成 | 各产品本地 PermissionService |
| D-IAM-5 | 远期规模化（类 PowerBI）可迁 **OpenFGA**；现阶段 Casbin 足够 | 模型保持 `sub / obj / act` |
| D-IAM-6 | **商业套餐 / 配额 / License** 不由 Logto 或 Casbin 承载 | 见 [subscription-and-entitlement.md](./subscription-and-entitlement.md) |

核心原则：**身份统一，权限解耦；品牌独立，体验一致。商业权益中央化，资源 ACL 产品私有。**

## 1. 架构分层

检查顺序（产品 API 强制）：**Logto AuthN → Entitlement（商业能力）→ Casbin（资源 ACL）**。  
商业权益契约以 [subscription-and-entitlement.md](./subscription-and-entitlement.md) 为唯一权威；本文只定义身份与**资源**权限边界。

| 层级 | 负责模块 | 核心能力 | 实现载体 |
| --- | --- | --- | --- |
| 统一身份层 | 全局用户管理 | 认证、SSO、租户/组织、产品准入 | Logto（中心 / 私有化） |
| 商业权益层 | 跨产品订阅与配额 | Trial / Pro / Ultra / 企业 seat / 私有 License / 联合会员 | 中央 Entitlement 服务（非 JWT） |
| 产品权限层 | 各产品独立权限 | 角色、资源 ACL、数据范围 | Casbin + 产品 PermissionService |
| 数据隔离层 | 各产品业务库 | 租户隔离、行级过滤 | `tenant_id` + 拦截器 |

```text
+-----------------------------------------------------------------------------------+
|                         LuminaryWorks 统一身份层                                   |
|                    Logto (IdP / OIDC) + Experience API                             |
|  Users · Credentials · Enterprise SSO · Organizations · App Access                 |
+-----------------------------------------------------------------------------------+
                                        |
                 OIDC / OAuth 2.0 (JWT Access Token & ID Token)  ← 不含商业 entitlements
                                        |
                    +-------------------+-------------------+
                    | 中央 Entitlement（套餐 · 配额 · License）|
                    +-------------------+-------------------+
                                        |
  +-----------------+-------------------+-------------------+-------------------+
  |                 |                   |                   |                   |
  v                 v                   v                   v                   v
[DataLuminary]  [BlockyEdu]         [DoerFlow]         [VistaCast]         [VistaRemote/SyncroBrain]
-------------------------------------------------------------------------------------
各产品 Casbin 权限引擎 (RBAC / ABAC / ACL)
  - 映射 Logto `sub` → 本地 `user_id` / profile
  - Roles / Permissions / Resource Domains 产品私有
  - 不把商业 feature 塞进 Casbin matcher，也不从 JWT 读取
```

1. **AuthN（Who you are）**：Logto 统一。密码 / 验证码 / 社交 / 企业 SAML·OIDC SSO 均由 Logto 校验并签发 JWT。
2. **Entitlement（What you paid for）**：中央服务。Trial / 订阅 / 配额 / seat / 签名 License；**禁止**写入 Access Token。
3. **AuthZ（What resource you may touch）**：各产品 Casbin。BI 仪表盘、设备通道、课程班级等模型差异大，禁止塞进统一 IAM 或权益表。

## 2. Logto 边界

**管**：账号、登录方式、企业租户归属、可访问产品列表、平台级角色、账号生命周期。  
**不管**：产品内按钮/菜单、业务数据可见范围、具体资源操作权限、**商业套餐 / Trial / 配额 / License**（归 Entitlement）。

在 Logto 为 **6 产品 + 主门户** 各建独立 Application（`client_id`），独立回调/登出地址；登录任一应用后访问其他应用可免登（生态 SSO）。

统一账户模型：全局主键为 Logto `sub`；各产品维护本地 profile（`externalUserId` / `logtoSub` 映射），会员事实由中央 Entitlement 提供，而非各产品自建平行会员主库。

## 3. 登录页方案：Experience API（Headless）

| 方案 | 结论 |
| --- | --- |
| 直接改 Logto 源码 | 升级冲突，不采用为默认路径 |
| Logto 官方 UI 定制 | 可作过渡，品牌深度不足 |
| **Experience API Headless** | **长期默认**：自研登录 UI + 官方认证状态机 |
| 自研完整 IAM | 禁止 |

### 3.1 Experience API vs Management API

| | Experience API | Management API |
| --- | --- | --- |
| 用途 | 自定义登录/注册/找回/MFA/SSO 前端 | 用户/应用/租户运维 |
| 调用端 | 浏览器（经 Auth Gateway 或官方 SDK） | **仅后端**，不可暴露前端 |
| 流程 | 官方封装状态机 | 原子 API，流程自管 |

**Headless 登录 99% 场景只用 Experience API。**

### 3.2 推荐调用链（禁止产品直连 Logto Experience）

```text
Product SPA  →  Luminary Auth SDK (@luminaryworks/auth-react)
                    →  Auth Gateway（OIDC 反代 / 产品识别 / 白标 / 风控 / 审计）
                         →  Logto | Auth0 | Keycloak | Cognito | 企业 IdP
```

**落地（MVP）**：
- 前端 SDK：`@luminaryworks/auth-react`（`HeadlessLoginPanel` + OIDC PKCE）
- 本地同域代理：`@luminaryworks/auth-dev-proxy`（产品 SPA 代理 `/oidc` + `/api/experience`，无需强制启动 Auth Gateway）
- 多产品 / 生产网关：`LuminaryWorks/services/auth-gateway` — 将产品 `issuer` 固定为 Gateway（默认 `:3010/oidc`），通过 `UPSTREAM_ISSUER` 切换真实 IdP

| 部署 | 产品看到的 Experience / issuer | Upstream |
|------|-------------------------------|----------|
| 本地开发 | SPA origin + `@luminaryworks/auth-dev-proxy` | 中心 Logto `:3001` |
| SaaS 标准 | Auth Gateway | 中心 Logto |
| 私有化 + 自托管 Logto | Auth Gateway（或直连） | 客户 Logto（接 AD/飞书/钉钉…） |
| 私有化 + 企业 OIDC | Auth Gateway | Azure AD / Okta / … |

本地开发推荐：`AUTH_EXPERIENCE_URL=<SPA origin>` + `@luminaryworks/auth-dev-proxy` 直连 Logto `:3001`。生产与可售私有化包默认经 Gateway。注册、找回、MFA、企业 SSO 均走 IdP / Experience 能力，勿自造认证状态机。

**默认登录心智**：各产品登录页以「统一账号 / 企业 SSO」为主 CTA；本地账密仅 `ALLOW_LOCAL_LOGIN` 开发折叠入口，生产关闭。

### 3.3 多品牌

每个产品独立登录前端（或同一 Passport 按 `client_id` 切换品牌）：Logo、主色、文案、可选登录方式均可不同；认证逻辑复用 Experience API。

### 3.4 社交登录开关（管理后台）

`@luminaryworks/auth-react` 的 `HeadlessLoginPanel` 默认展示 IdP 已启用的 **Experience social connectors**（Google / GitHub 等）。

| 场景 | 配置 |
|------|------|
| 面向终端用户的产品登录 | 默认 `showSocialConnectors`（或不传，等价 `true`） |
| 管理后台 / 内部控制台 | **`showSocialConnectors={false}`** — 不拉取、不渲染社交按钮 |

等价写法：`socialProviders={[]}`。企业 SSO（SAML / 企业 OIDC）在 IdP Connector 配置，**不**由该 prop 控制。

实现与文案约定见开发文档 [unified-login §社交登录可关](https://github.com/LuminaryWorks/docs/blob/main/docs/develop/unified-login.md)。

## 4. Casbin 产品权限

企业级资源 ACL（Dashboard / Dataset / 课程 / 设备…）自研成本接近权限引擎产品。选型：

| 方案 | 推荐度 | 原因 |
| --- | --- | --- |
| **Casbin** | ★★★★★ | 轻量，NestJS 易集成，`sub/obj/act` 贴合现有权限 JSON |
| OpenFGA | ★★★★☆ | 长期企业级；规模上来后再迁 |
| Permify / Oso / CASL | 备选 | 按产品评估 |

模型：`Subject` · `Object` · `Action` ↔ `user` · `resource` · `permission`。

API 响应约定（前端按钮显隐）：资源对象上附带 `permissions: { view, edit, delete, ... }`，由 `PermissionService` 用 Casbin 计算后组装，**不把业务 ACL 塞进 JWT**，也**不把商业 entitlements 塞进 JWT**。

```text
Controller → JwtAuth → EntitlementGuard(feature?) → Service → 查资源 → PermissionService(Casbin) → 组合 permissions 返回
```

私有化部署：签名 License 只授予合同范围内的商业能力；**禁止**用 Casbin「全局放行」绕过资源 ACL（纠正早期草案）。详见 [subscription-and-entitlement.md §6](./subscription-and-entitlement.md)。

全生态图：

```text
                 LuminaryWorks IAM
                      Logto
       用户登录 / SSO / Token / Organization
                      |
                 JWT Access Token（身份 + 准入）
                      |
                 Entitlement Service
              plan / quota / license / seat
                      |
        +-------------+-------------+------------
        |             |             |
   DataLuminary   BlockyEdu    VistaCast / …
        |             |             |
      Casbin        Casbin       Casbin
   Resource ACL  Course ACL   Device ACL
```

## 5. Token 与平台准入

Access Token **仅**携带身份与准入，不塞业务资源 ACL，**也不塞商业 entitlements / plan / quota**（禁止 Logto `custom_data` 资产标签进 Token）：

```json
{
  "sub": "user_123456",
  "tenant_id": "org_789012",
  "name": "张三",
  "email": "zhangsan@company.com",
  "platform_role": "enterprise_admin",
  "app_access": ["data_luminary", "doer_flow"],
  "exp": 1752345678
}
```

平台级粗粒度（Logto）：超级管理员 / 运营 / 企业管理员 / 普通成员（能否进产品）。  
商业能力（Entitlement）：Trial / Pro / Ultra / 企业 seat / License。  
产品级资源细粒度（Casbin）：资源 · 数据范围（按钮显隐的 `permissions` JSON）。

鉴权链路：

```text
用户请求 → 网关/拦截器 → Token 验签（JWKS）
  → 解析 sub / tenant_id → 校验产品准入
  → Entitlement 校验（feature / quota / seat / license）
  → Casbin 资源校验 → 数据范围注入 → 业务逻辑
```

HTTP 语义：`401` 身份失败；商业权益不足用 `402` / `ENTITLEMENT_*`；资源 ACL 拒绝用 `403`。见 [subscription-and-entitlement.md §9](./subscription-and-entitlement.md)。

## 6. 部署形态

| 模式 | 说明 |
| --- | --- |
| SaaS | 中心 Logto + 多租户；门户或产品独立入口 |
| 私有化 A（推荐） | 内嵌 Logto 轻量实例 |
| 私有化 B | 直连企业 IdP（`IDP_MODE=external_oidc`） |
| 私有化 C | 产品内置本地用户（仅小型离线，不推荐） |

## 7. 本地开发入口

```bash
cd LuminaryWorks
pnpm id:up          # identity/bootstrap → Logto :3001 / Admin :3002
# Admin 创建 M2M 后：
cd identity && node scripts/register-apps.mjs
```

- 产品接入 Cursor 规范：[.cursor/skills/product-auth-implementation/SKILL.md](../.cursor/skills/product-auth-implementation/SKILL.md)
- 开发者门户：[docs/develop/unified-login](../docs/docs/develop/unified-login.md)

## 8. 落地阶段（摘要）

1. 中心 Logto + 应用注册 + Token 验签中间件  
2. 各产品 Casbin RBAC + 资源 ACL + Webhook 用户同步  
3. 中央 Entitlement 服务 + 共享 client + 三产品（DataLuminary / BlockyEdu / VistaRemote）接入（见权益规范）  
4. 企业 SSO / 租户管理 / 审计  
5. 私有化 License 打包与文档（Casbin 仍启用）  

## 9. 非目标

- 不在 Logto 中维护各产品 Dashboard/设备等业务 ACL  
- 不在 Logto / JWT 中维护商业 entitlements、plan 或配额  
- 不以 fork Logto Experience 源码作为默认定制路径  
- 不强制六产品共享同一套角色表结构  
- 不以 Casbin 全局放行替代私有化 License 或计费控制  

### DoerFlow 双身份补充

DoerFlow 的 Logto 平台主体与 wallet/SIWE 主体不可合并推断：Logto 负责平台会员/组织，钱包负责地址证明和客户端链签名。账号与钱包链接必须使用平台 JWT + 新鲜 SIWE 证明；链接记录不等于托管或所有权。DoerFlow `trialPolicy=disabled`，只展示 Pro / Ultra / Enterprise；Gas、Escrow 与协议费不属于平台套餐。
