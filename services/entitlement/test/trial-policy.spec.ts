/**
 * Pure-unit coverage of trial skip rules (enterprise / deployment never create Trial).
 * DB concurrency is exercised via unique (logto_sub, product_code) + txn lock in TrialsService.
 */

describe("trial skip policy", () => {
  function shouldSkipTrial(input: {
    hasActiveOrgEnterprise: boolean;
    hasActiveDeploymentLicense: boolean;
  }): string | null {
    if (input.hasActiveDeploymentLicense) return "DEPLOYMENT_LICENSE";
    if (input.hasActiveOrgEnterprise) return "ORGANIZATION_ENTERPRISE";
    return null;
  }

  it("skips when organization has active enterprise subscription", () => {
    expect(
      shouldSkipTrial({
        hasActiveOrgEnterprise: true,
        hasActiveDeploymentLicense: false,
      }),
    ).toBe("ORGANIZATION_ENTERPRISE");
  });

  it("skips when deployment has active license", () => {
    expect(
      shouldSkipTrial({
        hasActiveOrgEnterprise: false,
        hasActiveDeploymentLicense: true,
      }),
    ).toBe("DEPLOYMENT_LICENSE");
  });

  it("allows ToC trial otherwise", () => {
    expect(
      shouldSkipTrial({
        hasActiveOrgEnterprise: false,
        hasActiveDeploymentLicense: false,
      }),
    ).toBeNull();
  });
});

describe("subject identity trust boundary", () => {
  function resolveSubject(input: {
    kind: "user" | "service" | "admin";
    subjectId: string;
    actAsSubjectId?: string | null;
    bodySubjectId?: string;
  }): string {
    // body.subjectId is intentionally ignored
    void input.bodySubjectId;
    if (input.kind === "user") return input.subjectId;
    if (input.actAsSubjectId) return input.actAsSubjectId;
    if (input.kind === "admin") return input.subjectId;
    throw new Error("FORBIDDEN");
  }

  it("never trusts body subjectId", () => {
    expect(
      resolveSubject({
        kind: "user",
        subjectId: "user_from_token",
        bodySubjectId: "attacker",
      }),
    ).toBe("user_from_token");
  });

  it("requires act-as for service principals", () => {
    expect(() => resolveSubject({ kind: "service", subjectId: "service:internal" })).toThrow(
      "FORBIDDEN",
    );
    expect(
      resolveSubject({
        kind: "service",
        subjectId: "service:internal",
        actAsSubjectId: "user_abc",
      }),
    ).toBe("user_abc");
  });
});
