import { loadConfig } from "./config";
import { startLocalEdge } from "./local-edge";

async function main() {
  const config = loadConfig();
  const port = Number(process.env.MEDIA_EDGE_PORT ?? 8091);
  const edge = await startLocalEdge({
    port,
    secret: config.signingSecret,
    originDir: process.env.MEDIA_ORIGIN_DIR ?? "origin",
    maxTtlSec: config.sessionTtlSec + 120,
  });
  console.log(`media edge listening on :${edge.port}`);
}

void main();
