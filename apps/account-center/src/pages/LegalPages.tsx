import { readLoginLegalConfigFromEnv } from "@luminaryworks/auth-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

function publicEnv(): Record<string, string | undefined> {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function Frame({
  title,
  body,
  platformHref,
  platformLabel,
}: {
  title: string;
  body: string;
  platformHref: string;
  platformLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <article
      style={{
        maxWidth: 720,
        margin: "32px auto",
        padding: "0 20px 64px",
        lineHeight: 1.65,
      }}
    >
      <p>
        <a href="/">{t("legal.back")}</a>
      </p>
      <h1>{title}</h1>
      <p>{body}</p>
      <h2 style={{ fontSize: "1.1rem", marginTop: 28 }}>
        {t("legal.platformHeading")}
      </h2>
      <p>{t("legal.platformBody")}</p>
      <p>
        <a href={platformHref} target="_blank" rel="noopener noreferrer">
          {platformLabel}
        </a>
      </p>
      <p>{t("legal.contact")}</p>
    </article>
  );
}

export function LegalTermsPage() {
  const { t } = useTranslation();
  const platformHref = useMemo(() => {
    const urls = readLoginLegalConfigFromEnv(publicEnv());
    return urls.platformTermsUrl || "https://luminaryworks.dev/legal/terms";
  }, []);
  return (
    <Frame
      title={t("legal.termsTitle")}
      body={t("legal.termsBody")}
      platformHref={platformHref}
      platformLabel={t("legal.platformTermsLink")}
    />
  );
}

export function LegalPrivacyPage() {
  const { t } = useTranslation();
  const platformHref = useMemo(() => {
    const urls = readLoginLegalConfigFromEnv(publicEnv());
    return urls.platformPrivacyUrl || "https://luminaryworks.dev/legal/privacy";
  }, []);
  return (
    <Frame
      title={t("legal.privacyTitle")}
      body={t("legal.privacyBody")}
      platformHref={platformHref}
      platformLabel={t("legal.platformPrivacyLink")}
    />
  );
}
