import {
  MONTH_DURATION_MS,
  YEAR_DURATION_MS,
  paidSubscriptionEndsAt,
  rejectClientAuthoritativePricing,
  ultraSupersetViolations,
  assertUltraSupersetOfPro,
} from "../src/common/catalog-pricing";
import { EntitlementException } from "../src/common/errors";
import { CatalogAdminService } from "../src/modules/catalog/catalog-admin.service";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { TrialsService } from "../src/modules/trials/trials.service";
import { CONSERVATIVE_OFFERING_PRICES, SEED_OFFERINGS } from "../src/database/seed-catalog";

function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  return expect(promise).rejects.toMatchObject({
    code,
    ...(status != null ? { status } : {}),
  });
}

describe("server-authoritative pricing helpers", () => {
  it("rejects client amount, currency, plan, and endsAt", () => {
    expect(() =>
      rejectClientAuthoritativePricing({
        offeringId: "off_1",
        amountCents: 1,
        currency: "USD",
        planCode: "pro",
        endsAt: "2099-01-01",
      }),
    ).toThrow(EntitlementException);
    try {
      rejectClientAuthoritativePricing({ amountMinor: 0 });
    } catch (err) {
      expect(err).toMatchObject({ code: "PAYMENT_PRICE_MISMATCH", status: 400 });
    }
    expect(() => rejectClientAuthoritativePricing({ offeringId: "off_1" })).not.toThrow();
  });

  it("computes 30-day month and 365-day year endsAt", () => {
    const now = new Date("2026-09-07T00:00:00.000Z");
    expect(paidSubscriptionEndsAt(now, "month").getTime() - now.getTime()).toBe(MONTH_DURATION_MS);
    expect(paidSubscriptionEndsAt(now, "year").getTime() - now.getTime()).toBe(YEAR_DURATION_MS);
  });

  it("extends renewal from max(now, currentEndsAt)", () => {
    const now = new Date("2026-09-07T00:00:00.000Z");
    const future = new Date("2026-10-01T00:00:00.000Z");
    const past = new Date("2026-08-01T00:00:00.000Z");
    expect(paidSubscriptionEndsAt(now, "month", future).toISOString()).toBe(
      new Date(future.getTime() + MONTH_DURATION_MS).toISOString(),
    );
    expect(paidSubscriptionEndsAt(now, "month", past).toISOString()).toBe(
      new Date(now.getTime() + MONTH_DURATION_MS).toISOString(),
    );
    expect(paidSubscriptionEndsAt(now, "month", null).toISOString()).toBe(
      new Date(now.getTime() + MONTH_DURATION_MS).toISOString(),
    );
  });

  it("requires Ultra feature/quota superset of Pro", () => {
    expect(
      ultraSupersetViolations(
        "dataluminary",
        [
          { featureCode: "dashboard.export", kind: "bool", effect: "allow", limitValue: null },
          { featureCode: "dashboard.count", kind: "quota", effect: "allow", limitValue: 50 },
        ],
        [
          { featureCode: "dashboard.export", kind: "bool", effect: "allow", limitValue: null },
          { featureCode: "dashboard.count", kind: "quota", effect: "allow", limitValue: 200 },
        ],
      ),
    ).toEqual([]);
    expect(
      ultraSupersetViolations(
        "dataluminary",
        [{ featureCode: "dashboard.export", kind: "bool", effect: "allow", limitValue: null }],
        [],
      ),
    ).toEqual(["dataluminary: Ultra is missing Pro feature dashboard.export"]);
    expect(
      ultraSupersetViolations(
        "blockyedu",
        [{ featureCode: "student.limit", kind: "quota", effect: "allow", limitValue: 100 }],
        [{ featureCode: "student.limit", kind: "quota", effect: "allow", limitValue: 50 }],
      ),
    ).toEqual(["blockyedu: Ultra quota student.limit (50) is below Pro (100)"]);
    expect(() =>
      assertUltraSupersetOfPro([
        {
          productCode: "x",
          pro: [{ featureCode: "a", kind: "bool", effect: "allow", limitValue: null }],
          ultra: [{ featureCode: "a", kind: "bool", effect: "deny", limitValue: null }],
        },
      ]),
    ).toThrow(EntitlementException);
    try {
      assertUltraSupersetOfPro([
        {
          productCode: "x",
          pro: [{ featureCode: "a", kind: "bool", effect: "allow", limitValue: null }],
          ultra: [{ featureCode: "a", kind: "bool", effect: "deny", limitValue: null }],
        },
      ]);
    } catch (err) {
      expect(err).toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    }
  });
});

describe("seed offerings", () => {
  it("prices only currently sellable products in CNY/USD month/year", () => {
    const products = new Set(SEED_OFFERINGS.map((row) => row.productCode));
    expect([...products].sort()).toEqual(
      ["blockyedu", "dataluminary", "doerflow", "vistaremote"].sort(),
    );
    expect(SEED_OFFERINGS.every((row) => row.amountMinor > 0)).toBe(true);
    expect(SEED_OFFERINGS.every((row) => row.active)).toBe(true);
    expect(
      SEED_OFFERINGS.find((row) => row.sku === "dataluminary.pro.month.CNY")?.amountMinor,
    ).toBe(CONSERVATIVE_OFFERING_PRICES.CNY.pro.month);
    expect(SEED_OFFERINGS.find((row) => row.sku === "doerflow.ultra.year.USD")?.amountMinor).toBe(
      CONSERVATIVE_OFFERING_PRICES.USD.ultra.year,
    );
  });
});

describe("create order from published offerings", () => {
  const sellable = {
    id: "p1",
    code: "dataluminary",
    name: "DataLuminary",
    active: true,
    trialPolicy: "standard_7d",
    sellable: true,
  };
  const unsellable = {
    ...sellable,
    id: "p2",
    code: "vistacast",
    name: "VistaCast",
    trialPolicy: "disabled",
    sellable: false,
  };

  function service(opts?: {
    offering?: Record<string, unknown> | null;
    products?: Array<typeof sellable>;
  }) {
    const offering =
      opts?.offering === undefined
        ? {
            id: "off_live",
            sku: "dataluminary.pro.month.CNY",
            productCode: "dataluminary",
            planCode: "pro",
            interval: "month",
            currency: "CNY",
            amountMinor: 9900,
            market: "CN",
            active: true,
            revisionId: "rev_live",
          }
        : opts.offering;
    const saved: Record<string, unknown>[] = [];
    const products = {
      find: jest.fn().mockResolvedValue(opts?.products ?? [sellable]),
      findOne: jest
        .fn()
        .mockImplementation(
          async ({ where }: { where: { code?: string } }) =>
            (opts?.products ?? [sellable, unsellable]).find((p) => p.code === where.code) ?? null,
        ),
    };
    const orders = {
      create: jest.fn((value: Record<string, unknown>) => ({ id: "ord_1", ...value })),
      save: jest.fn(async (row: Record<string, unknown>) => {
        saved.push(row);
        return row;
      }),
    };
    const catalog = {
      findPublishedOffering: jest.fn().mockImplementation(async () => {
        if (!offering) {
          throw new EntitlementException("PAYMENT_OFFERING_INVALID", "missing");
        }
        return offering;
      }),
    };
    return {
      saved,
      catalog,
      orders,
      service: new OrdersService(
        {} as never,
        orders as never,
        { findOne: jest.fn() } as never,
        {} as never,
        products as never,
        [{ provider: "mock" }] as never,
        { record: jest.fn() } as never,
        catalog as never,
      ),
    };
  }

  it("snapshots server price and ignores any desire to set amount", async () => {
    const { service: orders, saved, catalog } = service();
    const order = await orders.createOrder({
      subjectKind: "USER",
      subjectId: "user-1",
      offeringId: "off_live",
      productCode: "dataluminary",
      interval: "month",
      providerHint: "mock",
      returnUrl: "https://app.example/return",
      actor: "user-1",
    });
    expect(catalog.findPublishedOffering).toHaveBeenCalledWith({
      offeringId: "off_live",
      sku: undefined,
    });
    expect(order).toMatchObject({
      amountCents: 9900,
      currency: "CNY",
      planCode: "pro",
      interval: "month",
      offeringId: "off_live",
      offeringSku: "dataluminary.pro.month.CNY",
      catalogRevisionId: "rev_live",
      returnUrl: "https://app.example/return",
    });
    expect(saved[0]?.amountCents).toBe(9900);
  });

  it("rejects zero and negative offerings", async () => {
    const zero = service({
      offering: {
        id: "off_zero",
        sku: "dataluminary.pro.month.CNY",
        productCode: "dataluminary",
        planCode: "pro",
        interval: "month",
        currency: "CNY",
        amountMinor: 0,
        active: true,
        revisionId: "rev_live",
      },
    });
    await expectCode(
      zero.service.createOrder({
        subjectKind: "USER",
        subjectId: "user-1",
        offeringId: "off_zero",
        actor: "user-1",
      }),
      "PAYMENT_OFFERING_INVALID",
    );
    expect(zero.orders.save).not.toHaveBeenCalled();

    const negative = service({
      offering: {
        id: "off_neg",
        sku: "dataluminary.pro.month.CNY",
        productCode: "dataluminary",
        planCode: "pro",
        interval: "month",
        currency: "CNY",
        amountMinor: -1,
        active: true,
        revisionId: "rev_live",
      },
    });
    await expectCode(
      negative.service.createOrder({
        subjectKind: "USER",
        subjectId: "user-1",
        sku: "dataluminary.pro.month.CNY",
        actor: "user-1",
      }),
      "PAYMENT_OFFERING_INVALID",
    );
  });

  it("rejects unsellable products including VistaCast", async () => {
    const { service: orders, orders: repo } = service({
      offering: {
        id: "off_cast",
        sku: "vistacast.pro.month.CNY",
        productCode: "vistacast",
        planCode: "pro",
        interval: "month",
        currency: "CNY",
        amountMinor: 9900,
        active: true,
        revisionId: "rev_live",
      },
      products: [unsellable],
    });
    await expectCode(
      orders.createOrder({
        subjectKind: "USER",
        subjectId: "user-1",
        offeringId: "off_cast",
        actor: "user-1",
      }),
      "PRODUCT_NOT_SELLABLE",
      402,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe("VistaCast and SyncroBrain trial/sellable gates", () => {
  it("rejects Trial ensure for both products", async () => {
    for (const code of ["vistacast", "syncrobrain"]) {
      const dataSource = { transaction: jest.fn() };
      const audit = { record: jest.fn() };
      const legal = { assertCurrentPolicyAccepted: jest.fn() };
      const trials = new TrialsService(
        dataSource as never,
        { findOne: jest.fn() } as never,
        { findOne: jest.fn() } as never,
        { findOne: jest.fn() } as never,
        {
          findOne: jest.fn().mockResolvedValue({
            id: code,
            code,
            active: true,
            trialPolicy: "disabled",
            sellable: false,
          }),
        } as never,
        audit as never,
        legal as never,
      );
      await expectCode(
        trials.ensureTrial({ logtoSub: "user-1", productCode: code, actor: "user-1" }),
        "PRODUCT_TRIAL_DISABLED",
        402,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(legal.assertCurrentPolicyAccepted).not.toHaveBeenCalled();
    }
  });
});

describe("published catalog visibility and revision rollback", () => {
  const dataluminary = {
    id: "p-dl",
    code: "dataluminary",
    active: true,
    sellable: true,
    trialPolicy: "standard_7d",
  };

  function catalogWith(
    revisions: Array<Record<string, unknown>>,
    offerings: Array<Record<string, unknown>>,
  ) {
    return new CatalogService(
      { find: jest.fn().mockResolvedValue([dataluminary]) } as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      {
        findOne: jest
          .fn()
          .mockImplementation(async ({ where }: { where: { status?: string; id?: string } }) => {
            if (where.status) return revisions.find((row) => row.status === where.status) ?? null;
            if (where.id) return revisions.find((row) => row.id === where.id) ?? null;
            return null;
          }),
      } as never,
      {
        find: jest
          .fn()
          .mockImplementation(
            async ({ where }: { where: { revisionId?: string; active?: boolean } }) =>
              offerings.filter(
                (row) =>
                  row.revisionId === where.revisionId &&
                  (where.active == null || row.active === where.active),
              ),
          ),
        findOne: jest
          .fn()
          .mockImplementation(
            async ({ where }: { where: { id?: string; sku?: string; revisionId?: string } }) =>
              offerings.find(
                (row) =>
                  row.revisionId === where.revisionId &&
                  (where.id ? row.id === where.id : true) &&
                  (where.sku ? row.sku === where.sku : true),
              ) ?? null,
          ),
      } as never,
    );
  }

  it("lists only active offerings from the published revision", async () => {
    const catalog = catalogWith(
      [
        { id: "rev_old", status: "superseded", version: 1 },
        { id: "rev_live", status: "published", version: 2 },
        { id: "rev_draft", status: "draft", version: 3 },
      ],
      [
        {
          id: "off_old",
          sku: "dataluminary.pro.month.CNY",
          productCode: "dataluminary",
          planCode: "pro",
          interval: "month",
          currency: "CNY",
          amountMinor: 1,
          market: "CN",
          active: true,
          revisionId: "rev_old",
        },
        {
          id: "off_live",
          sku: "dataluminary.pro.month.CNY",
          productCode: "dataluminary",
          planCode: "pro",
          interval: "month",
          currency: "CNY",
          amountMinor: 9900,
          market: "CN",
          active: true,
          revisionId: "rev_live",
        },
        {
          id: "off_draft",
          sku: "dataluminary.pro.month.CNY",
          productCode: "dataluminary",
          planCode: "pro",
          interval: "month",
          currency: "CNY",
          amountMinor: 1,
          market: "CN",
          active: true,
          revisionId: "rev_draft",
        },
      ],
    );
    const listed = await catalog.listPublishedOfferings();
    expect(listed.catalogRevisionId).toBe("rev_live");
    expect(listed.items).toEqual([expect.objectContaining({ id: "off_live", amountMinor: 9900 })]);
    await expect(catalog.findPublishedOffering({ offeringId: "off_old" })).rejects.toMatchObject({
      code: "PAYMENT_OFFERING_INVALID",
    });
    await expect(catalog.findPublishedOffering({ offeringId: "off_draft" })).rejects.toMatchObject({
      code: "PAYMENT_OFFERING_INVALID",
    });
  });

  it("rollback restores the previous published revision's offerings", async () => {
    const rev1 = {
      id: "rev_1",
      version: 1,
      status: "superseded",
      notes: null,
      publishedAt: new Date(),
      supersededAt: new Date(),
      createdAt: new Date(),
    };
    const rev2 = {
      id: "rev_2",
      version: 2,
      status: "published",
      notes: null,
      publishedAt: new Date(),
      supersededAt: null,
      createdAt: new Date(),
    };
    const revisions = {
      findOne: jest
        .fn()
        .mockImplementation(async ({ where }: { where: { id?: string; status?: string } }) => {
          if (where.id === "rev_1") return rev1;
          if (where.id === "rev_2") return rev2;
          if (where.status === "published")
            return rev2.status === "published" ? rev2 : rev1.status === "published" ? rev1 : null;
          return null;
        }),
      find: jest.fn(),
    };
    const offerings = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
    };
    const admin = new CatalogAdminService(
      {
        transaction: async (
          fn: (manager: {
            findOne: (
              entity: unknown,
              opts: { where: { id?: string; status?: string } },
            ) => Promise<typeof rev1 | typeof rev2 | null>;
            save: (row: typeof rev1 | typeof rev2) => Promise<typeof rev1 | typeof rev2>;
          }) => Promise<void>,
        ) => {
          await fn({
            findOne: async (_entity, opts) => revisions.findOne(opts),
            save: async (row) => row,
          });
        },
      } as never,
      revisions as never,
      offerings as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { record: jest.fn() } as never,
    );

    await admin.rollback("rev_1", { actor: "admin-1" });
    expect(rev2.status).toBe("superseded");
    expect(rev1.status).toBe("published");
    expect(rev1.supersededAt).toBeNull();
  });
});

describe("catalog admin offering validation", () => {
  function admin(
    products = [
      { id: "p1", code: "dataluminary", active: true, sellable: true },
      { id: "p2", code: "vistacast", active: true, sellable: false },
    ],
  ) {
    return new CatalogAdminService(
      { transaction: jest.fn() } as never,
      { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() } as never,
      {
        find: jest.fn(),
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        remove: jest.fn(),
      } as never,
      {
        find: jest.fn().mockResolvedValue(products),
        findOne: jest.fn(),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          { id: "pro", code: "pro", productId: "p1", active: true },
          { id: "ultra", code: "ultra", productId: "p1", active: true },
        ]),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            planId: "pro",
            effect: "allow",
            limitValue: "50",
            feature: { code: "dashboard.count", kind: "quota" },
          },
          {
            planId: "ultra",
            effect: "allow",
            limitValue: "10",
            feature: { code: "dashboard.count", kind: "quota" },
          },
        ]),
      } as never,
      { record: jest.fn() } as never,
    );
  }

  it("rejects zero/negative and unsellable active offerings", async () => {
    const service = admin();
    await expectCode(
      service.validatedOfferingRows([
        {
          sku: "dataluminary.pro.month.CNY",
          productCode: "dataluminary",
          planCode: "pro",
          interval: "month",
          currency: "CNY",
          amountMinor: 0,
          market: "CN",
        },
      ]),
      "PAYMENT_OFFERING_INVALID",
    );
    await expectCode(
      service.validatedOfferingRows([
        {
          sku: "vistacast.pro.month.CNY",
          productCode: "vistacast",
          planCode: "pro",
          interval: "month",
          currency: "CNY",
          amountMinor: 9900,
          market: "CN",
          active: true,
        },
      ]),
      "PRODUCT_NOT_SELLABLE",
    );
    await expectCode(
      service.validatedOfferingRows([
        {
          sku: "dataluminary.trial.month.CNY",
          productCode: "dataluminary",
          planCode: "trial",
          interval: "month",
          currency: "CNY",
          amountMinor: 9900,
          market: "CN",
        },
      ]),
      "PAYMENT_OFFERING_INVALID",
    );
  });

  it("rejects publish when Ultra is not a Pro superset", async () => {
    const service = admin([{ id: "p1", code: "dataluminary", active: true, sellable: true }]);
    await expect(service.assertCurrentUltraSuperset()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
