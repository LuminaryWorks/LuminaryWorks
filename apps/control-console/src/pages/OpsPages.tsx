import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner, PageHeader } from "../components/ErrorBanner";
import type { createApiClient } from "../lib/api-client";
import { confirmDestructive } from "../lib/confirm";

type Api = ReturnType<typeof createApiClient>;

export function OrdersPage({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"orders" | "attempts" | "refunds">("orders");
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) q.set("status", status);
    const path =
      tab === "orders"
        ? `/v1/admin/payments/orders?${q}`
        : tab === "attempts"
          ? `/v1/admin/payments/attempts?${q}`
          : `/v1/admin/payments/refunds?${q}`;
    const data = await api.get<{
      items: Record<string, unknown>[];
      total: number;
    }>(path);
    setRows(data.items ?? []);
    setTotal(data.total ?? 0);
  }, [api, page, status, tab]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  return (
    <section>
      <PageHeader title={t("orders.title")} />
      <ErrorBanner error={error} />
      <div className="tabs" role="tablist">
        {(["orders", "attempts", "refunds"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => {
              setTab(item);
              setPage(1);
              setDetail(null);
            }}
          >
            {t(`orders.${item}`)}
          </button>
        ))}
      </div>
      <form
        className="inline"
        onSubmit={(ev) => {
          ev.preventDefault();
          setPage(1);
          void load().catch(setError);
        }}
      >
        <label>
          {t("common.status")}
          <input value={status} onChange={(e) => setStatus(e.target.value)} />
        </label>
        <button type="submit">{t("common.filter")}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>{t("common.status")}</th>
              <th>{t("common.details")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id)}</td>
                <td>{String(row.status)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      const id = String(row.id);
                      const orderId = String(row.orderId ?? row.id);
                      void api
                        .get<Record<string, unknown>>(
                          `/v1/admin/payments/orders/${orderId}`,
                        )
                        .then(setDetail)
                        .catch(setError);
                      void id;
                    }}
                  >
                    {t("common.details")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {t("common.page")} {page} / {Math.max(1, Math.ceil(total / 20))}
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ‹
        </button>
        <button type="button" onClick={() => setPage((p) => p + 1)}>
          ›
        </button>
      </p>
      {detail ? (
        <div className="stack">
          <pre>{JSON.stringify(detail, null, 2)}</pre>
          <label>
            {t("common.reason")}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <label>
            {t("common.ticket")}
            <input value={ticket} onChange={(e) => setTicket(e.target.value)} />
          </label>
          <label>
            {t("common.amount")}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="row-actions">
            <button
              type="button"
              onClick={() => {
                const order = detail.order as { id?: string } | undefined;
                const id = order?.id;
                if (!id) return;
                void confirmDestructive(t("confirm.manualConfirm"))
                  .then((ok) => {
                    if (!ok) return;
                    return api
                      .post(`/v1/admin/payments/orders/${id}/manual-confirm`, {
                        reason,
                        ticket,
                      })
                      .then(load);
                  })
                  .catch(setError);
              }}
            >
              {t("common.manualConfirm")}
            </button>
            <button
              type="button"
              onClick={() => {
                const order = detail.order as { id?: string } | undefined;
                const id = order?.id;
                if (!id) return;
                void confirmDestructive(t("confirm.refund"))
                  .then((ok) => {
                    if (!ok) return;
                    return api
                      .post(`/v1/admin/payments/orders/${id}/refund`, {
                        reason,
                        ticket,
                        amountCents: Number(amount),
                        refundIdempotencyKey: `console-${id}-${Date.now()}`,
                      })
                      .then(load);
                  })
                  .catch(setError);
              }}
            >
              {t("common.refund")}
            </button>
            <button
              type="button"
              onClick={() => {
                const attempts = (detail.attempts as { id?: string }[]) ?? [];
                const id = attempts[0]?.id;
                if (!id) return;
                void api
                  .post(`/v1/admin/payments/attempts/${id}/reconcile`)
                  .then(load)
                  .catch(setError);
              }}
            >
              {t("common.reconcile")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function CleanupPage({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [productCode, setProductCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (productCode) q.set("productCode", productCode);
    const suffix = q.toString() ? `?${q}` : "";
    const data = await api.get<
      Record<string, unknown>[] | { items: Record<string, unknown>[] }
    >(`/v1/admin/cleanup-jobs${suffix}`);
    setRows(Array.isArray(data) ? data : (data.items ?? []));
  }, [api, productCode, status]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  return (
    <section>
      <PageHeader title={t("cleanup.title")} />
      <ErrorBanner error={error} />
      <form
        className="inline"
        onSubmit={(ev) => {
          ev.preventDefault();
          void load().catch(setError);
        }}
      >
        <label>
          {t("common.status")}
          <input value={status} onChange={(e) => setStatus(e.target.value)} />
        </label>
        <label>
          productCode
          <input
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
          />
        </label>
        <button type="submit">{t("common.filter")}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>{t("common.status")}</th>
              <th>product</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id)}</td>
                <td>{String(row.status)}</td>
                <td>{String(row.productCode ?? "")}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void confirmDestructive(t("confirm.retryJob"))
                        .then((ok) => {
                          if (!ok) return;
                          return api
                            .post(`/v1/admin/cleanup-jobs/${row.id}/retry`)
                            .then(load);
                        })
                        .catch(setError)
                    }
                  >
                    {t("common.retry")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void confirmDestructive(t("confirm.cancelJob"))
                        .then((ok) => {
                          if (!ok) return;
                          return api
                            .post(`/v1/admin/cleanup-jobs/${row.id}/cancel`)
                            .then(load);
                        })
                        .catch(setError)
                    }
                  >
                    {t("common.cancel")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LegalPage({
  api,
  legalDocsUrl,
}: {
  api: Api;
  legalDocsUrl: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [acceptances, setAcceptances] = useState<unknown>([]);
  const [audit, setAudit] = useState<unknown>([]);

  useEffect(() => {
    void (async () => {
      setAcceptances(await api.get("/v1/admin/policy-acceptances"));
      setAudit(await api.get("/v1/admin/audit"));
    })().catch(setError);
  }, [api]);

  return (
    <section>
      <PageHeader title={t("legal.title")} />
      <ErrorBanner error={error} />
      <p>
        {t("legal.docs")}:{" "}
        {legalDocsUrl ? (
          <a href={legalDocsUrl} rel="noreferrer" target="_blank">
            {legalDocsUrl}
          </a>
        ) : (
          t("common.notConfigured")
        )}
      </p>
      <h2>{t("legal.acceptances")}</h2>
      <pre>{JSON.stringify(acceptances, null, 2)}</pre>
      <h2>{t("legal.audit")}</h2>
      <pre>{JSON.stringify(audit, null, 2)}</pre>
    </section>
  );
}

async function probe(
  url: string,
): Promise<{ ok: boolean; body?: unknown; error?: string }> {
  if (!url) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* text */
    }
    return { ok: res.ok, body };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function CapacityPage({
  api,
  runtime,
}: {
  api: Api;
  runtime: { capacity: { dorisPilotUrl: string; objectStorageUrl: string } };
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [entitlement, setEntitlement] = useState<unknown>(null);
  const [doris, setDoris] = useState<{
    ok: boolean;
    body?: unknown;
    error?: string;
  } | null>(null);
  const [storage, setStorage] = useState<{
    ok: boolean;
    body?: unknown;
    error?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [ready, version] = await Promise.all([
      api.get("/ready"),
      api.get("/version"),
    ]);
    setEntitlement({ ready, version });
    setDoris(
      runtime.capacity.dorisPilotUrl
        ? await probe(runtime.capacity.dorisPilotUrl)
        : { ok: false, error: "not_configured" },
    );
    setStorage(
      runtime.capacity.objectStorageUrl
        ? await probe(runtime.capacity.objectStorageUrl)
        : { ok: false, error: "not_configured" },
    );
  }, [api, runtime.capacity.dorisPilotUrl, runtime.capacity.objectStorageUrl]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  return (
    <section>
      <PageHeader
        title={t("capacity.title")}
        actions={
          <button type="button" onClick={() => void load().catch(setError)}>
            {t("common.refresh")}
          </button>
        }
      />
      <p className="muted">{t("capacity.noHa")}</p>
      <ErrorBanner error={error} />
      <h2>{t("capacity.entitlementReady")}</h2>
      <pre>{JSON.stringify(entitlement, null, 2)}</pre>
      <h2>{t("capacity.doris")}</h2>
      {runtime.capacity.dorisPilotUrl ? (
        <pre>{JSON.stringify(doris, null, 2)}</pre>
      ) : (
        <p>{t("common.notConfigured")}</p>
      )}
      <h2>{t("capacity.storage")}</h2>
      {runtime.capacity.objectStorageUrl ? (
        <pre>{JSON.stringify(storage, null, 2)}</pre>
      ) : (
        <p>{t("common.notConfigured")}</p>
      )}
    </section>
  );
}
