import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const www = path.resolve(__dirname, "..", "..");

const files = [
  "vistaremote/web/apps/client/.env.development",
  "vistaremote/web/apps/client/.env",
  "vistaremote/web/apps/admin/.env.development",
  "vistaremote/web/apps/admin/.env",
].map((rel) => path.join(www, rel));

for (const f of files) {
  let t = readFileSync(f, "utf8");
  if (/^PUBLIC_AUTH_EXPERIENCE_URL=/m.test(t)) {
    t = t.replace(/^PUBLIC_AUTH_EXPERIENCE_URL=.*/m, "PUBLIC_AUTH_EXPERIENCE_URL=http://localhost:3010");
  } else {
    t = t.replace(
      /^(PUBLIC_IDP_ISSUER=)/m,
      "PUBLIC_AUTH_EXPERIENCE_URL=http://localhost:3010\n$1",
    );
  }
  writeFileSync(f, t);
  console.log("ok", f);
}
