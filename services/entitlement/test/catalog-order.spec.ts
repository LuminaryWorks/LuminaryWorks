import {
  catalogScopeKey,
  normalizeCatalogOrder,
  priorityForCatalogIndex,
} from "../src/common/catalog-order";

describe("catalog order", () => {
  it("keeps the first occurrence of known providers", () => {
    expect(
      normalizeCatalogOrder([
        "stripe_checkout",
        "not_a_provider",
        "alipay_f2f",
        "stripe_checkout",
        "paypal",
      ]),
    ).toEqual(["stripe_checkout", "alipay_f2f", "paypal"]);
  });

  it("maps list position to checkout priority", () => {
    expect(priorityForCatalogIndex(0)).toBe(10);
    expect(priorityForCatalogIndex(2)).toBe(30);
  });

  it("separates platform and tenant order", () => {
    expect(catalogScopeKey(null)).toBe("platform");
    expect(catalogScopeKey("  ")).toBe("platform");
    expect(catalogScopeKey("org_1")).toBe("tenant:org_1");
  });
});
