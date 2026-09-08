import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner, PageHeader } from "../components/ErrorBanner";
import type { createApiClient } from "../lib/api-client";
import type { RuntimeConfig } from "../lib/runtime-config";

type Api = ReturnType<typeof createApiClient>;

export function OverviewPage({
  api,
  runtime,
}: {
  api: Api;
  runtime: RuntimeConfig;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, r] = await Promise.all([
        api.get<Record<string, unknown>>("/version"),
        api.get<Record<string, unknown>>("/ready"),
      ]);
      setVersion(v);
      setReady(r);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <PageHeader
        title={t("overview.title")}
        actions={
          <button type="button" onClick={() => void load()}>
            {t("common.refresh")}
          </button>
        }
      />
      <ErrorBanner error={error} />
      <p>{t("app.subtitle")}</p>
      <p className="muted">{t("overview.identityBoundary")}</p>
      <h2>{t("overview.entitlement")}</h2>
      <pre>
        {JSON.stringify(
          { version, ready, audience: runtime.audience },
          null,
          2,
        )}
      </pre>
    </section>
  );
}

export function CatalogPage({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("[]");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const data = await api.get<{ items: Record<string, unknown>[] }>(
      "/v1/admin/catalog/revisions",
    );
    setItems(data.items ?? []);
  }, [api]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  async function openRevision(id: string) {
    setError(null);
    const detail = await api.get<{ offerings?: unknown[] }>(
      `/v1/admin/catalog/revisions/${id}`,
    );
    setSelected(id);
    setDraft(JSON.stringify(detail.offerings ?? [], null, 2));
  }

  async function saveDraft() {
    let offerings: unknown;
    try {
      offerings = JSON.parse(draft);
    } catch {
      setError(new Error(t("catalog.invalidJson")));
      return;
    }
    setError(null);
    await api.put(`/v1/admin/catalog/revisions/${selected}/offerings`, {
      offerings,
    });
    await load();
  }

  return (
    <section>
      <PageHeader title={t("catalog.title")} />
      <ErrorBanner error={error} />
      <form
        className="stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          void api
            .post("/v1/admin/catalog/revisions", {
              notes,
              copyFromPublished: true,
              offerings: [],
            })
            .then(() => load())
            .catch(setError);
        }}
      >
        <label>
          {t("catalog.notes")}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit">{t("catalog.createDraft")}</button>
      </form>
      <ul className="list">
        {items.map((row) => (
          <li key={String(row.id)}>
            <button
              type="button"
              onClick={() => void openRevision(String(row.id)).catch(setError)}
            >
              v{String(row.version)} {String(row.status)} {String(row.id)}
            </button>
            <button
              type="button"
              onClick={() =>
                import("../lib/confirm")
                  .then(({ confirmDestructive }) =>
                    confirmDestructive(t("confirm.publish")).then((ok) => {
                      if (!ok) return;
                      return api
                        .post(`/v1/admin/catalog/revisions/${row.id}/publish`)
                        .then(load);
                    }),
                  )
                  .catch(setError)
              }
            >
              {t("common.publish")}
            </button>
            <button
              type="button"
              onClick={() =>
                import("../lib/confirm")
                  .then(({ confirmDestructive }) =>
                    confirmDestructive(t("confirm.rollback")).then((ok) => {
                      if (!ok) return;
                      return api
                        .post(`/v1/admin/catalog/revisions/${row.id}/rollback`)
                        .then(load);
                    }),
                  )
                  .catch(setError)
              }
            >
              {t("common.rollback")}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <>
          <label>
            {t("catalog.draftJson")}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={18}
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            onClick={() => void saveDraft().catch(setError)}
          >
            {t("common.save")}
          </button>
        </>
      ) : null}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="stack">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function ProvidersPage({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [credentials, setCredentials] = useState("");
  const [metadata, setMetadata] = useState("{}");
  const [providerId, setProviderId] = useState("mock");
  const [selected, setSelected] = useState("");

  const load = useCallback(async () => {
    const data = await api.get<{ items: Record<string, unknown>[] }>(
      "/v1/admin/payments/providers",
    );
    setItems(data.items ?? []);
  }, [api]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  function parseJsonObject(raw: string): Record<string, unknown> {
    const value = JSON.parse(raw || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON object required");
    }
    return value as Record<string, unknown>;
  }

  return (
    <section>
      <PageHeader title={t("providers.title")} />
      <p className="muted">{t("providers.enabledFromApi")}</p>
      <ErrorBanner error={error} />
      <form
        className="stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          void (async () => {
            const body = {
              providerId,
              metadata: parseJsonObject(metadata),
              credentials: credentials
                ? parseJsonObject(credentials)
                : undefined,
              enabled: false,
            };
            await api.post("/v1/admin/payments/providers", body);
            setCredentials("");
            await load();
          })().catch(setError);
        }}
      >
        <Field label="providerId" htmlFor="provider-id">
          <input
            id="provider-id"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          />
        </Field>
        <Field label={t("providers.metadata")} htmlFor="provider-metadata">
          <textarea
            id="provider-metadata"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            rows={4}
          />
        </Field>
        <Field
          label={t("providers.credentials")}
          htmlFor="provider-credentials"
        >
          <textarea
            id="provider-credentials"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            rows={6}
            autoComplete="off"
          />
        </Field>
        <p className="muted">{t("providers.credentialsHint")}</p>
        <button type="submit">{t("providers.create")}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>provider</th>
              <th>enabled</th>
              <th>status</th>
              <th>fingerprint</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id)}</td>
                <td>{String(row.providerId)}</td>
                <td>{String(row.enabled)}</td>
                <td>{String(row.status)}</td>
                <td>{String(row.credentialLastFour)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => setSelected(String(row.id))}
                  >
                    {t("common.details")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void api
                        .post(`/v1/admin/payments/providers/${row.id}/test`)
                        .then(load)
                        .catch(setError)
                    }
                  >
                    {t("common.test")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      import("../lib/confirm")
                        .then(({ confirmDestructive }) =>
                          confirmDestructive(t("confirm.enable"), {
                            typed: t("confirm.typeEnable"),
                          }).then((ok) => {
                            if (!ok) return;
                            return api.post(
                              `/v1/admin/payments/providers/${row.id}/enable`,
                            );
                          }),
                        )
                        .then(load)
                        .catch(setError)
                    }
                  >
                    {t("common.enable")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      import("../lib/confirm")
                        .then(({ confirmDestructive }) =>
                          confirmDestructive(t("confirm.disable")).then(
                            (ok) => {
                              if (!ok) return;
                              return api.post(
                                `/v1/admin/payments/providers/${row.id}/disable`,
                              );
                            },
                          ),
                        )
                        .then(load)
                        .catch(setError)
                    }
                  >
                    {t("common.disable")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <form
          className="stack"
          onSubmit={(ev) => {
            ev.preventDefault();
            void (async () => {
              await api.put(`/v1/admin/payments/providers/${selected}`, {
                metadata: parseJsonObject(metadata),
              });
              if (credentials.trim()) {
                const ok = await import("../lib/confirm").then(
                  ({ confirmDestructive }) =>
                    confirmDestructive(t("confirm.rotate")),
                );
                if (ok) {
                  await api.post(
                    `/v1/admin/payments/providers/${selected}/rotate`,
                    {
                      credentials: parseJsonObject(credentials),
                    },
                  );
                }
                setCredentials("");
              }
              await load();
            })().catch(setError);
          }}
        >
          <p>
            {t("common.details")}: {selected}
          </p>
          <button type="submit">{t("common.save")}</button>
        </form>
      ) : null}
    </section>
  );
}
