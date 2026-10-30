// View PIN gate, editing details, attendance dates and the Records tab.

// ---------- View PIN gate ----------
function showGate(msg) {
  $("gate").hidden = false; document.body.classList.add("locked");
  $("gt-st").textContent = msg || ""; $("gt-pin").value = ""; setTimeout(() => $("gt-pin").focus(), 50);
}
function viewLost(status) {
  if (auth && auth.pin === VIEW) { auth = null; store.del("att3.auth"); }
  VIEW = null; store.del("att3.view");
  showGate(status === "locked" ? PIN_MSG.locked : "The PIN for this site has changed. Enter the new one.");
}
$("gt-form").addEventListener("submit", async e => {
  e.preventDefault();
  const pin = $("gt-pin").value;
  if (!pin) { $("gt-st").textContent = "Enter the PIN."; return; }
  $("gt-go").disabled = true; $("gt-st").textContent = "Checking…";
  try {
    const r = await rpc("view_unlock", { p_pin: pin });
    if (r.status !== "ok") { $("gt-st").textContent = PIN_MSG[r.status] || "Couldn't check the PIN. Try again."; return; }
    setView(pin);
    if (booted) location.reload(); else boot();
  } catch (err) { $("gt-st").textContent = "Couldn't reach the database. Check your connection and try again."; }
  finally { $("gt-go").disabled = false; }
});
$("signout").onclick = () => {
  askConfirm("Sign out on this phone?", "You'll need the PIN again to open the lists. Letters you haven't downloaded, and today-only people, stay on this phone.", "Sign out", async () => {
    VIEW = null; auth = null; store.del("att3.view"); store.del("att3.auth"); location.hash = ""; location.reload(); return "";
  }, true);
};

// ---------- Attendance dates on the letter ----------
function ord(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
const asDate = iso => new Date(iso + "T00:00:00");
function longDate(iso) { const d = asDate(iso); return ord(d.getDate()) + " " + d.toLocaleDateString("en-IN", { month: "long" }); }
function fmtDate(iso) { const d = asDate(iso); return `${d.toLocaleDateString("en-IN", { weekday: "short" })}, ${d.getDate()} ${d.toLocaleDateString("en-IN", { month: "short" })} ${d.getFullYear()}`; }
function fillDates(body, from, to) {
  const span = from === to ? "on " + longDate(from) : "from " + longDate(from) + " to " + longDate(to);
  return String(body || "").replace(/\bfrom\s*_{2,}\s*to\s*_{2,}/i, span).replace(/\bon\s*_{2,}/i, "on " + longDate(from));
}

// ---------- Editing details (core) ----------
let editing = null;
fillSapGuess($("ed-sap"), $("ed-branch"), $("ed-year"));
function ensureOption(sel, v) { if (v && ![...sel.options].some(o => o.value === v)) sel.add(new Option(v, v)); sel.value = v || ""; }
function openEdit(kind, id) {
  const p = kind === "trinity" ? P[id] : Q[id]; if (!p) return;
  editing = { kind, id };
  $("ed-name").value = p.n; $("ed-sap").value = p.s || ""; $("ed-roll").value = p.r || ""; $("ed-div").value = p.d || "";
  ensureOption($("ed-branch"), p.b); ensureOption($("ed-year"), p.y);
  $("ed-branch").dataset.touched = "1"; $("ed-year").dataset.touched = "1";
  $("ed-sec-wrap").hidden = kind === "trinity";
  if (kind !== "trinity") { $("ed-sec").value = p.section || ""; $("ed-sec-label").textContent = isIdpt() ? "Sport / event" : "Team / role (optional)"; }
  $("ed-note").textContent = kind === "trinity"
    ? "Changes show in every department this person is in, for everyone."
    : `Changes show on the ${evName()} list for everyone.`;
  $("ed-st").textContent = ""; openSheet("edsheet", $("ed-name"));
}
const EDIT_MSG = { invalid: "Check the name. The SAP ID should be 11 digits, or empty.", duplicate: "Someone else on this list already has that SAP ID.", not_found: "This person isn't on the list any more. Reload the page." };
$("ed-form").addEventListener("submit", async e => {
  e.preventDefault(); if (!editing || !unlocked()) return;
  const v = { name: niceName($("ed-name").value), sap: $("ed-sap").value.trim(), branch: $("ed-branch").value, year: $("ed-year").value,
    roll: niceRoll($("ed-roll").value), div: clean($("ed-div").value).toUpperCase(), sec: clean($("ed-sec").value) };
  if (v.name.length < 2) { $("ed-st").textContent = "Enter the name."; return $("ed-name").focus(); }
  if (v.sap && !/^\d{11}$/.test(v.sap)) { $("ed-st").textContent = "The SAP ID should be 11 digits."; return $("ed-sap").focus(); }
  $("ed-go").disabled = true; $("ed-st").textContent = "Saving…";
  try {
    const r = editing.kind === "trinity"
      ? await rpc("member_update", { p_pin: auth.pin, p_id: editing.id, p_name: v.name, p_sap: v.sap, p_branch: v.branch, p_year: v.year, p_roll: v.roll, p_division: v.div })
      : await rpc("ev_update", { p_pin: auth.pin, p_id: editing.id, p_name: v.name, p_sap: v.sap, p_branch: v.branch, p_year: v.year, p_roll: v.roll, p_division: v.div, p_section: v.sec });
    if (r.status === "ok") { closeSheet(); toast(`Saved ${v.name}'s details.`); editing.kind === "trinity" ? refreshTrinity(true) : refreshIdpt(true); }
    else if (EDIT_MSG[r.status]) $("ed-st").textContent = EDIT_MSG[r.status];
    else { closeSheet(); lostAccess(r.status); }
  } catch (err) { $("ed-st").textContent = "Couldn't reach the database, so nothing changed. Try again."; }
  finally { $("ed-go").disabled = false; }
});

// ---------- Records ----------
let RECS = [], recOpen = new Set();
$("rec-btn").onclick = () => { location.hash = "records"; scrollTo(0, 0); };
$("rec-login").onclick = () => { afterLogin = () => openRecords(); $("lg-pin").value = ""; $("lg-name").value = store.get("att3.lastname", ""); $("lg-st").textContent = ""; openSheet("loginsheet", $("lg-pin")); };
async function openRecords() {
  const ok = unlocked();
  $("rec-locked").hidden = ok; $("rec-body").hidden = !ok;
  if (!ok) return;
  $("rec-list").innerHTML = `<p class="empty">Loading…</p>`;
  try {
    const r = await rpc("list_letters", { p_pin: auth.pin }); if (r.status !== "ok") return lostAccess(r.status);
    RECS = r.items || []; renderRecords();
  } catch (e) { $("rec-list").innerHTML = `<p class="banner">Couldn't load Records. Check your connection.</p>`; }
  try { const s = await rpc("view_pin_status", { p_pin: auth.pin });
    if (s.status === "ok") $("vp-state").textContent = s.set ? "A view PIN is set. Anyone with it can see the lists and make letters." : "No view PIN yet, so only the core PIN opens the site. Set one for your team."; } catch (e) {}
}
function recMatches(rec, q) {
  if (!q) return { show: true, hits: [] };
  const hits = rec.people.filter(p => (p[0] + " " + p[3] + " " + p[2]).toLowerCase().includes(q)).map(p => p[0]);
  return { show: hits.length > 0 || (rec.subject + " " + rec.list_name).toLowerCase().includes(q), hits };
}
function renderRecords() {
  const q = $("rq").value.trim().toLowerCase();
  const shown = RECS.map(r => ({ r, m: recMatches(r, q) })).filter(x => x.m.show);
  $("rec-sum").textContent = q ? `${shown.length} ${shown.length === 1 ? "letter matches" : "letters match"} “${$("rq").value.trim()}”.` : `${RECS.length} ${RECS.length === 1 ? "letter" : "letters"} saved.`;
  if (!shown.length) { $("rec-list").innerHTML = `<p class="empty">${q ? "Nothing matches that name, SAP ID or subject." : "No letters yet. Every letter you download is saved here with its attendance dates."}</p>`; return; }
  const days = []; const byDay = {};
  shown.forEach(x => { const k = x.r.date_from; if (!byDay[k]) { byDay[k] = []; days.push(k); } byDay[k].push(x); });
  $("rec-list").innerHTML = days.map(day => `<section class="recday"><h3>${esc(fmtDate(day))}</h3>` + byDay[day].map(({ r, m }) => {
    const range = r.date_to && r.date_to !== r.date_from ? `${fmtDate(r.date_from)} to ${fmtDate(r.date_to)}` : fmtDate(r.date_from);
    const when = new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const isOpen = recOpen.has(r.id);
    return `<article class="rec" data-id="${esc(r.id)}"><div class="rowline"><span class="pill on">${esc(r.list_name || "Letter")}</span><span class="pmeta">${esc(range)}</span></div>` +
      `<div class="rsub">${esc(r.subject)}</div>` +
      `<div class="pmeta">${r.people_count} ${r.people_count === 1 ? "student" : "students"} · downloaded ${esc(when)}${r.by_name ? " by " + esc(r.by_name) : ""}</div>` +
      (m.hits.length ? `<div class="hit">Includes ${esc(m.hits.slice(0, 5).join(", "))}${m.hits.length > 5 ? ` and ${m.hits.length - 5} more` : ""}</div>` : "") +
      `<div class="actions"><button type="button" class="rm" data-rshow>${isOpen ? "Hide names" : "Show names"}</button><button type="button" class="rm" data-rdl>Download again</button><button type="button" class="rm dangerline" data-rdel>Delete</button></div>` +
      (isOpen ? `<div class="tw"><table><thead><tr><th>Name</th><th>Branch</th><th>Roll No.</th><th>Student ID</th><th>Division</th><th>Year</th></tr></thead><tbody>` +
        r.people.map(p => `<tr><td>${esc(p[0])}</td>${p.slice(1).map(c => `<td class="m">${esc(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>` : "") +
      `</article>`;
  }).join("") + `</section>`).join("");
}
$("rq").addEventListener("input", renderRecords);
$("rec-refresh").onclick = () => openRecords();
$("rec-list").addEventListener("click", async e => {
  const card = e.target.closest(".rec"); if (!card) return;
  const rec = RECS.find(r => r.id === card.dataset.id); if (!rec) return;
  if (e.target.closest("[data-rshow]")) { recOpen.has(rec.id) ? recOpen.delete(rec.id) : recOpen.add(rec.id); renderRecords(); return; }
  if (e.target.closest("[data-rdl]")) {
    try {
      const L = rec.letter || {};
      const doc = buildLetter(window.jspdf.jsPDF, (d, o) => d.autoTable(o), { letterhead: await letterhead(), to: L.to || "", subject: rec.subject, greeting: L.greeting || "", body: L.body || "", note: L.note || "", rows: rec.people });
      doc.save(L.file || "Attendance Letter.pdf"); toast("Downloaded the same letter again.");
    } catch (err) { toast("Couldn't create the file. Reload the page and try again."); }
    return;
  }
  if (e.target.closest("[data-rdel]")) {
    askConfirm("Delete this record?", `“${rec.subject}” for ${fmtDate(rec.date_from)} will be removed from Records for good. The PDF you downloaded isn't affected.`, "Delete record", async () => {
      await rpcOk("delete_letter", { p_pin: auth.pin, p_id: rec.id }); RECS = RECS.filter(r => r.id !== rec.id); renderRecords(); return "Deleted the record.";
    });
  }
});

// Core sets the view PIN for the team
$("vp-form").addEventListener("submit", async e => {
  e.preventDefault(); if (!unlocked()) return;
  const pin = $("vp-new").value;
  if (pin.length < 4) { $("vp-st").textContent = "Use at least 4 characters. Longer is safer."; return; }
  if (pin === auth.pin) { $("vp-st").textContent = "Use a different PIN from the core PIN."; return; }
  $("vp-go").disabled = true; $("vp-st").textContent = "Saving…";
  try {
    const r = await rpc("set_view_pin", { p_pin: auth.pin, p_new: pin });
    if (r.status === "ok") { $("vp-new").value = ""; $("vp-st").textContent = "Saved. Share it with your team. Phones using an older view PIN will be asked for this one."; openRecords(); }
    else if (r.status === "invalid") $("vp-st").textContent = "Use at least 4 characters.";
    else lostAccess(r.status);
  } catch (err) { $("vp-st").textContent = "Couldn't reach the database. Try again."; }
  finally { $("vp-go").disabled = false; }
});
