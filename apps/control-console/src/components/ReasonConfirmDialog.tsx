import { Button, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { normalizeLifecycleReason } from "../lib/product-lifecycle";
import {
  type ReasonConfirmRequest,
  settleReasonConfirm,
  subscribeReasonConfirm,
} from "../lib/reason-confirm";

/**
 * Confirm dialog that returns the reason the operator typed.
 * Shared `requestConfirm` only resolves a boolean, so it cannot send `reason`
 * to Entitlement. Retire and force-revoke also require the product code.
 */
export function ReasonConfirmHost({
  title,
  cancelLabel,
  confirmLabel,
  reasonLabel,
  reasonPlaceholder,
}: {
  title: string;
  cancelLabel: string;
  confirmLabel: string;
  reasonLabel: string;
  reasonPlaceholder: string;
}) {
  const [request, setRequest] = useState<ReasonConfirmRequest | null>(null);
  const [reason, setReason] = useState("");
  const [typedValue, setTypedValue] = useState("");

  useEffect(() => {
    return subscribeReasonConfirm((next) => {
      setReason("");
      setTypedValue("");
      setRequest(next);
    });
  }, []);

  if (!request) return null;
  const normalized = normalizeLifecycleReason(reason);
  const typedOk = !request.typed || typedValue === request.typed;
  return (
    <Modal
      open
      title={title}
      onCancel={() => settleReasonConfirm(null)}
      footer={[
        <Button key="cancel" onClick={() => settleReasonConfirm(null)}>
          {cancelLabel}
        </Button>,
        <Button
          key="ok"
          danger
          type="primary"
          disabled={!normalized || !typedOk}
          onClick={() => {
            if (!normalized || !typedOk) return;
            settleReasonConfirm(normalized);
          }}
        >
          {confirmLabel}
        </Button>,
      ]}
    >
      <p>{request.message}</p>
      {request.summary?.length ? (
        <ul>
          {request.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <label htmlFor="lifecycle-reason">{reasonLabel}</label>
      <Input.TextArea
        id="lifecycle-reason"
        style={{ marginTop: 8 }}
        rows={3}
        maxLength={512}
        value={reason}
        placeholder={reasonPlaceholder}
        onChange={(event) => setReason(event.target.value)}
      />
      {request.typed ? (
        <>
          <label
            htmlFor="lifecycle-typed"
            style={{ display: "block", marginTop: 12 }}
          >
            {request.typedLabel ?? request.typed}
          </label>
          <Input
            id="lifecycle-typed"
            style={{ marginTop: 8 }}
            autoComplete="off"
            spellCheck={false}
            placeholder={request.typed}
            value={typedValue}
            onChange={(event) => setTypedValue(event.target.value)}
          />
        </>
      ) : null}
    </Modal>
  );
}
