import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHostedSaasAcceptance } from "./hosted-saas-acceptance.mjs";

test("hosted SaaS acceptance contracts hold on this tree", () => {
  const { issues } = checkHostedSaasAcceptance();
  const errors = issues.filter((item) => item.severity === "error");
  assert.deepEqual(
    errors,
    [],
    errors.map((item) => `${item.code}:${item.target}`).join("\n"),
  );
});

test("VistaCast and SyncroBrain stay unsellable in the seed catalog", () => {
  const { issues } = checkHostedSaasAcceptance();
  assert.equal(
    issues.some((item) => item.code === "vistacast_sellable" || item.code === "syncrobrain_sellable"),
    false,
  );
});
