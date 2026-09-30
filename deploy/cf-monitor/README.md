# LuminaryWorks · cf-monitor（Cloudflare 费用熔断）

账户级哨兵 Worker：监控 D1 / KV / R2 / AI 等绑定用量，**触预算返回 503**，降低初创期天价账单风险。

> 官方没有「账单 $0 硬封顶」。本目录用 [cf-monitor](https://github.com/littlebearapps/cf-monitor) 做应用层熔断。  
> **永远不要开通 Workers Paid**（$5/月起 + 按量）。保持 Free，平台本身也会在日请求超限时返回 1027。

## 当前账号

| 项 | 值 |
|----|----|
| Account | `Zhoulujun@live.cn's Account` |
| Account ID | `af0e854078b49637d63673c75566906b` |
| KV | `860ce86929964b5085824b841794326b`（binding: `CF_MONITOR_KV`） |
| AE | dataset `cf-monitor` / binding `CF_MONITOR_AE` |
| Worker URL | https://cf-monitor.luminaryworks.workers.dev |
| 预算 | 已 `config sync` 到 KV（Free 保守额度） |
| ADMIN_TOKEN | 已设置；本机备份见 `.admin-token.local`（勿提交） |

## 状态（已部署）

Analytics Engine 已启用；`cf-monitor` Worker 与 Cron 已上线。

本机快速检查：

```bash
curl -sS https://cf-monitor.luminaryworks.workers.dev/_health
curl -sS https://cf-monitor.luminaryworks.workers.dev/status
curl -sS https://cf-monitor.luminaryworks.workers.dev/budgets
```

重新部署：

```bash
cd deploy/cf-monitor
npm run finish-deploy
```

## 熔断何时生效

| 层 | 作用 |
|----|------|
| per-invocation | `monitor()` 包装的 Worker 内，单次请求超限立即抛错 |
| daily / monthly budgets | 小时 cron 检查；100% 时 CB → **503** |
| account / global CB | 紧急全停 |

**重要限制：**

- 只有用 `monitor()` 包装、并绑定 `CF_MONITOR_KV` / `CF_MONITOR_AE` 的 Worker 才会被硬停。
- 直接打 R2 S3 API / 未包装的 Worker **不会**被 CB 切断（仍可能按量计费）。
- cf-monitor 自身用量极低，但仍占 Free 配额（KV / Cron / AE）。

## 后续业务 Worker 接入

```ts
import { monitor } from "@littlebearapps/cf-monitor";

export default monitor({
  fetch: async (request, env, ctx) => {
    // ...
  },
});
```

Wrangler 绑定（KV id 见上表）：

```jsonc
{
  "kv_namespaces": [{ "binding": "CF_MONITOR_KV", "id": "860ce86929964b5085824b841794326b" }],
  "analytics_engine_datasets": [{ "binding": "CF_MONITOR_AE", "dataset": "cf-monitor" }],
  "tail_consumers": [{ "service": "cf-monitor" }],
  "vars": { "WORKER_NAME": "your-worker" }
}
```

或：`npx cf-monitor wire --apply`

## 计划检测权限（推荐）

当前 OAuth **无法**读 Subscriptions（plan=unknown）。为避免误用 Paid 默认预算，本仓库已写死 Free 预算。长期建议创建 API Token 并含：

- Workers Scripts: Edit  
- Workers KV Storage: Edit  
- Account Analytics: Read  
- **Account Settings: Read**（`#billing:read`，用于 Free/Paid 识别）

```bash
export CLOUDFLARE_API_TOKEN=...
npm run status
```

## 红线

1. 不要开通 **Workers Paid**  
2. 不要依赖 Dashboard **Budget Alert**（只发邮件，不停服）  
3. R2 超免费额度会继续计费且官方不停服 — 尽量经带 `monitor()` 的 Worker 访问，或先不用 R2  
