import { describe, expect, it, vi } from "vitest";
import {
  assertNoSecretPersistence,
  createApiClient,
  redactForLog,
} from "./api-client";

describe("API client redaction and storage", () => {
  it("redacts credential fields before any log-shaped clone", () => {
    const redacted = redactForLog({
      providerId: "mock",
      credentials: { webhookSecret: "whsec" },
      metadata: { privateKey: "pem" },
    });
    expect(redacted).toEqual({
      providerId: "mock",
      credentials: "[redacted]",
      metadata: { privateKey: "[redacted]" },
    });
  });

  it("does not persist secrets in localStorage", () => {
    const store = new Map<string, string>();
    const storage = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    } as Storage;
    storage.setItem("theme", "dark");
    expect(() => assertNoSecretPersistence(storage)).not.toThrow();
    storage.setItem(
      "providerCredentials",
      JSON.stringify({ webhookSecret: "x" }),
    );
    expect(() => assertNoSecretPersistence(storage)).toThrow(
      /must not be persisted/,
    );
  });

  it("calls reauth on 401 and surfaces 402 vs 403 codes", async () => {
    const unauthorized = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("orders")) {
        return new Response(
          JSON.stringify({ error: { code: "UNAUTHORIZED", message: "no" } }),
          { status: 401 },
        );
      }
      if (String(url).includes("quota")) {
        return new Response(
          JSON.stringify({ error: { code: "ENTITLEMENT_QUOTA_EXCEEDED" } }),
          { status: 402 },
        );
      }
      return new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), {
        status: 403,
      });
    });
    const api = createApiClient({
      baseUrl: "http://entitlement.example",
      tokens: { getAccessToken: () => "t", onUnauthorized: unauthorized },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(api.get("/v1/admin/payments/orders")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(unauthorized).toHaveBeenCalledOnce();
    await expect(api.get("/v1/quota")).rejects.toMatchObject({
      status: 402,
      code: "ENTITLEMENT_QUOTA_EXCEEDED",
    });
    await expect(api.get("/v1/admin")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});
