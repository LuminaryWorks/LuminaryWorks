import {
  DataTable,
  EmptyState,
  ErrorBanner,
  PageHeader,
  StatusTag,
} from "@luminaryworks/ui";
import { Card, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { createApiClient } from "../lib/api-client";
import type { PartnerApp } from "../lib/runtime-config";

type Api = ReturnType<typeof createApiClient>;

type PlanRow = {
  key: string;
  productCode: string;
  productName: string;
  planCode: string;
  planName: string;
};

type EntitlementRow = {
  key: string;
  productCode: string;
  effectivePlan: string;
  features: string;
};

type CatalogGroup = {
  productCode?: string;
  productName?: string;
  plans?: Array<{ code?: string; name?: string }>;
};

type Snapshot = {
  productCode?: string;
  effectivePlan?: string;
  features?: Record<string, unknown>;
};

export function BillingPage({
  entitlement,
  apps,
}: {
  entitlement: Api;
  apps: PartnerApp[];
}) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [audienceNote, setAudienceNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAudienceNote(false);
    void (async () => {
      try {
        const catalog = await entitlement.get<
          CatalogGroup[] | { items?: CatalogGroup[] }
        >("/v1/catalog/plans");
        const groups = Array.isArray(catalog) ? catalog : (catalog.items ?? []);
        const planRows: PlanRow[] = [];
        for (const group of groups) {
          const productCode = group.productCode ?? "";
          const productName = group.productName ?? productCode;
          for (const plan of group.plans ?? []) {
            planRows.push({
              key: `${productCode}:${plan.code ?? plan.name ?? planRows.length}`,
              productCode,
              productName,
              planCode: plan.code ?? "",
              planName: plan.name ?? plan.code ?? "",
            });
          }
        }
        const owned: EntitlementRow[] = [];
        let audience = false;
        for (const app of apps) {
          try {
            const snapshot = await entitlement.get<Snapshot>(
              `/v1/entitlements?productCode=${encodeURIComponent(app.code)}`,
            );
            const features = snapshot.features
              ? Object.keys(snapshot.features).join(", ")
              : "";
            owned.push({
              key: app.code,
              productCode: snapshot.productCode || app.code,
              effectivePlan: snapshot.effectivePlan || "none",
              features,
            });
          } catch (err) {
            const status = (err as { status?: number }).status;
            if (status === 401) audience = true;
            if (status === 404) continue;
            throw err;
          }
        }
        if (!cancelled) {
          setPlans(planRows);
          setEntitlements(owned);
          setAudienceNote(audience);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apps, entitlement]);

  return (
    <>
      <PageHeader title={t("billing.title")} />
      <Typography.Paragraph type="secondary">
        {t("billing.lead")}
      </Typography.Paragraph>
      <ErrorBanner error={error} t={(key) => t(key)} />
      {audienceNote ? (
        <Typography.Paragraph type="secondary">
          {t("billing.audience")}
        </Typography.Paragraph>
      ) : null}
      <Spin spinning={loading}>
        <Card title={t("billing.plans")}>
          <DataTable
            columns={[
              { key: "productName", header: t("billing.product") },
              { key: "planName", header: t("billing.plan") },
              { key: "planCode", header: t("billing.planCode") },
            ]}
            rows={plans}
            rowKey="key"
            loading={loading}
            emptyLabel={t("common.empty")}
            t={(key) => t(key)}
          />
        </Card>
        <Card className="section-gap" title={t("billing.entitlements")}>
          {apps.length === 0 ? (
            <EmptyState
              title={t("billing.noApps")}
              description={t("billing.noAppsDesc")}
            />
          ) : (
            <DataTable
              columns={[
                { key: "productCode", header: t("billing.product") },
                {
                  key: "effectivePlan",
                  header: t("billing.effectivePlan"),
                  render: (row: EntitlementRow) => (
                    <StatusTag
                      tone={
                        row.effectivePlan === "none" ? "default" : "success"
                      }
                    >
                      {row.effectivePlan}
                    </StatusTag>
                  ),
                },
                { key: "features", header: t("billing.features") },
              ]}
              rows={entitlements}
              rowKey="key"
              loading={loading}
              emptyLabel={t("common.empty")}
              t={(key) => t(key)}
            />
          )}
        </Card>
        <Unavailable
          title={t("billing.orders")}
          body={t("billing.ordersUnavailable")}
        />
        <Unavailable
          title={t("billing.invoices")}
          body={t("billing.invoicesUnavailable")}
        />
        <Unavailable
          title={t("billing.refunds")}
          body={t("billing.refundsUnavailable")}
        />
      </Spin>
    </>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <Card className="section-gap" title={title}>
      <EmptyState title={title} description={body} />
    </Card>
  );
}
