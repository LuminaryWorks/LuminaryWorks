export type ApiErrorShape = {
  status: number;
  code: string;
  message: string;
};

export class ConsoleApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.status = shape.status;
    this.code = shape.code;
  }
}

const SECRET_KEY =
  /(secret|password|passwd|privateKey|credentials|apiKey|masterKey|ciphertext)/i;

export type TokenStore = {
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
};

const memorySecrets = new WeakSet<object>();

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactForLog(nested);
    }
    return out;
  }
  return value;
}

export function assertNoSecretPersistence(
  storage: Storage = globalThis.localStorage,
): void {
  if (typeof storage === "undefined" || !storage) return;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i) ?? "";
    const value = storage.getItem(key) ?? "";
    if (
      SECRET_KEY.test(key) ||
      SECRET_KEY.test(value) ||
      value.includes("lwpay1.")
    ) {
      throw new Error(
        "payment/provider secrets must not be persisted in web storage",
      );
    }
  }
}

export function rememberWriteOnlySecret(payload: object): void {
  memorySecrets.add(payload);
}

export function forgetWriteOnlySecret(payload: object): void {
  memorySecrets.delete(payload);
}

function parseError(status: number, body: unknown): ConsoleApiError {
  const err = (
    body as { error?: { code?: string; message?: string; httpStatus?: number } }
  )?.error;
  const code =
    err?.code ||
    (status === 401
      ? "UNAUTHORIZED"
      : status === 402
        ? "PAYMENT_REQUIRED"
        : status === 403
          ? "FORBIDDEN"
          : "REQUEST_FAILED");
  const message = err?.message || `HTTP ${status}`;
  return new ConsoleApiError({ status, code, message });
}

export function createApiClient(opts: {
  baseUrl: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    assertNoSecretPersistence();
    const token = opts.tokens.getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (res.status === 401) {
      opts.tokens.onUnauthorized();
      throw parseError(401, parsed);
    }
    if (!res.ok) {
      throw parseError(res.status, parsed);
    }
    return parsed as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) =>
      request<T>("POST", path, body ?? {}),
    put: <T>(path: string, body?: unknown) =>
      request<T>("PUT", path, body ?? {}),
    redactForLog,
  };
}
