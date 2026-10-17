# Privi OS

A browser-first operating system in the spirit of ChromeOS, with the Privi network built in. It boots straight into a full-screen desktop: shelf, app launcher, windows, quick settings, and a Privi node that joins the network automatically.

Created by Dario Canoy, founder of Privi. Built on Debian 12 and Cosmos EVM.

## What you get

| Part | What it is |
| --- | --- |
| Desktop shell (`shell/`) | Shelf with pinned and running apps, launcher with search (type an address to open the web), draggable/resizable windows, quick settings (network, Privi node, theme, brightness, sleep/restart/shut down), dark and light themes, wallpapers |
| Built-in apps | Web, Files, Privi Node (live block height, peers, sync), Notes, Calculator, Settings (Wi-Fi, appearance, node, about) |
| Shell service (`server.py`) | Local-only service on `127.0.0.1:8080` that serves the desktop and its system API (status, Privi node, home folder, Wi-Fi, power) |
| Bootable image (`image/`) | Debian live ISO that autologs in to a kiosk session (`cage` + Chromium in app mode), with an **Install** option in the boot menu |
| Privi node | `node/privi-node.sh` is preinstalled. On startup, `privi-firstboot` joins the network named in `/etc/privi/network-url` and the node service keeps it connected on every boot |

## Try the desktop on any computer

```bash
cd os
PRIVI_SHELL_DEV=1 python3 server.py
# open http://127.0.0.1:8080
```

`PRIVI_SHELL_DEV=1` makes the power buttons do nothing, so it's safe on your own machine.

## Build the bootable ISO

Needs Docker (or a Debian/Ubuntu machine, as root, with `--native`), about 10 GB free and a fast connection.

```bash
bash os/image/build.sh
# or bake in the network every computer should join:
PRIVI_NETWORK_URL=https://rpc-testnet.priviflow.us/network.json bash os/image/build.sh
```

The ISO lands in `os/image/out/` with its SHA-256. Write it to a USB stick (balenaEtcher, Rufus or `dd`), boot from it, and either run it live or choose **Install** to put Privi OS on the disk.

Keyboard: the Search/Windows key opens the launcher, Ctrl+W closes the focused window, Esc closes panels.

## Joining the Privi network

The image joins automatically once `/etc/privi/network-url` holds the https address of a published `network.json`. Until a public Privi network has launched (see `node/README.md`), the join step safely refuses and the Privi Node app shows "Not joined".

## Security notes

- The shell service listens on loopback only. Actions that change the system (Wi-Fi, power) need JSON with an `X-Privi-Shell` header and a same-origin request, so a website open in the Web app can't trigger them.
- The Files app is read-only and can't leave the home folder, including through links.
- The live system's `privi` user has no password. The installer sets one; set one yourself if you keep using the live USB.
- Wi-Fi and power permissions are granted to the `privi` user through `/etc/polkit-1/rules.d/50-privi.rules`.

## Tests

```bash
python3 -m unittest discover os/tests   # shell service API and protections
bash os/tests/check_image.sh            # image scripts, units and shell JavaScript
```
