import {
  officialBitpayMerchantFactory,
  officialBitpaySdkAvailable,
} from "../src/modules/payments/bitpay-sdk";

describe("official bitpay-sdk wrapper", () => {
  it("loads bitpay-sdk 8.x Client / TokenContainer / Refund / Environment", () => {
    expect(officialBitpaySdkAvailable()).toEqual({ ok: true });
  });

  it("constructs a signed merchant client from hex privateKey without network I/O", async () => {
    const client = await officialBitpayMerchantFactory({
      privateKey: "11".repeat(32),
      merchantToken: "B".repeat(44),
      environment: "sandbox",
    });
    expect(typeof client.createRefund).toBe("function");
  });
});
