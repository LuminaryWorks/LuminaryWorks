import {
  resolveTrustedDeploymentId,
  resolveTrustedOrganizationId,
  resolveTrustedSubject,
} from "../src/auth/principal-context";
import type { AuthPrincipal } from "../src/auth/auth.types";
import { EntitlementException } from "../src/common/errors";

function user(org?: string | null): AuthPrincipal {
  return {
    subjectId: "user_1",
    kind: "user",
    scopes: [],
    organizationId: org ?? null,
  };
}

function service(): AuthPrincipal {
  return {
    subjectId: "service:internal",
    kind: "service",
    scopes: ["entitlement:admin"],
    actAsSubjectId: "user_1",
  };
}

describe("principal context trust boundary", () => {
  it("user cannot escalate organizationId via query/body", () => {
    expect(() => resolveTrustedOrganizationId(user("org_a"), "org_b")).toThrow(
      EntitlementException,
    );
    expect(resolveTrustedOrganizationId(user("org_a"), "org_a")).toBe("org_a");
    expect(resolveTrustedOrganizationId(user(null), "org_attacker")).toBeNull();
    expect(resolveTrustedOrganizationId(user("org_a"), undefined)).toBe("org_a");
  });

  it("service may pass explicit organizationId", () => {
    expect(resolveTrustedOrganizationId(service(), "org_x")).toBe("org_x");
  });

  it("user cannot inject deploymentId", () => {
    expect(() => resolveTrustedDeploymentId(user(), "dep_1")).toThrow(EntitlementException);
    expect(resolveTrustedDeploymentId(service(), "dep_1")).toBe("dep_1");
    expect(resolveTrustedDeploymentId(user(), undefined)).toBeUndefined();
  });

  it("never trusts a caller-supplied subjectId; users bind to token sub", () => {
    expect(resolveTrustedSubject(user()).subjectId).toBe("user_1");
    expect(resolveTrustedSubject(user()).subjectKind).toBe("USER");
    expect(resolveTrustedSubject(service()).subjectId).toBe("user_1");
    expect(() =>
      resolveTrustedSubject({
        subjectId: "service:internal",
        kind: "service",
        scopes: ["entitlement:admin"],
      }),
    ).toThrow(EntitlementException);
  });
});
