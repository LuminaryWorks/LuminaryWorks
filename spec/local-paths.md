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
| **VistaCast** | 视界云遥 | `VistaCast/` | [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast)（AI 摄像头 MetaRepo） |
| **VistaRemote** | 视界远程 | `VistaRemote/` | [VistaRemote/VistaRemote](https://github.com/VistaRemote/VistaRemote) |
| SyncroBrain | 万物智脑 | `SyncroBrain/` | [SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) |

校验本地布局与 `origin`：

```bash
pnpm verify:migration
# 或：node scripts/verify-migration.mjs
```

## Git 分支（生态统一）

| 分支 | 用途 |
|------|------|
| **`dev`** | 日常开发；GitHub **默认分支**；本地 `git checkout dev` 后改代码、跑验证 |
| **`main`** | 发布线；仅当 `dev` 验收通过后合并，再打 tag / 部署 |

工作流：

1. 在 `dev` 上开发并 push
2. 本地或 CI 验证通过后，将 `dev` 合并进 `main`（PR 或直接 merge）
3. 从 `main` 打 release tag 并发布

曾用 `master` 的仓（LuminaryWorks、identity、shared、docs、SyncroBrain 等）已统一为 `main` + `dev`。

批量对齐各组织仓库默认分支与 `dev`/`main` 同步：

```bash
node scripts/sync-ecosystem-dev-branch.mjs
node scripts/sync-ecosystem-dev-branch.mjs --dry-run   # 仅预览
```

> **历史**：GitHub 组织曾由 `AgentSkillMesh` 等更名；主仓也曾用 `DataLuminary-Platform` / `VibeEdu` / `VibeAgent` 等名。现本地与 remote 均以本表为准。VistaRemote 远程桌面与 VistaCast 摄像头产品线并存。
