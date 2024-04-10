# VistaCast 产品规划 · 视界云遥

> **组织**：[github.com/VistaCast](https://github.com/VistaCast) · **MetaRepo**：[VistaCast/vistacast](https://github.com/VistaCast/vistacast) · **域名**：[vistacast.dev](https://vistacast.dev)  
> **Slogan**：AI Visual Autopilot — 把线下店铺变成数字化数据流。  
> **实现状态**：📋 **规划 / 文档阶段**（优先完成 DataLuminary、BlockyEdu 后再启动编码）

## 1. 定位

**纯软件 AI 云监控 SaaS** — 兼容海康、大华、小米、TP-Link 等 ONVIF/RTSP 摄像头，不做硬件。

| 维度 | 说明 |
|------|------|
| 独立价值 | 仓储防盗、门店客流、工厂危险区域告警 — 安全与资产类 SaaS |
| 生态角色 | **视** — 线下视觉数据流 + AI 事件源 |
| 受众 | 连锁零售、仓储物流、中小工厂、物业安防 |

与 **[VistaRemote](./vistaremote.md)**（远程桌面运维）**并存**：VistaRemote 负责 WebRTC 人工触达现场；VistaCast 负责固定摄像头 AI 分析，二者品牌、组织、代码仓分离。

## 2. 为何新增 VistaCast（与 VistaRemote 分工）

| 远程桌面监控（VistaRemote） | AI 摄像头监控（VistaCast） |
|---------------------------|----------------------------|
| 效率类 SaaS，红海 | 安全与资产类 SaaS，溢价空间大 |
| 员工隐私合规压力 | 防盗、合规、运营优化 |
| WebRTC 会话、人工操作 | ONVIF 摄像头、自动 AI 告警 |
| 竞品：TeamViewer 类 | 竞品：传统 NVR + 自研 AI 层 |

## 3. 目标场景

1. **仓储防盗** — 陌生人脸、夜间异动、越界  
2. **奶茶店出餐口** — 客流、排队、出餐效率  
3. **工厂危险区域** — 未授权进入、跌倒/烟雾/打架  

## 4. AI 能力（规划）

| 能力 | 说明 | 阶段 |
|------|------|------|
| 人脸识别 | 陌生人出现自动告警 | M1 |
| 异常检测 | 摔倒、打架、冒烟 | M2 |
| 客流统计 | 进店人数、时段分布 | M1 |
| 员工监管 | 离岗、玩手机（可配置区域） | M2 |
| 跨摄像头追踪 | Re-ID 轨迹 | M3 |

## 5. 技术栈（规划）

NestJS + **Fastify** + TypeORM + PostgreSQL · ONVIF/RTSP · WebSocket · Rsbuild + React Admin · 可选 `@luminaryworks/auth-core`

## 6. 兄弟产品集成

| 产品 | 场景 |
|------|------|
| DataLuminary | 告警/客流大屏、运营报表 |
| SyncroBrain | 设备台账联动、IoT 告警互补 |
| DoerFlow | 自动化处置 Skill |
| BlockyEdu | 安防与数据分析实训 |
| VistaRemote | 告警后人工远程介入（可选组合） |

## 7. 里程碑

| 阶段 | 目标 |
|------|------|
| D0 | 生态文档与 spec 定稿（当前） |
| M1 | ONVIF 注册 + 基础 Admin + 客流/陌生人告警 |
| M2 | 异常检测 + 规则引擎 |
| M3 | 跨摄像头追踪 + DataLuminary 深度集成 |

## 8. 相关文档

- 本地 spec（规划）：`D:\www\vistacast\spec\` · GitHub：[VistaCast/vistacast](https://github.com/VistaCast/vistacast)
- 兄弟产品：[vistaremote.md](./vistaremote.md)
- 生态：[domain-and-branding.md §4.4–4.5](../domain-and-branding.md)
