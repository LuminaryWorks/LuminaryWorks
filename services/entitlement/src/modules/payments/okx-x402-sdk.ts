import { createRequire } from "node:module";
import { EntitlementException } from "../../common/errors";
import type { OkxOnchainCredentials } from "../../common/payment-credentials";
import { assertPublicHttpsUrl } from "../../common/payment-credentials";

export interface OkxPaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: Array<Record<string, unknown>>;
  extensions?: Record<string, unknown> | null;
}

export interface OkxVerifyResult {
  isValid: boolean;
  invalidReason?: string;
}

export interface OkxSettleResult {
  success: boolean;
  status?: string;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

export interface OkxSettleStatus {
  success: boolean;
  status?: string;
  transaction?: string;
}

export interface OkxX402Session {
  createPaymentRequired(input: {
    amountCents: number;
    currency: string;
    orderId: string;
    attemptId: string;
    resourceUrl: string;
  }): Promise<OkxPaymentRequired>;
  decodePaymentSignature(header: string): Record<string, unknown>;
  verifyPayment(
    payload: Record<string, unknown>,
    requirements: Record<string, unknown>,
  ): Promise<OkxVerifyResult>;
  settlePayment(
    payload: Record<string, unknown>,
    requirements: Record<string, unknown>,
  ): Promise<OkxSettleResult>;
  querySettlement(txHash: string): Promise<OkxSettleStatus>;
}

export type OkxX402Factory = (creds: OkxOnchainCredentials) => Promise<OkxX402Session>;

interface LoadedOkxModules {
  OKXFacilitatorClient: new (config: {
    apiKey: string;
    secretKey: string;
    passphrase: string;
    baseUrl?: string;
    syncSettle?: boolean;
  }) => {
    verify: (
      payload: Record<string, unknown>,
      requirements: Record<string, unknown>,
    ) => Promise<OkxVerifyResult>;
    settle: (
      payload: Record<string, unknown>,
      requirements: Record<string, unknown>,
    ) => Promise<OkxSettleResult>;
    getSettleStatus: (txHash: string) => Promise<OkxSettleStatus>;
  };
  x402ResourceServer: new (
    facilitator: unknown,
  ) => {
    register: (network: string, scheme: unknown) => unknown;
    createPaymentRequiredResponse: (
      requirements: Array<Record<string, unknown>>,
      resource: { url: string; description: string },
      error?: string,
    ) => Promise<OkxPaymentRequired>;
    verifyPayment: (
      payload: Record<string, unknown>,
      requirements: Record<string, unknown>,
    ) => Promise<OkxVerifyResult>;
    settlePayment: (
      payload: Record<string, unknown>,
      requirements: Record<string, unknown>,
    ) => Promise<OkxSettleResult>;
  };
  ExactEvmScheme: new () => {
    scheme: string;
    parsePrice: (
      price: unknown,
      network: string,
    ) => Promise<{ amount: string; asset: string; extra?: Record<string, unknown> }>;
  };
  decodePaymentSignatureHeader: (header: string) => Record<string, unknown>;
  officialFastifyPackage: boolean;
}

let cachedModules: LoadedOkxModules | null | undefined;

export function loadOfficialOkxX402Modules(): LoadedOkxModules {
  if (cachedModules) return cachedModules;
  try {
    const requireFromHere = createRequire(__filename);
    const core = requireFromHere("@okxweb3/x402-core") as {
      OKXFacilitatorClient: LoadedOkxModules["OKXFacilitatorClient"];
    };
    const server = requireFromHere("@okxweb3/x402-core/server") as {
      x402ResourceServer: LoadedOkxModules["x402ResourceServer"];
    };
    const http = requireFromHere("@okxweb3/x402-core/http") as {
      decodePaymentSignatureHeader: LoadedOkxModules["decodePaymentSignatureHeader"];
    };
    const evm = requireFromHere("@okxweb3/x402-evm/exact/server") as {
      ExactEvmScheme: LoadedOkxModules["ExactEvmScheme"];
    };
    let officialFastifyPackage = false;
    try {
      const fastifyPkg = requireFromHere("@okxweb3/x402-fastify") as {
        x402ResourceServer?: unknown;
        paymentMiddleware?: unknown;
      };
      officialFastifyPackage = Boolean(
        fastifyPkg.x402ResourceServer || fastifyPkg.paymentMiddleware,
      );
    } catch {
      officialFastifyPackage = false;
    }
    if (
      typeof core.OKXFacilitatorClient !== "function" ||
      typeof server.x402ResourceServer !== "function" ||
      typeof evm.ExactEvmScheme !== "function" ||
      typeof http.decodePaymentSignatureHeader !== "function"
    ) {
      throw new Error("official x402 exports missing");
    }
    cachedModules = {
      OKXFacilitatorClient: core.OKXFacilitatorClient,
      x402ResourceServer: server.x402ResourceServer,
      ExactEvmScheme: evm.ExactEvmScheme,
      decodePaymentSignatureHeader: http.decodePaymentSignatureHeader,
      officialFastifyPackage,
    };
    return cachedModules;
  } catch (err) {
    cachedModules = null;
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Official @okxweb3/x402-core / @okxweb3/x402-evm SDK is not available",
      { details: { reason: err instanceof Error ? err.message : "load_failed" } },
    );
  }
}

export function officialOkxSdkAvailable(): { ok: boolean; officialFastifyPackage: boolean } {
  try {
    const loaded = loadOfficialOkxX402Modules();
    return { ok: true, officialFastifyPackage: loaded.officialFastifyPackage };
  } catch {
    return { ok: false, officialFastifyPackage: false };
  }
}

export async function officialOkxX402Factory(
  creds: OkxOnchainCredentials,
): Promise<OkxX402Session> {
  const loaded = loadOfficialOkxX402Modules();
  const facilitator = new loaded.OKXFacilitatorClient({
    apiKey: creds.apiKey,
    secretKey: creds.secretKey,
    passphrase: creds.passphrase,
    baseUrl: "https://web3.okx.com",
  });
  const scheme = new loaded.ExactEvmScheme();
  const resourceServer = new loaded.x402ResourceServer(facilitator);
  resourceServer.register(creds.network, scheme);

  return {
    async createPaymentRequired(input) {
      const major = input.amountCents / 100;
      const price = creds.asset
        ? {
            amount: String(Math.round(major * 10 ** Number(creds.assetDecimals ?? "6"))),
            asset: creds.asset,
            extra: {
              ...(creds.assetName ? { name: creds.assetName } : {}),
              ...(creds.assetVersion ? { version: creds.assetVersion } : {}),
            },
          }
        : `$${major.toFixed(2)}`;
      const parsed = await scheme.parsePrice(price, creds.network);
      const requirements = [
        {
          scheme: "exact",
          network: creds.network,
          amount: parsed.amount,
          asset: parsed.asset,
          payTo: creds.payTo,
          maxTimeoutSeconds: 300,
          extra: parsed.extra ?? {},
        },
      ];
      const resource = assertPublicHttpsUrl(input.resourceUrl, "resourceUrl");
      return resourceServer.createPaymentRequiredResponse(
        requirements,
        {
          url: resource.href,
          description: `order ${input.orderId} attempt ${input.attemptId}`,
        },
        "Payment required",
      );
    },
    decodePaymentSignature(header) {
      return loaded.decodePaymentSignatureHeader(header);
    },
    verifyPayment(payload, requirements) {
      return resourceServer.verifyPayment(payload, requirements);
    },
    settlePayment(payload, requirements) {
      return resourceServer.settlePayment(payload, requirements);
    },
    querySettlement(txHash) {
      return facilitator.getSettleStatus(txHash);
    },
  };
}

export function defaultOkxX402Factory(): OkxX402Factory {
  return officialOkxX402Factory;
}
