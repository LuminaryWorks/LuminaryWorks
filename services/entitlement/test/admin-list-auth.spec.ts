import { REQUIRES_ADMIN_KEY } from "../src/auth/decorators";
import { defaultCapabilities } from "../src/common/payment-providers";
import type { PaymentProviderConfigEntity } from "../src/database/entities/payment-provider-config.entity";
import { PaymentAdminController } from "../src/modules/payments/payment-admin.controller";
import { PaymentConfigService } from "../src/modules/payments/payment-config.service";

describe("admin payment list authorization", () => {
  it("requires admin on the controller that owns list endpoints", () => {
    expect(Reflect.getMetadata(REQUIRES_ADMIN_KEY, PaymentAdminController)).toBe(true);
    expect(typeof PaymentAdminController.prototype.listOrders).toBe("function");
    expect(typeof PaymentAdminController.prototype.listAttempts).toBe("function");
    expect(typeof PaymentAdminController.prototype.listRefunds).toBe("function");
    expect(typeof PaymentAdminController.prototype.getOrder).toBe("function");
  });
});

describe("provider public views never include credentials", () => {
  it("omits ciphertext and plaintext credential maps", () => {
    const svc = Object.create(PaymentConfigService.prototype) as PaymentConfigService;
    const row = {
      id: "cfg-1",
      providerId: "mock",
      environment: "sandbox",
      enabled: true,
      status: "active",
      marketScopes: ["GLOBAL"],
      currencies: ["USD"],
      priority: 1,
      capabilities: defaultCapabilities("mock"),
      merchantId: "m_1",
      credentialFingerprint: "fp",
      credentialLastFour: "test",
      keyFingerprint: "kf",
      rotatedAt: null,
      previousRetiringUntil: null,
      metadata: { webhookSecret: "whsec_live", note: "ok" },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      credentialsCiphertext: "lwpay1.secret",
      credentials: { clientSecret: "never" },
    } as unknown as PaymentProviderConfigEntity;
    const view = svc.toPublicView(row);
    const json = JSON.stringify(view);
    expect(view).not.toHaveProperty("credentialsCiphertext");
    expect(view).not.toHaveProperty("credentials");
    expect(json).not.toContain("lwpay1");
    expect(json).not.toContain("whsec_live");
    expect(json).not.toContain("never");
    expect(view.credentialLastFour).toBe("test");
    expect(view.enabled).toBe(true);
  });
});
