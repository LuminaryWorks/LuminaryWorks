/**
 * LuminaryWorks first-install kit: source + Compose + env files.
 * Never includes Docker Engine, image tarballs, or 基座 bootstrap.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";


export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".turbo",
  ".idea",
  ".cursor",
  "backups",
  ".next",
  "Pods",
  ".gradle",
  "__pycache__",
  ".venv",
  "venv",
  "playwright-report",
  "test-results",
]);

export function shouldSkipInstallPackEntry(name) {
  const base = String(name || "");
  if (SKIP_DIR_NAMES.has(base)) return true;
  if (base === ".DS_Store" || base.endsWith(".log")) return true;
  if (base === ".env") return true;
  if (base.startsWith(".env.") && !base.endsWith(".example")) return true;
  if (base.endsWith(".license")) return true;
  if (base === "ACCOUNTS.dev.env") return true;
  if (/\.(tar|tgz|dmg|iso|mp4|mov|webm)$/i.test(base)) return true;
  return false;
}

export const INSTALL_PACK_FEDERAL_PRODUCTS = [
  "vistacast",
  "syncrobrain",
  "doerflow",
  "vistaremote",
  "dataluminary",
  "blockyedu",
];

/**
 * Compose files the first-install kit actually `up`s on a public IP.
 * Prefer each product's **prod** overlay (loopback DB, strong secrets).
 * Public port overlays in INSTALL_KIT_PUBLIC_OVERLAYS reopen browser ports.
 * Offline `pack:all` still uses PRODUCT_PACK_COMPOSE_SETS.
 *
 * Production delivery should prefer the sibling LuminaryWorksDeployment
 * repo (digest-locked images). This kit remains for lab / source installs.
 */
export const INSTALL_KIT_COMPOSE_SETS = {
  vistacast: [["deploy/docker-compose.yml", "deploy/docker-compose.prod.yml"]],
  syncrobrain: [["deploy/docker-compose.core.yml", "deploy/docker-compose.prod.yml"]],
  doerflow: [["deploy/docker-compose.core.yml", "deploy/docker-compose.prod.yml"]],
  vistaremote: [
    ["deploy/compose/docker-compose.core.yml", "deploy/compose/docker-compose.prod.yml"],
  ],
  dataluminary: [
    [
      "deploy/standalone/compose.core.yml",
      "deploy/standalone/compose.db.yml",
      "deploy/standalone/compose.prod.yml",
    ],
  ],
  blockyedu: [["deploy/edu/docker-compose.yml", "deploy/edu/docker-compose.prod.yml"]],
};

export const INSTALL_KIT_PUBLIC_OVERLAYS = {
  dataluminary: {
    from: "deploy/luminaryworks-install/overlays/dataluminary-idp-proxy.yml",
    to: "products/dataluminary/deploy/standalone/compose.idp-proxy.yml",
    compose: "deploy/standalone/compose.idp-proxy.yml",
  },
  vistacast: {
    from: "deploy/luminaryworks-install/overlays/vistacast-public-ports.yml",
    to: "products/vistacast/deploy/docker-compose.public-ports.yml",
    compose: "deploy/docker-compose.public-ports.yml",
  },
  vistaremote: {
    from: "deploy/luminaryworks-install/overlays/vistaremote-public-ports.yml",
    to: "products/vistaremote/deploy/compose/docker-compose.public-ports.yml",
    compose: "deploy/compose/docker-compose.public-ports.yml",
  },
  syncrobrain: {
    from: "deploy/luminaryworks-install/overlays/syncrobrain-public.yml",
    to: "products/syncrobrain/deploy/docker-compose.public.yml",
    compose: "deploy/docker-compose.public.yml",
  },
};

export const INSTALL_PACK_TREES = [
  "deploy/compose/control-plane.yaml",
  "deploy/env/control-plane.env.example",
  "services/auth-gateway",
  "services/entitlement",
  "apps/control-console",
  "products/",
];

export const INSTALL_PACK_FORBIDDEN = ["images", "bootstrap.sh", "remote-host-bootstrap.sh"];

const WEAK_SECRET = /change[-_]?me|LuminaryDev|logto_dev_password|password123|changeme/i;
const SECRETISH = /password|secret|token|private[_-]?key|credential|api[_-]?key/i;

export function livePathFromExample(name) {
  const base = String(name || "");
  if (!base.endsWith(".example")) return null;
  return base.slice(0, -".example".length);
}

export function sanitizePromotedEnv(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const stripped = raw.trim();
    if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) {
      out.push(raw);
      continue;
    }
    const eq = stripped.indexOf("=");
    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1);
    const unquoted = val.trim().replace(/^['"]|['"]$/g, "");
    if (key === "IDENTITY_ACCOUNTS_PROFILE" && unquoted === "dev") {
      out.push("IDENTITY_ACCOUNTS_PROFILE=product");
      continue;
    }
    if (SECRETISH.test(key) && (!unquoted || WEAK_SECRET.test(unquoted))) {
      out.push(`${key}=`);
      continue;
    }
    out.push(raw);
  }
  return `${out.join("\n")}${out.length ? "\n" : ""}`;
}

export function listExampleFiles(root) {
  const found = [];
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        walk(path);
      } else if (ent.name.endsWith(".example")) {
        found.push(path);
      }
    }
  }
  walk(root);
  return found;
}

/**
 * After copying *.example into the kit, write live files (`.env`, `ACCOUNTS.product.env`)
 * and delete the `.example` copies so operators only edit the real names.
 * Never used on workstation source trees (those keep examples in git).
 */
export function promoteExampleFilesToLive(root) {
  const promoted = [];
  for (const examplePath of listExampleFiles(root)) {
    const destName = livePathFromExample(examplePath.split(/[/\\]/).pop());
    if (!destName) continue;
    const dest = join(dirname(examplePath), destName);
    let text = readFileSync(examplePath, "utf8");
    if (/\.env$/i.test(destName) || destName === ".env") {
      text = sanitizePromotedEnv(text);
    }
    writeFileSync(dest, text);
    rmSync(examplePath);
    promoted.push(relative(root, dest));
  }
  promoted.sort();
  return promoted;
}

const SKIP_AUTO_SECRET = /^(AISTOR_|LOGTO_M2M_|LOGTO_GOOGLE_|LOGTO_GITHUB_|ENTITLEMENT_LICENSE_)/;

export function isPublicLoginAccountsFile(rel) {
  const base = String(rel || "").replace(/\\/g, "/").split("/").pop();
  return base === "ACCOUNTS.product.env" || base === "ACCOUNTS.dev.env";
}

export function randomSecretHex(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function fillInternalSecrets(text, options = {}) {
  const generate = options.generate || randomSecretHex;
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let filled = 0;
  for (const raw of lines) {
    const stripped = raw.trim();
    if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) {
      out.push(raw);
      continue;
    }
    const eq = stripped.indexOf("=");
    const key = stripped.slice(0, eq).trim();
    const val = stripped.slice(eq + 1);
    const unquoted = val.trim().replace(/^['"]|['"]$/g, "");
    const emptyOrWeak = !unquoted || WEAK_SECRET.test(unquoted);
    if (SKIP_AUTO_SECRET.test(key)) {
      out.push(raw);
      continue;
    }
    if (SECRETISH.test(key) && emptyOrWeak) {
      out.push(`${key}=${generate()}`);
      filled += 1;
      continue;
    }
    out.push(raw);
  }
  return { text: `${out.join("\n")}${out.length ? "\n" : ""}`, filled };
}

const BANNER_INTERNAL = `# 对内密钥（库口令、服务密钥、Logto Admin）已随机生成，外网连不上库和 :3002。
# 需要排障或本机隧道登录 Admin 时，到本文件查找，不必再手填。
# 公网登录密码只改 identity/ACCOUNTS.product.env。
`;

const BANNER_PUBLIC_LOGIN = `# 公网 OIDC / 控制台登录密码：未手填则已随机生成。到本文件或安装完成后的 CSV 查找。
# 表单留空 = 保留已有值。不要用 ACCOUNTS.dev.env。
`;

export function ensureBanner(text, banner) {
  const src = String(text || "");
  const first = banner.trim().split("\n")[0];
  if (first && src.includes(first)) return src;
  return `${banner}${src.startsWith("#") || src.startsWith("\n") ? "" : "\n"}${src}`;
}

export function listEnvFiles(root) {
  const found = [];
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        walk(path);
      } else if (ent.name === ".env" || ent.name.endsWith(".env")) {
        found.push(path);
      }
    }
  }
  walk(root);
  return found;
}

/** Fill internal secrets in a packed kit. Never invent public-login passwords. */
export function fillInternalSecretsInKit(root, options = {}) {
  const generate = options.generate || randomSecretHex;
  const filledFiles = [];
  for (const envPath of listEnvFiles(root)) {
    const rel = relative(root, envPath).replace(/\\/g, "/");
    const base = rel.split("/").pop();
    let text = readFileSync(envPath, "utf8");
    if (base === "ACCOUNTS.dev.env") {
      writeFileSync(envPath, ensureBanner(text, BANNER_PUBLIC_LOGIN));
      continue;
    }
    const result = fillInternalSecrets(text, { generate });
    let next = result.text;
    if (isPublicLoginAccountsFile(rel)) {
      next = ensureBanner(next, BANNER_PUBLIC_LOGIN);
    } else if (rel === "deploy/env/control-plane.env" || rel === "identity/.env") {
      next = ensureBanner(next, BANNER_INTERNAL);
    }
    writeFileSync(envPath, next);
    if (result.filled) filledFiles.push({ file: rel, filled: result.filled });
  }
  return filledFiles;
}

export function renderEditMeList(promoted) {
  const envFiles = promoted.filter((rel) => /\.env$/i.test(rel));
  const lines = [
    "# 解压后怎么配",
    "",
    "## 公网登录（可手填，空则随机）",
    "- 安装配置页 `sudo bash install.sh`  # 表单默认填品牌域名；清空某栏才走 IP:端口",
    "- site.json                       # 勾选 products.*.enabled、源站 publicHost、hosts",
    "- identity/ACCOUNTS.product.env    # superadmin 等；未填的 *_PASSWORD 已随机生成",
    "",
    "VistaRemote 域名是 vistaremote.vistacast.dev（vistacast.dev 子域）。",
    "没有 Docker 时安装脚本会安装 Engine，不会卸载已有 Docker。端口被占用会拒绝安装。",
    "",
    "## 已随机生成（不对公网，需要时打开查看）",
    "- deploy/env/control-plane.env     # 库口令、服务密钥",
    "- identity/.env                  # LW_LOGTO_ADMIN_PASSWORD（仅 SSH 隧道 :3002）",
  ];
  const productEnvs = envFiles.filter((rel) => rel.startsWith("products/")).sort();
  if (productEnvs.length) {
    lines.push("");
    lines.push("## 产品内部 .env（库口令已生成；勾选该产品才会启动）");
    for (const rel of productEnvs) lines.push(`- ${rel}`);
  }
  lines.push("");
  lines.push("不要把密码写进 site.json。不要用 ACCOUNTS.dev.env。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
