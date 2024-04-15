# SyncroBrain 产品规划 · 万物智脑

> **中文名**：万物智脑 · **域名**：[syncrobrain.com](https://syncrobrain.com) · **组织**：[github.com/syncrobrain](https://github.com/syncrobrain)  
> **旧名**：LuminaryIoTChain  
> **Slogan**：An AI-native operating system for connected devices.

## 1. 定位

**连接设备的 AI 原生操作系统** — 从「让设备联网」升级为「让设备通过 AI 大脑产生价值」。

| 维度 | 说明 |
|------|------|
| 独立价值 | 开源可私有化 IoT PaaS，替代涂鸦类闭源方案 |
| 生态角色 | **连** — 物理世界数据大脑，与 DoerFlow（数字 Flow）形成闭环 |
| 受众 | 硬件厂商、集成商、充电桩/储能等设备商 |

## 2. 平台能力

| 层 | 能力 |
|----|------|
| 设备 | 接入、影子、OTA、多协议 |
| 连接 | MQTT（EMQX）、高并发同步（Syncro） |
| 边缘 | 规则引擎、边缘推理 |
| 数据 | 时序、数字孪生 |
| AI | 推理编排、Agent 接入 |
| 商业 | DoerFlow 链上结算、DataLuminary 大屏 |

## 3. 与涂鸦（Tuya）差异

| 维度 | 涂鸦 | SyncroBrain |
|------|------|-------------|
| 模式 | 闭源 SaaS | **开源可私有化** |
| 核心 | 设备管理、场景 | **AI + 数据 + 链上变现** |
| 可视化 | 内置面板 | **DataLuminary DataTalk** |
| 远程 | 有限 | **VistaRemote**（桌面）+ **VistaCast**（摄像头 AI，规划） |
| 开发者 | 涂鸦开发者平台 | **BlockyEdu** AI 实验课 |

## 4. 生态协同

```text
SyncroBrain（Brain · 物理数据）  ↔  DoerFlow（Flow · 价值流转）
```

- 设备遥测 → DataLuminary 洞察  
- 告警 → VistaCast AI 检测 / VistaRemote 人工远程  
- 设备算力/数据 → DoerFlow 注册与结算  
- 工程师培养 → BlockyEdu ESPHome/MQTT 课程  

## 5. 技术栈

ThingsBoard CE、EMQX OSS、NestJS 编排层、PostgreSQL · MQTT / REST

## 6. 里程碑（产品向）

| 阶段 | 目标 |
|------|------|
| M1 | 设备接入 + 规则 + 控制台 |
| M2 | DataLuminary 大屏嵌入 + VistaCast 入口 |
| M3 | DoerFlow 设备 Agent 与微支付 |

## 7. 相关文档

- 实现仓：`spec/platform-vision.md`、`spec/architecture.md`
- 生态：[domain-and-branding.md §4.5](../domain-and-branding.md#45-syncrobrain--syncrobraincom)
