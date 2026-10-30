// Optional Timing column: one default slot for everyone, changed per student where needed.
// College hours are 8:00 AM to 6:00 PM, in half-hour steps.
const SLOTS = [];
for (let m = 8 * 60; m <= 18 * 60; m += 30) SLOTS.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
function fmtTime(hm) { const [h, m] = hm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; }
const slotLabel = (f, t) => `${fmtTime(f)} – ${fmtTime(t)}`;
function fillSlots(sel, from) { sel.innerHTML = SLOTS.filter(s => !from || s > from).map(s => `<option value="${s}">${fmtTime(s)}</option>`).join(""); }

function timingOf(k) {
  const B = BOOKS[k];
  if (!B.T) { B.T = store.get(B.fKey + "T", null) || { on: false, from: "09:00", to: "17:00", times: {} }; }
  return B.T;
}
function saveTiming(k) { store.set(BOOKS[k].fKey + "T", timingOf(k)); }
// What a student's Timing cell says, and whether it's their own or the default.
function timeFor(k, p) {
  const T = timingOf(k), own = T.times[p.id];
  if (own && own.f) return { text: slotLabel(own.f, own.t), own: true };
  if (own && own.x) return { text: own.x, own: true };
  if (p.ft) return { text: p.ft, own: true }; // from a Quick letter file
  return { text: slotLabel(T.from, T.to), own: false };
}

let ticked = new Set();
function renderTimingControls() {
  const k = bk(), T = timingOf(k);
  $("f-timing").checked = T.on; $("ti-controls").hidden = !T.on;
  fillSlots($("ti-from")); $("ti-from").value = T.from;
  fillSlots($("ti-to"), T.from); $("ti-to").value = T.to > T.from ? T.to : SLOTS[SLOTS.indexOf(T.from) + 1];
  const live = new Set(orderedRows(k).map(p => p.id)); ticked = new Set([...ticked].filter(id => live.has(id)));
  $("ti-sel").disabled = !ticked.size;
  $("ti-sel").textContent = ticked.size ? `Set timing for ${ticked.size} selected` : "Tick students to set their timing together";
}
$("f-timing").addEventListener("change", e => { const T = timingOf(bk()); T.on = e.target.checked; saveTiming(bk()); ticked.clear(); renderTimingControls(); renderTable(); });
$("ti-from").addEventListener("change", e => {
  const T = timingOf(bk()); T.from = e.target.value; if (T.to <= T.from) T.to = SLOTS[Math.min(SLOTS.indexOf(T.from) + 1, SLOTS.length - 1)];
  saveTiming(bk()); renderTimingControls(); renderTable();
});
$("ti-to").addEventListener("change", e => { const T = timingOf(bk()); T.to = e.target.value; saveTiming(bk()); renderTable(); });
$("ti-reset").onclick = () => { const T = timingOf(bk()); T.times = {}; saveTiming(bk()); ticked.clear(); renderTimingControls(); renderTable(); toast("Everyone is back on the default timing."); };

// Per-student (or ticked group) timing sheet
let tiTarget = [];
function openTiming(ids) {
  const k = bk(), T = timingOf(k); tiTarget = ids;
  const people = orderedRows(k).filter(p => ids.includes(p.id));
  $("ti-title").textContent = people.length === 1 ? `Timing for ${people[0].n}` : `Timing for ${people.length} students`;
  const own = people.length === 1 ? T.times[people[0].id] : null;
  const f = own && own.f ? own.f : T.from, t = own && own.f ? own.t : T.to;
  fillSlots($("ti-s-from")); $("ti-s-from").value = f; fillSlots($("ti-s-to"), f); $("ti-s-to").value = t;
  $("ti-st").textContent = ""; openSheet("tisheet", $("ti-s-from"));
}
$("ti-s-from").addEventListener("change", e => { const keep = $("ti-s-to").value; fillSlots($("ti-s-to"), e.target.value); $("ti-s-to").value = keep > e.target.value ? keep : $("ti-s-to").options[0].value; });
$("ti-form").addEventListener("submit", e => {
  e.preventDefault(); const T = timingOf(bk()), f = $("ti-s-from").value, t = $("ti-s-to").value;
  if (!(t > f)) { $("ti-st").textContent = "The end time has to be after the start time."; return; }
  tiTarget.forEach(id => T.times[id] = { f, t }); saveTiming(bk()); ticked.clear(); closeSheet(); renderTimingControls(); renderTable();
  toast(tiTarget.length === 1 ? `Set to ${slotLabel(f, t)}.` : `Set ${tiTarget.length} students to ${slotLabel(f, t)}.`);
});
$("ti-default").onclick = () => { const T = timingOf(bk()); tiTarget.forEach(id => delete T.times[id]); saveTiming(bk()); ticked.clear(); closeSheet(); renderTimingControls(); renderTable(); };
$("ti-sel").onclick = () => { if (ticked.size) openTiming([...ticked]); };
$("tablewrap").addEventListener("click", e => { const b = e.target.closest("[data-time]"); if (b) openTiming([b.dataset.time]); });
$("tablewrap").addEventListener("change", e => {
  const c = e.target.closest("[data-tick]"); if (!c) return;
  c.checked ? ticked.add(c.dataset.tick) : ticked.delete(c.dataset.tick); renderTimingControls();
});
