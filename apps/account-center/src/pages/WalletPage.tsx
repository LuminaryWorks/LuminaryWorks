import {
  DataTable,
  ErrorBanner,
  PageHeader,
  StatCard,
} from "@luminaryworks/ui";
import { Col, Row, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { createApiClient } from "../lib/api-client";
import { formatMicro } from "../lib/micro";

type Api = ReturnType<typeof createApiClient>;

type WalletView = {
  walletId: string;
  currency: string;
  status: string;
  remainingMicro: number;
  heldMicro: number;
  settledMicro: number;
};

type GrantView = {
  grantId: string;
  kind: string;
  remainingMicro: number;
  amountMicro: number;
  expiresAt: string | null;
  restrictProductCodes: string[] | null;
  restrictCapabilities: string[] | null;
};

type UsageView = {
  id: string;
  productCode: string;
  model: string;
  purpose: string | null;
  billed: string;
  at: string;
  chargedMicro: number | null;
};

export function WalletPage({ ai }: { ai: Api }) {
  const { t } = useTranslation();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [usage, setUsage] = useState<UsageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [balance, grantBody, usageBody] = await Promise.all([
          ai.get<WalletView>("/v1/me/wallet"),
          ai.get<{ items: GrantView[] }>("/v1/me/grants"),
          ai.get<{ items: UsageView[] }>("/v1/me/usage?limit=20"),
        ]);
        if (!cancelled) {
          setWallet(balance);
          setGrants(grantBody.items ?? []);
          setUsage(usageBody.items ?? []);
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
  }, [ai]);

  return (
    <>
      <PageHeader title={t("wallet.title")} />
      <Typography.Paragraph type="secondary">
        {t("wallet.lead")}
      </Typography.Paragraph>
      <ErrorBanner error={error} t={(key) => t(key)} />
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <StatCard
              label={t("wallet.remaining")}
              value={formatMicro(wallet?.remainingMicro)}
              hint={
                wallet ? `${wallet.currency} · ${wallet.status}` : undefined
              }
            />
          </Col>
          <Col xs={24} md={8}>
            <StatCard
              label={t("wallet.held")}
              value={formatMicro(wallet?.heldMicro)}
            />
          </Col>
          <Col xs={24} md={8}>
            <StatCard
              label={t("wallet.settled")}
              value={formatMicro(wallet?.settledMicro)}
            />
          </Col>
        </Row>
        <Typography.Title level={4} className="section-gap">
          {t("wallet.grants")}
        </Typography.Title>
        <DataTable
          columns={[
            { key: "kind", header: t("wallet.kind") },
            {
              key: "remainingMicro",
              header: t("wallet.remaining"),
              render: (row: GrantView) => formatMicro(row.remainingMicro),
            },
            {
              key: "expiresAt",
              header: t("wallet.expires"),
              render: (row: GrantView) => row.expiresAt || t("wallet.noExpiry"),
            },
            {
              key: "restrictProductCodes",
              header: t("wallet.restrictions"),
              render: (row: GrantView) => {
                const products = row.restrictProductCodes?.join(", ") || "";
                const caps = row.restrictCapabilities?.join(", ") || "";
                return (
                  [products, caps].filter(Boolean).join(" · ") ||
                  t("wallet.unrestricted")
                );
              },
            },
          ]}
          rows={grants}
          rowKey="grantId"
          loading={loading}
          emptyLabel={t("common.empty")}
          t={(key) => t(key)}
        />
        <Typography.Title level={4} className="section-gap">
          {t("wallet.usage")}
        </Typography.Title>
        <DataTable
          columns={[
            { key: "at", header: t("wallet.when") },
            { key: "productCode", header: t("billing.product") },
            { key: "model", header: t("wallet.model") },
            { key: "billed", header: t("wallet.billed") },
            {
              key: "chargedMicro",
              header: t("wallet.charged"),
              render: (row: UsageView) => formatMicro(row.chargedMicro),
            },
          ]}
          rows={usage}
          rowKey="id"
          loading={loading}
          emptyLabel={t("common.empty")}
          t={(key) => t(key)}
        />
      </Spin>
    </>
  );
}
