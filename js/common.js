// Shared helpers for the letter site and the QR registration page.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

// ---------- Database (Supabase REST) ----------
const CFG = window.TRINITY_CONFIG || {};
const REST = CFG.restUrl || (CFG.supabaseUrl ? CFG.supabaseUrl.replace(/\/+$/, "") + "/rest/v1" : "");
const KEY = CFG.supabaseKey || "";
const LIVE_READY = !!(REST && KEY);
function dbHeaders(extra) {
  const h = { apikey: KEY, "Content-Type": "application/json", ...extra };
  if (KEY.startsWith("eyJ")) h.Authorization = "Bearer " + KEY;
  return h;
}
async function api(path) {
  if (!LIVE_READY) throw new Error("not configured");
  const r = await fetch(REST + path, { headers: dbHeaders(), cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function rpc(fn, body) {
  if (!LIVE_READY) throw new Error("not configured");
  const r = await fetch(REST + "/rpc/" + fn, { method: "POST", headers: dbHeaders(), body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ---------- Branches, years, SAP IDs ----------
const BRANCHES = ["COMPS", "IT", "CSE-DS", "CSE-ICB", "AIML", "AIDS", "EXTC", "MECH"];
const YEARS = ["FE", "SE", "TE", "BE"];
const BRANCH_ALIASES = { comps: "COMPS", computer: "COMPS", computers: "COMPS", ce: "COMPS", it: "IT", cseds: "CSE-DS", ds: "CSE-DS",
  cseicb: "CSE-ICB", icb: "CSE-ICB", aiml: "AIML", aids: "AIDS", aianddatascience: "AIDS", extc: "EXTC", mech: "MECH", mechanical: "MECH" };
const SAP_BRANCH = { "60004": "COMPS", "60003": "IT", "60009": "CSE-DS", "60019": "CSE-ICB", "60017": "AIML", "60018": "AIDS", "60002": "EXTC", "60005": "MECH" };
function normBranch(b) {
  const k = String(b || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
  return BRANCH_ALIASES[k] || String(b || "").trim().toUpperCase();
}
function branchFromSap(sap) { return SAP_BRANCH[String(sap || "").slice(0, 5)] || ""; }
// Admission year in the SAP ID (digits 6-7). Only a starting guess: direct second-year students differ.
function yearFromSap(sap) { return ({ "23": "BE", "24": "TE", "25": "SE" })[String(sap || "").slice(5, 7)] || ""; }
function normYear(y) {
  const v = String(y || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (YEARS.includes(v)) return v;
  return ({ "1": "FE", "1ST": "FE", FIRST: "FE", FY: "FE", "2": "SE", "2ND": "SE", SECOND: "SE", SY: "SE",
    "3": "TE", "3RD": "TE", THIRD: "TE", TY: "TE", "4": "BE", "4TH": "BE", FOURTH: "BE", LY: "BE", FINAL: "BE" })[v] || "";
}
const YEAR_RANK = { BE: 0, TE: 1, SE: 2, FE: 3 };
function sortByYearBranch(list) {
  return [...list].sort((a, b) =>
    (YEAR_RANK[a.y] ?? 4) - (YEAR_RANK[b.y] ?? 4) ||
    (BRANCHES.indexOf(a.b) + 99) % 99 - (BRANCHES.indexOf(b.b) + 99) % 99 ||
    String(a.r).localeCompare(String(b.r), undefined, { numeric: true }) ||
    String(a.n).localeCompare(String(b.n)));
}

// ---------- Cleaning up names and cells ----------
const clean = s => String(s ?? "").replace(/\s+/g, " ").trim();
function niceName(n) {
  n = clean(n);
  if (n && (n === n.toLowerCase() || n === n.toUpperCase())) n = n.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
  return n.split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}
function niceRoll(r) {
  r = clean(r).toUpperCase().replace(/\s/g, "");
  const m = r.match(/^([A-Z])O(\d+)$/); // "DO44" typed with the letter O
  return m ? m[1] + "0" + m[2] : r;
}

// ---------- Reading a CSV or spreadsheet into people ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = String(text).replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADER_TESTS = {
  n: /^(student\s*)?(full\s*)?name$|^name\b/i,
  b: /branch|dept|department|course|stream/i,
  r: /roll/i,
  s: /sap|student\s*id|^id$|^id\s*no/i,
  d: /div|batch/i,
  y: /^year$|^class$|year\s*of\s*study|^yr$/i,
  t: /time|timing|slot/i,
};
// grid: array of rows (arrays of cells). Section headings are rows with only the first cell filled, in capitals.
function peopleFromGrid(grid, defaultSection) {
  grid = grid.map(r => (r || []).map(clean));
  let cols = { n: 0, b: 1, r: 2, s: 3, d: 4, y: 5, t: -1 }, hasYear = false, start = 0;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const r = grid[i]; if (!r.some(Boolean)) continue;
    if (r.some(c => HEADER_TESTS.n.test(c))) {
      const found = {};
      r.forEach((c, j) => { for (const k in HEADER_TESTS) if (found[k] == null && c && HEADER_TESTS[k].test(c)) { found[k] = j; break; } });
      cols = { n: found.n ?? 0, b: found.b ?? -1, r: found.r ?? -1, s: found.s ?? -1, d: found.d ?? -1, y: found.y ?? -1, t: found.t ?? -1 };
      hasYear = found.y != null; start = i + 1;
    }
    break;
  }
  if (start === 0) hasYear = grid.some(r => r.length > 5 && normYear(r[5]));
  const at = (r, k) => (cols[k] >= 0 ? r[cols[k]] || "" : "");
  let section = defaultSection || "", sections = [];
  const out = [], bySap = new Map(), byName = new Map(); let dupes = 0;
  for (let i = start; i < grid.length; i++) {
    const r = grid[i]; const filled = r.filter(Boolean);
    if (!filled.length) continue;
    if (filled.length === 1 && r[0] && r[0] === r[0].toUpperCase() && /[A-Z]/.test(r[0])) {
      section = r[0].replace(/:$/, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bPr\b/, "PR").replace(/\bIdpt\b/, "IDPT");
      if (!sections.includes(section)) sections.push(section);
      continue;
    }
    const name = niceName(at(r, "n")); if (!name) continue;
    const sap = clean(at(r, "s")).replace(/\s/g, "");
    const p = { section, n: name, b: normBranch(at(r, "b")), r: niceRoll(at(r, "r")), s: sap,
      d: (v => v === v.toLowerCase() ? v.toUpperCase() : v)(clean(at(r, "d"))), y: normYear(at(r, "y")), t: clean(at(r, "t")) };
    if (!p.b && sap) p.b = branchFromSap(sap);
    const key = sap || "";
    const prev = key ? bySap.get(key) : byName.get(name.toLowerCase());
    if (prev) { dupes++; for (const k of ["b", "r", "d", "y"]) if (!prev[k] && p[k]) prev[k] = p[k]; if (p.n.length > prev.n.length) prev.n = p.n; continue; }
    if (key) bySap.set(key, p); else byName.set(name.toLowerCase(), p);
    out.push(p);
  }
  out.forEach(p => { p.ok = !!(p.s && p.b); });
  if (!sections.length && out.length) sections = [...new Set(out.map(p => p.section))];
  return { people: out, sections, dupes, hasYear };
}

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxLoading ||= new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = "vendor/xlsx.mini.min.js";
    s.onload = () => ok(window.XLSX); s.onerror = () => { xlsxLoading = null; bad(new Error("xlsx")); };
    document.head.appendChild(s);
  });
}
// Returns { grid, sheet } for a CSV or Excel file.
async function readTableFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.SheetNames[0];
    return { grid: XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: "" }), sheet };
  }
  return { grid: parseCSV(await file.text()), sheet: "" };
}
