# BlockyEdu 产品规划 · 智码工坊

> **中文名**：智码工坊 · **域名**：[blockyedu.com](https://blockyedu.com) · **组织**：[github.com/BlockyEdu](https://github.com/BlockyEdu)  
> **旧名**：VibeEdu / blockyEdu  
> **权威蓝图（实现仓）**：[BlockyEdu/BlockyEdu `docs/roadmap/ai-creation-platform-blueprint.md`](https://github.com/BlockyEdu/BlockyEdu)

## 1. 定位

**AI 全民创造平台（Create 默认）。**

用户用自然语言、积木或代码，把想法变成可预览、可发布、可履约的作品（Artifact）。原有 Blockly / Monaco / AI 辅导与课程能力保留为同一产品中的 **Learn / Code** 模式；企业 **VibeLearn** 仍可独立部署为 LMS。不拆第二套 C 端品牌。

| 维度 | 说明 |
|------|------|
| 独立价值 | 创造平台（Web / 小程序 / 标准玩具）可单独交付；**VibeLearn** 可对企业私有化交付内部培训（对标知鸟） |
| 生态角色 | **学 + 创** — 产出可发布作品；也可单独交付企业大学 |
| 受众 | 创作者、K12~成人学习者、教师、家长、**企业培训管理员**、硬件教具合作方 |
| 主循环（创造） | Idea → Build → Preview → Validate → Publish / Order |
| 主循环（企业大学） | 组织/SSO → 必修指派 → 学习 → 考试 → 证书 → 学情 |

## 2. 产品模块

### 2.1 创造平台（默认）

| 能力 | 说明 |
|------|------|
| **统一 Artifact** | `web` / `miniprogram` / `toy` / `exercise` 共用账户与作品库 |
| **三屏一助手** | 资源 · Design/Blockly/Monaco · 实时预览 + AI |
| **安全预览** | 作品预览独立 origin；控制台运行仅用于脚本练习 |
| **Web 发布** | 静态站 / 落地页；平台托管与版本回滚 |
| **微信小程序** | 工程生成、预览码、上传/审核状态（不承诺无条件一键过审） |
| **智能玩具** | 标准主控 + 模块 SKU、数字孪生、BOM/DFM、限定履约 |

### 2.2 Learn / Code（同产品模式）

| AI / 编辑能力 | 说明 |
|---------|------|
| **AI Copilot** | NL → 积木 / 结构化作品片段（经 schema 校验后写入） |
| **AI Tutor** | 选中 for/if 等块，解释等价代码与概念 |
| **AI Debugger** | 分析运行错误，可视化调试指引 |
| **Blockly + Monaco** | 积木与专业代码路径保留，不可逆转换需确认 |

### 2.3 教育平台（VibeLearn · 企业私有化）

- **对标知鸟**：企业大学 / 内部培训，可私有化或专属云部署
- **SKU**：Standard（组织/SSO/课程/考试/证书）→ Professional（必修/地图/报表/品牌）→ Live（+ media）→ 可选 +Code（编程考试桥接）
- **课程学习**：视频、PDF；必修指派；作业可绑定 Artifact（full 模式）
- **考试 / 证书 / 学情**：闭环可验收
- **教学直播**：Live 包可选 media-platform
- **企业独立部署**：`edu-standalone` / `deploy/edu`，**零依赖**创造沙箱与编程 IDE
- 蓝图：BlockyEdu MetaRepo `docs/roadmap/vibelearn-enterprise-lms-blueprint.md`；规格 `spec/edu-platform-standalone.md`

### 2.4 IoT / 玩具边界

- 数字孪生与订单在 BlockyEdu；真机连接 / OTA 走 SyncroBrain
- ESPHome / MQTT / ThingsBoard 实验课形成「学/创 → 连」路径
- 首期不做任意定制制造；不承诺任意 Web CSS → LVGL

## 3. 兄弟产品集成

| 目标 | 场景 |
|------|------|
| SyncroBrain | 真机 / OTA；设备编程实验、固件模板 |
| DataLuminary | 创作漏斗与学情分析；**VibeLearn** 企业培训报表；数据分析课程 |
| DoerFlow | Agent / 智能合约课程 |
| VistaRemote | WebRTC 远程运维实验 |
| VistaCast | 安防与客流分析实训（规划） |

## 4. 技术栈

- 创造前端：`code-app-web`（Rsbuild + React + Blockly + Monaco）
- 教育前端：`edu-app-web`（Next.js）
- 双后端：`server`（创造/编程）+ `edu-server`（LMS）
- AI：ai-bridge → ai-engine；Preview Host 独立 origin

## 5. 里程碑（产品向）

权威版本见 BlockyEdu MetaRepo `docs/roadmap/version-iteration-plan.md`：

| 阶段 | 目标 |
|------|------|
| V0.2 | 创造底座：Artifact + 安全预览 |
| V0.3 | Web Publish |
| V0.4 | Learn 融合（作业提交 Artifact） |
| V0.5 | 微信小程序 Beta |
| V0.6–V0.7 | 玩具数字孪生 → 限定 SKU 制造试点 |
| V1.0 | 创造平台 GA |

企业大学私有化并行轨道（EL）见 MetaRepo `docs/roadmap/vibelearn-enterprise-lms-blueprint.md` 与 `project-milestones.md` §8；**不**被创造 V0.x 阻塞。

## 6. 身份 · 权益 · 资源权限

接入顺序：**Logto AuthN → 中央 Entitlement → Casbin 资源 ACL**。权威规范：[subscription-and-entitlement.md](../subscription-and-entitlement.md)、[identity-and-permissions.md](../identity-and-permissions.md)。

| 层 | BlockyEdu 要点 |
|----|----------------|
| 身份 | 统一 Logto `sub`；`edu-app-web` / `code-app-web` 在 OIDC 未稳时可保留 legacy 登录开关 |
| 权益 | 迁移 `memberTier` / `code_pro` 等为 feature code；ToC Trial 每用户每产品一次；Pro / Ultra / 企业 seat；规划 `create.preview.*` / `create.publish.*` 等 |
| 资源 | 课程、班级、作业、workspace / Artifact 仍由角色 + Casbin 控制；**禁止**用 role 名推断会员档 |
| 迁移 | account membership / wallet → 中央 subscription/order/grant；双读比对后再停本地会员主写 |

### 6.1 产品接线（已落地）

| 仓 | 集成 |
|----|------|
| `edu-server` | `@luminaryworks/entitlement-client`；`ENTITLEMENT_MODE=off\|shadow_read\|enforce`；`GET /membership` + dual-read `GET /edu/account/membership`；Casbin 课程 ACL 不变 |
| `server` | 同上；`code.execute.pro` / `ai.copilot` / `ai.tutor` 以 `@RequireEntitlement` 门禁；RBAC `code_pro` 保留作本地事实 |
| `edu-app-web` / `code-app-web` | 权益状态来自 membership API；Trial 倒计时；402 → 升级 UX；legacy + OIDC 并存 |

## 7. 相关文档

- 文档站产品页：[docs/docs/products/blockyedu.md](../../docs/docs/products/blockyedu.md)
- 实现仓蓝图：`blockyedu` → `docs/roadmap/ai-creation-platform-blueprint.md`
- 实现仓规格：`blockyedu` → `spec/product-spec.md` · `spec/create-platform-spec.md`
