import { EmptyState, PageHeader } from "@luminaryworks/ui";
import { Card, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { PartnerApp } from "../lib/runtime-config";

export function AppsPage({ apps }: { apps: PartnerApp[] }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("apps.title")} />
      <Typography.Paragraph type="secondary">
        {t("apps.lead")}
      </Typography.Paragraph>
      {apps.length === 0 ? (
        <EmptyState title={t("apps.empty")} description={t("apps.emptyDesc")} />
      ) : (
        <div className="app-grid">
          {apps.map((app) => (
            <a key={app.code} href={app.url} target="_blank" rel="noreferrer">
              <Card hoverable title={app.name}>
                <Typography.Paragraph>{app.description}</Typography.Paragraph>
                <Typography.Text type="secondary">
                  {t("apps.partner")}
                </Typography.Text>
              </Card>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
