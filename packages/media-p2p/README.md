# `@luminaryworks/media-p2p`

Ciphertext segment `peerFetch` for `@luminaryworks/media-player`.

## Two fabrics (hard)

| | LuminaryWorks / BlockyEdu | EntFunHub / 极光 |
| --- | --- | --- |
| Factory | `createLwPeerFetch` | `createEfhPeerFetch` |
| Realm prefix | `luminaryworks:` | `entfunhub:` |
| Signaling | LW-only WebSocket URL | EFH/JiGuang-only URL |
| Swarm id | `luminaryworks` + full object key | `entfunhub` + full object key |

Never share one signaling process or one peer room across the two operators. UGC peers must not see education segment ids.

Segment id is the **full object key** (e.g. `/hls/{assetId}/720p/seg-0000.m4s`), not the bare filename.

## BlockyEdu

```ts
import { createP2pAwareSegmentFetcher } from "@luminaryworks/media-player";
import { createLwPeerFetch } from "@luminaryworks/media-p2p";

const segmentFetcher = createP2pAwareSegmentFetcher({
  peerFetch: createLwPeerFetch({
    signalingUrl: process.env.NEXT_PUBLIC_LW_MEDIA_P2P_WS,
    // getClient: () => window.__lwP2pClient ?? null,
  }),
});
```

Without `getClient`, `peerFetch` returns `null` and playback stays on CDN (correct for trial until the LW signaling client is plugged in).

## EntFunHub

Use `createEfhPeerFetch` with the JiGuang / EFH signaling URL and EFH `getClient`. Do not call LW media-gateway.
