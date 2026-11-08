import { ApiOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { ModelForm, type ModelFormValues } from "@luminaryworks/ai-react";
import {
  DataTable,
  ErrorBanner,
  PageHeader,
  requestConfirm,
  StatusTag,
} from "@luminaryworks/ui";
import { Alert, Button, Form, Modal, Space, Switch } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { createApiClient } from "../lib/api-client";
import {
  toCreateProviderPayload,
  toRotateProviderPayload,
} from "../lib/provider-form";

type Api = ReturnType<typeof createApiClient>;

type ProviderRow = {
  uid: string;
  providerType: string;
  displayName: string;
  baseUrl?: string | null;
  model: string;
  secretFingerprint?: string | null;
  hasSecret: boolean;
  enabled: boolean;
  isDefault?: boolean;
  purpose?: string | null;
};

export function KeysPage({ ai, ownerUid }: { ai: Api; ownerUid: string }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ModelFormValues>();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await ai.get<{ items: ProviderRow[] }>("/v1/providers");
      setRows(body.items ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [ai]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setNotice("");
    form.resetFields();
    form.setFieldsValue({
      providerType: "deepseek",
      enabled: true,
      isDefault: false,
      purpose: "chat",
    });
    setOpen(true);
  };

  const openEdit = (row: ProviderRow) => {
    setEditing(row);
    setNotice("");
    form.setFieldsValue({
      providerType: row.providerType,
      displayName: row.displayName,
      baseUrl: row.baseUrl ?? undefined,
      model: row.model,
      enabled: row.enabled,
      isDefault: row.isDefault,
      purpose: row.purpose ?? "chat",
      secret: "",
    });
    setOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await ai.patch(
          `/v1/providers/${editing.uid}`,
          toRotateProviderPayload(values),
        );
      } else {
        await ai.post(
          "/v1/providers",
          toCreateProviderPayload(values, ownerUid),
        );
      }
      setOpen(false);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: ProviderRow, enabled: boolean) => {
    setError(null);
    try {
      await ai.patch(`/v1/providers/${row.uid}`, { enabled });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const testRow = async (row: ProviderRow) => {
    setError(null);
    setNotice("");
    try {
      const result = await ai.post<{
        ok: boolean;
        error?: { message?: string };
      }>("/v1/providers/test", { connectionUid: row.uid });
      setNotice(
        result.ok
          ? t("keys.testOk")
          : `${t("keys.testFail")} ${result.error?.message ?? ""}`.trim(),
      );
    } catch (err) {
      setError(err);
    }
  };

  const remove = async (row: ProviderRow) => {
    const ok = await requestConfirm(t("keys.deleteConfirm"), {
      typed: row.displayName || row.uid,
    });
    if (!ok) return;
    setError(null);
    try {
      await ai.delete(`/v1/providers/${row.uid}`);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <PageHeader
        title={t("keys.title")}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("keys.add")}
          </Button>
        }
      />
      <ErrorBanner error={error} t={(key) => t(key)} />
      {notice ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={notice}
        />
      ) : null}
      <DataTable
        columns={[
          { key: "displayName", header: t("ai.displayName") },
          { key: "providerType", header: t("ai.provider") },
          { key: "model", header: t("wallet.model") },
          {
            key: "hasSecret",
            header: t("keys.secret"),
            render: (row: ProviderRow) =>
              row.hasSecret
                ? row.secretFingerprint || t("keys.hasSecret")
                : t("keys.noSecret"),
          },
          {
            key: "enabled",
            header: t("ai.enabled"),
            render: (row: ProviderRow) => (
              <Switch
                checked={row.enabled}
                onChange={(next) => void toggle(row, next)}
                aria-label={t("ai.enabled")}
              />
            ),
          },
          {
            key: "uid",
            header: t("keys.actions"),
            render: (row: ProviderRow) => (
              <Space>
                <StatusTag tone={row.enabled ? "success" : "default"}>
                  {row.enabled ? t("keys.enabled") : t("keys.disabled")}
                </StatusTag>
                <Button size="small" onClick={() => openEdit(row)}>
                  {t("keys.rotate")}
                </Button>
                <Button
                  size="small"
                  icon={<ApiOutlined />}
                  onClick={() => void testRow(row)}
                >
                  {t("keys.test")}
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => void remove(row)}
                >
                  {t("keys.delete")}
                </Button>
              </Space>
            ),
          },
        ]}
        rows={rows}
        rowKey="uid"
        loading={loading}
        emptyLabel={t("keys.empty")}
        t={(key) => t(key)}
      />
      <Modal
        open={open}
        title={editing ? t("keys.rotate") : t("keys.add")}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={640}
        destroyOnHidden
      >
        <ModelForm
          form={form}
          isCreate={!editing}
          current={editing}
          vaultReady
          secretMode="rotate"
          t={(key) => t(key)}
          purposeOptions={[
            { value: "chat", label: t("keys.purposeChat") },
            { value: "stt", label: t("keys.purposeStt") },
            { value: "tts", label: t("keys.purposeTts") },
          ]}
          listModels={async (input) =>
            ai.post<{ source: "live" | "catalog"; models: string[] }>(
              "/v1/providers/models",
              {
                providerType: input.providerType,
                baseUrl: input.baseUrl,
                secret: input.secret,
                connectionUid: input.connectionUid,
                purpose: input.purpose,
              },
            )
          }
        />
      </Modal>
    </>
  );
}
