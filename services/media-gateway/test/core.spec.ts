import { assertPlaybackGrant } from "../../../packages/media-player/src/grant";
import { canonicalObjectKey } from "../src/paths";
import { handleEdgeRequest, resetEdgeLimits } from "../src/edge-handler";
import { WindowLimiter } from "../src/rate-limit";
import { signToken, verifySignedRequest } from "../src/token";

const secret = "test-signing-secret-32";

describe("playback grants", () => {
  it("rejects an object storage url", () => {
    expect(() =>
      assertPlaybackGrant({
        sessionId: "abc",
        playlistUrl: "https://s3.us-west-004.backblazeb2.com/bucket/a.m3u8",
        expiresAt: "2026-09-28T00:00:00Z",
      }),
    ).toThrow("PLAYBACK_URL_REJECTED");
  });
});

describe("playback tokens", () => {
  it("accepts a fresh signature and rejects expiry, tampering, and a far-future exp", async () => {
    const nowMs = Date.parse("2026-09-28T00:00:00Z");
    const exp = Math.floor(nowMs / 1000) + 60;
    const path = "/hls/demo/720p/seg-0000.seg";
    const sessionId = "ab".repeat(16);
    const sig = await signToken(secret, exp, sessionId, path);
    await expect(
      verifySignedRequest({ secret, exp, sessionId, path, sig, nowMs, maxTtlSec: 1200 }),
    ).resolves.toBe(true);
    await expect(
      verifySignedRequest({
        secret,
        exp: exp - 120,
        sessionId,
        path,
        sig,
        nowMs,
        maxTtlSec: 1200,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySignedRequest({
        secret,
        exp: Math.floor(nowMs / 1000) + 10_000,
        sessionId,
        path,
        sig: await signToken(secret, Math.floor(nowMs / 1000) + 10_000, sessionId, path),
        nowMs,
        maxTtlSec: 1200,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySignedRequest({ secret, exp, sessionId, path, sig: `${sig}x`, nowMs, maxTtlSec: 1200 }),
    ).resolves.toBe(false);
  });
});

describe("object keys", () => {
  it("maps a fixed public suffix back to the canonical segment", () => {
    expect(canonicalObjectKey("/hls/demo-1/720p/seg-0000.seg")).toBe(
      "hls/demo-1/720p/seg-0000.m4s",
    );
    expect(canonicalObjectKey("/hls/demo-1/720p/seg-0000.webp")).toBe(
      "hls/demo-1/720p/seg-0000.m4s",
    );
    expect(canonicalObjectKey("/hls/../720p/seg-0000.m4s")).toBeNull();
    expect(canonicalObjectKey("/hls/demo-1/720p/seg-0000.ts")).toBeNull();
  });
});

describe("edge", () => {
  const sessionId = "cd".repeat(16);

  beforeEach(() => resetEdgeLimits());

  it("serves a signed segment without calling origin for a bad token", async () => {
    const calls: string[] = [];
    const exp = Math.floor(Date.now() / 1000) + 60;
    const path = "/hls/demo/720p/seg-0000.seg";
    const sig = await signToken(secret, exp, sessionId, path);
    const ok = await handleEdgeRequest(new Request(`https://media.test${path}?exp=${exp}&sid=${sessionId}&sig=${sig}`), {
      secret,
      clientIp: "203.0.113.5",
      maxTtlSec: 1300,
      origin: {
        async get(key) {
          calls.push(key);
          return new Uint8Array([1, 2, 3]);
        },
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-luminary-object")).toBe("hls/demo/720p/seg-0000.m4s");
    expect(calls).toEqual(["hls/demo/720p/seg-0000.m4s"]);

    const bad = await handleEdgeRequest(
      new Request(`https://media.test/hls/demo/720p/seg-0000.webp?exp=${exp}&sid=${sessionId}&sig=${sig}`),
      {
        secret,
        clientIp: "203.0.113.5",
        maxTtlSec: 1300,
        origin: {
          async get() {
            throw new Error("origin should not be called");
          },
        },
      },
    );
    expect(bad.status).toBe(401);
  });

  it("limits concurrent segment reads for one session", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const path = "/hls/demo/720p/seg-0001.m4s";
    const sig = await signToken(secret, exp, sessionId, path);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = () =>
      handleEdgeRequest(new Request(`https://media.test${path}?exp=${exp}&sid=${sessionId}&sig=${sig}`), {
        secret,
        clientIp: "203.0.113.9",
        maxTtlSec: 1300,
        origin: {
          async get() {
            await gate;
            return new Uint8Array([9]);
          },
        },
      });
    const pending = Array.from({ length: 7 }, () => request());
    const early = await Promise.all(
      pending.map((item) =>
        Promise.race([
          item.then((response) => response.status),
          new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 40)),
        ]),
      ),
    );
    expect(early.filter((status) => status === 429)).toHaveLength(1);
    release();
    const settled = await Promise.all(pending);
    expect(settled.filter((response) => response.status === 200)).toHaveLength(6);
  });
});

describe("session issuance limiter", () => {
  it("stops the 11th new session inside ten minutes", () => {
    const limiter = new WindowLimiter();
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow("sub:blockyedu:learner", 10, 600_000, 1_000)).toBe(true);
    }
    expect(limiter.allow("sub:blockyedu:learner", 10, 600_000, 1_000)).toBe(false);
    expect(limiter.allow("renew:session", 30, 60_000, 1_000)).toBe(true);
  });
});
