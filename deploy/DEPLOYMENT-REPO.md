# Production private delivery（编排仓入口）

> **布局决策（Accepted）**：[spec/decisions/2026-09-deployment-sibling-repo.md](../spec/decisions/2026-09-deployment-sibling-repo.md)  
> deployment **保持工作区兄弟目录**，**不要**嵌套成 `LuminaryWorks/deployment/`（不像 `identity/` / `shared/`）。

| | MetaRepo `deploy/` | 兄弟仓 `LuminaryWorksDeployment` |
|---|---|---|
| 路径 | `LuminaryWorks/deploy/` | `{workspace}/LuminaryWorksDeployment/` |
| GitHub | 随 MetaRepo | https://github.com/LuminaryWorks/deployment |
| 职责 | Compose 契约、HANDBOOK、实验室 kit / 场景 | 版本钉死、安装/更新、HK→OVH 晋级、downloads 聚合 |
| CI | 实验室 / 契约相关 | 候选构建与人工批准部署（可选；前期默认本机 SSH） |

## 本机怎么用

```bash
cd ../LuminaryWorksDeployment
cp hosts/hk-staging/secrets.env.example hosts/hk-staging/secrets.env
# edit DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY_FILE
node cli/lw.mjs ship --version 0.1.0-candidate --to hk-staging
# after HK OK, same version:
node cli/lw.mjs ship --version 0.1.0-candidate --to ovh-production --confirm yes
```

详情见该仓 `docs/LOCAL-FIRST.md`（若存在）与 `README.md`。

MetaRepo 仍拥有：控制面 Compose、`pnpm pack:luminaryworks` / `pack:all`、以及 `spec/composable-deployment.md`。
