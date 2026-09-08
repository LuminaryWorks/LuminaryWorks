# Hosted SaaS 单 VPS 生产验收

给 **OVH VPS-4（24 GiB / 200 GiB NVMe）** 上的公网 SaaS：控制面 + 对象存储 + 可选 Doris Pilot。  
产品 Compose 仍然各自独立；本页只验收 **控制面、支付、存储水位、试用清理和回滚**。

规范：[spec/decisions/2026-09-storage-doris-payment.md](../spec/decisions/2026-09-storage-doris-payment.md) · [spec/payment-platform.md](../spec/payment-platform.md)。  
实验室口令不要写进本合同。安装顺序见 [HANDBOOK.md](HANDBOOK.md)。

静态契约（不启容器）:

```bash
pnpm preflight:hosted-saas
pnpm preflight:control-plane --stage production --strict
pnpm preflight:object-storage --strict
```

## 1. 边缘与身份

- [ ] 浏览器全程 HTTPS；证书在 Cloudflare / Caddy，不在容器里终止公网 TLS
- [ ] `CONTROL_PLANE_BIND_ADDR=127.0.0.1`；只有反代看到 3001 / 3010 / 3040 / 3050
- [ ] Logto Admin `:3002` 仅 loopback / VPN
- [ ] 反代是唯一可信代理：`PAYMENT_TRUSTED_PROXIES` 填入 Cloudflare/Caddy 出口；拒绝客户端伪造的 `X-Forwarded-For` / `CF-IPCountry`
- [ ] 注册开启验证码 / 限流；社交登录在超管控制台登录页关闭
- [ ] Control Console 已注册 Logto SPA，`CONTROL_CONSOLE_IDP_CLIENT_ID` 有值，**没有** client secret

## 2. 支付

- [ ] `PAYMENT_CONFIG_MASTER_KEY` 为 32 字节 hex，与数据库备份分开保管
- [ ] 国内 IP 只展示已启用的支付宝；海外展示超管启用的渠道；CN 账户隐藏加密渠道
- [ ] 公开回调 `POST /v1/payments/webhooks/:provider/:configId` 可达，且 **不** 走 admin JWT
- [ ] 无效签名、旧时间戳、重复事件、金额/币种不匹配均被拒绝（sandbox fixture 已覆盖）
- [ ] 未签约渠道保持 `enabled=false`，超管页不得显示为可用

## 3. MinIO AIStor Free

- [ ] Overlay 已启用；镜像 digest/`RELEASE` 已确认；许可证文件存在且未进 Git / 离线包
- [ ] API / Console 仅 loopback；公共缩略图走 CDN 签名 URL，录像桶保持私有
- [ ] 桶配额合计 ≤ 120 GiB；水位 70% 停新 Trial 录像、80% 停全部 Trial 上传、90% 停非删除写入
- [ ] 故障演练：停 `object-storage` 后产品 `/ready` 降级而不是拖垮 Entitlement
- [ ] 进程重启后 bucket / policy / 用量仍在

## 4. Doris Pilot

- [ ] FE 2 GiB + BE 4 GiB cgroup；主机 `vm.max_map_count` 已设
- [ ] 启动 Doris **没有** 停 ThingsBoard / 媒体 / AI / TURN
- [ ] 慢查询 / OOM 返回 `DORIS_DEMO_BUSY`，DataView 显示购买专属 Doris CTA
- [ ] 24 小时混合负载未通过前只允许 `pilot` 标识

## 5. Trial 清理

- [ ] 中英文《服务条款》《隐私》《Trial 与数据删除》已挂在注册与 Trial 激活勾选处
- [ ] T-3 / T-1 通知；到期立即 402；`trial.purge` HMAC 可重放
- [ ] 升级付费会取消清理；付款晚于物理删除不得伪造恢复
- [ ] VistaCast / SyncroBrain 保持 `sellable=false`，无 Trial CTA

## 6. 备份与回滚

- [ ] 控制面库、产品库、MinIO 卷分别 `pg_dump` / 快照
- [ ] N-1 镜像 tag 可 `compose up` 回滚；迁移向前兼容
- [ ] 演练一次 restore：订单、订阅、政策接受记录仍在，Trial 对象不再出现

## 7. 单机容量诚实标注

本机是 **Pilot**：MinIO 无 HA、Doris 无 SLA。超管容量页只读探针，不承诺多租户生产集群。用户文档必须写清这一点。
