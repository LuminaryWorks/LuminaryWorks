import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTROL_PLANE_PACK_IMAGES,
  dockerPlatformToPackArch,
  expandPackTargets,
  packName,
} from "./pack-release.mjs";
import { assertPackExcludesObjectStorage } from "./object-storage.mjs";

test("packName is filesystem-safe", () => {
  assert.equal(
    packName({ target: "control-plane", platform: "linux-arm64", version: "dev" }),
    "luminaryworks-control-plane-linux-arm64-dev",
  );
});

test("dockerPlatformToPackArch maps compose/buildx platforms", () => {
  assert.equal(dockerPlatformToPackArch("linux/arm64"), "linux-arm64");
  assert.equal(dockerPlatformToPackArch("linux/amd64"), "linux-amd64");
});

test("expandPackTargets keeps products independent", () => {
  assert.deepEqual(expandPackTargets("control-plane"), ["control-plane"]);
  assert.deepEqual(expandPackTargets("doerflow"), ["doerflow"]);
  assert.equal(expandPackTargets("products").length, 6);
  assert.equal(expandPackTargets("all")[0], "control-plane");
  assert.equal(expandPackTargets("all").length, 7);
  assert.deepEqual(expandPackTargets("nope"), []);
});

test("control-plane pack lists the images compose will start", () => {
  assert.ok(CONTROL_PLANE_PACK_IMAGES.includes("svhd/logto:latest"));
  assert.ok(CONTROL_PLANE_PACK_IMAGES.includes("luminaryworks/control-console:local"));
  assert.equal(assertPackExcludesObjectStorage(CONTROL_PLANE_PACK_IMAGES).ok, true);
  assert.equal(
    CONTROL_PLANE_PACK_IMAGES.some((image) => /aistor|minio\/minio/.test(image)),
    false,
  );
});
