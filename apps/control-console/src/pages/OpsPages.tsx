import { ReloadOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner, PageHeader } from "../components/ErrorBanner";
import type { createApiClient } from "../lib/api-client";
import { confirmDestructive } from "../lib/confirm";
import { buildOrderTimeline } from "../lib/order-timeline";
import { collectCreemAmounts } from "../lib/payment-providers";

type Api = ReturnType<typeof createApiClient>;

function formatMinorAmount(value: number | null): string {
  if (value == null) return "—";
  return String(value);
}

function CreemMorAmountsPanel({
  detail,
}: {
  detail: {
    order?: Record<string, unknown>;
    attempts?: Record<string, unknown>[];
    refunds?: Record<string, unknown>[];
  };
}) {
  const { t } = useTranslation();
  const order = detail.order;
  const provider =
    (typeof order?.paymentProvider === "string" && order.paymentProvider) ||
    String(detail.attempts?.[0]?.provider ?? "");
  if (provider !== "creem") return null;

  const amounts = collectCreemAmounts(detail);
  const hasBreakdown =
    amounts.grossCents != null ||
    amounts.taxCents != null ||
    amounts.netCents != null;
  if (!hasBreakdown) return null;

  return (
    <div className="mor-amounts">
      <p>{t("orders.creemMorTitle")}</p>
      <p className="muted">{t("orders.creemFulfilmentNote")}</p>
      <dl>
        <div className="gross">
          <dt>{t("orders.grossAmount")}</dt>
          <dd>{formatMinorAmount(amounts.grossCents)}</dd>
        </div>
        <div>
          <dt>{t("orders.taxAmount")}</dt>
          <dd>{formatMinorAmount(amounts.taxCents)}</dd>
        </div>
        <div>
          <dt>{t("orders.netAmount")}</dt>
          <dd>{formatMinorAmount(amounts.netCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

function rowProvider(
  row: Record<string, unknown>,
  tab: "orders" | "attempts" | "refunds",
) {
  if (tab === "orders") return String(row.paymentProvider ?? "");
  if (tab === "attempts") return String(row.provider ?? "");
  return String(row.provider ?? row.paymentProvider ?? "");
}

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

  const detailProvider = useMemo(() => {
    if (!detail) return "";
    const order = detail.order as Record<string, unknown> | undefined;
    return String(order?.paymentProvider ?? "");
  }, [detail]);

  const pageCount = Math.max(1, Math.ceil(total / 20));

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
        className="toolbar"
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
              <th>{t("common.id")}</th>
              <th>{t("providers.providerId")}</th>
              <th>{t("common.status")}</th>
              <th>{t("common.details")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>{t("common.empty")}</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={String(row.id)}>
                <td className="id-cell" title={String(row.id)}>
                  {shortId(String(row.id))}
                </td>
                <td>{rowProvider(row, tab)}</td>
                <td>
                  <span className="badge">{String(row.status)}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
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
      <div className="pager">
        <span>
          {t("common.page")} {page} / {pageCount}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {t("common.previous")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("common.next")}
        </button>
      </div>
      {detail ? (
        <div className="stack section-gap">
          <article className="panel-card">
            <CreemMorAmountsPanel
              detail={{
                order: detail.order as Record<string, unknown> | undefined,
                attempts: detail.attempts as
                  | Record<string, unknown>[]
                  | undefined,
                refunds: detail.refunds as
                  | Record<string, unknown>[]
                  | undefined,
              }}
            />
            {detailProvider === "doerflow_credit" ? (
              <p className="muted">{t("orders.doerflowCreditNote")}</p>
            ) : null}
            <ol className="timeline">
              {buildOrderTimeline(detail).map((event) => (
                <li key={`${event.kind}-${event.id}`}>
                  <strong>{t(`orders.event.${event.kind}`)}</strong>{" "}
                  {event.provider} {event.status}
                  <span className="muted"> {event.at}</span>
                </li>
              ))}
            </ol>
            <details>
              <summary>{t("orders.rawPayload")}</summary>
              <pre>{JSON.stringify(detail, null, 2)}</pre>
            </details>
          </article>
          <article className="panel-card">
            <h2>{t("orders.operator")}</h2>
            <div className="create-grid">
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
                <input
                  value={ticket}
                  onChange={(e) => setTicket(e.target.value)}
                />
              </label>
              <label>
                {t("common.amount")}
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            <div className="row-actions section-gap">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const order = detail.order as { id?: string } | undefined;
                  const id = order?.id;
                  if (!id) return;
                  void confirmDestructive(t("confirm.manualConfirm"))
                    .then((ok) => {
                      if (!ok) return;
                      return api
                        .post(
                          `/v1/admin/payments/orders/${id}/manual-confirm`,
                          {
                            reason,
                            ticket,
                          },
                        )
                        .then(load);
                    })
                    .catch(setError);
                }}
              >
                {t("common.manualConfirm")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
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
                className="btn"
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
          </article>
        </div>
      ) : null}
    </section>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function objectRows(value: unknown): Record<string, unknown>[] | null {
  const list = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : null;
  if (
    !list ||
    list.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  ) {
    return null;
  }
  return list as Record<string, unknown>[];
}

function scalarColumns(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, 20)) {
    for (const [key, cell] of Object.entries(row)) {
      if (keys.includes(key)) continue;
      if (
        cell == null ||
        typeof cell === "string" ||
        typeof cell === "number" ||
        typeof cell === "boolean"
      ) {
        keys.push(key);
      }
    }
  }
  return keys.slice(0, 8);
}

function RecordBlock({ title, value }: { title: string; value: unknown }) {
  const { t } = useTranslation();
  const rows = objectRows(value);
  const columns = rows ? scalarColumns(rows) : [];
  return (
    <article className="panel-card">
      <h2>{title}</h2>
      {rows && columns.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>{t("common.empty")}</td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={String(row.id ?? index)}>
                    {columns.map((column) => (
                      <td key={column}>{String(row[column] ?? "")}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      <details>
        <summary>{t("legal.raw")}</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    </article>
  );
}

function ProbeCard({
  title,
  configured,
  result,
}: {
  title: string;
  configured: boolean;
  result: { ok: boolean; body?: unknown; error?: string } | unknown;
}) {
  const { t } = useTranslation();
  const probe = result as { ok?: boolean; error?: string } | null;
  const reachable = configured && probe?.ok === true;
  const waiting = configured && result == null;
  return (
    <article className="panel-card">
      <div className="card-head">
        <h2>{title}</h2>
        <span
          className={
            waiting
              ? "badge"
              : !configured
                ? "badge badge-warn"
                : reachable
                  ? "badge badge-on"
                  : "badge badge-off"
          }
        >
          {waiting
            ? t("common.loading")
            : !configured
              ? t("common.notConfigured")
              : reachable
                ? t("capacity.reachable")
                : t("capacity.unreachable")}
        </span>
      </div>
      {configured && result != null ? (
        <details>
          <summary>{t("legal.raw")}</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      ) : null}
    </article>
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
        className="toolbar"
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
          {t("catalog.product")}
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
              <th>{t("common.id")}</th>
              <th>{t("common.status")}</th>
              <th>{t("catalog.product")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>{t("common.empty")}</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={String(row.id)}>
                <td className="id-cell" title={String(row.id)}>
                  {shortId(String(row.id))}
                </td>
                <td>
                  <span className="badge">{String(row.status)}</span>
                </td>
                <td>{String(row.productCode ?? "")}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="btn"
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
                    className="btn btn-danger"
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
      <article className="panel-card">
        <h2>{t("legal.docs")}</h2>
        {legalDocsUrl ? (
          <a href={legalDocsUrl} rel="noreferrer" target="_blank">
            {legalDocsUrl}
          </a>
        ) : (
          <p className="muted">{t("common.notConfigured")}</p>
        )}
      </article>
      <div className="stack section-gap">
        <RecordBlock title={t("legal.acceptances")} value={acceptances} />
        <RecordBlock title={t("legal.audit")} value={audit} />
      </div>
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
        lead={t("capacity.noHa")}
        actions={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load().catch(setError)}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      <ErrorBanner error={error} />
      <div className="probe-grid">
        <ProbeCard
          title={t("capacity.entitlementReady")}
          configured
          result={entitlement ? { ok: true, body: entitlement } : null}
        />
        <ProbeCard
          title={t("capacity.doris")}
          configured={Boolean(runtime.capacity.dorisPilotUrl)}
          result={doris}
        />
        <ProbeCard
          title={t("capacity.storage")}
          configured={Boolean(runtime.capacity.objectStorageUrl)}
          result={storage}
        />
      </div>
    </section>
  );
}
