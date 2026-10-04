import {
  HeadlessLoginPanel,
  LoginCanvas,
  type LuminaryAuthSession,
} from "@luminaryworks/auth-react";
import "@luminaryworks/auth-react/style.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type ConsoleLocale, readConsoleLocale, setLanguage } from "../i18n";
import { LoginTermsCheckbox, useLoginTermsAccepted } from "./LoginTermsGate";
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
  const [locale, setLocale] = useState(readConsoleLocale);
  const { accepted, setAccepted } = useLoginTermsAccepted();
  const config = toIdpConfig(runtime, origin);
  return (
    <LoginCanvas
      tone="console"
      locale={locale}
      languageLabel={t("nav.language")}
      onLocaleChange={(next) => {
        const value = next as ConsoleLocale;
        setLanguage(value);
        setLocale(value);
      }}
    >
      {config ? (
        <>
          <div style={accepted ? undefined : { pointerEvents: "none", opacity: 0.55 }}>
        <HeadlessLoginPanel
          key={locale}
          locale={locale}
          config={config}
          productName="LuminaryWorks Control Console"
          showSocialConnectors={false}
          socialProviders={[]}
          mode="redirect"
          returnUrl="/"
          onOidcSession={(session) => onSession(session)}
          labels={
            locale === "en" || locale === "zh-CN"
              ? {
                  title: t("auth.title"),
                  subtitle: t("auth.subtitle"),
                }
              : undefined
          }
        />
          </div>
          <LoginTermsCheckbox accepted={accepted} onChange={setAccepted} />
        </>
      ) : (
        <section className="banner banner-warn" role="status">
          <strong>{t("auth.notConfigured")}</strong>
          <p>{t("auth.notConfiguredDesc")}</p>
        </section>
      )}
    </LoginCanvas>
  );
}
