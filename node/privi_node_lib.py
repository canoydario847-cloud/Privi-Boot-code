#!/usr/bin/env python3
"""Helpers for privi-node.sh: manifest validation and node config edits.

Standard library only, so it runs on any Linux machine with python3.

Subcommands:
  validate <manifest.json>                 print shell-safe NAME=value lines
  configure <evmd-home> <manifest.json>    write peers/ports/mempool settings
  refresh-peers <evmd-home> <manifest.json> update peers only (same network)
"""
import json
import os
import re
import shlex
import sys

PINNED_UPSTREAM_TAG = "v0.7.3"
LAUNCHED_STATUSES = {"public-testnet", "mainnet"}
DEMO_COSMOS_IDS = {"local-4221"}
DEMO_EVM_IDS = {4221, 9001, 262144}
PEER_RE = re.compile(r"^[0-9a-f]{40}@[A-Za-z0-9.\-]+:[0-9]{1,5}$")
CHAIN_ID_RE = re.compile(r"^[a-z][a-z0-9\-]{2,40}(_[0-9]+-[0-9]+)?$")
DENOM_RE = re.compile(r"^[a-z][a-z0-9/]{2,63}$")
GAS_RE = re.compile(r"^[0-9]+(\.[0-9]+)?[a-z][a-z0-9/]{2,63}$")


class ManifestError(Exception):
    pass


def load_manifest(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read manifest {path}: {exc}")
    if not isinstance(data, dict):
        raise ManifestError("manifest must be a JSON object")
    return data


def validate(m):
    """Return a list of problems; empty means the manifest is joinable."""
    errs = []

    status = m.get("network_status")
    if status not in LAUNCHED_STATUSES:
        errs.append(
            f"network_status is {status!r}; only {sorted(LAUNCHED_STATUSES)} "
            "networks can be joined (a planned network has no live peers yet)"
        )

    cid = m.get("cosmos_chain_id")
    if not isinstance(cid, str) or not CHAIN_ID_RE.match(cid):
        errs.append("cosmos_chain_id missing or malformed")
    elif cid in DEMO_COSMOS_IDS or cid.startswith("local-"):
        errs.append(f"cosmos_chain_id {cid!r} is the upstream developer demo, not a Privi network")

    evm = m.get("evm_chain_id")
    if not isinstance(evm, int) or isinstance(evm, bool) or evm <= 0:
        errs.append("evm_chain_id must be a positive integer")
    elif evm in DEMO_EVM_IDS:
        errs.append(f"evm_chain_id {evm} is an upstream default; a Privi network needs its own")

    if m.get("upstream_tag") != PINNED_UPSTREAM_TAG:
        errs.append(f"upstream_tag must be the reviewed pin {PINNED_UPSTREAM_TAG}")

    url = m.get("genesis_url")
    if not isinstance(url, str) or not url.startswith("https://"):
        errs.append("genesis_url must be an https:// URL")

    sha = m.get("genesis_sha256")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        errs.append("genesis_sha256 must be 64 lowercase hex characters")

    denom = m.get("denom")
    if not isinstance(denom, str) or not DENOM_RE.match(denom):
        errs.append("denom missing or malformed")

    gas = m.get("minimum_gas_prices")
    if not isinstance(gas, str) or not GAS_RE.match(gas):
        errs.append("minimum_gas_prices must look like 0.0001<denom>")
    elif isinstance(denom, str) and not gas.endswith(denom):
        errs.append("minimum_gas_prices must use the network denom")

    seeds = m.get("seeds", [])
    peers = m.get("persistent_peers", [])
    for field, value in (("seeds", seeds), ("persistent_peers", peers)):
        if not isinstance(value, list) or not all(isinstance(p, str) for p in value):
            errs.append(f"{field} must be a list of strings")
            continue
        for p in value:
            if not PEER_RE.match(p):
                errs.append(f"{field} entry {p!r} is not <40-hex-node-id>@host:port")
    if isinstance(seeds, list) and isinstance(peers, list) and not seeds and not peers:
        errs.append("at least one seed or persistent peer is required to find the network")

    return errs


def shell_exports(m):
    fields = {
        "NET_NAME": m.get("name", m["cosmos_chain_id"]),
        "NET_STATUS": m["network_status"],
        "COSMOS_CHAIN_ID": m["cosmos_chain_id"],
        "EVM_CHAIN_ID": str(m["evm_chain_id"]),
        "UPSTREAM_TAG": m["upstream_tag"],
        "GENESIS_URL": m["genesis_url"],
        "GENESIS_SHA256": m["genesis_sha256"],
        "DENOM": m["denom"],
        "MIN_GAS_PRICES": m["minimum_gas_prices"],
        "SEEDS": ",".join(m.get("seeds", [])),
        "PERSISTENT_PEERS": ",".join(m.get("persistent_peers", [])),
    }
    return "\n".join(f"{k}={shlex.quote(v)}" for k, v in fields.items())


def set_toml_key(text, section, key, value):
    """Set key inside [section] (section '' = top level). Value is a TOML literal."""
    lines = text.split("\n")
    current = ""
    start = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            current = stripped[1:-1].strip()
            if current == section and start is None:
                start = i
            continue
        if current == section and re.match(rf"^\s*{re.escape(key)}\s*=", line):
            lines[i] = f"{key} = {value}"
            return "\n".join(lines)
    if section == "":
        lines.insert(0, f"{key} = {value}")
    elif start is not None:
        lines.insert(start + 1, f"{key} = {value}")
    else:
        lines.extend(["", f"[{section}]", f"{key} = {value}"])
    return "\n".join(lines)


def q(s):
    return json.dumps(s)


def edit_file(path, edits):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    for section, key, value in edits:
        text = set_toml_key(text, section, key, value)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def peer_edits(m):
    return [
        ("p2p", "seeds", q(",".join(m.get("seeds", [])))),
        ("p2p", "persistent_peers", q(",".join(m.get("persistent_peers", [])))),
        ("p2p", "pex", "true"),
    ]


def configure(home, m):
    cfg = os.path.join(home, "config", "config.toml")
    app = os.path.join(home, "config", "app.toml")
    edit_file(cfg, peer_edits(m) + [
        # Inside the container these listen on all interfaces; the systemd
        # unit publishes only P2P publicly and keeps RPC on host loopback.
        ("p2p", "laddr", q("tcp://0.0.0.0:26656")),
        ("p2p", "addr_book_strict", "true"),
        ("rpc", "laddr", q("tcp://0.0.0.0:26657")),
        # evmd v0.7.3 refuses CometBFT's flood mempool.
        ("mempool", "type", q("app")),
    ])
    edit_file(app, [
        ("", "minimum-gas-prices", q(m["minimum_gas_prices"])),
        ("json-rpc", "enable", "true"),
        ("json-rpc", "address", q("0.0.0.0:8545")),
        ("json-rpc", "ws-address", q("0.0.0.0:8546")),
        ("json-rpc", "api", q("eth,net,web3,txpool")),
    ])


def read_chain_id(home):
    with open(os.path.join(home, "config", "genesis.json"), encoding="utf-8") as fh:
        return json.load(fh).get("chain_id")


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd = argv[1]
    try:
        if cmd == "validate" and len(argv) == 3:
            m = load_manifest(argv[2])
            errs = validate(m)
            if errs:
                for e in errs:
                    print(f"manifest: {e}", file=sys.stderr)
                return 1
            print(shell_exports(m))
            return 0
        if cmd in ("configure", "refresh-peers") and len(argv) == 4:
            home, m = argv[2], load_manifest(argv[3])
            errs = validate(m)
            if errs:
                for e in errs:
                    print(f"manifest: {e}", file=sys.stderr)
                return 1
            if read_chain_id(home) != m["cosmos_chain_id"]:
                print("node genesis chain_id does not match manifest; refusing", file=sys.stderr)
                return 1
            if cmd == "configure":
                configure(home, m)
            else:
                edit_file(os.path.join(home, "config", "config.toml"), peer_edits(m))
            return 0
    except ManifestError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
