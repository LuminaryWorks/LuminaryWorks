/**
 * Compose contract checks for composable LuminaryWorks deployments.
 *
 * These are pure functions over the output of `docker compose config --format json`
 * so they can be unit-tested without Docker. See scripts/preflight-control-plane.mjs
 * for the CLI and spec/composable-deployment.md for the rules being enforced.
 */

const HARDENED_STAGES = new Set(["pilot", "production"]);

/** Service names so generic that merging two products' Compose files would collide. */
const GENERIC_SERVICE_NAMES = new Set([
  "api",
  "app",
  "backend",
  "cache",
  "db",
  "database",
  "frontend",
  "gateway",
  "mongo",
  "mongodb",
  "mysql",
  "nginx",
  "postgres",
  "proxy",
  "redis",
  "server",
  "web",
  "worker",
]);

const DATASTORE_IMAGE = /^(docker\.io\/)?(library\/)?(postgres|postgis|mysql|mariadb|mongo|redis|valkey|clickhouse|timescale)/i;

const FORBIDDEN_HOSTS = ["host.docker.internal", "gateway.docker.internal"];

const SECRET_LIKE_KEY =
  /(secret|password|passwd|pwd|token|api[-_]?key|apikey|credential|private[-_]?key|passphrase|pepper|master[-_]?key)/i;

/**
 * Values that must never ship as a default. Matched case-insensitively against
 * the whole value, so a real random secret that merely contains "dev" passes.
 */
const WEAK_SECRET_VALUES = new Set(
  [
    "change-me",
    "changeme",
    "dev",
    "dev-entitlement-secret-change-me",
    "dev-secret",
    "dev-service-key-change-me",
    "development",
    "entitlement_dev",
    "logto_dev_password",
    "pass",
    "password",
    "postgres",
    "root",
    "secret",
    "test",
  ].map((value) => value.toLowerCase()),
);

const WEAK_SECRET_PATTERNS = [/change[-_]?me/i, /^dev[-_]/i, /[-_]dev$/i, /insecure/i, /example/i];

function issue(severity, code, target, message) {
  return { severity, code, target, message };
}

function normalizePorts(ports) {
  if (!Array.isArray(ports)) return [];
  return ports.map((port) => {
    if (typeof port === "string") {
      // [host_ip:][published:]target[/protocol]
      const [spec, protocol = "tcp"] = port.split("/");
      const parts = spec.split(":");
      const target = parts.pop();
      const published = parts.pop();
      const hostIp = parts.length ? parts.join(":") : "";
      return { hostIp, published: published ?? "", target: target ?? "", protocol };
    }
    return {
      hostIp: port.host_ip ?? "",
      published: port.published === undefined ? "" : String(port.published),
      target: port.target === undefined ? "" : String(port.target),
      protocol: port.protocol ?? "tcp",
    };
  });
}

function isDatastore(name, service) {
  if (DATASTORE_IMAGE.test(String(service.image ?? ""))) return true;
  return /(^|[-_])(db|database|redis|postgres|mysql|mongo|cache)([-_]|$)/i.test(name);
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

function isWeakSecret(value) {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (WEAK_SECRET_VALUES.has(trimmed.toLowerCase())) return true;
  return WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function imageIssues(name, service, hardened) {
  const issues = [];
  const image = String(service.image ?? "").trim();
  if (image === "") {
    if (!service.build) {
      issues.push(
        issue("error", "image_missing", name, "Service has neither `image` nor `build`."),
      );
    }
    return issues;
  }

  const lastSegment = image.slice(image.lastIndexOf("/") + 1);
  const hasDigest = image.includes("@sha256:");
  const hasTag = lastSegment.includes(":");
  const tag = hasTag ? lastSegment.slice(lastSegment.indexOf(":") + 1) : "";

  if (hasDigest) return issues;

  if (!hasTag) {
    issues.push(
      issue(
        hardened ? "error" : "warning",
        "image_untagged",
        name,
        `Image "${image}" has no tag; it resolves to :latest and is not reproducible.`,
      ),
    );
    return issues;
  }

  if (tag === "latest" || tag === "main" || tag === "master" || tag === "edge") {
    issues.push(
      issue(
        hardened ? "error" : "warning",
        "image_floating_tag",
        name,
        `Image "${image}" uses a floating tag; pin a version or digest for pilot/production.`,
      ),
    );
  } else if (hardened) {
    issues.push(
      issue(
        "warning",
        "image_without_digest",
        name,
        `Image "${image}" is tagged but not digest-pinned; prefer image@sha256:… in production.`,
      ),
    );
  }

  return issues;
}

/**
 * @param {object} config Parsed `docker compose config --format json` output.
 * @param {{ stage?: string }} [options]
 * @returns {{ issues: Array, serviceNames: string[] }}
 */
export function checkComposeConfig(config, options = {}) {
  const stage = options.stage ?? "dev";
  const hardened = HARDENED_STAGES.has(stage);
  const issues = [];
  const services = config?.services ?? {};
  const networks = config?.networks ?? {};
  const serviceNames = Object.keys(services);

  if (serviceNames.length === 0) {
    issues.push(issue("error", "no_services", "(compose)", "Compose config declares no services."));
  }

  const publishedPorts = new Map();

  for (const [name, service] of Object.entries(services)) {
    if (service?.container_name) {
      issues.push(
        issue(
          "error",
          "fixed_container_name",
          name,
          `container_name "${service.container_name}" prevents running this stack alongside product stacks; remove it and rely on the Compose project name.`,
        ),
      );
    }

    if (GENERIC_SERVICE_NAMES.has(name)) {
      issues.push(
        issue(
          "error",
          "generic_service_name",
          name,
          `Service name "${name}" is too generic and would merge with another product's service; prefix it with the owning component.`,
        ),
      );
    }

    for (const text of collectStrings(service ?? {})) {
      for (const host of FORBIDDEN_HOSTS) {
        if (text.includes(host)) {
          issues.push(
            issue(
              "error",
              "host_docker_internal",
              name,
              `"${host}" is not portable; address other containers by Compose service name on a shared network.`,
            ),
          );
        }
      }
    }

    for (const [key, rawValue] of Object.entries(service?.environment ?? {})) {
      if (!SECRET_LIKE_KEY.test(key)) continue;
      const value = rawValue === null || rawValue === undefined ? "" : String(rawValue);
      if (value === "") {
        issues.push(
          issue(
            hardened ? "error" : "warning",
            "secret_empty",
            `${name}.${key}`,
            "Secret resolved to an empty value; provide it via the env file or a secret store.",
          ),
        );
        continue;
      }
      if (isWeakSecret(value)) {
        issues.push(
          issue(
            "error",
            "weak_default_secret",
            `${name}.${key}`,
            `Secret resolved to the well-known development value "${value}"; generate a unique secret per deployment.`,
          ),
        );
      }
    }

    issues.push(...imageIssues(name, service ?? {}, hardened));

    const ports = normalizePorts(service?.ports);
    const datastore = isDatastore(name, service ?? {});

    for (const port of ports) {
      if (!port.published) continue;
      const key = `${port.hostIp || "0.0.0.0"}:${port.published}/${port.protocol}`;
      if (publishedPorts.has(key)) {
        issues.push(
          issue(
            "error",
            "host_port_conflict",
            `${name}:${port.published}`,
            `Host port ${key} is already published by "${publishedPorts.get(key)}".`,
          ),
        );
      } else {
        publishedPorts.set(key, name);
      }

      if (datastore) {
        issues.push(
          issue(
            hardened ? "error" : "warning",
            "datastore_host_port",
            `${name}:${port.published}`,
            `Datastore publishes host port ${key}; production databases must stay on the internal network.`,
          ),
        );
      }

      if (hardened && (port.hostIp === "" || port.hostIp === "0.0.0.0" || port.hostIp === "::")) {
        issues.push(
          issue(
            "warning",
            "port_bound_to_all_interfaces",
            `${name}:${port.published}`,
            `Port ${port.published} is published on all interfaces; bind it to a specific address or front it with a reverse proxy.`,
          ),
        );
      }
    }

    if (datastore && hardened) {
      const attached = Object.keys(service?.networks ?? {});
      const externallyReachable = attached.filter((net) => networks?.[net]?.internal !== true);
      if (attached.length > 0 && externallyReachable.length > 0) {
        issues.push(
          issue(
            "warning",
            "datastore_on_non_internal_network",
            name,
            `Datastore is attached to non-internal network(s) ${externallyReachable.join(", ")}; keep it on an internal-only network.`,
          ),
        );
      }
    }
  }

  return { issues, serviceNames };
}

/**
 * Cross-checks manifest service hostnames against the Compose services that are
 * supposed to provide them. Internal DNS names must exist in the stack.
 */
export function checkManifestAgainstCompose(manifest, serviceNames) {
  const issues = [];
  const known = new Set(serviceNames);

  for (const [name, ref] of Object.entries(manifest?.services ?? {})) {
    if (!ref?.url) continue;
    let hostname;
    try {
      hostname = new URL(ref.url).hostname;
    } catch {
      continue; // URL shape is validated by @luminaryworks/control-manifest
    }
    if (hostname.includes(".") || known.has(hostname)) continue;
    issues.push(
      issue(
        "warning",
        "manifest_host_not_in_compose",
        `services.${name}`,
        `Manifest points at internal host "${hostname}" but no Compose service with that name exists in this stack (services: ${serviceNames.join(", ")}).`,
      ),
    );
  }

  return issues;
}

export function formatComposeIssues(issues) {
  return issues
    .map((item) => `[${item.severity}] ${item.target}: ${item.message}`)
    .join("\n");
}

export const __internals = {
  isWeakSecret,
  isDatastore,
  normalizePorts,
  imageIssues,
  GENERIC_SERVICE_NAMES,
};
