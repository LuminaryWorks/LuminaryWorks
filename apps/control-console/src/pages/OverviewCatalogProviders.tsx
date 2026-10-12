import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { requestConfirm } from "../components/ConfirmDialog";
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

  const paymentsOff = runtime.paymentsMode === "disabled";
  return (
    <section>
      <PageHeader
        title={t("overview.title")}
        lead={t("app.subtitle")}
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      <ErrorBanner error={error} />
      {paymentsOff ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("overview.paymentsDisabled")}
        />
      ) : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card
            title={t("overview.service")}
            extra={
              <Tag color={ready ? "success" : "default"}>
                {ready ? t("overview.ready") : t("common.loading")}
              </Tag>
            }
          >
            <p>{String(version?.service ?? runtime.audience)}</p>
            <Typography.Paragraph type="secondary">
              {t("overview.identityBoundary")}
            </Typography.Paragraph>
          </Card>
        </Col>
        {paymentsOff ? null : (
          <Col xs={24} md={6}>
            <Link to="/commerce/channels">
              <Card hoverable>
                <strong>{t("overview.addChannel")}</strong>
              </Card>
            </Link>
          </Col>
        )}
        <Col xs={24} md={6}>
          <Link to="/catalog">
            <Card hoverable>
              <strong>{t("overview.openCatalog")}</strong>
            </Card>
          </Link>
        </Col>
        {paymentsOff ? null : (
          <Col xs={24} md={6}>
            <Link to="/orders">
              <Card hoverable>
                <strong>{t("overview.openOrders")}</strong>
              </Card>
            </Link>
          </Col>
        )}
      </Row>
    </section>
  );
}

type OfferingDraft = {
  sku: string;
  productCode: string;
  planCode: string;
  interval: string;
  currency: string;
  amountMinor: number;
  market: string;
  active?: boolean;
};

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function offeringPreview(raw: string): string[] {
  try {
    const rows = JSON.parse(raw) as OfferingDraft[];
    if (!Array.isArray(rows)) return [];
    return rows.map(
      (row) =>
        `${row.sku} ${row.productCode} ${row.amountMinor} ${row.currency} ${row.market}`,
    );
  } catch {
    return [];
  }
}

function CatalogDraftEditor({
  draft,
  platformAdmin,
  onChange,
  onSave,
  onPublish,
}: {
  draft: string;
  platformAdmin: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  onPublish: () => void;
}) {
  const { t } = useTranslation();
  let rows: OfferingDraft[] = [];
  try {
    const parsed = JSON.parse(draft) as unknown;
    if (Array.isArray(parsed)) rows = parsed as OfferingDraft[];
  } catch {
    rows = [];
  }
  const write = (next: OfferingDraft[]) =>
    onChange(JSON.stringify(next, null, 2));
  return (
    <article className="panel-card section-gap">
      <h2>{t("catalog.publishPreview")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("catalog.sku")}</th>
              <th>{t("catalog.product")}</th>
              <th>{t("catalog.plan")}</th>
              <th>{t("catalog.interval")}</th>
              <th>{t("catalog.market")}</th>
              <th>{t("catalog.currency")}</th>
              <th className="num">{t("catalog.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.productCode}</td>
                <td>{row.planCode}</td>
                <td>{row.interval}</td>
                <td>{row.market}</td>
                <td>{row.currency}</td>
                <td className="num">
                  <input
                    aria-label={t("catalog.amount")}
                    type="number"
                    value={row.amountMinor}
                    onChange={(event) => {
                      const next = rows.map((item) =>
                        item.sku === row.sku
                          ? { ...item, amountMinor: Number(event.target.value) }
                          : item,
                      );
                      write(next);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-actions section-gap">
        <button type="button" className="btn" onClick={onSave}>
          {t("common.save")}
        </button>
        <button type="button" className="btn btn-primary" onClick={onPublish}>
          {t("common.publish")}
        </button>
      </div>
      {platformAdmin ? (
        <details>
          <summary>{t("catalog.advancedJson")}</summary>
          <textarea
            value={draft}
            onChange={(event) => onChange(event.target.value)}
            rows={12}
            spellCheck={false}
            aria-label={t("catalog.advancedJson")}
          />
        </details>
      ) : null}
    </article>
  );
}

export function CatalogPage({
  api,
  platformAdmin,
}: {
  api: Api;
  platformAdmin: boolean;
}) {
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
      <Form
        layout="inline"
        style={{ marginBottom: 16 }}
        onFinish={() => {
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
        <Form.Item label={t("catalog.notes")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            {t("catalog.createDraft")}
          </Button>
        </Form.Item>
      </Form>
      <Table
        rowKey={(row) => String(row.id)}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: t("common.empty") }}
        columns={[
          {
            title: t("common.version"),
            dataIndex: "version",
            render: (version) => `v${String(version ?? "")}`,
          },
          {
            title: t("common.status"),
            dataIndex: "status",
            render: (status) => {
              const value = String(status ?? "");
              return (
                <Tag color={value === "published" ? "success" : "default"}>
                  {value}
                </Tag>
              );
            },
          },
          {
            title: t("common.id"),
            dataIndex: "id",
            render: (id) => {
              const value = String(id);
              return <span title={value}>{shortId(value)}</span>;
            },
          },
          {
            title: t("common.actions"),
            render: (_, row) => {
              const id = String(row.id);
              return (
                <Space>
                  <Button
                    size="small"
                    onClick={() => void openRevision(id).catch(setError)}
                  >
                    {t("common.details")}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() =>
                      import("../lib/confirm")
                        .then(({ confirmDestructive }) =>
                          confirmDestructive(t("confirm.publish")).then(
                            (ok) => {
                              if (!ok) return;
                              return api
                                .post(
                                  `/v1/admin/catalog/revisions/${row.id}/publish`,
                                )
                                .then(load);
                            },
                          ),
                        )
                        .catch(setError)
                    }
                  >
                    {t("common.publish")}
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() =>
                      import("../lib/confirm")
                        .then(({ confirmDestructive }) =>
                          confirmDestructive(t("confirm.rollback")).then(
                            (ok) => {
                              if (!ok) return;
                              return api
                                .post(
                                  `/v1/admin/catalog/revisions/${row.id}/rollback`,
                                )
                                .then(load);
                            },
                          ),
                        )
                        .catch(setError)
                    }
                  >
                    {t("common.rollback")}
                  </Button>
                </Space>
              );
            },
          },
        ]}
      />
      {selected ? (
        <CatalogDraftEditor
          draft={draft}
          platformAdmin={platformAdmin}
          onChange={setDraft}
          onSave={() => void saveDraft().catch(setError)}
          onPublish={() =>
            void requestConfirm(t("confirm.publish"), {
              summary: offeringPreview(draft),
            })
              .then((ok) => {
                if (!ok) return;
                return api
                  .post(`/v1/admin/catalog/revisions/${selected}/publish`)
                  .then(load);
              })
              .catch(setError)
          }
        />
      ) : null}
    </section>
  );
}
