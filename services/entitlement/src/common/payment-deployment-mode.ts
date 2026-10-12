export const PAYMENT_DEPLOYMENT_MODES = [
  "platform",
  "customer_managed",
  "external_adapter",
  "disabled",
] as const;

export type PaymentDeploymentMode = (typeof PAYMENT_DEPLOYMENT_MODES)[number];

export function parsePaymentDeploymentMode(raw: string | undefined | null): PaymentDeploymentMode {
  const value = String(raw ?? "").trim();
  if ((PAYMENT_DEPLOYMENT_MODES as readonly string[]).includes(value)) {
    return value as PaymentDeploymentMode;
  }
  return "platform";
}
