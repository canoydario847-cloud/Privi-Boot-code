#!/usr/bin/env bash
# Static checks on the Privi OS image files (no Docker or root needed).
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
bash -n "$D/image/build.sh"
sh -n "$D/image/hooks/0100-privi.hook.chroot"
for f in "$D"/image/rootfs/usr/local/bin/*; do sh -n "$f"; [[ -x "$f" ]] || { echo "not executable: $f"; exit 1; }; done
for u in "$D"/image/rootfs/etc/systemd/system/*.service; do
  grep -q '^\[Service\]' "$u" && grep -q '^ExecStart=' "$u" || { echo "bad unit: $u"; exit 1; }
done
node --check "$D/shell/apps.js" && node --check "$D/shell/shell.js"
grep -q 'enable privi-shell.service' "$D/image/hooks/0100-privi.hook.chroot"
grep -q 'cp -a "$REPO/os/server.py" "$REPO/os/shell"' "$D/image/build.sh"
echo "image checks passed"
