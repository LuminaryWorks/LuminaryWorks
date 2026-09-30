import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { GatewayFilter } from "../src/gateway.filter";

const serviceKey = "test-service-key-32chars";

describe("media gateway http", () => {
  let app: NestFastifyApplication;
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "media-gw-"));
    process.env.MEDIA_DATA_DIR = dir;
    process.env.MEDIA_GATEWAY_SERVICE_KEY = serviceKey;
    process.env.MEDIA_GATEWAY_SIGNING_SECRET = "test-signing-secret-32";
    process.env.MEDIA_GATEWAY_PUBLIC_BASE = "http://127.0.0.1:8090";
    process.env.MEDIA_EDGE_BASE = "http://127.0.0.1:8091";
    process.env.MEDIA_SESSION_TTL_SEC = "1200";
    process.env.MEDIA_LIMIT_IP_PER_MIN = "1000";
    process.env.MEDIA_LIMIT_SUBJECT_PER_10MIN = "1000";
    process.env.REDIS_URL = "";
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    app.useGlobalFilters(new GatewayFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects a missing service key, a non-redistributable license, and leaks no key material", async () => {
    const denied = await app.inject({ method: "POST", url: "/v1/assets", payload: {} });
    expect(denied.statusCode).toBe(401);

    const nc = await app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${serviceKey}` },
      payload: assetBody("CC-BY-NC"),
    });
    expect(nc.statusCode).toBe(400);
    expect(nc.json().code).toBe("LICENSE_NOT_REDISTRIBUTABLE");

    const created = await app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${serviceKey}` },
      payload: assetBody("CC-BY"),
    });
    expect(created.statusCode).toBe(201);
    expect(JSON.stringify(created.json())).not.toContain("00112233445566778899aabbccddeeff");

    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${serviceKey}` },
      payload: { tenant: "blockyedu", assetId: "pilot-bars", subjectId: "learner-1" },
    });
    expect(session.statusCode).toBe(201);
    const grant = session.json() as { playlistUrl: string; sessionId: string };
    expect(grant.playlistUrl).not.toMatch(/backblazeb2|amazonaws/i);

    const masterUrl = new URL(grant.playlistUrl);
    const master = await app.inject({
      method: "GET",
      url: `${masterUrl.pathname}${masterUrl.search}`,
    });
    expect(master.statusCode).toBe(200);
    expect(master.body).not.toMatch(/backblazeb2|amazonaws|00112233445566778899aabbccddeeff/i);
    const mediaLine = master.body.split("\n").find((line) => line.startsWith("http"));
    expect(mediaLine).toBeTruthy();
    const mediaUrl = new URL(mediaLine ?? "");
    const media = await app.inject({ method: "GET", url: `${mediaUrl.pathname}${mediaUrl.search}` });
    expect(media.statusCode).toBe(200);
    expect(media.headers["cache-control"]).toContain("no-store");
    expect(media.body).toContain("http://127.0.0.1:8091/hls/pilot-bars/720p/seg-0000.seg?");
    expect(media.body).toContain("/v1/keys/");
    expect(media.body).not.toMatch(/backblazeb2|amazonaws/i);

    const keyUri = /URI="([^"]+)"/.exec(media.body)?.[1] ?? "";
    const keyUrl = new URL(keyUri);
    const key = await app.inject({ method: "GET", url: `${keyUrl.pathname}${keyUrl.search}` });
    expect(key.statusCode).toBe(200);
    expect(Buffer.from(key.rawPayload).equals(Buffer.from("00112233445566778899aabbccddeeff", "hex"))).toBe(
      true,
    );

    const tampered = await app.inject({
      method: "GET",
      url: `${masterUrl.pathname}${masterUrl.search}x`,
    });
    expect(tampered.statusCode).toBe(401);

    const wrongUser = await app.inject({
      method: "POST",
      url: `/v1/sessions/${grant.sessionId}/renew`,
      headers: { authorization: `Bearer ${serviceKey}` },
      payload: { subjectId: "someone-else" },
    });
    expect(wrongUser.statusCode).toBe(403);
  });
});

function assetBody(licenseCode: string) {
  return {
    tenant: "blockyedu",
    assetId: "pilot-bars",
    title: "Color bars",
    licenseCode,
    licenseUri: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "LuminaryWorks synthetic fixture",
    sourceUrl: "https://luminaryworks.dev/media/pilot-bars",
    publicSuffix: ".seg",
    keyHex: "00112233445566778899aabbccddeeff",
    variants: [
      {
        name: "720p",
        targetDuration: 4,
        segments: [{ name: "seg-0000", duration: 4 }],
      },
    ],
  };
}
