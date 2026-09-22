/**
 * Block AI crawlers at the Cloudflare edge for product zones.
 *
 * Does not change DNS proxy, SSL, or Bot Fight Mode.
 * Search crawlers (Googlebot, bingbot, Applebot) are not in this ruleset.
 *
 *   CF_API_TOKEN=... node scripts/setup-cloudflare-ai-block.mjs
 *   node scripts/setup-cloudflare-ai-block.mjs --what-if
 *
 * Token: Zone · Zone Read, DNS Read, Bot Management Edit.
 * https://dash.cloudflare.com/profile/api-tokens
 *
 * If a token was ever pasted into a terminal or chat, revoke it and create a new one.
 */
const ZONES = [
  "luminaryworks.dev",
  "dataluminary.dev",
  "doerflow.dev",
  "vistacast.dev",
  "blockyedu.com",
  "syncrobrain.com",
];

/** New Security Settings model (preferred). */
const NEW_POLICY = {
  ai_training: "block",
  ai_search: "block",
  ai_user: "block",
  is_robots_txt_managed: true,
};

/** Legacy "Block AI bots" toggle. */
const LEGACY_POLICY = {
  ai_bots_protection: "block",
  is_robots_txt_managed: true,
};

const whatIf = process.argv.includes("--what-if");
const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";

if (!token && !whatIf) {
  console.error(
    "缺少 CF_API_TOKEN。到 Cloudflare → My Profile → API Tokens 新建令牌，权限：Zone Read、DNS Read、Bot Management Edit。",
  );
  process.exit(1);
}

async function cf(path, method = "GET", body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { ok: response.ok && json.success, status: response.status, json };
}

function errorsOf(json) {
  const errors = json.errors || [];
  return errors.map((error) => `${error.code || ""} ${error.message || ""}`.trim()).join("; ");
}

function pick(result) {
  const keys = [
    "ai_bots_protection",
    "ai_training",
    "ai_search",
    "ai_user",
    "is_robots_txt_managed",
    "crawler_protection",
  ];
  const out = {};
  for (const key of keys) {
    if (result && Object.hasOwn(result, key)) out[key] = result[key];
  }
  return out;
}

function blockingOn(result) {
  if (!result) return false;
  if (result.ai_bots_protection === "block") return true;
  if (result.ai_training === "block") return true;
  if (result.ai_search === "block" && result.ai_user === "block") return true;
  return false;
}

async function zoneId(domain) {
  const { ok, json } = await cf(`/zones?name=${encodeURIComponent(domain)}`);
  if (!ok) throw new Error(errorsOf(json) || "列出 zone 失败");
  return json.result?.[0]?.id || null;
}

async function docsProxy(id, domain) {
  const name = `docs.${domain}`;
  const { ok, json } = await cf(
    `/zones/${id}/dns_records?name=${encodeURIComponent(name)}`,
  );
  if (!ok) return { name, state: `查询失败 ${errorsOf(json)}` };
  const record = (json.result || []).find((item) => item.name === name);
  if (!record) return { name, state: "没有这条 DNS" };
  return {
    name,
    state: record.proxied
      ? "经过 Cloudflare"
      : "仅 DNS，边缘拦截不会作用在这个主机名",
  };
}

async function putPolicy(id, body) {
  return cf(`/zones/${id}/bot_management`, "PUT", body);
}

async function applyZone(domain) {
  if (whatIf) {
    console.log(`${domain}: what-if，将设置 AI 训练/搜索/助手爬虫为 block`);
    return { ok: true };
  }
  const id = await zoneId(domain);
  if (!id) {
    console.log(`${domain}: Cloudflare 上没有这个 zone，跳过`);
    return { ok: true };
  }
  const proxy = await docsProxy(id, domain);
  const current = await cf(`/zones/${id}/bot_management`);
  if (!current.ok) {
    console.log(
      `${domain}: 读不到 Bot Management（${errorsOf(current.json)}）。${proxy.name} ${proxy.state}`,
    );
    return { ok: false };
  }
  const before = pick(current.json.result);

  let update = await putPolicy(id, NEW_POLICY);
  let mode = "new";
  if (!update.ok) {
    update = await putPolicy(id, LEGACY_POLICY);
    mode = "legacy";
  }
  if (!update.ok) {
    console.log(
      `${domain}: 设置失败（${errorsOf(update.json)}）。${proxy.name} ${proxy.state}`,
    );
    return { ok: false };
  }

  const after = pick(update.json.result);
  const blocked = blockingOn(update.json.result);
  const status = blocked ? "拦截已开" : "拦截未开";
  console.log(
    `${domain}: ${status} (${mode}) before=${JSON.stringify(before)} after=${JSON.stringify(after)}. ${proxy.name} ${proxy.state}`,
  );
  return { ok: blocked };
}

let failed = 0;
for (const domain of ZONES) {
  try {
    const result = await applyZone(domain);
    if (!result.ok) failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`${domain}: ${error.message}`);
  }
}

if (!whatIf && failed > 0) {
  console.error(
    `\n有 ${failed} 个 zone 没有真正打开 AI 拦截。只开托管 robots.txt 不够。请到 Cloudflare → 域名 → Security → Settings → Configure AI bot policies，把 Training / Agent / Search 都设为 Block。`,
  );
  process.exit(1);
}
