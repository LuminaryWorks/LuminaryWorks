import { createHmac } from "node:crypto";
import {
  assertOrderFulfilledAck,
  deliverOrderFulfilled,
  missingOrderFulfilledTargetError,
  orderFulfilledSignatureMessage,
  resolveOrderFulfilledProducts,
  signOrderFulfilledRequest,
} from "../src/modules/notify/order-fulfilled";
import type { OutboxEventEntity } from "../src/database/entities/outbox-event.entity";

describe("order.fulfilled signature and ack", () => {
  const payload = {
    orderId: "ord-1",
    subjectId: "user-1",
    productCode: "vistaremote",
    planCode: "pro",
    sku: "vistaremote.pro.month.CNY",
    paidAt: "2026-09-16T12:00:00.000Z",
  };

  it("signs raw JSON with HMAC-SHA256 timestamp nonce and event id", () => {
    const signed = signOrderFulfilledRequest({
      secret: "replace-with-hmac-secret",
      payload,
      eventId: "evt-1:vistaremote",
      timestamp: "1710000000",
      nonce: "nonce-1",
    });
    const expected = createHmac("sha256", "replace-with-hmac-secret")
      .update(orderFulfilledSignatureMessage("1710000000", "nonce-1", signed.rawBody))
      .digest("base64url");
    expect(signed.headers["x-lw-signature"]).toBe(`v1=${expected}`);
    expect(signed.headers["x-lw-event-id"]).toBe("evt-1:vistaremote");
    expect(JSON.parse(signed.rawBody).sku).toBe("vistaremote.pro.month.CNY");
    expect(JSON.parse(signed.rawBody).paidAt).toBe("2026-09-16T12:00:00.000Z");
  });

  it("accepts documented 2xx ack shape", () => {
    expect(
      assertOrderFulfilledAck(200, JSON.stringify({ ok: true, eventId: "evt-1:vistaremote" }), {
        eventId: "evt-1:vistaremote",
      }),
    ).toMatchObject({ ok: true });
  });

  it("treats non-2xx and invalid ack as retry", () => {
    expect(() =>
      assertOrderFulfilledAck(500, JSON.stringify({ ok: true }), { eventId: "evt-1" }),
    ).toThrow(/HTTP 500/);
    expect(() => assertOrderFulfilledAck(200, "not-json", { eventId: "evt-1" })).toThrow(
      /not JSON/,
    );
    expect(() =>
      assertOrderFulfilledAck(200, JSON.stringify({ ok: false }), { eventId: "evt-1" }),
    ).toThrow(/ok:true/);
    expect(() =>
      assertOrderFulfilledAck(200, JSON.stringify({ ok: true, eventId: "other" }), {
        eventId: "evt-1",
      }),
    ).toThrow(/eventId mismatch/);
  });

  it("never treats a missing target as success", () => {
    expect(missingOrderFulfilledTargetError("vistaremote").message).toMatch(
      /Missing order\.fulfilled target/,
    );
  });
});

describe("order.fulfilled product resolution and fan-out", () => {
  it("prefers products[] then falls back to primary productCode", () => {
    expect(
      resolveOrderFulfilledProducts({
        productCode: "vistaremote",
        planCode: "pro",
        products: [
          { productCode: "vistaremote", planCode: "pro" },
          { productCode: "dataluminary", planCode: "pro" },
        ],
      }),
    ).toEqual([
      { productCode: "vistaremote", planCode: "pro" },
      { productCode: "dataluminary", planCode: "pro" },
    ]);
    expect(
      resolveOrderFulfilledProducts({ productCode: "vistaremote", planCode: "ultra" }),
    ).toEqual([{ productCode: "vistaremote", planCode: "ultra" }]);
  });

  it("fans out to each product target and fails when any target is missing", async () => {
    const calls: Array<{ url: string; body: string; eventId: string }> = [];
    const event = {
      id: "evt-bundle-1",
      payload: {
        orderId: "ord-1",
        subjectId: "user-1",
        sku: "bundle.pro.month",
        paidAt: "2026-09-16T12:00:00.000Z",
        products: [
          { productCode: "vistaremote", planCode: "pro" },
          { productCode: "dataluminary", planCode: "pro" },
        ],
      },
    } as unknown as OutboxEventEntity;

    await deliverOrderFulfilled({
      event,
      targets: {
        vistaremote: {
          url: "http://vr.example/api/v1/commerce/webhooks/entitlement",
          secret: "vr-secret",
        },
        dataluminary: {
          url: "http://dl.example/internal/order-fulfilled",
          secret: "dl-secret",
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          body: init.body,
          eventId: init.headers["x-lw-event-id"],
        });
        return {
          status: 200,
          text: async () => JSON.stringify({ ok: true, eventId: init.headers["x-lw-event-id"] }),
        };
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("vr.example");
    expect(calls[1]?.url).toContain("dl.example");
    expect(calls[0]?.eventId).toBe("evt-bundle-1:vistaremote");
    expect(JSON.parse(calls[0]?.body ?? "{}").productCode).toBe("vistaremote");
    expect(JSON.parse(calls[1]?.body ?? "{}").productCode).toBe("dataluminary");

    await expect(
      deliverOrderFulfilled({
        event,
        targets: {
          vistaremote: {
            url: "http://vr.example/api/v1/commerce/webhooks/entitlement",
            secret: "vr-secret",
          },
        },
        fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ ok: true }) }),
      }),
    ).rejects.toThrow(/Missing order\.fulfilled target for product dataluminary/);
  });
});
