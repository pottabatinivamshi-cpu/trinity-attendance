// Trinity Attendance Letters: Trinity Team, IDPT Sports, any other event, and Quick letter.
store.del("att2.removed");

// ---------- Letters (one per book, kept separate) ----------
const NOTE = "Students will not miss any test or submission. Attendance will be granted only if they do not miss any scheduled test or submission.";
const BOOKS = {
  trinity: { label: "Trinity", selKey: "att2.sel", fKey: "att2.f.", file: "Attendance Letter.pdf",
    orders: [["branch", "Core (TE) first, then Co-Com (SE), by branch"], ["added", "Order I added them"]],
    defaults: { to: "To,\nRespected Teachers,", greeting: "Respected Sir/Ma'am,", note: NOTE,
      subject: "Permission to Grant Attendance to the Following Students for DJS TRINITY Core + Cocom for ",
      body: "We request you to kindly grant full-day attendance to the following students from ___ to ___ for their involvement in DJS TRINITY." } },
  idpt: { label: "IDPT", selKey: "att3.idpt.sel", fKey: "att3.idpt.f.", file: "IDPT Attendance Letter.pdf",
    orders: [["branch", "By year, then branch"], ["added", "Order I added them"]],
    defaults: { to: "To,\nRespected Teachers,", greeting: "Respected Sir/Ma'am,", note: NOTE,
      subject: "Permission to Grant Attendance to the Following Students for DJS TRINITY IDPT Sports",
      body: "We request you to kindly grant full-day attendance to the following students from ___ to ___ for their participation in DJS TRINITY Inter-Department Sports (IDPT)." } },
  quick: { label: "Quick", selKey: "att3.quick.rows", fKey: "att3.quick.f.", file: "Attendance Letter.pdf",
    orders: [["file", "Same order as the file"], ["branch", "By year, then branch"]],
    defaults: { to: "To,\nRespected Teachers,", greeting: "Respected Sir/Ma'am,", note: NOTE,
      subject: "",
      body: "We request you to kindly grant full-day attendance to the following students from ___ to ___ for their involvement in DJS TRINITY." } },
};
const FIELD_KEYS = ["to", "subject", "greeting", "body", "note", "file", "order", "from", "until"];
for (const k in BOOKS) {
  const B = BOOKS[k];
  B.sel = store.get(B.selKey, []);
  B.F = {};
  FIELD_KEYS.forEach(f => B.F[f] = store.get(B.fKey + f, f === "file" ? B.file : f === "order" ? B.orders[0][0] : (B.defaults[f] ?? "")));
  if (!B.orders.some(o => o[0] === B.F.order)) B.F.order = B.orders[0][0];
}
const saveSel = k => store.set(BOOKS[k].selKey, BOOKS[k].sel);
// Each event made in the Events tab gets its own letter, created the first time it's opened.
function ensureBook(k) {
  if (BOOKS[k] || !k.startsWith("ev:")) return BOOKS[k];
  const slug = k.slice(3), name = (EVM[slug] || {}).name || "the event";
  const B = BOOKS[k] = { label: name, selKey: `att3.ev.${slug}.sel`, fKey: `att3.ev.${slug}.f.`, file: `${name} Attendance Letter.pdf`,
    orders: [["branch", "By year, then branch"], ["added", "Order I added them"]],
    defaults: { to: "To,\nRespected Teachers,", greeting: "Respected Sir/Ma'am,", note: NOTE,
      subject: `Permission to Grant Attendance to the Following Students for DJS TRINITY ${name}`,
      body: `We request you to kindly grant full-day attendance to the following students from ___ to ___ for their participation in DJS TRINITY ${name}.` } };
  B.sel = store.get(B.selKey, []); B.F = {};
  FIELD_KEYS.forEach(f => B.F[f] = store.get(B.fKey + f, f === "file" ? B.file : f === "order" ? B.orders[0][0] : (B.defaults[f] ?? "")));
  return B;
}

// ---------- State ----------
let MODE = "loading"; // Trinity list: "live" | "backup"
let DATA = { people: [], depts: [] }, P = {}, DEPTS = [];
let IDPT = { ok: false, sections: [], entries: [] }, Q = {}; // the event on screen (IDPT or one from the Events tab)
let EVENTS = [], EVM = {}, EV = "idpt";
// People added by hand for today's Trinity letter. Kept on this device only and cleared at midnight.
const today = () => new Date().toLocaleDateString("en-CA");
let TMPDATA = store.get("att3.tmp", null), TMP = {};
function loadTmp() {
  if (!TMPDATA || TMPDATA.day !== today()) {
    const old = TMPDATA ? TMPDATA.rows.map(p => p.id) : [];
    TMPDATA = { day: today(), rows: [] }; store.set("att3.tmp", TMPDATA);
    if (old.length) { BOOKS.trinity.sel = BOOKS.trinity.sel.filter(id => !old.includes(id)); saveSel("trinity"); }
  }
  TMP = Object.fromEntries(TMPDATA.rows.map(p => [p.id, p]));
}
function saveTmp() { store.set("att3.tmp", TMPDATA); TMP = Object.fromEntries(TMPDATA.rows.map(p => [p.id, p])); }
let auth = store.get("att3.auth", null);
// The PIN that lets this phone see the lists (the view PIN, or the core PIN).
let VIEW = store.get("att3.view", null) || (auth && auth.pin) || null;
function setView(pin) { VIEW = pin; store.set("att3.view", pin); }
// ---------- Offline: the last lists this phone loaded, and Records waiting to be sent ----------
let OFFLINE = false, offlineAt = null;
const saveCache = (key, data) => store.set("att3.cache." + key, { at: Date.now(), data });
const readCache = key => store.get("att3.cache." + key, null);
function wentOffline(at) { OFFLINE = true; offlineAt = offlineAt ? Math.min(offlineAt, at) : at; renderOffline(); }
function renderOffline() {
  const box = $("offline"), out = store.get("att3.outbox", []);
  if (!OFFLINE && !out.length) { box.hidden = true; return; }
  box.hidden = false;
  const when = offlineAt ? new Date(offlineAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  box.textContent = (OFFLINE ? `You're offline. Showing the lists saved on this phone${when ? " at " + when : ""}. Letters still work. Editing and approvals need the internet.` : "") +
    (out.length ? `${OFFLINE ? " " : ""}${out.length} ${out.length === 1 ? "letter is" : "letters are"} waiting to be saved in Records, and will be sent when you're back online.` : "");
}
// Sends one letter at a time and removes it from the queue as soon as it's saved, so nothing is sent twice.
let flushing = false;
async function flushOutbox() {
  if (flushing || !VIEW) return renderOffline();
  flushing = true; let sent = 0;
  try {
    while (true) {
      const out = store.get("att3.outbox", []); if (!out.length) break;
      try { await viewRpc("log_letter", out[0]); } catch (e) { break; }
      store.set("att3.outbox", store.get("att3.outbox", []).slice(1)); sent++;
    }
  } finally { flushing = false; renderOffline(); }
  if (sent) toast(`${sent} ${sent === 1 ? "letter was" : "letters were"} saved in Records.`);
}
class PinError extends Error { constructor(status) { super(status); this.pin = status; } }
async function viewRpc(fn, body) { const r = await rpc(fn, { p_pin: (auth && auth.pin) || VIEW, ...(body || {}) }); if (r.status !== "ok") throw new PinError(r.status); return r; }
const unlocked = () => MODE === "live" && !!auth;
const open = new Set(store.get("att2.open", []));
const openI = new Set(store.get("att3.idpt.open", []));
const gLabel = g => g === "core" ? "Core" : g === "cocom" ? "Co-Com" : g;
let book = "trinity", view = "list"; // book: trinity | idpt | ev | quick

const evKey = () => EV === "idpt" ? "idpt" : "ev:" + EV;
const bk = () => book === "ev" ? (EV ? evKey() : "none") : book;
const evMeta = () => EVM[EV] || (EV === "idpt" ? { slug: "idpt", name: "IDPT Sports", kind: "idpt" } : { name: "Event", kind: "general" });
const evName = () => evMeta().name;
const isIdpt = () => evMeta().kind === "idpt";
BOOKS.none = { label: "", selKey: "att3.none", fKey: "att3.none.", file: "", orders: [["branch", ""]], defaults: {}, sel: [], F: {} };
function person(k, id) { return k === "trinity" ? (P[id] || TMP[id]) : k === "quick" || k === "none" ? null : Q[id]; }
function inBook(k, id) { return BOOKS[k].sel.includes(id); }

// ---------- Loading ----------
async function loadTrinityLive() {
  const r = await viewRpc("get_trinity");
  const deps = r.departments, mems = r.members, ships = r.memberships;
  const people = mems.map(m => ({ id: m.id, n: m.name, b: m.branch, r: m.roll, s: m.sap, d: m.division, y: m.year, ok: m.has_details }));
  const depts = deps.map(d => ({ name: d.name, core: [], cocom: [] }));
  const byName = Object.fromEntries(depts.map(d => [d.name, d]));
  ships.forEach(s => { const d = byName[s.dept]; if (d && d[s.grp]) d[s.grp].push(s.member_id); });
  return { people, depts };
}
function rebuildTrinity() {
  P = Object.fromEntries(DATA.people.map(p => [p.id, p]));
  DEPTS = DATA.depts;
  const listed = new Set(DEPTS.flatMap(d => [...d.core, ...d.cocom]));
  BOOKS.trinity.sel = BOOKS.trinity.sel.filter(id => TMP[id] || (P[id] && P[id].ok && listed.has(id))); saveSel("trinity");
}
async function refreshTrinity(quiet) {
  try { DATA = await loadTrinityLive(); MODE = "live"; OFFLINE = false; saveCache("trinity", DATA); renderOffline(); }
  catch (e) {
    if (e.pin) return viewLost(e.pin);
    if (MODE === "live" && quiet) { wentOffline(Date.now()); return; }
    const c = readCache("trinity");
    if (!c) { $("depts").innerHTML = `<p class="banner">Couldn't load the member list. Check your connection and reload the page.</p>`; return; }
    DATA = c.data; MODE = "cache"; wentOffline(c.at);
  }
  rebuildTrinity(); renderAccount(); renderTrinity(); renderCounts(); if (book === "trinity" && view === "letter") renderTable(); if (unlocked()) loadBin();
}
async function loadEvents() {
  try {
    EVENTS = (await viewRpc("get_events")).events; saveCache("events", EVENTS);
    EVM = Object.fromEntries(EVENTS.map(e => [e.slug, e]));
  } catch (e) {
    if (e.pin) return viewLost(e.pin);
    const c = readCache("events"); if (c && !EVENTS.length) { EVENTS = c.data; EVM = Object.fromEntries(EVENTS.map(x => [x.slug, x])); wentOffline(c.at); }
  }
}
async function refreshIdpt(quiet) {
  const slug = EV;
  if (!slug) { IDPT = { ok: true, sections: [], entries: [] }; Q = {}; renderIdpt(); return; }
  try {
    let res;
    try { res = await viewRpc("get_event", { p_event: slug }); saveCache("ev." + slug, res); }
    catch (e) { if (e.pin) throw e; const c = readCache("ev." + slug); if (!c) throw e; res = c.data; wentOffline(c.at); }
    const secs = res.sections, rows = res.entries;
    if (slug !== EV) return; // switched events while loading
    const entries = rows.map(e => ({ id: e.id, section: e.section, n: e.name, b: e.branch, r: e.roll, s: e.sap, d: e.division, y: e.year, ok: !!(e.sap && e.branch) }));
    const names = secs.map(s => s.name);
    entries.forEach(e => { if (!names.includes(e.section)) names.push(e.section); });
    IDPT = { ok: true, sections: names, entries };
  } catch (e) { if (e.pin) return viewLost(e.pin); if (quiet && IDPT.ok) return; IDPT = { ok: false, sections: [], entries: [] }; }
  Q = Object.fromEntries(IDPT.entries.map(e => [e.id, e]));
  const B = ensureBook(evKey());
  if (IDPT.ok && B) { B.sel = B.sel.filter(id => Q[id] && Q[id].ok); saveSel(evKey()); }
  renderIdpt(); renderCounts(); if ((book === "idpt" || book === "ev") && view === "letter") renderTable();
  if (unlocked()) { loadPending(); loadIdptBin(); }
}

// ---------- Account ----------
function renderAccount() {
  $("backup").hidden = true;
  $("login").hidden = MODE !== "live";
  $("signout").hidden = !VIEW;
  $("login").textContent = unlocked() ? "Lock" : "Core login";
  $("login").setAttribute("aria-pressed", unlocked());
  $("whois").hidden = !unlocked();
  if (unlocked()) $("whois").textContent = auth.name ? `Editing as ${auth.name}` : "Editing unlocked";
  $("bin").hidden = !unlocked();
  if (TMPDATA) $("tmp").hidden = !unlocked();
  const evOn = unlocked() && IDPT.ok && !!EV && !(EVM[EV] && EVM[EV].archived);
  $("idpt-tools").hidden = !evOn;
  $("idpt-pending").hidden = !evOn;
  $("idpt-bin").hidden = !(unlocked() && IDPT.ok && !!EV);
}
$("login").onclick = () => {
  if (unlocked()) { auth = null; store.del("att3.auth"); renderAll(); toast("Locked. Editing is off on this device."); return; }
  $("lg-pin").value = ""; $("lg-name").value = store.get("att3.lastname", ""); $("lg-st").textContent = "";
  openSheet("loginsheet", $("lg-pin"));
};
const PIN_MSG = { wrong_pin: "That PIN isn't right.", locked: "Too many wrong PINs. Wait 15 minutes, then try again.", pin_not_set: "No PIN has been set yet. Run set-pin.sql in Supabase first." };
$("lg-form").addEventListener("submit", async e => {
  e.preventDefault();
  const pin = $("lg-pin").value, name = $("lg-name").value.trim();
  if (!pin) { $("lg-st").textContent = "Enter the PIN."; return; }
  $("lg-go").disabled = true; $("lg-st").textContent = "Checking…";
  try {
    const r = await rpc("unlock", { p_pin: pin });
    if (r.status === "ok") { auth = { pin, name }; store.set("att3.auth", auth); store.set("att3.lastname", name); if (!VIEW) setView(pin); closeSheet(); renderAll(); loadBin(); loadPending(); loadIdptBin();
      if (afterLogin) { const go = afterLogin; afterLogin = null; go(); } else toast("Unlocked. You can edit the lists now."); }
    else $("lg-st").textContent = PIN_MSG[r.status] || "Couldn't check the PIN. Try again.";
  } catch (err) { $("lg-st").textContent = "Couldn't reach the database. Check your connection and try again."; }
  finally { $("lg-go").disabled = false; }
});
$("lg-cancel").onclick = () => { afterLogin = null; closeSheet(); };
let afterLogin = null;
function lostAccess(status) { auth = null; store.del("att3.auth"); renderAll(); toast(PIN_MSG[status] || "You've been logged out. Log in again to keep editing."); }
function renderAll() { renderAccount(); renderTmp(); renderTrinity(); renderIdpt(); renderPicker(); renderCounts(); renderNav(); if (view === "letter") renderTable(); if (view === "records") openRecords(); }

// ---------- Sheets and toasts ----------
let openId = null, lastFocus = null;
function openSheet(id, focusEl) { lastFocus = document.activeElement; openId = id; $(id).hidden = false; document.body.classList.add("locked"); (focusEl || $(id).querySelector("button")).focus(); }
function closeSheet() { if (!openId) return; $(openId).hidden = true; openId = null; document.body.classList.remove("locked"); if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); }
document.querySelectorAll(".overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) closeSheet(); }));
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
addEventListener("keydown", e => { if (e.key === "Escape" && openId) closeSheet(); });
let tt; function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3400); }
function ago(t) {
  const s = Math.max(0, (Date.now() - new Date(t)) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400); return d < 30 ? `${d} day${d > 1 ? "s" : ""} ago` : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
const meta = p => p.ok ? [p.b, p.r, p.d, p.y].filter(Boolean).join(" · ") : "Details missing";

// Shared list markup for one group of people.
function rowsHTML(k, ids, canDelete) {
  return `<ul class="rows">` + ids.filter(id => person(k, id)).map(id => {
    const p = person(k, id), on = inBook(k, id);
    return `<li class="row${on ? " on" : ""}" data-id="${esc(id)}" data-s="${esc((p.n + " " + p.r + " " + p.s).toLowerCase())}"><div class="pinfo"><div class="pname">${esc(p.n)}</div><div class="pmeta${p.ok ? "" : " warn"}">${esc(meta(p))}</div></div>` +
      (canDelete ? `<button type="button" class="edit" data-act="edit" aria-label="Edit ${esc(p.n)}" title="Edit details">✎</button><button type="button" class="del" data-act="del" aria-label="Delete ${esc(p.n)}" title="Delete from this list">−</button>` : "") +
      (p.ok ? `<button type="button" class="add" data-act="one" aria-label="${on ? "Remove" : "Add"} ${esc(p.n)} ${on ? "from" : "to"} the letter" aria-pressed="${on}">${on ? "✓" : "+"}</button>` : "") + `</li>`;
  }).join("") + `</ul>`;
}
function selAllBtn(k, ids) {
  const addable = ids.filter(id => person(k, id) && person(k, id).ok);
  if (!addable.length) return "";
  return `<button type="button" class="selall" data-act="all">${addable.every(id => inBook(k, id)) ? "Remove all" : "Select all"}</button>`;
}
// origin: which department someone was added from, so the Timing box can set a whole department at once.
function toggleIds(k, ids, one, origin) {
  const B = BOOKS[k];
  if (origin) { const O = store.get(B.fKey + "origin", {}); ids.forEach(id => { if (!inBook(k, id)) O[id] = origin; }); store.set(B.fKey + "origin", O); }
  if (one) B.sel = inBook(k, ids[0]) ? B.sel.filter(x => x !== ids[0]) : [...B.sel, ids[0]];
  else { const add = ids.filter(id => person(k, id) && person(k, id).ok); if (add.every(id => inBook(k, id))) B.sel = B.sel.filter(x => !add.includes(x)); else add.forEach(id => { if (!inBook(k, id)) B.sel.push(id); }); }
  saveSel(k); renderCounts();
  k === "trinity" ? renderTrinity() : renderIdpt();
}
function applySearch(input, container, openSet) {
  const q = input.value.trim().toLowerCase();
  container.querySelectorAll(".dept").forEach(det => {
    if (!q) { det.hidden = false; det.querySelectorAll(".row").forEach(r => r.hidden = false); det.open = openSet.has(det.dataset.name); return; }
    let any = false; det.querySelectorAll(".row").forEach(r => { const m = r.dataset.s.includes(q); r.hidden = !m; any = any || m; });
    det.hidden = !any; det.open = any;
  });
}
function trackOpen(container, input, openSet, key) {
  container.addEventListener("toggle", e => { const d = e.target; if (!d.classList?.contains("dept") || input.value.trim()) return;
    d.open ? openSet.add(d.dataset.name) : openSet.delete(d.dataset.name); store.set(key, [...openSet]); }, true);
}

// ---------- Trinity Team: just for today's letter ----------
function renderTmp() {
  $("tmp").hidden = !unlocked();
  $("tmp-count").textContent = TMPDATA.rows.length;
  $("tmp-list").innerHTML = TMPDATA.rows.length ? TMPDATA.rows.map(p => { const on = inBook("trinity", p.id);
    return `<li class="row${on ? " on" : ""}" data-id="${esc(p.id)}"><div class="pinfo"><div class="pname">${esc(p.n)}</div><div class="pmeta">${esc([p.b, p.r, p.d, p.y, p.s].filter(Boolean).join(" · "))}</div></div>` +
      `<button type="button" class="rm" data-tedit="${esc(p.id)}">Edit</button>` +
      `<button type="button" class="del" data-tdel="${esc(p.id)}" aria-label="Remove ${esc(p.n)}" title="Remove">−</button>` +
      `<button type="button" class="add" data-ttog="${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? "Take" : "Put"} ${esc(p.n)} ${on ? "off" : "on"} the letter">${on ? "✓" : "+"}</button></li>`; }).join("")
    : `<li class="empty">Nobody added yet. Tap Add person for anyone who isn't on the list.</li>`;
}
let tmEdit = null;
fillSapGuess($("tm-sap"), $("tm-branch"), $("tm-year"));
function openTmp(id) {
  tmEdit = id || null; const p = id ? TMP[id] : null;
  $("tm-title").textContent = p ? "Edit details" : "Add for today's letter";
  $("tm-go").textContent = p ? "Save changes" : "Add to letter";
  $("tm-name").value = p ? p.n : ""; $("tm-sap").value = p ? p.s : ""; $("tm-roll").value = p ? p.r : ""; $("tm-div").value = p ? p.d : "";
  $("tm-branch").value = p ? p.b : ""; $("tm-year").value = p ? p.y : "";
  if (p) { $("tm-branch").dataset.touched = "1"; $("tm-year").dataset.touched = "1"; } else { delete $("tm-branch").dataset.touched; delete $("tm-year").dataset.touched; }
  $("tm-st").textContent = ""; openSheet("tmpsheet", $("tm-name"));
}
$("tmp-add").onclick = () => openTmp();
$("tm-form").addEventListener("submit", e => {
  e.preventDefault(); loadTmp();
  const v = { n: niceName($("tm-name").value), s: $("tm-sap").value, b: $("tm-branch").value, y: $("tm-year").value, r: niceRoll($("tm-roll").value), d: clean($("tm-div").value).toUpperCase() };
  if (v.n.length < 2) { $("tm-st").textContent = "Enter the student's name."; return $("tm-name").focus(); }
  if (!/^\d{11}$/.test(v.s)) { $("tm-st").textContent = "The SAP ID should be 11 digits."; return $("tm-sap").focus(); }
  if (!v.b || !v.y) { $("tm-st").textContent = "Pick the branch and year."; return; }
  const clash = Object.values(P).find(p => p.s === v.s && inBook("trinity", p.id)) || TMPDATA.rows.find(p => p.s === v.s && p.id !== tmEdit);
  if (clash) { $("tm-st").textContent = `${clash.n} already has this SAP ID on the letter.`; return; }
  if (tmEdit && TMP[tmEdit]) { Object.assign(TMP[tmEdit], v, { ok: true }); saveTmp(); closeSheet(); toast(`Updated ${v.n}.`); }
  else {
    const id = "tmp-" + Date.now().toString(36); TMPDATA.rows.push({ id, ...v, ok: true, tmp: true }); saveTmp();
    BOOKS.trinity.sel.push(id); saveSel("trinity");
    $("tm-name").value = $("tm-sap").value = $("tm-roll").value = $("tm-div").value = ""; $("tm-branch").value = $("tm-year").value = "";
    delete $("tm-branch").dataset.touched; delete $("tm-year").dataset.touched;
    $("tm-st").textContent = `Added ${v.n} to the Trinity letter. Add the next one, or close.`; $("tm-name").focus();
  }
  renderTmp(); renderCounts(); if (view === "letter") renderTable();
});
$("tmp-list").addEventListener("click", e => {
  const ed = e.target.closest("[data-tedit]"), dl = e.target.closest("[data-tdel]"), tg = e.target.closest("[data-ttog]");
  if (ed) return openTmp(ed.dataset.tedit);
  if (dl) { const id = dl.dataset.tdel, name = TMP[id].n; TMPDATA.rows = TMPDATA.rows.filter(p => p.id !== id); saveTmp();
    BOOKS.trinity.sel = BOOKS.trinity.sel.filter(x => x !== id); saveSel("trinity"); renderTmp(); renderCounts(); toast(`Removed ${name}.`); return; }
  if (tg) { toggleIds("trinity", [tg.dataset.ttog], true); renderTmp(); }
});

// ---------- Trinity Team ----------
function renderTrinity() {
  const ed = unlocked();
  $("depts").innerHTML = DEPTS.map(d => {
    const n = [...d.core, ...d.cocom].filter(id => inBook("trinity", id)).length;
    const grp = g => `<div class="group" data-dept="${esc(d.name)}" data-g="${g}"><div class="ghead"><span class="gtitle">${gLabel(g)}<small>${g === "core" ? "TE" : "SE"} · ${d[g].length}</small></span>${selAllBtn("trinity", d[g])}</div>` +
      (d[g].length ? rowsHTML("trinity", d[g], ed) : `<p class="empty">No ${gLabel(g).toLowerCase()} members in this department.</p>`) + `</div>`;
    return `<details class="dept" data-name="${esc(d.name)}"${open.has(d.name) ? " open" : ""}><summary><span class="dname">${esc(d.name)}</span><span class="dmeta">` +
      (d.core.length ? `<span class="pill">Core ${d.core.length}</span>` : "") + (d.cocom.length ? `<span class="pill">Co-Com ${d.cocom.length}</span>` : "") +
      (n ? `<span class="pill on">${n} added</span>` : "") + `</span><span class="chev" aria-hidden="true">›</span></summary><div class="groups">${grp("core")}${grp("cocom")}</div></details>`;
  }).join("");
  applySearch($("q"), $("depts"), open);
}
$("depts").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const g = b.closest(".group"), d = DEPTS.find(x => x.name === g.dataset.dept);
  if (b.dataset.act === "del") return askDelete({ kind: "trinity", dept: d.name, grp: g.dataset.g, id: b.closest(".row").dataset.id });
  if (b.dataset.act === "edit") return openEdit("trinity", b.closest(".row").dataset.id);
  toggleIds("trinity", b.dataset.act === "one" ? [b.closest(".row").dataset.id] : d[g.dataset.g], b.dataset.act === "one", d.name);
});
trackOpen($("depts"), $("q"), open, "att2.open");
$("q").addEventListener("input", () => applySearch($("q"), $("depts"), open));
function deptsOf(id) { return DEPTS.filter(d => d.core.includes(id) || d.cocom.includes(id)).map(d => d.name); }

let binItems = [];
async function loadBin() {
  if (!unlocked()) return;
  try { const r = await rpc("list_bin", { p_pin: auth.pin }); if (r.status !== "ok") return lostAccess(r.status); binItems = r.items || []; renderBin(); }
  catch (e) { $("bin-list").innerHTML = `<li class="empty">Couldn't load the bin. Check your connection.</li>`; }
}
function renderBin() {
  $("bin-count").textContent = binItems.length;
  $("bin-list").innerHTML = binItems.length ? binItems.map((it, i) => { const p = P[it.member_id] || { n: it.member_id, b: "", r: "" };
    return `<li class="row"><div class="pinfo"><div class="pname">${esc(p.n)}</div><div class="pmeta">${esc(it.dept)} · ${gLabel(it.grp)}${p.b ? " · " + esc(p.b) : ""}${p.r ? " " + esc(p.r) : ""}</div>` +
      `<div class="pmeta">Deleted ${it.deleted_by ? "by " + esc(it.deleted_by) + " " : ""}${esc(ago(it.deleted_at))}</div></div><div class="binbtns"><button type="button" class="rm" data-restore="${i}">Restore</button><button type="button" class="rm dangerline" data-purge="${i}">Delete forever</button></div></li>`; }).join("")
    : `<li class="empty">The bin is empty. Names you delete will show up here.</li>`;
}
$("bin-list").addEventListener("click", async e => {
  const b = e.target.closest("[data-restore]"); if (!b || !unlocked()) return;
  const it = binItems[+b.dataset.restore], name = (P[it.member_id] || {}).n || "That name";
  b.disabled = true; b.textContent = "Restoring…";
  try { const r = await rpc("restore_member", { p_pin: auth.pin, p_dept: it.dept, p_grp: it.grp, p_member: it.member_id });
    if (r.status === "ok" || r.status === "not_found") { await refreshTrinity(true); toast(`Restored ${name} to ${it.dept}.`); } else lostAccess(r.status); }
  catch (err) { b.disabled = false; b.textContent = "Restore"; toast("Couldn't reach the database. Try again."); }
});
$("bin-refresh").onclick = () => refreshTrinity(true);

// ---------- Delete forever (both bins) ----------
let askRun = null, askAnyone = false;
function askConfirm(title, body, btn, run, anyone) {
  $("ask-title").textContent = title; $("ask-body").textContent = body; $("ask-go").textContent = btn; $("ask-st").textContent = "";
  askRun = run; askAnyone = !!anyone; openSheet("asksheet", $("ask-cancel"));
}
$("ask-go").onclick = async () => {
  if (!askRun || (!askAnyone && !unlocked())) return;
  $("ask-go").disabled = true; $("ask-st").textContent = askAnyone ? "" : "Deleting…";
  try { const msg = await askRun(); closeSheet(); if (msg) toast(msg); }
  catch (e) { $("ask-st").textContent = e && e.status ? "" : "Couldn't reach the database, so nothing was deleted. Try again."; if (e && e.status) { closeSheet(); lostAccess(e.status); } }
  finally { $("ask-go").disabled = false; }
};
async function rpcOk(fn, body) { const r = await rpc(fn, body); if (r.status !== "ok" && r.status !== "not_found") throw { status: r.status }; return r; }
$("bin-list").addEventListener("click", e => {
  const b = e.target.closest("[data-purge]"); if (!b) return;
  const it = binItems[+b.dataset.purge], name = (P[it.member_id] || {}).n || "this name";
  askConfirm(`Delete ${name} forever?`, `This removes ${name} from ${it.dept} · ${gLabel(it.grp)} for good. It can't be restored afterwards.`, "Delete forever", async () => {
    await rpcOk("purge_member", { p_pin: auth.pin, p_dept: it.dept, p_grp: it.grp, p_member: it.member_id });
    await loadBin(); return `Deleted ${name} from ${it.dept} forever.`;
  });
});
$("bin-empty").onclick = () => {
  if (!binItems.length) return toast("The bin is already empty.");
  askConfirm("Empty the bin?", `This deletes ${binItems.length === 1 ? "the 1 name" : `all ${binItems.length} names`} in the Trinity bin for good. ${binItems.length === 1 ? "It" : "They"} can't be restored afterwards.`, "Empty bin", async () => {
    const r = await rpcOk("empty_bin", { p_pin: auth.pin }); await loadBin(); return `Deleted ${r.deleted} from the bin forever.`;
  });
};

// ---------- Delete confirmation (both lists) ----------
let pending = null;
function askDelete(t) {
  pending = t;
  const p = t.kind === "trinity" ? P[t.id] : Q[t.id];
  $("cf-name").textContent = p.n;
  $("cf-meta").textContent = [p.b, p.r, p.s].filter(Boolean).join(" · ") || "No details in the sheet";
  if (t.kind === "trinity") {
    const others = deptsOf(t.id).filter(n => n !== t.dept);
    $("cf-from").textContent = `${t.dept} · ${gLabel(t.grp)}`;
    $("cf-note").textContent = (others.length ? `They'll stay in ${others.join(", ")}. ` : "This is their only department, so they'll disappear from the site. ") + "This changes the list for everyone, and you can restore it from the bin.";
  } else {
    $("cf-from").textContent = `${evName()} · ${p.section}`;
    $("cf-note").textContent = `This removes them from the ${evName()} list for everyone. You can restore it from the bin.`;
  }
  $("cf-st").textContent = "";
  openSheet("confirm", $("cf-cancel"));
}
$("cf-delete").onclick = async () => {
  if (!pending || !unlocked()) return; const t = pending;
  $("cf-delete").disabled = true; $("cf-st").textContent = "Deleting…";
  try {
    const r = t.kind === "trinity"
      ? await rpc("delete_member", { p_pin: auth.pin, p_dept: t.dept, p_grp: t.grp, p_member: t.id, p_by: auth.name || "" })
      : await rpc("idpt_delete", { p_pin: auth.pin, p_id: t.id, p_by: auth.name || "" });
    if (r.status !== "ok" && r.status !== "not_found") { closeSheet(); return lostAccess(r.status); }
    closeSheet();
    if (t.kind === "trinity") {
      const name = P[t.id].n, d = DEPTS.find(x => x.name === t.dept); if (d) d[t.grp] = d[t.grp].filter(x => x !== t.id);
      rebuildTrinity(); renderTrinity(); renderCounts(); loadBin();
      toast(`Deleted ${name} from ${t.dept}. It's in the bin if you need it back.`);
    } else {
      const name = Q[t.id].n; await refreshIdpt(true); toast(`Deleted ${name} from ${evName()}. It's in the bin if you need it back.`);
    }
  } catch (err) { $("cf-st").textContent = "Couldn't reach the database, so nothing was deleted. Try again."; }
  finally { $("cf-delete").disabled = false; }
};

// ---------- IDPT Sports ----------
const IS_LEAD = s => /captain/i.test(s);
// IDPT is shown branch by branch. Inside a branch, captains and co-captains come first as one group, then players by sport.
function renderIdpt() {
  const box = $("idpt-list");
  if (!IDPT.ok) {
    box.innerHTML = `<p class="banner">${LIVE_READY ? "Can't load this list right now. Check your connection and reload the page." : "Event lists need the live database."}</p>`;
    $("idpt-empty").hidden = true; renderAccount(); return;
  }
  const ed = unlocked();
  const branchOf = e => BRANCHES.includes(e.b) ? e.b : "Other";
  const secOrder = [...IDPT.sections].sort((x, y) => (IS_LEAD(y) - IS_LEAD(x)) || IDPT.sections.indexOf(x) - IDPT.sections.indexOf(y));
  const branches = [...BRANCHES, "Other"].map(br => {
    const inBr = IDPT.entries.filter(e => branchOf(e) === br);
    const groups = secOrder.map(sec => ({ sec, ids: sortByYearBranch(inBr.filter(e => e.section === sec)).map(e => e.id) })).filter(g => g.ids.length);
    return { br, all: inBr.map(e => e.id), groups };
  }).filter(x => x.all.length);
  $("idpt-empty").hidden = branches.length > 0 || !EV;
  $("idpt-empty").textContent = ed ? `No one on the ${evName()} list yet. Import a CSV, add people at the desk, or share the QR code.` : `No one on the ${evName()} list yet. Core can add people after logging in.`;
  const K = evKey(), other = isIdpt() ? "Players" : "People";
  box.innerHTML = branches.map(x => {
    const n = x.all.filter(id => inBook(K, id)).length;
    const leads = x.groups.filter(g => IS_LEAD(g.sec)).reduce((t, g) => t + g.ids.length, 0);
    return `<details class="dept" data-name="${esc(x.br)}"${openI.has(x.br) ? " open" : ""}><summary><span class="dname">${esc(x.br)}</span><span class="dmeta">` +
      (leads ? `<span class="pill">Captains ${leads}</span>` : "") + (x.all.length - leads ? `<span class="pill">${other} ${x.all.length - leads}</span>` : "") +
      (n ? `<span class="pill on">${n} added</span>` : "") + `</span><span class="chev" aria-hidden="true">›</span></summary>` +
      x.groups.map(g => `<div class="group solo" data-branch="${esc(x.br)}" data-sec="${esc(g.sec)}"><div class="ghead"><span class="gtitle">${esc(g.sec)}<small>${g.ids.length}</small></span>${selAllBtn(K, g.ids)}</div>${rowsHTML(K, g.ids, ed)}</div>`).join("") +
      `</details>`;
  }).join("");
  applySearch($("qi"), box, openI);
  renderQuickSel(K);
  $("sec-list").innerHTML = IDPT.sections.filter(s => !IS_LEAD(s)).map(s => `<option value="${esc(s)}"></option>`).join("");
  renderAccount();
}
// One tap to add a whole group (like all captains and co-captains) from every branch.
function renderQuickSel(K) {
  const ok = id => Q[id] && Q[id].ok;
  const groups = [...IDPT.sections].sort((x, y) => (IS_LEAD(y) - IS_LEAD(x)) || IDPT.sections.indexOf(x) - IDPT.sections.indexOf(y))
    .map(sec => ({ key: "sec:" + sec, label: sec, ids: IDPT.entries.filter(e => e.section === sec && ok(e.id)).map(e => e.id) })).filter(g => g.ids.length);
  const all = IDPT.entries.filter(e => ok(e.id)).map(e => e.id);
  if (groups.length > 1 || !groups.length) groups.push({ key: "all", label: "Everyone on the list", ids: all });
  $("quicksel").hidden = !all.length;
  $("qs-list").innerHTML = groups.filter(g => g.ids.length).map(g => {
    const n = g.ids.filter(id => inBook(K, id)).length, full = n === g.ids.length;
    return `<li class="row${full ? " on" : ""}"><div class="pinfo"><div class="pname">${esc(g.label)}</div><div class="pmeta">${g.ids.length} ${g.ids.length === 1 ? "person" : "people"}${n && !full ? ` · ${n} already added` : ""}</div></div>` +
      `<button type="button" class="${full ? "rm" : "ok"}" data-qs="${esc(g.key)}">${full ? "Remove all" : "Add all"}</button></li>`;
  }).join("");
}
$("qs-list").addEventListener("click", e => {
  const b = e.target.closest("[data-qs]"); if (!b) return;
  const k = b.dataset.qs, ids = IDPT.entries.filter(x => k === "all" || "sec:" + x.section === k).map(x => x.id);
  const before = BOOKS[evKey()].sel.length;
  toggleIds(evKey(), ids, false);
  const diff = BOOKS[evKey()].sel.length - before;
  toast(diff > 0 ? `Added ${diff} to the ${evName()} letter.` : `Removed ${-diff} from the ${evName()} letter.`);
});
$("idpt-list").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const g = b.closest(".group"), sec = g.dataset.sec, br = g.dataset.branch;
  if (b.dataset.act === "del") return askDelete({ kind: "idpt", id: b.closest(".row").dataset.id });
  if (b.dataset.act === "edit") return openEdit("event", b.closest(".row").dataset.id);
  const inGroup = IDPT.entries.filter(x => x.section === sec && (BRANCHES.includes(x.b) ? x.b : "Other") === br).map(x => x.id);
  toggleIds(evKey(), b.dataset.act === "one" ? [b.closest(".row").dataset.id] : inGroup, b.dataset.act === "one");
});
trackOpen($("idpt-list"), $("qi"), openI, "att3.idpt.open");
$("qi").addEventListener("input", () => applySearch($("qi"), $("idpt-list"), openI));

// Pending QR sign-ups
let pendItems = [], joinOpen = true, pollTimer = null;
async function loadPending() {
  if (!unlocked() || !IDPT.ok) return;
  try {
    const slug = EV; if (!slug) return;
    const r = await rpc("ev_pending", { p_pin: auth.pin, p_event: slug }); if (slug !== EV) return; if (r.status !== "ok") return lostAccess(r.status);
    pendItems = r.items || []; joinOpen = !!r.open; renderPending();
  } catch (e) { $("pend-list").innerHTML = `<li class="empty">Couldn't load sign-ups. Check your connection.</li>`; }
}
function renderPending() {
  $("pend-count").textContent = pendItems.length;
  $("pend-all").hidden = pendItems.length < 2;
  $("join-state").textContent = joinOpen ? "QR sign-ups are open" : "QR sign-ups are closed";
  $("join-state").classList.toggle("off", !joinOpen);
  $("qr-toggle").textContent = joinOpen ? "Close sign-ups" : "Open sign-ups";
  $("pend-list").innerHTML = pendItems.length ? pendItems.map(it =>
    `<li class="row" data-id="${esc(it.id)}"><div class="pinfo"><div class="pname">${esc(it.name)}</div><div class="pmeta">${esc([it.branch, it.roll, it.division, it.year].filter(Boolean).join(" · "))}</div>` +
    `<div class="pmeta">${esc(it.sap)} · ${esc(it.section)} · ${esc(ago(it.created_at))}</div></div>` +
    `<button type="button" class="rm" data-rej="${esc(it.id)}">Reject</button><button type="button" class="ok" data-appr="${esc(it.id)}" aria-label="Approve ${esc(it.name)}">Approve</button></li>`).join("")
    : `<li class="empty">${joinOpen ? "Nobody waiting. New QR sign-ups show up here." : "Sign-ups are closed, so nobody new can register."}</li>`;
}
async function approve(ids, btn) {
  if (btn) btn.disabled = true;
  try { const r = await rpc("idpt_approve", { p_pin: auth.pin, p_ids: ids }); if (r.status !== "ok") return lostAccess(r.status);
    toast(r.approved === 1 ? "Approved 1 person." : `Approved ${r.approved} people.`); await refreshIdpt(true); }
  catch (e) { toast("Couldn't reach the database. Try again."); if (btn) btn.disabled = false; }
}
$("pend-list").addEventListener("click", async e => {
  const a = e.target.closest("[data-appr]"), j = e.target.closest("[data-rej]");
  if (a) return approve([a.dataset.appr], a);
  if (j) { j.disabled = true;
    try { const r = await rpc("idpt_delete", { p_pin: auth.pin, p_id: j.dataset.rej, p_by: auth.name || "" }); if (r.status !== "ok" && r.status !== "not_found") return lostAccess(r.status);
      toast("Rejected. It's in the bin if that was a mistake."); loadPending(); loadIdptBin(); }
    catch (err) { j.disabled = false; toast("Couldn't reach the database. Try again."); } }
});
$("pend-all").onclick = () => approve(pendItems.map(i => i.id), $("pend-all"));
$("pend-refresh").onclick = () => loadPending();
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(() => { if ((book === "idpt" || book === "ev") && view === "list" && unlocked() && document.visibilityState === "visible" && !openId) loadPending(); }, 15000); }

// IDPT bin
let ibin = [];
async function loadIdptBin() {
  if (!unlocked() || !IDPT.ok || !EV) return;
  const slug = EV;
  try { const r = await rpc("ev_bin", { p_pin: auth.pin, p_event: slug }); if (slug !== EV) return; if (r.status !== "ok") return lostAccess(r.status); ibin = r.items || []; renderIdptBin(); }
  catch (e) { $("ibin-list").innerHTML = `<li class="empty">Couldn't load the bin. Check your connection.</li>`; }
}
function renderIdptBin() {
  $("ibin-count").textContent = ibin.length; $("ibin-title").textContent = `${evName()} bin`;
  $("ibin-list").innerHTML = ibin.length ? ibin.map((it, i) =>
    `<li class="row"><div class="pinfo"><div class="pname">${esc(it.name)}</div><div class="pmeta">${esc(it.section)}${it.branch ? " · " + esc(it.branch) : ""}${it.roll ? " " + esc(it.roll) : ""}${it.state === "pending" ? " · rejected sign-up" : ""}</div>` +
    `<div class="pmeta">${it.state === "pending" ? "Rejected" : "Deleted"} ${it.deleted_by ? "by " + esc(it.deleted_by) + " " : ""}${esc(ago(it.deleted_at))}</div></div><div class="binbtns"><button type="button" class="rm" data-irestore="${i}">Restore</button><button type="button" class="rm dangerline" data-ipurge="${i}">Delete forever</button></div></li>`).join("")
    : `<li class="empty">The bin is empty. Deleted and rejected names show up here.</li>`;
}
$("ibin-list").addEventListener("click", async e => {
  const b = e.target.closest("[data-irestore]"); if (!b || !unlocked()) return;
  const it = ibin[+b.dataset.irestore]; b.disabled = true; b.textContent = "Restoring…";
  try { const r = await rpc("idpt_restore", { p_pin: auth.pin, p_id: it.id });
    if (r.status === "duplicate") { toast(`Can't restore ${it.name}: someone with the same SAP ID is already on the list.`); b.disabled = false; b.textContent = "Restore"; return; }
    if (r.status !== "ok" && r.status !== "not_found") return lostAccess(r.status);
    toast(it.state === "pending" ? `${it.name} is back in Waiting for approval.` : `Restored ${it.name} to ${it.section}.`); await refreshIdpt(true); }
  catch (err) { b.disabled = false; b.textContent = "Restore"; toast("Couldn't reach the database. Try again."); }
});
$("ibin-refresh").onclick = () => refreshIdpt(true);
$("ibin-list").addEventListener("click", e => {
  const b = e.target.closest("[data-ipurge]"); if (!b) return;
  const it = ibin[+b.dataset.ipurge];
  askConfirm(`Delete ${it.name} forever?`, `This removes ${it.name} from ${evName()} for good. It can't be restored afterwards.`, "Delete forever", async () => {
    await rpcOk("ev_purge", { p_pin: auth.pin, p_id: it.id }); await loadIdptBin(); return `Deleted ${it.name} forever.`;
  });
});
$("ibin-empty").onclick = () => {
  if (!ibin.length) return toast("The bin is already empty.");
  askConfirm("Empty the bin?", `This deletes ${ibin.length === 1 ? "the 1 name" : `all ${ibin.length} names`} in the ${evName()} bin for good. ${ibin.length === 1 ? "It" : "They"} can't be restored afterwards.`, "Empty bin", async () => {
    const r = await rpcOk("ev_empty_bin", { p_pin: auth.pin, p_event: EV }); await loadIdptBin(); return `Deleted ${r.deleted} from the bin forever.`;
  });
};

// Add at the desk
function fillSapGuess(sapEl, brEl, yrEl) {
  sapEl.addEventListener("input", () => {
    sapEl.value = sapEl.value.replace(/\D/g, "").slice(0, 11);
    const b = branchFromSap(sapEl.value), y = yearFromSap(sapEl.value);
    if (b && !brEl.dataset.touched) brEl.value = b;
    if (y && !yrEl.dataset.touched) yrEl.value = y;
  });
  brEl.addEventListener("change", () => brEl.dataset.touched = "1");
  yrEl.addEventListener("change", () => yrEl.dataset.touched = "1");
}
fillSapGuess($("ad-sap"), $("ad-branch"), $("ad-year"));
$("tool-add").onclick = () => {
  ["ad-name", "ad-sap", "ad-roll", "ad-div"].forEach(i => $(i).value = "");
  $("ad-branch").value = ""; $("ad-year").value = ""; delete $("ad-branch").dataset.touched; delete $("ad-year").dataset.touched;
  $("ad-sec").value = store.get("att3.lastsec." + EV, ""); $("ad-st").textContent = "";
  $("ad-title").textContent = isIdpt() ? "Add a player" : "Add a person";
  $("ad-help").textContent = `They go straight onto the ${evName()} list. Branch and year fill in from the SAP ID.`;
  $("ad-sec-label").textContent = isIdpt() ? "Sport / event" : "Team / role (optional)";
  $("ad-go").textContent = isIdpt() ? "Add player" : "Add person";
  openSheet("addsheet", $("ad-name"));
};
const ADD_MSG = { duplicate: "Someone with this SAP ID is already on this list or waiting for approval.", invalid: "Check the name and the 11-digit SAP ID.", not_found: "This event no longer exists. Reload the page." };
$("ad-form").addEventListener("submit", async e => {
  e.preventDefault();
  const v = { name: $("ad-name").value, sap: $("ad-sap").value, branch: $("ad-branch").value, year: $("ad-year").value, roll: $("ad-roll").value, div: $("ad-div").value, sec: clean($("ad-sec").value) };
  if (clean(v.name).length < 2) { $("ad-st").textContent = "Enter the student's name."; return $("ad-name").focus(); }
  if (!/^\d{11}$/.test(v.sap)) { $("ad-st").textContent = "The SAP ID should be 11 digits."; return $("ad-sap").focus(); }
  if (!v.branch || !v.year) { $("ad-st").textContent = "Pick the branch and year."; return; }
  if (!v.sec && isIdpt()) { $("ad-st").textContent = "Enter the sport or event."; return $("ad-sec").focus(); }
  $("ad-go").disabled = true; $("ad-st").textContent = "Adding…";
  try {
    const r = await rpc("ev_add", { p_pin: auth.pin, p_event: EV, p_name: niceName(v.name), p_sap: v.sap, p_branch: v.branch, p_year: v.year, p_roll: niceRoll(v.roll), p_division: clean(v.div).toUpperCase(), p_section: v.sec });
    if (r.status === "ok") {
      store.set("att3.lastsec." + EV, v.sec);
      ["ad-name", "ad-sap", "ad-roll", "ad-div"].forEach(i => $(i).value = ""); $("ad-branch").value = ""; $("ad-year").value = "";
      delete $("ad-branch").dataset.touched; delete $("ad-year").dataset.touched;
      $("ad-st").textContent = `Added ${niceName(v.name)}${v.sec ? " to " + v.sec : ""}. Add the next one, or close.`; $("ad-name").focus(); refreshIdpt(true);
    } else if (ADD_MSG[r.status]) $("ad-st").textContent = ADD_MSG[r.status];
    else { closeSheet(); lostAccess(r.status); }
  } catch (err) { $("ad-st").textContent = "Couldn't reach the database, so nothing was added. Try again."; }
  finally { $("ad-go").disabled = false; }
});

// Import a CSV into IDPT
let importRows = null;
$("tool-import").onclick = () => { $("im-default").value = isIdpt() ? "IDPT" : "Participants"; $("im-title").textContent = `Import into ${evName()}`; importRows = null; $("im-file").value = ""; $("im-sum").innerHTML = ""; $("im-go").disabled = true; $("im-st").textContent = ""; openSheet("importsheet", $("im-pick")); };
$("im-pick").onclick = () => $("im-file").click();
$("im-file").addEventListener("change", async () => {
  const f = $("im-file").files[0]; if (!f) return;
  $("im-st").textContent = "Reading…";
  try {
    const { grid } = await readTableFile(f);
    const res = peopleFromGrid(grid, clean($("im-default").value) || "IDPT");
    importRows = res.people;
    const counts = {}; res.people.forEach(p => counts[p.section] = (counts[p.section] || 0) + 1);
    $("im-sum").innerHTML = res.people.length
      ? `<p><b>${res.people.length}</b> people in <b>${Object.keys(counts).length}</b> ${Object.keys(counts).length === 1 ? "section" : "sections"}${res.dupes ? `, ${res.dupes} repeated ${res.dupes === 1 ? "row" : "rows"} merged` : ""}.</p><div class="chips">` +
        Object.entries(counts).map(([s, n]) => `<span class="pill">${esc(s)} ${n}</span>`).join("") + `</div>` +
        (res.people.some(p => !p.ok) ? `<p class="warnline">${res.people.filter(p => !p.ok).length} without a SAP ID or branch will be added but can't go on a letter.</p>` : "")
      : `<p class="warnline">No people found in this file. Check that each row has a name.</p>`;
    $("im-go").disabled = !res.people.length; $("im-go").textContent = res.people.length ? `Import ${res.people.length} people` : "Import";
    $("im-st").textContent = "";
  } catch (err) { $("im-st").textContent = "Couldn't read that file. Use a .csv or .xlsx file."; }
});
$("im-go").onclick = async () => {
  if (!importRows || !importRows.length) return;
  $("im-go").disabled = true; $("im-st").textContent = "Importing…";
  try {
    const rows = importRows.map(p => ({ section: p.section, name: p.n, branch: p.b, roll: p.r, sap: p.s, division: p.d, year: p.y || yearFromSap(p.s) }));
    const r = await rpc("ev_import", { p_pin: auth.pin, p_event: EV, p_rows: rows });
    if (r.status === "ok") { closeSheet(); toast(`Added ${r.added}.` + (r.skipped ? ` Skipped ${r.skipped} already on the list.` : "")); refreshIdpt(true); }
    else if (r.status === "invalid") { $("im-st").textContent = "That file is too big to import at once (2,000 rows max)."; $("im-go").disabled = false; }
    else { closeSheet(); lostAccess(r.status); }
  } catch (err) { $("im-st").textContent = "Couldn't reach the database, so nothing was imported. Try again."; $("im-go").disabled = false; }
};

// QR code for sign-ups
const joinUrl = () => new URL(EV === "idpt" ? "join.html" : "join.html?e=" + encodeURIComponent(EV), location.href.split("#")[0].split("?")[0]).href;
$("tool-qr").onclick = () => {
  const url = joinUrl(); $("qr-url").textContent = url;
  const qr = qrcode(0, "M"); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), scale = 10, pad = 4, size = (n + pad * 2) * scale, c = $("qr-canvas");
  c.width = c.height = size; const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#000";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + pad) * scale, (y + pad) * scale, scale, scale);
  $("qr-st").textContent = ""; $("qr-title").textContent = `${evName()} QR sign-up`; renderPending();
  openSheet("qrsheet", $("qr-copy"));
};
$("qr-copy").onclick = async () => {
  try { await navigator.clipboard.writeText(joinUrl()); $("qr-st").textContent = "Link copied."; }
  catch (e) { const r = document.createRange(); r.selectNodeContents($("qr-url")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("qr-st").textContent = "Press Copy on the selected link."; }
};
$("qr-save").onclick = () => { const a = document.createElement("a"); a.href = $("qr-canvas").toDataURL("image/png"); a.download = `${evName()} sign-up QR.png`; document.body.appendChild(a); a.click(); a.remove(); };
$("qr-toggle").onclick = async () => {
  $("qr-toggle").disabled = true;
  try { const r = await rpc("ev_set_join", { p_pin: auth.pin, p_event: EV, p_open: !joinOpen }); if (r.status !== "ok") { closeSheet(); return lostAccess(r.status); }
    joinOpen = r.open; renderPending(); $("qr-st").textContent = joinOpen ? "Sign-ups are open. The QR code works again." : "Sign-ups are closed. The QR page now says registration is closed."; }
  catch (e) { $("qr-st").textContent = "Couldn't reach the database. Try again."; }
  finally { $("qr-toggle").disabled = false; }
};

// ---------- Quick letter (from a file) ----------
let quickInfo = store.get("att3.quick.info", null);
$("qk-pick").onclick = () => $("qk-file").click();
$("qk-drop").addEventListener("dragover", e => { e.preventDefault(); $("qk-drop").classList.add("over"); });
$("qk-drop").addEventListener("dragleave", () => $("qk-drop").classList.remove("over"));
$("qk-drop").addEventListener("drop", e => { e.preventDefault(); $("qk-drop").classList.remove("over"); if (e.dataTransfer.files[0]) loadQuick(e.dataTransfer.files[0]); });
$("qk-file").addEventListener("change", () => { if ($("qk-file").files[0]) loadQuick($("qk-file").files[0]); $("qk-file").value = ""; });
async function loadQuick(f) {
  $("qk-st").textContent = "Reading…";
  try {
    const { grid, sheet } = await readTableFile(f);
    const res = peopleFromGrid(grid, "");
    if (!res.people.length) { $("qk-st").textContent = "No students found in that file. Each row needs at least a name."; return; }
    BOOKS.quick.sel = res.people.map((p, i) => ({ id: "q" + i, n: p.n, b: p.b, r: p.r, s: p.s, d: p.d, fy: p.y, ft: p.t || "", ok: p.ok }));
    const QT = timingOf("quick"); QT.times = {}; if (res.people.some(p => p.t)) QT.on = true; saveTiming("quick");
    quickInfo = { file: f.name, sheet, dupes: res.dupes, hasYear: res.hasYear, total: res.people.length };
    if (res.hasYear) $("qk-year").value = "file"; else if ($("qk-year").value === "file") $("qk-year").value = "sap";
    store.set("att3.quick.info", quickInfo); applyQuickYear(); saveSel("quick");
    $("qk-st").textContent = ""; renderQuickInfo(); renderTimingControls(); renderTable(); renderCounts();
  } catch (e) { $("qk-st").textContent = "Couldn't read that file. Use a .csv or .xlsx file (in Google Sheets: File → Download → CSV)."; }
}
function applyQuickYear() {
  const mode = $("qk-year").value; store.set("att3.quick.yearmode", mode);
  BOOKS.quick.sel.forEach(p => { p.y = mode === "file" ? (p.fy || yearFromSap(p.s)) : mode === "sap" ? yearFromSap(p.s) : mode; });
  saveSel("quick");
}
$("qk-year").addEventListener("change", () => { applyQuickYear(); renderTable(); });
function renderQuickInfo() {
  const q = quickInfo, rows = BOOKS.quick.sel;
  if (!q || !rows.length) { $("qk-info").hidden = true; $("qk-drop").classList.remove("loaded"); return; }
  $("qk-info").hidden = false; $("qk-drop").classList.add("loaded");
  const miss = rows.filter(p => !p.ok).length, noYear = rows.filter(p => !p.y).length;
  $("qk-info").innerHTML = `<b>${esc(q.file)}</b>${q.sheet ? ` · sheet “${esc(q.sheet)}”` : ""}<br>${q.total} students loaded` +
    (q.dupes ? `, ${q.dupes} repeated ${q.dupes === 1 ? "row" : "rows"} merged` : "") + "." +
    (miss ? `<span class="warnline"> ${miss} ${miss === 1 ? "row has" : "rows have"} no SAP ID or branch. Check ${miss === 1 ? "it" : "them"} in the table.</span>` : "") +
    (noYear ? `<span class="warnline"> ${noYear} without a year. Pick one under Year.</span>` : "");
}

// ---------- Letter (shared view for all three) ----------
function orderedRows(k) {
  const B = BOOKS[k];
  const L = k === "quick" ? B.sel : B.sel.map(id => person(k, id)).filter(Boolean);
  if (B.F.order === "added" || B.F.order === "file") return L;
  return sortByYearBranch(L);
}
function renderTable() {
  if (window.renderTimingGroups) renderTimingGroups();
  const L = orderedRows(bk());
  $("tabletitle").textContent = `Students in the table (${L.length})`;
  $("clear").disabled = !L.length;
  if (!L.length) {
    $("tablewrap").innerHTML = `<p class="empty">${book === "quick" ? "Upload a CSV or Excel file above to fill the table." : "Nobody added yet. Go to the list and tap + next to a name, or use Select all."}</p>`; return;
  }
  const yrs = {}; L.forEach(p => yrs[p.y || "—"] = (yrs[p.y || "—"] || 0) + 1);
  const T = timingOf(bk()), timed = T.on;
  $("tablewrap").innerHTML = `<p class="empty" style="margin:0 0 8px">${Object.entries(yrs).map(([y, n]) => `${n} ${y}`).join(" · ")}</p><div class="tw"><table><thead><tr>${timed ? '<th class="x"><span class="sr">Select</span></th>' : ""}<th>Name</th>${timed ? "<th>Timing</th>" : ""}<th>Branch</th><th>Roll No.</th><th>Student ID</th><th>Division</th><th>Year</th><th></th></tr></thead><tbody>` +
    L.map(p => { const tm = timed ? timeFor(bk(), p) : null;
      return `<tr${p.ok ? "" : ' class="miss"'}>${timed ? `<td class="x"><input type="checkbox" class="tick" data-tick="${esc(p.id)}"${ticked.has(p.id) ? " checked" : ""} aria-label="Select ${esc(p.n)}"></td>` : ""}<td>${esc(p.n)}${p.tmp ? ' <span class="tag">today only</span>' : ""}</td>` +
        (timed ? `<td><button type="button" class="tbtn${tm.own ? " own" : ""}" data-time="${esc(p.id)}" aria-label="Change timing for ${esc(p.n)}">${esc(tm.text)}</button></td>` : "") +
        `<td class="m">${esc(p.b || "—")}</td><td class="m">${esc(p.r || "—")}</td><td class="m">${esc(p.s || "—")}</td><td class="m">${esc(p.d || "—")}</td><td class="m">${esc(p.y || "—")}</td>` +
        `<td class="x"><button type="button" class="rm" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.n)} from the letter">Remove</button></td></tr>`; }).join("") + `</tbody></table></div>`;
}
$("tablewrap").addEventListener("click", e => {
  const b = e.target.closest("[data-rm]"); if (!b) return; const B = BOOKS[bk()];
  B.sel = book === "quick" ? B.sel.filter(p => p.id !== b.dataset.rm) : B.sel.filter(x => x !== b.dataset.rm);
  saveSel(bk()); renderCounts(); renderTable(); if (book === "quick") renderQuickInfo(); else if (book === "trinity") { renderTrinity(); renderTmp(); } else renderIdpt();
});
$("clear").addEventListener("click", () => { $("clearconfirm").hidden = false; });
$("clearno").addEventListener("click", () => { $("clearconfirm").hidden = true; });
$("clearyes").addEventListener("click", () => {
  BOOKS[bk()].sel = []; saveSel(bk()); $("clearconfirm").hidden = true;
  if (book === "quick") { quickInfo = null; store.del("att3.quick.info"); renderQuickInfo(); }
  renderCounts(); renderTable(); book === "trinity" ? renderTrinity() : book !== "quick" ? renderIdpt() : 0;
});
const FIELDS = { to: "f-to", subject: "f-subject", greeting: "f-greeting", body: "f-body", note: "f-note", file: "f-file", order: "f-order", from: "f-from", until: "f-until" };
function fillFields() {
  const B = BOOKS[bk()];
  $("f-order").innerHTML = B.orders.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  for (const k in FIELDS) $(FIELDS[k]).value = B.F[k];
}
for (const k in FIELDS) {
  const ev = k === "order" || k === "from" || k === "until" ? "change" : "input";
  $(FIELDS[k]).addEventListener(ev, e => { BOOKS[bk()].F[k] = e.target.value; store.set(BOOKS[bk()].fKey + k, e.target.value); if (k === "order") renderTable(); });
}
$("reset").addEventListener("click", () => { const B = BOOKS[bk()]; ["to", "subject", "greeting", "body", "note"].forEach(k => { B.F[k] = B.defaults[k]; store.set(B.fKey + k, B.F[k]); }); fillFields(); });

let LH = null;
async function letterhead() {
  if (LH) return LH;
  const blob = await (await fetch("letterhead.jpg")).blob();
  LH = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob); });
  return LH;
}
$("dl").addEventListener("click", async () => {
  const st = $("st"), B = BOOKS[bk()], L = orderedRows(bk());
  if (!L.length) { st.textContent = book === "quick" ? "Upload a file with the students first." : "Add at least one student before downloading the letter."; return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { st.textContent = "The PDF tools didn't load. Check your connection and reload the page."; return; }
  if (!B.F.subject.trim()) { st.textContent = "Write a subject for the letter first."; $("f-subject").focus(); return; }
  if (!B.F.from) { st.textContent = "Pick the attendance date first. It's saved in Records."; $("f-from").focus(); return; }
  const until = B.F.until && B.F.until >= B.F.from ? B.F.until : B.F.from;
  let body = fillDates(B.F.body, B.F.from, until);
  if (timingOf(bk()).on) body = body.replace(/full[- ]day attendance/i, "attendance").trim() + " The timing for each student is given in the table below.";
  const timed = timingOf(bk()).on;
  const rows = L.map(p => { const r = [p.n, p.b || "—", p.r || "—", p.s || "—", p.d || "—", p.y || "—"]; if (timed) r.push(timeFor(bk(), p).text); return r; });
  let name = (B.F.file || "Attendance Letter").trim(); if (!/\.pdf$/i.test(name)) name += ".pdf";
  try {
    const doc = buildLetter(window.jspdf.jsPDF, (d, o) => d.autoTable(o), { letterhead: await letterhead(), to: B.F.to, subject: B.F.subject, greeting: B.F.greeting, body, note: B.F.note, rows });
    doc.save(name); st.textContent = `Downloaded ${name} with ${L.length} students. Saving it in Records…`;
  } catch (e) { st.textContent = "Couldn't create the file. Reload the page and try again."; return; }
  const list = book === "quick" ? `Quick letter${quickInfo ? " · " + quickInfo.file : ""}` : book === "trinity" ? "Trinity Team" : evName();
  const rec = { p_from: B.F.from, p_to: until, p_list: list, p_subject: B.F.subject,
    p_letter: { to: B.F.to, greeting: B.F.greeting, body, note: B.F.note, file: name }, p_people: rows, p_by: (auth && auth.name) || store.get("att3.lastname", "") };
  try {
    await viewRpc("log_letter", rec);
    st.textContent = `Downloaded ${name} with ${L.length} students and saved it in Records under ${fmtDate(B.F.from)}.`;
  } catch (e) {
    if (e.pin) { st.textContent = `Downloaded ${name}, but couldn't save it in Records.`; return; }
    store.set("att3.outbox", [...store.get("att3.outbox", []), rec]); renderOffline();
    st.textContent = `Downloaded ${name}. You're offline, so it'll be saved in Records as soon as you're back online.`;
  }
});

// ---------- Events tab ----------
function renderPicker() {
  const active = EVENTS.filter(e => e.slug !== "idpt" && !e.archived), archived = EVENTS.filter(e => e.slug !== "idpt" && e.archived);
  const ed = unlocked();
  $("ev-none").hidden = active.length > 0 || (ed && archived.length > 0);
  $("ev-none").textContent = ed ? "No events yet. Tap New event to make one." : "No events yet. Core can make one after logging in.";
  $("ev-field").hidden = !(active.length || (ed && archived.length));
  $("ev-select").innerHTML = (EV && book === "ev" ? "" : `<option value="">Pick an event</option>`) +
    active.map(e => `<option value="${esc(e.slug)}">${esc(e.name)}</option>`).join("") +
    (ed && archived.length ? `<optgroup label="Archived">${archived.map(e => `<option value="${esc(e.slug)}">${esc(e.name)} (archived)</option>`).join("")}</optgroup>` : "");
  if (book === "ev" && EV) $("ev-select").value = EV;
  $("ev-admin").hidden = !ed;
  const cur = book === "ev" && EV ? EVM[EV] : null;
  $("ev-rename").hidden = $("ev-archive").hidden = !cur;
  if (cur) $("ev-archive").textContent = cur.archived ? "Unarchive" : "Archive";
  $("ev-archived").hidden = !(cur && cur.archived);
}
$("ev-select").addEventListener("change", e => { if (e.target.value) location.hash = "ev-" + e.target.value; });
let evMode = "new";
function openEvSheet(mode) {
  evMode = mode;
  $("ev-sheet-title").textContent = mode === "new" ? "New event" : "Rename event";
  $("ev-help").textContent = mode === "new" ? "It gets its own list, QR sign-up and letter. Everything else works like IDPT Sports." : "The QR code and link stay the same.";
  $("ev-name").value = mode === "new" ? "" : evName(); $("ev-st").textContent = "";
  $("ev-go").textContent = mode === "new" ? "Create event" : "Save name";
  openSheet("evsheet", $("ev-name"));
}
$("ev-new").onclick = () => openEvSheet("new");
$("ev-rename").onclick = () => openEvSheet("rename");
$("ev-form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = clean($("ev-name").value);
  if (name.length < 2) { $("ev-st").textContent = "Enter the event name."; return $("ev-name").focus(); }
  $("ev-go").disabled = true; $("ev-st").textContent = evMode === "new" ? "Creating…" : "Saving…";
  try {
    const r = evMode === "new" ? await rpc("ev_create", { p_pin: auth.pin, p_name: name }) : await rpc("ev_rename", { p_pin: auth.pin, p_event: EV, p_name: name });
    if (r.status === "ok") {
      await loadEvents(); closeSheet();
      if (evMode === "new") { toast(`Created ${name}. Share its QR code or add people.`); location.hash = "ev-" + r.slug; }
      else { const keep = BOOKS[evKey()]; delete BOOKS[evKey()]; const nb = ensureBook(evKey()); if (keep) { nb.sel = keep.sel; } renderAll(); toast(`Renamed to ${name}.`); }
    } else if (r.status === "invalid") $("ev-st").textContent = "Enter a longer name.";
    else { closeSheet(); lostAccess(r.status); }
  } catch (err) { $("ev-st").textContent = "Couldn't reach the database. Try again."; }
  finally { $("ev-go").disabled = false; }
});
$("ev-archive").onclick = async () => {
  const cur = EVM[EV]; if (!cur) return; $("ev-archive").disabled = true;
  try { const r = await rpc("ev_archive", { p_pin: auth.pin, p_event: EV, p_archived: !cur.archived });
    if (r.status !== "ok") return lostAccess(r.status);
    await loadEvents(); renderAll();
    toast(cur.archived ? `${cur.name} is back in the event list.` : `Archived ${cur.name}. Its sign-ups are closed and it's hidden from the list. Nothing was deleted.`); }
  catch (e) { toast("Couldn't reach the database. Try again."); }
  finally { $("ev-archive").disabled = false; }
};

// ---------- Navigation ----------
function renderCounts() {
  for (const k of ["trinity", "idpt"]) { const n = BOOKS[k].sel.length; $("cnt-" + k).textContent = n; $("cnt-" + k).classList.toggle("zero", !n); }
  const n = BOOKS[bk()].sel.length; $("tabcount").textContent = n; $("tabcount").classList.toggle("zero", !n);
  $("barn").textContent = n; $("barbook").textContent = book === "trinity" ? "Trinity" : book === "idpt" ? "IDPT" : evName();
}
function renderNav() {
  if (view === "records") {
    document.querySelectorAll("[data-book]").forEach(b => b.setAttribute("aria-current", "false"));
    ["subtabs", "view-trinity", "view-idpt", "view-letter", "bar"].forEach(i => $(i).hidden = true);
    $("view-records").hidden = false; $("rec-btn").setAttribute("aria-current", "page"); return;
  }
  $("view-records").hidden = true; $("rec-btn").setAttribute("aria-current", "false");
  const nav = book === "ev" ? "events" : book;
  document.querySelectorAll("[data-book]").forEach(b => b.setAttribute("aria-current", b.dataset.book === nav ? "page" : "false"));
  const noEv = book === "ev" && !EV;
  $("subtabs").hidden = book === "quick";
  $("tab-letter").disabled = noEv;
  $("tab-people").textContent = book === "idpt" ? "Players" : "People";
  $("tab-people").setAttribute("aria-selected", view === "list"); $("tab-letter").setAttribute("aria-selected", view === "letter");
  $("view-trinity").hidden = !(book === "trinity" && view === "list");
  $("view-idpt").hidden = !((book === "idpt" || book === "ev") && view === "list");
  $("ev-picker").hidden = book !== "ev";
  $("ev-body").hidden = noEv;
  $("view-letter").hidden = view !== "letter";
  $("qk-card").hidden = book !== "quick";
  $("letter-title").textContent = book === "quick" ? "Quick letter" : book === "trinity" ? "Trinity letter" : `${evName()} letter`;
  $("tools-title").textContent = isIdpt() ? "Add players" : "Add people";
  $("bar").hidden = view !== "list" || noEv;
}
function setEvent(slug) {
  if (slug === EV) return;
  EV = slug; IDPT = { ok: false, sections: [], entries: [] }; Q = {}; pendItems = []; ibin = [];
  $("idpt-list").innerHTML = ""; $("qi").value = "";
  if (slug) { ensureBook(evKey()); refreshIdpt(false); } else renderIdpt();
}
function route() {
  const h = location.hash.replace("#", "");
  if (h === "records") { view = "records"; renderNav(); renderAccount(); openRecords(); return; }
  if (h === "quick") { book = "quick"; view = "letter"; }
  else if (h.startsWith("idpt")) { book = "idpt"; view = h === "idpt-letter" ? "letter" : "list"; setEvent("idpt"); }
  else if (h === "events" || h.startsWith("ev-")) {
    book = "ev"; view = h.endsWith("-letter") ? "letter" : "list";
    let slug = h === "events" ? "" : h.slice(3).replace(/-letter$/, "");
    if (!slug) { const last = store.get("att3.lastev", ""); const act = EVENTS.filter(e => e.slug !== "idpt" && !e.archived);
      slug = (act.find(e => e.slug === last) || act[0] || {}).slug || ""; }
    if (slug && !EVM[slug]) slug = "";
    if (slug === "idpt") { location.hash = "idpt"; return; }
    if (slug) store.set("att3.lastev", slug);
    if (!slug) view = "list";
    setEvent(slug);
  }
  else { book = "trinity"; view = h === "letter" || h === "trinity-letter" ? "letter" : "list"; }
  renderNav(); renderPicker(); renderCounts(); renderAccount();
  if (view === "letter") { fillFields(); ticked.clear(); renderTimingControls(); renderTable(); if (book === "quick") { $("qk-year").value = store.get("att3.quick.yearmode", "file"); renderQuickInfo(); } }
  if ((book === "idpt" || book === "ev") && view === "list") { renderIdpt(); if (unlocked()) { loadPending(); loadIdptBin(); } }
}
const listHash = () => book === "ev" ? (EV ? "ev-" + EV : "events") : book;
document.querySelectorAll("[data-book]").forEach(b => b.onclick = () => { location.hash = b.dataset.book; scrollTo(0, 0); });
$("tab-people").onclick = () => { location.hash = listHash(); };
$("tab-letter").onclick = () => { if (book !== "ev" || EV) location.hash = listHash() + "-letter"; };
$("golet").onclick = () => { location.hash = listHash() + "-letter"; scrollTo(0, 0); };
addEventListener("hashchange", route);

// ---------- Start ----------
$("lhimg").src = "letterhead.jpg";
loadTmp(); renderTmp();
let booted = false;
function boot() {
  if (booted) return; booted = true; $("gate").hidden = true; document.body.classList.remove("locked");
  refreshTrinity(false); startPolling();
  (async () => { await loadEvents(); EV = null; route(); if (!EV) setEvent("idpt"); flushOutbox(); })();
  renderOffline();
}
addEventListener("DOMContentLoaded", () => { if (VIEW) boot(); else showGate(); });
addEventListener("online", () => { if (!booted) return; refreshTrinity(true); loadEvents().then(() => { renderPicker(); refreshIdpt(true); }); flushOutbox(); });
addEventListener("offline", () => { if (booted) wentOffline(Date.now()); });
if ("serviceWorker" in navigator && location.protocol !== "file:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { loadTmp(); renderTmp(); renderCounts(); } if (booted && document.visibilityState === "visible" && MODE !== "loading" && !openId) { refreshTrinity(true); loadEvents().then(() => { renderPicker(); refreshIdpt(true); }); } });
