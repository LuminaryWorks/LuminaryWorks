# LuminaryWorks — Agent 规则（LuminaryWorks 生态）

本仓是**产品仓**。上线权威在 sibling：`../LuminaryWorksDeployment/AGENTS.md`（必读）。

## 角色

- 允许：修代码、本机验证、commit、push（默认 `main`）、回报 sha。
- 允许：用户要求「发布到线上」时，**同会话** `cd ../LuminaryWorksDeployment` 按该仓 `AGENTS.md` 执行 ship。
- 禁止：在本仓直接 SSH 改 VPS、生产 `docker compose`、改远端 `/etc/luminaryworks`（除非用户只要排障、明确不上新版本）。
- 禁止：发明第二套发版方式；禁止覆盖已上线 pack 版本号。

## 用户说「发布 / 上线 / 紧急修复 / demo 预览」

1. `git fetch && git pull --ff-only`
2. 完成本机可复现验证
3. commit + push `origin/main`（或本仓 release 分支）
4. 输出 Hand-off：
   - `product: luminaryworks`
   - `sha: <full>`
   - `summary: ` 3～5 条
5. 进入 `../LuminaryWorksDeployment`，按该仓协议：新 `NEWVER` → prepare → ship → accept → promote → 回执（含 `PREV` 与 rollback 命令）
6. 主机不可达或 accept 失败 → 如实 STOP，不得声称已上线

## 双机 / 多工具

- Win+Mac：真相在 Git remote；未 push 视为不存在。
- Cursor 与 ChatGPT：遵守本文件 + 部署仓 `AGENTS.md`。

## 版本与回滚（你需要知道的）

- 线上回滚的是**安装包版本**，不是单独「只回滚本仓 tag」。
- 分析：对比两版 `release-manifest.yaml` 的 `sources.luminaryworks.sha`，再 `git log <好>..<坏>`。
- 数据迁移/破坏性变更必须在发版回执里写明（DB 不会随 rollback 指针自动恢复）。

## 本仓标识

- catalog id: `luminaryworks`
- GitHub: `LuminaryWorks/LuminaryWorks`
