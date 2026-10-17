/* Privi OS shell: window manager, shelf, launcher, quick settings, status. */
"use strict";

const Shell = (() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const winLayer = $("windows");
  const shelfApps = $("shelf-apps");
  const launcher = $("launcher");
  const launcherInput = $("launcher-input");
  const launcherGrid = $("launcher-grid");
  const quick = $("quick");
  const launcherBtn = $("launcher-btn");

  const windows = new Map(); // winId -> {app, el}
  let zTop = 10;
  let nextId = 1;
  let focusedId = null;

  /* ---------- Preferences ---------- */
  function setTheme(t) { root.dataset.theme = t; Store.set("theme", t); updateThemeTile(); }
  function setWall(w) { root.dataset.wall = w; Store.set("wall", w); }
  setTheme(Store.get("theme", "dark"));
  setWall(Store.get("wall", "default"));

  /* ---------- Toasts ---------- */
  function toast(msg) {
    const t = h("div", { class: "toast", role: "status" }, msg);
    $("toasts").append(t);
    setTimeout(() => t.remove(), 4500);
  }

  /* ---------- Windows ---------- */
  function appById(id) { return APPS.find((a) => a.id === id); }

  function open(appId, arg) {
    const app = appById(appId);
    if (!app) return;
    closePanels();
    // Single-instance apps: bring the existing window forward.
    if (!arg || app.id !== "web") {
      for (const [id, w] of windows) if (w.app.id === app.id) {
        w.el.classList.remove("min"); focus(id);
        if (arg && w.reopen) w.reopen(arg);
        return id;
      }
    }
    const id = nextId++;
    const area = winLayer.getBoundingClientRect();
    const width = Math.min(app.w, area.width - 20);
    const height = Math.min(app.h, area.height - 20);
    const offset = (windows.size % 6) * 28;
    const left = Math.max(10, (area.width - width) / 2 - 80 + offset);
    const top = Math.max(10, (area.height - height) / 2 - 40 + offset);

    const title = h("div", { class: "win-title" }, app.name);
    const bar = h("div", { class: "win-bar" }, appIcon(app), title,
      h("button", { class: "win-btn", "aria-label": "Minimize", onclick: () => minimize(id) }, "–"),
      h("button", { class: "win-btn", "aria-label": "Maximize", onclick: () => toggleMax(id) }, "□"),
      h("button", { class: "win-btn close", "aria-label": "Close", onclick: () => close(id) }, "✕"));
    const body = h("div", { class: "win-body" });
    const el = h("div", { class: "win", role: "dialog", "aria-label": app.name,
      style: `left:${left}px;top:${top}px;width:${width}px;height:${height}px` }, bar, body);
    el.addEventListener("mousedown", () => focus(id), true);
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) toggleMax(id); });
    makeDraggable(el, bar, id);
    winLayer.append(el);

    const closers = [];
    const ctx = {
      arg,
      setTitle: (t) => { title.textContent = t ? `${t} — ${app.name}` : app.name; },
      onClose: (fn) => closers.push(fn),
    };
    windows.set(id, { app, el, closers });
    try { app.render(body, ctx); }
    catch (err) { body.append(h("div", { class: "pad" }, "This app hit a problem: " + err.message)); }
    if (app.id === "settings") windows.get(id).reopen = (a) => { body.replaceChildren(); app.render(body, { ...ctx, arg: a }); };
    focus(id);
    drawShelf();
    return id;
  }

  function focus(id) {
    const w = windows.get(id);
    if (!w) return;
    w.el.style.zIndex = ++zTop;
    focusedId = id;
    drawShelf();
  }

  function close(id) {
    const w = windows.get(id);
    if (!w) return;
    w.closers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    w.el.remove();
    windows.delete(id);
    if (focusedId === id) focusedId = null;
    drawShelf();
  }

  function minimize(id) {
    const w = windows.get(id);
    if (!w) return;
    w.el.classList.add("min");
    if (focusedId === id) focusedId = null;
    drawShelf();
  }

  function toggleMax(id) { windows.get(id)?.el.classList.toggle("max"); }

  function makeDraggable(el, handle, id) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || el.classList.contains("max")) return;
      const startX = e.clientX, startY = e.clientY;
      const ox = el.offsetLeft, oy = el.offsetTop;
      const area = winLayer.getBoundingClientRect();
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.min(Math.max(ox + ev.clientX - startX, 60 - el.offsetWidth), area.width - 60);
        const y = Math.min(Math.max(oy + ev.clientY - startY, 0), area.height - 40);
        el.style.left = x + "px"; el.style.top = y + "px";
      };
      const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  /* ---------- Shelf ---------- */
  function drawShelf() {
    const running = new Set([...windows.values()].map((w) => w.app.id));
    const focusedApp = focusedId ? windows.get(focusedId)?.app.id : null;
    const shown = APPS.filter((a) => a.pinned || running.has(a.id));
    shelfApps.replaceChildren(...shown.map((a) => {
      const b = h("button", {
        class: "shelf-app" + (running.has(a.id) ? " running" : "") + (a.id === focusedApp ? " focused" : ""),
        title: a.name, "aria-label": a.name,
        onclick: () => shelfClick(a.id),
      }, appIcon(a));
      return b;
    }));
  }

  function shelfClick(appId) {
    const mine = [...windows].filter(([, w]) => w.app.id === appId);
    if (!mine.length) return open(appId);
    const [id, w] = mine[mine.length - 1];
    if (focusedId === id && !w.el.classList.contains("min")) minimize(id);
    else { w.el.classList.remove("min"); focus(id); }
  }

  /* ---------- Launcher ---------- */
  let sel = 0;
  function launcherMatches() {
    const q = launcherInput.value.trim().toLowerCase();
    return APPS.filter((a) => !q || a.name.toLowerCase().includes(q));
  }
  function drawLauncher() {
    const items = launcherMatches();
    sel = Math.min(sel, Math.max(items.length - 1, 0));
    const q = launcherInput.value.trim();
    const nodes = items.map((a, i) => h("button", { class: "launcher-item" + (i === sel ? " sel" : ""), onclick: () => open(a.id) },
      appIcon(a, "big"), h("span", {}, a.name)));
    if (q && !items.length) {
      nodes.push(h("button", { class: "launcher-item sel", onclick: () => open("web", normalizeUrl(q)) },
        appIcon(appById("web"), "big"), h("span", {}, `Search the web for “${q}”`)));
    }
    launcherGrid.replaceChildren(...nodes);
  }
  function toggleLauncher(force) {
    const show = force ?? launcher.hidden;
    closePanels();
    launcher.hidden = !show;
    launcherBtn.setAttribute("aria-expanded", String(show));
    if (show) { launcherInput.value = ""; sel = 0; drawLauncher(); setTimeout(() => launcherInput.focus(), 20); }
  }
  launcherBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleLauncher(); });
  launcherInput.addEventListener("input", () => { sel = 0; drawLauncher(); });
  launcherInput.addEventListener("keydown", (e) => {
    const items = launcherMatches();
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { sel = Math.min(sel + 1, items.length - 1); drawLauncher(); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); drawLauncher(); e.preventDefault(); }
    else if (e.key === "Enter") {
      const q = launcherInput.value.trim();
      if (items[sel]) open(items[sel].id);
      else if (q) open("web", normalizeUrl(q));
    }
  });

  /* ---------- Quick settings ---------- */
  function toggleQuick(force) {
    const show = force ?? quick.hidden;
    closePanels();
    quick.hidden = !show;
    if (show) refreshStatus();
  }
  $("tray").addEventListener("click", (e) => { e.stopPropagation(); toggleQuick(); });
  quick.addEventListener("click", (e) => {
    const target = e.target.closest("[data-open]");
    if (target) { const [app, arg] = target.dataset.open.split(":"); open(app, arg); }
  });
  $("q-theme").addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark"));
  function updateThemeTile() {
    const tile = $("q-theme"); if (!tile) return;
    const dark = root.dataset.theme !== "light";
    tile.classList.toggle("on", dark);
    $("q-theme-sub").textContent = dark ? "On" : "Off";
  }
  $("q-bright").addEventListener("input", (e) => {
    document.querySelector(".desktop").style.filter = `brightness(${e.target.value}%)`;
  });
  quick.querySelectorAll("[data-power]").forEach((b) => b.addEventListener("click", async () => {
    const action = b.dataset.power;
    const label = { suspend: "sleep", reboot: "restart", poweroff: "shut down" }[action];
    if (action !== "suspend" && !confirm(`Do you want to ${label} this computer?`)) return;
    try { await Api.post("/api/power", { action }); toast(`Going to ${label}…`); }
    catch (err) { toast(`Couldn't ${label}: ${err.message}`); }
  }));

  function closePanels() {
    launcher.hidden = true; quick.hidden = true;
    launcherBtn.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".launcher, .quick")) closePanels();
  });

  /* ---------- Keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanels();
    if (e.key === "Meta" || (e.key === " " && e.ctrlKey)) { e.preventDefault(); toggleLauncher(); }
    if (e.ctrlKey && e.key.toLowerCase() === "w" && focusedId) { e.preventDefault(); close(focusedId); }
  });

  /* ---------- Status ---------- */
  let lastNode = null;
  function tick() {
    const now = new Date();
    $("tray-clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("quick-date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  async function refreshStatus() {
    try {
      const s = await Api.get("/api/system");
      $("quick-host").textContent = s.hostname;
      const kind = s.network.kind;
      $("tray-net").replaceChildren(svg(ICONS[kind === "wifi" ? "wifi" : kind === "wired" ? "wired" : "offline"]));
      $("tray-net").title = s.network.online ? `Connected (${kind})` : "Offline";
      $("q-net-label").textContent = s.network.online ? (kind === "wifi" ? "Wi-Fi" : "Ethernet") : "Offline";
      $("q-net-sub").textContent = s.network.online ? "Connected" : "Tap to connect";
      $("tray-batt").textContent = s.battery && s.battery.percent != null ? s.battery.percent + "%" : "";
    } catch { $("tray-net").replaceChildren(svg(ICONS.offline)); }
    try {
      const n = await Api.get("/api/node");
      const dot = $("tray-node");
      dot.className = "node-dot" + (n.running ? (n.syncing ? " sync" : " ok") : "");
      dot.title = n.running ? `Privi node: ${n.syncing ? "syncing" : "in sync"}, ${n.peers} peers` : "Privi node not running";
      $("q-node-sub").textContent = n.running ? `${n.syncing ? "Syncing" : "Block " + n.height.toLocaleString()} · ${n.peers} peers` : (n.joined ? "Stopped" : "Not joined");
      if (lastNode && lastNode.running !== n.running) toast(n.running ? "Privi node connected" : "Privi node stopped");
      lastNode = n;
    } catch { /* service unreachable; keep previous state */ }
  }

  tick();
  setInterval(tick, 10_000);
  refreshStatus();
  setInterval(refreshStatus, 15_000);
  drawShelf();
  updateThemeTile();

  return { open, close, toast, setTheme, setWall };
})();
