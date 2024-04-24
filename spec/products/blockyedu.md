# BlockyEdu 产品规划 · 智码工坊

> **中文名**：智码工坊 · **域名**：[blockyedu.com](https://blockyedu.com) · **组织**：[github.com/blockyedu](https://github.com/blockyedu)  
> **旧名**：VibeEdu / blockyEdu

## 1. 定位

**AI 时代的可视化编程教育平台。**

基于 Google Blockly（品牌名 BlockyEdu，非 blockly），结合 Monaco 专业编码与 AI 辅导，覆盖从积木到代码到硬件的完整学习闭环。

| 维度 | 说明 |
|------|------|
| 独立价值 | 院校 / 培训机构可单独部署 LMS + 编程实验 |
| 生态角色 | **学** — 培养 IoT、数据、Agent 工程师 |
| 受众 | K12~成人学习者、教师、硬件教具合作方 |

## 2. 产品模块

### 2.1 编程平台（Blockly + Monaco）

| AI 能力 | 说明 |
|---------|------|
| **AI Copilot** | Text → Blockly，自然语言生成积木 |
| **AI Tutor** | 选中 for/if 等块，解释等价代码与概念 |
| **AI Debugger** | 分析运行错误，可视化调试指引 |
| **AI Challenge** | 编程挑战与自动评定 |
| **AI Assessment** | 学习报告与路径建议 |

### 2.2 教育平台

- **课程学习**：视频、PDF；PDF 上传 → AI 学习报告
- **教学平台**：一对一 / 一对多课堂、信令与 ICE
- **学习社区**：讨论与作品展示

### 2.3 IoT 实验

- ESPHome / MQTT / ThingsBoard 实验课
- 与 SyncroBrain 设备接入形成「学 → 连」路径

## 3. 兄弟产品集成

| 目标 | 场景 |
|------|------|
| SyncroBrain | 设备编程实验、固件模板 |
| DataLuminary | 数据分析课程 |
| DoerFlow | Agent / 智能合约课程 |
| VistaRemote | WebRTC 远程运维实验 |
| VistaCast | 安防与客流分析实训（规划） |

## 4. 技术栈

React、Zustand、Blockly、Monaco · NestJS、TypeORM、Redis、Kafka · WebSocket

## 5. 里程碑（产品向）

| 阶段 | 目标 |
|------|------|
| M1 | 编程工作台 + 课程 LMS |
| M2 | AI Copilot / Tutor / Debugger GA |
| M3 | SyncroBrain 联合实验包 |

## 6. 身份 · 权益 · 资源权限

接入顺序：**Logto AuthN → 中央 Entitlement → Casbin 资源 ACL**。权威规范：[subscription-and-entitlement.md](../subscription-and-entitlement.md)、[identity-and-permissions.md](../identity-and-permissions.md)。

| 层 | BlockyEdu 要点 |
|----|----------------|
| 身份 | 统一 Logto `sub`；`edu-app-web` / `code-app-web` 在 OIDC 未稳时可保留 legacy 登录开关 |
| 权益 | 迁移 `memberTier` / `code_pro` 等为 feature code；ToC Trial 每用户每产品一次；Pro / Ultra / 企业 seat |
| 资源 | 课程、班级、作业、workspace 仍由角色 + Casbin 控制；**禁止**用 role 名推断会员档 |
| 迁移 | account membership / wallet → 中央 subscription/order/grant；双读比对后再停本地会员主写 |

### 6.1 产品接线（已落地）

| 仓 | 集成 |
|----|------|
| `edu-server` | `@luminaryworks/entitlement-client`；`ENTITLEMENT_MODE=off\|shadow_read\|enforce`；`GET /membership` + dual-read `GET /edu/account/membership`；Casbin 课程 ACL 不变 |
| `server` | 同上；`code.execute.pro` / `ai.copilot` / `ai.tutor` 以 `@RequireEntitlement` 门禁；RBAC `code_pro` 保留作本地事实 |
| `edu-app-web` / `code-app-web` | 权益状态来自 membership API；Trial 倒计时；402 → 升级 UX；legacy + OIDC 并存 |

Feature codes：`code.execute.pro`、`ai.copilot`、`ai.tutor`、`student.limit`（配额；创建学员 API 到位后再 consume）。

迁移脚本：`pnpm migrate:legacy-membership`（`--dry-run` 默认；`--apply` 写中央）。

## 7. 相关文档

- 实现仓：`spec/product-spec.md`、`spec/ai-platform-spec.md`
- 生态：[domain-and-branding.md §4.2](../domain-and-branding.md#42-blockyedu--blockyeducom)
- 权益：[subscription-and-entitlement.md](../subscription-and-entitlement.md)
