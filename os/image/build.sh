#!/usr/bin/env bash
# Build the Privi OS bootable ISO (Debian 12 "bookworm", amd64).
#
#   bash os/image/build.sh                 # builds inside Docker (any Linux/macOS with Docker)
#   sudo bash os/image/build.sh --native   # builds directly on a Debian/Ubuntu machine
#
# Optional: PRIVI_NETWORK_URL=https://.../network.json bakes in the network
# every computer should join on first boot.
#
# Output: os/image/out/privi-os-<version>-amd64.iso — write it to a USB stick
# (e.g. with balenaEtcher or `dd`), boot from it, and either use it live or
# choose "Install" from the boot menu.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
VERSION="$(python3 -c 'import re,sys;print(re.search(r"VERSION = \"(.+?)\"", open(sys.argv[1]).read()).group(1))' "$REPO/os/server.py" 2>/dev/null || echo 0.1.0)"
OUT="$HERE/out"

if [[ "${1:-}" != "--native" ]]; then
  command -v docker >/dev/null || { echo "Install Docker, or run with --native on Debian/Ubuntu" >&2; exit 1; }
  exec docker run --rm --privileged \
    -e PRIVI_NETWORK_URL="${PRIVI_NETWORK_URL:-}" \
    -v "$REPO:/src:ro" -v "$OUT:/out" \
    debian:bookworm bash -c 'apt-get update -qq && apt-get install -y -qq python3 >/dev/null && bash /src/os/image/build.sh --native'
fi

[[ $EUID -eq 0 ]] || { echo "--native build needs root (live-build mounts filesystems)" >&2; exit 1; }
if [[ -d /src ]]; then REPO=/src; OUT=/out; fi
command -v lb >/dev/null || { apt-get update -qq; apt-get install -y -qq live-build >/dev/null; }

WORK="$(mktemp -d /tmp/privi-os-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

lb config \
  --distribution bookworm \
  --architectures amd64 \
  --archive-areas "main contrib non-free-firmware" \
  --binary-images iso-hybrid \
  --debian-installer live \
  --debian-installer-gui false \
  --iso-application "Privi OS" \
  --iso-volume "PRIVI_OS" \
  --iso-publisher "Privi - Dario Canoy" \
  --bootappend-live "boot=live components quiet splash hostname=privi-os username=privi" \
  --memtest none

cat > config/package-lists/privi.list.chroot <<'EOF'
# Desktop session
cage
chromium
fonts-noto-core
fonts-noto-color-emoji
# Shell service
python3
curl
ca-certificates
# Networking and hardware
network-manager
wpasupplicant
firmware-linux-free
firmware-misc-nonfree
firmware-iwlwifi
firmware-realtek
firmware-atheros
pipewire-audio
# Privi node
docker.io
git
make
# Base
sudo
systemd-timesyncd
policykit-1
EOF

mkdir -p config/includes.chroot/opt/privi-os config/includes.chroot/opt/privi-node-src config/hooks/normal
cp -a "$REPO/os/image/rootfs/." config/includes.chroot/
cp -a "$REPO/os/server.py" "$REPO/os/shell" config/includes.chroot/opt/privi-os/
cp -a "$REPO/node/privi-node.sh" "$REPO/node/privi_node_lib.py" "$REPO/node/network.example.json" \
  config/includes.chroot/opt/privi-node-src/
if [[ -n "${PRIVI_NETWORK_URL:-}" ]]; then
  [[ "$PRIVI_NETWORK_URL" == https://* ]] || { echo "PRIVI_NETWORK_URL must be https" >&2; exit 1; }
  printf '%s\n' "$PRIVI_NETWORK_URL" > config/includes.chroot/etc/privi/network-url
fi
cp "$REPO/os/image/hooks/"*.hook.chroot config/hooks/normal/

lb build

mkdir -p "$OUT"
iso="$(ls ./*.iso | head -n1)"
dest="$OUT/privi-os-$VERSION-amd64.iso"
mv "$iso" "$dest"
sha256sum "$dest" | sed "s|  .*/|  |" > "$dest.sha256"
echo "Built $dest"
cat "$dest.sha256"
