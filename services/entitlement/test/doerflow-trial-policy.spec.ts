import { CATALOG } from "../src/database/seed-catalog";
import { AdminService } from "../src/modules/admin/admin.service";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PartnerRedemptionService } from "../src/modules/partner/partner-redemption.service";
import { TrialsService } from "../src/modules/trials/trials.service";

const disabledProduct = {
  id: "product-doerflow",
  code: "doerflow",
  name: "DoerFlow",
  active: true,
  trialPolicy: "disabled",
  sellable: true,
};

function expectDisabled(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    code: "PRODUCT_TRIAL_DISABLED",
    status: 402,
  });
}

describe("DoerFlow disabled trial policy", () => {
  it("keeps catalog trialPolicy disabled after adding integration features", () => {
    const doerflow = CATALOG.find((product) => product.code === "doerflow");
    expect(doerflow?.trialPolicy).toBe("disabled");
    expect(doerflow?.plans.some((plan) => plan.code === "trial")).toBe(false);
    expect(doerflow?.features.some((feature) => feature.code.startsWith("integration."))).toBe(
      true,
    );
  });
  it("rejects ensure before opening a transaction or writing audit", async () => {
    const dataSource = { transaction: jest.fn() };
    const audit = { record: jest.fn() };
    const legal = {
      assertCurrentPolicyAccepted: jest.fn(),
      currentPolicyVersion: jest.fn().mockReturnValue("lw-legal-v2026-09-07"),
    };
    const service = new TrialsService(
      dataSource as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn().mockResolvedValue(disabledProduct) } as never,
      audit as never,
      legal as never,
    );

    await expectDisabled(
      service.ensureTrial({
        logtoSub: "user-doerflow",
        productCode: "doerflow",
        actor: "user-doerflow",
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(legal.assertCurrentPolicyAccepted).not.toHaveBeenCalled();
  });

  it("rejects a direct trial order before persisting it", async () => {
    const orders = { save: jest.fn(), create: jest.fn() };
    const products = {
      find: jest.fn().mockResolvedValue([disabledProduct]),
      findOne: jest.fn().mockResolvedValue(disabledProduct),
    };
    const service = new OrdersService(
      {} as never,
      orders as never,
      {} as never,
      {} as never,
      products as never,
      [{ provider: "mock" }] as never,
      { record: jest.fn() } as never,
      { findPublishedOffering: jest.fn() } as never,
    );

    await expectDisabled(
      service.createOrder({
        subjectKind: "USER",
        subjectId: "user-doerflow",
        productCode: "doerflow",
        planCode: "trial",
        actor: "user-doerflow",
      }),
    );
    expect(orders.save).not.toHaveBeenCalled();
  });

  it("rejects partner trial redemption before its transaction", async () => {
    const dataSource = { transaction: jest.fn() };
    const service = new PartnerRedemptionService(
      dataSource as never,
      { findOne: jest.fn().mockResolvedValue({ id: "partner-1", active: true }) } as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(disabledProduct) } as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expectDisabled(
      service.redeem({
        partnerId: "partner-1",
        body: {
          redemptionId: "redemption-1",
          productCode: "doerflow",
          planCode: "trial",
          logtoSub: "user-doerflow",
        },
        actor: "partner-1",
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it("rejects an admin trial grant before subscription or grant writes", async () => {
    const subscriptions = { save: jest.fn(), create: jest.fn() };
    const grants = { save: jest.fn(), create: jest.fn() };
    const service = new AdminService(
      {} as never,
      subscriptions as never,
      grants as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(disabledProduct) } as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expectDisabled(
      service.createGrant({
        subjectKind: "USER",
        subjectId: "user-doerflow",
        productCode: "doerflow",
        planCode: "trial",
        actor: "admin-1",
      }),
    );
    expect(subscriptions.save).not.toHaveBeenCalled();
    expect(grants.save).not.toHaveBeenCalled();
  });

  it("exposes disabled policy and no trial plan in catalog", async () => {
    const service = new CatalogService(
      { find: jest.fn().mockResolvedValue([disabledProduct]) } as never,
      {
        find: jest.fn().mockResolvedValue([
          { id: "pro", code: "pro", name: "Pro", rank: 2 },
          { id: "ultra", code: "ultra", name: "Ultra", rank: 3 },
          { id: "enterprise", code: "enterprise", name: "Enterprise", rank: 4 },
        ]),
      } as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { findOne: jest.fn() } as never,
      { find: jest.fn() } as never,
    );

    await expect(service.listPlans("doerflow")).resolves.toMatchObject([
      {
        productCode: "doerflow",
        trialPolicy: "disabled",
        sellable: true,
        plans: [{ code: "pro" }, { code: "ultra" }, { code: "enterprise" }],
      },
    ]);
  });
});
