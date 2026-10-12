const PAYMENT_MODES = ["platform", "customer_managed", "external_adapter", "disabled"];
const SECRET_KEY = /(secret|password|apiKey|privateKey|credential|masterKey)/i;

export function checkPaymentsCapability(manifest) {
  const issues = [];
  const mode = manifest?.capabilities?.payments;
  if (!PAYMENT_MODES.includes(mode)) {
    issues.push({
      level: "error",
      path: "capabilities.payments",
      message: `payments must be one of ${PAYMENT_MODES.join(", ")}`,
    });
  }
  if (manifest?.profile === "air-gapped" && mode !== "disabled") {
    issues.push({
      level: "error",
      path: "capabilities.payments",
      message: "air-gapped deployments must set payments=disabled",
    });
  }
  const serialized = JSON.stringify(manifest ?? {});
  if (SECRET_KEY.test(serialized)) {
    issues.push({
      level: "error",
      path: "manifest",
      message: "payment manifests must not carry secrets",
    });
  }
  return issues;
}
