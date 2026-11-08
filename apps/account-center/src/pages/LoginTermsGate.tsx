import { readLoginLegalConfigFromEnv } from "@luminaryworks/auth-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const TOS_KEY = "lw.account-center.tos.login.v1";

function publicEnv(): Record<string, string | undefined> {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
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

/**
 * Login clickwrap shows only Terms + Privacy. Platform and product detail live
 * on those two pages (and linked platform docs), not as four separate labels.
 */
export function LoginTermsCheckbox({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const links = useMemo(() => {
    const urls = readLoginLegalConfigFromEnv(publicEnv());
    return [
      { href: urls.productTermsUrl || "/legal/terms", label: t("auth.terms") },
      {
        href: urls.productPrivacyUrl || "/legal/privacy",
        label: t("auth.privacy"),
      },
    ];
  }, [t]);

  return (
    <label style={{ display: "block", fontSize: 13, lineHeight: 1.5 }}>
      <input
        type="checkbox"
        checked={accepted}
        onChange={(event) => onChange(event.target.checked)}
        style={{ marginRight: 8 }}
      />
      {t("auth.termsLead")}{" "}
      {links.map((link, index) => (
        <span key={link.href}>
          {index > 0 ? ` ${t("auth.termsAnd")} ` : null}
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </span>
      ))}
    </label>
  );
}
