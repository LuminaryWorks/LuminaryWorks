import { Button, Checkbox, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type ConfirmRequest = {
  message: string;
  typed?: string;
  acknowledge?: string;
  summary?: string[];
  resolve: (ok: boolean) => void;
};

let opener: ((request: ConfirmRequest) => void) | null = null;

export function requestConfirm(
  message: string,
  options?: { typed?: string; acknowledge?: string; summary?: string[] },
): Promise<boolean> {
  if (!opener) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    opener?.({ message, ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    opener = (next) => {
      setTyped("");
      setAcknowledged(false);
      setRequest(next);
    };
    return () => {
      opener = null;
    };
  }, []);

  if (!request) return null;
  const typedOk = !request.typed || typed === request.typed;
  const ackOk = !request.acknowledge || acknowledged;
  const close = (ok: boolean) => {
    request.resolve(ok);
    setRequest(null);
  };

  return (
    <Modal
      open
      title={t("confirm.title")}
      onCancel={() => close(false)}
      footer={[
        <Button key="cancel" onClick={() => close(false)}>
          {t("common.cancel")}
        </Button>,
        <Button
          key="ok"
          danger
          type="primary"
          disabled={!typedOk || !ackOk}
          onClick={() => close(true)}
        >
          {t("common.confirm")}
        </Button>,
      ]}
    >
      <p>{request.message}</p>
      {request.summary?.length ? (
        <ul className="confirm-summary">
          {request.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {request.acknowledge ? (
        <Checkbox
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        >
          {request.acknowledge}
        </Checkbox>
      ) : null}
      {request.typed ? (
        <Input
          style={{ marginTop: 12 }}
          placeholder={request.typed}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      ) : null}
    </Modal>
  );
}
