import { Controller, Get, Module } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ERROR_HTTP_STATUS } from "../src/common/constants";
import { assertPaymentsEnabled, parsePaymentsEnabled } from "../src/common/payments-enabled";
import { PaymentAdminController } from "../src/modules/payments/payment-admin.controller";
import { PaymentConfigAdminController } from "../src/modules/payments/payment-config-admin.controller";
import { PaymentWebhookController } from "../src/modules/payments/payment-webhook.controller";
import { PaymentsModule, paymentsModuleImports } from "../src/modules/payments/payments.module";

@Controller("v1/probe")
class ProbeController {
  @Get()
  ok() {
    return { ok: true };
  }
}

describe("PAYMENTS_ENABLED hard switch", () => {
  const original = process.env.PAYMENTS_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = original;
  });

  it("defaults to enabled and treats false/0/off as disabled", () => {
    expect(parsePaymentsEnabled(undefined)).toBe(true);
    expect(parsePaymentsEnabled("")).toBe(true);
    expect(parsePaymentsEnabled("true")).toBe(true);
    expect(parsePaymentsEnabled("false")).toBe(false);
    expect(parsePaymentsEnabled("0")).toBe(false);
    expect(parsePaymentsEnabled("off")).toBe(false);
    expect(parsePaymentsEnabled("no")).toBe(false);
  });

  it("omits PaymentsModule from imports when disabled", () => {
    process.env.PAYMENTS_ENABLED = "false";
    expect(paymentsModuleImports()).toEqual([]);
    process.env.PAYMENTS_ENABLED = "true";
    expect(paymentsModuleImports()).toEqual([PaymentsModule]);
  });

  it("maps POST /v1/orders disablement to PAYMENT_PROVIDER_UNAVAILABLE", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    await expect(Promise.resolve().then(() => assertPaymentsEnabled())).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
    });
    expect(ERROR_HTTP_STATUS.PAYMENT_PROVIDER_UNAVAILABLE).toBe(402);
  });

  it("does not mount webhook or admin payment routes when the module is omitted", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    @Module({
      controllers: [ProbeController],
      imports: paymentsModuleImports(),
    })
    class ProbeModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const webhook = await app.inject({
      method: "POST",
      url: "/v1/payments/webhooks/paypal/cfg-1",
    });
    const admin = await app.inject({
      method: "GET",
      url: "/v1/admin/payments/orders",
    });
    const providers = await app.inject({
      method: "GET",
      url: "/v1/admin/payments/providers",
    });
    const probe = await app.inject({ method: "GET", url: "/v1/probe" });

    expect(webhook.statusCode).toBe(404);
    expect(admin.statusCode).toBe(404);
    expect(providers.statusCode).toBe(404);
    expect(probe.statusCode).toBe(200);

    await app.close();
  });

  it("registers public webhook and admin payment controllers on PaymentsModule", () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PaymentsModule) as
      | unknown[]
      | undefined;
    expect(controllers).toEqual(
      expect.arrayContaining([
        PaymentWebhookController,
        PaymentAdminController,
        PaymentConfigAdminController,
      ]),
    );
  });
});
