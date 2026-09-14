# ADR：deployment 发布仓保持兄弟目录，不嵌套进 MetaRepo（2026-09）

> **状态**：Accepted · **决策日**：2026-09-13  
> **本地路径**：`{workspace}/LuminaryWorksDeployment`  
> **GitHub**：https://github.com/LuminaryWorks/deployment  
> **MetaRepo 入口**：[deploy/DEPLOYMENT-REPO.md](../../deploy/DEPLOYMENT-REPO.md)

## 1. 背景（Context）

生态私有化交付需要独立的发布编排：版本 manifest、安装器/更新器、HK→OVH 人工晋级、客户端下载聚合。实现上已建立独立仓 `LuminaryWorks/deployment`。

曾讨论是否把它做成 MetaRepo 下的**嵌套独立 Git**（类似 `identity/`、`shared/`、`docs/`、`website/`），以便「打开一个父目录就能看到全部」。

对照：

| 路径 | 角色 |
|------|------|
| `LuminaryWorks/deploy/` | MetaRepo **内**的部署契约与实验室介质（Compose、HANDBOOK、kit 文档） |
| `LuminaryWorksDeployment/`（兄弟仓） | **发版工厂 + 私有化交付运营** |
| `LuminaryWorks/identity/` 等嵌套仓 | MetaRepo **日常开发依赖**（bootstrap、联调、共享库） |

## 2. 决策（Decision）

### D-DEP-1 · deployment 保持工作区兄弟目录，禁止嵌套进 MetaRepo

```text
{workspace}/
├── LuminaryWorks/                 # MetaRepo
├── LuminaryWorksDeployment/       # 发布编排（独立 Git / 独立 remote）
├── DataLuminary/
└── …
```

**禁止**：

- 把 deployment 挪到 `LuminaryWorks/deployment/` 作为嵌套仓（即便 `.gitignore` + 独立 remote）
- 把 OVH / HK 生产部署 workflow 或 Deploy secrets 并进 MetaRepo 默认 CI
- 把 `LuminaryWorks/deploy/` 与 deployment 仓混称为「同一个 deploy」

**允许**：

- MetaRepo 文档与脚本**指向**兄弟仓（本 ADR、`deploy/DEPLOYMENT-REPO.md`）
- 可选辅助命令（例如检查 sibling 是否存在 / 打印 clone 提示）；**不得**在 `pnpm bootstrap` 里强制 clone deployment

### D-DEP-2 · `identity` / `shared` 的嵌套模式不套用到 deployment

嵌套适用于「开发时几乎每次都要碰到的运行时依赖」。deployment 不参与控制面日常起栈，也不被产品 `pnpm install` 引用；套用同一布局只会模糊权限与发布节奏。

### D-DEP-3 · 两仓分工冻结

| 改什么 | 去哪 |
|--------|------|
| 控制面 Compose、实验室 `pack:*`、HANDBOOK、场景契约 | `LuminaryWorks/deploy/` + MetaRepo scripts |
| 候选版本、digest 钉死、install/update/rollback、HK/OVH 晋级、downloads 聚合 | `LuminaryWorksDeployment` |
| 产品业务 Compose / 迁移 | 各产品仓 |

真相不双写：deployment 通过 `catalog/repos.yaml` + release manifest 的 SHA/digest **引用** MetaRepo 与产品仓，不复制业务 Compose 权威。

## 3. 理由（Why）

1. **心智边界**：避免「改 MetaRepo ≈ 改生产发布」。
2. **权限隔离**：生产 SSH / Environment secrets 挂在 deployment remote；MetaRepo 协作者不必默认碰到。
3. **发布节奏**：产品与 MetaRepo 可高频提交；生产晋级要人工窗口与同一 digest，不宜绑在 MetaRepo 默认流水线。
4. **客户交付**：私有化客户单独 clone 编排仓即可二次改 `catalog` / 安装器，不必拉整份 MetaRepo 叙事树。
5. **嵌套成本**：要在 init、bootstrap、`.gitignore`、文档里再开特例，收益只是少一层找目录。

## 4. 何时可以重开讨论

仅当**同时**满足且另立 ADR 推翻本决策时：

- 维护者极少，且强烈要求单父目录浏览；
- 仍保持独立 remote 与独立 Environments；
- 明确 bootstrap **不**自动拉 deployment，且生产 secrets **不**挂 MetaRepo。

即使重开，也只改**本地布局**，不把生产 workflow 并进 MetaRepo CI。

## 5. 下次被问时的标准答法

> deployment 是兄弟仓，不是 `identity`/`shared` 那种嵌套仓。  
> `LuminaryWorks/deploy` = 契约与实验室；`LuminaryWorksDeployment` = 发版与私有化交付。  
> 权威决策见 `spec/decisions/2026-09-deployment-sibling-repo.md`。

## 6. 相关链接

- 编排仓 README：`LuminaryWorksDeployment/README.md`
- 验收清单：`LuminaryWorksDeployment/docs/ACCEPTANCE.md`
- 可组合部署规格：[composable-deployment.md](../composable-deployment.md)
