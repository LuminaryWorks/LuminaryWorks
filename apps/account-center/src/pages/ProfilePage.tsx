import { ErrorBanner, KeyValueList, PageHeader } from "@luminaryworks/ui";
import { Card, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { IdentityProfile } from "../lib/identity";
import type { RuntimeConfig } from "../lib/runtime-config";

export function ProfilePage({
  profile,
  runtime,
}: {
  profile: IdentityProfile;
  runtime: RuntimeConfig;
}) {
  const { t } = useTranslation();
  const missing = t("profile.missing");
  return (
    <>
      <PageHeader title={t("profile.title")} />
      <Typography.Paragraph type="secondary">
        {t("profile.lead")}
      </Typography.Paragraph>
      <Card>
        <KeyValueList
          items={[
            {
              key: "sub",
              label: t("profile.sub"),
              value: profile.sub || missing,
            },
            {
              key: "email",
              label: t("profile.email"),
              value: profile.email || missing,
            },
            {
              key: "name",
              label: t("profile.name"),
              value: profile.name || missing,
            },
          ]}
        />
      </Card>
      <Card className="section-gap" title={t("profile.idpTitle")}>
        <Typography.Paragraph>{t("profile.idpLead")}</Typography.Paragraph>
        {runtime.accountUrl || runtime.securityUrl ? (
          <Space>
            {runtime.accountUrl ? (
              <a href={runtime.accountUrl} target="_blank" rel="noreferrer">
                {t("profile.accountLink")}
              </a>
            ) : null}
            {runtime.securityUrl ? (
              <a href={runtime.securityUrl} target="_blank" rel="noreferrer">
                {t("profile.securityLink")}
              </a>
            ) : null}
          </Space>
        ) : (
          <ErrorBanner
            error={new Error(t("profile.idpMissing"))}
            t={(key) => t(key)}
          />
        )}
      </Card>
    </>
  );
}
