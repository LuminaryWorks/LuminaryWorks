import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyHubHttpStatus,
  collectRequiredComposeVars,
  hubMirrorImage,
  shouldPullFromHub,
} from "./docker-registry.mjs";

test("Hub /v2/ 401 means the official registry is reachable", () => {
  assert.equal(classifyHubHttpStatus(401).ok, true);
  assert.equal(classifyHubHttpStatus(200).ok, true);
  assert.equal(classifyHubHttpStatus(0).ok, false);
  assert.equal(classifyHubHttpStatus(503).ok, false);
});

test("hubMirrorImage prefixes Docker Hub refs only", () => {
  assert.equal(
    hubMirrorImage("postgres:16-alpine"),
    "docker.m.daocloud.io/library/postgres:16-alpine",
  );
  assert.equal(
    hubMirrorImage("svhd/logto:latest"),
    "docker.m.daocloud.io/svhd/logto:latest",
  );
  assert.equal(
    hubMirrorImage("ghcr.io/org/app:1"),
    "ghcr.io/org/app:1",
  );
  assert.equal(
    hubMirrorImage("docker.m.daocloud.io/library/redis:7-alpine"),
    "docker.m.daocloud.io/library/redis:7-alpine",
  );
});

test("local build tags are not pulled from Hub", () => {
  assert.equal(shouldPullFromHub("postgres:16-alpine"), true);
  assert.equal(shouldPullFromHub("luminaryworks/entitlement:local"), false);
  assert.equal(shouldPullFromHub("syncrobrain-gateway:dev"), false);
  assert.equal(shouldPullFromHub("ghcr.io/foo/bar:1"), false);
});

test("collectRequiredComposeVars only keeps ${VAR:?required} keys", () => {
  const keys = collectRequiredComposeVars(
    "image: ${POSTGRES_IMAGE:-postgres:16-alpine}\npassword: ${IDENTITY_DB_PASSWORD:?set me}\nport: ${DOERFLOW_API_PORT:-13008}\n",
  );
  assert.deepEqual(keys, ["IDENTITY_DB_PASSWORD"]);
});
