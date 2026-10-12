import { HolderOutlined } from "@ant-design/icons";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Alert, Button, Segmented, Switch, Table } from "antd";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { requestConfirm } from "../../components/ConfirmDialog";
import { ErrorBanner, PageHeader } from "../../components/ErrorBanner";
import {
  ConsoleApiError,
  type createApiClient,
  rememberWriteOnlySecret,
} from "../../lib/api-client";
import {
  type CatalogChannelId,
  type CatalogConfig,
  type ChannelPhase,
  canSaveChannel,
  channelPhase,
  channelTag,
  credentialWriteMode,
  enableNeedsSetup,
  isCatalogChannel,
  isCheckoutChannel,
  isEnabledFlag,
  priorityForIndex,
  reorderVisibleCatalog,
  representativeConfig,
  resolveCatalogOrder,
} from "../../lib/channel-catalog";
import { rotateRequestBody } from "../../lib/channel-ops";
import {
  buildCredentialsObject,
  defaultCurrencies,
  defaultMarketScopes,
  isProviderId,
  PAYMENT_ENVIRONMENTS,
  type PaymentEnvironment,
  providerCnRestriction,
  STRUCTURED_CREDENTIAL_FIELDS,
} from "../../lib/payment-providers";

type Api = ReturnType<typeof createApiClient>;
type ConsoleRole = "platform" | "tenant";

type ProviderList = {
  items?: CatalogConfig[];
  catalogOrder?: string[];
};

function collection(role: ConsoleRole): string {
  return role === "tenant"
    ? "/v1/tenant/payments/providers"
    : "/v1/admin/payments/providers";
}

function storageKey(role: ConsoleRole): string {
  return `lw.paymentCatalogOrder.v1:${role}`;
}

function readLocalOrder(role: ConsoleRole): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(role));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}

function writeLocalOrder(role: ConsoleRole, order: readonly string[]): void {
  localStorage.setItem(storageKey(role), JSON.stringify(order));
}

function parseCsvList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function envKey(environment: string): string {
  return environment === "live" ? "providers.envLive" : "providers.envSandbox";
}

function phaseClass(phase: ChannelPhase): string {
  if (phase === "enabled" || phase === "ready") return "badge badge-on";
  if (phase === "test_failed") return "badge badge-off";
  if (phase === "needs_test" || phase === "enabled_retest")
    return "badge badge-warn";
  return "badge";
}

function phaseLabelKey(phase: ChannelPhase): string {
  switch (phase) {
    case "unconfigured":
      return "providers.statusUnconfigured";
    case "needs_test":
      return "providers.statusNeedsTest";
    case "test_failed":
      return "providers.statusTestFailed";
    case "ready":
      return "providers.statusReady";
    case "enabled":
      return "providers.enabled";
    case "enabled_retest":
      return "providers.statusEnabledRetest";
  }
}

const SortableListContext = createContext<{
  items: CatalogChannelId[];
  busy: boolean;
}>({ items: [], busy: false });

const DragHandleContext = createContext<{
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
} | null>(null);

function SortableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  const { items } = useContext(SortableListContext);
  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <tbody {...props} />
    </SortableContext>
  );
}

function SortableRow(props: HTMLAttributes<HTMLTableRowElement>) {
  const rowKey = (props as { "data-row-key"?: string })["data-row-key"] ?? "";
  const { busy } = useContext(SortableListContext);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowKey, disabled: busy || !rowKey });
  const style = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: "relative" as const, zIndex: 1 } : {}),
  };
  return (
    <DragHandleContext.Provider value={{ attributes, listeners }}>
      <tr {...props} ref={setNodeRef} style={style} />
    </DragHandleContext.Provider>
  );
}

function DragHandle() {
  const { t } = useTranslation();
  const handle = useContext(DragHandleContext);
  return (
    <button
      type="button"
      className="channel-drag"
      aria-label={t("providers.dragHandle")}
      {...handle?.attributes}
      {...handle?.listeners}
    >
      <HolderOutlined />
    </button>
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
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function savedOrder(
  catalogOrder: string[] | undefined,
  role: ConsoleRole,
): CatalogChannelId[] {
  const server = catalogOrder ?? [];
  return resolveCatalogOrder(server.length > 0 ? server : readLocalOrder(role));
}

export function ChannelsPage({ api, role }: { api: Api; role: ConsoleRole }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<CatalogConfig[]>([]);
  const [order, setOrder] = useState<CatalogChannelId[]>(() =>
    resolveCatalogOrder(null),
  );
  const [showMore, setShowMore] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    const data = await api.get<ProviderList>(collection(role));
    const nextItems = data.items ?? [];
    setItems(nextItems);
    setOrder(savedOrder(data.catalogOrder, role));
    setLoaded(true);
    return nextItems;
  }, [api, role]);

  useEffect(() => {
    let cancelled = false;
    void reload()
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const extraEnabled = order.some((providerId) => {
    if (isCheckoutChannel(providerId)) return false;
    return isEnabledFlag(representativeConfig(items, providerId)?.enabled);
  });
  const expanded = showMore ?? extraEnabled;
  const visible = expanded
    ? order
    : order.filter((providerId) => isCheckoutChannel(providerId));

  async function persistOrder(next: CatalogChannelId[]) {
    setBusy(true);
    setError(null);
    setOrder(next);
    try {
      await api.post(`${collection(role)}/reorder`, { providerIds: next });
      writeLocalOrder(role, next);
      await reload();
      setNotice(t("providers.orderSaved"));
    } catch (err) {
      if (err instanceof ConsoleApiError && err.status === 404) {
        await Promise.all(
          next.flatMap((providerId, index) =>
            items
              .filter((row) => row.providerId === providerId)
              .map((row) =>
                api.put(`${collection(role)}/${row.id}`, {
                  priority: priorityForIndex(index),
                }),
              ),
          ),
        );
        writeLocalOrder(role, next);
        setNotice(t("providers.orderSaved"));
      } else {
        setError(err);
        await reload().catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(providerId: CatalogChannelId, checked: boolean) {
    const row = representativeConfig(items, providerId);
    if (checked) {
      if (enableNeedsSetup(providerId, row) || !row) {
        navigate(`/commerce/channels/setup/${providerId}`);
        return;
      }
      const live = row.environment === "live";
      const ok = await requestConfirm(t("confirm.enable"), {
        summary: [
          `${t("providers.environment")}: ${t(envKey(String(row.environment ?? "")))}`,
          `${t("providers.lastFour")}: ${String(row.credentialLastFour ?? "—")}`,
        ],
        acknowledge: live ? t("providers.liveConfirm") : undefined,
      });
      if (!ok) return;
      await api.post(`${collection(role)}/${row.id}/enable`);
    } else if (row) {
      const ok = await requestConfirm(t("confirm.disable"));
      if (!ok) return;
      await api.post(`${collection(role)}/${row.id}/disable`);
    }
    setNotice("");
    await reload();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    const next = reorderVisibleCatalog(
      order,
      visible,
      String(event.active.id),
      String(overId),
    );
    if (next.join("|") === order.join("|")) return;
    void persistOrder(next);
  }

  return (
    <section>
      <PageHeader title={t("providers.title")} />
      <p className="channel-lede">{t("providers.catalogLede")}</p>
      <ErrorBanner error={error} />
      {notice ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={notice}
        />
      ) : null}
      {loading ? <p>{t("common.loading")}</p> : null}
      {!loading && loaded ? (
        <>
          <div className="channel-toolbar">
            <Button type="link" onClick={() => setShowMore(!expanded)}>
              {expanded
                ? t("providers.hideMore")
                : t("providers.showMore", {
                    count: order.length - visible.length,
                  })}
            </Button>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableListContext.Provider value={{ items: visible, busy }}>
              <Table
                className="channel-table"
                size="middle"
                pagination={false}
                rowKey="providerId"
                dataSource={visible.map((providerId) => ({ providerId }))}
                components={{
                  body: { wrapper: SortableBody, row: SortableRow },
                }}
                columns={[
                  {
                    title: t("providers.columns.order"),
                    width: 72,
                    render: () => <DragHandle />,
                  },
                  {
                    title: t("providers.columns.channel"),
                    render: (_, record) => (
                      <div className="channel-name">
                        <strong>
                          {t(`providers.names.${record.providerId}`)}
                        </strong>
                        <span className="muted">
                          {t(`providers.tags.${channelTag(record.providerId)}`)}
                        </span>
                      </div>
                    ),
                  },
                  {
                    title: t("providers.columns.environment"),
                    width: 120,
                    render: (_, record) => {
                      const row = representativeConfig(
                        items,
                        record.providerId,
                      );
                      if (
                        !row?.environment ||
                        channelPhase(record.providerId, row) === "unconfigured"
                      ) {
                        return (
                          <span className="muted">
                            {t("providers.statusUnconfigured")}
                          </span>
                        );
                      }
                      return t(envKey(String(row.environment)));
                    },
                  },
                  {
                    title: t("providers.columns.status"),
                    render: (_, record) => {
                      const phase = channelPhase(
                        record.providerId,
                        representativeConfig(items, record.providerId),
                      );
                      return (
                        <span className={phaseClass(phase)}>
                          {t(phaseLabelKey(phase))}
                        </span>
                      );
                    },
                  },
                  {
                    title: t("providers.columns.enable"),
                    render: (_, record) => {
                      const row = representativeConfig(
                        items,
                        record.providerId,
                      );
                      return (
                        <Switch
                          checked={isEnabledFlag(row?.enabled)}
                          aria-label={`${t("providers.columns.enable")} ${t(`providers.names.${record.providerId}`)}`}
                          disabled={busy}
                          onChange={(checked) =>
                            void toggle(record.providerId, checked).catch(
                              setError,
                            )
                          }
                        />
                      );
                    },
                  },
                  {
                    title: t("providers.columns.configure"),
                    render: (_, record) => (
                      <Link
                        className="channel-config-link"
                        to={`/commerce/channels/setup/${record.providerId}`}
                      >
                        {t("providers.configure")}
                      </Link>
                    ),
                  },
                ]}
              />
            </SortableListContext.Provider>
          </DndContext>
          <aside className="channel-extension">
            <h2>{t("providers.extensionTitle")}</h2>
            <p>{t("providers.extensionBody")}</p>
          </aside>
        </>
      ) : null}
    </section>
  );
}

export function ChannelSetupPage({
  api,
  role,
  providerId: initialProviderId,
  configId,
}: {
  api: Api;
  role: ConsoleRole;
  providerId?: string;
  configId?: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [providerId, setProviderId] = useState(initialProviderId ?? "");
  const [items, setItems] = useState<CatalogConfig[]>([]);
  const [order, setOrder] = useState<CatalogChannelId[]>(() =>
    resolveCatalogOrder(null),
  );
  const [environment, setEnvironment] = useState<PaymentEnvironment>("sandbox");
  const bootstrapped = useRef(false);
  const [merchantId, setMerchantId] = useState("");
  const [marketScopes, setMarketScopes] = useState("");
  const [currencies, setCurrencies] = useState("");
  const [instructions, setInstructions] = useState("");
  const [credentialValues, setCredentialValues] = useState<
    Record<string, string>
  >({});
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    issues: string[];
  } | null>(null);

  const reload = useCallback(async () => {
    const data = await api.get<ProviderList>(collection(role));
    let rows = data.items ?? [];
    let resolved = initialProviderId ?? "";
    if (configId) {
      let found = rows.find((row) => row.id === configId);
      if (!found) {
        found = await api.get<CatalogConfig>(`${collection(role)}/${configId}`);
        rows = [...rows, found];
      }
      resolved = String(found.providerId ?? "");
      if (
        !bootstrapped.current &&
        (found.environment === "live" || found.environment === "sandbox")
      ) {
        setEnvironment(found.environment);
      }
    }
    setItems(rows);
    setProviderId(resolved);
    setOrder(savedOrder(data.catalogOrder, role));
    if (!bootstrapped.current && !configId && isProviderId(resolved)) {
      const current = representativeConfig(rows, resolved);
      if (
        current?.environment === "live" ||
        current?.environment === "sandbox"
      ) {
        setEnvironment(current.environment);
      }
    }
    bootstrapped.current = true;
    setLoaded(true);
  }, [api, configId, initialProviderId, role]);

  useEffect(() => {
    let cancelled = false;
    void reload()
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const known = isProviderId(providerId);
  const active = known
    ? representativeConfig(
        items.filter((row) => row.environment === environment),
        providerId,
      )
    : null;
  useEffect(() => {
    if (!isProviderId(providerId)) return;
    const row = representativeConfig(
      items.filter((item) => item.environment === environment),
      providerId,
    );
    setMarketScopes(
      (row?.marketScopes?.length
        ? row.marketScopes
        : defaultMarketScopes(providerId)
      ).join(", "),
    );
    setCurrencies(
      (row?.currencies?.length
        ? row.currencies
        : defaultCurrencies(providerId)
      ).join(", "),
    );
    setMerchantId(row?.merchantId ?? "");
    const saved = row?.metadata?.instructions;
    setInstructions(typeof saved === "string" ? saved : "");
    setCredentialValues({ ...(row?.credentialPublic ?? {}) });
    setTestResult(null);
  }, [environment, items, providerId]);

  if (loading) return <p>{t("common.loading")}</p>;
  if (!loaded || !known) {
    return (
      <section>
        <Link className="back-link" to="/commerce/channels">
          {t("nav.providers")}
        </Link>
        <ErrorBanner error={error} />
      </section>
    );
  }

  const fields = STRUCTURED_CREDENTIAL_FIELDS[providerId] ?? [];
  const offline = providerId === "manual" || providerId === "contract";
  const ready = active ? !enableNeedsSetup(providerId, active) : false;
  const restriction = providerCnRestriction(providerId);
  const savedIssues = active?.lastTestIssues ?? [];
  const shownTest =
    testResult ??
    (active?.lastTestOk === null || active?.lastTestOk === undefined
      ? null
      : { ok: active.lastTestOk === true, issues: savedIssues });

  async function save() {
    if (!isProviderId(providerId)) return;
    if (offline && !instructions.trim()) {
      throw new Error(
        t("providers.missingFields", { fields: t("providers.instructions") }),
      );
    }
    const mode = credentialWriteMode(providerId, credentialValues);
    const fieldsForSave = STRUCTURED_CREDENTIAL_FIELDS[providerId] ?? [];
    const secretsTouched = fieldsForSave.some(
      (field) => field.secret && credentialValues[field.key]?.trim(),
    );
    const publicChanged = fieldsForSave.some((field) => {
      if (field.secret) return false;
      const next = credentialValues[field.key]?.trim() ?? "";
      const prev = active?.credentialPublic?.[field.key]?.trim() ?? "";
      return next !== prev;
    });
    if (!canSaveChannel(providerId, credentialValues, Boolean(active))) {
      const missing = fields
        .filter(
          (field) => !field.optional && !credentialValues[field.key]?.trim(),
        )
        .map((field) => t(field.labelKey))
        .join(", ");
      throw new Error(t("providers.missingFields", { fields: missing }));
    }
    const markets = parseCsvList(marketScopes);
    const currencyList = parseCsvList(currencies);
    if (markets.length === 0 || currencyList.length === 0) {
      throw new Error(t("providers.routingRequired"));
    }
    const metadata = offline
      ? { instructions: instructions.trim() }
      : undefined;
    const credentials =
      mode === "complete" || (active && (secretsTouched || publicChanged))
        ? buildCredentialsObject(providerId, credentialValues)
        : undefined;
    if (credentials) rememberWriteOnlySecret(credentials);
    const index = order.indexOf(providerId as CatalogChannelId);
    const priority = index >= 0 ? priorityForIndex(index) : 1000;
    let id = active?.id;
    if (!id) {
      const created = await api.post<{ id: string }>(collection(role), {
        providerId,
        environment,
        merchantId: merchantId.trim() || null,
        marketScopes: markets,
        currencies: currencyList,
        priority,
        credentials,
        metadata,
        enabled: false,
      });
      id = created.id;
    } else {
      await api.put(`${collection(role)}/${id}`, {
        environment,
        merchantId: merchantId.trim() || null,
        marketScopes: markets,
        currencies: currencyList,
        metadata,
      });
      const rotate = rotateRequestBody(credentials);
      if (rotate) {
        rememberWriteOnlySecret(rotate.credentials);
        await api.post(`${collection(role)}/${id}/rotate`, rotate);
      }
    }
    setNotice(t("providers.configSaved"));
    await reload();
  }

  return (
    <section>
      <Link className="back-link" to="/commerce/channels">
        {t("nav.providers")}
      </Link>
      <PageHeader title={t(`providers.names.${providerId}`)} />
      <p className="channel-lede">{t("providers.setupLede")}</p>
      <p className="muted">{t(`providers.hints.${providerId}`)}</p>
      {restriction ? (
        <p className="muted">
          {restriction === "crypto_cn_blocked"
            ? t("providers.cnCryptoBlocked")
            : t("providers.cnHostedBlocked")}
        </p>
      ) : null}
      <ErrorBanner error={error} />
      {notice ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={notice}
        />
      ) : null}
      <form
        className="panel-card channel-setup"
        onSubmit={(event) => {
          event.preventDefault();
          void save().catch(setError);
        }}
      >
        <Field label={t("providers.environment")} htmlFor="channel-environment">
          <Segmented
            id="channel-environment"
            className="channel-env"
            value={environment}
            aria-label={t("providers.environment")}
            onChange={(value) => setEnvironment(value as PaymentEnvironment)}
            options={PAYMENT_ENVIRONMENTS.map((item) => ({
              value: item,
              label: t(envKey(item)),
            }))}
          />
        </Field>
        <p className="muted">{t("providers.envHint")}</p>
        {offline ? (
          <Field
            label={t("providers.instructions")}
            htmlFor="channel-instructions"
          >
            <textarea
              id="channel-instructions"
              rows={5}
              maxLength={2000}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </Field>
        ) : null}
        {offline ? (
          <p className="muted">{t("providers.instructionsHint")}</p>
        ) : null}
        {active && fields.length > 0 ? (
          <p className="muted">{t("providers.credentialKept")}</p>
        ) : null}
        <div className="create-grid">
          {fields.map((field) => {
            const multiline = /privatekey|pem/i.test(field.key);
            return (
              <Field
                key={field.key}
                label={t(field.labelKey)}
                htmlFor={`channel-${field.key}`}
              >
                {multiline ? (
                  <textarea
                    id={`channel-${field.key}`}
                    rows={5}
                    value={credentialValues[field.key] ?? ""}
                    placeholder={
                      field.secret && active
                        ? t("providers.credentialKept")
                        : undefined
                    }
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setCredentialValues({
                        ...credentialValues,
                        [field.key]: event.target.value,
                      })
                    }
                  />
                ) : (
                  <input
                    id={`channel-${field.key}`}
                    type={field.secret ? "password" : "text"}
                    value={credentialValues[field.key] ?? ""}
                    placeholder={
                      field.secret && active
                        ? t("providers.credentialKept")
                        : undefined
                    }
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setCredentialValues({
                        ...credentialValues,
                        [field.key]: event.target.value,
                      })
                    }
                  />
                )}
              </Field>
            );
          })}
        </div>
        <details className="channel-routing">
          <summary>{t("providers.advancedRouting")}</summary>
          <p className="muted">{t("providers.routingEncapsulated")}</p>
          <div className="create-grid">
            <Field label={t("providers.merchantId")} htmlFor="channel-merchant">
              <input
                id="channel-merchant"
                value={merchantId}
                onChange={(event) => setMerchantId(event.target.value)}
              />
            </Field>
            <Field
              label={t("providers.marketScopes")}
              htmlFor="channel-markets"
            >
              <input
                id="channel-markets"
                value={marketScopes}
                onChange={(event) => setMarketScopes(event.target.value)}
              />
            </Field>
            <Field
              label={t("providers.currencies")}
              htmlFor="channel-currencies"
            >
              <input
                id="channel-currencies"
                value={currencies}
                onChange={(event) => setCurrencies(event.target.value)}
              />
            </Field>
          </div>
        </details>
        <div className="row-actions channel-setup-actions">
          <Button type="primary" htmlType="submit">
            {t("providers.saveConfig")}
          </Button>
        </div>
      </form>
      <div
        className={`test-result is-${shownTest ? (shownTest.ok ? "ok" : "fail") : "none"} section-gap`}
      >
        <h2>{t("providers.testResult")}</h2>
        {shownTest ? (
          <>
            <p>
              {shownTest.ok ? t("providers.testOk") : t("providers.testFailed")}
            </p>
            {shownTest.issues.length > 0 ? (
              <ul>
                {shownTest.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="muted">
            {active ? t("providers.retestRequired") : t("providers.testLocked")}
          </p>
        )}
        <div className="row-actions">
          <Button
            disabled={!active}
            onClick={() => {
              if (!active) return;
              void api
                .post<{ ok: boolean; issues: string[] }>(
                  `${collection(role)}/${active.id}/test`,
                )
                .then(async (result) => {
                  setTestResult({ ok: result.ok, issues: result.issues ?? [] });
                  setNotice(t("providers.tested"));
                  await reload();
                })
                .catch(setError);
            }}
          >
            {t("common.test")}
          </Button>
          <Button
            type="primary"
            disabled={!ready}
            onClick={() => {
              if (!active) return;
              void (async () => {
                const live = environment === "live";
                const ok = await requestConfirm(t("confirm.enable"), {
                  summary: [
                    `${t("providers.environment")}: ${t(envKey(environment))}`,
                    `${t("providers.lastFour")}: ${String(active.credentialLastFour ?? "—")}`,
                  ],
                  acknowledge: live ? t("providers.liveConfirm") : undefined,
                });
                if (!ok) return;
                await api.post(`${collection(role)}/${active.id}/enable`);
                setNotice(t("providers.enabled"));
                await reload();
              })().catch(setError);
            }}
          >
            {t("common.enable")}
          </Button>
          <Button
            danger
            disabled={!isEnabledFlag(active?.enabled)}
            onClick={() => {
              if (!active) return;
              void requestConfirm(t("confirm.disable"))
                .then(async (ok) => {
                  if (!ok) return;
                  await api.post(`${collection(role)}/${active.id}/disable`);
                  setNotice(t("providers.disabled"));
                  await reload();
                })
                .catch(setError);
            }}
          >
            {t("common.disable")}
          </Button>
        </div>
        {!ready ? (
          <p className="muted channel-enable-hint">
            {t("providers.enableNeedsSetup")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function isSetupProvider(
  value: string | undefined,
): value is CatalogChannelId {
  return Boolean(value && isCatalogChannel(value));
}
