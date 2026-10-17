# Privi Node Bootstrap

One command that joins a Linux computer to a Privi network as a **full node** and keeps it connected across reboots.

Owner and founder: Dario Canoy, Privi.

## What it does

1. Reads a published **network manifest** (`network.json`) and refuses anything that isn't a launched Privi network: no upstream demo chain (`local-4221`), no default EVM chain IDs, no unhashed or non-HTTPS genesis, no network without peers.
2. Builds the pinned Cosmos EVM `v0.7.3` node in Docker, with the same reviewed Go patch as `Privi-Network/production-network/testnet/bootstrap-local-4.sh`.
3. Downloads the genesis and checks its SHA-256 and chain ID against the manifest.
4. Sets seeds, persistent peers and peer exchange, so the node finds the rest of the network automatically.
5. Installs `privi-node.service` (systemd): starts on boot, restarts on failure. If the manifest came from a URL, a daily timer re-reads it so new seed nodes reach every machine, without ever switching to a different genesis.

Only P2P port 26656 is opened to the internet. RPC (26657) and EVM JSON-RPC (8545/8546) stay on `127.0.0.1`. The script never creates validator keys, wallets or tokens.

## Use

```bash
git clone https://github.com/canoydario847-cloud/Privi-Boot-code
cd Privi-Boot-code/node
./privi-node.sh join https://<your-domain>/network.json --dry-run   # see every step first
sudo ./privi-node.sh join https://<your-domain>/network.json        # asks before installing
./privi-node.sh status                                              # height, syncing, peers
```

Other commands: `check <manifest>`, `node-id`, `refresh-peers`, `start`, `stop`, `uninstall` (keeps chain data).

Requirements: Linux with systemd, Docker, git, make, curl, python3.

## Before any computer can join

There is **no public Privi network yet** — the Cosmos EVM chain in Privi-Network is a single-machine developer demo, and `privi-dev-1` on Railway is a JavaScript prototype. `network.example.json` is therefore marked `planned` and the script will refuse it. To go live:

1. Run the genesis ceremony in `Privi-Network/production-network/ops/PUBLIC_TESTNET.md` with independently operated validators, a unique EVM chain ID and denom.
2. Publish the genesis file and its SHA-256.
3. On each running seed node, run `./privi-node.sh node-id` and add the output to `seeds`.
4. Fill in `network.example.json`, set `network_status` to `public-testnet`, and host it over HTTPS (e.g. `https://rpc-testnet.priviflow.us/network.json`).

From then on, every new computer joins with the single `join` command above.

## Tests

```bash
python3 -m unittest discover node/tests   # manifest rules and config edits
bash node/tests/dry_run.sh                # full join in dry-run mode, no changes
```
