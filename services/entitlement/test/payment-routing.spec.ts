import { hostedMarketForCountry } from "../src/common/payment-providers";
import {
  cryptoCheckoutAllowed,
  hintForbiddenInDecision,
  pickProvider,
  selectAvailableProviders,
} from "../src/common/payment-routing";

const alipay = {
  id: "cfg-alipay",
  providerId: "alipay_f2f",
  enabled: true,
  status: "active",
  marketScopes: ["CN"],
  currencies: ["CNY"],
  priority: 10,
  healthy: true,
};
const manual = {
  id: "cfg-manual",
  providerId: "manual",
  enabled: true,
  status: "active",
  marketScopes: ["CN", "GLOBAL"],
  currencies: ["CNY", "USD"],
  priority: 90,
  healthy: true,
};
const paypal = {
  id: "cfg-paypal",
  providerId: "paypal",
  enabled: true,
  status: "active",
  marketScopes: ["CN", "GLOBAL"],
  currencies: ["CNY", "USD"],
  priority: 20,
  healthy: true,
};
const coinbase = {
  id: "cfg-coinbase",
  providerId: "coinbase_commerce",
  enabled: true,
  status: "active",
  marketScopes: ["CN", "GLOBAL"],
  currencies: ["CNY", "USD"],
  priority: 30,
  healthy: true,
};

describe("hosted provider routing", () => {
  it("limits CN hosted checkout to Alipay and optional manual", () => {
    const decision = selectAvailableProviders({
      configs: [alipay, manual, paypal, coinbase],
      market: "CN",
      currency: "CNY",
      ipCountry: "CN",
      billingCountry: "CN",
      marketPolicy: "hosted",
    });
    expect(decision.allowed.map((item) => item.providerId).sort()).toEqual([
      "alipay_f2f",
      "manual",
    ]);
    expect(hostedMarketForCountry("CN")).toBe("CN");
  });

  it("offers all enabled GLOBAL providers except crypto blocked by CN IP or billing", () => {
    const global = selectAvailableProviders({
      configs: [alipay, manual, paypal, coinbase],
      market: "GLOBAL",
      currency: "USD",
      ipCountry: "US",
      billingCountry: "US",
      marketPolicy: "hosted",
    });
    expect(global.allowed.map((item) => item.providerId)).toEqual([
      "paypal",
      "coinbase_commerce",
      "manual",
    ]);

    const cnIp = selectAvailableProviders({
      configs: [
        paypal,
        coinbase,
        { ...coinbase, id: "cfg-okx", providerId: "okx_onchain" },
        { ...coinbase, id: "cfg-bitpay", providerId: "bitpay" },
      ],
      market: "GLOBAL",
      currency: "USD",
      ipCountry: "CN",
      billingCountry: "US",
      marketPolicy: "hosted",
    });
    expect(cnIp.allowed.map((item) => item.providerId)).toEqual(["paypal"]);
    expect(hintForbiddenInDecision(cnIp, "coinbase_commerce")).toBe(true);
    expect(hintForbiddenInDecision(cnIp, "okx_onchain")).toBe(true);
    expect(hintForbiddenInDecision(cnIp, "bitpay")).toBe(true);
  });

  it("double-checks crypto against IP and persisted billing country", () => {
    expect(cryptoCheckoutAllowed({ ipCountry: "US", billingCountry: "US" })).toBe(true);
    expect(cryptoCheckoutAllowed({ ipCountry: "CN", billingCountry: "US" })).toBe(false);
    expect(cryptoCheckoutAllowed({ ipCountry: "US", billingCountry: "CN" })).toBe(false);
    expect(cryptoCheckoutAllowed({ ipCountry: "US", billingCountry: null })).toBe(false);
  });

  it("picks providerHint only when it is operationally allowed", () => {
    const decision = selectAvailableProviders({
      configs: [paypal, manual],
      market: "GLOBAL",
      currency: "USD",
      ipCountry: "US",
      billingCountry: "US",
      marketPolicy: "hosted",
    });
    expect(pickProvider({ allowed: decision.allowed, hint: "manual" }).config?.providerId).toBe(
      "manual",
    );
    expect(pickProvider({ allowed: decision.allowed, hint: "alipay_f2f" }).config?.providerId).toBe(
      "paypal",
    );
  });
});
