import { createRequire } from "node:module";
import { EntitlementException } from "../../common/errors";

export interface BitpayMerchantRefundInput {
  invoiceId: string;
  amountMajor: number;
  currency: string;
  merchantToken: string;
  guid?: string;
}

export interface BitpayMerchantRefundResult {
  id: string;
  status: string;
  amount?: number;
}

export interface BitpayMerchantClient {
  createRefund(input: BitpayMerchantRefundInput): Promise<BitpayMerchantRefundResult>;
}

export type BitpayMerchantFactory = (input: {
  privateKey: string;
  merchantToken: string;
  environment: "sandbox" | "live";
}) => Promise<BitpayMerchantClient>;

interface LoadedBitpaySdk {
  Client: {
    createClientByPrivateKey: (
      privateKey: string,
      tokenContainer: { addMerchant: (token: string) => void },
      environment?: string,
    ) => {
      createRefund: (refund: {
        amount: number;
        invoice: string;
        token: string;
        currency?: string;
        guid?: string;
      }) => Promise<{ id?: string; status?: string; amount?: number }>;
    };
  };
  TokenContainer: new () => { addMerchant: (token: string) => void };
  Refund: new (
    amount: number,
    invoiceId: string,
    token: string,
  ) => {
    amount: number;
    invoice: string;
    token: string;
    currency?: string;
    guid?: string;
  };
  Environment: { Test: string; Prod: string };
}

let cachedSdk: LoadedBitpaySdk | null | undefined;

export function loadOfficialBitpaySdk(): LoadedBitpaySdk {
  if (cachedSdk) return cachedSdk;
  try {
    const requireFromHere = createRequire(__filename);
    const sdk = requireFromHere("bitpay-sdk") as {
      Client?: LoadedBitpaySdk["Client"];
      TokenContainer?: LoadedBitpaySdk["TokenContainer"];
      Models?: { Refund?: LoadedBitpaySdk["Refund"] };
      Environment?: LoadedBitpaySdk["Environment"];
    };
    if (
      typeof sdk.Client?.createClientByPrivateKey !== "function" ||
      typeof sdk.TokenContainer !== "function" ||
      typeof sdk.Models?.Refund !== "function" ||
      !sdk.Environment?.Test ||
      !sdk.Environment?.Prod
    ) {
      throw new Error("official bitpay-sdk exports missing");
    }
    cachedSdk = {
      Client: sdk.Client,
      TokenContainer: sdk.TokenContainer,
      Refund: sdk.Models.Refund,
      Environment: sdk.Environment,
    };
    return cachedSdk;
  } catch (err) {
    cachedSdk = null;
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Official bitpay-sdk merchant client is not available",
      { details: { reason: err instanceof Error ? err.message : "load_failed" } },
    );
  }
}

export function officialBitpaySdkAvailable(): { ok: boolean } {
  try {
    loadOfficialBitpaySdk();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function officialBitpayMerchantFactory(input: {
  privateKey: string;
  merchantToken: string;
  environment: "sandbox" | "live";
}): Promise<BitpayMerchantClient> {
  const loaded = loadOfficialBitpaySdk();
  const tokens = new loaded.TokenContainer();
  tokens.addMerchant(input.merchantToken);
  const client = loaded.Client.createClientByPrivateKey(
    input.privateKey,
    tokens,
    input.environment === "live" ? loaded.Environment.Prod : loaded.Environment.Test,
  );
  return {
    async createRefund(refundInput) {
      const refund = new loaded.Refund(
        refundInput.amountMajor,
        refundInput.invoiceId,
        refundInput.merchantToken,
      );
      refund.currency = refundInput.currency;
      if (refundInput.guid) refund.guid = refundInput.guid;
      const result = await client.createRefund(refund);
      return {
        id: typeof result.id === "string" ? result.id : "",
        status: typeof result.status === "string" ? result.status : "",
        amount: typeof result.amount === "number" ? result.amount : undefined,
      };
    },
  };
}

export function defaultBitpayMerchantFactory(): BitpayMerchantFactory {
  return officialBitpayMerchantFactory;
}
