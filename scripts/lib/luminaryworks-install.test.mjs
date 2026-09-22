import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  INSTALL_KIT_COMPOSE_SETS,
  INSTALL_KIT_PUBLIC_OVERLAYS,
  INSTALL_PACK_FEDERAL_PRODUCTS,
  INSTALL_PACK_FORBIDDEN,
  fillInternalSecrets,
  fillInternalSecretsInKit,
  isPublicLoginAccountsFile,
  promoteExampleFilesToLive,
  sanitizePromotedEnv,
  shouldSkipInstallPackEntry,
} from "./luminaryworks-install.mjs";
import { enabledPackTargets, parseSiteIntent } from "./site-intent.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("sanitizePromotedEnv blanks lab passwords and forces product accounts", () => {
  const out = sanitizePromotedEnv(
    [
      "IDENTITY_ACCOUNTS_PROFILE=dev",
      'LW_LOGTO_ADMIN_PASSWORD="LuminaryDev!234"',
      "IDENTITY_DB_PASSWORD=logto_dev_password",
      "IDP_ISSUER=http://localhost:3001/oidc",
      "",
    ].join("\n"),
  );
  assert.match(out, /IDENTITY_ACCOUNTS_PROFILE=product/);
  assert.match(out, /LW_LOGTO_ADMIN_PASSWORD=$/m);
  assert.match(out, /IDENTITY_DB_PASSWORD=$/m);
  assert.match(out, /IDP_ISSUER=http:\/\/localhost:3001\/oidc/);
});

test("promoteExampleFilesToLive writes .env and removes .example", () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-kit-env-"));
  try {
    writeFileSync(join(dir, "app.env.example"), "TOKEN=CHANGE_ME\nNAME=keep\n");
    const promoted = promoteExampleFilesToLive(dir);
    assert.deepEqual(promoted, ["app.env"]);
    assert.equal(existsSync(join(dir, "app.env.example")), false);
    const text = readFileSync(join(dir, "app.env"), "utf8");
    assert.match(text, /TOKEN=$/m);
    assert.match(text, /NAME=keep/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fillInternalSecrets generates DB passwords and public-login admin passwords", () => {
  const dir = mkdtempSync(join(tmpdir(), "lw-kit-secrets-"));
  try {
    mkdirSync(join(dir, "deploy", "env"), { recursive: true });
    mkdirSync(join(dir, "identity"), { recursive: true });
    writeFileSync(join(dir, "deploy", "env", "control-plane.env"), "IDENTITY_DB_PASSWORD=\nFOO=bar\n");
    writeFileSync(join(dir, "identity", ".env"), "LW_LOGTO_ADMIN_PASSWORD=\n");
    writeFileSync(
      join(dir, "identity", "ACCOUNTS.product.env"),
      "LW_SUPER_ADMIN_PASSWORD=\n",
    );
    let n = 0;
    fillInternalSecretsInKit(dir, { generate: () => `gen${n++}` });
    const cp = readFileSync(join(dir, "deploy", "env", "control-plane.env"), "utf8");
    assert.match(cp, /IDENTITY_DB_PASSWORD=gen0/);
    assert.match(cp, /对内密钥/);
    const admin = readFileSync(join(dir, "identity", ".env"), "utf8");
    assert.match(admin, /LW_LOGTO_ADMIN_PASSWORD=gen1/);
    const accounts = readFileSync(join(dir, "identity", "ACCOUNTS.product.env"), "utf8");
    assert.match(accounts, /LW_SUPER_ADMIN_PASSWORD=gen\d+/);
    assert.match(accounts, /已随机生成/);
    assert.equal(isPublicLoginAccountsFile("identity/ACCOUNTS.product.env"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fillInternalSecrets skips AISTOR keys", () => {
  const { text } = fillInternalSecrets("AISTOR_ROOT_PASSWORD=\nIDENTITY_DB_PASSWORD=\n", {
    generate: () => "x",
  });
  assert.match(text, /AISTOR_ROOT_PASSWORD=$/m);
  assert.match(text, /IDENTITY_DB_PASSWORD=x/);
});

test("first-install pack skips secrets and build artifacts", () => {
  assert.equal(shouldSkipInstallPackEntry("node_modules"), true);
  assert.equal(shouldSkipInstallPackEntry(".git"), true);
  assert.equal(shouldSkipInstallPackEntry("dist"), true);
  assert.equal(shouldSkipInstallPackEntry(".env"), true);
  assert.equal(shouldSkipInstallPackEntry("ACCOUNTS.dev.env"), true);
  assert.equal(shouldSkipInstallPackEntry("control-plane.tar"), true);
  assert.equal(shouldSkipInstallPackEntry(".env.example"), false);
  assert.equal(shouldSkipInstallPackEntry("ACCOUNTS.product.env.example"), false);
});

test("first-install kit lists all six federal products", () => {
  assert.deepEqual(INSTALL_PACK_FEDERAL_PRODUCTS, [
    "vistacast",
    "syncrobrain",
    "doerflow",
    "vistaremote",
    "dataluminary",
    "blockyedu",
  ]);
});

test("install-luminaryworks.sh opens a public config page and runs accept", () => {
  const text = readFileSync(join(root, "scripts/install-luminaryworks.sh"), "utf8");
  assert.match(text, /does NOT include Docker Engine or Docker images/);
  assert.match(text, /products\.\*\.enabled/);
  assert.match(text, /up -d --build/);
  assert.doesNotMatch(text, /^\s*docker load\b/m);
  assert.doesNotMatch(text, /remote-host-bootstrap/);
  assert.doesNotMatch(text, /--pull never/);
  assert.match(text, /install-wizard.py/);
  assert.match(text, /--wizard/);
  assert.match(text, /--no-wizard/);
  assert.match(text, /--skip-accept/);
  assert.match(text, /preflight/);
  assert.match(text, /\.install-ui\.ready/);
  assert.match(text, /\.install-ui\.url/);
  assert.match(text, /WIZARD_BIND="0\.0\.0\.0"/);
  assert.match(text, /--prepare-wizard/);
  assert.match(text, /WIZARD_PORT_ARGS/);
  assert.doesNotMatch(text, /WIZARD_PORT="8099"/);
  assert.match(text, /在运维电脑浏览器打开/);
  assert.match(text, /\.install-ui\.scope/);
  assert.match(text, /--detect-host --advertise-host/);
  assert.doesNotMatch(text, /install-runtime\.py" --detect-host/);
  assert.match(text, /--ttl 3600/);
  assert.match(text, /compose_dir/);
  assert.match(text, /bootstrap-identity/);
  assert.match(text, /install-runtime.py/);
  assert.match(text, /--accept/);
  assert.match(text, /CONTROL_CONSOLE_PUBLIC_URL/);
  assert.match(text, /PAYMENT_CONFIG_MASTER_KEY/);
  assert.match(text, /default_packs = \["syncrobrain"/);
});

test("pack-luminaryworks.mjs copies federal products and not Engine", () => {
  const text = readFileSync(join(root, "scripts/pack-luminaryworks.mjs"), "utf8");
  assert.match(text, /No Docker Engine/);
  assert.match(text, /packFederalProducts/);
  assert.match(text, /ensure-docker.sh/);
  assert.match(text, /install-wizard.py/);
  assert.match(text, /install-runtime.py/);
  assert.match(text, /accept-luminaryworks.sh/);
  assert.match(text, /identityScripts/);
  assert.match(text, /join\(kitDir, "identity", "scripts"\)/);
  assert.match(text, /INSTALL_KIT_COMPOSE_SETS/);
  assert.match(text, /fillInternalSecretsInKit/);
  assert.match(text, /assertBlockyeduCoursePacks/);
  assert.match(text, /blockyeduSeed/);
  assert.doesNotMatch(text, /remote-host-bootstrap/);
  assert.ok(INSTALL_PACK_FORBIDDEN.includes("images"));
  assert.ok(INSTALL_PACK_FORBIDDEN.includes("bootstrap.sh"));
  assert.ok(INSTALL_KIT_COMPOSE_SETS.vistacast[0].includes("deploy/docker-compose.yml"));
  assert.equal(INSTALL_KIT_PUBLIC_OVERLAYS.vistaremote.compose, "deploy/compose/docker-compose.public-ports.yml");
  assert.equal(INSTALL_KIT_PUBLIC_OVERLAYS.syncrobrain.compose, "deploy/docker-compose.public.yml");
});

test("luminaryworks-install site example is a checkbox with control-plane only", () => {
  const raw = JSON.parse(
    readFileSync(join(root, "deploy/site.luminaryworks-install.example.json"), "utf8"),
  );
  const intent = parseSiteIntent(raw);
  assert.equal(intent.ok, true, JSON.stringify(intent.issues));
  assert.deepEqual(enabledPackTargets(intent), ["control-plane"]);
  assert.equal(intent.hosts.vistaremote, "vistaremote.vistacast.dev");
  assert.equal(raw.protocol, "https");
  assert.equal(intent.hosts.dataluminary, "dataluminary.dev");
  for (const name of INSTALL_PACK_FEDERAL_PRODUCTS) {
    assert.equal(name in raw.products, true, name);
  }
  assert.equal(raw.products.blockyedu.seed.profile, "full-demo");
  assert.deepEqual(raw.products.blockyedu.seed.packs, [
    "syncrobrain",
    "dataluminary",
    "vistacast",
    "doerflow",
    "vistaremote",
  ]);
  assert.deepEqual(raw.products.blockyedu.seed.oerGrowth, ["oer-growth-v1"]);
});

test("install-runtime.py patches public IdP URLs and accept.sh wraps it", () => {
  const runtime = readFileSync(join(root, "scripts/install-runtime.py"), "utf8");
  assert.match(runtime, /def accept\(/);
  assert.match(runtime, /def post_up\(/);
  assert.match(runtime, /migration:run/);
  assert.match(runtime, /def bootstrap_identity\(/);
  assert.match(runtime, /verification\/password/);
  assert.match(runtime, /code_challenge_method/);
  assert.match(runtime, /register-apps.mjs/);
  assert.match(runtime, /seed-accounts.mjs/);
  assert.match(runtime, /DATALUMINARY_BIND_HOST/);
  assert.match(runtime, /VR_SERVER_HOST_PORT/);
  const installSh = readFileSync(join(root, "scripts/install-luminaryworks.sh"), "utf8");
  assert.match(installSh, /--post-up/);
  assert.match(installSh, /--only/);
  assert.match(installSh, /ensure-docker.sh/);
  assert.match(installSh, /--check-ports/);
  assert.match(installSh, /--apply-ingress/);
  const ensureDocker = readFileSync(join(root, "scripts/ensure-docker.sh"), "utf8");
  assert.match(ensureDocker, /get\.docker\.com/);
  assert.doesNotMatch(ensureDocker, /apt-get remove/);
  assert.doesNotMatch(ensureDocker, /docker system prune/);
  const accept = readFileSync(join(root, "scripts/accept-luminaryworks.sh"), "utf8");
  assert.match(accept, /install-runtime.py/);
  assert.match(accept, /--accept/);
  const result = spawnSync(
    "python3",
    [
      "-c",
      [
        "import importlib.util, pathlib",
        "p = pathlib.Path('scripts/install-runtime.py')",
        "spec = importlib.util.spec_from_file_location('rt', p)",
        "mod = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(mod)",
        "files = mod.product_idp_updates('http', '43.154.60.121', {'DataView (DataLuminary)': 'abc'})",
        "env = files['products/dataluminary/.env']",
        "assert env['VITE_IDP_ISSUER'] == 'http://43.154.60.121:3001/oidc'",
        "assert env['VITE_IDP_CLIENT_ID'] == 'abc'",
        "assert env['DATALUMINARY_BIND_HOST'] == '0.0.0.0'",
        "hosts = {'control-plane': 'luminaryworks.dev', 'dataluminary': 'dataluminary.dev'}",
        "dom = mod.product_idp_updates('https', '203.0.113.10', {'DataView (DataLuminary)': 'abc'}, hosts)",
        "assert dom['products/dataluminary/.env']['VITE_IDP_ISSUER'] == 'https://login.luminaryworks.dev/oidc'",
        "assert mod.compose_project_ours('lw-dataluminary') is True",
        "assert mod.compose_project_ours('nginx') is False",
        "print('ok')",
      ].join("; "),
    ],
    { encoding: "utf8", cwd: root, shell: false },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /ok/);
});

