import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __internals,
  checkComposeConfig,
  checkManifestAgainstCompose,
} from "./compose-contract.mjs";

function codes(issues) {
  return issues.map((issue) => issue.code);
}

function config(services, networks = {}) {
  return { name: "test", services, networks };
}

test("accepts a composable control-plane shaped config", () => {
  const { issues, serviceNames } = checkComposeConfig(
    config(
      {
        "identity-db": {
          image: "postgres:16-alpine",
          environment: { POSTGRES_PASSWORD: "8f2c1d9e77a4b0c3" },
          networks: { "control-data": {} },
        },
        identity: {
          image: "svhd/logto:1.25.0",
          ports: [{ host_ip: "127.0.0.1", published: "3001", target: 3001, protocol: "tcp" }],
          networks: { "control-data": {}, "control-edge": {} },
        },
      },
      { "control-data": { internal: true }, "control-edge": {} },
    ),
    { stage: "production" },
  );
  assert.deepEqual(
    issues.filter((issue) => issue.severity === "error"),
    [],
  );
  assert.deepEqual(serviceNames, ["identity-db", "identity"]);
});

test("rejects fixed container_name", () => {
  const { issues } = checkComposeConfig(
    config({ identity: { image: "svhd/logto:1.25.0", container_name: "luminary-identity" } }),
  );
  assert.ok(codes(issues).includes("fixed_container_name"));
});

test("rejects generic service names that would merge across products", () => {
  const { issues } = checkComposeConfig(config({ db: { image: "postgres:16-alpine" } }));
  assert.ok(codes(issues).includes("generic_service_name"));
});

test("rejects host.docker.internal anywhere in a service", () => {
  const { issues } = checkComposeConfig(
    config({
      "auth-gateway": {
        image: "luminaryworks/auth-gateway:0.1.0",
        environment: { UPSTREAM_ISSUER: "http://host.docker.internal:3001/oidc" },
      },
    }),
  );
  assert.ok(codes(issues).includes("host_docker_internal"));
});

test("detects host port conflicts between services", () => {
  const { issues } = checkComposeConfig(
    config({
      "code-web": {
        image: "example/code-web:1.0.0",
        ports: [{ host_ip: "127.0.0.1", published: "8080", target: 80 }],
      },
      "edu-gateway": {
        image: "example/edu-gateway:1.0.0",
        ports: [{ host_ip: "127.0.0.1", published: "8080", target: 3000 }],
      },
    }),
  );
  assert.ok(codes(issues).includes("host_port_conflict"));
});

test("rejects weak default secrets", () => {
  const { issues } = checkComposeConfig(
    config({
      entitlement: {
        image: "luminaryworks/entitlement:0.1.0",
        environment: {
          ENTITLEMENT_SERVICE_API_KEY: "dev-service-key-change-me",
          ENTITLEMENT_DB_PASSWORD: "entitlement_dev",
        },
      },
    }),
  );
  const weak = issues.filter((issue) => issue.code === "weak_default_secret");
  assert.equal(weak.length, 2);
});

test("empty secrets are a warning in dev and an error in production", () => {
  const input = config({
    entitlement: {
      image: "luminaryworks/entitlement:0.1.0",
      environment: { ENTITLEMENT_SERVICE_API_KEY: "" },
    },
  });
  const dev = checkComposeConfig(input, { stage: "dev" }).issues.find(
    (issue) => issue.code === "secret_empty",
  );
  const prod = checkComposeConfig(input, { stage: "production" }).issues.find(
    (issue) => issue.code === "secret_empty",
  );
  assert.equal(dev.severity, "warning");
  assert.equal(prod.severity, "error");
});

test("published datastore ports are a warning in dev and an error in production", () => {
  const input = config({
    "entitlement-db": {
      image: "postgres:16-alpine",
      environment: { POSTGRES_PASSWORD: "8f2c1d9e77a4b0c3" },
      ports: ["127.0.0.1:5434:5432"],
    },
  });
  const dev = checkComposeConfig(input, { stage: "dev" }).issues.find(
    (issue) => issue.code === "datastore_host_port",
  );
  const prod = checkComposeConfig(input, { stage: "production" }).issues.find(
    (issue) => issue.code === "datastore_host_port",
  );
  assert.equal(dev.severity, "warning");
  assert.equal(prod.severity, "error");
});

test("floating image tags fail a hardened stage", () => {
  const input = config({ identity: { image: "svhd/logto:latest" } });
  assert.equal(
    checkComposeConfig(input, { stage: "dev" }).issues.find(
      (issue) => issue.code === "image_floating_tag",
    ).severity,
    "warning",
  );
  assert.equal(
    checkComposeConfig(input, { stage: "production" }).issues.find(
      (issue) => issue.code === "image_floating_tag",
    ).severity,
    "error",
  );
});

test("digest-pinned images pass without comment", () => {
  const { issues } = checkComposeConfig(
    config({
      identity: {
        image:
          "svhd/logto@sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    }),
    { stage: "production" },
  );
  assert.deepEqual(codes(issues), []);
});

test("a service with neither image nor build is rejected", () => {
  const { issues } = checkComposeConfig(config({ identity: {} }));
  assert.ok(codes(issues).includes("image_missing"));
});

test("string port syntax is understood", () => {
  assert.deepEqual(__internals.normalizePorts(["127.0.0.1:3001:3001/tcp", "3040:3040"]), [
    { hostIp: "127.0.0.1", published: "3001", target: "3001", protocol: "tcp" },
    { hostIp: "", published: "3040", target: "3040", protocol: "tcp" },
  ]);
});

test("weak secret detection does not flag real random values", () => {
  assert.equal(__internals.isWeakSecret("change-me"), true);
  assert.equal(__internals.isWeakSecret("dev-secret"), true);
  assert.equal(__internals.isWeakSecret(""), false);
  assert.equal(__internals.isWeakSecret("9f8c2b1a7d64e05339aa41bb0c7e8f12"), false);
});

test("manifest hosts must exist as Compose services", () => {
  const manifest = {
    services: {
      identity: { url: "http://identity:3001/oidc" },
      entitlement: { url: "http://entitlement:3040" },
      observability: { url: "https://otel.example.com" },
    },
  };
  const issues = checkManifestAgainstCompose(manifest, ["identity", "identity-db"]);
  assert.deepEqual(codes(issues), ["manifest_host_not_in_compose"]);
  assert.equal(issues[0].target, "services.entitlement");
});
