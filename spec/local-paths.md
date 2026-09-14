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

曾用 `master` 的仓已统一为 **`main`（发布线）+ `dev`（默认开发）**。`pnpm sync:dev-branch` 会：仅有 `master` 时改名为 `main`；同时存在 `main`+`master` 且 tip 已包含在 `main` 时删除残留 `master`。

### 批量命令（MetaRepo 根目录）

| 命令 | 作用 |
|------|------|
| `pnpm sync:dev-branch` | 各组织仓：确保有 `dev`/`main`、GitHub 默认分支为 `dev` |
| `pnpm checkout:dev` | **扫描本地全部生态仓**（LuminaryWorks + DataLuminary / BlockyEdu / DoerFlow / VistaCast / VistaRemote / SyncroBrain 及其**嵌套子仓**），全部切到 `dev` |
| `pnpm sync:commit-branches` | 在 **`dev` 上**提交本地改动 → 能自动合并的把远程 `main` 对齐到 `dev` 并 push；**本地始终停在 `dev`**（不长期 checkout `main`）；冲突则汇总清单 |

```bash
# 1）远程默认分支 + 创建缺失的 dev（可先 --dry-run）
pnpm sync:dev-branch
# 或：node scripts/sync-ecosystem-dev-branch.mjs --dry-run

# 2）本地所有生态仓（含嵌套）checkout 到 dev
pnpm checkout:dev

# 3）提交本地改动，并把远程 main 对齐到 dev（本地仍停在 dev）
pnpm sync:commit-branches
# 或：node scripts/sync-commit-branches.mjs --dry-run
```

### `sync:commit-branches` 行为（dev 开发 / 合并到 main）

日常：**只在 `dev` 上改代码**。发布时把 `dev` 合进远程 `main`，本地 checkout **不切到 `main`**。

1. 确保当前在 `dev`，提交未提交改动
2. 若远程 `main` 领先 → 合并进本地 `dev`（可自动则自动，冲突则留在 `dev` 上待手修）
3. `git push origin HEAD:dev`
4. 优先 `git push origin HEAD:main`（快进更新远程 `main`，**不 checkout main**）
5. 仅当快进失败时，短暂切到 `main` merge 后立刻回到 `dev`
6. `finally`：保证工作树回到 `dev`

冲突：该仓不中断全量扫描；结束后打印 **MANUAL ACTION REQUIRED**。修完后重跑 `pnpm sync:commit-branches`。

### 冲突时怎么办

- Git **能自动合并**的：脚本合并并 push，本地仍在 `dev`。
- **不能自动合并**的：冲突留在 `dev`（或已 abort 临时 `main` 合并）；清单里给路径与建议命令。
- 放弃某次合并：`cd <仓>` → `git merge --abort` → `git checkout dev` → `git reset --hard origin/dev`。

> **历史**：GitHub 组织曾由 `AgentSkillMesh` 等更名；主仓也曾用 `DataLuminary-Platform` / `VibeEdu` / `VibeAgent` 等名。现本地与 remote 均以本表为准。VistaRemote 远程桌面与 VistaCast 摄像头产品线并存。
