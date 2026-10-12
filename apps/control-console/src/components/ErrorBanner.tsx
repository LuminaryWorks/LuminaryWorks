import { Alert, Typography } from "antd";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ConsoleApiError } from "../lib/api-client";

const PAGE_HEADER_SLOT = "page-header-slot";

export function ErrorBanner({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const api = error instanceof ConsoleApiError ? error : null;
  const status = api?.status;
  let key = "errors.generic";
  if (status === 401) key = "errors.unauthorized";
  else if (status === 402) key = "errors.paymentRequired";
  else if (status === 403) key = "errors.forbidden";
  const detail = api
    ? `${t("errors.code")}: ${api.code} (${api.status})`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message={t(key)}
      description={detail}
    />
  );
}

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: string;
  actions?: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(document.getElementById(PAGE_HEADER_SLOT));
  }, []);
  const header = (
    <div className="page-header">
      <div className="page-heading">
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {lead ? (
          <Typography.Paragraph
            type="secondary"
            style={{ margin: "4px 0 0" }}
            ellipsis={{ rows: 2 }}
          >
            {lead}
          </Typography.Paragraph>
        ) : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
  if (!slot) return null;
  return createPortal(header, slot);
}
