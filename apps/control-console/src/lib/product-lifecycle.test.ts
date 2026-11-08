import { describe, expect, it } from "@rstest/core";
import {
  buyerErrorCode,
  discoverProductCodes,
  lifecycleEffectKey,
  normalizeLifecycleReason,
  PARTNER_PRODUCT_CODES,
  productCodesFromPlans,
} from "./product-lifecycle";

describe("product lifecycle", () => {
  it("lists partner products first and keeps catalog-only codes", () => {
    expect(
      discoverProductCodes(["vistaremote", "newprod", "dataluminary", " "]),
    ).toEqual([...PARTNER_PRODUCT_CODES, "newprod"]);
  });

  it("reads product codes from the public plans array", () => {
    expect(
      productCodesFromPlans([
        { productCode: "vistaremote", status: "suspended" },
        { productName: "skip" },
        null,
      ]),
    ).toEqual(["vistaremote"]);
    expect(productCodesFromPlans({ items: [] })).toEqual([]);
  });

  it("maps buyer-facing lifecycle errors", () => {
    expect(buyerErrorCode("suspended")).toBe("PRODUCT_SUSPENDED");
    expect(buyerErrorCode("retired")).toBe("PRODUCT_RETIRED");
    expect(buyerErrorCode("active")).toBeNull();
    expect(lifecycleEffectKey("suspended")).toBe("partners.effectSuspended");
    expect(lifecycleEffectKey("retired")).toBe("partners.effectRetired");
  });

  it("requires a trimmed reason of at most 512 characters", () => {
    expect(normalizeLifecycleReason("  partner hold  ")).toBe("partner hold");
    expect(normalizeLifecycleReason("   ")).toBeNull();
    expect(normalizeLifecycleReason("x".repeat(513))).toBeNull();
    expect(normalizeLifecycleReason("x".repeat(512))).toBe("x".repeat(512));
  });
});
