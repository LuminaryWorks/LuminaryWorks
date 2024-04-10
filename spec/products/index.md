# 六产品规划索引

> **品牌决策**：[../domain-and-branding.md](../domain-and-branding.md) · **组织迁移**：[../github-org-migration.md](../github-org-migration.md)

LuminaryWorks（**启明工坊**）生态采用 **House of Brands**：六个产品各自独立品牌与 GitHub 组织（VistaCast / VistaRemote 为两个独立视觉产品线），通过 OIDC / HTTP / MQTT 按需集成。

## 品牌中英对照

| 英文品牌 | 中文名 | 域名 |
|----------|--------|------|
| LuminaryWorks | 启明工坊 | luminaryworks.dev |
| DataLuminary | 数据明鉴 | dataluminary.dev |
| BlockyEdu | 智码工坊 | blockyedu.com |
| DoerFlow | 智工网 | doerflow.dev |
| **VistaCast** | 视界云遥 | vistacast.dev |
| **VistaRemote** | 视界远程 | （VistaRemote 组织，域名待定） |
| SyncroBrain | 万物智脑 | syncrobrain.com |

## 价值链闭环

```text
         学（智码工坊）──► 连（万物智脑）──► 看（数据明鉴）
                                    │
          视（视界云遥 VistaCast）──┤  控（视界远程 VistaRemote）
                                    └──► 赚（智工网）
```

| # | 品牌 | 中文名 | GitHub | 生态角色 | 规划文档 | 编码优先级 |
|---|------|--------|--------|----------|----------|------------|
| 1 | **DataLuminary** | 数据明鉴 | [dataluminary/DataLuminary-Platform](https://github.com/dataluminary/DataLuminary-Platform) | 看 — AI 数据洞察 | [dataluminary.md](./dataluminary.md) | **P0** |
| 2 | **BlockyEdu** | 智码工坊 | [blockyedu/VibeEdu](https://github.com/blockyedu/VibeEdu) | 学 — AI 编程教育 | [blockyedu.md](./blockyedu.md) | **P0** |
| 3 | **DoerFlow** | 智工网 | [doerflow/VibeAgent](https://github.com/doerflow/VibeAgent) | 赚 — 执行者价值网络 | [doerflow.md](./doerflow.md) | P1 |
| 4 | **VistaCast** | 视界云遥 | [VistaCast/vistacast](https://github.com/VistaCast/vistacast) | 视 — AI 摄像头 | [vistacast.md](./vistacast.md) | **文档先行** |
| 5 | **VistaRemote** | 视界远程 | [VistaRemote/vibeCode](https://github.com/VistaRemote/vibeCode) | 控 — 远程桌面 | [vistaremote.md](./vistaremote.md) | ✅ |
| 6 | **SyncroBrain** | 万物智脑 | [syncrobrain/LuminaryIoTChain](https://github.com/syncrobrain/LuminaryIoTChain) | 连 — 设备 AI OS | [syncrobrain.md](./syncrobrain.md) | P1 |

## 各产品域规格（实现仓）

| 产品 | 中文名 | 主规格路径 |
|------|--------|------------|
| DataLuminary | 数据明鉴 | `dataluminary/DataLuminary-Platform/spec/` |
| BlockyEdu | 智码工坊 | `blockyedu/VibeEdu/spec/` |
| DoerFlow | 智工网 | `doerflow/VibeAgent/spec/` |
| VistaCast | 视界云遥 | [VistaCast/vistacast](https://github.com/VistaCast/vistacast) `spec/` |
| VistaRemote | 视界远程 | `vistaremote/spec/` |
| SyncroBrain | 万物智脑 | `syncrobrain/LuminaryIoTChain/spec/` |

## VistaCast vs VistaRemote

| | VistaCast | VistaRemote |
|---|-----------|-------------|
| 输入 | 固定摄像头 ONVIF/RTSP | 桌面/移动端屏幕 |
| 价值 | AI 自动告警、客流、防盗 | 人工远程操作、录制审计 |
| 合规叙事 | 安防与资产 | 员工效率（敏感，私有化交付） |
| 当前状态 | 文档 / spec | 完整 MetaRepo + 子仓 |

## 独立 vs 组合

- **独立**：每个产品可单独部署、单独销售  
- **组合**：SyncroBrain 设备 + VistaCast 摄像头 + DataLuminary 大屏；VistaCast 告警 → VistaRemote 人工介入；智码工坊培养全栈工程师
