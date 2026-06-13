# 域名与品牌决策 (v1.0)

> **状态**：Approved · **生效**：2026-06  
> **原则**：GitHub 组织名与主域名根一致；能注册 `.com` 优先，否则用 `.dev`（技术产品）或已持有的 `.com`。

## 1. 生态总览

| 层级 | 品牌 | 中文名 | 域名 | GitHub 组织 | 定位 |
|------|------|--------|------|-------------|------|
| 母公司 / 实验室 | **LuminaryWorks** | **启明工坊** | [luminaryworks.dev](https://luminaryworks.dev) | [LuminaryWorks](https://github.com/LuminaryWorks) | AI 生态编排、共享身份与规范 |
| 产品 1 | **DataLuminary** | **数据明鉴** | [dataluminary.dev](https://dataluminary.dev) | [dataluminary](https://github.com/dataluminary) | AI 数据洞察与 BI |
| 产品 2 | **BlockyEdu** | **智码工坊** | [blockyedu.com](https://blockyedu.com) | [blockyedu](https://github.com/blockyedu) | AI 编程与教育 |
| 产品 3 | **DoerFlow** | **智工网** | [doerflow.dev](https://doerflow.dev) | [doerflow](https://github.com/doerflow) | 执行者价值流动网络 |
| 产品 4 | **VistaCast** | **视界云遥** | [vistacast.dev](https://vistacast.dev) | [VistaCast](https://github.com/VistaCast) | AI 摄像头云监控（规划） |
| 产品 5 | **VistaRemote** | **视界远程** | — | [VistaRemote](https://github.com/VistaRemote) | WebRTC 远程桌面运维 |
| 产品 6 | **SyncroBrain** | **万物智脑** | [syncrobrain.com](https://syncrobrain.com) | [syncrobrain](https://github.com/syncrobrain) | 连接设备的 AI 原生 OS |

**中文名使用原则**：对外宣传、官网 Hero、投资人材料可用中文名；代码仓、域名、GitHub 组织、npm scope 仍用英文品牌（与域名一致）。

**架构策略**：House of Brands（多独立品牌），非 Branded House。各产品可独立融资、独立发版、独立面向不同客群；LuminaryWorks（启明工坊）仅维护叙事、标准与共享库。

## 2. 域名后缀策略

### 2.1 为何选 `.dev`

| 因素 | 说明 |
|------|------|
| 背书 | Google 运营；web.dev、opensource.dev 官方在用 |
| 认知 | 开发者一看即知「技术产品」 |
| 安全 | 全站强制 HTTPS |
| 可用性 | 长组合域名注册成功率高 |
| 对比 `.net` | 开发者身份感更强，避免「没抢到 .com 才用 .net」的印象 |

**规则**：能注册 `.com` 则采用 `.com`（如 blockyedu.com、syncrobrain.com）；`.com` 已被占用则采用 `.dev`。

### 2.2 放弃的选项

| 选项 | 放弃原因 |
|------|----------|
| `.ai` / `.io` | 价格偏高 |
| `.work`（如 luminaries.work） | 科技圈认知度低；垃圾邮件历史；Top 10000 科技站无 `.work` |
| LuminaryGroup | 「Group」偏资本运作、官僚气，不符合极客产品气质 |
| 统一 Lumi* 子品牌 | 消费级品牌屋模式；五产品跨度大，不适合 |

## 3. LuminaryWorks（母公司）— 启明工坊

**域名**：luminaryworks.dev · **中文名**：启明工坊

**命名含义**：「Works」在英语科技语境中代表工坊、实验室、兵工厂——亲自动手创造硬核产品。

参考：Skunk Works（洛克希德）、ThoughtWorks、DreamWorks。

**已占用域名（未采用）**：

- luminaryworks.com — 美国编辑服务公司
- luminaryworks.net — 休斯顿 AI 公司
- luminousworks.com — 已注册

## 4. 各产品决策摘要

详细产品规划见 [`products/`](./products/index.md)。

### 4.1 DataLuminary — 数据明鉴 · dataluminary.dev

- **旧组织**：[DataLuminary](https://github.com/DataLuminary) → **新组织**：`dataluminary`
- **含义**：Luminary = 发光体、照亮黑暗 →「用 AI 照亮数据，发现洞察」
- **放弃**：DataPolaris（Polaris 商标与品牌泛滥）、DataBeacon（抢注）

### 4.2 BlockyEdu — 智码工坊 · blockyedu.com

- **旧组织**：[blockyEdu](https://github.com/blockyEdu) → **新组织**：`blockyedu`
- **约束**：基于 Google Blockly，不能使用 `blockly` 商标
- **AI 差异化**：Copilot（Text→Blockly）、Tutor、Debugger、Challenge、Assessment

### 4.3 DoerFlow — 智工网 · doerflow.dev

- **旧品牌/组织**：VibeAgent / [AgentSkillMesh](https://github.com/AgentSkillMesh) → **新组织**：`doerflow`
- **定位**：The Liquidity Protocol for Autonomous Agents（自主执行体的价值流动协议）
- **Doer** = Human = Agent（自主执行体）；**Flow** = 任务 + 价值流转
- **放弃**：ValueMesh（太抽象）、WorkMesh（烂大街）、TaskBound（偏窄、无支付含义）

### 4.4 VistaCast — 视界云遥 · vistacast.dev

- **定位**：AI Visual Autopilot — 纯软件 AI 云监控 SaaS（ONVIF/RTSP 摄像头 + AI 告警/客流）
- **Slogan**：把线下店铺变成数字化数据流
- **场景**：仓储防盗、门店客流、工厂危险区域
- **与 VistaRemote 关系**：**并存**，不替代；VistaCast 做固定摄像头 AI，VistaRemote 做远程桌面人工触达
- **实现节奏**：文档与 spec 先行；编码排在 DataLuminary、BlockyEdu 之后

### 4.5 VistaRemote — 视界远程 · VistaRemote 组织

- **定位**：跨平台 WebRTC 远程桌面 + 自托管 AI 录制洞察
- **组织**：[VistaRemote](https://github.com/VistaRemote)（远程桌面代码基线，自原 vistacast 迁回独立维护）
- **生态角色**：**控** — 人工远程运维、会话审计
- **注意**：员工监控类场景合规敏感，主打私有化与 IT/工控运维，与 VistaCast 安防叙事区分

### 4.6 SyncroBrain — 万物智脑 · syncrobrain.com

- **旧品牌/组织**：LuminaryIoTChain / [LuminaryIoTChain](https://github.com/LuminaryIoTChain) → **新组织**：`syncrobrain`
- **定位**：An AI-native operating system for connected devices.
- **Syncro** = 设备与云端实时同步；**Brain** = AI 处理与洞察
- **放弃**：SynBrain（拗口、易与 Synthetic/Synapse 混淆）、NexusIoT/FluxIoT（传统 IoT 命名）

### 4.7 生态协同叙事

```text
SyncroBrain（物理世界数据大脑）  ↔  DoerFlow（数字世界价值流动）
         Brain（思考）                    Flow（流动）
         物理设备                         Agent / Human 执行体
```

## 5. 旧名 → 新名对照（迁移用）

| 旧 GitHub 组织 | 新 GitHub 组织 | 旧品牌/仓库名 | 新品牌 | 中文名 | 主域名 |
|----------------|----------------|---------------|--------|--------|--------|
| LuminaryWorks | LuminaryWorks | — | LuminaryWorks | 启明工坊 | luminaryworks.dev |
| DataLuminary | dataluminary | DataLuminary-Platform | DataLuminary | 数据明鉴 | dataluminary.dev |
| blockyEdu | blockyedu | VibeEdu | BlockyEdu | 智码工坊 | blockyedu.com |
| AgentSkillMesh | doerflow | VibeAgent | DoerFlow | 智工网 | doerflow.dev |
| VistaRemote | VistaRemote | vibeCode | VistaRemote | 视界远程 | — |
| — | VistaCast | vistacast | VistaCast | 视界云遥 | vistacast.dev |
| LuminaryIoTChain | syncrobrain | LuminaryIoTChain | SyncroBrain | 万物智脑 | syncrobrain.com |

> MetaRepo **目录名**（如 `VibeEdu`、`VibeAgent`）可在后续迭代中逐步改为 `platform` 或与品牌一致；**组织 rename 优先**，仓库 rename 次之。操作手册见 [github-org-migration.md](./github-org-migration.md)。

## 6. 文档归属

| 内容 | 主仓 |
|------|------|
| 域名与品牌决策（本文） | LuminaryWorks `spec/` |
| 组织迁移操作 | LuminaryWorks `spec/github-org-migration.md` |
| 各产品域规格 | 各产品 `spec/` + LuminaryWorks `spec/products/` |
