import { describe, expect, it } from "vitest";
import {
  buildCredentialsObject,
  collectCreemAmounts,
  defaultMarketScopes,
  providerCnRestriction,
} from "./payment-providers";

describe("payment-providers", () => {
  it("marks creem and doerflow_credit CN restrictions", () => {
    expect(providerCnRestriction("creem")).toBe("hosted_cn_blocked");
    expect(providerCnRestriction("doerflow_credit")).toBe("crypto_cn_blocked");
    expect(providerCnRestriction("alipay_f2f")).toBe(null);
  });

  it("defaults GLOBAL market scope for new MoR and ledger providers", () => {
    expect(defaultMarketScopes("creem")).toEqual(["GLOBAL"]);
    expect(defaultMarketScopes("doerflow_credit")).toEqual(["GLOBAL"]);
  });

  it("builds structured credential maps without empty optional fields", () => {
    expect(
      buildCredentialsObject("creem", {
        apiKey: "creem_test_fixtureapikeyvalue",
        webhookSecret: "creem_whsec_fixture_secret",
        productId: "prod_fixtureProduct01",
        successUrl: "",
      }),
    ).toEqual({
      apiKey: "creem_test_fixtureapikeyvalue",
      webhookSecret: "creem_whsec_fixture_secret",
      productId: "prod_fixtureProduct01",
    });
  });

  it("collects creem gross/tax/net from attempt metadata", () => {
    expect(
      collectCreemAmounts({
        order: {
          paymentProvider: "creem",
          amountCents: 1500,
          metadata: {},
        },
        attempts: [
          {
            provider: "creem",
            amountCents: 1500,
            metadata: { grossCents: 1500, taxCents: 200, netCents: 1300 },
          },
        ],
      }),
    ).toEqual({
      grossCents: 1500,
      taxCents: 200,
      netCents: 1300,
    });
  });
});
