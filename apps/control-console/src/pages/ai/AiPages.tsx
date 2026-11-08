import {
  DataTable,
  ErrorBanner,
  KeyValueList,
  PageHeader,
  requestConfirm,
  type SimpleColumn,
  StatCard,
  StatusTag,
} from "@luminaryworks/ui";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import type {
  AiClient,
  AiSettings,
  DeploymentConnection,
  RateCardVersion,
  UsageReport,
  WalletView,
} from "../../lib/ai-client";
import { ConsoleApiError } from "../../lib/api-client";
import { validateRateCardDraft } from "../../lib/rate-card-draft";

const PROVIDERS = [
  "deepseek",
  "openai",
  "openai-compatible",
  "anthropic",
  "gemini",
  "doubao",
  "qwen",
  "kimi",
  "mimo",
];

const DRAFT = JSON.stringify(
  {
    id: "default",
    version: 1,
    effectiveFrom: new Date().toISOString(),
    lines: [
      {
        capability: "chat.text",
        providerType: "openai",
        model: "gpt-4o-mini",
        unit: "1k_input_tokens",
        upstreamCostMicroUsd: 1000,
        markupBps: 1500,
        fixedFeeMicro: 0,
      },
    ],
  },
  null,
  2,
);

function AiSubnav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    ["/ai", "nav.aiOverview"],
    ["/ai/connections", "nav.aiConnections"],
    ["/ai/rate-cards", "nav.aiRateCards"],
    ["/ai/wallets", "nav.aiWallets"],
    ["/ai/usage", "nav.aiUsage"],
  ] as const;
  return (
    <Space wrap style={{ marginBottom: 16 }}>
      {items.map(([to, key]) => (
        <Link
          key={to}
          to={to}
          aria-current={pathname === to ? "page" : undefined}
        >
          {pathname === to ? <strong>{t(key)}</strong> : t(key)}
        </Link>
      ))}
    </Space>
  );
}

function AiError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error instanceof ConsoleApiError && error.status === 403) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("errors.aiForbidden")}
        description={`${t("errors.code")}: ${error.code} (${error.status})`}
      />
    );
  }
  return <ErrorBanner error={error} t={(key) => t(key)} />;
}

type RateLineRow = {
  id: string;
  version: number;
  effectiveFrom: string | null;
  capability: string;
  providerType: string;
  model: string;
  unit: string;
  upstreamCostMicroUsd: number;
  markupBps: number;
  fixedFeeMicro: number;
};

function columnsFor<T extends object>(
  columns: SimpleColumn<T>[],
): SimpleColumn<T>[] {
  return columns;
}

function formatMicro(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value}%`;
}

function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

export function AiOverviewPage({ ai }: { ai: AiClient }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [connections, setConnections] = useState(0);
  const [versions, setVersions] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 86_400_000);
      const [nextSettings, nextUsage, nextConnections, nextCards] =
        await Promise.all([
          ai.settings(),
          ai.usage({ from: from.toISOString(), to: to.toISOString() }),
          ai.connections(),
          ai.rateCards(),
        ]);
      setSettings(nextSettings);
      setUsage(nextUsage);
      setConnections(nextConnections.items.length);
      setVersions(nextCards.versions.length);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [ai]);

  useEffect(() => {
    void load();
  }, [load]);

  const gates = settings?.hardeningGates;

  return (
    <section>
      <PageHeader
        title={t("ai.overviewTitle")}
        lead={t("ai.overviewLead")}
        actions={
          <Button onClick={() => void load()} loading={loading}>
            {t("common.refresh")}
          </Button>
        }
      />
      <AiSubnav />
      <AiError error={error} />
      {loading && !settings ? (
        <Typography.Text>{t("common.loading")}</Typography.Text>
      ) : null}
      {settings ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <StatCard
                label={t("ai.calls")}
                value={formatMicro(usage?.summary.calls ?? 0)}
                hint={t("ai.microHint")}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard
                label={t("ai.charged")}
                value={formatMicro(usage?.summary.chargedMicro)}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard
                label={t("ai.cost")}
                value={formatMicro(usage?.summary.upstreamCostMicroUsd)}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard
                label={t("ai.margin")}
                value={formatPercent(usage?.summary.marginPercent)}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} md={12}>
              <StatCard label={t("ai.connectionCount")} value={connections} />
            </Col>
            <Col xs={24} md={12}>
              <StatCard label={t("ai.rateCardCount")} value={versions} />
            </Col>
          </Row>
          <div style={{ marginTop: 16 }}>
            <KeyValueList
              items={[
                {
                  key: "public",
                  label: t("ai.publicApi"),
                  value: (
                    <Space>
                      <Switch
                        checked={settings.publicApiEnabled}
                        loading={saving}
                        onChange={(checked) => {
                          void (async () => {
                            const ok = await requestConfirm(
                              t(
                                checked
                                  ? "confirm.aiPublicApiOn"
                                  : "confirm.aiPublicApiOff",
                              ),
                            );
                            if (!ok) return;
                            setSaving(true);
                            try {
                              const next = await ai.setPublicApi(
                                checked,
                                t("ai.publicApi"),
                              );
                              setSettings((current) =>
                                current
                                  ? {
                                      ...current,
                                      publicApiEnabled: next.publicApiEnabled,
                                      publicApiSource:
                                        next.publicApiSource ?? "persisted",
                                    }
                                  : current,
                              );
                            } catch (err) {
                              setError(err);
                            } finally {
                              setSaving(false);
                            }
                          })();
                        }}
                      />
                      <StatusTag
                        tone={settings.publicApiEnabled ? "success" : "default"}
                      >
                        {settings.publicApiEnabled
                          ? t("ai.enabled")
                          : t("ai.disabled")}
                      </StatusTag>
                    </Space>
                  ),
                },
                {
                  key: "source",
                  label: t("ai.publicApiSource"),
                  value: t(
                    settings.publicApiSource === "persisted"
                      ? "ai.sourcePersisted"
                      : "ai.sourceEnv",
                  ),
                },
                {
                  key: "wallet",
                  label: t("ai.walletEnforce"),
                  value: (
                    <StatusTag
                      tone={settings.walletEnforce ? "processing" : "default"}
                    >
                      {settings.walletEnforce
                        ? t("ai.enabled")
                        : t("ai.disabled")}
                    </StatusTag>
                  ),
                },
              ]}
            />
          </div>
          {gates ? (
            <div style={{ marginTop: 16 }}>
              <Typography.Title level={5}>{t("ai.hardening")}</Typography.Title>
              <KeyValueList
                items={(
                  [
                    ["authn", "ai.gateAuthn", gates.authn],
                    ["entitlement", "ai.gateEntitlement", gates.entitlement],
                    ["metering", "ai.gateMetering", gates.persistentMetering],
                    ["vault", "ai.gateVault", gates.secretVault],
                    ["ready", "ai.gateReadiness", gates.readiness],
                  ] as const
                ).map(([key, label, passed]) => ({
                  key,
                  label: t(label),
                  value: (
                    <StatusTag tone={passed ? "success" : "warning"}>
                      {passed ? t("ai.gatePass") : t("ai.gateFail")}
                    </StatusTag>
                  ),
                }))}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function AiConnectionsPage({ ai }: { ai: AiClient }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [rows, setRows] = useState<DeploymentConnection[]>([]);
  const [secret, setSecret] = useState("");
  const [rotateUid, setRotateUid] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await ai.connections();
      setRows(data.items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [ai]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <PageHeader
        title={t("ai.connectionsTitle")}
        lead={t("ai.connectionsLead")}
      />
      <AiSubnav />
      <AiError error={error} />
      <Form
        layout="inline"
        style={{ marginBottom: 16 }}
        onFinish={(values: {
          providerType: string;
          displayName: string;
          model: string;
          baseUrl?: string;
          secret: string;
          purpose?: string;
        }) => {
          void (async () => {
            const ok = await requestConfirm(t("confirm.aiCreateConnection"));
            if (!ok) return;
            try {
              await ai.createConnection(values);
              await load();
            } catch (err) {
              setError(err);
            }
          })();
        }}
      >
        <Form.Item
          name="providerType"
          label={t("ai.providerType")}
          rules={[{ required: true }]}
        >
          <Select
            style={{ minWidth: 160 }}
            options={PROVIDERS.map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item
          name="displayName"
          label={t("ai.displayName")}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="model"
          label={t("ai.model")}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="baseUrl" label={t("ai.baseUrl")}>
          <Input />
        </Form.Item>
        <Form.Item name="purpose" label={t("ai.purpose")}>
          <Input />
        </Form.Item>
        <Form.Item
          name="secret"
          label={t("ai.secret")}
          rules={[{ required: true }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          {t("ai.createConnection")}
        </Button>
      </Form>
      <DataTable
        columns={columnsFor<DeploymentConnection>([
          {
            key: "displayName",
            header: t("ai.displayName"),
            render: (row) => row.displayName,
          },
          {
            key: "providerType",
            header: t("ai.providerType"),
            render: (row) => row.providerType,
          },
          { key: "model", header: t("ai.model"), render: (row) => row.model },
          {
            key: "enabled",
            header: t("common.status"),
            render: (row) => (
              <StatusTag tone={row.enabled ? "success" : "default"}>
                {row.enabled ? t("ai.enabled") : t("ai.disabled")}
              </StatusTag>
            ),
          },
          {
            key: "secret",
            header: t("ai.secret"),
            render: (row) =>
              row.hasSecret
                ? row.secretFingerprint || t("ai.hasSecret")
                : t("ai.noSecret"),
          },
          {
            key: "actions",
            header: t("common.actions"),
            render: (row) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    void (async () => {
                      const ok = await requestConfirm(
                        t(
                          row.enabled
                            ? "confirm.aiDisableConnection"
                            : "confirm.aiEnableConnection",
                        ),
                      );
                      if (!ok) return;
                      try {
                        await ai.updateConnection(row.uid, {
                          enabled: !row.enabled,
                        });
                        await load();
                      } catch (err) {
                        setError(err);
                      }
                    })();
                  }}
                >
                  {row.enabled ? t("common.disable") : t("common.enable")}
                </Button>
                <Button size="small" onClick={() => setRotateUid(row.uid)}>
                  {t("ai.rotateSecret")}
                </Button>
              </Space>
            ),
          },
        ])}
        rows={rows}
        rowKey={(row) => row.uid}
        loading={loading}
        emptyLabel={t("ai.connectionsEmpty")}
        t={(key) => t(key)}
      />
      {rotateUid ? (
        <Form
          layout="inline"
          style={{ marginTop: 16 }}
          onFinish={() => {
            void (async () => {
              const ok = await requestConfirm(t("confirm.aiRotate"));
              if (!ok) return;
              try {
                await ai.updateConnection(rotateUid, { secret });
                setSecret("");
                setRotateUid("");
                await load();
              } catch (err) {
                setError(err);
              }
            })();
          }}
        >
          <Form.Item label={t("ai.rotateHint")}>
            <Input.Password
              value={secret}
              autoComplete="new-password"
              onChange={(event) => setSecret(event.target.value)}
            />
          </Form.Item>
          <Button
            htmlType="submit"
            type="primary"
            disabled={secret.trim() === ""}
          >
            {t("ai.rotateSecret")}
          </Button>
        </Form>
      ) : null}
    </section>
  );
}

export function AiRateCardsPage({ ai }: { ai: AiClient }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [versions, setVersions] = useState<RateCardVersion[]>([]);
  const [draft, setDraft] = useState(DRAFT);
  const [draftError, setDraftError] = useState<"" | "invalid" | "version">("");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await ai.rateCards();
      setVersions(data.versions);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [ai]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines: RateLineRow[] = versions.flatMap((version) =>
    version.lines.map((line) => ({
      ...line,
      id: version.id,
      version: version.version,
      effectiveFrom: version.effectiveFrom,
    })),
  );

  return (
    <section>
      <PageHeader title={t("ai.rateCardsTitle")} lead={t("ai.rateCardsLead")} />
      <AiSubnav />
      <AiError error={error} />
      {loading ? (
        <Typography.Text>{t("common.loading")}</Typography.Text>
      ) : null}
      <DataTable
        columns={columnsFor<RateLineRow>([
          { key: "id", header: t("common.id"), render: (row) => row.id },
          {
            key: "version",
            header: t("common.version"),
            render: (row) => row.version,
          },
          {
            key: "capability",
            header: t("ai.capability"),
            render: (row) => row.capability,
          },
          {
            key: "providerType",
            header: t("ai.providerType"),
            render: (row) => row.providerType,
          },
          { key: "model", header: t("ai.model"), render: (row) => row.model },
          { key: "unit", header: t("ai.unit"), render: (row) => row.unit },
          {
            key: "upstreamCostMicroUsd",
            header: t("ai.upstreamCost"),
            render: (row) => formatMicro(row.upstreamCostMicroUsd),
          },
          {
            key: "markupBps",
            header: t("ai.markup"),
            render: (row) => row.markupBps,
          },
          {
            key: "effectiveFrom",
            header: t("ai.effectiveFrom"),
            render: (row) => row.effectiveFrom || "—",
          },
        ])}
        rows={lines}
        rowKey={(row) =>
          `${row.id}:${row.version}:${row.capability}:${row.unit}:${row.model}`
        }
        loading={loading}
        emptyLabel={t("ai.rateCardsEmpty")}
        t={(key) => t(key)}
      />
      <Typography.Paragraph type="secondary">
        {t("ai.microHint")}
      </Typography.Paragraph>
      <Form
        layout="vertical"
        onFinish={() => {
          const checked = validateRateCardDraft(
            draft,
            versions.map((version) => ({
              id: version.id,
              version: version.version,
            })),
          );
          if (!checked.ok) {
            setDraftError(checked.error);
            return;
          }
          setDraftError("");
          void (async () => {
            const ok = await requestConfirm(t("confirm.aiPublishRateCard"));
            if (!ok) return;
            try {
              await ai.publishRateCard(checked.body);
              await load();
            } catch (err) {
              setError(err);
            }
          })();
        }}
      >
        <Form.Item
          label={t("ai.rateCardJson")}
          validateStatus={draftError ? "error" : undefined}
        >
          <Input.TextArea
            rows={14}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Form.Item>
        {draftError === "invalid" ? (
          <Typography.Text type="danger">
            {t("ai.rateCardInvalid")}
          </Typography.Text>
        ) : null}
        {draftError === "version" ? (
          <Typography.Text type="danger">
            {t("ai.versionMustIncrease")}
          </Typography.Text>
        ) : null}
        <Button htmlType="submit" type="primary">
          {t("ai.publishVersion")}
        </Button>
      </Form>
    </section>
  );
}

export function AiWalletsPage({ ai }: { ai: AiClient }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [searched, setSearched] = useState(false);
  const [view, setView] = useState<WalletView | null>(null);
  const [ownerKind, setOwnerKind] = useState<"user" | "organization">("user");
  const [ownerId, setOwnerId] = useState("");

  const lookup = useCallback(async () => {
    setError(null);
    setLoading(true);
    setSearched(true);
    try {
      setView(await ai.wallets(ownerKind, ownerId.trim()));
    } catch (err) {
      setView(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [ai, ownerId, ownerKind]);

  const recon = view?.reconciliation;

  return (
    <section>
      <PageHeader title={t("ai.walletsTitle")} lead={t("ai.walletsLead")} />
      <AiSubnav />
      <AiError error={error} />
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          value={ownerKind}
          style={{ minWidth: 160 }}
          onChange={(value) => setOwnerKind(value)}
          options={[
            { value: "user", label: t("ai.ownerKindUser") },
            { value: "organization", label: t("ai.ownerKindOrg") },
          ]}
        />
        <Input
          value={ownerId}
          placeholder={t("ai.ownerId")}
          onChange={(event) => setOwnerId(event.target.value)}
          style={{ minWidth: 240 }}
        />
        <Button
          type="primary"
          onClick={() => void lookup()}
          disabled={ownerId.trim() === ""}
          loading={loading}
        >
          {t("ai.lookup")}
        </Button>
      </Space>
      {loading ? (
        <Typography.Text>{t("common.loading")}</Typography.Text>
      ) : null}
      {!loading && searched && !view?.wallet ? (
        <Typography.Paragraph>{t("ai.walletEmpty")}</Typography.Paragraph>
      ) : null}
      {view?.wallet && recon ? (
        <>
          <KeyValueList
            items={[
              { key: "id", label: t("common.id"), value: view.wallet.walletId },
              {
                key: "kind",
                label: t("ai.ownerKind"),
                value: view.wallet.ownerKind,
              },
              {
                key: "owner",
                label: t("ai.ownerId"),
                value: view.wallet.ownerId,
              },
              {
                key: "currency",
                label: t("ai.currency"),
                value: view.wallet.currency,
              },
              {
                key: "status",
                label: t("ai.walletStatus"),
                value: view.wallet.status,
              },
              {
                key: "balance",
                label: t("ai.balance"),
                value: formatMicro(recon.remainingMicro),
              },
              {
                key: "granted",
                label: t("ai.granted"),
                value: formatMicro(recon.grantedMicro),
              },
              {
                key: "holds",
                label: t("ai.activeHolds"),
                value: formatMicro(recon.activeHoldMicro),
              },
              {
                key: "settled",
                label: t("ai.settled"),
                value: formatMicro(recon.settledMicro),
              },
              {
                key: "revoked",
                label: t("ai.revoked"),
                value: formatMicro(recon.revokedMicro),
              },
              {
                key: "eq",
                label: t("ai.reconciliation"),
                value: (
                  <StatusTag tone={recon.balanced ? "success" : "error"}>
                    {recon.balanced ? t("ai.balanced") : t("ai.unbalanced")}
                  </StatusTag>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary">
            {t("ai.microHint")}
          </Typography.Paragraph>
          <DataTable
            columns={columnsFor<WalletView["grants"][number]>([
              {
                key: "sourceId",
                header: t("ai.orderId"),
                render: (row) => row.sourceId,
              },
              { key: "kind", header: t("ai.kind"), render: (row) => row.kind },
              {
                key: "amountMicro",
                header: t("ai.amountMicro"),
                render: (row) => formatMicro(row.amountMicro),
              },
              {
                key: "remainingMicro",
                header: t("ai.remaining"),
                render: (row) => formatMicro(row.remainingMicro),
              },
              {
                key: "expiresAt",
                header: t("ai.expiresAt"),
                render: (row) => row.expiresAt || "—",
              },
              {
                key: "revokedMicro",
                header: t("ai.revoked"),
                render: (row) => formatMicro(row.revokedMicro),
              },
            ])}
            rows={view.grants}
            rowKey={(row) => row.grantId}
            loading={false}
            emptyLabel={t("ai.grantsEmpty")}
            t={(key) => t(key)}
          />
        </>
      ) : null}
      <Typography.Title level={5}>{t("ai.grantTitle")}</Typography.Title>
      <Form
        layout="inline"
        onFinish={(values: {
          amountMicro: string;
          expiresAt: string;
          reason: string;
          currency?: "USD" | "CNY";
        }) => {
          void (async () => {
            const amountMicro = Number(values.amountMicro);
            if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) {
              setError(new Error(t("ai.amountMicro")));
              return;
            }
            const expires = new Date(values.expiresAt);
            if (
              Number.isNaN(expires.getTime()) ||
              values.reason.trim() === ""
            ) {
              setError(new Error(t("ai.reason")));
              return;
            }
            const ok = await requestConfirm(t("confirm.aiGrant"));
            if (!ok) return;
            try {
              await ai.grant({
                ownerKind,
                ownerId: ownerId.trim(),
                amountMicro,
                expiresAt: expires.toISOString(),
                reason: values.reason.trim(),
                currency: values.currency || "USD",
              });
              await lookup();
            } catch (err) {
              setError(err);
            }
          })();
        }}
      >
        <Form.Item
          name="amountMicro"
          label={t("ai.amountMicro")}
          rules={[{ required: true }]}
        >
          <Input inputMode="numeric" />
        </Form.Item>
        <Form.Item name="currency" label={t("ai.currency")} initialValue="USD">
          <Select
            style={{ minWidth: 100 }}
            options={[
              { value: "USD", label: "USD" },
              { value: "CNY", label: "CNY" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="expiresAt"
          label={t("ai.expiresAt")}
          rules={[{ required: true }]}
        >
          <Input type="datetime-local" />
        </Form.Item>
        <Form.Item
          name="reason"
          label={t("ai.reason")}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Button
          htmlType="submit"
          type="primary"
          disabled={ownerId.trim() === ""}
        >
          {t("ai.grantTitle")}
        </Button>
      </Form>
      <Typography.Title level={5}>{t("ai.revokeTitle")}</Typography.Title>
      <Form
        layout="inline"
        onFinish={(values: {
          orderId: string;
          reason: string;
          amountMicro?: string;
        }) => {
          void (async () => {
            if (values.reason.trim() === "" || values.orderId.trim() === "") {
              setError(new Error(t("ai.reason")));
              return;
            }
            const ok = await requestConfirm(t("confirm.aiRevoke"));
            if (!ok) return;
            const amount = values.amountMicro
              ? Number(values.amountMicro)
              : undefined;
            try {
              await ai.revoke({
                orderId: values.orderId.trim(),
                reason: values.reason.trim(),
                ...(amount !== undefined ? { amountMicro: amount } : {}),
              });
              if (ownerId.trim()) await lookup();
            } catch (err) {
              setError(err);
            }
          })();
        }}
      >
        <Form.Item
          name="orderId"
          label={t("ai.orderId")}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="amountMicro" label={t("ai.amountMicro")}>
          <Input inputMode="numeric" />
        </Form.Item>
        <Form.Item
          name="reason"
          label={t("ai.reason")}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Button htmlType="submit">{t("ai.revokeTitle")}</Button>
      </Form>
    </section>
  );
}

export function AiUsagePage({ ai }: { ai: AiClient }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [from, setFrom] = useState(() => utcDay(-7));
  const [to, setTo] = useState(() => utcDay(0));
  const [productCode, setProductCode] = useState("");
  const [report, setReport] = useState<UsageReport | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setReport(
        await ai.usage({
          from: new Date(`${from}T00:00:00.000Z`).toISOString(),
          to: new Date(`${to}T23:59:59.999Z`).toISOString(),
          ...(productCode.trim() ? { productCode: productCode.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [ai, from, productCode, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <PageHeader title={t("ai.usageTitle")} lead={t("ai.usageLead")} />
      <AiSubnav />
      <AiError error={error} />
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          type="date"
          aria-label={t("ai.from")}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          type="date"
          aria-label={t("ai.to")}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <Input
          aria-label={t("ai.productCode")}
          value={productCode}
          onChange={(event) => setProductCode(event.target.value)}
        />
        <Button type="primary" onClick={() => void load()} loading={loading}>
          {t("ai.apply")}
        </Button>
      </Space>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label={t("ai.calls")}
            value={formatMicro(report?.summary.calls)}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label={t("ai.charged")}
            value={formatMicro(report?.summary.chargedMicro)}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label={t("ai.cost")}
            value={formatMicro(report?.summary.upstreamCostMicroUsd)}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            label={t("ai.margin")}
            value={formatPercent(report?.summary.marginPercent)}
          />
        </Col>
      </Row>
      <Typography.Paragraph type="secondary">
        {t("ai.microHint")}
      </Typography.Paragraph>
      <DataTable
        columns={columnsFor<UsageReport["groups"][number]>([
          {
            key: "productCode",
            header: t("ai.productCode"),
            render: (row) => row.productCode,
          },
          {
            key: "capability",
            header: t("ai.capability"),
            render: (row) => row.capability,
          },
          {
            key: "calls",
            header: t("ai.calls"),
            render: (row) => formatMicro(row.calls),
          },
          {
            key: "chargedMicro",
            header: t("ai.charged"),
            render: (row) => formatMicro(row.chargedMicro),
          },
          {
            key: "upstreamCostMicroUsd",
            header: t("ai.cost"),
            render: (row) => formatMicro(row.upstreamCostMicroUsd),
          },
          {
            key: "marginPercent",
            header: t("ai.margin"),
            render: (row) => formatPercent(row.marginPercent),
          },
        ])}
        rows={report?.groups ?? []}
        rowKey={(row) => `${row.productCode}:${row.capability}`}
        loading={loading}
        emptyLabel={t("ai.usageEmpty")}
        t={(key) => t(key)}
      />
    </section>
  );
}
