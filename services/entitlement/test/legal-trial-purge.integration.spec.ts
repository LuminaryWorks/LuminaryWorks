import { createHmac } from "node:crypto";
import dataSource from "../src/database/data-source";
import { DEFAULT_LEGAL_POLICY_VERSION, LEGAL_DOCUMENT_KEYS } from "../src/common/legal-policy";
import {
  AuditLogEntity,
  GrantEntity,
  OutboxEventEntity,
  PolicyAcceptanceEntity,
  ProductEntity,
  SubscriptionEntity,
  TrialCleanupJobEntity,
  TrialRedemptionEntity,
} from "../src/database/entities";
import { AdminService } from "../src/modules/admin/admin.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { LegalService } from "../src/modules/legal/legal.service";
import { deliverTrialPurge, trialPurgeSignatureMessage } from "../src/modules/notify/trial-purge";
import { TrialsService } from "../src/modules/trials/trials.service";
import {
  acquireTrialLifecycleLock,
  cancelTrialLifecycle,
  hasActiveNonTrialPaidEntitlement,
  TRIAL_LIFECYCLE_EVENT_TYPES,
} from "../src/modules/trials/trial-lifecycle";

const describeDatabase = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("legal acceptance and trial purge integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const productCode = `legal-purge-${suffix}`;
  const subject = `user-${suffix}`;

  async function legalService() {
    return new LegalService(
      {
        getOrThrow: () => ({
          legalPolicyVersion: DEFAULT_LEGAL_POLICY_VERSION,
          legalPublicBaseUrl: "https://example.test/legal",
        }),
      } as never,
      dataSource.getRepository(PolicyAcceptanceEntity),
      { record: jest.fn() } as never,
    );
  }

  function trialsService(legal: LegalService) {
    return new TrialsService(
      dataSource,
      dataSource.getRepository(TrialRedemptionEntity),
      dataSource.getRepository(SubscriptionEntity),
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      dataSource.getRepository(ProductEntity),
      { record: jest.fn() } as never,
      legal,
    );
  }

  function adminService() {
    return new AdminService(
      dataSource,
      dataSource.getRepository(SubscriptionEntity),
      dataSource.getRepository(GrantEntity),
      { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } as never,
      dataSource.getRepository(OutboxEventEntity),
      dataSource.getRepository(ProductEntity),
      new AuditService(dataSource.getRepository(AuditLogEntity)),
      {} as never,
    );
  }

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const products = dataSource.getRepository(ProductEntity);
    await products.save(
      products.create({
        code: productCode,
        name: "Legal Purge Integration",
        active: true,
        trialPolicy: "standard_7d",
        sellable: true,
      }),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM audit_logs WHERE actor = $1`, ["admin-1"]);
    await dataSource.query(`DELETE FROM trial_cleanup_jobs WHERE product_code = $1`, [productCode]);
    await dataSource.query(`DELETE FROM outbox_events WHERE payload->>'productCode' = $1`, [
      productCode,
    ]);
    await dataSource.query(`DELETE FROM policy_acceptances WHERE logto_sub = $1`, [subject]);
    for (const table of ["trial_redemptions", "grants", "subscriptions"]) {
      await dataSource.query(`DELETE FROM ${table} WHERE product_code = $1`, [productCode]);
    }
    await dataSource.getRepository(ProductEntity).delete({ code: productCode });
    await dataSource.destroy();
  });

  async function acceptAndEnsure() {
    const legal = await legalService();
    await legal.accept({
      logtoSub: subject,
      policyVersion: DEFAULT_LEGAL_POLICY_VERSION,
      documentKeys: [...LEGAL_DOCUMENT_KEYS],
      actor: subject,
      ip: "198.51.100.10",
      userAgent: "integration-test",
    });
    return trialsService(legal).ensureTrial({
      logtoSub: subject,
      productCode,
      actor: subject,
    });
  }

  it("enqueues T-3 T-1 expired and purge with a cleanup job", async () => {
    const created = await acceptAndEnsure();
    expect(created.created).toBe(true);
    const events: Array<{ event_type: string }> = await dataSource.query(
      `SELECT event_type FROM outbox_events WHERE payload->>'logtoSub' = $1 AND payload->>'productCode' = $2 ORDER BY event_type`,
      [subject, productCode],
    );
    expect(events.map((e) => e.event_type).sort()).toEqual([...TRIAL_LIFECYCLE_EVENT_TYPES].sort());
    const payload = await dataSource.query(
      `SELECT payload FROM outbox_events WHERE payload->>'logtoSub' = $1 AND event_type = 'trial.purge'`,
      [subject],
    );
    expect(payload[0].payload).toEqual(
      expect.objectContaining({
        logtoSub: subject,
        productCode,
        subscriptionId: created.subscriptionId,
        policyVersion: DEFAULT_LEGAL_POLICY_VERSION,
        trialRedemptionId: expect.any(String),
        startsAt: expect.any(String),
        endsAt: expect.any(String),
      }),
    );
    const jobs = await dataSource.getRepository(TrialCleanupJobEntity).find({
      where: { logtoSub: subject, productCode },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].scheduledFor.toISOString()).toBe(created.endsAt);

    const again = await trialsService(await legalService()).ensureTrial({
      logtoSub: subject,
      productCode,
      actor: subject,
    });
    expect(again.created).toBe(false);
    const counted = await dataSource.query(
      `SELECT count(*)::int AS count FROM outbox_events WHERE payload->>'logtoSub' = $1 AND payload->>'productCode' = $2`,
      [subject, productCode],
    );
    expect(counted[0].count).toBe(4);
  });

  it("retries when the purge target is missing and never marks sent", async () => {
    const job = await dataSource.getRepository(TrialCleanupJobEntity).findOneByOrFail({
      logtoSub: subject,
      productCode,
    });
    const event = await dataSource.getRepository(OutboxEventEntity).findOneByOrFail({
      id: job.outboxEventId!,
    });
    await expect(
      deliverTrialPurge({
        dataSource,
        event,
        targets: {},
        fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ ok: true }) }),
      }),
    ).rejects.toThrow(/Missing trial purge target/);
    const reloaded = await dataSource.getRepository(OutboxEventEntity).findOneByOrFail({
      id: event.id,
    });
    expect(reloaded.status).not.toBe("sent");
    const reloadedJob = await dataSource.getRepository(TrialCleanupJobEntity).findOneByOrFail({
      id: job.id,
    });
    expect(reloadedJob.status).toBe("pending");
  });

  it("sends HMAC-signed JSON and records a valid ack", async () => {
    const job = await dataSource.getRepository(TrialCleanupJobEntity).findOneByOrFail({
      logtoSub: subject,
      productCode,
    });
    const event = await dataSource.getRepository(OutboxEventEntity).findOneByOrFail({
      id: job.outboxEventId!,
    });
    let captured: { headers: Record<string, string>; body: string } | null = null;
    const secret = "replace-with-product-secret";
    const outcome = await deliverTrialPurge({
      dataSource,
      event,
      targets: {
        [productCode]: { url: "https://product.example/internal/trial-purge", secret },
      },
      fetchImpl: async (_url, init) => {
        captured = { headers: init.headers, body: init.body };
        return {
          status: 200,
          text: async () => JSON.stringify({ ok: true, jobId: job.id, eventId: event.id }),
        };
      },
    });
    expect(outcome).toBe("sent");
    expect(captured).not.toBeNull();
    const expected = createHmac("sha256", secret)
      .update(
        trialPurgeSignatureMessage(
          captured!.headers["x-lw-timestamp"],
          captured!.headers["x-lw-nonce"],
          captured!.body,
        ),
      )
      .digest("base64url");
    expect(captured!.headers["x-lw-signature"]).toBe(`v1=${expected}`);
    const acked = await dataSource.getRepository(TrialCleanupJobEntity).findOneByOrFail({
      id: job.id,
    });
    expect(acked.status).toBe("acked");
    expect(acked.ackPayload).toMatchObject({ ok: true, jobId: job.id });
  });

  it("retries on invalid ack and does not ack the job", async () => {
    const jobs = dataSource.getRepository(TrialCleanupJobEntity);
    const job = await jobs.findOneByOrFail({ logtoSub: subject, productCode });
    job.status = "pending";
    job.ackedAt = null;
    job.deliveredAt = null;
    job.ackPayload = null;
    await jobs.save(job);
    const event = await dataSource.getRepository(OutboxEventEntity).findOneByOrFail({
      id: job.outboxEventId!,
    });
    event.status = "pending";
    await dataSource.getRepository(OutboxEventEntity).save(event);

    await expect(
      deliverTrialPurge({
        dataSource,
        event,
        targets: {
          [productCode]: {
            url: "http://dataluminary:8080/internal/trial-purge",
            secret: "replace-with-product-secret",
          },
        },
        fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ ok: false }) }),
      }),
    ).rejects.toThrow(/ok:true/);
    const reloaded = await jobs.findOneByOrFail({ id: job.id });
    expect(reloaded.status).toBe("pending");
    expect(reloaded.ackedAt).toBeNull();
  });

  it("cancels pending purge when paid entitlement exists before delivery", async () => {
    const jobs = dataSource.getRepository(TrialCleanupJobEntity);
    const job = await jobs.findOneByOrFail({ logtoSub: subject, productCode });
    job.status = "pending";
    job.ackedAt = null;
    await jobs.save(job);
    const event = await dataSource.getRepository(OutboxEventEntity).findOneByOrFail({
      id: job.outboxEventId!,
    });
    event.status = "pending";
    await dataSource.getRepository(OutboxEventEntity).save(event);

    const now = new Date();
    await dataSource.getRepository(SubscriptionEntity).save(
      dataSource.getRepository(SubscriptionEntity).create({
        subjectKind: "USER",
        subjectId: subject,
        productCode,
        planCode: "pro",
        status: "active",
        startsAt: now,
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        source: "order",
        sourceRef: "paid-before-delivery",
        organizationId: null,
      }),
    );

    const outcome = await deliverTrialPurge({
      dataSource,
      event,
      targets: {
        [productCode]: {
          url: "https://product.example/internal/trial-purge",
          secret: "replace-with-product-secret",
        },
      },
      fetchImpl: async () => {
        throw new Error("must not call product when paid");
      },
    });
    expect(outcome).toBe("canceled");
    const reloaded = await jobs.findOneByOrFail({ id: job.id });
    expect(reloaded.status).toBe("canceled");
  });

  it("serializes paid fulfillment and purge with the same advisory lock", async () => {
    let firstEntered = false;
    let secondSawPaid = false;
    let releaseFirst: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = dataSource.transaction(async (manager) => {
      await acquireTrialLifecycleLock(manager, subject, productCode);
      firstEntered = true;
      releaseFirst();
      await new Promise((r) => setTimeout(r, 80));
      await cancelTrialLifecycle(manager, subject, productCode);
    });
    const second = (async () => {
      await started;
      await dataSource.transaction(async (manager) => {
        await acquireTrialLifecycleLock(manager, subject, productCode);
        secondSawPaid = await hasActiveNonTrialPaidEntitlement(manager, {
          logtoSub: subject,
          productCode,
        });
      });
    })();
    await Promise.all([first, second]);
    expect(firstEntered).toBe(true);
    expect(secondSawPaid).toBe(true);
  });

  it("admin can list retry and cancel cleanup jobs", async () => {
    const admin = adminService();
    const listed = await admin.listCleanupJobs({ productCode, logtoSub: subject });
    expect(listed.length).toBeGreaterThanOrEqual(1);
    const job = listed[0];
    await dataSource
      .getRepository(TrialCleanupJobEntity)
      .update({ id: job.id }, { status: "failed", lastError: "boom" });
    if (job.outboxEventId) {
      await dataSource
        .getRepository(OutboxEventEntity)
        .update({ id: job.outboxEventId }, { status: "dead" });
    }

    const retried = await admin.retryCleanupJob(job.id, "admin-1");
    expect(retried.status).toBe("pending");
    if (job.outboxEventId) {
      const event = await dataSource.getRepository(OutboxEventEntity).findOneByOrFail({
        id: job.outboxEventId,
      });
      expect(event.status).toBe("pending");
    }

    const canceled = await admin.cancelCleanupJob(job.id, "admin-1");
    expect(canceled.status).toBe("canceled");
    const acceptances = await admin.listPolicyAcceptances({ logtoSub: subject });
    expect(acceptances.length).toBe(3);
    const audit = await admin.listAudit({ actor: "admin-1", resourceType: "trial_cleanup_job" });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
