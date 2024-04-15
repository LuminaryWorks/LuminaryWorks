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

## 6. 相关文档

- 实现仓：`spec/product-spec.md`、`spec/ai-platform-spec.md`
- 生态：[domain-and-branding.md §4.2](../domain-and-branding.md#42-blockyedu--blockyeducom)
