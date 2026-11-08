import { describe, expect, it, rstest } from "@rstest/core";
import {
  assertNoSecretPersistence,
  createApiClient,
  redactForLog,
} from "./api-client";

describe("API client", () => {
  it("redacts provider secrets", () => {
    expect(
      redactForLog({
        displayName: "OpenAI",
        secret: "sk-live",
        nested: { ciphertext: "blob" },
      }),
    ).toEqual({
      displayName: "OpenAI",
      secret: "[redacted]",
      nested: { ciphertext: "[redacted]" },
    });
  });

  it("refuses secrets in web storage", () => {
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
    storage.setItem("providerSecret", "sk-live");
    expect(() => assertNoSecretPersistence(storage)).toThrow(
      /must not be persisted/,
    );
  });

  it("reauths on AI 401 and leaves entitlement 401 to the page", async () => {
    const unauthorized = rstest.fn();
    const fetchImpl = rstest.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/v1/me/wallet") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).includes("/v1/me/wallet")) {
        return new Response(
          JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "no" } }),
          { status: 401 },
        );
      }
      return new Response(
        JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "aud" } }),
        { status: 401 },
      );
    });
    const ai = createApiClient({
      baseUrl: "https://ai.example",
      tokens: { getAccessToken: () => "t", onUnauthorized: unauthorized },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const entitlement = createApiClient({
      baseUrl: "https://entitlement.example",
      tokens: { getAccessToken: () => "t", onUnauthorized: unauthorized },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reauthOn401: false,
    });
    await expect(ai.get("/v1/me/wallet")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    expect(unauthorized).toHaveBeenCalledOnce();
    await expect(entitlement.get("/v1/entitlements")).rejects.toMatchObject({
      status: 401,
    });
    expect(unauthorized).toHaveBeenCalledOnce();
    await expect(ai.patch("/v1/me/wallet", { enabled: true })).resolves.toEqual(
      {
        ok: true,
      },
    );
  });
});
