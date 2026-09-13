import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wizard = join(root, "scripts", "install-wizard.py");

function runWizard(args, kit) {
  return spawnSync("python3", [wizard, "--kit", kit, ...args], {
    encoding: "utf8",
    shell: false,
  });
}

function kitWithAccounts(password) {
  const dir = mkdtempSync(join(tmpdir(), "lw-wizard-"));
  mkdirSync(join(dir, "identity"), { recursive: true });
  writeFileSync(
    join(dir, "site.json"),
    JSON.stringify({
      publicHost: "43.154.60.121",
      protocol: "http",
      platform: "linux/amd64",
      profile: "control-plane",
      hosts: { vistaremote: "vistaremote.vistacast.dev" },
      products: { "control-plane": { enabled: true } },
    }),
  );
  writeFileSync(
    join(dir, "identity", "ACCOUNTS.product.env"),
    `LW_SUPER_ADMIN_USERNAME=superadmin\nLW_SUPER_ADMIN_PASSWORD=${password}\n`,
  );
  return dir;
}

test("preflight generates missing admin passwords instead of refusing", () => {
  const dir = kitWithAccounts("");
  try {
    const result = runWizard(["--preflight"], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const accounts = readFileSync(join(dir, "identity", "ACCOUNTS.product.env"), "utf8");
    assert.match(accounts, /LW_SUPER_ADMIN_PASSWORD=.+/);
    assert.doesNotMatch(accounts, /LW_SUPER_ADMIN_PASSWORD=$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight passes when superadmin password is set", () => {
  const dir = kitWithAccounts("not-a-weak-value-9f3a");
  try {
    const result = runWizard(["--preflight"], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply writes site.json hosts and never stores passwords there", () => {
  const dir = kitWithAccounts("");
  try {
    const payload = join(dir, "payload.json");
    writeFileSync(
      payload,
      JSON.stringify({
        publicHost: "43.154.60.121",
        protocol: "http",
        hosts: { vistaremote: "vistaremote.vistacast.dev" },
        products: { "control-plane": { enabled: true }, vistaremote: { enabled: true } },
        accounts: {
          "control-plane": { username: "superadmin", password: "super-login-ok-1" },
          vistaremote: { username: "admin_vistaremote", password: "remote-login-ok-1" },
        },
      }),
    );
    const result = runWizard(["--apply", payload], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const site = JSON.parse(readFileSync(join(dir, "site.json"), "utf8"));
    assert.equal(site.hosts.vistaremote, "vistaremote.vistacast.dev");
    assert.equal(site.products.vistaremote.enabled, true);
    assert.equal("LW_SUPER_ADMIN_PASSWORD" in site, false);
    assert.doesNotMatch(JSON.stringify(site), /super-login/);
    const accounts = readFileSync(join(dir, "identity", "ACCOUNTS.product.env"), "utf8");
    assert.match(accounts, /LW_SUPER_ADMIN_PASSWORD=super-login-ok-1/);
    assert.match(accounts, /LW_ADMIN_VISTAREMOTE_PASSWORD=remote-login-ok-1/);
    assert.match(accounts, /LW_ADMIN_VISTAREMOTE_USERNAME=admin_vistaremote/);
    assert.equal(site.host.ramGiB, 24);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply keeps a cleared product host empty instead of restoring the brand default", () => {
  const dir = kitWithAccounts("");
  try {
    const payload = join(dir, "payload.json");
    writeFileSync(
      payload,
      JSON.stringify({
        publicHost: "203.0.113.10",
        protocol: "http",
        hosts: { dataluminary: "", "control-plane": "luminaryworks.dev" },
        products: { "control-plane": { enabled: true }, dataluminary: { enabled: true } },
        accounts: {
          "control-plane": { username: "superadmin", password: "super-login-ok-1" },
          dataluminary: { username: "admin_dataluminary", password: "dl-login-ok-1" },
        },
      }),
    );
    const result = runWizard(["--apply", payload], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const site = JSON.parse(readFileSync(join(dir, "site.json"), "utf8"));
    assert.equal(site.hosts.dataluminary, "");
    const pf = JSON.parse(runWizard(["--preflight"], dir).stdout);
    assert.equal(pf.ok, true);
    assert.ok(pf.warnings.some((item) => item.code === "ip_access"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install config page is four LuminaryWorks steps", () => {
  const html = readFileSync(join(root, "deploy", "luminaryworks-install", "wizard", "index.html"), "utf8");
  assert.match(html, /源站公网 IP/);
  assert.match(html, /勾选要装的产品/);
  assert.match(html, /清空此栏才走源站 IP:端口/);
  assert.match(html, /alert-ip/);
  assert.match(html, /应急 IP 访问/);
  assert.match(html, /超管与各产品登录/);
  assert.match(html, /运维层库口令/);
  assert.match(html, /内存上限/);
  assert.match(html, /上一步/);
  assert.match(html, /留空则随机生成/);
  assert.match(html, /一小时后自动关闭/);
  assert.doesNotMatch(html, /PHPCMS/i);
  const py = readFileSync(wizard, "utf8");
  assert.doesNotMatch(py, /PHPCMS/i);
  assert.match(py, /bind = "0.0.0.0"/);
  assert.match(py, /--advertise-host/);
  assert.match(py, /--detect-host/);
  assert.match(py, /--prepare-wizard/);
  assert.match(py, /WIZARD_PORT_CANDIDATES = \(80, 8080, 8099\)/);
  assert.match(py, /def detect_cloud/);
  assert.match(py, /def open_host_firewall/);
  assert.match(py, /ufw/);
  assert.match(py, /URL_NAME = "\.install-ui\.url"/);
  assert.match(py, /def detect_public_host/);
  assert.match(py, /def pick_advertise_host/);
  assert.match(py, /def probe_live_public_ips/);
  assert.match(py, /def config_page_url/);
  assert.match(py, /100\.100\.100\.200/);
  assert.match(py, /X-aws-ec2-metadata-token/);
  const defaults = JSON.parse(
    readFileSync(join(root, "deploy", "luminaryworks-install", "hosts.defaults.json"), "utf8"),
  );
  const remote = defaults.products.find((item) => item.id === "vistaremote");
  assert.equal(remote.host, "vistaremote.vistacast.dev");
});

test("advertise host prefers public IP over LAN on any cloud", () => {
  const dir = kitWithAccounts("");
  const lanKit = kitWithAccounts("");
  try {
    writeFileSync(
      join(lanKit, "site.json"),
      JSON.stringify({
        publicHost: "10.0.0.8",
        protocol: "http",
        products: { "control-plane": { enabled: true } },
      }),
    );
    const result = spawnSync(
      "python3",
      [
        "-c",
        [
          "import importlib.util, pathlib, sys",
          "p = pathlib.Path('scripts/install-wizard.py')",
          "spec = importlib.util.spec_from_file_location('wiz', p)",
          "mod = importlib.util.module_from_spec(spec)",
          "spec.loader.exec_module(mod)",
          "assert mod.is_public_ipv4('8.8.8.8')",
          "assert mod.is_public_ipv4('43.154.60.121')",
          "assert mod.is_public_ipv4('47.98.1.2')",
          "assert not mod.is_public_ipv4('10.0.0.8')",
          "assert not mod.is_public_ipv4('192.168.1.1')",
          "assert not mod.is_public_ipv4('172.16.0.1')",
          "assert not mod.is_public_ipv4('100.64.1.1')",
          "assert not mod.is_public_ipv4('127.0.0.1')",
          "assert mod.pick_advertise_host(['10.0.0.8', '8.8.8.8']) == '8.8.8.8'",
          "assert mod.pick_advertise_host(['10.0.0.8', '192.168.1.1']) == '10.0.0.8'",
          "assert mod.pick_advertise_host(['127.0.0.1', '10.0.0.8']) == '10.0.0.8'",
          "assert mod.advertise_scope('47.98.1.2') == 'public'",
          "assert mod.advertise_scope('10.0.0.8') == 'lan'",
          "assert mod.public_http_origin('47.98.1.2', 80) == 'http://47.98.1.2'",
          "assert mod.public_http_origin('47.98.1.2', 8080) == 'http://47.98.1.2:8080'",
          "public, local = mod.config_page_url('0.0.0.0', 80, 'tok', '47.98.1.2')",
          "assert public == 'http://47.98.1.2/?t=tok'",
          "public, local = mod.config_page_url('0.0.0.0', 8080, 'tok', '47.98.1.2')",
          "assert public == 'http://47.98.1.2:8080/?t=tok'",
          "assert '127.0.0.1' not in public",
          "assert mod.security_group_likely_open('tencent', 80)",
          "assert not mod.security_group_likely_open('tencent', 8080)",
          "assert mod.security_group_likely_open('ovh', 8080)",
          "assert '腾讯云' in mod.cloud_security_group_hint('tencent', 80)",
          "assert '安全组' in mod.cloud_security_group_hint('tencent', 8080)",
          "assert mod.WIZARD_PORT_CANDIDATES == (80, 8080, 8099)",
          "mod._dmi_text = lambda name: 'Tencent Cloud' if name == 'sys_vendor' else ''",
          "assert mod.detect_cloud() == 'tencent'",
          "kit = pathlib.Path(sys.argv[1])",
          "lan = pathlib.Path(sys.argv[2])",
          "mod.probe_live_public_ips = lambda: ['47.98.1.2']",
          "mod.local_ipv4s = lambda: ['10.0.0.8']",
          "assert mod.detect_public_host(kit) == '47.98.1.2'",
          "mod.probe_live_public_ips = lambda: []",
          "assert mod.detect_public_host(lan) == '10.0.0.8'",
          "mod.local_ipv4s = lambda: ['192.168.1.20']",
          "empty = pathlib.Path(sys.argv[2]) / 'nested-empty'",
          "empty.mkdir(exist_ok=True)",
          "(empty / 'site.json').write_text('{}', encoding='utf-8')",
          "assert mod.detect_public_host(empty) == '192.168.1.20'",
          "print('ok')",
        ].join("; "),
        dir,
        lanKit,
      ],
      { encoding: "utf8", cwd: root, shell: false },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(lanKit, { recursive: true, force: true });
  }
});

test("24GiB memory plan keeps working set under RAM and lets ceilings exceed RAM", () => {
  const result = spawnSync(
    "python3",
    [wizard, "--memory-plan"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        ramGiB: 24,
        swapGiB: 8,
        enabled: ["control-plane", "dataluminary", "blockyedu", "doerflow", "vistaremote", "vistacast", "syncrobrain"],
      }),
      shell: false,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.osReserveGiB, 4);
  assert.ok(plan.workingMiB <= 21 * 1024, plan.workingMiB);
  assert.ok(plan.limitMiB > 24 * 1024, plan.limitMiB);
  assert.equal(plan.overcommitLimits, true);
});

test("export csv includes login passwords after apply and never puts them in site.json", () => {
  const dir = kitWithAccounts("keep-this-password-ok");
  try {
    const payload = join(dir, "payload.json");
    writeFileSync(
      payload,
      JSON.stringify({
        publicHost: "43.154.60.121",
        protocol: "http",
        ramGiB: 24,
        swapGiB: 8,
        products: { "control-plane": { enabled: true } },
        accounts: { "control-plane": { username: "superadmin", password: "keep-this-password-ok" } },
      }),
    );
    assert.equal(runWizard(["--apply", payload], dir).status, 0);
    const csv = runWizard(["--export-csv"], dir);
    assert.equal(csv.status, 0, csv.stderr);
    assert.match(csv.stdout, /LW_SUPER_ADMIN_PASSWORD,keep-this-password-ok/);
    assert.match(csv.stdout, /limitMiB/);
    const site = readFileSync(join(dir, "site.json"), "utf8");
    assert.doesNotMatch(site, /keep-this-password-ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
