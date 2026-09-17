import { EntitlementException } from "../src/common/errors";
import { ERROR_HTTP_STATUS } from "../src/common/constants";
import { assertBillingProfileComplete, assertTaxIdShape } from "../src/common/billing-profile";
import { defaultCapabilities, isProviderId } from "../src/common/payment-providers";

describe("billing profile payer type", () => {
  it("maps PAYMENT_BILLING_PROFILE_INCOMPLETE to HTTP 400", () => {
    const ex = new EntitlementException(
      "PAYMENT_BILLING_PROFILE_INCOMPLETE",
      "Business billing profiles require companyName and country",
    );
    expect(ex.getStatus()).toBe(400);
    expect(ERROR_HTTP_STATUS.PAYMENT_BILLING_PROFILE_INCOMPLETE).toBe(400);
  });

  it("requires companyName and country for business payers", async () => {
    expect(() =>
      assertBillingProfileComplete({
        payerType: "business",
        companyName: "Acme",
        country: "DE",
      }),
    ).not.toThrow();
    await expect(
      Promise.resolve().then(() =>
        assertBillingProfileComplete({
          payerType: "business",
          companyName: "Acme",
          country: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_BILLING_PROFILE_INCOMPLETE" });
    expect(() =>
      assertBillingProfileComplete({
        payerType: "individual",
        country: "US",
      }),
    ).not.toThrow();
  });

  it("validates taxId shape only", async () => {
    expect(() => assertTaxIdShape("DE123456789")).not.toThrow();
    expect(() => assertTaxIdShape("91110000MA01234567")).not.toThrow();
    await expect(Promise.resolve().then(() => assertTaxIdShape("bad id!"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(() => assertTaxIdShape(null)).not.toThrow();
  });
});

describe("new provider plumbing", () => {
  it("registers creem and doerflow_credit capabilities", () => {
    expect(isProviderId("creem")).toBe(true);
    expect(isProviderId("doerflow_credit")).toBe(true);
    expect(defaultCapabilities("creem")).toMatchObject({
      checkout: true,
      webhook: true,
      query: true,
      refund: true,
      partialRefund: true,
      hostedUrl: true,
      qr: false,
      requiresQueryBeforeFulfill: false,
    });
    expect(defaultCapabilities("doerflow_credit")).toMatchObject({
      hostedUrl: false,
      qr: false,
      refund: true,
      partialRefund: true,
    });
  });
});
