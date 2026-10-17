#!/usr/bin/env python3
"""Privi OS shell service.

Serves the desktop shell on http://127.0.0.1:8080 and a small local API the
shell uses: system status, Privi node status, read-only home folder listing,
Wi-Fi (via NetworkManager's nmcli) and power actions.

Binds to loopback only. State-changing calls must be JSON with the
X-Privi-Shell header and a same-origin Origin, so a web page open in the
shell's browser cannot trigger them.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("PRIVI_SHELL_HOST", "127.0.0.1")
PORT = int(os.environ.get("PRIVI_SHELL_PORT", "8080"))
SHELL_DIR = os.environ.get(
    "PRIVI_SHELL_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shell")
)
FILES_ROOT = os.path.realpath(os.environ.get("PRIVI_FILES_ROOT", os.path.expanduser("~")))
NODE_RPC = os.environ.get("PRIVI_NODE_RPC", "http://127.0.0.1:26657")
VERSION = "0.1.0"
ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}


def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, "", str(exc)


def read(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return default


def battery():
    base = "/sys/class/power_supply"
    try:
        names = os.listdir(base)
    except OSError:
        return None
    for name in names:
        if read(os.path.join(base, name, "type")) == "Battery":
            cap = read(os.path.join(base, name, "capacity"))
            return {
                "percent": int(cap) if cap and cap.isdigit() else None,
                "status": read(os.path.join(base, name, "status"), "Unknown"),
            }
    return None


def network():
    try:
        ifaces = [i for i in os.listdir("/sys/class/net") if i != "lo"]
    except OSError:
        ifaces = []
    up = [i for i in ifaces if read(f"/sys/class/net/{i}/operstate") == "up"]
    wifi = any(os.path.isdir(f"/sys/class/net/{i}/wireless") for i in up)
    return {"online": bool(up), "kind": "wifi" if wifi else ("wired" if up else "none")}


def service_active(name):
    if not shutil.which("systemctl"):
        return None
    code, out, _ = run(["systemctl", "is-active", name], timeout=3)
    return out.strip() == "active"


def system_info():
    uptime = read("/proc/uptime", "0").split()[0]
    return {
        "version": VERSION,
        "hostname": socket.gethostname(),
        "uptime_s": int(float(uptime)),
        "battery": battery(),
        "network": network(),
        "node_service": service_active("privi-node"),
        "time": int(time.time()),
    }


def rpc(path):
    with urllib.request.urlopen(f"{NODE_RPC}/{path}", timeout=3) as r:
        return json.load(r)["result"]


def node_info():
    manifest = None
    try:
        with open("/opt/privi-node/network.json", encoding="utf-8") as fh:
            m = json.load(fh)
            manifest = {k: m.get(k) for k in ("name", "network_status", "cosmos_chain_id", "evm_chain_id")}
    except (OSError, ValueError):
        pass
    try:
        st = rpc("status")
        peers = rpc("net_info").get("n_peers")
    except Exception:
        return {"running": False, "joined": manifest is not None, "network": manifest}
    si, ni = st["sync_info"], st["node_info"]
    return {
        "running": True,
        "joined": True,
        "network": manifest,
        "chain_id": ni.get("network"),
        "moniker": ni.get("moniker"),
        "height": int(si.get("latest_block_height", 0)),
        "block_time": si.get("latest_block_time"),
        "syncing": si.get("catching_up"),
        "peers": int(peers) if str(peers).isdigit() else peers,
    }


def list_files(rel):
    target = os.path.realpath(os.path.join(FILES_ROOT, rel.lstrip("/")))
    if target != FILES_ROOT and not target.startswith(FILES_ROOT + os.sep):
        raise PermissionError("outside home folder")
    entries = []
    with os.scandir(target) as it:
        for e in it:
            if e.name.startswith("."):
                continue
            try:
                st = e.stat()
            except OSError:
                continue
            entries.append({
                "name": e.name,
                "dir": e.is_dir(),
                "size": st.st_size,
                "modified": int(st.st_mtime),
            })
    entries.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    rel_out = os.path.relpath(target, FILES_ROOT)
    return {"path": "" if rel_out == "." else rel_out, "entries": entries}


def wifi_list():
    if not shutil.which("nmcli"):
        return {"available": False, "networks": []}
    code, out, _ = run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list"])
    nets, seen = [], set()
    for line in out.splitlines():
        parts = line.replace("\\:", "\x00").split(":")
        if len(parts) < 4:
            continue
        in_use, ssid, signal, sec = [p.replace("\x00", ":") for p in parts[:4]]
        if not ssid or ssid in seen:
            continue
        seen.add(ssid)
        nets.append({"ssid": ssid, "signal": int(signal or 0), "secure": bool(sec and sec != "--"),
                     "connected": in_use.strip() == "*"})
    nets.sort(key=lambda n: (not n["connected"], -n["signal"]))
    return {"available": True, "networks": nets}


def wifi_connect(ssid, password):
    if not isinstance(ssid, str) or not ssid or len(ssid) > 64:
        raise ValueError("invalid network name")
    cmd = ["nmcli", "dev", "wifi", "connect", ssid]
    if password:
        if not isinstance(password, str) or len(password) > 128:
            raise ValueError("invalid password")
        cmd += ["password", password]
    code, out, err = run(cmd, timeout=40)
    return {"ok": code == 0, "message": (out or err).strip()}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SHELL_DIR, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("privi-shell: " + (fmt % args) + "\n")

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        try:
            if url.path == "/api/system":
                return self.send_json(system_info())
            if url.path == "/api/node":
                return self.send_json(node_info())
            if url.path == "/api/files":
                rel = parse_qs(url.query).get("path", [""])[0]
                return self.send_json(list_files(rel))
            if url.path == "/api/wifi":
                return self.send_json(wifi_list())
        except PermissionError as exc:
            return self.send_json({"error": str(exc)}, 403)
        except FileNotFoundError:
            return self.send_json({"error": "not found"}, 404)
        except Exception as exc:
            return self.send_json({"error": str(exc)}, 500)
        self.send_json({"error": "unknown endpoint"}, 404)

    def do_POST(self):
        url = urlparse(self.path)
        origin = self.headers.get("Origin")
        if (self.headers.get("X-Privi-Shell") != "1"
                or (origin and origin not in ALLOWED_ORIGINS)
                or not self.headers.get("Content-Type", "").startswith("application/json")):
            return self.send_json({"error": "forbidden"}, 403)
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 4096)
            data = json.loads(self.rfile.read(length) or b"{}")
            if url.path == "/api/wifi/connect":
                return self.send_json(wifi_connect(data.get("ssid"), data.get("password")))
            if url.path == "/api/power":
                action = data.get("action")
                if action not in ("poweroff", "reboot", "suspend"):
                    return self.send_json({"error": "unknown action"}, 400)
                if os.environ.get("PRIVI_SHELL_DEV") == "1":
                    return self.send_json({"ok": True, "dev": True})
                code, _, err = run(["systemctl", action], timeout=10)
                return self.send_json({"ok": code == 0, "message": err.strip()})
        except ValueError as exc:
            return self.send_json({"error": str(exc)}, 400)
        self.send_json({"error": "unknown endpoint"}, 404)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Privi OS shell on http://{HOST}:{PORT}/ (serving {SHELL_DIR})", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
