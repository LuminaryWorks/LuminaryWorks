# LuminaryWorks 官网设计规范（website design spec v1.0）

> **状态**：设计定稿（实现待落地） · **适用**：`LuminaryWorks/website`（apex `luminaryworks.dev`）
> **关联**：[domain-and-branding.md](./domain-and-branding.md) · [products/index.md](./products/index.md) · [composable-deployment.md](./composable-deployment.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md) · [legal/README.md](./legal/README.md)
> **读者**：实现本站的 AI agent 与人类开发者。**本文是实现依据，视觉与文案不得自由发挥**。

---

## 0. 背景与目标

当前 `luminaryworks.dev` 由文档站 [`LuminaryWorks/docs`](https://github.com/LuminaryWorks/docs)（Rspress）直接充当官网，问题：

1. 骨架是文档站（侧栏 / 文档排版），母品牌叙事撑不起来；
2. 首页用 emoji 图标（✨🧩🚀）+ 多段渐变卡片，观感廉价，与「工业级严谨」定位冲突；
3. 与已上线的产品官网（[VistaRemote](https://remote.vistacast.dev)、[DoerFlow](https://doerflow.dev)：Next.js 静态导出 + 深色蓝工业风）**不同源**，跨站跳转像两家公司；
4. `docs.luminaryworks.dev/legal` 被 Entitlement 引用（`ENTITLEMENT_LEGAL_PUBLIC_BASE_URL`）但页面不存在——**上线阻塞项**。

**目标**：新建独立母品牌官网，承担「生态叙事 + 六产品导流 + 私有化交付咨询 + 法律页」四件事；文档站回归 `docs.luminaryworks.dev` 只做文档。

**非目标**：不改六个产品各自官网；不做博客 / 新闻 / 招聘（v1 不排）；不做定价表（定价在各产品站与 Console）。

---

## 1. 设计概念：蓝图（Blueprint）

LuminaryWorks 是**工坊**，不是消费级 SaaS。全站观感应接近**工程蓝图与控制室**，而非营销落地页。

五条设计支柱：

| # | 支柱 | 具体落地 |
|---|------|----------|
| P1 | **单色蓝，深色画布** | 一个主色 `#1677ff` 铺在深海军蓝底上。表面**不用**多色渐变。青 `#18a0fb` / 薄荷 `#21d4a8` 仅作 1px 描边与状态点 |
| P2 | **网格与刻度** | 1px 发丝描边、6% 透明度的蓝图网格底、等宽大写编号小标题（`01 / VALUE CHAIN`）、刻度式分隔线 |
| P3 | **结构图取代插画** | Hero 右侧与生态区用手写 SVG/CSS 结构示意图（控制面 / 产品面、价值链），**禁止**插画素材、3D 渲染图、emoji |
| P4 | **密度克制** | 正文 15px / 行高 1.6，容器 1200px，8px 间距刻度，圆角 4/8/12，几乎不用阴影（用描边 + 表面色分层代替发光卡片） |
| P5 | **动效最小** | 进场 fade+translate 240ms；Hero 一条缓慢光束；其余静止。必须响应 `prefers-reduced-motion` |

**一句话判据**：任何一屏截图，如果去掉文字后看不出是「工程/基础设施」，就是做错了。

### 1.1 明确禁止项（实现时逐条自查）

- 禁止 emoji 作为图标（用 `@ant-design/icons` 线性图标或自绘 SVG）
- 禁止按钮渐变、禁止大面积渐变背景、禁止渐变标题文字（渐变仅限：母品牌 Logo mark 本身、Hero 顶部 1px 光束、价值链连接线）
- 禁止给六个产品配不同 accent 色（品牌规范硬约束，差异化靠 Logo + 名称 + 角色标签）
- 禁止毛玻璃卡片堆叠（`backdrop-filter` 仅用于 sticky header）
- 禁止编造数字（用户数 / 客户 Logo / 好评率 / "99.99% 可用性"）。事实条只写可验证事实
- 禁止把 lab / stub 能力写成已上线（见 §5 成熟度矩阵）
- 禁止浅色模式（v1 深色 only，与产品站一致；不写 light 变量分支）

---

## 2. 设计令牌（tokens）

与 [VistaRemote 官网](https://remote.vistacast.dev) 的令牌对齐，跨站一眼同源。实现落在 `styles/_tokens.scss` 并导出 `:root` CSS 变量 + `lib/theme.ts`（antd `ThemeConfig`）。

```scss
// 画布与表面
--lw-bg:            #0d1117;   // 页面底
--lw-bg-deep:       #0b1220;   // 交替区块（更深一档）
--lw-surface:       #161f2e;   // 卡面
--lw-surface-2:     #1c2a3a;   // 卡面悬浮 / 表头
--lw-border:        #21334a;   // 1px 描边
--lw-border-soft:   rgba(33, 51, 74, 0.6);

// 品牌
--lw-primary:        #1677ff;  // 生态唯一主色（按钮、强调）
--lw-primary-hover:  #4593ff;  // 深底上的链接色（对比度更安全）
--lw-primary-active: #0958d9;
--lw-primary-bg:     rgba(22, 119, 255, 0.08);
--lw-primary-rim:    rgba(22, 119, 255, 0.22);

// 强调（克制使用）
--lw-cyan:  #18a0fb;   // 结构图连接线、装饰描边
--lw-mint:  #21d4a8;   // 状态：正式可售 / ready
--lw-amber: #f5a623;   // 状态：预览 / pilot
--lw-dim:   #4a5568;   // 状态：规划中 / 未就绪

// 文字
--lw-text:  #e6edf3;
--lw-muted: #8b949e;
--lw-faint: #4a5568;

// 排版
--lw-font-sans: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--lw-font-mono: "JetBrains Mono", "Fira Code", Consolas, monospace;

// 半径与间距
--lw-r-sm: 4px;  --lw-r-md: 8px;  --lw-r-lg: 12px;
// 间距刻度：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96
```

排版刻度：

| 用途 | 字号 / 字重 / 字距 |
|------|-------------------|
| Hero H1 | clamp(32px, 5vw, 56px) / 700 / -0.02em / 行高 1.15 |
| 区块 H2 | clamp(24px, 3vw, 34px) / 700 / -0.015em |
| 卡片标题 H3 | 18px / 600 |
| 正文 | 15px / 400 / 行高 1.7 / `--lw-muted` |
| 小标签（mono） | 12px / 500 / 大写 / 字距 0.08em / `--lw-faint` |
| 数字（mono） | 28px / 600 / `--lw-text` |

**可访问性**：深底上的正文链接一律用 `--lw-primary-hover`（`#4593ff`），不用 `#1677ff`（对比度不足）。所有交互元素有可见 focus ring（`2px solid var(--lw-primary-hover)`，`outline-offset: 2px`）。结构图必须带 `role="img"` + `aria-label` 文字说明。

### 2.1 Logo 使用

- 母品牌 mark（`assets/logo.svg`，紫→薄荷光束）**保持原样**，因为品牌规范明确「母品牌 Logo 的光束渐变是工坊标识本身」。
- Header：mark 24px + 文字标 `LuminaryWorks`，右侧 mono 小字 `启明工坊`。
- Hero：不重复放大 Logo；品牌身份由 eyebrow 文字承担。
- 产品卡：直接复用 `docs/docs/public/brand/{product}-logo.svg` 七个既有 SVG（复制进本站 `public/brand/`）。
- 产品 Logo 一律 32px 方形、`border-radius: 8px`、不加彩色底。

---

## 3. 组件规范

| 组件 | 规范 |
|------|------|
| **Header** | sticky / 64px / `rgba(13,17,23,.72)` + `blur(14px)`；滚动 >10px 后加 1px 底边。左：Logo 组 + 导航；右：语言切换（antd Dropdown，`GlobalOutlined`）+ GitHub 图标。移动端汉堡抽屉。**母品牌不是具体产品，Header 不展示「开始试用」** |
| **按钮** | 主按钮 antd `type="primary"` 纯色 `#1677ff`、`borderRadius: 8`、`fontWeight: 600`、高 44px（large）。次按钮 `transparent` 底 + `--lw-border` 描边 + `--lw-muted` 文字，hover 时描边转 `--lw-primary-rim` |
| **卡片** | `--lw-surface` 底 + 1px `--lw-border` + `--lw-r-lg`；hover 仅：描边转 `--lw-primary-rim`、底色转 `--lw-surface-2`、`translateY(-2px)`。**不加发光阴影** |
| **区块小标题** | mono 大写编号 + 名称（`02 / PRODUCTS`），下方 H2，再下方一句 `--lw-muted` 导语，最多 2 行 |
| **状态徽标** | 圆点 + 文字，8px 圆点：可售 `--lw-mint`、预览 `--lw-amber`、规划中 `--lw-dim`。文字 12px mono |
| **技术标签 chip** | mono 12px、`--lw-primary-bg` 底、`--lw-primary-rim` 描边、`--lw-r-sm`、`padding: 2px 8px` |
| **表格** | antd Table 或原生；表头 `--lw-surface-2` + mono 小写字距；行分隔 1px `--lw-border-soft`；移动端转卡片列表 |
| **结构图** | 纯 CSS Grid + 绝对定位 1px 连线（`--lw-cyan` 30% 透明），节点为小卡；不用 canvas、不引图表库 |
| **区块背景** | 相邻区块在 `--lw-bg` / `--lw-bg-deep` 间交替；每区块上边缘一条 `--lw-border-soft` 发丝线 |
| **蓝图网格底** | 仅 Hero 与 CTA 区：`background-image` 两组 1px 线性渐变，48px 网格，透明度 0.05，配 `radial-gradient` 遮罩向边缘淡出 |
| **Footer** | 4 列链接 + 品牌行 + license 行 + 语言 + 备案信息占位（`<!-- ICP placeholder -->`） |

---

## 4. 信息架构与路由

中文为默认语言挂 `/`，英文挂 `/en/`（与 DoerFlow 站同构：`DEFAULT_LOCALE` 走根路径，其余 locale 走 `app/[locale]/`）。

| 路由 | 页面 | 内容要点 |
|------|------|----------|
| `/` · `/en/` | 首页 | 见 §5 分区 |
| `/products/` | 产品总览 | 六张完整产品卡 + 对比表（角色 / 适用对象 / 域名 / 商业化状态 / Trial） |
| `/ecosystem/` | 生态与架构 | 价值链闭环、共享底座、集成矩阵、统一错误语义、开放协议清单 |
| `/deploy/` | 部署与私有化 | 五种部署形态、能力模式矩阵、安装套件、air-gapped 与离线 License |
| `/about/` | 关于工坊 | 命名叙事（Works = 工坊/兵工厂）、House of Brands、许可与商用、联系方式 |
| `/legal/terms/` | 服务条款 | 由 `spec/legal/{zh,en}/terms.md` 渲染，页头显示 `policyVersion` |
| `/legal/privacy/` | 隐私政策 | 同上 |
| `/legal/trial-data-deletion/` | Trial 与数据删除 | 同上 |
| `404` | 未找到 | 深色、mono、返回首页 + 文档站入口 |

导航条目：`产品` `生态与架构` `部署` `文档 ↗`（跳 docs 站）`关于`。Header 不放产品试用 CTA。

外链一律 `target="_blank" rel="noopener noreferrer"` 且带 `↗` 视觉提示。

---

## 5. 首页分区与文案定稿

> 文案规则：不用最高级形容词；不写不可验证数字；品牌名两语种都保留英文；技术名词用 mono 呈现。**中英双语必须同时完整**，英文是真翻译不是直译。

### 00 · Hero

- Eyebrow（mono，大写）：`LUMINARYWORKS · 启明工坊`
- H1 zh：**六个可独立部署的 AI 产品，一套统一的身份与权益底座**
- H1 en：**Six independently deployable AI products. One shared identity and entitlement foundation.**
- 副文 zh：LuminaryWorks（启明工坊）用 OIDC、MQTT、REST、WebRTC、ONVIF 等开放协议，把创造教育、设备物联、数据洞察、视觉安防、远程运维与 Agent 协作连成一条价值链。每个产品都能独立交付与私有化，也能按需组合成完整闭环。
- 副文 en：LuminaryWorks builds an AI-native open ecosystem on open protocols — OIDC, MQTT, REST, WebRTC and ONVIF. Creation and learning, device connectivity, data insight, visual security, remote operations and agent collaboration form one value chain. Every product ships standalone and self-hosted, and composes on demand.
- 主 CTA：`查看六大产品` / `Explore the six products` → `/products/`
- 次 CTA：`私有化部署` / `Self-hosted deployment` → `/deploy/`
- 文字链：`开发者文档 ↗` / `Developer docs ↗` → `https://docs.luminaryworks.dev`
- 右侧结构图卡（mono 标签，静态，含状态点）：

```text
CONTROL PLANE  ·  可选共享
┌ Identity · OIDC ┐ ┌ Entitlement ┐ ┌ AI Gateway · lab ┐
└─────────┬───────┘ └──────┬──────┘ └─────────┬────────┘
PRODUCT PLANES  ·  各自数据库与 ACL
[ DataLuminary ] [ BlockyEdu ] [ SyncroBrain ]
[ VistaCast ]    [ VistaRemote ] [ DoerFlow ]
```

结构图要点：`AI Gateway` 必须带 `lab` 标记（诚实原则）；控制面到产品面的连线用虚线（表示可选依赖）。

### 01 · 事实条（facts strip）

单行 5 项，mono 数字 + 说明；移动端 2 列。**只写可验证事实**：

| 数值 | zh | en |
|------|----|----|
| `6` | 独立可售产品 | independently sellable products |
| `5` | 冻结部署形态 | frozen deployment profiles |
| `1` | 套统一登录与权益 | shared identity and entitlement layer |
| `5` | 类开放协议 | families of open protocols |
| `NC` | Polyform 非商业开源 | Polyform Noncommercial source |

### 02 · 价值链闭环（`02 / VALUE CHAIN`）

- H2 zh：**六个产品，回答同一条价值链的不同环节**
- H2 en：**Six products, one value chain**
- 导语 zh：学 + 创起步，接入设备、洞察数据，延伸到视觉安防、远程运维，最后由 Agent 与人类共同结算。
- 节点（角色字 + 品牌 + 一行）：`学+创 BlockyEdu` → `连 SyncroBrain` → `看 DataLuminary`，分支 `视 VistaCast`、`控 VistaRemote`，汇入 `赚 DoerFlow`
- 结构图用 CSS Grid + 1px 连线；点击节点滚动到 §03 对应卡片；移动端退化为纵向时间轴
- 英文角色字：`Create` / `Connect` / `See` / `Watch` / `Control` / `Earn`

### 03 · 六大产品（`03 / PRODUCTS`）

- H2 zh：**每个产品可独立售卖，组合后形成闭环**
- H2 en：**Each product sells on its own. Together they close the loop.**

3×2 卡片网格（桌面）/ 1 列（移动）。每卡：产品 Logo(32px) + 英文名 + 中文名 + 角色标签 + 一句话 + 3 个能力 chip + 状态徽标 + `访问官网 ↗` 与 `文档 ↗`。

| 品牌 | 中文 | 角色 | 一句话 zh | 一句话 en | 能力 chips | 状态 | 官网 |
|------|------|------|-----------|-----------|------------|------|------|
| **DataLuminary** | 数据明鉴 | 看 | 用 AI 照亮数据：低代码 BI、可视化大屏，一句话生成报告与图表。 | Illuminate data with AI — low-code BI, video-wall dashboards, reports from a single prompt. | `DataView` `DataTalk` `DataInsight` | 正式可售 · 7 天 Trial | dataluminary.dev |
| **BlockyEdu** | 智码工坊 | 学+创 | AI 全民创造平台：从积木到网站、小程序与实体玩具；VibeLearn 为企业交付可私有化的内部培训。 | AI creation for everyone — from blocks to websites, mini programs and physical toys; VibeLearn delivers self-hostable corporate training. | `三屏一助手` `统一 Artifact` `VibeLearn LMS` | 正式可售 · 7 天 Trial | blockyedu.com |
| **SyncroBrain** | 万物智脑 | 连 | 连接设备的 AI 原生操作系统：接入、设备影子、OTA、边缘规则与数字孪生。 | An AI-native operating system for connected devices — onboarding, shadows, OTA, edge rules and digital twins. | `多协议接入` `边缘规则` `Safety Kernel` | 正式可售 · 无 Trial | syncrobrain.com |
| **VistaCast** | 视界云遥 | 视 | 把线下空间变成可编程的视觉事件流：复用既有 ONVIF/RTSP 摄像头，在边缘产出结构化事件。 | Turn physical space into a programmable stream of visual events — reuse existing ONVIF/RTSP cameras, emit structured events at the edge. | `ONVIF/RTSP` `客流与入侵` `Webhook 事件` | 正式可售 · 无 Trial | vistacast.dev |
| **VistaRemote** | 视界远程 | 控 | 跨平台实时远程桌面与自托管录制洞察：工控机、边缘网关、IT 桌面与远程协助。 | Cross-platform real-time remote desktop with self-hosted recording insight — industrial PCs, edge gateways, IT desktops and remote assistance. | `WebRTC 远控` `会话录制审计` `AI 摘要` | 正式可售 · 7 天 Trial | remote.vistacast.dev |
| **DoerFlow** | 智工网 | 赚 | 自主执行体的价值流动协议：任务发布、匹配与托管结算，人与 Agent 同权。 | The liquidity protocol for autonomous agents — task publishing, matching and escrow settlement, where humans and agents are peers. | `任务市场` `Agent 经济` `多链结算` | 正式可售 · 无 Trial | doerflow.dev |

**成熟度诚实矩阵（不得违反）**：

- 六产品均可售
- `dataluminary` / `blockyedu` / `vistaremote`：7×24h Trial，每用户每产品一次
- `doerflow` / `vistacast` / `syncrobrain`：**无 Trial**
- 全站不得出现「永久免费 / Free 套餐」（生态无永久 Free 档）
- `AI Gateway` 中央模式当前是 `lab`，任何提及都要带成熟度标记

**域名口径**：VistaRemote 统一用 `remote.vistacast.dev`（其官网仓 README 的生产域名）。禁止写 `vistaremote.dev`。

### 04 · 共享底座（`04 / PLATFORM`）

- H2 zh：**统一的不是业务，是身份、权益与协议**
- H2 en：**What is shared is identity, entitlement and protocols — never business logic.**
- 六张小卡：

| 卡片 | zh 说明 | mono 标签 |
|------|---------|-----------|
| 统一登录 Identity | 一套 OIDC 登录服务承载六个品牌，各产品保留自己的 Logo 与文案 | `Logto` `OIDC` `PKCE` |
| 中央权益 Entitlement | 套餐、Trial、License、席位与支付集中管理；商业权益不进 JWT | `NestJS` `PostgreSQL` |
| 资源权限 PAL | 资源级 ACL 留在各产品，`permissions` 随资源下发 | `Casbin` `PAL` |
| AI 网关 | 多供应商模型接入、密钥保险库与用量计量（当前 `lab`，不进生产） | `lab` `BYOK` |
| 通知 | 共享邮件与通知模块，统一发信身份 | `@luminaryworks/notification` |
| 共享库 | 身份、权限、权益客户端与工具链以 npm 包分发，不做跨仓源码引用 | `@luminaryworks/*` |

- 底部 mono callout：**统一错误语义** `401 身份` · `402 权益` · `403 资源 ACL`
- 一行强调 zh：每个产品独占自己的数据库、迁移、Casbin 策略与发布节奏；兄弟产品全部关闭时仍能启动并通过 ready 检查。

### 05 · 部署形态（`05 / DEPLOYMENT`）

- H2 zh：**从单品独立交付，到断网内网闭环**
- H2 en：**From a single product to an air-gapped closed loop**
- 五形态卡片/表：

| profile | zh 含义 | 最小组成 |
|---------|---------|----------|
| `standalone` | 单产品独立部署与售卖 | 1 个产品 plane + 自有数据库 |
| `control-plane` | 只部署共享控制面 | Identity（+ Auth Gateway）+ Entitlement |
| `agent-commerce` | 基础组合闭环 | VistaCast + SyncroBrain + DoerFlow |
| `smart-site` | 上层完整闭环（叠加而非替代） | 前者 + VistaRemote + DataLuminary（+ BlockyEdu 培训入口） |
| `air-gapped` | 断网 / 内网交付 | 单品或组合，无出网；离线 License、本地 BYOK |

- 能力模式 mono 行：`identity=central|external_oidc|local` · `entitlement=off|shadow_read|enforce|offline_license` · `ai=off|central|local_byok` · `notification=none|smtp`
- CTA：`查看部署方案` → `/deploy/`

### 06 · 为什么是工坊（`06 / WHY`）

四条，每条一个标题 + 两行说明：

1. **开放协议优先** — 集成一律走 OIDC / HTTP / MQTT / 事件，禁止跨产品运行时引用，降低锁定与迁移成本。
2. **业务隔离，身份统一** — 各产品独占数据库与资源 ACL；登录与商业权益中央化，体验一致但故障不串联。
3. **私有化是一等公民** — 客户自有 IdP、离线 License、本地 BYOK 与 air-gapped 从规格阶段就在，而非事后补丁。
4. **成熟度诚实标注** — 文档与官网区分 `production` / `pilot` / `lab` / `stub`，已编码不等于已上线。

### 07 · CTA 区

- H2 zh：**先跑起来，再决定怎么买**
- H2 en：**Run it first, decide later**
- 说明 zh：适用产品提供 7 天 Trial；生态不提供永久免费档。需要私有化或离线交付，直接联系工坊。
- 按钮：`联系商务`（`mailto:admin@luminaryworks.dev`）· `GitHub ↗`。母品牌首页不放「开始试用」
- 蓝图网格底 + 上下发丝线收口

### Footer

四列：

- **产品**：六个品牌 + 各自官网
- **平台与文档**：开发者文档、统一登录、部署套件、GitHub 组织
- **生态**：生态叙事、总体架构、许可与商用
- **法律**：服务条款、隐私政策、Trial 与数据删除

品牌行：`LuminaryWorks · 启明工坊 — AI 原生开源生态`
License 行：`Polyform Noncommercial License 1.0.0 · 商业使用须另行授权`
右侧：语言切换 + 备案信息占位注释。

---

## 6. 技术实现约定

与已上线产品官网同栈，可直接照抄结构（**不复制其配色以外的品牌内容**）：

- 参考实现 A（结构 / i18n / Cloudflare 部署）：`DoerFlow/repos/website`
- 参考实现 B（深色蓝令牌 / 工业风版式）：`VistaRemote/website`

| 项 | 约定 |
|----|------|
| 框架 | Next.js 16 + React 19，`output: 'export'`、`trailingSlash: true`、`images.unoptimized: true` |
| UI | antd 6 + `@ant-design/nextjs-registry` + `@ant-design/icons`；版式用 SCSS + CSS Modules（`styles/_tokens.scss` 等 partial） |
| 动效 | 纯 CSS（`@keyframes` + `IntersectionObserver` 加 class）。**不引 framer-motion**（省包体与实现成本） |
| 字体 | `next/font/google` 的 Inter（`--font-inter`）；中文与等宽走系统栈，不自托管字体文件 |
| i18n | 照抄 `lib/i18n/{config,context,paths,metadata}` 形状；`LOCALES = ['zh','en']`、`DEFAULT_LOCALE='zh'`；文案放 `lib/i18n/messages/{zh,en}.ts`（带类型约束，两语种必须同构完整）。本站**不用** i18next，故 `defaultValue` 规则不适用，但「两语种同时补齐」仍是硬要求 |
| 目录 | `app/`（`page.tsx` + `[locale]/`）、`components/{site,sections}/`、`lib/`、`styles/`、`content/legal/{zh,en}/`、`public/brand/` |
| 法律页 | `spec/legal/{zh,en}/*.md` 由 MetaRepo 脚本同步进 `content/legal/`，构建时用 `marked` 渲染为静态页；页头显示 `policyVersion`（当前 `lw-legal-v2026-09-07`）与「非法律意见」提示 |
| SEO | `app/sitemap.ts` + `app/robots.ts`（`dynamic = 'force-static'`）、每页 `generateMetadata` 带 `alternates.languages`、OG 图用静态 SVG/PNG（不用 `next/og`，静态导出不支持） |
| Lint | biome（照抄 `tooling` preset），`engines.node >= 24.0.0`，`packageManager: pnpm@9.15.0` |
| 端口 | `next dev -p 13000`（避开产品站 13010 / 13106） |
| 部署 | `wrangler.toml`：`pages_build_output_dir = "out"`、项目名 `luminaryworks-website`；GitHub Actions 照抄 DoerFlow 的 `deploy.yml`（`npx wrangler@4 pages deploy out --project-name=luminaryworks-website`，需 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`） |
| 仓库 | 新建 `LuminaryWorks/website`，本地嵌套在 MetaRepo `website/`（与 `docs/` 同模式，MetaRepo `.gitignore` 增加 `/website/`），MetaRepo 增加 `pnpm web:dev` / `web:build` / `web:check` / `legal:sync`（`pnpm --dir website`）并接入 `bootstrap.mjs`。**注意** `site:*` 已被「部署站点意图」（`deploy/site.json`）占用，官网一律用 `web:*` |

### 6.1 域名切换（上线运维步骤，非代码）

1. Cloudflare Pages 建项目 `luminaryworks-website`，自定义域 `luminaryworks.dev` + `www.luminaryworks.dev`
2. docs 站从 apex 迁到 `docs.luminaryworks.dev`：GitHub Pages 自定义域改为 `docs.luminaryworks.dev`，Cloudflare DNS 把 `docs` CNAME 指向 `luminaryworks.github.io`；apex/`www` 的 CNAME 交给 Pages
3. MetaRepo `scripts/docs-sites.config.ps1`：LuminaryWorks 条目 `HostMode` 从 `apex` 改为 `docs` 子域，`RedirectLegacyDocs` 关闭（不再把 docs 301 到 apex）
4. 确认 `ENTITLEMENT_LEGAL_PUBLIC_BASE_URL` 指向的法律页可访问；若决定法律页落在官网，则改为 `https://luminaryworks.dev/legal`
5. `docs/LUMINARYWORKS-DOCS-GITHUB-ACTIONS.md` 里过期的 Cloudflare Pages 说明需更正（现实是 GitHub Pages）

---

## 7. 验收清单

实现完成后逐条自查（截图 + 构建产物）：

- [ ] `pnpm build` 产出 `out/`，`/`、`/en/`、四个内容页、三个法律页（中英共 16 个 HTML）全部存在
- [ ] 全站无 emoji、无渐变按钮、无渐变标题、无插画素材
- [ ] 六产品状态与 §5 成熟度矩阵完全一致；无「永久免费」「已上线」误述；VistaRemote 域名为 `remote.vistacast.dev`
- [ ] 中英文案同构完整，无缺 key、无中英混排错位；英文页 `<html lang="en">`
- [ ] 深色对比度：正文 ≥ 4.5:1，链接用 `#4593ff`；键盘 Tab 可走完全站，focus 可见
- [ ] 移动端 375px 无横向滚动；结构图与表格均有降级版式
- [ ] Lighthouse（移动）性能 ≥ 90、可访问性 ≥ 95；首屏无 CLS 跳动
- [ ] `sitemap.xml` / `robots.txt` 生成正确，含 `alternates.languages`
- [ ] 法律页显示 `policyVersion` 与「非法律意见」提示
- [ ] 与 `remote.vistacast.dev`、`doerflow.dev` 并排截图对比，观感同源（同蓝、同底、同发丝描边）

---

## 8. 模型与成本分工（执行建议）

| 阶段 | 内容 | 建议模型 |
|------|------|----------|
| 设计定稿 | 本文（令牌、IA、分区、中英文案） | Claude Opus（已完成） |
| S1 脚手架 | Next 16 + antd + SCSS 令牌 + 布局 / Header / Footer + i18n 管道 + wrangler + CI | Grok High |
| S2 首页 | 00–07 分区与结构图 | Grok High |
| S3 内容页 | `/products` `/ecosystem` `/deploy` `/about` + 法律页渲染与同步脚本 | Composer 2.5 |
| S4 收尾 | SEO、可访问性、构建、截图核对、MetaRepo 脚本接入、域名切换文档 | Grok High |
| 终审 | 按 §7 清单做一次视觉与文案终审 | 人工 + 可选 Opus 一次 |

跨阶段硬约束：**任何实现阶段都不得修改本文的令牌与文案定稿**；若实现中发现规范冲突，先在本文追加「变更记录」再改代码。

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-12 | v1.0 设计定稿 | Opus 规划会话 |
| 2026-09-12 | 产品卡第二个链接从「文档 ↗」改为「源码 ↗」（指向各产品 GitHub 仓）。原因：各产品 docs 子域未全部就绪，猜路径会上线即死链；GitHub 地址可验证 | 实现会话 |
| 2026-09-12 | 主按钮对比度处理：白字 on `#1677ff` 实测 4.1:1，未达 WCAG AA 正文 4.5:1。大号 CTA（Hero / CTA 区 / 部署页）字号提到 **19px/700** 落入 AA 大文本档（3:1）；Header 小号 CTA 填充下沉到 `--lw-primary-active` `#0958d9`（白字 6.3:1，达标 AA 正文），hover 回到品牌蓝。`--lw-primary` 本身不变 | 实现会话 |
| 2026-09-12 | `Reveal` 改为**纯 CSS 一次性入场**（240ms 淡入，`animation-fill-mode: both`），移除 IntersectionObserver 与滚动触发隐藏。原实现让首屏以下区块常驻 `opacity: 0`，在无 JS、打印、全页截图、恢复滚动位置等场景会整片不可见；收益小于风险，且 §1 P5 本就要求「动效最小」 | 实现会话 |
| 2026-09-12 | 文字三级色阶按实测对比度重排：`--lw-muted` `#8b949e` → `#9aa5b1`、`--lw-faint` `#4a5568` → `#8b949e`。判据是最暗一档在**最亮表面** `--lw-surface-2` `#1c2a3a` 上也要 ≥ 4.5:1（原值在卡面上只有 4.3:1） | 实现会话 |
| 2026-09-12 | `ProductCard` 增加 `headingLevel` 参数：首页区块内用 `h3`，`/products` 页作为一级分区用 `h2`，避免 h1 → h3 跳级 | 实现会话 |
| 2026-09-12 | 实测结果：首页 / 产品页 / 法律页移动端 Lighthouse 可访问性、最佳实践、SEO 均 **100**，0 项失败 | 实现会话 |
| 2026-09-12 | 用户复核后移除 Header（桌面与移动 Drawer）的「开始试用」。母品牌本身不是具体产品；Header 只保留产品/生态/部署/文档/关于、语言与 GitHub | UI 优化会话 |
| 2026-09-12 | 首页 Value Chain 改成占满统一容器的六节点工程轨道：统一左边界、`01–06` mono 序号、角色/英文品牌/中文名三层信息；移动端退化为节点间距 ≥16px 的纵向轨道 | UI 优化会话 |
| 2026-09-12 | `/ecosystem` 从同质卡片堆叠改为六种视觉模式：价值链轨道、共享控制面架构板、允许/禁止对照、401/402/403 三联编号块、协议轨道、产品自治声明；每段改为全宽 section + 统一内层容器，移除负 margin 拼接 | UI 优化会话 |
| 2026-09-12 | 修复 Facts Strip 把 `.lw-container` padding 覆盖为 0 的组合类 bug；改成容器包裹 grid，桌面实测事实条、Value Chain 标题与节点均从 x=140px 起 | UI 优化会话 |
| 2026-09-12 | 六产品在官网上均标「正式可售」。VistaCast / SyncroBrain 仍无 Trial。首页 CTA 去掉「开始试用」；「联系商务」改为 `mailto:admin@luminaryworks.dev` | 用户复核 |
