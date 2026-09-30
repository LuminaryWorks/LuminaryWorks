import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { ServiceKeyGuard } from "./service-key.guard";

describe("ServiceKeyGuard", () => {
  const guard = new ServiceKeyGuard({
    getOrThrow: () => ({ serviceKey: "svc-key-0123456789" }),
  } as unknown as ConfigService);

  function context(authorization?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    } as ExecutionContext;
  }

  it("accepts the configured bearer token", () => {
    expect(guard.canActivate(context("Bearer svc-key-0123456789"))).toBe(true);
  });

  it("rejects a missing or wrong token", () => {
    expect(() => guard.canActivate(context())).toThrow();
    expect(() => guard.canActivate(context("Bearer nope"))).toThrow();
  });
});
