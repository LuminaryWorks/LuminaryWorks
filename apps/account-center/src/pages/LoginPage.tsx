import {
  HeadlessLoginPanel,
  LoginCanvas,
  type LuminaryAuthSession,
} from "@luminaryworks/auth-react";
import "@luminaryworks/auth-react/style.css";
import { LanguageMenu } from "@luminaryworks/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type AccountLocale, readAccountLocale, setLanguage } from "../i18n";
import { toIdpConfig } from "../lib/auth";
import { LOCALE_FULL_KEY, LOCALE_SHORT_KEY } from "../lib/locale-labels";
import type { RuntimeConfig } from "../lib/runtime-config";
import { PREFERRED_LOCALES } from "../preferred-locale";
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
  const [locale, setLocale] = useState(readAccountLocale);
  const { accepted, setAccepted } = useLoginTermsAccepted();
  const config = toIdpConfig(runtime, origin);
  const changeLocale = (next: AccountLocale) => {
    setLanguage(next);
    setLocale(next);
  };
  return (
    <div className="login-frame">
      <div className="login-lang">
        <LanguageMenu
          locale={locale}
          tone="onDark"
          ariaLabel={t("nav.language")}
          items={PREFERRED_LOCALES.map((code) => ({
            code,
            shortLabel: t(LOCALE_SHORT_KEY[code]),
            fullLabel: t(LOCALE_FULL_KEY[code]),
          }))}
          onChange={(code) => changeLocale(code as AccountLocale)}
        />
      </div>
      <LoginCanvas
        tone="console"
        locale={locale}
        languageLabel={t("nav.language")}
        onLocaleChange={(next) => changeLocale(next as AccountLocale)}
      >
        {config ? (
          <HeadlessLoginPanel
            key={locale}
            locale={locale}
            config={config}
            productName="LuminaryWorks Account Center"
            showSocialConnectors={false}
            socialProviders={[]}
            mode="redirect"
            returnUrl="/"
            consentOk={accepted}
            consent={
              <LoginTermsCheckbox accepted={accepted} onChange={setAccepted} />
            }
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
      </LoginCanvas>
    </div>
  );
}
