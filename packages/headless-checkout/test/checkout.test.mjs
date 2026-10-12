import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCreateOrderBody,
  checkoutEntryVisible,
  mapPaymentError,
  methodsForMarket,
  nextCheckoutAction,
  stripClientPriceFields,
} from "../src/index.ts";

test("order bodies never keep client prices", () => {
  const body = buildCreateOrderBody({
    offeringId: "off_blocky",
    productCode: "blockyedu",
    interval: "month",
    providerHint: "mock",
    returnUrl: "https://blockyedu.test/membership",
  });
  assert.equal(body.offeringId, "off_blocky");
  assert.equal(body.productCode, "blockyedu");
  assert.equal("amountCents" in body, false);
  assert.equal("currency" in body, false);
  assert.equal("planCode" in body, false);
  assert.deepEqual(stripClientPriceFields({ offeringId: "x", amountMinor: 9, endsAt: "soon" }), {
    offeringId: "x",
  });
});

test("routes CN and GLOBAL methods and hides checkout when payments are disabled", () => {
  const methods = [
    { providerId: "alipay_f2f", marketScopes: ["CN"], enabled: true },
    { providerId: "paypal", marketScopes: ["GLOBAL"], enabled: true },
    { providerId: "mock", marketScopes: ["CN"], enabled: false },
  ];
  assert.deepEqual(
    methodsForMarket(methods, "CN").map((item) => item.providerId),
    ["alipay_f2f"],
  );
  assert.deepEqual(
    methodsForMarket(methods, "GLOBAL").map((item) => item.providerId),
    ["paypal"],
  );
  assert.equal(checkoutEntryVisible({ paymentsMode: "disabled", methodCount: 3 }), false);
  assert.equal(checkoutEntryVisible({ paymentsMode: "platform", methodCount: 0 }), false);
  assert.equal(checkoutEntryVisible({ paymentsMode: "platform", methodCount: 1 }), true);
});

test("maps redirect, cancellation, and payment errors without storing secrets", () => {
  assert.equal(
    nextCheckoutAction({ redirectUrl: "https://psp.example/checkout" }, "ord_1").kind,
    "redirect",
  );
  assert.equal(nextCheckoutAction({}, "ord_1").kind, "complete");
  assert.equal(mapPaymentError("PAYMENT_PRICE_MISMATCH"), "PAYMENT_PRICE_MISMATCH");
  assert.equal(mapPaymentError("sk_live_secret"), "UNKNOWN");
});
