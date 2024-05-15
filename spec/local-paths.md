# LuminaryWorks 本地路径

> **约定**：`LuminaryWorks` 与六产品仓并列于同一工作区根目录 `{workspace}/`。
> `{workspace}` 就是本仓的上一级目录，**不要**在脚本或文档里写死 `D:\www`、`C:\www` 或 `~/www`。
>
> 目录名为 **PascalCase**（与 GitHub 组织 / MetaRepo 名一致）。Windows 不区分大小写；**macOS / Linux 区分**，因此必须使用 `DataLuminary/` 而不是 `dataluminary/`。
> 编排脚本通过 `scripts/lib/workspace.mjs`（Node）与 `scripts/lib/workspace.ps1`（PowerShell）解析兄弟目录，并做大小写不敏感回退。

| 品牌 | 中文名 | 相对路径（相对 `{workspace}/`） | GitHub 组织 / MetaRepo |
|------|--------|----------------------------------|-------------------------|
| LuminaryWorks | 启明工坊 | `LuminaryWorks/` | [LuminaryWorks/LuminaryWorks](https://github.com/LuminaryWorks/LuminaryWorks) |
| DataLuminary | 数据明鉴 | `DataLuminary/` | [DataLuminary/DataLuminary](https://github.com/DataLuminary/DataLuminary) |
| BlockyEdu | 智码工坊 | `BlockyEdu/` | [BlockyEdu/BlockyEdu](https://github.com/BlockyEdu/BlockyEdu) |
| DoerFlow | 智工网 | `DoerFlow/` | [DoerFlow/DoerFlow](https://github.com/DoerFlow/DoerFlow) |
| **VistaCast** | 视界云遥 | `VistaCast/` | [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast)（AI 摄像头，规划 spec） |
| **VistaRemote** | 视界远程 | `VistaRemote/` | [VistaRemote/VistaRemote](https://github.com/VistaRemote/VistaRemote) |
| SyncroBrain | 万物智脑 | `SyncroBrain/` | [SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) |

校验本地布局与 `origin`：

```bash
pnpm verify:migration
# 或：node scripts/verify-migration.mjs
```

> **历史**：GitHub 组织曾由 `AgentSkillMesh` 等更名；主仓也曾用 `DataLuminary-Platform` / `VibeEdu` / `VibeAgent` 等名。现本地与 remote 均以本表为准。VistaRemote 远程桌面与 VistaCast 摄像头产品线并存。
