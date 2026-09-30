import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { handleEdgeRequest } from "./edge-handler";

export async function startLocalEdge(options: {
  port: number;
  secret: string;
  originDir: string;
  maxTtlSec: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const root = path.resolve(options.originDir);
  const server = createServer((req, res) => {
    void serve(req, res, root, options.secret, options.maxTtlSec);
  });
  await new Promise<void>((resolve) => {
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  secret: string,
  maxTtlSec: number,
): Promise<void> {
  const host = req.headers.host ?? "127.0.0.1";
  const request = new Request(`http://${host}${req.url ?? "/"}`, { method: req.method });
  const response = await handleEdgeRequest(request, {
    secret,
    clientIp: req.socket.remoteAddress ?? "unknown",
    maxTtlSec,
    origin: {
      async get(objectKey: string) {
        const full = path.resolve(root, objectKey);
        if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
        try {
          return new Uint8Array(await readFile(full));
        } catch {
          return null;
        }
      },
    },
  });
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}
