#!/usr/bin/env bash
# privi-node.sh — join this computer to a Privi network as a full node.
#
# The machine's owner runs this on their own computer. It builds the pinned
# Cosmos EVM node, downloads and verifies the network's genesis, finds peers
# through the seeds listed in the network manifest (then CometBFT peer
# exchange), and installs a systemd service so the node reconnects on every
# boot. It never creates validator keys and never touches wallets or tokens.
#
# Usage:
#   sudo ./privi-node.sh join <network.json | https://.../network.json> [--moniker NAME] [--yes]
#   ./privi-node.sh join <manifest> --dry-run      show every step, change nothing
#   ./privi-node.sh check <manifest>               validate a manifest only
#   ./privi-node.sh status                         sync height, peers, chain id
#   ./privi-node.sh node-id                        this node's seed entry for the manifest
#   sudo ./privi-node.sh refresh-peers             re-read the saved manifest URL, update peers
#   sudo ./privi-node.sh stop | start | uninstall  (uninstall keeps chain data)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/privi_node_lib.py"
PREFIX="${PRIVI_PREFIX:-/opt/privi-node}"
DATA="${PRIVI_DATA:-/var/lib/privi-node}"
HOME_IN_CONTAINER="/data"
SERVICE="privi-node"
UNIT_DIR="${PRIVI_UNIT_DIR:-/etc/systemd/system}"
IMAGE_TAG="privi/evmd"
UID_IN_IMAGE=1025
DRY_RUN=0
ASSUME_YES=0
MONIKER="$(hostname -s 2>/dev/null || echo privi-node)"

die() { echo "privi-node: $*" >&2; exit 1; }
say() { echo "==> $*"; }
run() {
  if (( DRY_RUN )); then printf '[dry-run]'; printf ' %q' "$@"; echo; else "$@"; fi
}

need() { for t in "$@"; do command -v "$t" >/dev/null || die "missing required tool: $t"; done; }

require_root() {
  (( DRY_RUN )) && return 0
  [[ $EUID -eq 0 ]] || die "run with sudo: this installs a system service under $UNIT_DIR"
}

fetch_manifest() {
  # $1 = path or https URL; prints a local file path
  local src="$1" out
  if [[ "$src" == https://* ]]; then
    out="$(mktemp)"
    curl -fsSL --proto '=https' --max-time 60 "$src" -o "$out" || die "cannot download manifest $src"
    echo "$out"
  elif [[ "$src" == http://* ]]; then
    die "manifest must be fetched over https"
  else
    [[ -f "$src" ]] || die "manifest not found: $src"
    echo "$src"
  fi
}

load_manifest() {
  local file="$1" exports
  exports="$(python3 "$LIB" validate "$file")" || die "manifest rejected (see reasons above)"
  eval "$exports"
}

build_image() {
  local tag="$IMAGE_TAG:$UPSTREAM_TAG" src="$PREFIX/src/evm-$UPSTREAM_TAG"
  if (( ! DRY_RUN )) && docker image inspect "$tag" >/dev/null 2>&1; then
    say "Using existing node image $tag"; return
  fi
  say "Building Cosmos EVM $UPSTREAM_TAG node image (first run takes several minutes)"
  run mkdir -p "$PREFIX/src"
  if [[ ! -d "$src/.git" ]]; then
    run git clone --depth 1 --branch "$UPSTREAM_TAG" https://github.com/cosmos/evm.git "$src"
  fi
  if (( ! DRY_RUN )); then
    [[ "$(git -C "$src" describe --tags --exact-match 2>/dev/null)" == "$UPSTREAM_TAG" ]] \
      || die "upstream checkout is not exactly $UPSTREAM_TAG"
    # Same reviewed patch as Privi-Network/production-network/testnet/bootstrap-local-4.sh:
    # v0.7.3 needs Go 1.25.9 but its example Dockerfile pins golang:1.24.
    local df="$src/contrib/images/evmd-env/Dockerfile"
    grep -Fxq "go 1.25.9" "$src/go.mod" || die "unexpected Go version in upstream; review before building"
    sed -i 's|^FROM golang:1[.]24-alpine AS evmd-builder$|FROM golang:1.25.9-alpine AS evmd-builder|' "$df"
    grep -Fxq "FROM golang:1.25.9-alpine AS evmd-builder" "$df" || die "upstream Dockerfile changed; review before building"
  fi
  run make -C "$src" localnet-build-env
  run docker tag cosmos/evmd "$tag"
}

evmd() {
  # Run the node binary in the image against the persistent data directory.
  run docker run --rm --user "$UID_IN_IMAGE:$UID_IN_IMAGE" \
    -v "$DATA:$HOME_IN_CONTAINER" --entrypoint /usr/local/bin/evmd \
    "$IMAGE_TAG:$UPSTREAM_TAG" "$@" --home "$HOME_IN_CONTAINER"
}

init_node() {
  if [[ -f "$DATA/config/genesis.json" ]]; then
    local existing
    existing="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["chain_id"])' "$DATA/config/genesis.json")"
    [[ "$existing" == "$COSMOS_CHAIN_ID" ]] \
      || die "$DATA already holds chain $existing; refusing to mix networks (move it away first)"
    say "Node home already initialised for $COSMOS_CHAIN_ID; keeping its keys and data"
    return
  fi
  say "Initialising node home at $DATA (moniker: $MONIKER)"
  run mkdir -p "$DATA"
  run chown "$UID_IN_IMAGE:$UID_IN_IMAGE" "$DATA"
  run chmod 700 "$DATA"
  evmd init "$MONIKER" --chain-id "$COSMOS_CHAIN_ID"
}

install_genesis() {
  say "Downloading genesis and checking SHA-256"
  local tmp="$DATA/genesis.download"
  (( DRY_RUN )) || tmp="$(mktemp)"
  run curl -fsSL --proto '=https' --max-time 300 "$GENESIS_URL" -o "$tmp"
  if (( ! DRY_RUN )); then
    local got; got="$(sha256sum "$tmp" | cut -d' ' -f1)"
    [[ "$got" == "$GENESIS_SHA256" ]] || { rm -f "$tmp"; die "genesis hash mismatch: got $got, manifest says $GENESIS_SHA256"; }
    local gid; gid="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["chain_id"])' "$tmp")"
    [[ "$gid" == "$COSMOS_CHAIN_ID" ]] || die "genesis chain_id $gid does not match manifest $COSMOS_CHAIN_ID"
  fi
  run install -m 644 -o "$UID_IN_IMAGE" -g "$UID_IN_IMAGE" "$tmp" "$DATA/config/genesis.json"
  run rm -f "$tmp"
}

write_unit() {
  local unit="$UNIT_DIR/$SERVICE.service"
  say "Installing $unit (starts on boot, restarts on failure)"
  local body
  body="[Unit]
Description=Privi network full node ($COSMOS_CHAIN_ID)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker rm -f $SERVICE
ExecStart=/usr/bin/docker run --rm --name $SERVICE --user $UID_IN_IMAGE:$UID_IN_IMAGE \\
  -p 26656:26656 -p 127.0.0.1:26657:26657 -p 127.0.0.1:8545:8545 -p 127.0.0.1:8546:8546 \\
  -v $DATA:$HOME_IN_CONTAINER --entrypoint /usr/local/bin/evmd $IMAGE_TAG:$UPSTREAM_TAG \\
  start --home $HOME_IN_CONTAINER --chain-id $COSMOS_CHAIN_ID --minimum-gas-prices $MIN_GAS_PRICES \\
  --json-rpc.enable --log_format plain
ExecStop=/usr/bin/docker stop -t 60 $SERVICE

[Install]
WantedBy=multi-user.target
"
  if (( DRY_RUN )); then echo "[dry-run] would write $unit:"; echo "$body" | sed 's/^/    /'; return; fi
  printf '%s' "$body" > "$unit"
}

write_peer_timer() {
  # Daily: re-read the published manifest so new seeds reach every node.
  say "Installing daily peer refresh from the published manifest"
  local svc="[Unit]
Description=Refresh Privi node peers from the network manifest
After=network-online.target

[Service]
Type=oneshot
ExecStart=$PREFIX/privi-node.sh refresh-peers
"
  local tmr="[Unit]
Description=Daily Privi peer refresh

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
"
  if (( DRY_RUN )); then echo "[dry-run] would write $UNIT_DIR/$SERVICE-peers.{service,timer}"; return; fi
  printf '%s' "$svc" > "$UNIT_DIR/$SERVICE-peers.service"
  printf '%s' "$tmr" > "$UNIT_DIR/$SERVICE-peers.timer"
  PEER_TIMER=1
}

cmd_join() {
  local src="" ; while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --yes|-y) ASSUME_YES=1 ;;
      --moniker) shift; MONIKER="${1:?--moniker needs a name}" ;;
      -*) die "unknown option $1" ;;
      *) src="$1" ;;
    esac; shift
  done
  [[ -n "$src" ]] || die "join needs a network manifest (file or https URL)"
  [[ "$MONIKER" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "moniker may use letters, digits, . _ - only"
  [[ "$(uname -s)" == Linux ]] || die "Linux only (systemd + Docker)"
  need python3 curl sha256sum
  (( DRY_RUN )) || need docker git make systemctl
  require_root
  (( DRY_RUN )) || docker info >/dev/null 2>&1 || die "Docker daemon is not running"

  local file; file="$(fetch_manifest "$src")"
  load_manifest "$file"

  cat <<EOF
Joining Privi network:
  network        $NET_NAME ($NET_STATUS)
  Cosmos chain   $COSMOS_CHAIN_ID     EVM chain id  $EVM_CHAIN_ID
  node software  cosmos/evm $UPSTREAM_TAG (built locally)
  peers          seeds: ${SEEDS:-none}
                 persistent: ${PERSISTENT_PEERS:-none}
  this computer  moniker $MONIKER, data in $DATA
                 opens P2P port 26656 to the internet; RPC 26657/8545 stay on localhost
  role           full node only (no validator keys, no wallet, no tokens)
EOF
  if (( ! ASSUME_YES && ! DRY_RUN )); then
    read -r -p "Install and start the Privi node service on this computer? [y/N] " ans
    [[ "$ans" =~ ^[Yy] ]] || die "cancelled"
  fi

  build_image
  init_node
  install_genesis
  say "Writing peer, port and mempool settings"
  run python3 "$LIB" configure "$DATA" "$file"
  run chown -R "$UID_IN_IMAGE:$UID_IN_IMAGE" "$DATA/config"
  run mkdir -p "$PREFIX"
  run install -m 644 "$file" "$PREFIX/network.json"
  run install -m 755 "$SCRIPT_DIR/privi-node.sh" "$SCRIPT_DIR/privi_node_lib.py" "$PREFIX/"
  write_unit
  if [[ "$src" == https://* ]]; then
    if (( DRY_RUN )); then echo "[dry-run] would save manifest URL to $PREFIX/manifest-url"
    else printf '%s\n' "$src" > "$PREFIX/manifest-url"; fi
    write_peer_timer
  fi
  run systemctl daemon-reload
  run systemctl enable --now "$SERVICE"
  [[ "${PEER_TIMER:-0}" == 1 ]] && run systemctl enable --now "$SERVICE-peers.timer"
  (( DRY_RUN )) && { say "Dry run complete; nothing was changed."; return; }
  say "Started. Check progress with: $0 status"
}

rpc() { curl -fsS --max-time 5 "http://127.0.0.1:26657/$1"; }

cmd_status() {
  need curl python3
  systemctl is-active --quiet "$SERVICE" 2>/dev/null && echo "service: running" || echo "service: not running"
  local st net
  st="$(rpc status)" || die "node RPC not reachable on 127.0.0.1:26657"
  net="$(rpc net_info)" || net='{"result":{"n_peers":"?"}}'
  python3 - "$st" "$net" <<'PY'
import json, sys
s = json.loads(sys.argv[1])["result"]; n = json.loads(sys.argv[2])["result"]
si, ni = s["sync_info"], s["node_info"]
print(f"chain:   {ni['network']}")
print(f"height:  {si['latest_block_height']}  ({si['latest_block_time']})")
print(f"syncing: {si['catching_up']}")
print(f"peers:   {n.get('n_peers')}")
PY
}

cmd_node_id() {
  need curl python3
  local id ip
  id="$(rpc status | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["node_info"]["id"])')" \
    || die "node RPC not reachable; is the service running?"
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<public-ip-or-dns>')"
  echo "$id@$ip:26656"
  echo "(add this to \"seeds\" in network.json only if port 26656 is reachable from the internet)" >&2
}

cmd_refresh_peers() {
  require_root
  [[ -f "$PREFIX/manifest-url" ]] || die "no manifest URL saved (node was joined from a local file)"
  local file; file="$(fetch_manifest "$(cat "$PREFIX/manifest-url")")"
  load_manifest "$file"
  local have; have="$(sha256sum "$DATA/config/genesis.json" | cut -d' ' -f1)"
  [[ "$have" == "$GENESIS_SHA256" ]] || die "manifest now points at a different genesis; refusing automatic switch"
  python3 "$LIB" refresh-peers "$DATA" "$file"
  install -m 644 "$file" "$PREFIX/network.json"
  systemctl restart "$SERVICE"
  say "Peers updated and node restarted"
}

cmd_uninstall() {
  require_root
  systemctl disable --now "$SERVICE" "$SERVICE-peers.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$SERVICE.service" "$UNIT_DIR/$SERVICE-peers.service" "$UNIT_DIR/$SERVICE-peers.timer"
  systemctl daemon-reload
  say "Service removed. Chain data kept in $DATA (delete it yourself if you no longer need it)."
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    join) cmd_join "$@" ;;
    check) need python3; local f; f="$(fetch_manifest "${1:?check needs a manifest}")"; load_manifest "$f"
           echo "OK: $NET_NAME ($COSMOS_CHAIN_ID / EVM $EVM_CHAIN_ID) is joinable" ;;
    status) cmd_status ;;
    node-id) cmd_node_id ;;
    refresh-peers) cmd_refresh_peers ;;
    start|stop) require_root; systemctl "$cmd" "$SERVICE" ;;
    uninstall) cmd_uninstall ;;
    *) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; [[ -z "$cmd" ]] || exit 2 ;;
  esac
}

main "$@"
