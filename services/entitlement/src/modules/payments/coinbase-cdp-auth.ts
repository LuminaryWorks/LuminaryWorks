import { createRequire } from "node:module";
import { EntitlementException } from "../../common/errors";
import type { CoinbaseJwtSigner, CoinbaseJwtSignerInput } from "./payment-runtime";

/**
 * Official CDP JWT helper. Isolated so tests can inject a signer and Nest CJS
 * does not hand-roll ES256/EdDSA request JWTs.
 */
export async function officialCoinbaseGenerateJwt(input: CoinbaseJwtSignerInput): Promise<string> {
  try {
    const requireFromHere = createRequire(__filename);
    const auth = requireFromHere("@coinbase/cdp-sdk/auth") as {
      generateJwt: (opts: {
        apiKeyId: string;
        apiKeySecret: string;
        requestMethod: string;
        requestHost: string;
        requestPath: string;
        expiresIn?: number;
      }) => Promise<string>;
    };
    if (typeof auth.generateJwt !== "function") {
      throw new Error("generateJwt missing");
    }
    return await auth.generateJwt({
      apiKeyId: input.apiKeyId,
      apiKeySecret: input.apiKeySecret,
      requestMethod: input.requestMethod,
      requestHost: input.requestHost,
      requestPath: input.requestPath,
      expiresIn: input.expiresIn ?? 120,
    });
  } catch (err) {
    if (err instanceof EntitlementException) throw err;
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Official @coinbase/cdp-sdk generateJwt helper is not available",
    );
  }
}

export function defaultCoinbaseJwtSigner(): CoinbaseJwtSigner {
  return officialCoinbaseGenerateJwt;
}
