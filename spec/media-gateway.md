# LuminaryWorks 点播网关

> **状态**：Accepted  
> **实现**：`services/media-gateway`（NestJS + Fastify）· `services/media-gateway/edge`（Cloudflare Worker）  
> **播放器**：`packages/media-player`  
> **合同**：`contracts/api/media-gateway.v1.yaml`

直播信令仍在各产品的 `media-platform`。本服务只做 **LuminaryWorks 产品** 点播：BlockyEdu 课程，以及以后 VistaRemote / VistaCast 回放。回放约定为同一 HLS 会话，本阶段不改录制管线。

## 0. 运行时隔离（硬约束）

| | LuminaryWorks media-gateway | EntFunHub / 极光 |
| --- | --- | --- |
| 运行时 | 本服务签发会话与清单 | **不调用**本服务；不登记资产；不共用 `MEDIA_GATEWAY_SERVICE_KEY` |
| 代码 | `@luminaryworks/media-player`、打包与分片 P2P loader 可发布为库 | 可依赖或复制同一套库；自建入口、信令与桶凭证 |
| 合规 | 教育/自有片；运营商责任在 LW 主体 | UGC 与娱乐内容（含非 UGC 自有片）责任在 EntFunHub；与 LW **彻底切开** |

对象存储进程可以与 EntFunHub **同机共用一台 MinIO/AIStor**（分桶、分 access key、禁止跨读）。试用推荐独立 compose：`deployment/object-storage`（工程名 `lw-object-storage`），不挂在 control-plane / 产品栈里。共用磁盘与进程 ≠ 共用本网关。EntFunHub **不是**本网关租户。

分片 P2P：**两套织物**。BlockyEdu 用 `@luminaryworks/media-p2p` → `createLwPeerFetch`；EntFunHub / 极光用 `createEfhPeerFetch` 与自有信令。禁止共用 WebSocket 与 swarm。

## 1. 不变量

1. 浏览器播放的是 m3u8。分片是 AES-128 加密的 MPEG-TS，对象键以 `.m4s` 结尾。公开后缀可以是 `.m4s`、`.seg`、`.webp`、`.bin` 之一，由资产固定，不按请求随机更换。Playwright 已确认 `xgplayer` 3.0.26 / `xgplayer-hls` 3.0.26 能播放清单里的 `.seg`，并且 `hls.onPreM3U8Parse` 会在解析前被调用。生产路径仍由网关改写清单；播放器不再改后缀，避免和签名路径不一致。
2. 业务进程（Nest / Go）不转发视频字节。清单和 16 字节密钥走网关。分片走边缘（或试运营回源到本机网关后再读私有桶）。
3. 浏览器不拿到对象存储主机名。边缘用服务端凭证向私有桶取对象，**缓存键是去掉查询串后的规范对象键**。
4. AES 密钥只在网关存储（`REDIS_URL` 设了则用 Redis，否则实验室文件库）。密钥文件不上传。**密钥与 m3u8 不进入跨用户 CDN 对象键缓存，也不进入 P2P。**
5. 播放地址带 `exp`、`sid`、`sig`。默认 20 分钟。过期即失效。续期必须再次经过产品的登录与权限检查。
6. 产品用 `Authorization: Bearer <MEDIA_GATEWAY_SERVICE_KEY>` 注册资产和签发会话。浏览器只持有短时播放 URL。
7. **MinIO / 对象 API 永不暴露公网。** 公网入口只有网关（及受信任边缘）。签名只作用在 m3u8、分片、key 三类请求上。

AES-128 阻止未授权拼接分片，不能阻止录屏。

## 2. 租户

`tenant`：`blockyedu` | `vistaremote` | `vistacast`。资产按租户隔离。

**已移除** `entfunhub`：EntFunHub 全部内容不进本网关（选项 A）。需要同类能力时自建同构网关或沿用既有播单，仅复用播放器/打包代码。

许可接受 `CC0`、`PD`、`CC-BY`、`CC-BY-SA`、`MIT`（可再分发 OER），以及 `PRIVATE`（租户自有片，仅本租户会话播放，不进入 OER 再分发）。NC、ND 与其它值拒绝注册。

## 3. 限流

签发会话：单 IP 每分钟 30 次；同一用户每 10 分钟 10 个新会话。播放中的续期不占新会话额度，单会话每分钟最多续期 30 次。密钥接口单会话每分钟 120 次。

分片在边缘限制单 IP 与单会话的并发，超限 429。**缓存命中仍要验签**，验签通过后才返回缓存字节，不再回源。

不要把「用户每小时 20 次」用在分片或拖动进度上。长视频靠会话续期。

`MEDIA_TRUST_PROXY=1` 只在网关前面是受信任反向代理时打开。边缘使用 Cloudflare 写入的 `CF-Connecting-IP`。

## 4. 对象与存储

```text
hls/{assetId}/{variant}/{segment}.m4s
```

清单由网关按会话现签，不把带密钥 URI 的静态清单长期放在桶里当唯一入口。桶里可以有打包时的原始清单，播放不直接使用它。

### 4.1 本机 / OVH MinIO → 以后 Backblaze

环境只换 S3 兼容 `endpoint`、region、bucket、密钥。对象键保持不变。

- **本地开发**：回环或 compose 网络内的 MinIO/AIStor；`OBJECT_STORAGE_*` / 网关源站凭证指向它。
- **OVH 试运营**：同一主机可跑**一台**对象存储进程；LW 只用 `blockyedu-media`（及平台桶）与专用 key。EntFunHub 若同机，只用 `efh-*` 与专用 key。端口只绑 `127.0.0.1`。
- **以后**：endpoint 改为 Backblaze（或其它 S3）。网关与播放器代码不改。

试运营若边缘够不着回环 MinIO：CDN 回源到本机网关，网关验签后读 MinIO；切到公网可达的私有桶后，边缘再用服务端凭证直读。

### 4.2 鉴权、CDN、P2P 同时成立

| 请求 | 鉴权 | 共享 CDN（按对象键） | P2P |
| --- | --- | --- | --- |
| m3u8 | 每会话现签 | **否**（`private, no-store`） | **否** |
| AES key | 验签 | **否**（仅会话私有缓存可选） | **否** |
| ts / m4s | 每次验签 | **是**（键 = 规范对象键，无 query） | **是**（仅密文分片；ID = 完整对象键） |

禁止「按路径缓存且跳过验签」。未命中 P2P 时用该用户签名 URL 回 CDN。试运营阶段 iOS 原生 HLS 只走 CDN（不做依赖同域 `/proxy` 的 Service Worker 路径）。

## 5. 产品接入

产品服务器在自己的权限检查通过后调用 `POST /v1/sessions`。仅 LW 产品（如 BlockyEdu `tenant=blockyedu`）。

本地验收用 `src/local-edge.ts` 读磁盘或本机桶上的规范对象。生产分片走边缘 Worker（或 §4.1 试运营回源）。

播放器：`@luminaryworks/media-player` 支持可选分片 `SegmentFetcher`（P2P→CDN）。清单与 key 仍走播放器原生请求。极光 / EntFunHub 可复用该库，但必须指向**自建**入口，不得配置本服务的生产 URL 与服务密钥。
