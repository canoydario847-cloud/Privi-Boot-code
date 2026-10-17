#!/usr/bin/env bash
# Offline end-to-end check of privi-node.sh: manifest gating and a full dry run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SH="$HERE/../privi-node.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
if "$SH" check "$HERE/../network.example.json" 2>/dev/null; then echo "FAIL: template accepted"; exit 1; fi
cat > "$T/net.json" <<J
{"name":"Privi Test","network_status":"public-testnet","cosmos_chain_id":"privi-testnet-1",
 "evm_chain_id":7771,"upstream_tag":"v0.7.3","denom":"apriv","minimum_gas_prices":"0.0001apriv",
 "genesis_url":"https://example.org/genesis.json","genesis_sha256":"$(printf 'a%.0s' {1..64})",
 "seeds":["0123456789abcdef0123456789abcdef01234567@seed1.example.org:26656"],"persistent_peers":[]}
J
"$SH" check "$T/net.json"
out="$(PRIVI_DATA="$T/data" PRIVI_PREFIX="$T/opt" PRIVI_UNIT_DIR="$T/units" "$SH" join "$T/net.json" --dry-run --moniker test-box)"
for want in "git clone --depth 1 --branch v0.7.3" "init test-box --chain-id privi-testnet-1" \
            "-p 26656:26656 -p 127.0.0.1:26657:26657" "systemctl enable --now privi-node" "Dry run complete"; do
  grep -qF -- "$want" <<<"$out" || { echo "FAIL: dry run missing: $want"; echo "$out"; exit 1; }
done
[[ ! -e "$T/data" && ! -e "$T/units" ]] || { echo "FAIL: dry run changed files"; exit 1; }
if "$SH" join "$T/net.json" --dry-run --moniker 'bad name;x' 2>/dev/null; then echo "FAIL: bad moniker accepted"; exit 1; fi
echo "dry-run checks passed"
