#!/usr/bin/env node
/**
 * Hosted SaaS / single-VPS production acceptance (static contracts).
 *
 *   node scripts/preflight-hosted-saas.mjs
 *
 * Does not start containers. Pair with:
 *   pnpm preflight:control-plane --stage production --strict
 *   pnpm preflight:object-storage
 * and the live drills in deploy/HOSTED-SAAS.md.
 */
import { checkHostedSaasAcceptance, formatHostedSaasIssues } from "./lib/hosted-saas-acceptance.mjs";

const { issues } = checkHostedSaasAcceptance();
const errors = issues.filter((item) => item.severity === "error");
const warnings = issues.filter((item) => item.severity === "warning");
if (issues.length) {
  console.log(formatHostedSaasIssues(issues));
}
console.log(`[preflight-hosted-saas] ${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) process.exit(1);
console.log("[preflight-hosted-saas] OK");
