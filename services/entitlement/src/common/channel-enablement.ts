export type ChannelEnablementBlocker =
  | "test_required"
  | "fingerprint_mismatch"
  | "environment_mismatch";

export type ChannelEnablementInput = {
  lastTestOk: boolean | null;
  lastTestFingerprint: string;
  credentialFingerprint: string;
  lastTestEnvironment: string | null;
  environment: string;
};

/** Enable is allowed only when the latest successful test matches the current credentials and environment. */
export function channelEnablementBlocker(
  input: ChannelEnablementInput,
): ChannelEnablementBlocker | null {
  if (input.lastTestOk !== true) return "test_required";
  if (!input.lastTestFingerprint || input.lastTestFingerprint !== input.credentialFingerprint) {
    return "fingerprint_mismatch";
  }
  if (!input.lastTestEnvironment || input.lastTestEnvironment !== input.environment) {
    return "environment_mismatch";
  }
  return null;
}
