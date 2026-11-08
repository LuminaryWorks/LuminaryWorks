import { ReloadOutlined } from "@ant-design/icons";
import { ErrorBanner, PageHeader, StatusTag } from "@luminaryworks/ui";
import { Alert, Button, Space, Table, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConsoleApiError, type createApiClient } from "../lib/api-client";
import {
  buyerErrorCode,
  discoverProductCodes,
  lifecycleEffectKey,
  lifecycleStatusKey,
  lifecycleTone,
  type ProductAdminView,
  productCodesFromPlans,
} from "../lib/product-lifecycle";
import { requestReasonConfirm } from "../lib/reason-confirm";

type Api = ReturnType<typeof createApiClient>;

type ProductRow = ProductAdminView & { missing: boolean };

function missingRow(productCode: string): ProductRow {
  return {
    productCode,
    name: productCode,
    active: false,
    sellable: false,
    status: "unknown",
    missing: true,
  };
}

export function PartnersPage({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let extra: string[] = [];
    try {
      extra = productCodesFromPlans(
        await api.get<unknown>("/v1/catalog/plans"),
      );
    } catch (err) {
      if (err instanceof ConsoleApiError && err.status === 401) throw err;
    }
    const codes = discoverProductCodes(extra);
    const loaded: ProductRow[] = [];
    let firstError: unknown = null;
    await Promise.all(
      codes.map(async (code) => {
        try {
          const view = await api.get<ProductAdminView>(
            `/v1/admin/products/${encodeURIComponent(code)}`,
          );
          loaded.push({ ...view, missing: false });
        } catch (err) {
          if (
            err instanceof ConsoleApiError &&
            (err.status === 404 || err.code === "NOT_FOUND")
          ) {
            loaded.push(missingRow(code));
            return;
          }
          if (!firstError) firstError = err;
        }
      }),
    );
    loaded.sort(
      (a, b) => codes.indexOf(a.productCode) - codes.indexOf(b.productCode),
    );
    setRows(loaded);
    if (firstError) setError(firstError);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function changeStatus(
    row: ProductRow,
    status: "active" | "suspended" | "retired",
  ) {
    const messageKey =
      status === "active"
        ? "confirm.resumeProduct"
        : status === "suspended"
          ? "confirm.suspendProduct"
          : "confirm.retireProduct";
    const destructive = status === "retired";
    const codeKey =
      status === "suspended"
        ? "partners.codeSuspended"
        : status === "retired"
          ? "partners.codeRetired"
          : null;
    const reason = await requestReasonConfirm(t(messageKey), {
      summary: [
        `${t("partners.productCode")}: ${row.productCode}`,
        codeKey ? t(codeKey) : t("partners.statusActive"),
      ],
      typed: destructive ? row.productCode : undefined,
      typedLabel: destructive
        ? t("confirm.typeProductCode", { code: row.productCode })
        : undefined,
    });
    if (!reason) return;
    setBusy(row.productCode);
    setNotice("");
    setError(null);
    try {
      await api.put(
        `/v1/admin/products/${encodeURIComponent(row.productCode)}/status`,
        { status, reason },
      );
      setNotice(t("partners.saved"));
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function forceRevoke(row: ProductRow) {
    const reason = await requestReasonConfirm(t("confirm.forceRevokeProduct"), {
      summary: [
        `${t("partners.productCode")}: ${row.productCode}`,
        t("partners.forceRevoke"),
      ],
      typed: row.productCode,
      typedLabel: t("confirm.typeProductCode", { code: row.productCode }),
    });
    if (!reason) return;
    setBusy(row.productCode);
    setNotice("");
    setError(null);
    try {
      const result = await api.post<{ ordersTouched?: number }>(
        `/v1/admin/products/${encodeURIComponent(row.productCode)}/force-revoke`,
        { reason },
      );
      setNotice(t("partners.revoked", { count: result.ordersTouched ?? 0 }));
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const suspended = rows.filter((row) => row.status === "suspended");
  const retired = rows.filter((row) => row.status === "retired");

  return (
    <section>
      <PageHeader
        title={t("partners.title")}
        lead={t("partners.lead")}
        actions={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load().catch(setError)}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("partners.operatorNote")}
      />
      <ErrorBanner error={error} t={(key) => t(key)} />
      {notice ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={notice}
        />
      ) : null}
      {suspended.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${t("partners.codeSuspended")}: ${suspended.map((row) => row.productCode).join(", ")}`}
          description={t("partners.effectSuspended")}
        />
      ) : null}
      {retired.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${t("partners.codeRetired")}: ${retired.map((row) => row.productCode).join(", ")}`}
          description={t("partners.effectRetired")}
        />
      ) : null}
      <Table<ProductRow>
        rowKey="productCode"
        loading={loading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: t("partners.empty") }}
        columns={[
          {
            title: t("partners.productCode"),
            dataIndex: "productCode",
          },
          {
            title: t("partners.name"),
            dataIndex: "name",
          },
          {
            title: t("partners.sellable"),
            dataIndex: "sellable",
            render: (sellable: boolean, row) =>
              row.missing
                ? t("partners.missing")
                : sellable
                  ? t("partners.sellableYes")
                  : t("partners.sellableNo"),
          },
          {
            title: t("common.status"),
            dataIndex: "status",
            render: (status: string) => {
              const code = buyerErrorCode(status);
              const effect = lifecycleEffectKey(status);
              return (
                <Space direction="vertical" size={0}>
                  <StatusTag tone={lifecycleTone(status)}>
                    {t(lifecycleStatusKey(status))}
                  </StatusTag>
                  {code ? (
                    <Typography.Text
                      type={status === "retired" ? "danger" : "warning"}
                    >
                      {code}
                    </Typography.Text>
                  ) : null}
                  {effect ? (
                    <Typography.Text type="secondary">
                      {t(effect)}
                    </Typography.Text>
                  ) : null}
                </Space>
              );
            },
          },
          {
            title: t("common.actions"),
            render: (_, row) => {
              if (row.missing) return null;
              const locked = busy === row.productCode;
              return (
                <Space wrap>
                  {row.status === "active" ? (
                    <Button
                      size="small"
                      danger
                      disabled={locked}
                      onClick={() => void changeStatus(row, "suspended")}
                    >
                      {t("partners.suspend")}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      disabled={locked}
                      onClick={() => void changeStatus(row, "active")}
                    >
                      {t("partners.resume")}
                    </Button>
                  )}
                  <Button
                    size="small"
                    danger
                    disabled={locked || row.status === "retired"}
                    onClick={() => void changeStatus(row, "retired")}
                  >
                    {t("partners.retire")}
                  </Button>
                  <Button
                    size="small"
                    danger
                    disabled={locked}
                    onClick={() => void forceRevoke(row)}
                  >
                    {t("partners.forceRevoke")}
                  </Button>
                </Space>
              );
            },
          },
        ]}
      />
    </section>
  );
}
