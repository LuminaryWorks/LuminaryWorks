export const PAYMENT_FETCH = Symbol("PAYMENT_FETCH");
export const PAYMENT_CLOCK = Symbol("PAYMENT_CLOCK");
export const COINBASE_JWT_SIGNER = Symbol("COINBASE_JWT_SIGNER");
export const OKX_X402_FACTORY = Symbol("OKX_X402_FACTORY");
export const BITPAY_MERCHANT_FACTORY = Symbol("BITPAY_MERCHANT_FACTORY");

export type PaymentFetch = typeof fetch;

export interface PaymentClock {
  now(): Date;
}

export const defaultPaymentClock: PaymentClock = {
  now: () => new Date(),
};

export function defaultPaymentFetch(): PaymentFetch {
  return globalThis.fetch.bind(globalThis);
}

export interface CoinbaseJwtSignerInput {
  apiKeyId: string;
  apiKeySecret: string;
  requestMethod: string;
  requestHost: string;
  requestPath: string;
  expiresIn?: number;
}

export type CoinbaseJwtSigner = (input: CoinbaseJwtSignerInput) => Promise<string>;
