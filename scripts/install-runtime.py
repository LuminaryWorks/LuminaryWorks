#!/usr/bin/env python3
"""First-install runtime: public URLs, IdP seed, product env, one-click accept.

Target hosts have Python 3 and Docker, not Node. Identity register/seed run in
a node:24 container. Acceptance is HTTP health plus IdP password login.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlencode, urljoin

WEAK = re.compile(r"change[-_]?me|LuminaryDev|logto_dev_password|password123|changeme", re.I)
PLACEHOLDER_HOST = re.compile(r"^$|REPLACE_|example\.com$", re.I)
NODE_IMAGE = os.environ.get("LW_NODE_IMAGE", "node:24-bookworm")
IP_HOST = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")

# Browser-facing HTTP ports for a single-IP private install (no TLS reverse proxy).
ENDPOINTS = {
    "control-plane": [
        {"name": "identity-oidc", "port": 3001, "path": "/oidc/.well-known/openid-configuration"},
        {"name": "auth-gateway-ready", "port": 3010, "path": "/ready"},
        {"name": "entitlement-ready", "port": 3040, "path": "/ready"},
        {"name": "control-console-health", "port": 3050, "path": "/health"},
        {"name": "control-console", "port": 3050, "path": "/", "login": True, "account": "control-plane"},
    ],
    "dataluminary": [
        {"name": "dataluminary-web", "port": 3018, "path": "/", "login": True, "account": "dataluminary"},
    ],
    "blockyedu": [
        {"name": "blockyedu-gateway-health", "port": 8080, "path": "/healthz"},
        {"name": "blockyedu-lms", "port": 8080, "path": "/login", "login": True, "account": "blockyedu"},
    ],
    "doerflow": [
        {"name": "doerflow-api-live", "port": 13008, "path": "/api/v1/live"},
        {"name": "doerflow-web", "port": 5174, "path": "/", "login": True, "account": "doerflow"},
        {"name": "doerflow-admin", "port": 13011, "path": "/health"},
    ],
    "vistacast": [
        {"name": "vistacast-api-health", "port": 13100, "path": "/health"},
        {"name": "vistacast-web", "port": 13101, "path": "/", "login": True, "account": "vistacast"},
    ],
    "vistaremote": [
        {"name": "vistaremote-api-health", "port": 15200, "path": "/health"},
        {"name": "vistaremote-client", "port": 5173, "path": "/login", "login": True, "account": "vistaremote", "optional": True},
        {"name": "vistaremote-admin", "port": 5175, "path": "/login", "login": True, "account": "vistaremote", "optional": True},
    ],
    "syncrobrain": [
        {"name": "syncrobrain-gateway-ready", "port": 13200, "path": "/api/v1/ready"},
        {"name": "syncrobrain-console", "port": 15180, "path": "/", "login": True, "account": "syncrobrain"},
    ],
}

LOGIN_ACCOUNTS = {
    "control-plane": {
        "usernameKey": "LW_SUPER_ADMIN_USERNAME",
        "passwordKey": "LW_SUPER_ADMIN_PASSWORD",
        "emailKey": "LW_SUPER_ADMIN_EMAIL",
    },
    "dataluminary": {
        "usernameKey": "LW_ADMIN_DATALUMINARY_USERNAME",
        "passwordKey": "LW_ADMIN_DATALUMINARY_PASSWORD",
        "emailKey": "LW_ADMIN_DATALUMINARY_EMAIL",
    },
    "blockyedu": {
        "usernameKey": "LW_ADMIN_BLOCKYEDU_USERNAME",
        "passwordKey": "LW_ADMIN_BLOCKYEDU_PASSWORD",
        "emailKey": "LW_ADMIN_BLOCKYEDU_EMAIL",
    },
    "doerflow": {
        "usernameKey": "LW_ADMIN_DOERFLOW_USERNAME",
        "passwordKey": "LW_ADMIN_DOERFLOW_PASSWORD",
        "emailKey": "LW_ADMIN_DOERFLOW_EMAIL",
    },
    "vistaremote": {
        "usernameKey": "LW_ADMIN_VISTAREMOTE_USERNAME",
        "passwordKey": "LW_ADMIN_VISTAREMOTE_PASSWORD",
        "emailKey": "LW_ADMIN_VISTAREMOTE_EMAIL",
    },
    "vistacast": {
        "usernameKey": "LW_ADMIN_VISTACAST_USERNAME",
        "passwordKey": "LW_ADMIN_VISTACAST_PASSWORD",
        "emailKey": "LW_ADMIN_VISTACAST_EMAIL",
    },
    "syncrobrain": {
        "usernameKey": "LW_ADMIN_SYNCROBRAIN_USERNAME",
        "passwordKey": "LW_ADMIN_SYNCROBRAIN_PASSWORD",
        "emailKey": "LW_ADMIN_SYNCROBRAIN_EMAIL",
    },
}

SPA_REDIRECTS = [
    ("LuminaryWorks Control Console", 3050, "/", "/auth/callback", "control-plane"),
    ("DataView (DataLuminary)", 3018, "/", "/auth/callback", "dataluminary"),
    ("VibeEdu edu-app-web", 8080, "/login", "/auth/callback", "blockyedu"),
    ("VibeAgent Web", 5174, "/login", "/auth/callback", "doerflow"),
    ("DoerFlow Admin", 13011, "/login", "/auth/callback", "doerflow-admin"),
    ("VistaCast Admin", 13101, "/", "/auth/callback", "vistacast"),
    ("VistaRemote Client", 5173, "/login", "/auth/callback", "vistaremote"),
    ("VistaRemote Admin", 5175, "/login", "/auth/callback", "vistaremote"),
    ("LuminaryIoTChain iot-console-web", 15180, "/login", "/auth/callback", "syncrobrain"),
]

PRODUCT_HTTP_PORTS = {
    "control-plane": 3050,
    "dataluminary": 3018,
    "blockyedu": 8080,
    "doerflow": 5174,
    "doerflow-admin": 13011,
    "vistacast": 13101,
    "vistaremote": 15200,
    "syncrobrain": 15180,
}

HOST_ALIASES = {
    "control-plane": ["www", "console"],
    "dataluminary": ["www", "app"],
    "blockyedu": ["www"],
    "doerflow": ["www"],
    "vistacast": ["www"],
    "syncrobrain": ["www"],
}

BIND_ENV = {
    "DATALUMINARY_BIND_HOST": "0.0.0.0",
    "GATEWAY_BIND_ADDRESS": "0.0.0.0",
    "DOERFLOW_WEB_BIND": "0.0.0.0",
    "DOERFLOW_ADMIN_BIND": "0.0.0.0",
    "CONSOLE_BIND_ADDR": "0.0.0.0",
    "GATEWAY_BIND_ADDR": "0.0.0.0",
    "TB_BIND_ADDR": "0.0.0.0",
    "VR_SERVER_HOST_PORT": "15200",
    "AI_MODE": "off",
}


def parse_env(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in str(text or "").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, val = stripped.split("=", 1)
        out[key.strip()] = val.strip().strip('"').strip("'")
    return out


def patch_env(text: str, updates: dict[str, str]) -> str:
    lines = str(text or "").splitlines()
    seen: set[str] = set()
    out: list[str] = []
    for raw in lines:
        stripped = raw.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        out.append(raw)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    return "\n".join(out) + ("\n" if out else "")


def write_env_updates(path: Path, updates: dict[str, str]) -> None:
    if not updates:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    prev = path.read_text(encoding="utf-8") if path.is_file() else ""
    path.write_text(patch_env(prev, updates), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def load_json(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def public_base(protocol: str, host: str) -> str:
    host = str(host or "").rstrip("/")
    if host.startswith("http://") or host.startswith("https://"):
        return host
    return f"{protocol}://{host}"


def is_ip_host(host: str) -> bool:
    return bool(IP_HOST.match(str(host or "").split(":")[0]))


def detect_advertise_host() -> str:
    env_host = os.environ.get("INSTALL_ADVERTISE_HOST") or os.environ.get("PUBLIC_HOST") or ""
    if env_host and not PLACEHOLDER_HOST.search(env_host):
        return env_host.strip()
    for args in (
        ["curl", "-fsS", "--max-time", "2", "https://ifconfig.me"],
        ["curl", "-fsS", "--max-time", "2", "https://api.ipify.org"],
    ):
        try:
            out = subprocess.check_output(args, encoding="utf-8", stderr=subprocess.DEVNULL).strip()
            if IP_HOST.match(out):
                return out
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    try:
        out = subprocess.check_output(["hostname", "-I"], encoding="utf-8").split()
        if out:
            return out[0]
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return "127.0.0.1"


def enabled_products(kit: Path) -> list[str]:
    site = load_json(kit / "site.json", {})
    products = site.get("products") or {}
    out = []
    if bool((products.get("control-plane") or {}).get("enabled", True)):
        out.append("control-plane")
    for name in ("dataluminary", "blockyedu", "doerflow", "vistaremote", "vistacast", "syncrobrain"):
        if bool((products.get(name) or {}).get("enabled")):
            out.append(name)
    return out


def site_public(kit: Path) -> tuple[str, str]:
    site = load_json(kit / "site.json", {})
    host = str(site.get("publicHost") or "").strip()
    protocol = str(site.get("protocol") or "http").strip() or "http"
    if not host or PLACEHOLDER_HOST.search(host):
        host = detect_advertise_host()
    return protocol, host


def is_dns_name(host: str) -> bool:
    value = str(host or "").strip().lower()
    return bool(value) and not IP_HOST.match(value) and "." in value


def load_default_hosts(kit: Path) -> dict[str, str]:
    for path in (
        kit / "hosts.defaults.json",
        kit / "deploy" / "luminaryworks-install" / "hosts.defaults.json",
    ):
        raw = load_json(path, {})
        if raw:
            return {
                str(item.get("id") or "").strip(): str(item.get("host") or "").strip().lower()
                for item in (raw.get("products") or [])
                if item and item.get("id") and item.get("host")
            }
    return {}


def load_site_hosts(kit: Path) -> dict[str, str]:
    defaults = load_default_hosts(kit)
    site = load_json(kit / "site.json", {})
    public_host = str(site.get("publicHost") or "").strip()
    incoming = site.get("hosts") if isinstance(site.get("hosts"), dict) else {}
    names = (
        "control-plane",
        "dataluminary",
        "blockyedu",
        "doerflow",
        "vistaremote",
        "vistacast",
        "syncrobrain",
    )
    hosts: dict[str, str] = {}
    for name in names:
        if name in incoming:
            raw = str(incoming.get(name) or "").strip().lower()
            hosts[name] = raw or public_host
        else:
            hosts[name] = defaults.get(name) or public_host
    if incoming.get("doerflow-admin"):
        hosts["doerflow-admin"] = str(incoming.get("doerflow-admin")).strip().lower()
    else:
        hosts["doerflow-admin"] = hosts.get("doerflow") or public_host
    return hosts


def identity_public_host(hosts: dict[str, str]) -> str:
    control = str((hosts or {}).get("control-plane") or "").strip().lower()
    if not control:
        return ""
    if control.startswith("login."):
        return control
    return f"login.{control}"


def browser_origin(protocol: str, public_host: str, hosts: dict[str, str] | None, product: str, port: int) -> str:
    name = str((hosts or {}).get(product) or "").strip()
    if is_dns_name(name):
        return f"{protocol}://{name}"
    return f"{public_base(protocol, public_host)}:{port}"


def identity_origin(protocol: str, public_host: str, hosts: dict[str, str] | None) -> str:
    name = identity_public_host(hosts or {})
    if is_dns_name(name):
        return f"{protocol}://{name}"
    return f"{public_base(protocol, public_host)}:3001"


def public_url_plan(kit: Path) -> dict:
    protocol, host = site_public(kit)
    hosts = load_site_hosts(kit)
    identity = identity_origin(protocol, host, hosts)
    console = browser_origin(protocol, host, hosts, "control-plane", 3050)
    base = public_base(protocol, host)
    enabled = enabled_products(kit)
    ip_access = not any(is_dns_name(hosts.get(name, "")) for name in enabled)
    return {
        "protocol": protocol,
        "publicHost": host,
        "ipAccess": ip_access,
        "IDENTITY_ENDPOINT": identity,
        "IDP_ISSUER": f"{identity}/oidc",
        "IDENTITY_ADMIN_ENDPOINT": "http://127.0.0.1:3002",
        "AUTH_GATEWAY_PUBLIC_URL": f"{base}:3010",
        "ENTITLEMENT_OIDC_ISSUER": f"{identity}/oidc",
        "CONTROL_CONSOLE_PUBLIC_URL": console,
        "CONTROL_CONSOLE_IDP_ISSUER": f"{identity}/oidc",
        "CONTROL_CONSOLE_ENTITLEMENT_BASE_URL": f"{base}:3040",
        "CONTROL_CONSOLE_AUTH_EXPERIENCE_URL": identity,
        "ENTITLEMENT_CORS_ORIGINS": f"{console},http://127.0.0.1:3050",
    }


OUR_COMPOSE_PROJECTS = {
    "luminary-control-plane",
    "lw-ingress",
    "lw-vistacast",
    "lw-syncrobrain",
    "lw-doerflow",
    "lw-vistaremote",
    "lw-dataluminary",
    "lw-blockyedu",
}


def compose_project_ours(name: str) -> bool:
    value = str(name or "").strip().lower()
    if not value:
        return False
    if value in OUR_COMPOSE_PROJECTS:
        return True
    return value.startswith("lw-") or value.startswith("luminary-control-plane")


def required_listen_ports(kit: Path) -> list[tuple[int, str]]:
    enabled = enabled_products(kit)
    hosts = load_site_hosts(kit)
    ports: dict[int, str] = {}
    for product in enabled:
        for item in ENDPOINTS.get(product, []):
            if item.get("optional"):
                continue
            ports[int(item["port"])] = str(item["name"])
    if any(is_dns_name(hosts.get(name, "")) for name in enabled):
        ports[80] = "ingress"
    return sorted(ports.items())


def parse_docker_published_ports(ports_field: str) -> list[int]:
    found = set()
    for match in re.finditer(r":(\d+)->", str(ports_field or "")):
        found.add(int(match.group(1)))
    return sorted(found)


def docker_port_holders() -> dict[int, dict]:
    holders: dict[int, dict] = {}
    result = docker(
        "ps",
        "--format",
        "{{.Names}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Ports}}",
        check=False,
    )
    if result.returncode != 0:
        return holders
    for line in (result.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        name, project, ports_field = parts[0], parts[1], parts[2]
        for port in parse_docker_published_ports(ports_field):
            holders[port] = {
                "name": name,
                "project": project,
                "ours": compose_project_ours(project) or compose_project_ours(name),
            }
    return holders


def host_listening_tcp_ports() -> dict[int, str]:
    ports: dict[int, str] = {}
    try:
        out = subprocess.check_output(["ss", "-lntH"], encoding="utf-8", stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        out = ""
    for line in out.splitlines():
        local = ""
        for part in line.split():
            if ":" in part:
                local = part
        if not local:
            continue
        port_s = local.rsplit(":", 1)[-1].rstrip("]")
        if port_s.isdigit():
            ports[int(port_s)] = local
    return ports


def check_host_ports(kit: Path) -> dict:
    required = required_listen_ports(kit)
    docker_holders = docker_port_holders()
    listening = host_listening_tcp_ports()
    conflicts = []
    for port, role in required:
        holder = docker_holders.get(port)
        if holder and holder.get("ours"):
            continue
        if holder and not holder.get("ours"):
            conflicts.append(
                {
                    "port": port,
                    "role": role,
                    "holder": holder.get("name"),
                    "project": holder.get("project"),
                    "message": f"port {port} ({role}) is already published by Docker container {holder.get('name')} (project {holder.get('project') or 'unknown'}). Refusing to take it.",
                }
            )
            continue
        if port in listening:
            conflicts.append(
                {
                    "port": port,
                    "role": role,
                    "holder": listening[port],
                    "message": f"port {port} ({role}) is already listening on {listening[port]}. Refusing to conflict with an existing service.",
                }
            )
    return {
        "ok": not conflicts,
        "ports": [{"port": port, "role": role} for port, role in required],
        "conflicts": conflicts,
    }


def http_get(url: str, timeout: float = 8.0) -> tuple[int, str]:
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "luminaryworks-accept"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8", "replace")
            return res.status, body
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace") if err.fp else ""
        return err.code, body
    except Exception as err:
        return 0, str(err)


def wait_http_ok(url: str, timeout_sec: int = 180) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        status, _ = http_get(url, timeout=5)
        if 200 <= status < 400:
            return True
        time.sleep(3)
    return False


def docker(*args: str, input_text: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", *args],
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
    )


def find_container(suffix: str) -> str:
    result = docker("ps", "--format", "{{.Names}}", check=False)
    names = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    for name in names:
        if name.endswith(suffix) or suffix in name:
            return name
    raise RuntimeError(f"container not found: {suffix}")


def patch_apps_redirects(kit: Path, protocol: str, host: str, hosts: dict[str, str] | None = None) -> None:
    path = kit / "identity" / "apps.json"
    catalog = load_json(path, {})
    if not catalog:
        return
    by_name = {item["name"]: item for item in catalog.get("spaApplications") or [] if item.get("name")}
    for name, port, logout_path, callback_path, product in SPA_REDIRECTS:
        app = by_name.get(name)
        if not app:
            continue
        origin = browser_origin(protocol, host, hosts, product, port)
        redirects = list(app.get("redirectUris") or [])
        logouts = list(app.get("postLogoutRedirectUris") or [])
        callback = f"{origin}{callback_path}"
        logout = f"{origin}{logout_path}"
        if callback not in redirects:
            redirects.append(callback)
        if logout not in logouts:
            logouts.append(logout)
        app["redirectUris"] = redirects
        app["postLogoutRedirectUris"] = logouts
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def product_idp_updates(
    protocol: str,
    host: str,
    spa: dict,
    hosts: dict[str, str] | None = None,
) -> dict[str, dict[str, str]]:
    """Relative kit paths → env updates. Client IDs come from registered-apps.json."""
    issuer = f"{identity_origin(protocol, host, hosts)}/oidc"
    origin = lambda product, port: browser_origin(protocol, host, hosts, product, port)
    files: dict[str, dict[str, str]] = {}

    def add(rel: str, keys: dict[str, str]) -> None:
        files.setdefault(rel, {}).update(keys)

    console = origin("control-plane", 3050)
    idp = identity_origin(protocol, host, hosts)
    idp_host = identity_public_host(hosts or {}) or host
    add(
        "apps/control-console/.env",
        {
            "IDP_ISSUER": issuer,
            "VITE_IDP_ISSUER": issuer,
            "CONTROL_CONSOLE_IDP_ISSUER": issuer,
            "CONTROL_CONSOLE_PUBLIC_URL": console,
            "CONTROL_CONSOLE_IDP_CLIENT_ID": spa.get("LuminaryWorks Control Console") or "",
            "IDP_CLIENT_ID": spa.get("LuminaryWorks Control Console") or "",
            "VITE_IDP_CLIENT_ID": spa.get("LuminaryWorks Control Console") or "",
            "VITE_IDP_REDIRECT_URI": f"{console}/auth/callback",
            "VITE_IDP_POST_LOGOUT_URI": f"{console}/",
            "VITE_AUTH_EXPERIENCE_URL": console,
        },
    )

    add(
        "deploy/env/control-plane.env",
        {
            "CONTROL_CONSOLE_PUBLIC_URL": console,
            "CONTROL_CONSOLE_IDP_ISSUER": issuer,
            "CONTROL_CONSOLE_IDP_CLIENT_ID": spa.get("LuminaryWorks Control Console") or "",
            "CONTROL_CONSOLE_AUTH_EXPERIENCE_URL": idp,
            "CONTROL_CONSOLE_ENTITLEMENT_BASE_URL": f"{public_base(protocol, host)}:3040",
            "IDENTITY_ENDPOINT": idp,
            "ENTITLEMENT_OIDC_ISSUER": issuer,
            "AUTH_GATEWAY_PUBLIC_URL": f"{public_base(protocol, host)}:3010",
            "ENTITLEMENT_CORS_ORIGINS": ",".join(
                sorted(
                    {
                        console,
                        f"{public_base(protocol, host)}:3050",
                        "http://127.0.0.1:3050",
                    }
                )
            ),
        },
    )

    dl = origin("dataluminary", 3018)
    dl_env = {
        "DATALUMINARY_BIND_HOST": "0.0.0.0",
        "DATALUMINARY_WEB_PORT": "3018",
        "IDP_MODE": "logto",
        "IDP_ISSUER": issuer,
        "IDP_AUDIENCE": "https://api.dataluminary.local",
        "VITE_IDP_ISSUER": issuer,
        "VITE_IDP_CLIENT_ID": spa.get("DataView (DataLuminary)") or "",
        "VITE_IDP_AUDIENCE": "https://api.dataluminary.local",
        "VITE_IDP_REDIRECT_URI": f"{dl}/auth/callback",
        "VITE_IDP_POST_LOGOUT_URI": f"{dl}/",
        "VITE_AUTH_EXPERIENCE_URL": dl,
        "IDP_UPSTREAM": "host.docker.internal:3001",
        "IDP_HOST": idp_host if is_dns_name(idp_host) else f"{host}:3001",
        "ENTITLEMENT_MODE": "off",
    }
    add("products/dataluminary/.env", dl_env)
    add("products/dataluminary/deploy/standalone/.env", dl_env)

    edu = origin("blockyedu", 8080)
    add("products/blockyedu/.env", {
            "GATEWAY_BIND_ADDRESS": "0.0.0.0",
            "GATEWAY_PORT": "8080",
            "AI_MODE": "off",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "NEXT_PUBLIC_IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vibeedu.local",
            "OIDC_CLIENT_ID": spa.get("VibeEdu edu-app-web") or "",
            "NEXT_PUBLIC_IDP_CLIENT_ID": spa.get("VibeEdu edu-app-web") or "",
            "OIDC_REDIRECT_URI": f"{edu}/auth/callback",
            "NEXT_PUBLIC_IDP_REDIRECT_URI": f"{edu}/auth/callback",
            "OIDC_POST_LOGOUT_URI": f"{edu}/login",
            "FRONTEND_URL": f"{edu}/",
            "OIDC_ALLOWED_RETURN_URLS": f"{edu}/auth/callback,{edu}/login,{edu}/",
            "NEXT_PUBLIC_AUTH_EXPERIENCE_URL": edu,
            "NEXT_PUBLIC_APP_ORIGIN": edu,
            "ALLOW_LOCAL_LOGIN": "false",
        })
    add("products/blockyedu/deploy/edu/.env", {
            "GATEWAY_BIND_ADDRESS": "0.0.0.0",
            "GATEWAY_PORT": "8080",
            "AI_MODE": "off",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "NEXT_PUBLIC_IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vibeedu.local",
            "OIDC_CLIENT_ID": spa.get("VibeEdu edu-app-web") or "",
            "NEXT_PUBLIC_IDP_CLIENT_ID": spa.get("VibeEdu edu-app-web") or "",
            "OIDC_REDIRECT_URI": f"{edu}/auth/callback",
            "NEXT_PUBLIC_IDP_REDIRECT_URI": f"{edu}/auth/callback",
            "OIDC_POST_LOGOUT_URI": f"{edu}/login",
            "FRONTEND_URL": f"{edu}/",
            "OIDC_ALLOWED_RETURN_URLS": f"{edu}/auth/callback,{edu}/login,{edu}/",
            "NEXT_PUBLIC_AUTH_EXPERIENCE_URL": edu,
            "NEXT_PUBLIC_APP_ORIGIN": edu,
            "ALLOW_LOCAL_LOGIN": "false",
        },
    )

    web = origin("doerflow", 5174)
    admin = origin("doerflow-admin", 13011)
    add(
        "products/doerflow/deploy/env/web.env",
        {
            "VITE_API_URL": "",
            "VITE_IDP_ISSUER": issuer,
            "PUBLIC_IDP_ISSUER": issuer,
            "VITE_IDP_CLIENT_ID": spa.get("VibeAgent Web") or "",
            "PUBLIC_IDP_CLIENT_ID": spa.get("VibeAgent Web") or "",
            "PUBLIC_IDP_REDIRECT_URI": f"{web}/auth/callback",
            "PUBLIC_AUTH_EXPERIENCE_URL": web,
            "PUBLIC_IDP_AUDIENCE": "https://api.vibeagent.local",
        },
    )
    add(
        "products/doerflow/repos/web/.env",
        {
            "VITE_API_URL": "",
        },
    )
    add(
        "products/doerflow/deploy/env/admin.env",
        {
            "NEXT_PUBLIC_IDP_ISSUER": issuer,
            "NEXT_PUBLIC_IDP_CLIENT_ID": spa.get("DoerFlow Admin") or "",
            "NEXT_PUBLIC_IDP_REDIRECT_URI": f"{admin}/auth/callback",
            "NEXT_PUBLIC_AUTH_EXPERIENCE_URL": admin,
            "NEXT_PUBLIC_APP_ORIGIN": admin,
            "NEXT_PUBLIC_IDP_AUDIENCE": "https://api.vibeagent.local",
        },
    )
    add(
        "products/doerflow/.env",
        {
            "DOERFLOW_WEB_BIND": "0.0.0.0",
            "DOERFLOW_ADMIN_BIND": "0.0.0.0",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vibeagent.local",
            "ENTITLEMENT_MODE": "off",
            "DB_SYNCHRONIZE": "true",
            "DB_MIGRATIONS_RUN": "false",
            "CORS_ORIGIN": f"{web},{admin}",
            "SIWE_DOMAIN": host,
            "SIWE_URI": f"{public_base(protocol, host)}:13008",
        },
    )
    add(
        "products/doerflow/deploy/.env",
        {
            "DOERFLOW_WEB_BIND": "0.0.0.0",
            "DOERFLOW_ADMIN_BIND": "0.0.0.0",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vibeagent.local",
            "ENTITLEMENT_MODE": "off",
            "DB_SYNCHRONIZE": "true",
            "DB_MIGRATIONS_RUN": "false",
            "CORS_ORIGIN": f"{web},{admin}",
            "SIWE_DOMAIN": host,
            "SIWE_URI": f"{public_base(protocol, host)}:13008",
        },
    )
    add(
        "products/doerflow/deploy/env/api.env",
        {
            "DB_SYNCHRONIZE": "true",
            "DB_MIGRATIONS_RUN": "false",
            "LEDGER_STORE": "postgres",
            "CORS_ORIGIN": f"{web},{admin}",
            "SIWE_DOMAIN": host,
            "SIWE_URI": f"{public_base(protocol, host)}:13008",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vibeagent.local",
        },
    )
    add(
        "products/doerflow/deploy/env/indexer.env",
        {
            "DB_SYNCHRONIZE": "true",
            "DB_MIGRATIONS_RUN": "false",
            "LEDGER_STORE": "postgres",
        },
    )

    vc = origin("vistacast", 13101)
    vc_api = f"{public_base(protocol, host)}:13100"
    add("products/vistacast/.env", {
            "PUBLIC_HOST": host,
            "CORS_ORIGIN": f"{vc},{vc_api}",
            "PUBLIC_API_URL": vc_api,
            "SIGNALING_PUBLIC_URL": f"ws://{host}:13100/v1/signaling",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "PUBLIC_IDP_ISSUER": issuer,
            "PUBLIC_IDP_CLIENT_ID": spa.get("VistaCast Admin") or "",
            "PUBLIC_IDP_REDIRECT_URI": f"{vc}/auth/callback",
            "PUBLIC_IDP_POST_LOGOUT_URI": f"{vc}/",
            "PUBLIC_AUTH_EXPERIENCE_URL": vc,
            "PUBLIC_IDP_AUDIENCE": "https://api.vistacast.local",
            "IDP_AUDIENCE": "https://api.vistacast.local",
            "ENTITLEMENT_MODE": "off",
        })
    add("products/vistacast/deploy/.env", {
            "PUBLIC_HOST": host,
            "CORS_ORIGIN": f"{vc},{vc_api}",
            "PUBLIC_API_URL": vc_api,
            "SIGNALING_PUBLIC_URL": f"ws://{host}:13100/v1/signaling",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "PUBLIC_IDP_ISSUER": issuer,
            "PUBLIC_IDP_CLIENT_ID": spa.get("VistaCast Admin") or "",
            "PUBLIC_IDP_REDIRECT_URI": f"{vc}/auth/callback",
            "PUBLIC_IDP_POST_LOGOUT_URI": f"{vc}/",
            "PUBLIC_AUTH_EXPERIENCE_URL": vc,
            "PUBLIC_IDP_AUDIENCE": "https://api.vistacast.local",
            "IDP_AUDIENCE": "https://api.vistacast.local",
            "ENTITLEMENT_MODE": "off",
        },
    )

    vr_api = f"{host}:15200"
    vr_web = origin("vistaremote", 5173)
    vr_admin = origin("vistaremote", 5175)
    add(
        "products/vistaremote/.env",
        {
            "VR_SERVER_HOST_PORT": "15200",
            "PUBLIC_WEB_URL": vr_web,
            "PUBLIC_API_HOST": vr_api,
            "PUBLIC_SIGNALING_HOST": vr_api,
            "PUBLIC_SIGNALING_PROTO": "ws",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vistaremote.local",
            "IDP_JWKS_URI": f"{issuer}/jwks",
            "ENTITLEMENT_MODE": "off",
        },
    )
    add(
        "products/vistaremote/deploy/compose/.env",
        {
            "VR_SERVER_HOST_PORT": "15200",
            "PUBLIC_WEB_URL": vr_web,
            "PUBLIC_API_HOST": vr_api,
            "PUBLIC_SIGNALING_HOST": vr_api,
            "PUBLIC_SIGNALING_PROTO": "ws",
            "IDP_MODE": "logto",
            "IDP_ISSUER": issuer,
            "IDP_AUDIENCE": "https://api.vistaremote.local",
            "IDP_JWKS_URI": f"{issuer}/jwks",
            "ENTITLEMENT_MODE": "off",
        },
    )
    add(
        "products/vistaremote/web/apps/client/.env",
        {
            "PUBLIC_IDP_ISSUER": issuer,
            "VITE_IDP_ISSUER": issuer,
            "PUBLIC_IDP_CLIENT_ID": spa.get("VistaRemote Client") or "",
            "VITE_IDP_CLIENT_ID": spa.get("VistaRemote Client") or "",
            "PUBLIC_IDP_REDIRECT_URI": f"{vr_web}/auth/callback",
            "PUBLIC_AUTH_EXPERIENCE_URL": vr_web,
            "PUBLIC_IDP_AUDIENCE": "https://api.vistaremote.local",
        },
    )
    add(
        "products/vistaremote/web/apps/admin/.env",
        {
            "PUBLIC_IDP_ISSUER": issuer,
            "PUBLIC_IDP_CLIENT_ID": spa.get("VistaRemote Admin") or "",
            "PUBLIC_IDP_REDIRECT_URI": f"{vr_admin}/auth/callback",
            "PUBLIC_AUTH_EXPERIENCE_URL": vr_admin,
            "PUBLIC_IDP_AUDIENCE": "https://api.vistaremote.local",
        },
    )

    sb = origin("syncrobrain", 15180)
    add("products/syncrobrain/.env", {
            "CONSOLE_BIND_ADDR": "0.0.0.0",
            "GATEWAY_BIND_ADDR": "0.0.0.0",
            "TB_BIND_ADDR": "0.0.0.0",
            "TB_PUBLIC_URL": f"{public_base(protocol, host)}:19080",
            "IDP_ISSUER": issuer,
            "VITE_IDP_ISSUER": issuer,
            "VITE_IDP_CLIENT_ID": spa.get("LuminaryIoTChain iot-console-web") or "",
            "VITE_IDP_REDIRECT_URI": f"{sb}/auth/callback",
            "VITE_IDP_POST_LOGOUT_URI": f"{sb}/login",
            "VITE_AUTH_EXPERIENCE_URL": sb,
            "VITE_IDP_AUDIENCE": "https://api.iotchain.local",
            "IDP_AUDIENCE": "https://api.iotchain.local",
            "ENTITLEMENT_MODE": "off",
            "JAVA_OPTS": "-Xms256M -Xmx768M",
        })
    add("products/syncrobrain/deploy/.env", {
            "CONSOLE_BIND_ADDR": "0.0.0.0",
            "GATEWAY_BIND_ADDR": "0.0.0.0",
            "TB_BIND_ADDR": "0.0.0.0",
            "TB_PUBLIC_URL": f"{public_base(protocol, host)}:19080",
            "IDP_ISSUER": issuer,
            "VITE_IDP_ISSUER": issuer,
            "VITE_IDP_CLIENT_ID": spa.get("LuminaryIoTChain iot-console-web") or "",
            "VITE_IDP_REDIRECT_URI": f"{sb}/auth/callback",
            "VITE_IDP_POST_LOGOUT_URI": f"{sb}/login",
            "VITE_AUTH_EXPERIENCE_URL": sb,
            "VITE_IDP_AUDIENCE": "https://api.iotchain.local",
            "IDP_AUDIENCE": "https://api.iotchain.local",
            "ENTITLEMENT_MODE": "off",
            "JAVA_OPTS": "-Xms256M -Xmx768M",
        },
    )
    return files


def apply_product_public_env(kit: Path) -> dict:
    protocol, host = site_public(kit)
    hosts = load_site_hosts(kit)
    registered = load_json(kit / "identity" / "registered-apps.json", {})
    spa = registered.get("spa") or {}
    written = []
    for rel, updates in product_idp_updates(protocol, host, spa, hosts).items():
        if rel.startswith("products/"):
            parts = Path(rel).parts
            if len(parts) >= 2 and not (kit / parts[0] / parts[1]).is_dir():
                continue
        write_env_updates(kit / rel, updates)
        written.append(rel)
    return {"ok": True, "host": host, "identity": identity_origin(protocol, host, hosts), "files": written}


def product_host_names(hosts: dict[str, str], product: str) -> list[str]:
    apex = str((hosts or {}).get(product) or "").strip().lower()
    if not is_dns_name(apex):
        return []
    names = [apex]
    for alias in HOST_ALIASES.get(product, []):
        candidate = f"{alias}.{apex}"
        if candidate not in names:
            names.append(candidate)
    return names


def write_ingress_caddyfile(kit: Path, protocol: str, public_host: str, hosts: dict[str, str], dest: Path | None = None) -> Path:
    idp_host = identity_public_host(hosts)
    idp_header = idp_host if is_dns_name(idp_host) else f"{public_host}:3001"
    blocks = [
        "# Generated by install-runtime.py --apply-ingress. Cloudflare origin HTTP :80.",
        "# Same-origin /oidc and /api/experience are proxied to Identity with Host rewrite.",
        "",
    ]
    if is_dns_name(idp_host):
        blocks.append(f"http://{idp_host} {{\n\treverse_proxy 127.0.0.1:3001\n}}\n")
    for product, port in PRODUCT_HTTP_PORTS.items():
        if product == "doerflow-admin":
            continue
        names = product_host_names(hosts, product)
        if not names:
            continue
        sites = ", ".join(f"http://{name}" for name in names)
        blocks.append(
            f"""{sites} {{
	handle /oidc* {{
		reverse_proxy 127.0.0.1:3001 {{
			header_up Host {idp_header}
		}}
	}}
	handle /api/experience* {{
		reverse_proxy 127.0.0.1:3001 {{
			header_up Host {idp_header}
		}}
	}}
	handle /sign-in* {{
		reverse_proxy 127.0.0.1:3001 {{
			header_up Host {idp_header}
		}}
	}}
	handle /consent* {{
		reverse_proxy 127.0.0.1:3001 {{
			header_up Host {idp_header}
		}}
	}}
	reverse_proxy 127.0.0.1:{port}
}}
"""
        )
    dest = dest or kit / "deploy" / "luminaryworks-install" / "overlays" / "ingress" / "Caddyfile"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(blocks).rstrip() + "\n", encoding="utf-8")
    return dest


def apply_ingress(kit: Path) -> dict:
    protocol, host = site_public(kit)
    hosts = load_site_hosts(kit)
    dns = {key: value for key, value in hosts.items() if is_dns_name(value)}
    if not dns:
        print("[ingress] skipped (IP access; no Host-based :80)", flush=True)
        return {"ok": True, "skipped": True, "reason": "ip-access", "identity": identity_origin(protocol, host, hosts)}
    compose = None
    for path in (
        kit / "deploy" / "luminaryworks-install" / "overlays" / "ingress.yml",
        Path(__file__).resolve().parent.parent / "deploy" / "luminaryworks-install" / "overlays" / "ingress.yml",
    ):
        if path.is_file():
            compose = path
            break
    if compose is None:
        raise RuntimeError("missing ingress.yml overlay")
    caddyfile = write_ingress_caddyfile(kit, protocol, host, hosts, compose.parent / "ingress" / "Caddyfile")
    result = docker(
        "compose",
        "--project-name",
        "lw-ingress",
        "-f",
        str(compose),
        "up",
        "-d",
        "--remove-orphans",
        check=False,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()[-800:]
        raise RuntimeError(f"ingress up failed: {err}")
    return {
        "ok": True,
        "caddyfile": str(caddyfile),
        "identity": identity_origin(protocol, host, hosts),
        "hosts": dns,
    }


def create_management_m2m(kit: Path, identity_db: str) -> tuple[str, str]:
    env_path = kit / "identity" / ".env"
    existing = parse_env(env_path.read_text(encoding="utf-8")) if env_path.is_file() else {}
    app_id = existing.get("LOGTO_M2M_APP_ID") or ""
    secret = existing.get("LOGTO_M2M_APP_SECRET") or ""
    protocol, host = site_public(kit)
    endpoint = f"{public_base(protocol, host)}:3001"
    if app_id and secret and management_token_ok("http://127.0.0.1:3001", app_id, secret):
        return app_id, secret

    role = docker(
        "exec",
        identity_db,
        "psql",
        "-U",
        "logto",
        "-d",
        "logto",
        "-tAc",
        "SET ROLE logto_tenant_logto_default; SELECT id FROM roles WHERE name = 'Logto Management API access' AND type = 'MachineToMachine' LIMIT 1;",
    )
    role_id = ""
    for line in (role.stdout or "").splitlines():
        value = line.strip()
        if value and value != "SET":
            role_id = value
            break
    if not role_id:
        raise RuntimeError("Logto Management API access role missing")
    app_id = f"lw{secrets.token_hex(10)}"[:21]
    secret = secrets.token_urlsafe(24)[:32]
    role_link = f"{app_id}r"[:21]
    sql = f"""\\set ON_ERROR_STOP on
SET ROLE logto_tenant_logto_default;
INSERT INTO applications (tenant_id, id, name, secret, description, type, oidc_client_metadata)
VALUES (
  'default',
  '{app_id}',
  'LuminaryWorks Install M2M',
  '{secret}',
  'Bootstrap M2M for register-apps',
  'MachineToMachine',
  '{{"redirectUris":[],"postLogoutRedirectUris":[]}}'
);
INSERT INTO applications_roles (tenant_id, id, application_id, role_id)
VALUES ('default', '{role_link}', '{app_id}', '{role_id}');
"""
    docker("exec", "-i", identity_db, "psql", "-U", "logto", "-d", "logto", input_text=sql)
    write_env_updates(
        env_path,
        {
            "LOGTO_M2M_APP_ID": app_id,
            "LOGTO_M2M_APP_SECRET": secret,
            "LOGTO_MANAGEMENT_API_RESOURCE": "https://default.logto.app/api",
            "IDENTITY_ENDPOINT": "http://127.0.0.1:3001",
            "IDP_ISSUER": f"{endpoint}/oidc",
            "IDENTITY_ACCOUNTS_PROFILE": "product",
        },
    )
    if not management_token_ok("http://127.0.0.1:3001", app_id, secret):
        raise RuntimeError("Management API token failed after M2M create")
    return app_id, secret


def management_token_ok(endpoint: str, app_id: str, secret: str) -> bool:
    body = urlencode(
        {
            "grant_type": "client_credentials",
            "resource": "https://default.logto.app/api",
            "scope": "all",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{endpoint.rstrip('/')}/oidc/token",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic "
            + __import__("base64").b64encode(f"{app_id}:{secret}".encode("utf-8")).decode("ascii"),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            payload = json.loads(res.read().decode("utf-8"))
        token = payload.get("access_token")
        if not token:
            return False
        probe = urllib.request.Request(
            f"{endpoint.rstrip('/')}/api/applications?page=1&page_size=1",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(probe, timeout=15) as res:
            return 200 <= res.status < 300
    except Exception:
        return False


def run_identity_node(kit: Path, script: str, extra_env: dict | None = None) -> None:
    identity = kit / "identity"
    env_args: list[str] = []
    for key, value in (extra_env or {}).items():
        env_args.extend(["-e", f"{key}={value}"])
    result = docker(
        "run",
        "--rm",
        "--network",
        "host",
        "-v",
        f"{identity}:/work",
        "-w",
        "/work",
        "-e",
        "IDENTITY_ACCOUNTS_PROFILE=product",
        *env_args,
        NODE_IMAGE,
        "node",
        script,
        check=False,
    )
    sys.stdout.write(result.stdout or "")
    sys.stderr.write(result.stderr or "")
    if result.returncode != 0:
        raise RuntimeError(f"{script} failed ({result.returncode})")


def read_m_admin_secret(identity_db: str) -> str:
    result = docker(
        "exec",
        identity_db,
        "psql",
        "-U",
        "logto",
        "-d",
        "logto",
        "-tAc",
        "SET ROLE logto_tenant_logto_admin; SELECT secret FROM applications WHERE id = 'm-admin' LIMIT 1;",
    )
    secret = ""
    for line in (result.stdout or "").splitlines():
        value = line.strip()
        if value and value != "SET":
            secret = value
            break
    if not secret:
        raise RuntimeError("admin tenant application m-admin secret missing")
    return secret


def bootstrap_identity(kit: Path) -> dict:
    protocol, host = site_public(kit)
    endpoint = f"{public_base(protocol, host)}:3001"
    discovery = f"{endpoint}/oidc/.well-known/openid-configuration"
    print(f"[identity] wait for {discovery}", flush=True)
    if not wait_http_ok(discovery, 240):
        raise RuntimeError("Identity OIDC discovery did not become ready")
    identity_db = find_container("identity-db")
    patch_apps_redirects(kit, protocol, host, load_site_hosts(kit))
    create_management_m2m(kit, identity_db)
    print("[identity] register-apps", flush=True)
    run_identity_node(kit, "scripts/register-apps.mjs")
    print("[identity] ensure-sign-in-experience", flush=True)
    run_identity_node(kit, "scripts/ensure-sign-in-experience.mjs")
    print("[identity] ensure-admin-console-branding", flush=True)
    run_identity_node(
        kit,
        "scripts/ensure-admin-console-branding.mjs",
        {
            "IDENTITY_ADMIN_ENDPOINT": "http://127.0.0.1:3002",
            "LOGTO_ADMIN_M2M_SECRET": read_m_admin_secret(identity_db),
        },
    )
    print("[identity] seed-accounts", flush=True)
    run_identity_node(kit, "scripts/seed-accounts.mjs")
    apply_product_public_env(kit)
    return {"ok": True, "endpoint": endpoint}


class CookieOpener:
    def __init__(self):
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def json(self, method: str, url: str, payload=None) -> tuple[int, dict | str]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "User-Agent": "luminaryworks-accept"},
        )
        try:
            with self.opener.open(req, timeout=15) as res:
                raw = res.read().decode("utf-8", "replace")
                try:
                    return res.status, json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    return res.status, raw
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", "replace") if err.fp else ""
            try:
                return err.code, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return err.code, raw
        except Exception as err:
            return 0, str(err)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def oidc_interaction_cookie(identity_base: str, client_id: str, redirect_uri: str) -> CookieOpener:
    """Logto Experience API needs the interaction cookie from an OIDC authorize start (PKCE)."""
    api = identity_base.rstrip("/")
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid offline_access",
            "prompt": "login",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    client = CookieOpener()
    req = urllib.request.Request(
        f"{api}/oidc/auth?{query}",
        method="GET",
        headers={"User-Agent": "luminaryworks-accept"},
    )
    try:
        client.opener.open(req, timeout=15)
    except urllib.error.HTTPError:
        pass
    except Exception:
        pass
    return client


def experience_password_login(
    identity_base: str,
    username: str,
    password: str,
    client_id: str = "",
    redirect_uri: str = "",
) -> tuple[bool, str]:
    if not username or not password:
        return False, "missing username or password"
    api = identity_base.rstrip("/")
    client = (
        oidc_interaction_cookie(api, client_id, redirect_uri)
        if client_id and redirect_uri
        else CookieOpener()
    )
    status, body = client.json("PUT", f"{api}/api/experience", {"interactionEvent": "SignIn"})
    if status and status >= 400:
        return False, f"init {status} {body}"
    ident_type = "email" if "@" in username else "username"
    status, body = client.json(
        "POST",
        f"{api}/api/experience/verification/password",
        {"identifier": {"type": ident_type, "value": username}, "password": password},
    )
    if status and status >= 400:
        return False, f"password {status} {body}"
    verification_id = body.get("verificationId") if isinstance(body, dict) else ""
    if not verification_id:
        return False, f"password missing verificationId {body}"
    status, body = client.json(
        "POST",
        f"{api}/api/experience/identification",
        {"verificationId": verification_id},
    )
    if status and status >= 400:
        return False, f"identify {status} {body}"
    status, body = client.json("POST", f"{api}/api/experience/submit", {})
    if status and 200 <= status < 400:
        return True, "ok"
    return False, f"submit {status} {body}"


def allow_pnpm_builds(root: Path) -> int:
    changed = 0
    for path in root.rglob("Dockerfile*"):
        if any(part in {"node_modules", ".git"} for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if "pnpm install" not in text or "dangerouslyAllowAllBuilds" in text:
            continue
        next_text = re.sub(
            r"(?<!dangerouslyAllowAllBuilds true && )pnpm install",
            "pnpm config set dangerouslyAllowAllBuilds true && pnpm install",
            text,
        )
        if next_text == text:
            continue
        path.write_text(next_text, encoding="utf-8")
        changed += 1
    return changed


def product_compose_argv(kit: Path, product: str) -> list[str]:
    manifest = load_json(kit / "products" / "MANIFEST.json", {})
    spec = (manifest.get("products") or {}).get(product) or {}
    files = spec.get("compose") or []
    if not files:
        raise RuntimeError(f"products/MANIFEST.json has no compose for {product}")
    root = kit / "products" / product
    project = str(spec.get("project") or f"lw-{product}")
    compose_dir = (root / files[0]).resolve().parent
    args = ["compose", "--project-name", project, "--project-directory", str(compose_dir)]
    env_candidates = [
        root / ".env",
        compose_dir / ".env",
        root / "deploy" / ".env",
        root / "deploy" / "standalone" / ".env",
        root / "deploy" / "standalone" / "standalone.env",
        root / "deploy" / "edu" / ".env",
        root / "deploy" / "compose" / ".env",
    ]
    env_dir = root / "deploy" / "env"
    if env_dir.is_dir():
        env_candidates.extend(sorted(env_dir.glob("*.env")))
    seen: set[str] = set()
    for envf in env_candidates:
        key = str(envf)
        if key in seen or not envf.is_file():
            continue
        seen.add(key)
        args.extend(["--env-file", key])
    for rel in files:
        args.extend(["-f", str(root / rel)])
    return args


def post_up(kit: Path, product: str) -> dict:
    """Idempotent schema/seed after compose up. Safe to re-run from accept.sh."""
    if product != "dataluminary":
        return {"ok": True, "skipped": True, "product": product}
    argv = product_compose_argv(kit, product)
    print(f"[post-up] {product} DataTalk migration:run", flush=True)
    migrate = docker(*argv, "run", "--rm", "--no-deps", "datatalk", "pnpm", "migration:run", check=False)
    if migrate.returncode != 0:
        err = (migrate.stderr or migrate.stdout or "").strip()[-800:]
        raise RuntimeError(f"dataluminary migration:run failed: {err}")
    print((migrate.stdout or "").strip()[-400:], flush=True)
    restart = docker(*argv, "up", "-d", "--no-build", "datatalk", check=False)
    if restart.returncode != 0:
        err = (restart.stderr or restart.stdout or "").strip()[-400:]
        raise RuntimeError(f"dataluminary datatalk restart failed: {err}")
    return {"ok": True, "product": product}


def post_up_enabled(kit: Path) -> list[dict]:
    results = []
    for product in enabled_products(kit):
        if product == "control-plane":
            continue
        results.append(post_up(kit, product))
    return results


def accept(kit: Path) -> dict:
    protocol, host = site_public(kit)
    base = public_base(protocol, host)
    accounts = parse_env((kit / "identity" / "ACCOUNTS.product.env").read_text(encoding="utf-8")) if (
        kit / "identity" / "ACCOUNTS.product.env"
    ).is_file() else {}
    enabled = enabled_products(kit)
    try:
        post_up_enabled(kit)
    except Exception as err:
        print(f"[accept] post-up warning: {err}", flush=True)
    checks = []
    ok = True
    for product in enabled:
        for item in ENDPOINTS.get(product, []):
            url = f"{base}:{item['port']}{item['path']}"
            optional = bool(item.get("optional"))
            status, body = http_get(url)
            def endpoint_ok(code: int) -> bool:
                if item["path"].endswith("configuration") or item["path"] in (
                    "/ready",
                    "/health",
                    "/healthz",
                    "/api/v1/live",
                    "/api/v1/ready",
                ):
                    return 200 <= code < 400
                return 200 <= code < 500
            passed = endpoint_ok(status)
            if not passed and not optional:
                wait_http_ok(url, 60)
                status, body = http_get(url)
                passed = endpoint_ok(status)
            check = {
                "name": item["name"],
                "url": url,
                "status": status,
                "ok": passed,
                "optional": optional,
            }
            if not passed and optional:
                check["ok"] = True
                check["skipped"] = True
            if not check["ok"]:
                ok = False
                check["detail"] = (body or "")[:240]
            checks.append(check)
            mark = "ok" if check["ok"] else "FAIL"
            extra = " (optional skip)" if check.get("skipped") else ""
            print(f"[accept] {mark} {item['name']} {url} → {status}{extra}", flush=True)

    identity = f"{base}:3001"
    logged = set()
    cp_env = parse_env((kit / "deploy" / "env" / "control-plane.env").read_text(encoding="utf-8")) if (
        kit / "deploy" / "env" / "control-plane.env"
    ).is_file() else {}
    client_id = cp_env.get("CONTROL_CONSOLE_IDP_CLIENT_ID") or ""
    redirect_uri = f"{base}:3050/auth/callback"
    for product in enabled:
        account_id = None
        for item in ENDPOINTS.get(product, []):
            if item.get("login"):
                account_id = item.get("account") or product
                break
        if not account_id or account_id in logged:
            continue
        spec = LOGIN_ACCOUNTS.get(account_id)
        if not spec:
            continue
        username = accounts.get(spec["usernameKey"]) or accounts.get(spec["emailKey"]) or ""
        password = accounts.get(spec["passwordKey"]) or ""
        passed, detail = experience_password_login(
            identity, username, password, client_id=client_id, redirect_uri=redirect_uri
        )
        checks.append(
            {
                "name": f"login-{account_id}",
                "ok": passed,
                "username": username,
                "detail": detail if not passed else "ok",
            }
        )
        logged.add(account_id)
        mark = "ok" if passed else "FAIL"
        print(f"[accept] {mark} login {account_id} as {username}", flush=True)
        if not passed:
            ok = False

    report = {"ok": ok, "host": host, "enabled": enabled, "checks": checks}
    out = kit / "accept-report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[accept] wrote {out} ok={ok}", flush=True)
    return report


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="LuminaryWorks install runtime / accept")
    parser.add_argument("--kit", default=".", help="kit directory")
    parser.add_argument("--accept", action="store_true")
    parser.add_argument("--bootstrap-identity", action="store_true")
    parser.add_argument("--patch-product-env", action="store_true")
    parser.add_argument("--apply-ingress", action="store_true")
    parser.add_argument("--check-ports", action="store_true")
    parser.add_argument("--print-public-urls", action="store_true")
    parser.add_argument("--allow-pnpm-builds", action="store_true")
    parser.add_argument("--post-up", metavar="PRODUCT", help="run product schema/seed after compose up")
    args = parser.parse_args(argv)
    kit = Path(args.kit).resolve()
    if args.print_public_urls:
        print(json.dumps(public_url_plan(kit), ensure_ascii=False, indent=2))
        return 0
    if args.check_ports:
        report = check_host_ports(kit)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if not report["ok"]:
            for item in report["conflicts"]:
                sys.stderr.write(f"[ports] {item['message']}\n")
            return 78
        return 0
    if args.allow_pnpm_builds:
        n = allow_pnpm_builds(kit)
        print(f"patched {n} Dockerfiles")
        return 0
    if args.post_up:
        print(json.dumps(post_up(kit, args.post_up), ensure_ascii=False, indent=2))
        return 0
    if args.patch_product_env:
        print(json.dumps(apply_product_public_env(kit), ensure_ascii=False, indent=2))
        return 0
    if args.apply_ingress:
        print(json.dumps(apply_ingress(kit), ensure_ascii=False, indent=2))
        return 0
    if args.bootstrap_identity:
        print(json.dumps(bootstrap_identity(kit), ensure_ascii=False, indent=2))
        return 0
    if args.accept:
        report = accept(kit)
        return 0 if report["ok"] else 1
    parser.print_help()
    return 64


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as err:
        sys.stderr.write(f"{err}\n")
        raise SystemExit(1)
