# GitHub 组织与仓库迁移手册 (v1.0)

> **状态**：Ready · **前置**：[domain-and-branding.md](./domain-and-branding.md)  
> **范围**：将 GitHub 组织名与主域名对齐，并更新所有文档与本地 `git remote`。

## 1. 迁移矩阵

| # | 当前组织 | 目标组织 | 主仓（当前 → 建议） | 域名 |
|---|----------|----------|---------------------|------|
| 0 | LuminaryWorks | LuminaryWorks | 不变 | luminaryworks.dev |
| 1 | DataLuminary | **dataluminary** | DataLuminary-Platform → platform（可选） | dataluminary.dev |
| 2 | blockyEdu | **blockyedu** | VibeEdu → platform（可选） | blockyedu.com |
| 3 | AgentSkillMesh | **doerflow** | VibeAgent → platform（可选） | doerflow.dev |
| 4 | VistaRemote | **vistacast** | vibeCode → platform（可选） | vistacast.dev |
| 5 | LuminaryIoTChain | **syncrobrain** | LuminaryIoTChain → platform（可选） | syncrobrain.com |

**阶段建议**：

1. **Phase A**：创建/重命名 GitHub 组织 → 更新 `origin` remote → 更新文档链接  
2. **Phase B**（可选）：主仓 rename（如 `VibeAgent` → `platform`）  
3. **Phase C** ✅（2026-06）：本地目录 rename → 见 [local-paths.md](./local-paths.md)

### 1.1 VistaCast 与 VistaRemote（2026-06 补充）

历史上曾将 VistaRemote 组织 rename 为 `vistacast`。现 **二者并存**：

| 品牌 | 组织 | 产品 | 本地路径 |
|------|------|------|----------|
| VistaCast | [VistaCast](https://github.com/VistaCast) | AI 摄像头云监控 | `D:\www\vistacast` · [VistaCast/vistacast](https://github.com/VistaCast/vistacast) |
| VistaRemote | [VistaRemote](https://github.com/VistaRemote) | WebRTC 远程桌面 | `D:\www\vistaremote` |

远程桌面代码维护在 **VistaRemote** 组织；VistaCast 为新产品线，编码排在 DataLuminary、BlockyEdu 之后。详见 [products/vistacast.md](./products/vistacast.md)、[products/vistaremote.md](./products/vistaremote.md)。

## 2. GitHub 组织操作（Phase A）

**自动化脚本**（推荐，需先 `gh auth login`）：

```powershell
# LuminaryWorks 根目录
.\scripts\rename-github-orgs.ps1          # 交互确认后 rename
.\scripts\rename-github-orgs.ps1 -WhatIf  # 仅预览
.\scripts\update-git-remotes.ps1          # rename 后更新本地 origin
```

Bash：`./scripts/rename-github-orgs.sh`

**若 `gh auth status` 无 `admin:org` scope**（API rename 会静默失败）：

1. 执行 `gh auth refresh -h github.com -s admin:org` 并在浏览器完成设备码授权  
2. **或** 运行 `.\scripts\open-org-rename-pages.ps1` 在浏览器手动改组织名  
3. 完成后运行 `.\scripts\verify-migration.ps1` 确认

手动改组织名入口（须 Organization Owner）：

| 当前组织 | 改为 | 设置页 |
|----------|------|--------|
| AgentSkillMesh | doerflow | https://github.com/organizations/AgentSkillMesh/settings/profile |
| VistaRemote | vistacast | https://github.com/organizations/VistaRemote/settings/profile |
| LuminaryIoTChain | syncrobrain | https://github.com/organizations/LuminaryIoTChain/settings/profile |

### 2.1 方式一：组织 Rename（推荐，若名称未被占用）

GitHub 支持组织 rename，旧 URL 会自动重定向。

1. 以 Owner 登录 → **Organization settings** → **Profile** → **Change organization name**
2. 将名称改为目标（如 `AgentSkillMesh` → `doerflow`）
3. 确认重定向生效：`https://github.com/AgentSkillMesh/VibeAgent` → 应跳转到新组织

**注意**：

- 目标名若已被占用，须用方式二（新建组织 + 转移仓库）
- Rename 后更新本地 remote（见 §3）
- 检查 GitHub Packages、`@scope` npm 包、CI secrets 中的组织名

### 2.2 方式二：新建组织 + Transfer

目标组织名已被占用时使用：

1. 创建新组织（如 `doerflow`）
2. **Settings → Transfer ownership** 将各仓库迁入新组织
3. 旧组织保留为空壳或归档，文档中标注 deprecated

### 2.3 DoerFlow 子仓清单

DoerFlow（原 AgentSkillMesh）除 MetaRepo 外还有多子仓，需一并迁移：

| 子仓 | 当前路径 | 迁移后 |
|------|----------|--------|
| MetaRepo | `AgentSkillMesh/VibeAgent` | `doerflow/platform` |
| docs | `AgentSkillMesh/docs` | `doerflow/docs` |
| contracts | `AgentSkillMesh/contracts` | `doerflow/contracts` |
| api | `AgentSkillMesh/api` | `doerflow/api` |
| web | `AgentSkillMesh/web` | `doerflow/web` |
| p2p | `AgentSkillMesh/p2p` | `doerflow/p2p` |
| shared | `AgentSkillMesh/shared` | `doerflow/shared` |
| wallet | `AgentSkillMesh/wallet` | `doerflow/wallet` |
| worker | `AgentSkillMesh/worker` | `doerflow/worker` |
| admin | `AgentSkillMesh/admin` | `doerflow/admin` |

迁移后更新 `repos.manifest.json` 与 `spec/REPOS.md` 中的组织前缀。

## 3. 本地 Git Remote 更新

在各 MetaRepo 根目录执行（示例：DoerFlow）：

```bash
# 查看当前 remote
git remote -v

# HTTPS
git remote set-url origin https://github.com/doerflow/platform.git

# 或 SSH
git remote set-url origin git@github.com:doerflow/platform.git
```

**五产品 + LuminaryWorks 子仓** 均需检查 `origin`（及子模块/嵌套仓若有）。

### 3.1 批量查找旧 URL 引用

在本地工作区根目录（如 `D:\www`）：

```powershell
# PowerShell — 查找仍引用旧组织的文件
Get-ChildItem -Recurse -Include *.md,*.json,*.yaml,*.yml,*.ts,*.tsx,*.mjs,*.ps1,*.sh `
  -Exclude node_modules,.git,dist,build | 
  Select-String -Pattern 'github\.com/(DataLuminary|blockyEdu|AgentSkillMesh|VistaRemote|LuminaryIoTChain)' |
  Select-Object Path, LineNumber, Line
```

替换规则见 [domain-and-branding.md §5](./domain-and-branding.md#5-旧名--新名对照迁移用)。

## 4. 文档与 CI 检查清单

每完成一个组织迁移，勾选：

- [ ] GitHub 组织名 / 仓库 transfer 完成
- [ ] 本地 `git remote` 已更新
- [ ] 产品仓 `spec/ecosystem*.md` 组织链接已更新
- [ ] LuminaryWorks `README.md`、`spec/repository-relationships.md` 已更新
- [ ] LuminaryWorks `spec/products/*.md` 链接正确
- [ ] CI workflow 中 `GITHUB_REPOSITORY`、Packages scope 已更新
- [ ] `identity` 应用注册回调 URL（若含 GitHub Pages 域名）已更新
- [ ] npm / pnpm `publishConfig.registry` 与 package scope 已核对

## 5. LuminaryWorks 生态仓（无需 rename）

以下组织保持 **LuminaryWorks**：

| 仓库 | 用途 |
|------|------|
| LuminaryWorks/LuminaryWorks | 编排 MetaRepo |
| LuminaryWorks/docs | 对外文档站 |
| LuminaryWorks/identity | 统一登录 |
| LuminaryWorks/shared | `@luminary/*` 共享包 |

## 6. 回滚

- 组织 rename 可在 24 小时内通过 GitHub 支持或再次 rename 回退（视占用情况而定）
- Transfer 可通过反向 transfer 迁回
- 文档变更通过 Git revert；**先完成组织迁移再合并文档 PR**，避免链接短暂失效

## 7. 当前状态跟踪

| 组织 | Phase A | local remote | 文档 | 备注 |
|------|---------|--------------|------|------|
| dataluminary | ✅ 2026-06 | ✅ | ✅ | 数据明鉴；GitHub 显示 DataLuminary（大小写等价） |
| blockyedu | ✅ 2026-06 | ✅ | ✅ | 智码工坊 |
| doerflow | ✅ 2026-06 | ✅ | ✅ | 智工网 |
| vistacast | ✅ 2026-06 | ✅ | ✅ | 视界云遥 |
| syncrobrain | ✅ 2026-06 | ✅ | ✅ | 万物智脑 |

Phase A 已于 2026-06 完成。
