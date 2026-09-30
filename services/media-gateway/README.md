# media-gateway

自有片的播放会话、加密 HLS 清单和 AES-128 密钥。分片由 `src/worker.ts`（Cloudflare）或本地 `src/local-edge-main.ts` 从私有桶 / 磁盘读取。业务进程不转发视频字节。

```bash
cp env.example .env
pnpm install
pnpm test
pnpm start
```

浏览器只应拿到 `MEDIA_GATEWAY_PUBLIC_BASE` 和 `MEDIA_EDGE_BASE` 上的短时地址。`B2_*` 只配置在边缘和打包机上。应用密钥需要 `readFiles` 和 `writeFiles`。只有写权限时，对象能上传，但边缘 GET 会是 `AccessDenied`，播放仍走本地边缘磁盘。

`pnpm spike` 用 Docker ffmpeg 做色条片，并用 Playwright 检查西瓜播放器能否播放非 `.ts` 分片和加密清单。
