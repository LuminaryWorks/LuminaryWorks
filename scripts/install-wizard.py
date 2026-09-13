#!/usr/bin/env python3
"""LuminaryWorks first-install config page.

Four steps: products → public logins → ops secrets → memory.
Form defaults come from env. Public login passwords are required.
The page auto-closes after one hour and cannot be reopened.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

WEAK = re.compile(r"change[-_]?me|LuminaryDev|logto_dev_password|password123|changeme", re.I)
PLACEHOLDER_HOST = re.compile(r"^$|REPLACE_|example\.com$", re.I)
IPV4 = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
VISTAREMOTE_PARENT = "vistacast.dev"
VISTAREMOTE_DEFAULT = "vistaremote.vistacast.dev"
DEFAULT_TTL_SEC = 3600
READY_NAME = ".install-ui.ready"
CLOSED_NAME = ".install-ui.closed"
URL_NAME = ".install-ui.url"
SCOPE_NAME = ".install-ui.scope"
PORT_NAME = ".install-ui.port"
# 80 first: Aliyun / Tencent / AWS / OVH default security groups already allow it.
# 8080 is BlockyEdu; 8099 is a last-resort unused port.
WIZARD_PORT_CANDIDATES = (80, 8080, 8099)

SITE_PRODUCTS = [
    "control-plane",
    "dataluminary",
    "blockyedu",
    "doerflow",
    "vistaremote",
    "vistacast",
    "syncrobrain",
]
BLOCKYEDU_PACK_IDS = ["syncrobrain", "dataluminary", "vistacast", "doerflow", "vistaremote"]
DEFAULT_BLOCKYEDU_SEED = {"profile": "full-demo", "packs": list(BLOCKYEDU_PACK_IDS)}


def resolve_blockyedu_seed(seed) -> dict:
    src = seed if isinstance(seed, dict) else {}
    profile = str(src.get("profile") or DEFAULT_BLOCKYEDU_SEED["profile"]).strip() or DEFAULT_BLOCKYEDU_SEED["profile"]
    packs = list(src["packs"]) if isinstance(src.get("packs"), list) else list(DEFAULT_BLOCKYEDU_SEED["packs"])
    return {"profile": profile, "packs": packs}

LOGIN_ACCOUNTS = [
    {
        "product": "control-plane",
        "label": "平台 Super Admin",
        "emailKey": "LW_SUPER_ADMIN_EMAIL",
        "usernameKey": "LW_SUPER_ADMIN_USERNAME",
        "passwordKey": "LW_SUPER_ADMIN_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
    {
        "product": "dataluminary",
        "label": "DataLuminary Admin",
        "emailKey": "LW_ADMIN_DATALUMINARY_EMAIL",
        "usernameKey": "LW_ADMIN_DATALUMINARY_USERNAME",
        "passwordKey": "LW_ADMIN_DATALUMINARY_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
    {
        "product": "blockyedu",
        "label": "BlockyEdu Admin",
        "emailKey": "LW_ADMIN_BLOCKYEDU_EMAIL",
        "usernameKey": "LW_ADMIN_BLOCKYEDU_USERNAME",
        "passwordKey": "LW_ADMIN_BLOCKYEDU_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
    {
        "product": "doerflow",
        "label": "DoerFlow Admin",
        "emailKey": "LW_ADMIN_DOERFLOW_EMAIL",
        "usernameKey": "LW_ADMIN_DOERFLOW_USERNAME",
        "passwordKey": "LW_ADMIN_DOERFLOW_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
    {
        "product": "vistaremote",
        "label": "VistaRemote Admin",
        "emailKey": "LW_ADMIN_VISTAREMOTE_EMAIL",
        "usernameKey": "LW_ADMIN_VISTAREMOTE_USERNAME",
        "passwordKey": "LW_ADMIN_VISTAREMOTE_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
    {
        "product": "vistacast",
        "label": "VistaCast Admin",
        "emailKey": "LW_ADMIN_VISTACAST_EMAIL",
        "usernameKey": "LW_ADMIN_VISTACAST_USERNAME",
        "passwordKey": "LW_ADMIN_VISTACAST_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
    {
        "product": "syncrobrain",
        "label": "SyncroBrain Admin",
        "emailKey": "LW_ADMIN_SYNCROBRAIN_EMAIL",
        "usernameKey": "LW_ADMIN_SYNCROBRAIN_USERNAME",
        "passwordKey": "LW_ADMIN_SYNCROBRAIN_PASSWORD",
        "file": "identity/ACCOUNTS.product.env",
    },
]

INTERNAL_SECRETS = [
    {
        "key": "IDENTITY_DB_PASSWORD",
        "file": "deploy/env/control-plane.env",
        "label": "Identity Postgres",
        "product": "control-plane",
    },
    {
        "key": "ENTITLEMENT_DB_PASSWORD",
        "file": "deploy/env/control-plane.env",
        "label": "Entitlement Postgres",
        "product": "control-plane",
    },
    {
        "key": "ENTITLEMENT_SERVICE_API_KEY",
        "file": "deploy/env/control-plane.env",
        "label": "Entitlement API key",
        "product": "control-plane",
    },
    {
        "key": "LW_LOGTO_ADMIN_PASSWORD",
        "file": "identity/.env",
        "label": "Logto Admin（仅本机 :3002）",
        "product": "control-plane",
    },
]

# Relative working-set weights. Caps stop a single stack eating the whole box
# when only one product is enabled.
MEMORY_PROFILES = {
    "control-plane": {
        "weight": 14,
        "dbShare": 0.45,
        "maxWorkingGiB": 6,
        "note": "Identity PG + Redis + Logto + Gateway + Entitlement。库优先。",
    },
    "dataluminary": {
        "weight": 18,
        "dbShare": 0.5,
        "maxWorkingGiB": 8,
        "note": "DataTalk / DataView 与各自 Postgres，查询会冲高。",
    },
    "blockyedu": {
        "weight": 16,
        "dbShare": 0.35,
        "maxWorkingGiB": 7,
        "note": "Edu + Code 沙箱，编译时短时冲高。",
    },
    "doerflow": {
        "weight": 12,
        "dbShare": 0.4,
        "maxWorkingGiB": 6,
        "note": "API + worker + 账本库。",
    },
    "vistaremote": {
        "weight": 16,
        "dbShare": 0.35,
        "maxWorkingGiB": 7,
        "note": "信令与录制缓冲，突发高于均值。",
    },
    "vistacast": {
        "weight": 12,
        "dbShare": 0.4,
        "maxWorkingGiB": 5,
        "note": "事件与预览；默认可不装。",
    },
    "syncrobrain": {
        "weight": 12,
        "dbShare": 0.4,
        "maxWorkingGiB": 5,
        "note": "网关与时序库。",
    },
}

CEILING_FACTOR = 1.55
OS_RESERVE_GIB = 4


def _unquote(value: str) -> str:
    return str(value or "").strip().strip('"').strip("'")


def value_is_set(value: str) -> bool:
    text = _unquote(value)
    return bool(text) and not WEAK.search(text)


def parse_env(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in str(text or "").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, val = stripped.split("=", 1)
        out[key.strip()] = val
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


def load_json(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def default_hosts(kit: Path) -> dict:
    candidates = [
        kit / "hosts.defaults.json",
        Path(__file__).resolve().parent.parent / "deploy" / "luminaryworks-install" / "hosts.defaults.json",
    ]
    for path in candidates:
        if path.is_file():
            raw = json.loads(path.read_text(encoding="utf-8"))
            return {
                item["id"]: str(item.get("host") or "").strip().lower()
                for item in raw.get("products") or []
                if item.get("id") and item.get("host")
            }
    return {"vistaremote": VISTAREMOTE_DEFAULT}


def host_catalog(kit: Path) -> list:
    candidates = [
        kit / "hosts.defaults.json",
        Path(__file__).resolve().parent.parent / "deploy" / "luminaryworks-install" / "hosts.defaults.json",
    ]
    for path in candidates:
        if path.is_file():
            return list((json.loads(path.read_text(encoding="utf-8")).get("products") or []))
    return []


def vistaremote_host_ok(host: str) -> bool:
    value = str(host or "").strip().lower()
    return value == VISTAREMOTE_PARENT or value.endswith(f".{VISTAREMOTE_PARENT}")


def looks_like_ipv4(value: str) -> bool:
    return bool(IPV4.match(str(value or "").strip()))


def resolve_form_host(name: str, hosts_in: dict, defaults: dict) -> str:
    """Missing key → brand default. Explicit empty string is IP access and must stay empty."""
    if isinstance(hosts_in, dict) and name in hosts_in:
        return str(hosts_in.get(name) or "").strip().lower()
    return str(defaults.get(name) or "").strip().lower()


def host_is_ip_access(value: str) -> bool:
    host = str(value or "").strip()
    return not host or looks_like_ipv4(host)


def read_env_file(kit: Path, rel: str) -> dict[str, str]:
    path = kit / rel
    if not path.is_file():
        return {}
    return parse_env(path.read_text(encoding="utf-8"))


def is_usable_host(value: str) -> bool:
    host = str(value or "").strip()
    if not host or PLACEHOLDER_HOST.search(host):
        return False
    if host.lower() in {"server", "0.0.0.0", "::", "127.0.0.1", "localhost", "::1"}:
        return False
    return True


def is_public_ipv4(value: str) -> bool:
    """True for a globally routable IPv4, or a DNS name. False for loopback / RFC1918 / CGNAT."""
    host = str(value or "").strip()
    if not IPV4.match(host):
        return bool(host)
    parts = [int(part) for part in host.split(".")]
    a, b = parts[0], parts[1]
    if a == 0 or a == 127 or a >= 224:
        return False
    if a == 10:
        return False
    if a == 169 and b == 254:
        return False
    if a == 172 and 16 <= b <= 31:
        return False
    if a == 192 and b == 168:
        return False
    if a == 100 and 64 <= b <= 127:
        return False
    return True


def _clean_host(raw: str) -> str:
    host = str(raw or "").strip().splitlines()[0].strip().split()[0].strip(".,;\"'")
    if not host or "<" in host or "/" in host or len(host) > 253:
        return ""
    return host


def _http_text(url: str, timeout: float = 1.2, headers: dict | None = None, method: str = "GET") -> str:
    try:
        hdrs = {"User-Agent": "luminaryworks-install"}
        if headers:
            hdrs.update(headers)
        data = b"" if method in ("PUT", "POST") else None
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return _clean_host(res.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return ""


def local_ipv4s() -> list[str]:
    found: list[str] = []

    def add(host: str) -> None:
        if is_usable_host(host) and IPV4.match(host) and host not in found:
            found.append(host)

    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("1.1.1.1", 80))
            add(probe.getsockname()[0])
        finally:
            probe.close()
    except OSError:
        pass
    try:
        out = subprocess.check_output(
            ["hostname", "-I"],
            timeout=1,
            encoding="utf-8",
            stderr=subprocess.DEVNULL,
        )
        for token in out.split():
            add(token)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        pass
    return found


def probe_aws_public_ipv4() -> str:
    token = _http_text(
        "http://169.254.169.254/latest/api/token",
        timeout=0.6,
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        method="PUT",
    )
    if token and not IPV4.match(token):
        host = _http_text(
            "http://169.254.169.254/latest/meta-data/public-ipv4",
            timeout=0.6,
            headers={"X-aws-ec2-metadata-token": token},
        )
        if is_public_ipv4(host):
            return host
    host = _http_text("http://169.254.169.254/latest/meta-data/public-ipv4", timeout=0.6)
    return host if is_public_ipv4(host) else ""


def probe_live_public_ips() -> list[str]:
    """Inbound/public IPv4 from cloud metadata, then generic what-is-my-ip.

    Cloud-agnostic: AWS, Aliyun, Tencent, GCP, Azure, then any VPS with egress.
    Stops at the first public IPv4 so first-install is not delayed by every vendor.
    """
    found: list[str] = []

    def add(host: str) -> bool:
        if is_usable_host(host) and is_public_ipv4(host) and host not in found:
            found.append(host)
            return True
        return False

    probes = [
        probe_aws_public_ipv4,
        lambda: _http_text("http://100.100.100.200/latest/meta-data/eipv4", timeout=0.6),
        lambda: _http_text("http://100.100.100.200/latest/meta-data/public-ipv4", timeout=0.6),
        lambda: _http_text("http://metadata.tencentyun.com/latest/meta-data/public-ipv4", timeout=0.6),
        lambda: _http_text(
            "http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip",
            timeout=0.6,
            headers={"Metadata-Flavor": "Google"},
        ),
        lambda: _http_text(
            "http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text",
            timeout=0.6,
            headers={"Metadata": "true"},
        ),
        lambda: _http_text("https://api-ipv4.ip.sb/ip", timeout=1.5),
        lambda: _http_text("https://ipv4.icanhazip.com", timeout=1.5),
        lambda: _http_text("https://api.ipify.org", timeout=1.5),
    ]
    for probe in probes:
        if add(probe()):
            return found
    return found


def pick_advertise_host(candidates: list[str]) -> str:
    """Prefer a public IPv4 or DNS name; only then a LAN address. Never loopback."""
    public: list[str] = []
    private: list[str] = []
    seen: set[str] = set()
    for raw in candidates:
        host = str(raw or "").strip()
        if host in seen or not is_usable_host(host):
            continue
        seen.add(host)
        if is_public_ipv4(host):
            public.append(host)
        else:
            private.append(host)
    if public:
        return public[0]
    if private:
        return private[0]
    return ""


def detect_public_host(kit: Path | None = None, explicit: str = "") -> str:
    """Address for the operator laptop browser on any cloud or bare-metal host.

    1. Live public IPv4 (cloud EIP / what-is-my-ip / public NIC)
    2. Configured publicHost / --public-host if it is already public
    3. LAN IPv4 only when no public address exists
    """
    hints = [explicit, os.environ.get("INSTALL_ADVERTISE_HOST", "")]
    if kit and (kit / "site.json").is_file():
        try:
            site = json.loads((kit / "site.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            site = {}
        hints.append(str((site or {}).get("publicHost") or ""))
    return pick_advertise_host(probe_live_public_ips() + hints + local_ipv4s())


def advertise_scope(host: str) -> str:
    if not is_usable_host(host):
        return "unknown"
    if IPV4.match(host) and not is_public_ipv4(host):
        return "lan"
    return "public"


def public_http_origin(host: str, port: int) -> str:
    if int(port) == 80:
        return f"http://{host}"
    return f"http://{host}:{port}"


def config_page_url(bind: str, port: int, token: str, advertise_host: str = "") -> tuple[str, str]:
    local = f"{public_http_origin('127.0.0.1', port)}/?t={token}"
    if bind in ("127.0.0.1", "localhost"):
        return local, local
    host = bind if bind not in ("0.0.0.0", "::", "") else str(advertise_host or "").strip()
    if not is_usable_host(host):
        return f"{public_http_origin('<公网IP>', port)}/?t={token}", local
    return f"{public_http_origin(host, port)}/?t={token}", local


def tcp_port_in_use(port: int, bind: str = "0.0.0.0") -> bool:
    host = bind if bind not in ("0.0.0.0", "::", "") else "0.0.0.0"
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, int(port)))
        return False
    except OSError:
        return True
    finally:
        sock.close()


def pick_wizard_port(bind: str, requested: int | None = None) -> int:
    if requested:
        port = int(requested)
        if tcp_port_in_use(port, bind):
            raise OSError(f"wizard port {port} is already in use")
        return port
    for port in WIZARD_PORT_CANDIDATES:
        if not tcp_port_in_use(port, bind):
            return port
    raise OSError("no free wizard port among " + ",".join(str(p) for p in WIZARD_PORT_CANDIDATES))


def _run_cmd(cmd: list[str], timeout: float = 12) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            encoding="utf-8",
            timeout=timeout,
            shell=False,
        )
        text = ((result.stdout or "") + (result.stderr or "")).strip()
        return int(result.returncode), text
    except (OSError, subprocess.TimeoutExpired) as err:
        return 1, str(err)


def _dmi_text(name: str) -> str:
    path = Path("/sys/class/dmi/id") / name
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def detect_cloud() -> str:
    """Identify the host's cloud so firewall hints match that vendor's security group."""
    vendor = _dmi_text("sys_vendor").lower()
    product = (_dmi_text("product_name") + " " + _dmi_text("product_version")).lower()
    blob = f"{vendor} {product}"
    if "tencent" in blob or "qcloud" in blob:
        return "tencent"
    if "alibaba" in blob or "alibabacloud" in blob:
        return "aliyun"
    if "amazon" in blob or "ec2" in blob:
        return "aws"
    if "google" in blob:
        return "gcp"
    if "microsoft" in blob:
        return "azure"
    if "ovh" in blob:
        return "ovh"
    if _http_text("http://metadata.tencentyun.com/latest/meta-data/instance-id", timeout=0.4):
        return "tencent"
    if _http_text("http://100.100.100.200/latest/meta-data/instance-id", timeout=0.4):
        return "aliyun"
    if _http_text(
        "http://169.254.169.254/computeMetadata/v1/instance/id",
        timeout=0.4,
        headers={"Metadata-Flavor": "Google"},
    ):
        return "gcp"
    azure = _http_text(
        "http://169.254.169.254/metadata/instance/compute/azEnvironment?api-version=2021-02-01&format=text",
        timeout=0.4,
        headers={"Metadata": "true"},
    )
    if azure:
        return "azure"
    token = _http_text(
        "http://169.254.169.254/latest/api/token",
        timeout=0.4,
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        method="PUT",
    )
    if token and not IPV4.match(token):
        ident = _http_text(
            "http://169.254.169.254/latest/meta-data/instance-id",
            timeout=0.4,
            headers={"X-aws-ec2-metadata-token": token},
        )
        if ident:
            return "aws"
    openstack = _http_text("http://169.254.169.254/openstack/latest/meta_data.json", timeout=0.4)
    if "ovh" in openstack.lower():
        return "ovh"
    if "openstack" in blob:
        return "ovh"
    return "generic"


def security_group_likely_open(cloud: str, port: int) -> bool:
    if int(port) in (80, 443):
        return cloud in ("tencent", "aliyun", "aws", "gcp", "azure", "ovh", "generic")
    if cloud in ("ovh", "generic"):
        return True
    return False


def cloud_security_group_hint(cloud: str, port: int) -> str:
    if security_group_likely_open(cloud, port):
        if cloud == "tencent":
            return "检测为腾讯云。默认安全组一般已放行 80/443，运维电脑直接打开上面的地址即可。"
        if cloud == "aliyun":
            return "检测为阿里云。默认安全组一般已放行 80/443，运维电脑直接打开上面的地址即可。"
        if cloud == "aws":
            return "检测为 AWS。默认会放行 80/443 时，运维电脑直接打开上面的地址即可。"
        if cloud == "ovh":
            return "检测为 OVH。公有云默认没有额外安全组，本机防火墙放行后即可打开。"
        if cloud == "gcp":
            return "检测为 GCP。若 VPC 防火墙已放行 80，运维电脑直接打开上面的地址即可。"
        if cloud == "azure":
            return "检测为 Azure。若 NSG 已放行 80，运维电脑直接打开上面的地址即可。"
        return "本机防火墙已放行。云厂商默认安全组一般已放行 80，运维电脑直接打开上面的地址即可。"
    hints = {
        "tencent": f"检测为腾讯云。云安全组无法在虚机内改写，请在控制台 → 安全组 → 入站规则放行 TCP {port}（来源 0.0.0.0/0）。",
        "aliyun": f"检测为阿里云。请在控制台 → ECS → 安全组 → 入方向放行 TCP {port}。",
        "aws": f"检测为 AWS。请在 EC2 → Security Groups → Inbound 放行 TCP {port}（0.0.0.0/0），或给实例角色开 ec2:AuthorizeSecurityGroupIngress。",
        "gcp": f"检测为 GCP。请在 VPC 防火墙放行 tcp:{port}，或安装 gcloud 后由脚本尝试添加。",
        "azure": f"检测为 Azure。请在 NSG 入站放行 TCP {port}。",
        "ovh": f"检测为 OVH。若开了 Network Security Group，在 Horizon 放行 TCP {port}；默认 VPS 只需本机防火墙。",
        "generic": f"请确认上游防火墙 / 安全组已放行 TCP {port}。",
    }
    return hints.get(cloud, hints["generic"])


def open_host_firewall(port: int) -> dict:
    """Allow the wizard port on the host OS firewall (ufw / firewalld / iptables)."""
    port = int(port)
    if shutil.which("ufw"):
        code, detail = _run_cmd(["ufw", "allow", f"{port}/tcp", "comment", "luminaryworks-install"])
        if code != 0:
            code, detail = _run_cmd(["ufw", "allow", f"{port}/tcp"])
        status_code, status = _run_cmd(["ufw", "status"])
        active = status_code == 0 and "Status: active" in status
        return {
            "ok": code == 0,
            "backend": "ufw",
            "active": active,
            "detail": detail,
        }
    if shutil.which("firewall-cmd"):
        live = _run_cmd(["firewall-cmd", "--add-port", f"{port}/tcp"])
        _run_cmd(["firewall-cmd", "--permanent", "--add-port", f"{port}/tcp"])
        return {
            "ok": live[0] == 0,
            "backend": "firewalld",
            "active": True,
            "detail": live[1],
        }
    if shutil.which("iptables"):
        check = _run_cmd(["iptables", "-C", "INPUT", "-p", "tcp", "--dport", str(port), "-j", "ACCEPT"])
        if check[0] == 0:
            return {"ok": True, "backend": "iptables", "active": True, "detail": "already allowed"}
        code, detail = _run_cmd(
            ["iptables", "-I", "INPUT", "1", "-p", "tcp", "--dport", str(port), "-j", "ACCEPT"]
        )
        return {"ok": code == 0, "backend": "iptables", "active": True, "detail": detail}
    return {"ok": False, "backend": "none", "active": False, "detail": "no ufw/firewalld/iptables"}


def try_open_cloud_security_group(cloud: str, port: int) -> dict:
    """Cloud security groups need API credentials. Never fail the install over this."""
    del cloud, port
    return {"ok": False, "backend": "", "detail": ""}


def prepare_wizard_listen(kit: Path, bind: str, requested_port: int | None = None) -> dict:
    """Pick a reachable port, open the host firewall, and record the plan."""
    port = pick_wizard_port(bind, requested_port)
    cloud = detect_cloud()
    firewall = {"ok": True, "backend": "skipped", "active": False, "detail": "loopback"}
    cloud_sg = {"ok": False, "backend": "", "detail": ""}
    if bind not in ("127.0.0.1", "localhost"):
        firewall = open_host_firewall(port)
        cloud_sg = try_open_cloud_security_group(cloud, port)
    plan = {
        "port": port,
        "bind": bind,
        "cloud": cloud,
        "hostFirewall": firewall,
        "cloudSecurityGroup": cloud_sg,
        "securityGroupLikelyOpen": security_group_likely_open(cloud, port),
        "hint": cloud_security_group_hint(cloud, port),
    }
    (kit / PORT_NAME).write_text(str(port) + "\n", encoding="utf-8")
    return plan


def print_wizard_access(plan: dict) -> None:
    port = plan["port"]
    fw = plan.get("hostFirewall") or {}
    backend = fw.get("backend") or "none"
    if fw.get("ok"):
        print(f"[wizard] 本机防火墙已放行 TCP {port}（{backend}）", flush=True)
    else:
        print(
            f"[wizard] 未能自动改本机防火墙（{backend}）。请手动：ufw allow {port}/tcp",
            flush=True,
        )
    print(f"[wizard] {plan['hint']}", flush=True)


def host_from_request(headers) -> str:
    raw = str(headers.get("Host") or "").strip()
    host = raw.split(",")[0].strip().split("]")[-1].split(":")[0].strip()
    if host.startswith("["):
        host = raw.split("]")[0].lstrip("[")
    return host if is_usable_host(host) else ""


def detect_host_memory() -> dict:
    ram_gib, swap_gib = 24, 0
    try:
        text = Path("/proc/meminfo").read_text(encoding="utf-8")
        for line in text.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            kib = int(parts[1])
            gib = max(0, round(kib / 1024 / 1024))
            if line.startswith("MemTotal:"):
                ram_gib = max(1, gib)
            elif line.startswith("SwapTotal:"):
                swap_gib = max(0, gib)
    except (OSError, ValueError):
        pass
    return {"ramGiB": ram_gib, "swapGiB": swap_gib}


def suggest_memory(ram_gib: float, enabled: list[str], swap_gib: float = 0) -> dict:
    ram = max(8, float(ram_gib or 24))
    swap = max(0, float(swap_gib or 0))
    usable = max(8.0, ram - OS_RESERVE_GIB)
    names = [name for name in SITE_PRODUCTS if name in set(enabled)]
    if not names:
        names = ["control-plane"]
    total_weight = sum(MEMORY_PROFILES[name]["weight"] for name in names)
    products = {}
    working_sum = 0
    limit_sum = 0
    for name in names:
        profile = MEMORY_PROFILES[name]
        share = usable * (profile["weight"] / total_weight)
        working_gib = min(share, float(profile["maxWorkingGiB"]))
        working_mib = max(512, int(round(working_gib * 1024)))
        limit_mib = max(working_mib + 256, int(round(working_mib * CEILING_FACTOR)))
        db_mib = max(512, int(round(working_mib * float(profile["dbShare"]))))
        products[name] = {
            "workingMiB": working_mib,
            "limitMiB": limit_mib,
            "dbLimitMiB": db_mib,
            "note": profile["note"],
        }
        working_sum += working_mib
        limit_sum += limit_mib
    advice = [
        f"按物理内存规划，不要把 {int(swap)} GiB swap 算进容量。swap 只防瞬时尖峰，长期用会卡死。",
        f"给内核 / Docker / 页缓存留约 {OS_RESERVE_GIB} GiB，工作集之和目标 ≤ {usable:.0f} GiB。",
        "mem_limit 是天花板，不是预留。各产品不会同时顶满，所以上限合计可以大于 24 GiB。",
        "工作集才是「平时该能放下」的数；上限可以更高，让录制 / 查询突发有空间。",
    ]
    return {
        "ramGiB": ram,
        "swapGiB": swap,
        "osReserveGiB": OS_RESERVE_GIB,
        "usableGiB": usable,
        "workingMiB": working_sum,
        "limitMiB": limit_sum,
        "products": products,
        "advice": advice,
        "overcommitLimits": limit_sum > ram * 1024,
    }


def enabled_products(site: dict) -> list[str]:
    products = site.get("products") or {}
    return [name for name in SITE_PRODUCTS if bool((products.get(name) or {}).get("enabled"))]


def random_login_password() -> str:
    return secrets.token_urlsafe(18)


def ensure_account_passwords(kit: Path) -> list[str]:
    """Fill empty admin login passwords. Does not overwrite form/env values."""
    accounts = read_env_file(kit, "identity/ACCOUNTS.product.env")
    updates = {}
    filled = []
    for item in LOGIN_ACCOUNTS:
        if not value_is_set(accounts.get(item["passwordKey"], "")):
            updates[item["passwordKey"]] = random_login_password()
            filled.append(item["passwordKey"])
    _write_env_updates(kit, "identity/ACCOUNTS.product.env", updates)
    return filled


def required_login_accounts(site: dict) -> list[dict]:
    enabled = set(enabled_products(site))
    required = []
    for item in LOGIN_ACCOUNTS:
        if item["product"] in enabled:
            required.append(item)
    return required


def preflight(kit: Path) -> dict:
    ensure_account_passwords(kit)
    site = load_json(kit / "site.json", {})
    accounts = read_env_file(kit, "identity/ACCOUNTS.product.env")
    errors = []
    warnings = []
    public_host = str(site.get("publicHost") or "").strip()
    if PLACEHOLDER_HOST.search(public_host):
        errors.append(
            {
                "code": "missing_public_host",
                "target": "publicHost",
                "message": "请填写服务器公网 IP 或 DNS。",
            }
        )
    enabled = enabled_products(site)
    if not enabled:
        errors.append({"code": "nothing_enabled", "target": "products", "message": "第一步请至少勾选控制面或一个产品。"})
    for item in required_login_accounts(site):
        if not value_is_set(accounts.get(item["passwordKey"], "")):
            errors.append(
                {
                    "code": "login_password_missing",
                    "target": item["passwordKey"],
                    "message": f"{item['label']} 登录密码未配置，不能安装。",
                }
            )
        if not _unquote(accounts.get(item["usernameKey"], "")):
            errors.append(
                {
                    "code": "login_username_missing",
                    "target": item["usernameKey"],
                    "message": f"{item['label']} 用户名未配置。",
                }
            )
    hosts = site.get("hosts") if isinstance(site.get("hosts"), dict) else {}
    defaults = default_hosts(kit)
    ip_hosts = []
    for name in enabled:
        value = resolve_form_host(name, hosts, defaults)
        if host_is_ip_access(value) or looks_like_ipv4(value):
            ip_hosts.append(name)
        elif name == "vistaremote" and value and not vistaremote_host_ok(value):
            warnings.append(
                {
                    "code": "vistaremote_host_not_under_vistacast",
                    "target": "hosts.vistaremote",
                    "message": f"VistaRemote 没有独立主域名，应使用 {VISTAREMOTE_PARENT} 子域（默认 {VISTAREMOTE_DEFAULT}）。",
                }
            )
    if ip_hosts:
        warnings.append(
            {
                "code": "ip_access",
                "target": "hosts",
                "message": "已清空或改成 IP 的产品将走 IP:端口。浏览器没有 HTTPS，登录可能失败。客户交付请填域名。",
            }
        )
    protocol = str(site.get("protocol") or "https").strip()
    if protocol == "http":
        for name in enabled:
            value = resolve_form_host(name, hosts, defaults)
            if value.endswith(".dev") or ".dev." in value:
                warnings.append(
                    {
                        "code": "dot_dev_requires_https",
                        "target": f"hosts.{name}",
                        "message": ".dev 域名浏览器强制 HTTPS。请保留域名并选 https，或清空域名改走应急 IP:端口。",
                    }
                )
                break
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "enabled": enabled,
        "publicHost": public_host,
        "protocol": protocol,
    }


def load_state(kit: Path, expires_at: float | None = None, request_host: str = "") -> dict:
    site = load_json(kit / "site.json", {})
    catalog = host_catalog(kit)
    defaults = default_hosts(kit)
    hosts_in = site.get("hosts") if isinstance(site.get("hosts"), dict) else {}
    hosts = {}
    for name in SITE_PRODUCTS:
        hosts[name] = resolve_form_host(name, hosts_in, defaults)
    products_in = site.get("products") if isinstance(site.get("products"), dict) else {}
    products = {}
    for name in SITE_PRODUCTS:
        entry = products_in.get(name) or {}
        products[name] = {
            "enabled": bool(entry.get("enabled")) if name in products_in else name == "control-plane",
            "seed": entry.get("seed") if isinstance(entry.get("seed"), dict) else {},
        }
    accounts_env = read_env_file(kit, "identity/ACCOUNTS.product.env")
    accounts = []
    for item in LOGIN_ACCOUNTS:
        accounts.append(
            {
                **item,
                "email": _unquote(accounts_env.get(item["emailKey"], "")),
                "username": _unquote(accounts_env.get(item["usernameKey"], "")),
                "passwordSet": value_is_set(accounts_env.get(item["passwordKey"], "")),
            }
        )
    internal = []
    for item in INTERNAL_SECRETS:
        env = read_env_file(kit, item["file"])
        internal.append({**item, "set": value_is_set(env.get(item["key"], ""))})
    host_mem = site.get("host") if isinstance(site.get("host"), dict) else {}
    detected = detect_host_memory()
    ram = float(host_mem.get("ramGiB") or detected["ramGiB"])
    swap = float(host_mem.get("swapGiB") if host_mem.get("swapGiB") is not None else detected["swapGiB"])
    enabled = [name for name, meta in products.items() if meta.get("enabled")]
    memory = suggest_memory(ram, enabled, swap)
    saved = site.get("resources") if isinstance(site.get("resources"), dict) else {}
    if saved:
        memory["products"] = {**memory["products"], **saved}
    public_host = str(site.get("publicHost") or "").strip()
    if not is_usable_host(public_host):
        if is_usable_host(request_host):
            public_host = request_host
        else:
            public_host = detect_public_host(kit)
    return {
        "publicHost": public_host,
        "protocol": str(site.get("protocol") or "https"),
        "platform": str(site.get("platform") or "linux/amd64"),
        "hosts": hosts,
        "hostCatalog": catalog,
        "products": products,
        "accounts": accounts,
        "internal": internal,
        "memory": memory,
        "installReady": (kit / READY_NAME).is_file(),
        "closed": (kit / CLOSED_NAME).is_file(),
        "expiresAt": expires_at,
        "ttlSec": DEFAULT_TTL_SEC,
        "checks": {
            "docker": bool(shutil.which("docker")),
            "accountsFile": (kit / "identity" / "ACCOUNTS.product.env").is_file(),
            "siteFile": (kit / "site.json").is_file(),
        },
        "preflight": preflight(kit),
    }


def _write_env_updates(kit: Path, rel: str, updates: dict[str, str]) -> None:
    if not updates:
        return
    path = kit / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    prev = path.read_text(encoding="utf-8") if path.is_file() else ""
    path.write_text(patch_env(prev, updates), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def apply_form(kit: Path, payload: dict) -> dict:
    site_path = kit / "site.json"
    existing = load_json(site_path, {})
    products_in = payload.get("products") if isinstance(payload.get("products"), dict) else {}
    products = {}
    for name in SITE_PRODUCTS:
        prev = (existing.get("products") or {}).get(name) or {}
        entry = products_in.get(name) if isinstance(products_in.get(name), dict) else {}
        enabled = bool(entry.get("enabled")) if name in products_in else bool(prev.get("enabled"))
        seed = entry.get("seed") if isinstance(entry.get("seed"), dict) else prev.get("seed")
        products[name] = {"enabled": enabled}
        if name == "blockyedu":
            products[name]["seed"] = resolve_blockyedu_seed(seed)
    defaults = default_hosts(kit)
    hosts_in = payload.get("hosts") if isinstance(payload.get("hosts"), dict) else {}
    existing_hosts = existing.get("hosts") if isinstance(existing.get("hosts"), dict) else {}
    hosts = {}
    for name in SITE_PRODUCTS:
        if name in hosts_in:
            hosts[name] = str(hosts_in.get(name) or "").strip().lower()
        else:
            hosts[name] = resolve_form_host(name, existing_hosts, defaults)
    public_host = str(payload.get("publicHost") if "publicHost" in payload else existing.get("publicHost") or "").strip()
    protocol = str(payload.get("protocol") if "protocol" in payload else existing.get("protocol") or "https").strip()
    ram = float(payload.get("ramGiB") or (existing.get("host") or {}).get("ramGiB") or detect_host_memory()["ramGiB"])
    swap = float(payload.get("swapGiB") if payload.get("swapGiB") is not None else (existing.get("host") or {}).get("swapGiB") or 0)
    enabled = [name for name, meta in products.items() if meta.get("enabled")]
    suggested = suggest_memory(ram, enabled, swap)
    resources_in = payload.get("resources") if isinstance(payload.get("resources"), dict) else {}
    resources = {}
    for name in enabled:
        src = resources_in.get(name) if isinstance(resources_in.get(name), dict) else suggested["products"].get(name) or {}
        resources[name] = {
            "workingMiB": int(src.get("workingMiB") or suggested["products"][name]["workingMiB"]),
            "limitMiB": int(src.get("limitMiB") or suggested["products"][name]["limitMiB"]),
            "dbLimitMiB": int(src.get("dbLimitMiB") or suggested["products"][name]["dbLimitMiB"]),
        }
    site = {
        "$comment": "勾选产品与内存上限。不要写密码。hosts 默认品牌域名；清空某栏才走源站 IP:端口。公网登录在 identity/ACCOUNTS.product.env。VistaRemote 使用 vistacast.dev 子域。",
        "publicHost": public_host,
        "protocol": protocol,
        "platform": "linux/amd64",
        "profile": "control-plane",
        "identity": {"accountsProfile": "product"},
        "hosts": hosts,
        "host": {"ramGiB": ram, "swapGiB": swap},
        "resources": resources,
        "products": products,
    }
    site_path.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    accounts_updates = {}
    incoming_accounts = payload.get("accounts") if isinstance(payload.get("accounts"), dict) else {}
    for item in LOGIN_ACCOUNTS:
        blob = incoming_accounts.get(item["product"]) if isinstance(incoming_accounts.get(item["product"]), dict) else {}
        for field, key_name in (("email", "emailKey"), ("username", "usernameKey"), ("password", "passwordKey")):
            raw = blob.get(field)
            if raw is None or str(raw) == "":
                continue
            accounts_updates[item[key_name]] = str(raw)
    _write_env_updates(kit, "identity/ACCOUNTS.product.env", accounts_updates)

    by_file: dict[str, dict[str, str]] = {}
    secrets_in = payload.get("internalSecrets") if isinstance(payload.get("internalSecrets"), dict) else {}
    for item in INTERNAL_SECRETS:
        raw = secrets_in.get(item["key"])
        if raw is None or str(raw) == "":
            continue
        by_file.setdefault(item["file"], {})[item["key"]] = str(raw)
    for rel, updates in by_file.items():
        _write_env_updates(kit, rel, updates)

    memory_path = kit / "deploy" / "env" / "memory.env"
    memory_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 工作集应落在物理内存内；mem_limit 合计可以大于 RAM。不要按 RAM+swap 规划。",
        f"HOST_RAM_GIB={int(ram)}",
        f"HOST_SWAP_GIB={int(swap)}",
    ]
    for name, spec in resources.items():
        prefix = name.upper().replace("-", "_")
        lines.append(f"{prefix}_WORKING_MIB={spec['workingMiB']}")
        lines.append(f"{prefix}_MEM_LIMIT_MIB={spec['limitMiB']}")
        lines.append(f"{prefix}_DB_LIMIT_MIB={spec['dbLimitMiB']}")
    memory_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return preflight(kit)


def export_csv(kit: Path) -> str:
    site = load_json(kit / "site.json", {})
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["section", "product", "key", "value", "file", "note"])
    writer.writerow(["site", "", "publicHost", site.get("publicHost") or "", "site.json", ""])
    writer.writerow(["site", "", "protocol", site.get("protocol") or "", "site.json", ""])
    for name, host in (site.get("hosts") or {}).items():
        writer.writerow(["host", name, "hostname", host, "site.json", ""])
    for name, meta in (site.get("products") or {}).items():
        writer.writerow(["product", name, "enabled", str(bool(meta.get("enabled"))).lower(), "site.json", ""])
    accounts = read_env_file(kit, "identity/ACCOUNTS.product.env")
    for item in required_login_accounts(site):
        writer.writerow(["login", item["product"], item["emailKey"], accounts.get(item["emailKey"], ""), item["file"], item["label"]])
        writer.writerow(["login", item["product"], item["usernameKey"], accounts.get(item["usernameKey"], ""), item["file"], ""])
        writer.writerow(["login", item["product"], item["passwordKey"], accounts.get(item["passwordKey"], ""), item["file"], "public OIDC login"])
    for item in INTERNAL_SECRETS:
        env = read_env_file(kit, item["file"])
        writer.writerow(["ops", item["product"], item["key"], env.get(item["key"], ""), item["file"], item["label"]])
    for name, spec in (site.get("resources") or {}).items():
        writer.writerow(["memory", name, "workingMiB", spec.get("workingMiB"), "site.json", "working set"])
        writer.writerow(["memory", name, "limitMiB", spec.get("limitMiB"), "site.json", "cgroup ceiling"])
        writer.writerow(["memory", name, "dbLimitMiB", spec.get("dbLimitMiB"), "site.json", "database ceiling"])
    return buf.getvalue()


def html_path(kit: Path) -> Path:
    candidates = [
        kit / "wizard" / "index.html",
        Path(__file__).resolve().parent.parent / "deploy" / "luminaryworks-install" / "wizard" / "index.html",
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError("wizard/index.html not found")


def mark(kit: Path, name: str) -> None:
    (kit / name).write_text("1\n", encoding="utf-8")


def serve(
    kit: Path,
    bind: str,
    port: int | None = None,
    ttl_sec: int = DEFAULT_TTL_SEC,
    advertise_host: str = "",
) -> int:
    if (kit / CLOSED_NAME).is_file():
        print("[wizard] 配置页已关闭，不能再打开。请改 site.json / env 后使用 --no-wizard。", flush=True)
        return 0 if (kit / READY_NAME).is_file() else 1
    try:
        plan = prepare_wizard_listen(kit, bind, port)
    except OSError as err:
        print(f"[wizard] {err}", file=sys.stderr, flush=True)
        return 78
    port = int(plan["port"])
    token = secrets.token_urlsafe(16)
    import time

    expires_at = time.time() + max(60, int(ttl_sec))
    state = {"closed": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            sys.stderr.write("[wizard] " + (fmt % args) + "\n")

        def _gone(self) -> bool:
            return state["closed"] or (kit / CLOSED_NAME).is_file()

        def _token_ok(self) -> bool:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            header = self.headers.get("X-Wizard-Token", "")
            got = header or (query.get("t") or [""])[0]
            if not got or len(got) != len(token):
                return False
            return secrets.compare_digest(got, token)

        def _send(self, code: int, body: bytes, content_type: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, payload: dict) -> None:
            self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length") or "0")
            if length > 1_000_000:
                raise ValueError("payload too large")
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(data, dict):
                raise ValueError("payload must be an object")
            return data

        def _close_ui(self) -> None:
            state["closed"] = True
            mark(kit, CLOSED_NAME)
            threading.Thread(target=self.server.shutdown, daemon=True).start()

        def do_GET(self):
            parsed = urlparse(self.path)
            if self._gone() and parsed.path in ("/", "/index.html"):
                self._send(410, "配置页已关闭。".encode("utf-8"), "text/plain; charset=utf-8")
                return
            if parsed.path in ("/", "/index.html"):
                if not self._token_ok():
                    self._send(
                        401,
                        "请使用 install.sh 打印的完整地址（含 ?t=），在笔记本电脑浏览器打开。".encode("utf-8"),
                        "text/plain; charset=utf-8",
                    )
                    return
                html = html_path(kit).read_text(encoding="utf-8").replace("{{TOKEN}}", token)
                self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")
                return
            if not self._token_ok() or self._gone():
                self._json(410 if self._gone() else 401, {"ok": False, "error": "closed" if self._gone() else "bad token"})
                return
            if parsed.path == "/api/state":
                self._json(200, load_state(kit, expires_at, host_from_request(self.headers)))
                return
            if parsed.path == "/api/preflight":
                self._json(200, preflight(kit))
                return
            if parsed.path == "/api/export.csv":
                if not (kit / READY_NAME).is_file():
                    self._json(409, {"ok": False, "error": "install not finished"})
                    return
                raw = export_csv(kit).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", "attachment; filename=luminaryworks-install.csv")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            self._json(404, {"ok": False, "error": "not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            if self._gone() or not self._token_ok():
                self._json(410 if self._gone() else 401, {"ok": False, "error": "closed" if self._gone() else "bad token"})
                return
            try:
                payload = self._read_json()
            except (ValueError, json.JSONDecodeError) as err:
                self._json(400, {"ok": False, "error": str(err)})
                return
            if parsed.path == "/api/save":
                self._json(200, apply_form(kit, payload))
                return
            if parsed.path == "/api/install":
                result = apply_form(kit, payload)
                if not result["ok"]:
                    self._json(409, result)
                    return
                mark(kit, READY_NAME)
                result["csv"] = True
                self._json(200, result)
                return
            if parsed.path == "/api/close":
                self._json(200, {"ok": True, "closed": True})
                self._close_ui()
                return
            self._json(404, {"ok": False, "error": "not found"})

    httpd = ThreadingHTTPServer((bind, port), Handler)

    def expire():
        if not state["closed"]:
            print("[wizard] 一小时已到，关闭配置页。", flush=True)
            mark(kit, CLOSED_NAME)
            state["closed"] = True
            httpd.shutdown()

    timer = threading.Timer(max(60, int(ttl_sec)), expire)
    timer.daemon = True
    timer.start()
    advertised = detect_public_host(kit, advertise_host)
    public, _local = config_page_url(bind, port, token, advertised)
    (kit / URL_NAME).write_text(public + "\n", encoding="utf-8")
    scope = advertise_scope(advertised)
    (kit / SCOPE_NAME).write_text(scope + "\n", encoding="utf-8")
    if scope == "lan":
        print(f"[wizard] 未检测到公网 IP，使用局域网地址（仅内网可达）: {public}", flush=True)
    else:
        print(f"[wizard] 在运维电脑浏览器打开: {public}", flush=True)
    if "<公网IP>" in public:
        print("[wizard] 未能自动识别 IP，请把地址里的 <公网IP> 换成这台机器的公网或局域网地址。", flush=True)
    if bind in ("127.0.0.1", "localhost"):
        print("[wizard] 当前只绑本机。远程安装请不要传 --wizard-bind 127.0.0.1。", flush=True)
    else:
        print(f"[wizard] 监听 {bind}:{port}", flush=True)
        print_wizard_access(plan)
    print("[wizard] 一小时后自动关闭，装完后可下载 CSV，关闭后不能再打开。", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        timer.cancel()
        httpd.server_close()
    return 0 if (kit / READY_NAME).is_file() else 1


def main(argv: list[str]) -> int:
    kit = Path.cwd()
    bind = "0.0.0.0"
    port: int | None = None
    ttl = DEFAULT_TTL_SEC
    advertise_host = ""
    mode = "serve"
    apply_path = ""
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--kit":
            kit = Path(argv[i + 1]).resolve()
            i += 2
        elif arg == "--bind":
            bind = argv[i + 1]
            i += 2
        elif arg == "--advertise-host":
            advertise_host = argv[i + 1]
            i += 2
        elif arg == "--port":
            port = int(argv[i + 1])
            i += 2
        elif arg == "--ttl":
            ttl = int(argv[i + 1])
            i += 2
        elif arg == "--preflight":
            mode = "preflight"
            i += 1
        elif arg == "--apply":
            mode = "apply"
            apply_path = argv[i + 1]
            i += 2
        elif arg == "--export-csv":
            mode = "csv"
            i += 1
        elif arg == "--memory-plan":
            mode = "memory"
            i += 1
        elif arg == "--serve":
            mode = "serve"
            i += 1
        elif arg == "--detect-host":
            mode = "detect"
            i += 1
        elif arg == "--prepare-wizard":
            mode = "prepare"
            i += 1
        elif arg in ("-h", "--help"):
            print(
                "Usage: install-wizard.py --kit DIR [--serve|--preflight|--apply FILE|--export-csv|--memory-plan|--detect-host|--prepare-wizard]"
            )
            return 0
        else:
            print(f"unknown argument: {arg}", file=sys.stderr)
            return 64
    if mode == "preflight":
        result = preflight(kit)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    if mode == "apply":
        payload = json.loads(Path(apply_path).read_text(encoding="utf-8")) if apply_path != "-" else json.loads(sys.stdin.read() or "{}")
        result = apply_form(kit, payload)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    if mode == "csv":
        sys.stdout.write(export_csv(kit))
        return 0
    if mode == "memory":
        payload = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(suggest_memory(payload.get("ramGiB") or 24, payload.get("enabled") or SITE_PRODUCTS, payload.get("swapGiB") or 0), ensure_ascii=False, indent=2))
        return 0
    if mode == "detect":
        host = detect_public_host(kit, advertise_host)
        if not host:
            return 1
        print(host, flush=True)
        return 0
    if mode == "prepare":
        try:
            plan = prepare_wizard_listen(kit, bind, port)
        except OSError as err:
            print(str(err), file=sys.stderr)
            return 78
        (kit / ".install-ui.access.json").write_text(
            json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print_wizard_access(plan)
        return 0
    return serve(kit, bind, port, ttl, advertise_host)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
