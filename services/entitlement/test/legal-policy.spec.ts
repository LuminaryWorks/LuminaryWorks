import { EntitlementException } from "../src/common/errors";
import { ERROR_HTTP_STATUS } from "../src/common/constants";
import {
  DEFAULT_LEGAL_POLICY_VERSION,
  LEGAL_DOCUMENT_KEYS,
  legalDocumentsForVersion,
  parseTrialPurgeTargets,
} from "../src/common/legal-policy";
import { LegalService } from "../src/modules/legal/legal.service";
import { TrialsService } from "../src/modules/trials/trials.service";
import { trialNotifyCopy, trialNotifyDedupeKey } from "../src/modules/trials/trial-lifecycle";
import { resolveTrustedSubject } from "../src/auth/principal-context";

function stubConfig(version = DEFAULT_LEGAL_POLICY_VERSION) {
  return {
    getOrThrow: () => ({
      legalPolicyVersion: version,
      legalPublicBaseUrl: "https://example.test/legal",
    }),
  };
}

describe("legal policy version and documents", () => {
  it("defaults to lw-legal-v2026-09-07 with terms/privacy/trial-deletion URLs", () => {
    expect(DEFAULT_LEGAL_POLICY_VERSION).toBe("lw-legal-v2026-09-07");
    expect(LEGAL_DOCUMENT_KEYS).toEqual(["terms", "privacy", "trial-deletion"]);
    const docs = legalDocumentsForVersion(
      DEFAULT_LEGAL_POLICY_VERSION,
      "https://example.test/legal/",
    );
    expect(docs.map((d) => d.key)).toEqual([...LEGAL_DOCUMENT_KEYS]);
    expect(docs[0].urls.en).toBe("https://example.test/legal/en/terms.md");
    expect(docs[2].urls.zh).toContain("trial-data-deletion.md");
  });

  it("maps TRIAL_POLICY_NOT_ACCEPTED to HTTP 400", () => {
    const ex = new EntitlementException("TRIAL_POLICY_NOT_ACCEPTED", "not accepted");
    expect(ex.getStatus()).toBe(400);
    expect(ERROR_HTTP_STATUS.TRIAL_POLICY_NOT_ACCEPTED).toBe(400);
  });
});

describe("parseTrialPurgeTargets", () => {
  it("accepts empty and strict product maps", () => {
    expect(parseTrialPurgeTargets(undefined)).toEqual({});
    expect(
      parseTrialPurgeTargets(
        JSON.stringify({
          dataluminary: {
            url: "https://dataluminary.example/internal/trial-purge",
            secret: "replace-with-product-secret",
          },
        }),
      ),
    ).toEqual({
      dataluminary: {
        url: "https://dataluminary.example/internal/trial-purge",
        secret: "replace-with-product-secret",
      },
    });
  });

  it("rejects invalid JSON, extra keys, and non-http URLs", () => {
    expect(() => parseTrialPurgeTargets("{")).toThrow(/valid JSON/);
    expect(() =>
      parseTrialPurgeTargets(
        JSON.stringify({ dataluminary: { url: "https://x", secret: "s", extra: 1 } }),
      ),
    ).toThrow(/unexpected keys/);
    expect(() =>
      parseTrialPurgeTargets(JSON.stringify({ dataluminary: { url: "ftp://x", secret: "s" } })),
    ).toThrow(/https or internal http/);
  });
});

describe("policy accept service", () => {
  function service(rows: unknown[] = []) {
    const store = [...rows] as Array<{
      logtoSub: string;
      policyKind: string;
      policyVersion: string;
      documentKey: string;
      documentVersion: string;
      acceptedAt: Date;
      ip: string | null;
      userAgent: string | null;
    }>;
    const acceptances = {
      find: jest.fn(async ({ where }: { where: { logtoSub: string; policyVersion: string } }) =>
        store.filter(
          (row) => row.logtoSub === where.logtoSub && row.policyVersion === where.policyVersion,
        ),
      ),
      create: jest.fn((row: (typeof store)[number]) => row),
      save: jest.fn(async (row: (typeof store)[number]) => {
        store.push(row);
        return row;
      }),
    };
    const legal = new LegalService(
      stubConfig() as never,
      acceptances as never,
      { record: jest.fn() } as never,
    );
    return { legal, acceptances, store };
  }

  it("requires current terms/privacy/trial-deletion before trial ensure", async () => {
    const { legal } = service();
    await expect(legal.assertCurrentPolicyAccepted("user-1")).rejects.toMatchObject({
      code: "TRIAL_POLICY_NOT_ACCEPTED",
    });
  });

  it("accepts current version idempotently and ignores a supplied subjectId", async () => {
    const { legal } = service();
    const first = await legal.accept({
      logtoSub: "user-from-token",
      policyVersion: DEFAULT_LEGAL_POLICY_VERSION,
      actor: "user-from-token",
      ip: "203.0.113.10",
      userAgent: "test-agent",
      subjectId: "attacker",
    });
    expect(first.logtoSub).toBe("user-from-token");
    expect(first.idempotent).toBe(false);
    expect(first.documents).toHaveLength(3);

    const second = await legal.accept({
      logtoSub: "user-from-token",
      policyVersion: DEFAULT_LEGAL_POLICY_VERSION,
      actor: "user-from-token",
      subjectId: "attacker",
    });
    expect(second.idempotent).toBe(true);
    expect(second.documents).toHaveLength(3);
  });

  it("rejects a stale policyVersion", async () => {
    const { legal } = service();
    await expect(
      legal.accept({
        logtoSub: "user-from-token",
        policyVersion: "lw-legal-v1999-01-01",
        actor: "user-from-token",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("subject identity is never taken from the body", () => {
  it("uses the authenticated subject for policy and trial APIs", () => {
    expect(
      resolveTrustedSubject({
        kind: "user",
        subjectId: "user_from_token",
        scopes: [],
      }).subjectId,
    ).toBe("user_from_token");
    expect(() =>
      resolveTrustedSubject({
        kind: "service",
        subjectId: "service:internal",
        scopes: [],
      }),
    ).toThrow(EntitlementException);
  });
});

describe("trial ensure policy gating", () => {
  const standardProduct = {
    id: "p1",
    code: "dataluminary",
    active: true,
    trialPolicy: "standard_7d",
  };

  it("skips enterprise/private without requiring acceptance", async () => {
    const legal = { assertCurrentPolicyAccepted: jest.fn() };
    const trials = new TrialsService(
      { transaction: jest.fn() } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          startsAt: new Date("2020-01-01T00:00:00.000Z"),
          endsAt: null,
        }),
      } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(standardProduct) } as never,
      { record: jest.fn() } as never,
      legal as never,
    );
    const result = await trials.ensureTrial({
      logtoSub: "user-1",
      productCode: "dataluminary",
      organizationId: "org-1",
      actor: "user-1",
    });
    expect(result.skippedReason).toBe("ORGANIZATION_ENTERPRISE");
    expect(legal.assertCurrentPolicyAccepted).not.toHaveBeenCalled();
  });

  it("fails with TRIAL_POLICY_NOT_ACCEPTED before opening a create transaction", async () => {
    const dataSource = { transaction: jest.fn() };
    const legal = {
      assertCurrentPolicyAccepted: jest
        .fn()
        .mockRejectedValue(new EntitlementException("TRIAL_POLICY_NOT_ACCEPTED", "missing")),
      currentPolicyVersion: jest.fn(),
    };
    const trials = new TrialsService(
      dataSource as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(standardProduct) } as never,
      { record: jest.fn() } as never,
      legal as never,
    );
    await expect(
      trials.ensureTrial({
        logtoSub: "user-1",
        productCode: "dataluminary",
        actor: "user-1",
      }),
    ).rejects.toMatchObject({ code: "TRIAL_POLICY_NOT_ACCEPTED" });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe("T-1 notify copy and dedupe", () => {
  it("uses distinct T-1 text", () => {
    const t1 = trialNotifyCopy("trial.expiring_t1", "dataluminary", "2026-09-14T00:00:00.000Z");
    const t3 = trialNotifyCopy("trial.expiring", "dataluminary", "2026-09-14T00:00:00.000Z");
    expect(t1.title).toContain("1 day");
    expect(t1.body).toContain("Data deletion");
    expect(t3.title).toContain("3 days");
    expect(t1.title).not.toBe(t3.title);
  });

  it("builds unique keys for T-3 T-1 expired and purge", () => {
    const t3 = new Date("2026-09-11T00:00:00.000Z");
    const t1 = new Date("2026-09-13T00:00:00.000Z");
    const end = new Date("2026-09-14T00:00:00.000Z");
    expect(trialNotifyDedupeKey("u1", "dataluminary", "trial.expiring", t3)).toBe(
      "u1:dataluminary:trial.expiring:2026-09-11",
    );
    expect(trialNotifyDedupeKey("u1", "dataluminary", "trial.expiring_t1", t1)).toBe(
      "u1:dataluminary:trial.expiring_t1:2026-09-13",
    );
    expect(trialNotifyDedupeKey("u1", "dataluminary", "trial.expired", end)).toBe(
      "u1:dataluminary:trial.expired:2026-09-14T00:00:00.000Z",
    );
    expect(trialNotifyDedupeKey("u1", "dataluminary", "trial.purge", end)).toBe(
      "u1:dataluminary:trial.purge:2026-09-14T00:00:00.000Z",
    );
  });
});
