import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePsqlScalar,
  renderCreateM2mSql,
} from "./remote-identity.mjs";

test("parsePsqlScalar skips SET ROLE chatter", () => {
  assert.equal(parsePsqlScalar("SET\nm-admin-secret\n"), "m-admin-secret");
  assert.equal(parsePsqlScalar(""), "");
});

test("renderCreateM2mSql inserts default-tenant MachineToMachine app", () => {
  const sql = renderCreateM2mSql({
    appId: "lwappid1234567890ab",
    secret: "s3cret",
    roleId: "role-1",
    roleLinkId: "lwappid1234567890abr",
  });
  assert.match(sql, /SET ROLE logto_tenant_logto_default;/);
  assert.match(sql, /'lwappid1234567890ab'/);
  assert.match(sql, /'MachineToMachine'/);
  assert.match(sql, /'role-1'/);
});
