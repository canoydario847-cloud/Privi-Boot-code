/* Privi OS built-in apps. Each app renders into a window body element. */
"use strict";

const Api = {
  async get(path) {
    const r = await fetch(path, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Privi-Shell": "1" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  },
};

const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("privi." + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("privi." + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : String(c));
  return el;
}

function svg(paths) {
  const s = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const t = document.createElement("template");
  t.innerHTML = s;
  return t.content.firstChild;
}

const ICONS = {
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>',
  files: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  node: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><path d="M10 7h4M17 10v4M10 9.5l4.5 4.5"/>',
  notes: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  doc: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r=".8"/>',
  wired: '<rect x="8" y="3.5" width="8" height="6" rx="1"/><path d="M12 9.5v5M5 20.5v-3h14v3M12 14.5v6"/>',
  offline: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M4 4l16 16"/>',
};

function appIcon(app, cls = "") {
  const d = h("div", { class: "icon " + cls, style: `background:${app.color}` });
  d.append(svg(ICONS[app.icon]));
  return d;
}

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  const u = ["KB", "MB", "GB", "TB"]; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + " " + u[i];
}

/* ---------- Web ---------- */
function normalizeUrl(text) {
  const t = text.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

function renderWeb(body, ctx) {
  const input = h("input", { class: "field", type: "text", placeholder: "Search or type a web address", spellcheck: "false" });
  const frameHost = h("div", { class: "home" },
    h("div", {}, h("h2", {}, "Privi Web"),
      h("p", {}, "Type an address above. Sites that refuse to load inside a window open full-screen with ↗.")));
  let current = null;
  let view = frameHost;
  function go(url) {
    current = url;
    input.value = url;
    ctx.setTitle(new URL(url).hostname);
    const f = h("iframe", { src: url, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups", referrerpolicy: "no-referrer" });
    view.replaceWith(f);
    view = f;
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const u = normalizeUrl(input.value); if (u) go(u); } });
  const pop = h("button", { class: "btn", title: "Open full window", onclick: () => current && window.open(current, "_blank", "noopener") }, "↗");
  const wrap = h("div", { class: "browser" }, h("div", { class: "browser-bar" }, input, pop), frameHost);
  body.append(wrap);
  if (ctx.arg) go(ctx.arg); else setTimeout(() => input.focus(), 50);
}

/* ---------- Files ---------- */
function renderFiles(body, ctx) {
  const crumbs = h("div", { class: "row small muted", style: "margin-bottom:10px" });
  const list = h("ul", { class: "list" });
  const pad = h("div", { class: "pad" }, crumbs, list);
  body.append(pad);
  async function load(path) {
    list.replaceChildren(h("li", { class: "muted" }, "Loading…"));
    try {
      const data = await Api.get("/api/files?path=" + encodeURIComponent(path));
      const parts = data.path ? data.path.split("/") : [];
      crumbs.replaceChildren(
        h("button", { class: "btn", onclick: () => load("") }, "Home"),
        ...parts.map((p, i) => h("button", { class: "btn", onclick: () => load(parts.slice(0, i + 1).join("/")) }, p)));
      ctx.setTitle(parts.length ? parts[parts.length - 1] : "");
      if (!data.entries.length) { list.replaceChildren(h("li", { class: "muted" }, "This folder is empty")); return; }
      list.replaceChildren(...data.entries.map((e) => {
        const li = h("li", {},
          appIcon({ color: e.dir ? "#3c7bd9" : "#5b6b7d", icon: e.dir ? "folder" : "doc" }),
          h("span", { class: "grow" }, e.name),
          h("span", { class: "small muted" }, e.dir ? "" : fmtBytes(e.size)),
          h("span", { class: "small muted" }, new Date(e.modified * 1000).toLocaleDateString()));
        if (e.dir) li.addEventListener("dblclick", () => load((data.path ? data.path + "/" : "") + e.name));
        return li;
      }));
    } catch (err) {
      list.replaceChildren(h("li", { class: "muted" }, "Can't open this folder: " + err.message));
    }
  }
  load("");
}

/* ---------- Privi Node ---------- */
function renderNode(body, ctx) {
  const pad = h("div", { class: "pad" });
  body.append(pad);
  async function refresh() {
    let n;
    try { n = await Api.get("/api/node"); } catch (err) { n = { running: false, error: err.message }; }
    const net = n.network;
    const head = h("div", { class: "row", style: "margin-bottom:14px" },
      h("h2", { class: "grow", style: "margin:0" }, net && net.name ? net.name : "Privi node"),
      n.running
        ? h("span", { class: "pill " + (n.syncing ? "warn" : "ok") }, n.syncing ? "Syncing" : "In sync")
        : h("span", { class: "pill" }, "Not running"));
    if (n.running) {
      pad.replaceChildren(head,
        h("div", { class: "stats" },
          h("div", { class: "card stat" }, h("span", { class: "small muted" }, "Block height"), h("b", {}, n.height.toLocaleString())),
          h("div", { class: "card stat" }, h("span", { class: "small muted" }, "Peers"), h("b", {}, String(n.peers))),
          h("div", { class: "card stat" }, h("span", { class: "small muted" }, "Chain"), h("b", { style: "font-size:15px" }, n.chain_id)),
          h("div", { class: "card stat" }, h("span", { class: "small muted" }, "This computer"), h("b", { style: "font-size:15px" }, n.moniker || "—"))),
        h("p", { class: "small muted" }, "Last block " + (n.block_time ? new Date(n.block_time).toLocaleString() : "—")));
    } else {
      pad.replaceChildren(head,
        h("div", { class: "card" },
          h("p", { style: "margin-top:0" }, n.joined
            ? "This computer has joined a Privi network but the node service isn't running. It restarts automatically; if it stays off, check it with privi-node.sh status."
            : "This computer hasn't joined a Privi network yet."),
          h("p", { class: "small muted", style: "margin-bottom:0" },
            "Privi OS joins automatically on startup once a launched network's address is set in /etc/privi/network-url. Joining is refused until a public Privi network has launched.")));
    }
  }
  refresh();
  const t = setInterval(refresh, 5000);
  ctx.onClose(() => clearInterval(t));
}

/* ---------- Notes ---------- */
function renderNotes(body) {
  let notes = Store.get("notes", [{ id: Date.now(), text: "Welcome to Privi OS notes.\n\nNotes are saved on this computer." }]);
  let currentId = notes[0].id;
  const aside = h("aside");
  const area = h("textarea", { spellcheck: "true", "aria-label": "Note" });
  function title(n) { return (n.text.split("\n")[0] || "Untitled").slice(0, 40); }
  function draw() {
    aside.replaceChildren(
      h("button", { class: "btn primary", style: "margin-bottom:8px;text-align:center", onclick: () => {
        const n = { id: Date.now(), text: "" }; notes.unshift(n); currentId = n.id; save(); draw(); area.focus();
      } }, "+ New note"),
      ...notes.map((n) => h("button", { class: n.id === currentId ? "on" : "", onclick: () => { currentId = n.id; draw(); } }, title(n))));
    area.value = notes.find((n) => n.id === currentId)?.text ?? "";
  }
  function save() { Store.set("notes", notes); }
  area.addEventListener("input", () => {
    const n = notes.find((x) => x.id === currentId); if (!n) return;
    n.text = area.value; save();
    const btn = aside.querySelector("button.on"); if (btn) btn.textContent = title(n);
  });
  body.append(h("div", { class: "notes" }, aside, area));
  draw();
}

/* ---------- Calculator ---------- */
function renderCalc(body) {
  const display = h("input", { class: "field", style: "font-size:24px;text-align:right;width:100%", readonly: true, value: "0" });
  let expr = "";
  function press(k) {
    if (k === "C") expr = "";
    else if (k === "⌫") expr = expr.slice(0, -1);
    else if (k === "=") {
      if (!/^[\d+\-*/().\s]+$/.test(expr)) { display.value = "Error"; expr = ""; return; }
      try { const r = Function('"use strict";return (' + expr + ")")(); expr = Number.isFinite(r) ? String(+r.toFixed(10)) : ""; }
      catch { display.value = "Error"; expr = ""; return; }
    } else expr += k;
    display.value = expr || "0";
  }
  const keys = ["C", "⌫", "(", ")", "7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"];
  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px" },
    ...keys.map((k) => h("button", { class: "btn" + (k === "=" ? " primary" : ""), style: "padding:14px 0;font-size:16px", onclick: () => press(k) }, k)));
  const pad = h("div", { class: "pad" }, display, grid);
  pad.tabIndex = 0;
  pad.addEventListener("keydown", (e) => {
    const map = { Enter: "=", Backspace: "⌫", Escape: "C" };
    const k = map[e.key] || e.key;
    if (keys.includes(k)) { e.preventDefault(); press(k); }
  });
  body.append(pad);
  setTimeout(() => pad.focus(), 50);
}

/* ---------- Settings ---------- */
const WALLS = [
  { id: "default", name: "Privi" },
  { id: "dusk", name: "Dusk" },
  { id: "lake", name: "Lake" },
  { id: "graphite", name: "Graphite" },
];

function renderSettings(body, ctx) {
  const section = h("section", { class: "pad" });
  const pages = {
    wifi: { label: "Network", draw: drawWifi },
    look: { label: "Appearance", draw: drawLook },
    node: { label: "Privi node", draw: () => { section.replaceChildren(); renderNode(section, ctx); } },
    about: { label: "About", draw: drawAbout },
  };
  const nav = h("nav");
  function show(id) {
    nav.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.page === id));
    pages[id].draw();
  }
  for (const [id, p] of Object.entries(pages)) nav.append(h("button", { "data-page": id, onclick: () => show(id) }, p.label));
  body.append(h("div", { class: "settings" }, nav, section));

  async function drawWifi() {
    section.replaceChildren(h("h2", {}, "Network"), h("p", { class: "muted" }, "Looking for Wi-Fi…"));
    let data;
    try { data = await Api.get("/api/wifi"); } catch (e) { data = { available: false, error: e.message }; }
    if (!data.available) {
      section.replaceChildren(h("h2", {}, "Network"),
        h("p", { class: "muted" }, "Wi-Fi controls aren't available here (NetworkManager not found). Wired connections work automatically."));
      return;
    }
    const list = h("ul", { class: "list" });
    for (const n of data.networks) {
      const pw = h("input", { class: "field", type: "password", placeholder: "Password", hidden: true });
      const go = h("button", { class: "btn primary", hidden: true, onclick: async () => {
        go.disabled = true; go.textContent = "Connecting…";
        try {
          const r = await Api.post("/api/wifi/connect", { ssid: n.ssid, password: pw.value });
          Shell.toast(r.ok ? `Connected to ${n.ssid}` : `Couldn't connect: ${r.message}`);
          if (r.ok) drawWifi();
        } catch (e) { Shell.toast("Couldn't connect: " + e.message); }
        go.disabled = false; go.textContent = "Connect";
      } }, "Connect");
      const li = h("li", { style: "flex-wrap:wrap" },
        appIcon({ color: "#3c7bd9", icon: "wifi" }),
        h("span", { class: "grow" }, n.ssid, n.secure ? " 🔒" : ""),
        n.connected ? h("span", { class: "pill ok" }, "Connected") : h("span", { class: "small muted" }, n.signal + "%"),
        h("div", { class: "row", style: "width:100%;padding-left:44px" }, pw, go));
      if (!n.connected) li.addEventListener("click", (e) => {
        if (e.target.closest("input,button")) return;
        pw.hidden = !n.secure ? true : !pw.hidden; go.hidden = !go.hidden; if (!pw.hidden) pw.focus();
      });
      list.append(li);
    }
    section.replaceChildren(h("div", { class: "row" }, h("h2", { class: "grow" }, "Wi-Fi"), h("button", { class: "btn", onclick: drawWifi }, "Refresh")),
      data.networks.length ? list : h("p", { class: "muted" }, "No networks found."));
  }

  function drawLook() {
    const theme = document.documentElement.dataset.theme || "dark";
    const wall = document.documentElement.dataset.wall || "default";
    const walls = h("div", { class: "walls" }, ...WALLS.map((w) => {
      const sw = h("button", { class: "wall-swatch" + (w.id === wall ? " on" : ""), "aria-label": w.name, title: w.name,
        onclick: () => { Shell.setWall(w.id); drawLook(); } });
      sw.dataset.wall = w.id;
      return sw;
    }));
    section.replaceChildren(h("h2", {}, "Appearance"),
      h("h3", {}, "Theme"),
      h("div", { class: "row" },
        ...["dark", "light"].map((t) => h("button", { class: "btn" + (t === theme ? " primary" : ""), onclick: () => { Shell.setTheme(t); drawLook(); } },
          t === "dark" ? "Dark" : "Light"))),
      h("h3", {}, "Wallpaper"), walls);
    // Paint each swatch with its own wallpaper by previewing the attribute.
    const root = document.documentElement, prev = root.dataset.wall;
    walls.querySelectorAll(".wall-swatch").forEach((sw) => {
      root.dataset.wall = sw.dataset.wall;
      sw.style.background = getComputedStyle(root).getPropertyValue("--wall");
    });
    if (prev === undefined) delete root.dataset.wall; else root.dataset.wall = prev;
  }

  async function drawAbout() {
    let s = {};
    try { s = await Api.get("/api/system"); } catch { /* shown as unknown */ }
    section.replaceChildren(h("h2", {}, "About Privi OS"),
      h("div", { class: "card" },
        h("p", { style: "margin-top:0" }, h("b", {}, "Privi OS " + (s.version || "")), h("br"),
          h("span", { class: "muted" }, "A browser-first operating system with the Privi network built in.")),
        h("p", { class: "small muted", style: "margin-bottom:0" }, "Created by Dario Canoy, founder of Privi. Built on Debian Linux and Cosmos EVM. Open source.")),
      h("h3", {}, "This computer"),
      h("ul", { class: "list" },
        h("li", {}, h("span", { class: "grow" }, "Name"), h("span", { class: "muted" }, s.hostname || "—")),
        h("li", {}, h("span", { class: "grow" }, "Up for"), h("span", { class: "muted" }, s.uptime_s != null ? Math.round(s.uptime_s / 60) + " min" : "—")),
        h("li", {}, h("span", { class: "grow" }, "Battery"), h("span", { class: "muted" }, s.battery ? s.battery.percent + "% · " + s.battery.status : "No battery"))));
  }

  show(ctx.arg && pages[ctx.arg] ? ctx.arg : "wifi");
}

const APPS = [
  { id: "web", name: "Web", icon: "web", color: "#2f7de1", pinned: true, w: 980, h: 640, render: renderWeb },
  { id: "files", name: "Files", icon: "files", color: "#e3a43a", pinned: true, w: 720, h: 480, render: renderFiles },
  { id: "node", name: "Privi Node", icon: "node", color: "#14a58a", pinned: true, w: 620, h: 420, render: renderNode },
  { id: "notes", name: "Notes", icon: "notes", color: "#d9734a", pinned: true, w: 680, h: 460, render: renderNotes },
  { id: "calc", name: "Calculator", icon: "calc", color: "#6a5acd", pinned: false, w: 320, h: 430, render: renderCalc },
  { id: "settings", name: "Settings", icon: "settings", color: "#5b6b7d", pinned: true, w: 760, h: 520, render: renderSettings },
];
