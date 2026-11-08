export type ProviderFormInput = {
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  secret?: string;
  enabled?: boolean;
  isDefault?: boolean;
  purpose?: string;
};

export type ProviderWritePayload = {
  ownerKind?: "user";
  ownerUid?: string;
  providerType?: string;
  displayName: string;
  baseUrl: string | null;
  model: string;
  secret?: string;
  enabled: boolean;
  isDefault: boolean;
  purpose: string;
};

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function common(values: ProviderFormInput) {
  const secret = trimmed(values.secret);
  return {
    displayName: trimmed(values.displayName),
    baseUrl: trimmed(values.baseUrl) || null,
    model: trimmed(values.model),
    enabled: values.enabled ?? true,
    isDefault: values.isDefault ?? false,
    purpose: trimmed(values.purpose) || "chat",
    ...(secret ? { secret } : {}),
  };
}

/** POST /v1/providers. The owner is always the signed-in user, never a form field. */
export function toCreateProviderPayload(
  values: ProviderFormInput,
  ownerUid: string,
): ProviderWritePayload {
  return {
    ownerKind: "user",
    ownerUid: ownerUid.trim(),
    providerType: trimmed(values.providerType),
    ...common(values),
  };
}

/** PATCH /v1/providers/:uid. An empty secret keeps the stored key. */
export function toRotateProviderPayload(
  values: ProviderFormInput,
): ProviderWritePayload {
  return common(values);
}
