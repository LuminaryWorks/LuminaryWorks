import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConsoleApiError } from "../lib/api-client";

export function ErrorBanner({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const api = error instanceof ConsoleApiError ? error : null;
  const status = api?.status;
  let key = "errors.generic";
  if (status === 401) key = "errors.unauthorized";
  else if (status === 402) key = "errors.paymentRequired";
  else if (status === 403) key = "errors.forbidden";
  return (
    <div className="banner banner-error" role="alert">
      <strong>{t(key)}</strong>
      {api ? (
        <span>
          {t("errors.code")}: {api.code} ({api.status})
        </span>
      ) : (
        <span>{error instanceof Error ? error.message : String(error)}</span>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <div className="page-actions">{actions}</div>
    </header>
  );
}
