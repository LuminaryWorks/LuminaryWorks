import { REQUIRES_ADMIN_KEY } from "../src/auth/decorators";
import { EntitlementException } from "../src/common/errors";
import { readMerchantAccountId } from "../src/common/merchant-account";
import { GrantEntity } from "../src/database/entities/grant.entity";
import { OrderEntity } from "../src/database/entities/order.entity";
import { SubscriptionEntity } from "../src/database/entities/subscription.entity";
import { AdminController } from "../src/modules/admin/admin.controller";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { ProductLifecycleService } from "../src/modules/catalog/product-lifecycle.service";
import { fulfillPaidOrderTx } from "../src/modules/orders/order-fulfillment";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PartnerRedemptionService } from "../src/modules/partner/partner-redemption.service";
import { PaymentAdminController } from "../src/modules/payments/payment-admin.controller";
import { TrialsService } from "../src/modules/trials/trials.service";

const suspended = {
  id: "product-vr",
  code: "vistaremote",
  name: "VistaRemote",
  active: true,
  sellable: true,
  status: "suspended",
  trialPolicy: "standard_7d",
};

const retired = { ...suspended, status: "retired" };

const offering = {
  id: "off-1",
  sku: "vistaremote.pro.month.USD",
  productCode: "vistaremote",
  planCode: "pro",
  interval: "month",
  amountMinor: 2000,
  currency: "USD",
  revisionId: "rev-1",
  market: "GLOBAL",
  active: true,
};

function ordersService(product: typeof suspended) {
  const orders = { save: jest.fn(), create: jest.fn() };
  const service = new OrdersService(
    {} as never,
    orders as never,
    {} as never,
    {} as never,
    {
      findOne: jest.fn().mockResolvedValue(product),
      find: jest.fn().mockResolvedValue([product]),
    } as never,
    [{ provider: "mock" }] as never,
    { record: jest.fn() } as never,
    { findPublishedOffering: jest.fn().mockResolvedValue(offering) } as never,
  );
  return { service, orders };
}

describe("product kill-switch", () => {
  it("rejects a new checkout with PRODUCT_SUSPENDED before the order is saved", async () => {
    const { service, orders } = ordersService(suspended);
    await expect(
      service.createOrder({
        subjectKind: "USER",
        subjectId: "user-1",
        offeringId: offering.id,
        actor: "user-1",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_SUSPENDED", status: 402 });
    expect(orders.save).not.toHaveBeenCalled();
  });

  it("rejects a renewal order the same way when the product is retired", async () => {
    const { service, orders } = ordersService(retired);
    await expect(
      service.createOrder({
        subjectKind: "USER",
        subjectId: "user-1",
        offeringId: offering.id,
        actor: "user-1",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_RETIRED", status: 402 });
    expect(orders.save).not.toHaveBeenCalled();
  });

  it("refuses trial ensure before a transaction", async () => {
    const dataSource = { transaction: jest.fn() };
    const service = new TrialsService(
      dataSource as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn().mockResolvedValue(suspended) } as never,
      { record: jest.fn() } as never,
      { assertCurrentPolicyAccepted: jest.fn(), currentPolicyVersion: jest.fn() } as never,
    );
    await expect(
      service.ensureTrial({
        logtoSub: "user-1",
        productCode: "vistaremote",
        actor: "user-1",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_SUSPENDED", status: 402 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it("does not extend a paid period when fulfillment runs after suspension", async () => {
    const order = {
      id: "ord-1",
      status: "pending_payment",
      productCode: "vistaremote",
      planCode: "pro",
      interval: "month",
      subjectKind: "USER",
      subjectId: "user-1",
      offeringSku: offering.sku,
      bundleSku: null,
      metadata: { kind: "offering" },
      amountCents: 2000,
      currency: "USD",
    };
    const manager = {
      findOne: jest.fn(async (entity: unknown) => (entity === OrderEntity ? order : null)),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((_entity: unknown, row: unknown) => row),
      getRepository: jest.fn(() => ({
        find: jest.fn(async () => [suspended]),
      })),
    };
    await expect(fulfillPaidOrderTx(manager as never, order.id, "pay_1")).rejects.toMatchObject({
      code: "PRODUCT_SUSPENDED",
    });
    expect(order.status).toBe("pending_payment");
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("hides suspended products from the public offering list and keeps status on plans", async () => {
    const service = new CatalogService(
      {
        find: jest.fn(async (opts?: { where?: { code?: string } }) => {
          const rows = [
            suspended,
            {
              code: "dataluminary",
              name: "DataLuminary",
              active: true,
              sellable: true,
              status: "active",
              trialPolicy: "standard_7d",
            },
          ];
          if (opts?.where?.code) return rows.filter((row) => row.code === opts.where?.code);
          return rows;
        }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { findOne: jest.fn().mockResolvedValue({ id: "rev-1" }) } as never,
      {
        find: jest.fn().mockResolvedValue([
          { ...offering, productCode: "vistaremote" },
          { ...offering, id: "off-2", sku: "dataluminary.pro.month.USD", productCode: "dataluminary" },
        ]),
      } as never,
    );
    const listed = await service.listPublishedOfferings();
    expect(listed.items.map((item) => item.productCode)).toEqual(["dataluminary"]);
    await expect(service.listPlans("vistaremote")).resolves.toMatchObject([
      { productCode: "vistaremote", status: "suspended", sellable: true },
    ]);
  });

  it("audits a platform status change and force-revoke wraps order entitlement revocation", async () => {
    const product = { ...suspended, status: "active" };
    const products = {
      findOne: jest.fn().mockResolvedValue(product),
      save: jest.fn(async (row: typeof product) => row),
    };
    const order = { id: "ord-live", productCode: "vistaremote" };
    const sub = { id: "sub-1", status: "active", source: "order", sourceRef: "ord-live" };
    const grant = { revoked: false, revokedAt: null as Date | null };
    const audit = { record: jest.fn() };
    const dataSource = {
      transaction: jest.fn(async (fn: (manager: unknown) => Promise<void>) => {
        await fn({
          find: jest.fn(async (entity: unknown) => {
            if (entity === SubscriptionEntity) return [sub];
            if (entity === GrantEntity) return [grant];
            return [];
          }),
          save: jest.fn(async (row: unknown) => row),
        });
      }),
    };
    const service = new ProductLifecycleService(
      dataSource as never,
      products as never,
      { find: jest.fn().mockResolvedValue([order]) } as never,
      { find: jest.fn().mockResolvedValue([sub]) } as never,
      audit as never,
    );

    await expect(
      service.setStatus("vistaremote", "suspended", { actor: "admin-1", reason: "partner hold" }),
    ).resolves.toMatchObject({ productCode: "vistaremote", previous: "active", status: "suspended" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.lifecycle", actor: "admin-1" }),
    );

    const revoked = await service.forceRevoke("vistaremote", {
      actor: "admin-1",
      reason: "cut access now",
    });
    expect(revoked.ordersTouched).toBe(1);
    expect(sub.status).toBe("canceled");
    expect(grant.revoked).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.force_revoke" }),
    );
    expect(Reflect.getMetadata(REQUIRES_ADMIN_KEY, AdminController)).toBe(true);
    expect(typeof AdminController.prototype.setProductStatus).toBe("function");
    expect(typeof AdminController.prototype.forceRevokeProduct).toBe("function");
  });

  it("rejects a new partner redemption for a suspended product", async () => {
    const dataSource = { transaction: jest.fn() };
    const service = new PartnerRedemptionService(
      dataSource as never,
      { findOne: jest.fn().mockResolvedValue({ id: "partner-1", active: true }) } as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(suspended) } as never,
      { record: jest.fn() } as never,
      {} as never,
    );
    await expect(
      service.redeem({
        partnerId: "partner-1",
        body: {
          redemptionId: "red-1",
          productCode: "vistaremote",
          planCode: "pro",
          logtoSub: "user-1",
        },
        actor: "partner-1",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_SUSPENDED" });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe("payment isolation filters and merchant account", () => {
  it("passes productCode into attempt, refund, and reconcile admin queries", async () => {
    const payments = {
      listAttemptsAdmin: jest.fn().mockResolvedValue({ items: [] }),
      listRefundsAdmin: jest.fn().mockResolvedValue({ items: [] }),
      reconcilePending: jest.fn().mockResolvedValue({ scanned: 0 }),
    };
    const controller = new PaymentAdminController(payments as never, {} as never);
    await controller.listAttempts(undefined, undefined, undefined, "doerflow");
    await controller.listRefunds(undefined, undefined, "doerflow");
    await controller.reconcilePending({ subjectId: "admin-1" } as never, {}, "doerflow");
    expect(payments.listAttemptsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ productCode: "doerflow" }),
    );
    expect(payments.listRefundsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ productCode: "doerflow" }),
    );
    expect(payments.reconcilePending).toHaveBeenCalledWith(
      expect.objectContaining({ productCode: "doerflow", actor: "admin-1" }),
    );
  });

  it("round-trips merchantAccountId as null for the MoR account and as a stored string", () => {
    expect(readMerchantAccountId(null)).toBeNull();
    expect(readMerchantAccountId("  ")).toBeNull();
    expect(readMerchantAccountId(" acct_partner_1 ")).toBe("acct_partner_1");
    expect(() => readMerchantAccountId("x".repeat(129))).toThrow(EntitlementException);
  });
});
