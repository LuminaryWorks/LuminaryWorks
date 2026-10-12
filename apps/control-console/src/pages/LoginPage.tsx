import {
  HeadlessLoginPanel,
  LoginCanvas,
  type LuminaryAuthSession,
} from "@luminaryworks/auth-react";
import "@luminaryworks/auth-react/style.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageMenu } from "../components/LanguageMenu";
import { type ConsoleLocale, readConsoleLocale, setLanguage } from "../i18n";
import { toIdpConfig } from "../lib/auth";
import type { RuntimeConfig } from "../lib/runtime-config";
import { LoginTermsCheckbox, useLoginTermsAccepted } from "./LoginTermsGate";

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
  const changeLocale = (next: ConsoleLocale) => {
    setLanguage(next);
    setLocale(next);
  };
  return (
    <div className="login-frame">
      <div className="login-lang">
        <LanguageMenu locale={locale} tone="onDark" onChange={changeLocale} />
      </div>
      <LoginCanvas
        tone="console"
        locale={locale}
        languageLabel={t("nav.language")}
        onLocaleChange={(next) => changeLocale(next as ConsoleLocale)}
      >
        {config ? (
          <HeadlessLoginPanel
            key={locale}
            locale={locale}
            config={config}
            productName="LuminaryWorks Control Console"
            showSocialConnectors={false}
            socialProviders={[]}
            mode="redirect"
            returnUrl="/"
            consentOk={accepted}
            consent={
              <LoginTermsCheckbox accepted={accepted} onChange={setAccepted} />
            }
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
        ) : (
          <section className="banner banner-warn" role="status">
            <strong>{t("auth.notConfigured")}</strong>
            <p>{t("auth.notConfiguredDesc")}</p>
          </section>
        )}
      </LoginCanvas>
    </div>
  );
}
