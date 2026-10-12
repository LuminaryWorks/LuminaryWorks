import { channelEnablementBlocker } from "../src/common/channel-enablement";
import { publishScopeViolation } from "../src/common/catalog-scope";
import { usesReservedPlatformMerchant } from "../src/common/tenant-merchant";
import { fulfillmentAllowed } from "../src/modules/payments/adapter-fulfillment";
import { parsePaymentDeploymentMode } from "../src/common/payment-deployment-mode";

describe("channel enablement", () => {
  const ready = {
    lastTestOk: true,
    lastTestFingerprint: "fp",
    credentialFingerprint: "fp",
    lastTestEnvironment: "sandbox",
    environment: "sandbox",
  };

  it("blocks enable until a successful matching test exists", () => {
    expect(channelEnablementBlocker({ ...ready, lastTestOk: null })).toBe("test_required");
    expect(channelEnablementBlocker({ ...ready, lastTestOk: false })).toBe("test_required");
    expect(channelEnablementBlocker({ ...ready, credentialFingerprint: "next" })).toBe(
      "fingerprint_mismatch",
    );
    expect(channelEnablementBlocker({ ...ready, environment: "live" })).toBe(
      "environment_mismatch",
    );
    expect(channelEnablementBlocker(ready)).toBeNull();
  });
});

describe("catalog product scope", () => {
  const published = [
    {
      sku: "blockyedu.pro.month.CNY",
      productCode: "blockyedu",
      planCode: "pro",
      interval: "month",
      currency: "CNY",
      amountMinor: 100,
      market: "CN",
      active: true,
    },
    {
      sku: "dataluminary.pro.month.USD",
      productCode: "dataluminary",
      planCode: "pro",
      interval: "month",
      currency: "USD",
      amountMinor: 200,
      market: "GLOBAL",
      active: true,
    },
  ];

  it("allows a product admin to change only their own price", () => {
    const draft = published.map((row) =>
      row.productCode === "blockyedu" ? { ...row, amountMinor: 180 } : row,
    );
    expect(
      publishScopeViolation(draft, published, { kind: "products", productCodes: ["blockyedu"] }),
    ).toBeNull();
  });

  it("rejects another product's price and cross-product bundles", () => {
    const foreign = published.map((row) =>
      row.productCode === "dataluminary" ? { ...row, amountMinor: 1 } : row,
    );
    expect(
      publishScopeViolation(foreign, published, { kind: "products", productCodes: ["blockyedu"] }),
    ).toBe("outside_product");
    const both = published.map((row) => ({ ...row, amountMinor: row.amountMinor + 1 }));
    expect(
      publishScopeViolation(both, published, {
        kind: "products",
        productCodes: ["blockyedu", "dataluminary"],
      }),
    ).toBe("cross_product_bundle");
    expect(publishScopeViolation(both, published, { kind: "all" })).toBeNull();
  });
});

describe("tenant merchant isolation", () => {
  it("rejects a tenant config that reuses a platform merchant id", () => {
    expect(usesReservedPlatformMerchant("lw-merchant", ["LW-Merchant"])).toBe(true);
    expect(usesReservedPlatformMerchant("school-merchant", ["LW-Merchant"])).toBe(false);
  });
});

describe("external adapter fulfillment", () => {
  it("does not fulfill failed signatures, mismatched amounts, or duplicate webhooks", () => {
    expect(fulfillmentAllowed({ signatureOk: false, amountMatches: true, duplicate: false })).toBe(
      false,
    );
    expect(fulfillmentAllowed({ signatureOk: true, amountMatches: false, duplicate: false })).toBe(
      false,
    );
    expect(fulfillmentAllowed({ signatureOk: true, amountMatches: true, duplicate: true })).toBe(
      false,
    );
    expect(fulfillmentAllowed({ signatureOk: true, amountMatches: true, duplicate: false })).toBe(
      true,
    );
  });
});

describe("payment deployment mode", () => {
  it("accepts the four modes and defaults unknown values to platform", () => {
    expect(parsePaymentDeploymentMode("customer_managed")).toBe("customer_managed");
    expect(parsePaymentDeploymentMode("disabled")).toBe("disabled");
    expect(parsePaymentDeploymentMode("nope")).toBe("platform");
  });
});
