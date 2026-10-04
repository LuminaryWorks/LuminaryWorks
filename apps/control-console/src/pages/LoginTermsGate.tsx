import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const TOS_KEY = "lw.control-console.tos.login.v1";

function envUrl(name: string, fallback: string): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[`PUBLIC_${name}`]?.trim() || env[`VITE_${name}`]?.trim() || fallback;
}

export function useLoginTermsAccepted() {
  const [accepted, setAcceptedState] = useState(() => {
    try {
      return localStorage.getItem(TOS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setAccepted = (next: boolean) => {
    setAcceptedState(next);
    try {
      if (next) localStorage.setItem(TOS_KEY, "1");
      else localStorage.removeItem(TOS_KEY);
    } catch {
      /* private mode */
    }
  };
  return { accepted, setAccepted };
}

export function LoginTermsCheckbox({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const links = useMemo(
    () => [
      {
        href: envUrl(
          "LEGAL_PLATFORM_TERMS_URL",
          "https://luminaryworks.dev/legal/terms",
        ),
        label: t("auth.platformTerms"),
      },
      {
        href: envUrl("LEGAL_PRODUCT_TERMS_URL", "/legal/terms"),
        label: t("auth.productTerms"),
      },
      {
        href: envUrl("LEGAL_PRODUCT_PRIVACY_URL", "/legal/privacy"),
        label: t("auth.privacy"),
      },
    ],
    [t],
  );

  return (
    <label style={{ display: "block", marginTop: 12, fontSize: 13, lineHeight: 1.5 }}>
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginRight: 8 }}
      />
      {t("auth.termsLead")}{" "}
      {links.map((link, i) => (
        <span key={link.href}>
          {i > 0 ? ` ${t("auth.termsAnd")} ` : null}
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </span>
      ))}
    </label>
  );
}
