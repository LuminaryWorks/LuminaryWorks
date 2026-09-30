# LuminaryWorks 点播网关

> **状态**：Accepted  
> **实现**：`services/media-gateway`（NestJS + Fastify）· `services/media-gateway/edge`（Cloudflare Worker）  
> **播放器**：`packages/media-player`  
> **合同**：`contracts/api/media-gateway.v1.yaml`

直播信令仍在各产品的 `media-platform`。本服务只做点播：BlockyEdu 课程、EntFunHub 自有片，以及以后 VistaRemote / VistaCast 的回放。回放约定为同一 HLS 会话，本阶段不改录制管线。

## 1. 不变量

1. 浏览器播放的是 m3u8。分片是 AES-128 加密的 MPEG-TS，对象键以 `.m4s` 结尾。公开后缀可以是 `.m4s`、`.seg`、`.webp`、`.bin` 之一，由资产固定，不按请求随机更换。Playwright 已确认 `xgplayer` 3.0.26 / `xgplayer-hls` 3.0.26 能播放清单里的 `.seg`，并且 `hls.onPreM3U8Parse` 会在解析前被调用。生产路径仍由网关改写清单；播放器不再改后缀，避免和签名路径不一致。
2. 业务进程（Nest / Go）不转发视频字节。清单和 16 字节密钥走网关。分片走边缘。
3. 浏览器不拿到对象存储主机名。边缘用服务端凭证向私有桶取对象，缓存键是去掉查询串后的规范对象键。
4. AES 密钥只在网关存储（`REDIS_URL` 设了则用 Redis，否则实验室文件库）。密钥文件不上传。
5. 播放地址带 `exp`、`sid`、`sig`。默认 20 分钟。过期即失效。续期必须再次经过产品的登录与权限检查。
6. 产品用 `Authorization: Bearer <MEDIA_GATEWAY_SERVICE_KEY>` 注册资产和签发会话。浏览器只持有短时播放 URL。

AES-128 阻止未授权拼接分片，不能阻止录屏。

## 2. 租户

`tenant`：`blockyedu` | `entfunhub` | `vistaremote` | `vistacast`。资产按租户隔离。

许可接受 `CC0`、`PD`、`CC-BY`、`CC-BY-SA`、`MIT`（可再分发 OER），以及 `PRIVATE`（租户自有片，仅本租户会话播放，不进入 OER 再分发）。NC、ND 与其它值拒绝注册。

## 3. 限流

签发会话：单 IP 每分钟 30 次；同一用户每 10 分钟 10 个新会话。播放中的续期不占新会话额度，单会话每分钟最多续期 30 次。密钥接口单会话每分钟 120 次。

分片在边缘限制单 IP 与单会话的并发，超限 429。缓存命中仍要验签，但不再回源。

不要把「用户每小时 20 次」用在分片或拖动进度上。长视频靠会话续期。

`MEDIA_TRUST_PROXY=1` 只在网关前面是受信任反向代理时打开。边缘使用 Cloudflare 写入的 `CF-Connecting-IP`。

## 4. 对象

```text
hls/{assetId}/{variant}/{segment}.m4s
```

清单由网关按会话现签，不把带密钥 URI 的静态清单长期放在桶里当唯一入口。桶里可以有打包时的原始清单，播放不直接使用它。

## 5. 产品接入

产品服务器在自己的权限检查通过后调用 `POST /v1/sessions`。EntFunHub 对 `luminary-vod:{assetId}` 走 `POST /api/content/luminary-vod/session`，服务端再调用本网关。现有 LSJ 与 AWS 播放不变。

本地验收用 `src/local-edge.ts` 读磁盘上的规范对象。生产分片只走 Cloudflare Worker。
