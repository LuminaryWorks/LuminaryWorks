/**
 * Runs inside the Logto identity container. Admin API is loopback-only (:3002).
 * Do not call this from the laptop against a forwarded non-3002 port — Logto
 * rejects m-admin with oidc.invalid_client when Host does not match ADMIN_ENDPOINT.
 *
 * Env:
 *   M_ADMIN_SECRET_FILE or M_ADMIN_SECRET
 *   LW_LOGTO_ADMIN_USERNAME
 *   LW_LOGTO_ADMIN_PASSWORD
 *   LW_LOGTO_ADMIN_EMAIL (optional)
 *   LW_LOGTO_ADMIN_RESET_PASSWORD (optional)
 *   IDENTITY_ADMIN_ENDPOINT (default http://127.0.0.1:3002)
 */
"use strict";

const fs = require("node:fs");

const PLACEHOLDER = new Set(["", "CHANGE_ME", "changeme", "REPLACE_ME", "replace_me"]);
const adminEndpoint = String(
  process.env.IDENTITY_ADMIN_ENDPOINT || "http://127.0.0.1:3002",
).replace(/\/$/, "");
const username = String(process.env.LW_LOGTO_ADMIN_USERNAME || "").trim();
const password = String(process.env.LW_LOGTO_ADMIN_PASSWORD || "").trim();
const email = String(process.env.LW_LOGTO_ADMIN_EMAIL || "").trim();
const resetPassword = /^(1|true|yes|on)$/i.test(
  String(process.env.LW_LOGTO_ADMIN_RESET_PASSWORD || "").trim(),
);

function readSecret() {
  const file = process.env.M_ADMIN_SECRET_FILE;
  if (file) return fs.readFileSync(file, "utf8").trim();
  return String(process.env.M_ADMIN_SECRET || "").trim();
}

function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && typeof payload === "object" && payload.id) return [payload];
  return [];
}

async function api(token, method, path, body) {
  const res = await fetch(`${adminEndpoint}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${method} ${path} → ${res.status} ${detail}`);
  }
  return data;
}

async function main() {
  if (!username || PLACEHOLDER.has(password) || !password) {
    throw new Error("LW_LOGTO_ADMIN_USERNAME / LW_LOGTO_ADMIN_PASSWORD required");
  }
  const secret = readSecret();
  if (!secret) throw new Error("missing m-admin secret");

  const tokenRes = await fetch(`${adminEndpoint}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "m-admin",
      client_secret: secret,
      resource: "https://admin.logto.app/api",
      scope: "all",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Admin M2M token failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const token = (await tokenRes.json()).access_token;
  if (!token) throw new Error("Admin M2M token response missing access_token");

  const users = asList(await api(token, "GET", "/api/users?page=1&page_size=100"));
  let user =
    users.find((u) => u.username === username) ||
    (email ? users.find((u) => u.primaryEmail === email) : undefined);

  if (!user) {
    const body = {
      username,
      password,
      name: "Logto Admin",
      ...(email ? { primaryEmail: email } : {}),
    };
    user = await api(token, "POST", "/api/users", body);
    console.log(`+ created Admin Console user: ${username}`);
  } else {
    console.log(`= Admin Console user exists: ${username} (${user.id})`);
    if (email && user.primaryEmail !== email) {
      user = await api(token, "PATCH", `/api/users/${user.id}`, { primaryEmail: email });
      console.log(`~ updated primaryEmail → ${email}`);
    }
    if (resetPassword) {
      await api(token, "PATCH", `/api/users/${user.id}/password`, { password });
      console.log("~ password reset (LW_LOGTO_ADMIN_RESET_PASSWORD=1)");
    }
  }

  const members = asList(
    await api(token, "GET", "/api/organizations/t-default/users?page=1&page_size=100"),
  );
  if (!members.some((u) => u.id === user.id)) {
    await api(token, "POST", "/api/organizations/t-default/users", { userIds: [user.id] });
    console.log("+ added to organization t-default");
  }
  try {
    await api(token, "POST", "/api/organizations/t-default/users/roles", {
      userIds: [user.id],
      organizationRoleIds: ["admin"],
    });
    console.log("+ organization role admin");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/\b422\b/.test(msg) && !/already|exist/i.test(msg)) throw e;
    console.log("= organization role admin already set");
  }

  const roles = asList(await api(token, "GET", "/api/roles?type=User&page=1&page_size=50"));
  const needed = ["user", "default:admin"];
  const roleIds = needed.map((name) => roles.find((r) => r.name === name)?.id).filter(Boolean);
  if (roleIds.length === 0) {
    throw new Error('Admin tenant missing roles "user" / "default:admin"');
  }
  const existing = asList(await api(token, "GET", `/api/users/${user.id}/roles`));
  const existingIds = new Set(existing.map((r) => r.id));
  const missing = roleIds.filter((id) => !existingIds.has(id));
  if (missing.length === 0) {
    console.log("= user roles ok:", needed.join(", "));
  } else {
    await api(token, "POST", `/api/users/${user.id}/roles`, { roleIds: missing });
    console.log("+ assigned user roles:", needed.join(", "));
  }

  await api(token, "PATCH", `/api/users/${user.id}/custom-data`, {
    customData: {
      ossOnboarding: { isOnboardingDone: true },
      onboarding: { isOnboardingDone: true },
    },
  });
  console.log("+ OSS onboarding marked done");
  await api(token, "PATCH", "/api/sign-in-exp", { signInMode: "SignIn" });
  console.log("= admin sign-in mode: SignIn");
  console.log(`✓ Logto Admin Console operator ready: ${username}`);
  console.log(`  Console: ${adminEndpoint}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
