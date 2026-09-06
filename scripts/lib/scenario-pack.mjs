/**
 * Scenario packs orchestrate *independent* Compose projects.
 *
 * They never merge six-product Compose files into one project. Control-plane
 * and product business databases are started at most once (same project names
 * on a second `up` are idempotent; smart-site is an overlay on agent-commerce).
 *
 * Product Compose files live in sibling product repos. This MetaRepo only
 * references them. Missing files fail preflight with the product name.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { metaRoot, productDir } from "./workspace.mjs";

const thisDir = dirname(fileURLToPath(import.meta.url));
export const scenariosRoot = resolve(thisDir, "..", "..", "deploy", "scenarios");
export const manifestsRoot = resolve(thisDir, "..", "..", "deploy", "manifests");

const HARDENED_STAGES = new Set(["pilot", "production"]);

/** Compose file sets a product is expected to ship. First complete set wins. */
export const PRODUCT_COMPOSE_SETS = {
  vistacast: [
    ["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"],
    ["deploy/docker-compose.yml", "deploy/docker-compose.dev.yml"],
  ],
  syncrobrain: [["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"]],
  doerflow: [["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"]],
  vistaremote: [
    ["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"],
    ["deploy/compose/docker-compose.core.yml", "deploy/compose/docker-compose.dev.yml"],
  ],
  dataluminary: [
    [
      "deploy/standalone/compose.core.yml",
      "deploy/standalone/compose.db.yml",
      "deploy/standalone/compose.dev.yml",
    ],
  ],
  blockyedu: [["deploy/edu/docker-compose.yml", "deploy/edu/docker-compose.dev.yml"]],
};

/** Optional overlays that join the shared control-plane network — they do not start it. */
export const PRODUCT_CONTROL_PLANE_OVERLAYS = {
  vistacast: ["deploy/docker-compose.control-plane.yml"],
  syncrobrain: ["deploy/docker-compose.control-plane.yml"],
  doerflow: ["deploy/docker-compose.control-plane.yml"],
  vistaremote: [
    "deploy/docker-compose.control-plane.yml",
    "deploy/compose/docker-compose.control-plane.yml",
  ],
  dataluminary: ["deploy/standalone/compose.control-plane.yml"],
  blockyedu: ["deploy/edu/docker-compose.control-plane.yml"],
};

export const CONTROL_PLANE_PROJECT = {
  id: "control-plane",
  project: "lw-control",
  optional: true,
  compose: ["deploy/compose/control-plane.yaml"],
};

export const SCENARIO_IDS = ["agent-commerce", "smart-site"];

function issue(severity, code, target, message) {
  return { severity, code, target, message };
}

export function parseProductRoots(raw) {
  if (!raw || !String(raw).trim()) return {};
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      out[String(key).toLowerCase()] = String(value);
    }
    return out;
  }
  const out = {};
  for (const part of trimmed.split(/[,;]/)) {
    const idx = part.search(/[:=]/);
    if (idx < 1) continue;
    out[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Resolve a product MetaRepo root.
 *
 * Order: PRODUCT_ROOTS env / options → sibling of LuminaryWorks (`../VistaCast`)
 * which, from `deploy/scenarios/<name>/`, is `../../../VistaCast`.
 */
export function resolveProductRoot(product, options = {}) {
  const roots =
    typeof options.productRoots === "string"
      ? parseProductRoots(options.productRoots)
      : (options.productRoots ?? parseProductRoots(options.env?.PRODUCT_ROOTS));
  if (roots[product]) {
    const configured = roots[product];
    return isAbsolute(configured) ? configured : resolve(options.cwd ?? metaRoot, configured);
  }
  return productDir(product);
}

export function loadScenarioDescriptor(scenario, options = {}) {
  const root = options.scenariosRoot ?? scenariosRoot;
  const path = join(root, scenario, "projects.json");
  if (!existsSync(path)) {
    return {
      path,
      descriptor: null,
      error: issue(
        "error",
        "scenario_descriptor_missing",
        scenario,
        `Scenario descriptor not found: ${path}`,
      ),
    };
  }
  const raw = readFileSync(path, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    return {
      path,
      descriptor: null,
      error: issue(
        "error",
        "utf8_bom",
        path,
        "projects.json starts with a UTF-8 BOM; save as UTF-8 without BOM.",
      ),
    };
  }
  return { path, descriptor: JSON.parse(raw), error: null };
}

/**
 * smart-site is an overlay on agent-commerce: resolve the base first, then
 * append incremental product projects. Never duplicates a Compose project.
 */
export function resolveScenarioProjects(scenario, options = {}) {
  const issues = [];
  if (!SCENARIO_IDS.includes(scenario)) {
    issues.push(
      issue(
        "error",
        "scenario_unknown",
        scenario,
        `Unknown scenario "${scenario}". Known: ${SCENARIO_IDS.join(", ")}.`,
      ),
    );
    return { projects: [], extendsFrom: null, issues, descriptor: null };
  }

  const loaded = loadScenarioDescriptor(scenario, options);
  if (loaded.error) {
    issues.push(loaded.error);
    return { projects: [], extendsFrom: null, issues, descriptor: null };
  }

  const descriptor = loaded.descriptor;
  let baseProjects = [];
  const extendsFrom = descriptor.extends ?? null;

  if (scenario === "smart-site" && extendsFrom !== "agent-commerce") {
    issues.push(
      issue(
        "error",
        "smart_site_requires_agent_commerce",
        scenario,
        'smart-site must declare "extends": "agent-commerce" and reuse those Compose projects.',
      ),
    );
  }

  if (extendsFrom) {
    if (extendsFrom === scenario) {
      issues.push(
        issue("error", "scenario_extends_self", scenario, "A scenario cannot extend itself."),
      );
    } else {
      const base = resolveScenarioProjects(extendsFrom, options);
      issues.push(...base.issues);
      baseProjects = base.projects;
      if (base.issues.some((item) => item.code === "scenario_descriptor_missing")) {
        issues.push(
          issue(
            "error",
            "smart_site_requires_agent_commerce",
            scenario,
            `smart-site depends on the ${extendsFrom} scenario pack; ${extendsFrom}/projects.json is missing.`,
          ),
        );
      }
    }
  }

  const seen = new Set(baseProjects.map((item) => item.product));
  const incremental = [];
  for (const entry of descriptor.projects ?? []) {
    if (seen.has(entry.product)) continue;
    seen.add(entry.product);
    incremental.push({
      product: entry.product,
      project: entry.project ?? `lw-${entry.product}`,
      required: entry.required !== false,
      role: entry.role ?? "runtime",
      incremental: Boolean(extendsFrom),
    });
  }

  return {
    projects: [...baseProjects, ...incremental],
    extendsFrom,
    issues,
    descriptor,
  };
}

function firstCompleteComposeSet(productRoot, sets, exists) {
  for (const files of sets) {
    if (files.every((file) => exists(join(productRoot, file)))) {
      return { files, missing: [] };
    }
  }
  const preferred = sets[0] ?? [];
  return {
    files: preferred,
    missing: preferred.filter((file) => !exists(join(productRoot, file))),
  };
}

export function resolveProductCompose(product, options = {}) {
  const exists = options.exists ?? existsSync;
  const productRoot = resolveProductRoot(product, options);
  const sets = options.composeSets?.[product] ?? PRODUCT_COMPOSE_SETS[product];
  if (!sets) {
    return {
      product,
      productRoot,
      files: [],
      overlays: [],
      missing: [`(unknown product "${product}")`],
    };
  }

  const matched = firstCompleteComposeSet(productRoot, sets, exists);
  const overlayCandidates = PRODUCT_CONTROL_PLANE_OVERLAYS[product] ?? [];
  const overlays = overlayCandidates.filter((file) => exists(join(productRoot, file)));

  return {
    product,
    productRoot,
    files: matched.files,
    overlays,
    missing: matched.missing,
    rootExists: exists(productRoot),
  };
}

export function checkAiCentralStage(manifest) {
  const ai = manifest?.capabilities?.ai;
  const stage = manifest?.stage;
  if (ai === "central" && HARDENED_STAGES.has(stage)) {
    return issue(
      "error",
      "capability_not_ready_for_stage",
      "capabilities.ai",
      `ai=central is "lab" maturity but stage is "${stage}". Do not describe it as generally available.`,
    );
  }
  return null;
}

export function loadJsonNoBom(path, exists = existsSync) {
  if (!exists(path)) return { error: `not found: ${path}` };
  const raw = readFileSync(path);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return { error: `${path} starts with a UTF-8 BOM; save as UTF-8 without BOM.` };
  }
  return { value: JSON.parse(raw.toString("utf8")) };
}

/**
 * Scenario preflight. Never starts containers. Never runs `docker compose config`
 * against product files (those live in other repos and must stay independent).
 * `docker compose config` for this repo's control plane stays in
 * `scripts/preflight-control-plane.mjs`.
 */
export function preflightScenario(scenario, options = {}) {
  const issues = [];
  const exists = options.exists ?? existsSync;
  const withControlPlane = Boolean(options.withControlPlane);

  const resolved = resolveScenarioProjects(scenario, options);
  issues.push(...resolved.issues);

  const manifestRel =
    resolved.descriptor?.manifest ??
    (scenario === "smart-site"
      ? "deploy/manifests/smart-site.dev.json"
      : "deploy/manifests/agent-commerce.dev.json");
  const manifestPath = resolve(options.cwd ?? metaRoot, manifestRel);
  const loadedManifest = options.manifest
    ? { value: options.manifest }
    : loadJsonNoBom(manifestPath, exists);

  let manifest = options.manifest ?? null;
  if (loadedManifest.error) {
    issues.push(issue("error", "manifest_unreadable", manifestRel, loadedManifest.error));
  } else {
    manifest = loadedManifest.value;
    if (manifest.profile && manifest.profile !== scenario) {
      issues.push(
        issue(
          "error",
          "manifest_profile_mismatch",
          manifestRel,
          `Manifest profile "${manifest.profile}" does not match scenario "${scenario}".`,
        ),
      );
    }
    const aiIssue = checkAiCentralStage(manifest);
    if (aiIssue) issues.push(aiIssue);
  }

  const plan = [];

  if (withControlPlane) {
    const cpFiles = CONTROL_PLANE_PROJECT.compose.map((file) =>
      resolve(options.cwd ?? metaRoot, file),
    );
    const missingCp = cpFiles.filter((file) => !exists(file));
    if (missingCp.length) {
      issues.push(
        issue(
          "error",
          "control_plane_compose_missing",
          CONTROL_PLANE_PROJECT.project,
          `Control-plane Compose missing: ${missingCp.join(", ")}`,
        ),
      );
    } else {
      plan.push({
        id: CONTROL_PLANE_PROJECT.id,
        project: CONTROL_PLANE_PROJECT.project,
        cwd: options.cwd ?? metaRoot,
        files: cpFiles,
        optional: true,
        kind: "control-plane",
      });
    }
  }

  for (const entry of resolved.projects) {
    const compose = resolveProductCompose(entry.product, options);
    if (compose.missing.length) {
      const severity = entry.required ? "error" : "warning";
      const tried = (PRODUCT_COMPOSE_SETS[entry.product] ?? [])
        .map((files) => files.join(" + "))
        .join(" | ");
      const hint = compose.rootExists
        ? `expected ${compose.missing.map((file) => join(compose.productRoot, file)).join(", ")} (tried ${tried})`
        : `product root not found at ${compose.productRoot} (set PRODUCT_ROOTS or clone the sibling repo; from this MetaRepo that is ../${compose.productRoot.split(/[/\\]/).pop()}, from deploy/scenarios/${scenario}/ that is ../../../${compose.productRoot.split(/[/\\]/).pop()})`;
      issues.push(
        issue(
          severity,
          "missing_product_compose",
          entry.product,
          `Product "${entry.product}" Compose is missing: ${hint}`,
        ),
      );
      if (entry.required) continue;
    }

    const files = compose.files.map((file) => join(compose.productRoot, file));
    if (withControlPlane) {
      for (const overlay of compose.overlays) {
        files.push(join(compose.productRoot, overlay));
      }
    }

    plan.push({
      id: entry.product,
      project: entry.project,
      cwd: compose.productRoot,
      files,
      optional: !entry.required,
      role: entry.role,
      incremental: entry.incremental,
      kind: "product",
    });
  }

  const errors = issues.filter((item) => item.severity === "error");
  return {
    ok: errors.length === 0,
    scenario,
    issues,
    errors,
    warnings: issues.filter((item) => item.severity === "warning"),
    plan,
    extendsFrom: resolved.extendsFrom,
    manifest,
  };
}

export function formatScenarioIssues(issues) {
  return issues.map((item) => `[${item.severity}] ${item.target}: ${item.message}`).join("\n");
}

/** Guard: a plan must never concatenate files from two products into one project. */
export function assertIndependentProjects(plan) {
  const projects = new Set();
  for (const item of plan) {
    if (projects.has(item.project)) {
      throw new Error(
        `Compose project "${item.project}" appears twice; scenario packs must not merge stacks.`,
      );
    }
    projects.add(item.project);
    if (item.kind === "product" && item.files.some((file) => file.includes("control-plane.yaml"))) {
      throw new Error(
        `Product project "${item.project}" must not include the LuminaryWorks control-plane Compose file.`,
      );
    }
  }
  return true;
}
