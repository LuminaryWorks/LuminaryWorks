export const BLOCKYEDU_VOICE_SIGNUP_PROMOTION = "ai.voice.signup.300s";
export const BLOCKYEDU_VOICE_TRIAL_SECONDS = "ai.voice.trial.seconds";
export const BLOCKYEDU_VOICE_MONTHLY_SECONDS = "ai.voice.monthly.seconds";
export const BLOCKYEDU_VOICE_PURCHASED_SECONDS = "ai.voice.purchased.seconds";
export const BLOCKYEDU_VOICE_FEATURE = "ai.voice";

export interface QuotaPackSku {
  sku: string;
  productCode: string;
  featureCode: string;
  seconds: number;
  amountCents: number;
  currency: string;
  validDays: number | null;
  name: string;
}

export const QUOTA_PACK_SKUS: Record<string, QuotaPackSku> = {
  "blockyedu.voice.pack.1800s": {
    sku: "blockyedu.voice.pack.1800s",
    productCode: "blockyedu",
    featureCode: BLOCKYEDU_VOICE_PURCHASED_SECONDS,
    seconds: 1800,
    amountCents: 990,
    currency: "CNY",
    validDays: 365,
    name: "口语 30 分钟包",
  },
  "blockyedu.voice.pack.3600s": {
    sku: "blockyedu.voice.pack.3600s",
    productCode: "blockyedu",
    featureCode: BLOCKYEDU_VOICE_PURCHASED_SECONDS,
    seconds: 3600,
    amountCents: 1590,
    currency: "CNY",
    validDays: 365,
    name: "口语 60 分钟包",
  },
  "blockyedu.voice.pack.10800s": {
    sku: "blockyedu.voice.pack.10800s",
    productCode: "blockyedu",
    featureCode: BLOCKYEDU_VOICE_PURCHASED_SECONDS,
    seconds: 10800,
    amountCents: 3990,
    currency: "CNY",
    validDays: 365,
    name: "口语 180 分钟包",
  },
};

export function getQuotaPack(sku: string): QuotaPackSku | undefined {
  return QUOTA_PACK_SKUS[sku];
}

export const ONCE_GRANTS: Record<
  string,
  {
    productCode: string;
    features: Record<string, { effect: "allow" | "deny"; limitValue?: number | null }>;
  }
> = {
  [BLOCKYEDU_VOICE_SIGNUP_PROMOTION]: {
    productCode: "blockyedu",
    features: {
      [BLOCKYEDU_VOICE_FEATURE]: { effect: "allow" },
      [BLOCKYEDU_VOICE_TRIAL_SECONDS]: { effect: "allow", limitValue: 300 },
    },
  },
};
