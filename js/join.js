// QR sign-up page for IDPT Sports and every other event. The event comes from ?e=slug (no slug means IDPT).
const EVENT = (new URLSearchParams(location.search).get("e") || "idpt").toLowerCase();
let KIND = "idpt";
const show = (id, on) => { $(id).hidden = !on; };
function say(text) { $("msg").textContent = text; show("msg", !!text); }

async function start() {
  if (!LIVE_READY) { say("Sign-ups aren't set up yet. Ask a core member at the desk."); return; }
  try {
    const info = await rpc("ev_join_info", { p_event: EVENT });
    if (!info.exists) { say("This sign-up link isn't valid. Ask a core member for the right QR code."); return; }
    KIND = info.kind;
    document.title = `${info.name} Sign-up`;
    $("j-eyebrow").textContent = info.name;
    $("j-title").textContent = KIND === "idpt" ? "Player sign-up" : "Sign-up";
    $("j-sub").textContent = `Fill in your details once. Core will check them at the desk and add you to the ${info.name} attendance list.`;
    $("j-sec-label").textContent = KIND === "idpt" ? "Sport / event" : "Team / role (optional)";
    if (!info.open) { say("Sign-ups are closed right now. Ask a core member at the desk to add you."); return; }
    $("j-secs").innerHTML = (info.sections || []).filter(s => !/captain/i.test(s)).map(s => `<option value="${esc(s)}"></option>`).join("");
    $("j-sec").value = store.get("join.lastsec." + EVENT, "");
    show("jf", true);
  } catch (e) { say("Couldn't connect. Check your internet and reload this page."); }
}

$("j-sap").addEventListener("input", () => {
  const el = $("j-sap"); el.value = el.value.replace(/\D/g, "").slice(0, 11);
  const b = branchFromSap(el.value), y = yearFromSap(el.value);
  if (b && !$("j-branch").dataset.touched) $("j-branch").value = b;
  if (y && !$("j-year").dataset.touched) $("j-year").value = y;
});
$("j-branch").addEventListener("change", () => $("j-branch").dataset.touched = "1");
$("j-year").addEventListener("change", () => $("j-year").dataset.touched = "1");

const MSG = {
  duplicate: "This SAP ID is already signed up. If that's wrong, tell a core member at the desk.",
  closed: "Sign-ups just closed. Ask a core member at the desk to add you.",
  busy: "Lots of people are signing up right now. Wait a few seconds and tap Sign up again.",
  full: "The sign-up list is full for now. Ask a core member at the desk.",
  invalid: "Some details don't look right. Check the SAP ID, branch, year and sport.",
};
$("jf").addEventListener("submit", async e => {
  e.preventDefault();
  const v = { name: niceName($("j-name").value), sap: $("j-sap").value, branch: $("j-branch").value, year: $("j-year").value,
    roll: niceRoll($("j-roll").value), div: clean($("j-div").value).toUpperCase(), sec: clean($("j-sec").value) };
  const st = $("j-st");
  if (v.name.length < 2) { st.textContent = "Enter your full name."; return $("j-name").focus(); }
  if (!/^\d{11}$/.test(v.sap)) { st.textContent = "Your SAP ID should be 11 digits."; return $("j-sap").focus(); }
  if (!v.branch) { st.textContent = "Pick your branch."; return $("j-branch").focus(); }
  if (!v.year) { st.textContent = "Pick your year."; return $("j-year").focus(); }
  if (!v.sec && KIND === "idpt") { st.textContent = "Enter the sport or event you're playing."; return $("j-sec").focus(); }
  $("j-go").disabled = true; st.textContent = "Signing you up…";
  try {
    const r = await rpc("ev_join", { p_event: EVENT, p_name: v.name, p_sap: v.sap, p_branch: v.branch, p_year: v.year, p_roll: v.roll, p_division: v.div, p_section: v.sec });
    if (r.status === "ok") {
      store.set("join.lastsec." + EVENT, v.sec);
      $("d-name").textContent = v.name;
      $("d-meta").textContent = [v.branch, v.roll, v.div, v.year, v.sap, v.sec].filter(Boolean).join(" · ");
      st.textContent = ""; show("jf", false); show("done", true); scrollTo(0, 0);
    } else st.textContent = MSG[r.status] || "Something went wrong. Try again.";
  } catch (err) { st.textContent = "Couldn't connect, so you're not signed up yet. Check your internet and try again."; }
  finally { $("j-go").disabled = false; }
});

$("again").onclick = () => {
  ["j-name", "j-sap", "j-roll", "j-div"].forEach(i => $(i).value = "");
  $("j-branch").value = ""; $("j-year").value = "";
  delete $("j-branch").dataset.touched; delete $("j-year").dataset.touched;
  show("done", false); show("jf", true); $("j-name").focus();
};

start();
