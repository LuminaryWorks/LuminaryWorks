#!/usr/bin/env node
/**
 * Ed25519 License issuer CLI.
 *
 * Usage:
 *   pnpm license:gen-keys --out ./keys
 *   pnpm license:issue --key ./keys/private.pem --kid <kid> --in payload.json --out license.json
 *
 * Never commit private keys. Public keys go in ENTITLEMENT_LICENSE_PUBLIC_KEYS.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateEd25519KeyPair,
  type LicensePayload,
  signLicensePayload,
  verifySignedLicense,
} from "../license/ed25519";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

function usage(): never {
  console.error(`Commands:
  gen-keys --out <dir>
  issue --key <private.pem> --kid <kid> --in <payload.json> [--out license.json] [--pub <public.pem>]
  verify --pub-ring <ring.json> --in <license.json>
`);
  process.exit(1);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "gen-keys") {
    const out = arg("out") ?? "./license-keys";
    mkdirSync(out, { recursive: true });
    const kp = generateEd25519KeyPair();
    writeFileSync(join(out, "private.pem"), kp.privateKeyPem, { encoding: "utf8", mode: 0o600 });
    writeFileSync(join(out, "public.pem"), kp.publicKeyPem, { encoding: "utf8" });
    writeFileSync(
      join(out, "ring.json"),
      JSON.stringify({ [kp.kid]: kp.publicKeyPem }, null, 2) + "\n",
      { encoding: "utf8" },
    );
    writeFileSync(join(out, "kid.txt"), `${kp.kid}\n`, { encoding: "utf8" });
    console.log(`Generated kid=${kp.kid} in ${out}`);
    console.log(
      "Add ring.json contents to ENTITLEMENT_LICENSE_PUBLIC_KEYS. Do not commit private.pem.",
    );
    return;
  }

  if (cmd === "issue") {
    const keyPath = arg("key");
    const kid = arg("kid");
    const inPath = arg("in");
    const outPath = arg("out") ?? "license.json";
    const pubPath = arg("pub");
    if (!keyPath || !kid || !inPath) usage();
    const privateKeyPem = readFileSync(keyPath!, "utf8");
    const raw = JSON.parse(readFileSync(inPath!, "utf8")) as Partial<LicensePayload>;
    if (!raw.licenseId || !raw.deploymentId || !raw.products || !raw.features || !raw.expiresAt) {
      throw new Error("payload requires licenseId, deploymentId, products, features, expiresAt");
    }
    const payload: LicensePayload = {
      licenseId: raw.licenseId,
      kid: kid!,
      deploymentId: raw.deploymentId,
      products: raw.products,
      features: raw.features,
      seats: raw.seats,
      issuedAt: raw.issuedAt ?? new Date().toISOString(),
      expiresAt: raw.expiresAt,
      offlineGraceDays: raw.offlineGraceDays ?? 14,
      customerName: raw.customerName,
    };
    const signed = signLicensePayload(payload, privateKeyPem);
    if (pubPath) {
      const pub = readFileSync(pubPath, "utf8");
      const check = verifySignedLicense(signed, { [kid!]: pub });
      if (!check.ok) throw new Error(`Self-verify failed: ${check.message}`);
    }
    writeFileSync(outPath, JSON.stringify(signed, null, 2) + "\n", { encoding: "utf8" });
    console.log(`Wrote signed license to ${outPath}`);
    return;
  }

  if (cmd === "verify") {
    const ringPath = arg("pub-ring");
    const inPath = arg("in");
    if (!ringPath || !inPath) usage();
    const ring = JSON.parse(readFileSync(ringPath!, "utf8")) as Record<string, string>;
    const license = JSON.parse(readFileSync(inPath!, "utf8"));
    const result = verifySignedLicense(license, ring);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(2);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
