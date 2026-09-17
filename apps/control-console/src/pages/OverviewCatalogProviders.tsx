import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner, PageHeader } from "../components/ErrorBanner";
import type { createApiClient } from "../lib/api-client";
import { rememberWriteOnlySecret } from "../lib/api-client";
import {
  buildCredentialsObject,
  capabilityKeys,
  DEFAULT_PROVIDER_CAPABILITIES,
  defaultMarketScopes,
  PAYMENT_ENVIRONMENTS,
  PAYMENT_PROVIDER_IDS,
  type ProviderCapabilities,
  type ProviderId,
  providerCnRestriction,
  STRUCTURED_CREDENTIAL_FIELDS,
} from "../lib/payment-providers";
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

function parseJsonObject(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw || "{}") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON object required");
  }
  return value as Record<string, unknown>;
}

function parseCsvList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ProviderCnBadge({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const restriction = providerCnRestriction(providerId);
  if (!restriction) return null;
  const key =
    restriction === "crypto_cn_blocked"
      ? "providers.cnCryptoBlocked"
      : "providers.cnHostedBlocked";
  return <span className="badge badge-warn">{t(key)}</span>;
}

function ProviderCapabilitiesList({
  capabilities,
}: {
  capabilities: ProviderCapabilities;
}) {
  const { t } = useTranslation();
  return (
    <ul className="cap-list">
      {capabilityKeys(capabilities).map((key) => (
        <li key={key}>
          <span className="badge">{t(`providers.capabilities.${key}`)}</span>
        </li>
      ))}
    </ul>
  );
}

function StructuredCredentialFields({
  providerId,
  values,
  onChange,
  idPrefix,
}: {
  providerId: ProviderId;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const fields = STRUCTURED_CREDENTIAL_FIELDS[providerId];
  if (!fields) return null;
  return (
    <>
      {fields.map((field) => (
        <Field
          key={field.key}
          label={t(field.labelKey)}
          htmlFor={`${idPrefix}-${field.key}`}
        >
          <input
            id={`${idPrefix}-${field.key}`}
            type={field.secret ? "password" : "text"}
            value={values[field.key] ?? ""}
            onChange={(event) =>
              onChange({ ...values, [field.key]: event.target.value })
            }
            autoComplete="off"
            required={!field.optional}
          />
        </Field>
      ))}
    </>
  );
}

export function ProvidersPage({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [credentialsJson, setCredentialsJson] = useState("");
  const [credentialValues, setCredentialValues] = useState<
    Record<string, string>
  >({});
  const [metadata, setMetadata] = useState("{}");
  const [providerId, setProviderId] = useState<ProviderId>("mock");
  const [environment, setEnvironment] =
    useState<(typeof PAYMENT_ENVIRONMENTS)[number]>("sandbox");
  const [merchantId, setMerchantId] = useState("");
  const [marketScopes, setMarketScopes] = useState("GLOBAL");
  const [currencies, setCurrencies] = useState("USD");
  const [priority, setPriority] = useState("10");
  const [selected, setSelected] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<Record<
    string,
    unknown
  > | null>(null);

  const structuredFields = STRUCTURED_CREDENTIAL_FIELDS[providerId];

  const load = useCallback(async () => {
    const data = await api.get<{ items: Record<string, unknown>[] }>(
      "/v1/admin/payments/providers",
    );
    setItems(data.items ?? []);
  }, [api]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  useEffect(() => {
    setMarketScopes(defaultMarketScopes(providerId).join(", "));
    if (providerId === "creem") setCurrencies("USD");
    if (providerId === "doerflow_credit") setCurrencies("USD");
  }, [providerId]);

  useEffect(() => {
    if (!selected) {
      setSelectedDetail(null);
      return;
    }
    void api
      .get<Record<string, unknown>>(`/v1/admin/payments/providers/${selected}`)
      .then((detail) => {
        setSelectedDetail(detail);
        setMetadata(JSON.stringify(detail.metadata ?? {}, null, 2));
      })
      .catch(setError);
  }, [api, selected]);

  const selectedCapabilities = useMemo(() => {
    const caps = selectedDetail?.capabilities;
    if (caps && typeof caps === "object") {
      return caps as ProviderCapabilities;
    }
    return null;
  }, [selectedDetail]);

  function resolveCredentials(): Record<string, string> | undefined {
    if (structuredFields) {
      const built = buildCredentialsObject(providerId, credentialValues);
      return Object.keys(built).length > 0 ? built : undefined;
    }
    if (!credentialsJson.trim()) return undefined;
    const parsed = parseJsonObject(credentialsJson) as Record<string, string>;
    rememberWriteOnlySecret(parsed);
    return parsed;
  }

  function resolveRotateCredentials(): Record<string, string> | undefined {
    const detailProvider = String(selectedDetail?.providerId ?? "");
    const rotateFields =
      STRUCTURED_CREDENTIAL_FIELDS[detailProvider as ProviderId];
    if (rotateFields) {
      const built = buildCredentialsObject(
        detailProvider as ProviderId,
        credentialValues,
      );
      if (Object.keys(built).length === 0) return undefined;
      rememberWriteOnlySecret(built);
      return built;
    }
    if (!credentialsJson.trim()) return undefined;
    const parsed = parseJsonObject(credentialsJson) as Record<string, string>;
    rememberWriteOnlySecret(parsed);
    return parsed;
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
            const credentials = resolveCredentials();
            const body = {
              providerId,
              environment,
              merchantId: merchantId.trim() || undefined,
              marketScopes: parseCsvList(marketScopes),
              currencies: parseCsvList(currencies),
              priority: Number(priority) || undefined,
              metadata: parseJsonObject(metadata),
              credentials,
              enabled: false,
            };
            if (credentials) rememberWriteOnlySecret(credentials);
            await api.post("/v1/admin/payments/providers", body);
            setCredentialsJson("");
            setCredentialValues({});
            await load();
          })().catch(setError);
        }}
      >
        <Field label={t("providers.providerId")} htmlFor="provider-id">
          <select
            id="provider-id"
            value={providerId}
            onChange={(event) =>
              setProviderId(event.target.value as ProviderId)
            }
          >
            {PAYMENT_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("providers.environment")}
          htmlFor="provider-environment"
        >
          <select
            id="provider-environment"
            value={environment}
            onChange={(event) =>
              setEnvironment(
                event.target.value as (typeof PAYMENT_ENVIRONMENTS)[number],
              )
            }
          >
            {PAYMENT_ENVIRONMENTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("providers.merchantId")} htmlFor="provider-merchant-id">
          <input
            id="provider-merchant-id"
            value={merchantId}
            onChange={(event) => setMerchantId(event.target.value)}
            placeholder={
              providerId === "creem"
                ? t("providers.merchantIdCreemHint")
                : undefined
            }
          />
        </Field>
        <Field
          label={t("providers.marketScopes")}
          htmlFor="provider-market-scopes"
        >
          <input
            id="provider-market-scopes"
            value={marketScopes}
            onChange={(event) => setMarketScopes(event.target.value)}
          />
        </Field>
        <p className="muted">
          <ProviderCnBadge providerId={providerId} />
        </p>
        <Field label={t("providers.currencies")} htmlFor="provider-currencies">
          <input
            id="provider-currencies"
            value={currencies}
            onChange={(event) => setCurrencies(event.target.value)}
          />
        </Field>
        <Field label={t("providers.priority")} htmlFor="provider-priority">
          <input
            id="provider-priority"
            type="number"
            min={0}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </Field>
        <div>
          <p>{t("providers.capabilitiesTitle")}</p>
          <ProviderCapabilitiesList
            capabilities={DEFAULT_PROVIDER_CAPABILITIES[providerId]}
          />
        </div>
        <Field label={t("providers.metadata")} htmlFor="provider-metadata">
          <textarea
            id="provider-metadata"
            value={metadata}
            onChange={(event) => setMetadata(event.target.value)}
            rows={4}
          />
        </Field>
        {structuredFields ? (
          <>
            <p className="muted">{t("providers.structuredCredentialsHint")}</p>
            <StructuredCredentialFields
              providerId={providerId}
              values={credentialValues}
              onChange={setCredentialValues}
              idPrefix="create"
            />
          </>
        ) : (
          <Field
            label={t("providers.credentials")}
            htmlFor="provider-credentials"
          >
            <textarea
              id="provider-credentials"
              value={credentialsJson}
              onChange={(event) => setCredentialsJson(event.target.value)}
              rows={6}
              autoComplete="off"
            />
          </Field>
        )}
        <p className="muted">{t("providers.credentialsHint")}</p>
        <button type="submit">{t("providers.create")}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>{t("providers.providerId")}</th>
              <th>{t("providers.environment")}</th>
              <th>{t("common.enable")}</th>
              <th>{t("common.status")}</th>
              <th>{t("providers.marketScopes")}</th>
              <th>{t("providers.cnMarket")}</th>
              <th>{t("providers.lastFour")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id)}</td>
                <td>{String(row.providerId)}</td>
                <td>{String(row.environment ?? "")}</td>
                <td>{String(row.enabled)}</td>
                <td>{String(row.status)}</td>
                <td>
                  {Array.isArray(row.marketScopes)
                    ? (row.marketScopes as string[]).join(", ")
                    : ""}
                </td>
                <td>
                  <ProviderCnBadge providerId={String(row.providerId)} />
                </td>
                <td>{String(row.credentialLastFour ?? "")}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(String(row.id));
                      setCredentialValues({});
                      setCredentialsJson("");
                    }}
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
      {selected && selectedDetail ? (
        <form
          className="stack"
          onSubmit={(ev) => {
            ev.preventDefault();
            void (async () => {
              await api.put(`/v1/admin/payments/providers/${selected}`, {
                metadata: parseJsonObject(metadata),
              });
              const rotateCredentials = resolveRotateCredentials();
              if (rotateCredentials) {
                const ok = await import("../lib/confirm").then(
                  ({ confirmDestructive }) =>
                    confirmDestructive(t("confirm.rotate")),
                );
                if (ok) {
                  await api.post(
                    `/v1/admin/payments/providers/${selected}/rotate`,
                    { credentials: rotateCredentials },
                  );
                }
                setCredentialsJson("");
                setCredentialValues({});
              }
              await load();
              const detail = await api.get<Record<string, unknown>>(
                `/v1/admin/payments/providers/${selected}`,
              );
              setSelectedDetail(detail);
            })().catch(setError);
          }}
        >
          <p>
            {t("common.details")}: {selected}
          </p>
          <dl className="inline">
            <div>
              <dt>{t("providers.providerId")}</dt>
              <dd>{String(selectedDetail.providerId)}</dd>
            </div>
            <div>
              <dt>{t("providers.environment")}</dt>
              <dd>{String(selectedDetail.environment ?? "")}</dd>
            </div>
            <div>
              <dt>{t("providers.merchantId")}</dt>
              <dd>{String(selectedDetail.merchantId ?? "")}</dd>
            </div>
            <div>
              <dt>{t("providers.lastFour")}</dt>
              <dd>{String(selectedDetail.credentialLastFour ?? "")}</dd>
            </div>
            <div>
              <dt>{t("providers.fingerprint")}</dt>
              <dd>{String(selectedDetail.credentialFingerprint ?? "")}</dd>
            </div>
            <div>
              <dt>{t("providers.rotatedAt")}</dt>
              <dd>{String(selectedDetail.rotatedAt ?? "")}</dd>
            </div>
          </dl>
          <ProviderCnBadge providerId={String(selectedDetail.providerId)} />
          {selectedCapabilities ? (
            <ProviderCapabilitiesList capabilities={selectedCapabilities} />
          ) : null}
          <Field
            label={t("providers.metadata")}
            htmlFor="provider-detail-metadata"
          >
            <textarea
              id="provider-detail-metadata"
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
              rows={4}
            />
          </Field>
          {STRUCTURED_CREDENTIAL_FIELDS[
            String(selectedDetail.providerId) as ProviderId
          ] ? (
            <>
              <p className="muted">{t("providers.rotateStructuredHint")}</p>
              <StructuredCredentialFields
                providerId={String(selectedDetail.providerId) as ProviderId}
                values={credentialValues}
                onChange={setCredentialValues}
                idPrefix="rotate"
              />
            </>
          ) : (
            <Field
              label={t("providers.credentials")}
              htmlFor="provider-detail-credentials"
            >
              <textarea
                id="provider-detail-credentials"
                value={credentialsJson}
                onChange={(event) => setCredentialsJson(event.target.value)}
                rows={6}
                autoComplete="off"
              />
            </Field>
          )}
          <button type="submit">{t("common.save")}</button>
        </form>
      ) : null}
    </section>
  );
}
