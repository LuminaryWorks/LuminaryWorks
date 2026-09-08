import {
  HeadlessLoginPanel,
  type LuminaryAuthSession,
} from "@luminaryworks/auth-react";
import "@luminaryworks/auth-react/style.css";
import { useTranslation } from "react-i18next";
import { toIdpConfig } from "../lib/auth";
import type { RuntimeConfig } from "../lib/runtime-config";

export function LoginPage({
  runtime,
  origin,
  onSession,
}: {
  runtime: RuntimeConfig;
  origin: string;
  onSession: (session: LuminaryAuthSession) => void;
}) {
  const { t } = useTranslation();
  const config = toIdpConfig(runtime, origin);
  return (
    <main className="login-page">
      <h1>{t("auth.title")}</h1>
      <p>{t("auth.subtitle")}</p>
      <p className="muted">{t("app.notLogtoAdmin")}</p>
      {config ? (
        <HeadlessLoginPanel
          config={config}
          productName="LuminaryWorks Control Console"
          showSocialConnectors={false}
          socialProviders={[]}
          mode="redirect"
          returnUrl="/"
          onOidcSession={(session) => onSession(session)}
          labels={{
            title: t("auth.title"),
            subtitle: t("auth.subtitle"),
          }}
        />
      ) : (
        <section className="banner banner-warn" role="status">
          <strong>{t("auth.notConfigured")}</strong>
          <p>{t("auth.notConfiguredDesc")}</p>
        </section>
      )}
    </main>
  );
}
