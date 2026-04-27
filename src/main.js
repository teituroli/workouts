import "./style.css";
import * as XLSX from "xlsx";
import { DB, hashPw } from "./db.js";
import {
  DAY_ABBR,
  toIso,
  todayIso,
  weekDays,
  weekLabel,
  esc,
  fmtKr,
} from "./utils.js";

// ─── STATE ───────────────────────────────────────────────────────
let S = {
  authed: localStorage.getItem("gf_authed") === "1",
  authMode: "checking",
  page: "board",
  colleagues: [],
  citations: [],
  workouts: [],
  weekOffset: 0,
  histFilter: "all",
  toast: null,
  modal: null,
  loading: true,
};
let toastTimer = null;

function toast(msg, type = "red") {
  S.toast = { msg, type };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    render();
  }, 2600);
  render();
}

// ─── HELPERS ─────────────────────────────────────────────────────
function totalDebt(cid) {
  return S.citations
    .filter((c) => c.colleague_id === cid)
    .reduce((s, c) => s + c.amount, 0);
}

// A "week log" is one row in workout_logs per week (we store the Monday date as the key)
function mondayOf(offset = 0) {
  return weekDays(offset)[0];
}
function weekLog(cid, offset = 0) {
  return (
    S.workouts.find(
      (w) => w.colleague_id === cid && w.date === mondayOf(offset),
    ) ?? null
  );
}
function weekPassed(cid, offset = 0) {
  return !!weekLog(cid, offset);
}
function weekFined(cid, offset = 0) {
  const mon = mondayOf(offset);
  return (
    S.citations.find((c) => c.colleague_id === cid && c.week_start === mon) ??
    null
  );
}
function cardStatus(cid, offset = 0) {
  if (weekPassed(cid, offset)) return "ok";
  if (weekFined(cid, offset)) return "danger";
  return "partial"; // not yet marked
}

// ─── RENDER ──────────────────────────────────────────────────────
function render() {
  const app = document.getElementById("app");
  if (!S.authed) {
    app.innerHTML = renderAuth();
    bindAuth();
    return;
  }
  if (S.loading) {
    app.innerHTML = `<div class="screen"><div class="screen-logo">GYM<em>FINE</em></div><div class="screen-sub">Loading…</div></div>`;
    return;
  }

  let h = `
  <div class="header">
    <div class="logo">GYM<em>FINE</em></div>
    <nav class="nav">
      <button class="nav-btn ${S.page === "board" ? "active" : ""}" onclick="goPage('board')">Board</button>
      <button class="nav-btn ${S.page === "history" ? "active" : ""}" onclick="goPage('history')">History</button>
      <button class="nav-btn ${S.page === "admin" ? "active" : ""}" onclick="goPage('admin')">Admin</button>
    </nav>
    <button class="btn btn-ghost btn-sm" onclick="logout()">Sign out</button>
  </div>
  <div class="main">`;

  if (S.page === "board") h += renderBoard();
  if (S.page === "history") h += renderHistory();
  if (S.page === "admin") h += renderAdmin();

  h += `</div>`;
  if (S.modal) h += renderModal();
  if (S.toast)
    h += `<div class="toast ${S.toast.type === "green" ? "tg" : ""}"><div class="tdot"></div>${S.toast.msg}</div>`;
  app.innerHTML = h;
  bindKeys();
}

// ─── AUTH ─────────────────────────────────────────────────────────
function renderAuth() {
  if (S.authMode === "checking")
    return `<div class="screen"><div class="screen-logo">GYM<em>FINE</em></div></div>`;
  return `
  <div class="screen">
    <div style="text-align:center">
      <div class="screen-logo">GYM<em>FINE</em></div>
      <div class="screen-sub" style="margin-top:8px">${S.authMode === "setup" ? "First time setup" : "Workout citation tracker"}</div>
    </div>
    <div class="auth-card">
      ${S.authMode === "setup" ? `<div class="auth-hint">Set a shared password your whole team can use to log in.</div>` : ""}
      <div><label class="auth-lbl">${S.authMode === "setup" ? "New password" : "Password"}</label>
        <input class="auth-inp" id="pw1" type="password" placeholder="••••••••"/></div>
      ${S.authMode === "setup" ? `<div><label class="auth-lbl">Confirm password</label><input class="auth-inp" id="pw2" type="password" placeholder="••••••••"/></div>` : ""}
      <div id="auth-err" class="auth-err"></div>
      <button class="btn btn-red" id="auth-btn" style="width:100%">${S.authMode === "login" ? "Enter" : "Set Password & Continue"}</button>
    </div>
  </div>`;
}

function bindAuth() {
  const btn = document.getElementById("auth-btn"),
    p1 = document.getElementById("pw1"),
    p2 = document.getElementById("pw2"),
    errEl = document.getElementById("auth-err");
  if (!btn) return;
  const doLogin = async () => {
    if (!p1.value) {
      errEl.textContent = "Enter the password.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "…";
    const h = await hashPw(p1.value),
      stored = await DB.getPw();
    if (h === stored) {
      localStorage.setItem("gf_authed", "1");
      S.authed = true;
      await loadData();
    } else {
      errEl.textContent = "Wrong password.";
      btn.disabled = false;
      btn.textContent = "Enter";
    }
  };
  const doSetup = async () => {
    if (!p1.value) {
      errEl.textContent = "Password cannot be empty.";
      return;
    }
    if (p1.value !== p2?.value) {
      errEl.textContent = "Passwords don't match.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "…";
    await DB.setPw(await hashPw(p1.value));
    localStorage.setItem("gf_authed", "1");
    S.authed = true;
    await loadData();
  };
  btn.onclick = S.authMode === "login" ? doLogin : doSetup;
  p1.onkeydown = (e) => {
    if (e.key === "Enter") (S.authMode === "login" ? doLogin : doSetup)();
  };
  if (p2)
    p2.onkeydown = (e) => {
      if (e.key === "Enter") doSetup();
    };
}

// ─── BOARD ────────────────────────────────────────────────────────
// ─── BOARD ────────────────────────────────────────────────────────
function renderBoard() {
  const totalDebtAll = S.colleagues.reduce((s, c) => s + totalDebt(c.id), 0);
  const totalCit = S.citations.length;
  const unmarked = S.colleagues.filter(
    (c) => !weekPassed(c.id, S.weekOffset) && !weekFined(c.id, S.weekOffset),
  ).length;
  const richest = S.colleagues.reduce(
    (b, c) => (totalDebt(c.id) > totalDebt(b?.id ?? "") ? c : b),
    S.colleagues[0],
  );

  return `
  <div class="page-hdr">
    <div class="page-title">THE <em>BOARD</em></div>
  </div>
  <div class="stats-bar">
    <div class="stat-box"><div class="stat-val">${fmtKr(totalDebtAll)} kr</div><div class="stat-lbl">Lifetime debt</div></div>
    <div class="stat-box"><div class="stat-val amber">${totalCit}</div><div class="stat-lbl">Citations total</div></div>
    <div class="stat-box"><div class="stat-val ${unmarked === 0 ? "green" : ""}">${unmarked}</div><div class="stat-lbl">Unmarked this week</div></div>
    <div class="stat-box"><div class="stat-val" style="font-size:${richest ? "20px" : "32px"};padding-top:${richest ? "6px" : "0"};color:var(--red)">${richest ? esc(richest.name.split(" ")[0]) : "—"}</div><div class="stat-lbl">Most indebted</div></div>
  </div>
  <div class="week-nav">
    <button class="btn btn-ghost btn-sm" onclick="setWeek(${S.weekOffset - 1})">← Prev week</button>
    <span class="week-label">${S.weekOffset === 0 ? "This week" : S.weekOffset === -1 ? "Last week" : `${Math.abs(S.weekOffset)} weeks ago`} &nbsp;·&nbsp; <span style="color:var(--muted2)">${weekLabel(S.weekOffset)}</span></span>
    <button class="btn btn-ghost btn-sm" ${S.weekOffset === 0 ? "disabled" : ""} onclick="setWeek(${S.weekOffset + 1})">Next week →</button>
  </div>
  ${
    S.colleagues.length === 0
      ? `<div class="empty">No colleagues yet. Go to Admin to add them.</div>`
      : `
      <div class="workout-rows">
        ${S.colleagues.map(renderRow).join("")}
      </div>`
  }`;
}

function renderRow(c) {
  const debt = totalDebt(c.id);
  const passed = weekPassed(c.id, S.weekOffset);
  const fined = weekFined(c.id, S.weekOffset);
  const st = cardStatus(c.id, S.weekOffset);
  const mon = mondayOf(S.weekOffset);

  let statusHTML, actionsHTML;

  if (passed) {
    statusHTML = `<span class="status ok">✓ Passed</span>`;
    actionsHTML = `
      <button class="log-btn small" onclick="undoPass('${c.id}','${mon}')">Undo pass</button>`;
  } else if (fined) {
    statusHTML = `<span class="status danger">✗ Fined · ${fmtKr(fined.amount)} kr</span>`;
    actionsHTML = `
      <button class="fine-btn small" onclick="undoFine('${fined.id}','${c.id}','${mon}')">Undo fine</button>`;
  } else {
    statusHTML = `<span class="status partial">Unmarked</span>`;
    actionsHTML = `
      <button class="log-btn" onclick="markPassed('${c.id}','${mon}')">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6l3 3 6-5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Passed
      </button>
      <button class="fine-btn" onclick="markFined('${c.id}','${mon}')">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        Fine · ${c.citation_amount} kr
      </button>`;
  }

  return `
  <div class="workout-row ${st}" id="row-${c.id}">
    <div class="row-main">
      <div class="row-avatar">${c.name[0].toUpperCase()}</div>
      <div class="row-info">
        <div class="c-name">${esc(c.name)}</div>
        <div class="c-meta">${c.citation_amount} kr per fine</div>
      </div>

      <div class="row-debt">
        <div class="num ${debt === 0 ? "dim" : "red"}" id="debt-${c.id}">
          ${fmtKr(debt)}<span class="kr"> kr</span>
        </div>
        <div class="num-lbl">Lifetime debt</div>
      </div>

      <div class="row-status">
        ${statusHTML}
      </div>
    </div>

    <div class="row-actions">
      ${actionsHTML}
      <button class="list-btn" onclick="openList('${c.id}')" title="View citation history">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3.5l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>`;
}

// ─── HISTORY ─────────────────────────────────────────────────────
function renderHistory() {
  const src =
    S.histFilter === "all"
      ? S.citations
      : S.citations.filter((c) => c.colleague_id === S.histFilter);
  const sorted = [...src].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );
  return `
  <div class="page-hdr">
    <div class="page-title">CITATION <em>HISTORY</em></div>
    <button class="btn btn-ghost btn-sm" onclick="exportXLSX()">↓ Export XLSX</button>
  </div>
  <div class="filters">
    <div class="fpill ${S.histFilter === "all" ? "active" : ""}" onclick="setFilter('all')">All</div>
    ${S.colleagues.map((c) => `<div class="fpill ${S.histFilter === c.id ? "active" : ""}" onclick="setFilter('${c.id}')">${esc(c.name.split(" ")[0])}</div>`).join("")}
  </div>
  <div class="section" style="padding:0">
    <table class="tbl">
      <thead><tr><th>Date</th><th>Colleague</th><th>Amount</th><th>Note</th><th></th></tr></thead>
      <tbody>
      ${
        sorted.length === 0
          ? `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:48px">No citations yet.</td></tr>`
          : sorted
              .map((ci) => {
                const c = S.colleagues.find((x) => x.id === ci.colleague_id);
                return `<tr>
            <td class="mono" style="font-size:11px;color:var(--muted)">${new Date(ci.created_at).toLocaleDateString("da-DK")}</td>
            <td style="font-weight:700">${esc(c?.name ?? "—")}</td>
            <td class="mono" style="color:var(--red)">+${fmtKr(ci.amount)} kr</td>
            <td style="color:var(--muted);font-size:13px">${ci.note ? esc(ci.note) : "—"}</td>
            <td><button class="btn btn-ghost btn-xs" style="color:#e05c6b" onclick="delCit('${ci.id}')">Remove</button></td>
          </tr>`;
              })
              .join("")
      }
      </tbody>
    </table>
  </div>`;
}

// ─── ADMIN ────────────────────────────────────────────────────────
function renderAdmin() {
  return `
  <div class="page-hdr"><div class="page-title">ADMIN <em>PANEL</em></div></div>
  <div class="section">
    <div class="sec-title">Add Colleague</div>
    <div class="frow">
      <div class="field" style="flex:2"><label>Name</label><input id="n-name" type="text" placeholder="Jane Doe"/></div>
      <div class="field" style="max-width:130px"><label>Workouts/week</label><input id="n-wk" type="number" min="1" max="14" value="3"/></div>
      <div class="field" style="max-width:130px"><label>Fine (kr)</label><input id="n-amt" type="number" min="1" value="25"/></div>
      <button class="btn btn-red" onclick="doAddColleague()" style="align-self:flex-end">Add</button>
    </div>
  </div>
  <div class="section" style="padding:0">
    <div style="padding:20px 24px 0"><div class="sec-title" style="margin-bottom:0">Colleagues</div></div>
    <table class="tbl">
      <thead><tr><th>Name</th><th>Workouts/week</th><th>Fine (kr)</th><th>Lifetime debt</th><th>Citations</th><th></th></tr></thead>
      <tbody>
      ${
        S.colleagues.length === 0
          ? `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:48px">No colleagues yet.</td></tr>`
          : S.colleagues
              .map(
                (c) => `<tr>
          <td style="font-weight:700">${esc(c.name)}</td>
          <td><input type="number" min="1" max="14" value="${c.workouts_per_week}" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:5px 8px;font-family:var(--sans);font-size:13px;outline:none;width:70px" onchange="patchC('${c.id}','workouts_per_week',this.value)"/></td>
          <td><input type="number" min="1" value="${c.citation_amount}" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:5px 8px;font-family:var(--sans);font-size:13px;outline:none;width:80px" onchange="patchC('${c.id}','citation_amount',this.value)"/></td>
          <td class="mono" style="color:var(--red)">${fmtKr(totalDebt(c.id))} kr</td>
          <td class="mono" style="color:var(--muted)">${S.citations.filter((x) => x.colleague_id === c.id).length}</td>
          <td><button class="btn btn-ghost btn-xs" style="color:#e05c6b" onclick="doRemoveC('${c.id}')">Remove</button></td>
        </tr>`,
              )
              .join("")
      }
      </tbody>
    </table>
  </div>`;
}

// ─── MODAL ────────────────────────────────────────────────────────
function renderModal() {
  const m = S.modal;
  if (m.type === "list") {
    const c = S.colleagues.find((x) => x.id === m.cid);
    const cits = S.citations.filter((x) => x.colleague_id === m.cid);
    const weeksFined = new Set(cits.map((ci) => ci.week_start).filter(Boolean))
      .size;
    return `
    <div class="overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal wide">
        <button class="modal-x" onclick="closeModal()">✕</button>
        <div class="modal-title">${esc(c?.name ?? "")} — Overview</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          <div style="background:var(--surface2);border-radius:8px;padding:14px">
            <div style="font-family:var(--display);font-size:28px;color:var(--red)">${fmtKr(totalDebt(m.cid))} <span style="font-size:14px;font-family:var(--sans);color:var(--muted)">kr</span></div>
            <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:3px">Lifetime debt</div>
          </div>
          <div style="background:var(--surface2);border-radius:8px;padding:14px">
            <div style="font-family:var(--display);font-size:28px;color:var(--amber)">${weeksFined}</div>
            <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:3px">Weeks fined</div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:10px">Citation log</div>
        <div style="max-height:340px;overflow-y:auto">
          ${
            cits.length === 0
              ? '<div style="color:var(--muted);padding:20px 0;text-align:center">No citations yet.</div>'
              : cits
                  .map(
                    (ci) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
              <div>
                <div style="font-size:13px;font-weight:600">Week of ${ci.week_start ?? "—"}</div>
                <div class="mono" style="font-size:10px;color:var(--muted);margin-top:2px">${new Date(ci.created_at).toLocaleString("da-DK")}</div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                <span class="mono" style="color:var(--red);font-weight:700">+${fmtKr(ci.amount)} kr</span>
                <button class="btn btn-ghost btn-xs" style="color:#e05c6b" onclick="delCit('${ci.id}')">✕</button>
              </div>
            </div>`,
                  )
                  .join("")
          }
        </div>
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>`;
  }
  return "";
}

// ─── ACTIONS (exposed to window for inline onclick handlers) ──────
window.goPage = (p) => {
  S.page = p;
  render();
};
window.setWeek = (n) => {
  S.weekOffset = Math.min(0, n);
  render();
};
window.setFilter = (id) => {
  S.histFilter = id;
  render();
};
window.openList = (cid) => {
  S.modal = { type: "list", cid };
  render();
};
window.closeModal = () => {
  S.modal = null;
  render();
};
window.logout = () => {
  localStorage.removeItem("gf_authed");
  S.authed = false;
  render();
};

window.markPassed = async (cid, mon) => {
  if (weekLog(cid, S.weekOffset)) return;
  const w = await DB.addWorkout(cid, mon);
  S.workouts.unshift(w);
  toast("Marked as passed ✓", "green");
};
window.undoPass = async (cid, mon) => {
  const w = S.workouts.find((x) => x.colleague_id === cid && x.date === mon);
  if (!w) return;
  await DB.delWorkout(w.id);
  S.workouts = S.workouts.filter((x) => x.id !== w.id);
  toast("Pass removed.");
};
window.markFined = async (cid, mon) => {
  const c = S.colleagues.find((x) => x.id === cid);
  if (!c) return;
  const ci = await DB.addCitation(cid, c.citation_amount, null, mon);
  S.citations.unshift(ci);
  setTimeout(() => {
    const el = document.getElementById(`debt-${cid}`);
    if (el) {
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
    }
  }, 50);
  toast(`${c.name} fined ${c.citation_amount} kr!`);
};
window.undoFine = async (citId, cid, mon) => {
  await DB.delCitation(citId);
  S.citations = S.citations.filter((c) => c.id !== citId);
  toast("Fine removed.", "green");
  render();
};
window.rmWorkout = async (wid) => {
  await DB.delWorkout(wid);
  S.workouts = S.workouts.filter((w) => w.id !== wid);
  toast("Workout removed.");
};
window.doFine = async (cid) => {
  const note = document.getElementById("fine-note")?.value ?? "";
  const c = S.colleagues.find((x) => x.id === cid);
  if (!c) return;
  const ci = await DB.addCitation(cid, c.citation_amount, note);
  S.citations.unshift(ci);
  S.modal = null;
  toast(`Citation issued to ${c.name}!`);
  setTimeout(() => {
    const el = document.getElementById(`debt-${cid}`);
    if (el) {
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
    }
  }, 50);
};
window.doAddColleague = async () => {
  const name = document.getElementById("n-name")?.value?.trim();
  const wk = parseInt(document.getElementById("n-wk")?.value ?? "3");
  const amt = parseInt(document.getElementById("n-amt")?.value ?? "25");
  if (!name) {
    toast("Enter a name!");
    return;
  }
  const c = await DB.addColleague({
    name,
    workouts_per_week: wk,
    citation_amount: amt,
  });
  S.colleagues.push(c);
  S.colleagues.sort((a, b) => a.name.localeCompare(b.name));
  toast(`${c.name} added!`, "green");
  render();
};
window.patchC = async (id, field, val) => {
  await DB.patchColleague(id, { [field]: parseInt(val) });
  S.colleagues = S.colleagues.map((c) =>
    c.id === id ? { ...c, [field]: parseInt(val) } : c,
  );
  toast("Saved!", "green");
};
window.doRemoveC = async (id) => {
  const c = S.colleagues.find((x) => x.id === id);
  if (!confirm(`Remove ${c?.name}? Their citation history stays.`)) return;
  await DB.patchColleague(id, { deleted_at: new Date().toISOString() });
  S.colleagues = S.colleagues.filter((x) => x.id !== id);
  toast("Removed.", "green");
  render();
};
window.delCit = async (id) => {
  await DB.delCitation(id);
  S.citations = S.citations.filter((c) => c.id !== id);
  toast("Citation removed.", "green");
  render();
};
window.exportXLSX = () => {
  const rows = [["Week of", "Colleague", "Amount (kr)"]];
  [...S.citations]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((ci) => {
      const c = S.colleagues.find((x) => x.id === ci.colleague_id);
      rows.push([
        ci.week_start ?? new Date(ci.created_at).toLocaleDateString("da-DK"),
        c?.name ?? "?",
        ci.amount,
      ]);
    });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Citations");
  XLSX.writeFile(wb, `gymfine-${new Date().toISOString().slice(0, 10)}.xlsx`);
};

function bindKeys() {
  document.onkeydown = (e) => {
    if (e.key === "Escape" && S.modal) closeModal();
  };
}

// ─── INIT ─────────────────────────────────────────────────────────
async function loadData() {
  S.loading = true;
  render();
  const [colleagues, citations, workouts] = await Promise.all([
    DB.getColleagues(),
    DB.getCitations(),
    DB.getWorkouts(),
  ]);
  S.colleagues = colleagues;
  S.citations = citations;
  S.workouts = workouts;
  S.loading = false;
  render();
}

async function init() {
  if (S.authed) {
    await loadData();
  } else {
    const h = await DB.getPw();
    S.authMode = h ? "login" : "setup";
    render();
    bindAuth();
  }
}

render();
init();
