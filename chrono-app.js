/* =========================================================
   CHRONO · Unified App
   Task CRUD + Alarm/Reminder controls + Full-screen alarm
   ========================================================= */

// ------- Config (same as daily-schedule.js) -------
const START_HOUR = 6;
const END_HOUR   = 23;
const STORAGE_KEY = "chrono.schedule.v2";      // v2: tasks now include .alarm
const STORAGE_STREAK = "chrono.streak.v1";
const STORAGE_LEGACY = "chrono.schedule.v1";   // migrate from v1
const DEFAULT_RINGTONE_KEY = "chrono.defaultAlarmSong.v1";
const AUTH_USER_KEY = "chrono.auth.user";
const AUTH_LOGGED_IN = "chrono.auth.loggedIn";

const CATEGORIES = [
  { id: "focus",    label: "Focus",    color: "#00E5FF" },
  { id: "meeting",  label: "Meeting",  color: "#FF3D6E" },
  { id: "personal", label: "Personal", color: "#8A5CFF" },
  { id: "health",   label: "Health",   color: "#7CFFB2" },
  { id: "learning", label: "Learning", color: "#FFC24D" },
];
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];

const DEFAULT_ALARM = () => ({
  reminder_enabled:    true,
  reminder_offset_min: 10,
  alarm_enabled:       false,
  repeat_days:         [],           // 0..6 (Sun..Sat)
  snooze_duration_min: 9,
  vibration_pattern:   "pulse",
  volume:              80,           // 0-100
  audio_file_id:       "sunrise",    // preset id OR uploaded audio id
});

const REMINDER_OFFSETS = [5, 10, 15, 30, 60];
const VIB_OPTIONS = ["off", "pulse", "wave", "heartbeat"];
const DAY_LABELS = ["S","M","T","W","T","F","S"];

// -------- State --------
let state = {
  tasks: loadTasks(),
  view: "today",
  filterCat: "all",
  search: "",
  editingId: null,
  formCat: "focus",
  formAlarm: DEFAULT_ALARM(),
  modalTab: "task",          // "task" | "alarm"
  ringtones: [],             // presets + uploaded (populated at boot)
  activeAlarm: null,         // { task, snoozeCount } while ringing
  activeAlarmTimeout: null,
  defaultRingtone: localStorage.getItem(DEFAULT_RINGTONE_KEY) || "sunrise",
  auth: loadAuth(),
};

// ------- Storage / migration -------
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      // v2 exists but empty — fall through to return an empty schedule
    }
    // v1 → v2 migrate (only if v1 has content)
    const legacy = localStorage.getItem(STORAGE_LEGACY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const migrated = parsed.map(t => ({ ...t, alarm: DEFAULT_ALARM() }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {}
  return [];
}
function saveTasks() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks)); }

function loadAuth() {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  const user = raw ? JSON.parse(raw) : null;
  const loggedIn = localStorage.getItem(AUTH_LOGGED_IN) === "1";
  return { user, loggedIn: loggedIn && !!user };
}
function setAuthLoggedIn(value) {
  localStorage.setItem(AUTH_LOGGED_IN, value ? "1" : "0");
  state.auth.loggedIn = value;
}
function saveAuth(user) {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  setAuthLoggedIn(true);
}
function authHash(pass) {
  try { return btoa(pass); } catch { return pass; }
}
function authIsValidEmail(email) {
  return /^[^@\s]+@gmail\.com$/i.test(email.trim());
}
function showAuthOverlay(show = true) {
  const overlay = $("#authOverlay");
  if (!overlay) return;
  overlay.hidden = !show;
  document.body.style.overflow = show ? "hidden" : "";
}
function logoutUser() {
  setAuthLoggedIn(false);
  showAuthOverlay(true);
}
function authMessage(msg, type = "danger") {
  const note = $("#authNote");
  if (!note) return;
  note.textContent = msg;
  note.classList.toggle("is-danger", type === "danger");
  note.classList.toggle("is-ok", type === "ok");
}
function handleLoginSubmit(e) {
  e.preventDefault();
  const email = $("#authLoginEmail").value.trim();
  const pass = $("#authLoginPassword").value;
  if (!authIsValidEmail(email)) { authMessage("Please use a valid Gmail address."); return; }
  if (!pass || pass.length < 6) { authMessage("Password must be at least 6 characters."); return; }
  const existing = state.auth.user;
  if (!existing) { authMessage("No account found. Please register first."); return; }
  if (existing.email.toLowerCase() !== email.toLowerCase() || existing.password !== authHash(pass)) {
    authMessage("Invalid Gmail or password."); return; }
  setAuthLoggedIn(true);
  authMessage("Login successful.", "ok");
  showAuthOverlay(false);
  renderAll();
}
function handleRegisterSubmit(e) {
  e.preventDefault();
  const name = $("#authName").value.trim();
  const email = $("#authRegisterEmail").value.trim();
  const pass = $("#authRegisterPassword").value;
  const confirmPass = $("#authRegisterConfirm").value;
  if (!name) { authMessage("Please enter your full name."); return; }
  if (!authIsValidEmail(email)) { authMessage("Please use a valid Gmail address."); return; }
  if (!pass || pass.length < 6) { authMessage("Password must be at least 6 characters."); return; }
  if (pass !== confirmPass) { authMessage("Passwords do not match."); return; }
  const existing = state.auth.user;
  if (existing) { authMessage("An account already exists. Please log in."); return; }
  saveAuth({ name, email, password: authHash(pass) });
  authMessage("Registration successful. Welcome!", "ok");
  showAuthOverlay(false);
  renderAll();
}
function initAuth() {
  $("#authLoginForm")?.addEventListener("submit", handleLoginSubmit);
  $("#authRegisterForm")?.addEventListener("submit", handleRegisterSubmit);
  const tabs = $$(".auth-tab");
  const panels = $$(".auth-panel");
  tabs.forEach(tab => tab.addEventListener("click", () => {
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(panel => panel.hidden = panel.dataset.auth !== tab.dataset.auth);
  }));
  $("#authForgot")?.addEventListener("click", () => authMessage("Forgot password? Use your Gmail to re-register if needed."));
  showAuthOverlay(!state.auth.loggedIn);
}
function uid() {
  return "t_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ------- Time helpers -------
function toMinutes(hhmm) { const [h,m] = hhmm.split(":").map(Number); return h*60+m; }
function fmtHour(h) { const hour = h % 12 === 0 ? 12 : h % 12; return `${String(hour).padStart(2,"0")} ${h < 12 ? "AM" : "PM"}`; }
function nowMinutes() { const d = new Date(); return d.getHours()*60 + d.getMinutes(); }
function pad(n) { return String(n).padStart(2, "0"); }
function fmtOffset(min) {
  if (min < 60) return `${min} min`;
  return `${Math.round(min/60)} hr`;
}

// =========================================================
// RENDER
// =========================================================
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function renderHeader() {
  const d = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  $("#hdrDay").textContent = days[d.getDay()];
  $("#hdrDate").textContent = `${months[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()}`;
  $("#hdrClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderCategories() {
  const list = $("#catList");
  if (list) {
    const counts = {};
    state.tasks.forEach(t => { counts[t.category] = (counts[t.category] || 0) + 1; });
    list.innerHTML = CATEGORIES.map(c => `
      <div class="cat-row" data-cat="${c.id}">
        <span class="cat-swatch" style="background:${c.color}; color:${c.color}"></span>
        <span>${c.label}</span>
        <span class="cat-count">${counts[c.id] || 0}</span>
      </div>
    `).join("");
  }
  const row = $("#chipRow");
  row.innerHTML = `
    <button class="chip ${state.filterCat === "all" ? "is-active" : ""}" data-cat="all">All</button>
    ${CATEGORIES.map(c => `
      <button class="chip ${state.filterCat === c.id ? "is-active" : ""}" data-cat="${c.id}" style="color:${c.color}">
        <span class="chip-swatch" style="background:${c.color}"></span>
        <span style="color: var(--ink-80)">${c.label}</span>
      </button>
    `).join("")}
  `;
  row.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.filterCat = btn.dataset.cat;
      renderCategories();
      renderGrid();
    });
  });

  const picker = $("#catPicker");
  picker.innerHTML = CATEGORIES.map(c => `
    <button type="button" class="cat-opt ${state.formCat === c.id ? "is-active" : ""}" data-cat="${c.id}" style="--cat-c:${c.color}">
      <span class="dot"></span>${c.label}
    </button>
  `).join("");
  picker.querySelectorAll(".cat-opt").forEach(el => {
    el.addEventListener("click", () => { state.formCat = el.dataset.cat; renderCategories(); });
  });
}

function renderStats() {
  const visible = filteredTasks();
  const done = visible.filter(t => t.isCompleted).length;
  const total = visible.length;
  const pct = total ? Math.round(done / total * 100) : 0;

  $("#statDone").innerHTML = `${done}<span>/${total} done</span>`;
  $("#ringPct").textContent = `${pct}%`;
  const c = 2 * Math.PI * 18;
  $("#ringProgress").style.strokeDashoffset = c - (c * pct / 100);

  const mins = visible.reduce((s, t) => s + Math.max(0, toMinutes(t.endTime) - toMinutes(t.startTime)), 0);
  $("#statHours").innerHTML = `${(mins/60).toFixed(1)}<span>hrs scheduled</span>`;

  const now = nowMinutes();
  const upcoming = state.tasks
    .filter(t => !t.isCompleted && toMinutes(t.startTime) >= now)
    .sort((a,b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  $("#statNext").textContent = upcoming[0] ? `${upcoming[0].startTime} · ${upcoming[0].taskName}` : "All clear ✓";

  $("#statStreak").innerHTML = `${bumpStreak()}<span>day active</span>`;

  const navCT = $("#navCountToday"); if (navCT) navCT.textContent = state.tasks.length;
  const navCD = $("#navCountDone");  if (navCD) navCD.textContent  = state.tasks.filter(t => t.isCompleted).length;
}

function bumpStreak() {
  try {
    const today = new Date().toDateString();
    const raw = JSON.parse(localStorage.getItem(STORAGE_STREAK) || "null");
    if (!raw) { const s = { last: today, count: 1 }; localStorage.setItem(STORAGE_STREAK, JSON.stringify(s)); return 1; }
    if (raw.last === today) return raw.count;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const s = { last: today, count: raw.last === y.toDateString() ? raw.count + 1 : 1 };
    localStorage.setItem(STORAGE_STREAK, JSON.stringify(s));
    return s.count;
  } catch { return 1; }
}

function filteredTasks() {
  return state.tasks.filter(t => {
    if (state.view === "completed" && !t.isCompleted) return false;
    if (state.filterCat !== "all" && t.category !== state.filterCat) return false;
    if (state.search && !t.taskName.toLowerCase().includes(state.search.toLowerCase())) return false;
    return true;
  });
}

function renderGrid() {
  const grid = $("#grid");
  const HOUR_H = 70;

  let html = "";
  const now = nowMinutes();
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    const isPast = now > (h+1) * 60;
    html += `
      <div class="hour-label">${fmtHour(h)}</div>
      <div class="hour-cell ${isPast ? "is-past" : ""}" data-hour="${h}"></div>
    `;
  }
  grid.innerHTML = html;

  if (now >= START_HOUR * 60 && now <= (END_HOUR + 1) * 60) {
    const offsetMin = now - START_HOUR * 60;
    const y = (offsetMin / 60) * HOUR_H;
    const nowLine = document.createElement("div");
    nowLine.className = "now-line";
    nowLine.style.top = `${y}px`;
    grid.appendChild(nowLine);
  }

  const tasks = filteredTasks();
  $("#gridEmpty").hidden = tasks.length !== 0;

  tasks.forEach(t => {
    const cat = catById(t.category);
    const startMin = toMinutes(t.startTime);
    const endMin = toMinutes(t.endTime);
    if (endMin <= startMin) return;

    const visStart = Math.max(startMin, START_HOUR * 60);
    const visEnd   = Math.min(endMin, (END_HOUR + 1) * 60);
    if (visEnd <= visStart) return;

    const offset = visStart - START_HOUR * 60;
    const dur = visEnd - visStart;
    const top = (offset / 60) * HOUR_H;
    const height = Math.max(38, (dur / 60) * HOUR_H - 4);

    const alarm = t.alarm || DEFAULT_ALARM();
    const badges = `
      <div class="task-badges">
        ${alarm.reminder_enabled ? `<div class="tb reminder" title="Reminder ${alarm.reminder_offset_min}m before">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 0 1-6 0v-1"/></svg>
        </div>` : ""}
        ${alarm.alarm_enabled ? `<div class="tb alarm" title="Alarm at start">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>
        </div>` : ""}
      </div>
    `;

    const el = document.createElement("div");
    el.className = `task ${t.isCompleted ? "is-done" : ""}`;
    el.style.setProperty("--cat-color", cat.color);
    el.style.height = `${height}px`;
    el.dataset.id = t.id;
    el.innerHTML = `
      <div class="task-check" title="Toggle complete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m5 12 5 5L20 7"/></svg>
      </div>
      <div class="task-main">
        <div class="task-name">${escapeHtml(t.taskName)}</div>
        <div class="task-meta">
          <span>${t.startTime}–${t.endTime}</span>
          <span>·</span>
          <span class="cat-tag">${cat.label}</span>
        </div>
      </div>
      ${badges}
    `;
    const startHour = Math.floor(visStart / 60);
    const cell = grid.querySelector(`.hour-cell[data-hour="${startHour}"]`);
    if (cell) {
      const cellTop = (startHour - START_HOUR) * HOUR_H;
      el.style.top = `${top - cellTop}px`;
      el.style.left = "8px"; el.style.right = "8px";
      cell.appendChild(el);
    } else {
      grid.appendChild(el);
    }

    el.addEventListener("click", (e) => {
      if (e.target.closest(".task-check")) toggleTask(t.id);
      else openModal(t.id);
    });
  });

  $("#nowLabel").textContent = `Now · ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function renderAll() {
  renderHeader();
  renderCategories();
  renderStats();
  renderGrid();
  renderAlarmPage();
}

// =========================================================
// Alarm page

function renderAlarmPage() {
  const showing = state.view === "alarm";
  const gridWrap = $("#gridWrap");
  const alarmPage = $("#alarmPage");
  if (gridWrap) gridWrap.hidden = showing;
  if (alarmPage) alarmPage.hidden = !showing;
  if (!showing) return;
  renderAlarmPicks();
  renderAlarmLibrary();
  setDefaultRingtoneLabel();
}

function setDefaultRingtone(id) {
  state.defaultRingtone = id;
  localStorage.setItem(DEFAULT_RINGTONE_KEY, id);
  setDefaultRingtoneLabel();
}

function formatRingtoneName(id) {
  const found = state.ringtones.find(r => r.id === id);
  return found ? found.name : "Sunrise";
}

function setDefaultRingtoneLabel() {
  const label = $("#alarmDefaultLabel");
  if (!label) return;
  label.textContent = `Default ringtone for new alarms · ${formatRingtoneName(state.defaultRingtone)}`;
}

function renderAlarmPicks() {
  const picks = [];
  const pool = state.ringtones.slice();
  while (picks.length < 3 && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  const container = $("#alarmPicks");
  if (!container) return;
  container.innerHTML = picks.map(r => {
    const selected = state.defaultRingtone === r.id ? "is-active" : "";
    const durLbl = r.duration ? `0:${String(Math.round(r.duration)).padStart(2,"0")}` : "";
    const meta = r.kind === "preset" ? `Preset · ${durLbl}` : `Uploaded · ${(r.size/1024/1024).toFixed(1)} MB`;
    return `
      <div class="alarm-pick ${selected}" data-id="${r.id}">
        <div class="alarm-pick-head">
          <div>
            <div class="alarm-pick-name">${escapeHtml(r.name)}</div>
            <div class="alarm-pick-meta">${meta}</div>
          </div>
          <button type="button" class="ring-play" data-play="${r.id}" aria-label="Preview tone">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
        <button type="button" class="alarm-select" data-id="${r.id}">Set as default</button>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".alarm-select").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      setDefaultRingtone(id);
      renderAlarmPicks();
      renderAlarmLibrary();
    });
  });
  container.querySelectorAll("[data-play]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      CHR.audio.unlock();
      const id = btn.dataset.play;
      const playing = btn.classList.contains("is-playing");
      container.querySelectorAll("[data-play]").forEach(x => x.classList.remove("is-playing"));
      CHR.audio.stopPreview();
      if (!playing) {
        btn.classList.add("is-playing");
        await CHR.audio.preview(id);
        setTimeout(() => btn.classList.remove("is-playing"), 4500);
      }
    });
  });
}

function renderAlarmLibrary() {
  const list = $("#alarmRingList");
  if (!list) return;
  const selectedId = state.defaultRingtone;
  list.innerHTML = state.ringtones.map(r => {
    const durLbl = r.duration ? `0:${String(Math.round(r.duration)).padStart(2,"0")}` : "";
    const meta = r.kind === "preset" ? `Preset · ${durLbl}` : `Uploaded · ${(r.size/1024/1024).toFixed(1)} MB`;
    return `
      <div class="ring-item ${selectedId === r.id ? "is-active" : ""}" data-id="${r.id}">
        <button type="button" class="ring-play" data-play="${r.id}" aria-label="Preview">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="ring-body">
          <div class="ring-name">${escapeHtml(r.name)}</div>
          <div class="ring-meta">${meta}</div>
        </div>
        <button type="button" class="ring-select" data-select="${r.id}">Use</button>
        ${r.kind === "file" ? `<button type="button" class="ring-del" data-del="${r.id}" aria-label="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"/></svg></button>` : ""}
        <div class="ring-check"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m5 12 5 5L20 7"/></svg></div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".ring-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-play]") || e.target.closest("[data-del]") || e.target.closest("[data-select]")) return;
      const id = el.dataset.id;
      setDefaultRingtone(id);
      renderAlarmLibrary();
      renderAlarmPicks();
    });
  });
  list.querySelectorAll("[data-select]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.select;
      setDefaultRingtone(id);
      renderAlarmLibrary();
      renderAlarmPicks();
    });
  });
  list.querySelectorAll("[data-play]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      CHR.audio.unlock();
      const id = btn.dataset.play;
      const playing = btn.classList.contains("is-playing");
      list.querySelectorAll("[data-play]").forEach(x => x.classList.remove("is-playing"));
      CHR.audio.stopPreview();
      if (!playing) {
        btn.classList.add("is-playing");
        await CHR.audio.preview(id);
        setTimeout(() => btn.classList.remove("is-playing"), 4500);
      }
    });
  });
  list.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm("Delete this ringtone?")) return;
      await CHR.db.del(id);
      if (state.defaultRingtone === id) setDefaultRingtone("sunrise");
      if (state.formAlarm.audio_file_id === id) state.formAlarm.audio_file_id = "sunrise";
      await loadRingtones();
      renderAlarmLibrary();
      renderAlarmPicks();
      toast("Ringtone deleted", "danger");
    });
  });
}

function sampleRingtones(count) {
  const pool = state.ringtones.slice();
  const picks = [];
  while (picks.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

// =========================================================
// CRUD
// =========================================================
function addTask(data) {
  const task = {
    id: uid(),
    taskName: data.taskName.trim(),
    startTime: data.startTime,
    endTime: data.endTime,
    category: data.category,
    notes: (data.notes || "").trim(),
    isCompleted: false,
    createdAt: new Date().toISOString(),
    alarm: data.alarm || DEFAULT_ALARM(),
  };
  state.tasks.push(task);
  saveTasks();
  renderAll();
  toast(`Added "${task.taskName}"`);
}
function updateTask(id, data) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  Object.assign(t, {
    taskName: data.taskName.trim(),
    startTime: data.startTime,
    endTime: data.endTime,
    category: data.category,
    notes: (data.notes || "").trim(),
    alarm: data.alarm || t.alarm || DEFAULT_ALARM(),
  });
  saveTasks();
  renderAll();
  toast(`Updated "${t.taskName}"`);
}
function deleteTask(id) {
  const t = state.tasks.find(x => x.id === id);
  state.tasks = state.tasks.filter(x => x.id !== id);
  saveTasks();
  renderAll();
  toast(`Deleted "${t?.taskName || "task"}"`, "danger");
}
function toggleTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.isCompleted = !t.isCompleted;
  saveTasks();
  renderAll();
}

// =========================================================
// MODAL — Task pane + Alarm pane
// =========================================================
function openModal(id = null) {
  state.editingId = id;
  const modal = $("#modal");
  const isEdit = !!id;

  $("#modalMode").textContent = isEdit ? "EDIT TASK" : "NEW TASK";
  $("#modalTitle").textContent = isEdit ? "Update this block" : "Block a time slot";
  $("#btnSaveLabel").textContent = isEdit ? "Save changes" : "Add to Schedule";
  $("#btnDelete").hidden = !isEdit;

  if (isEdit) {
    const t = state.tasks.find(x => x.id === id);
    $("#fTask").value  = t.taskName;
    $("#fStart").value = t.startTime;
    $("#fEnd").value   = t.endTime;
    $("#fNotes").value = t.notes || "";
    state.formCat = t.category;
    state.formAlarm = { ...DEFAULT_ALARM(), ...(t.alarm || {}) };
  } else {
    $("#fTask").value  = "";
    const now = new Date();
    const nextHour = (now.getHours() + 1) % 24;
    $("#fStart").value = `${pad(nextHour)}:00`;
    $("#fEnd").value   = `${pad((nextHour + 1) % 24)}:00`;
    $("#fNotes").value = "";
    state.formCat = "focus";
    state.formAlarm = { ...DEFAULT_ALARM(), audio_file_id: state.defaultRingtone };
  }
  state.modalTab = "task";
  renderCategories();
  renderModalTabs();
  renderAlarmPane();

  modal.hidden = false;
  // Focus first field on desktop only (avoid mobile keyboard blocking sheet)
  if (window.matchMedia("(min-width: 821px)").matches) {
    setTimeout(() => $("#fTask").focus(), 100);
  }
}
function closeModal() {
  $("#modal").hidden = true;
  state.editingId = null;
  CHR.audio.stopPreview();
}

function renderModalTabs() {
  $$(".modal-tab").forEach(tab => {
    const active = tab.dataset.tab === state.modalTab;
    tab.classList.toggle("is-active", active);
  });
  $$(".modal-pane").forEach(pane => {
    pane.classList.toggle("is-active", pane.dataset.pane === state.modalTab);
  });
  // Alarm tab badge — show if any alarm feature enabled
  const a = state.formAlarm;
  const enabled = a.reminder_enabled || a.alarm_enabled;
  const badge = $("#alarmTabBadge");
  if (badge) badge.hidden = !enabled;
}

function renderAlarmPane() {
  const a = state.formAlarm;

  // Reminder toggle
  $("#swReminder").classList.toggle("is-on", a.reminder_enabled);

  // Reminder offset segmented
  const seg = $("#reminderSeg");
  seg.innerHTML = REMINDER_OFFSETS.map(m =>
    `<button type="button" class="seg-opt ${a.reminder_offset_min === m ? "is-active" : ""}" data-off="${m}">${m}m</button>`
  ).join("");
  seg.querySelectorAll(".seg-opt").forEach(el => {
    el.addEventListener("click", () => {
      state.formAlarm.reminder_offset_min = Number(el.dataset.off);
      renderAlarmPane();
    });
  });

  // "Fires at" computed
  const start = $("#fStart").value || "09:00";
  const fireMin = Math.max(0, toMinutes(start) - a.reminder_offset_min);
  $("#reminderFireAt").textContent = `${pad(Math.floor(fireMin/60))}:${pad(fireMin%60)}`;

  // Alarm toggle
  $("#swAlarm").classList.toggle("is-on", a.alarm_enabled);

  // Repeat days
  const days = $("#daysRow");
  days.innerHTML = DAY_LABELS.map((lbl, i) =>
    `<button type="button" class="day-pill ${a.repeat_days.includes(i) ? "is-on" : ""}" data-day="${i}">${lbl}</button>`
  ).join("");
  days.querySelectorAll(".day-pill").forEach(el => {
    el.addEventListener("click", () => {
      const d = Number(el.dataset.day);
      const arr = state.formAlarm.repeat_days;
      const idx = arr.indexOf(d);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(d);
      arr.sort();
      renderAlarmPane();
    });
  });

  // Snooze segmented
  const snoozeSeg = $("#snoozeSeg");
  const SNOOZE_OPTS = [1, 5, 9, 15, 30];
  snoozeSeg.innerHTML = SNOOZE_OPTS.map(m =>
    `<button type="button" class="seg-opt ${a.snooze_duration_min === m ? "is-active" : ""}" data-snooze="${m}">${m}m</button>`
  ).join("");
  snoozeSeg.querySelectorAll(".seg-opt").forEach(el => {
    el.addEventListener("click", () => {
      state.formAlarm.snooze_duration_min = Number(el.dataset.snooze);
      renderAlarmPane();
    });
  });

  // Vibration
  const vib = $("#vibRow");
  vib.innerHTML = VIB_OPTIONS.map(v =>
    `<button type="button" class="vib-opt ${a.vibration_pattern === v ? "is-active" : ""}" data-vib="${v}">${v}</button>`
  ).join("");
  vib.querySelectorAll(".vib-opt").forEach(el => {
    el.addEventListener("click", () => {
      state.formAlarm.vibration_pattern = el.dataset.vib;
      CHR.vibrate(el.dataset.vib);   // preview
      renderAlarmPane();
    });
  });

  // Volume
  const vol = $("#volSlider");
  vol.value = a.volume;
  vol.style.setProperty("--val", `${a.volume}%`);
  $("#volLabel").textContent = `${a.volume}%`;

  // Ringtone list
  renderRingList();
}

async function loadRingtones() {
  const uploaded = await CHR.db.getAll();
  state.ringtones = [
    ...CHR.PRESETS.map(p => ({ ...p, id: p.id, name: p.name, kind: "preset", duration: 12 })),
    ...uploaded.map(u => ({
      id: u.id, name: u.name, kind: "file",
      size: u.size, duration: u.duration || null,
    })),
  ];
}

function renderRingList() {
  const list = $("#ringList");
  const selectedId = state.formAlarm.audio_file_id;
  list.innerHTML = state.ringtones.map(r => {
    const durLbl = r.duration ? `0:${String(Math.round(r.duration)).padStart(2,"0")}` : "";
    const meta = r.kind === "preset" ? `Preset · ${durLbl}` : `Uploaded · ${(r.size/1024/1024).toFixed(1)} MB`;
    return `
      <div class="ring-item ${selectedId === r.id ? "is-active" : ""}" data-id="${r.id}">
        <button type="button" class="ring-play" data-play="${r.id}" aria-label="Preview">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="ring-body">
          <div class="ring-name">${escapeHtml(r.name)}</div>
          <div class="ring-meta">${meta}</div>
        </div>
        ${r.kind === "file" ? `<button type="button" class="ring-del" data-del="${r.id}" aria-label="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"/></svg></button>` : ""}
        <div class="ring-check"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m5 12 5 5L20 7"/></svg></div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".ring-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-play]") || e.target.closest("[data-del]")) return;
      state.formAlarm.audio_file_id = el.dataset.id;
      renderRingList();
    });
  });
  list.querySelectorAll("[data-play]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      CHR.audio.unlock();
      const id = btn.dataset.play;
      // Toggle: if this one already playing, stop
      const alreadyPlaying = btn.classList.contains("is-playing");
      list.querySelectorAll("[data-play]").forEach(b => b.classList.remove("is-playing"));
      CHR.audio.stopPreview();
      if (!alreadyPlaying) {
        btn.classList.add("is-playing");
        await CHR.audio.preview(id);
        setTimeout(() => btn.classList.remove("is-playing"), 4500);
      }
    });
  });
  list.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm("Delete this ringtone?")) return;
      await CHR.db.del(id);
      // Any alarm using it falls back
      state.tasks.forEach(t => { if (t.alarm?.audio_file_id === id) t.alarm.audio_file_id = "sunrise"; });
      saveTasks();
      if (state.formAlarm.audio_file_id === id) state.formAlarm.audio_file_id = "sunrise";
      await loadRingtones();
      renderRingList();
      toast("Ringtone deleted", "danger");
    });
  });
}

async function handleUpload(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast("File too large (max 10 MB)", "danger"); return; }
  const okTypes = ["audio/mpeg","audio/mp3","audio/wav","audio/aac","audio/mp4","audio/x-m4a","audio/m4a","audio/ogg"];
  if (file.type && !okTypes.some(t => file.type.includes(t.split("/")[1]))) {
    // Some browsers report "" for m4a — accept anyway if extension matches
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["mp3","wav","aac","m4a","ogg"].includes(ext)) {
      toast("Unsupported audio format", "danger"); return;
    }
  }
  // Show progress
  const bar = $("#uploadProgress");
  bar.hidden = false;
  const inner = bar.querySelector("div");
  inner.style.width = "10%";
  await new Promise(r => setTimeout(r, 120));
  inner.style.width = "60%";

  // Probe duration
  let duration = null;
  try {
    const url = URL.createObjectURL(file);
    duration = await new Promise((res) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => res(a.duration || null);
      a.onerror = () => res(null);
      a.src = url;
      setTimeout(() => res(null), 2500);
    });
    URL.revokeObjectURL(url);
  } catch {}

  const rec = {
    id: "aud_" + Math.random().toString(36).slice(2,10),
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 60),
    blob: file,
    mime: file.type || "audio/mpeg",
    size: file.size,
    duration,
    createdAt: new Date().toISOString(),
  };
  await CHR.db.put(rec);
  inner.style.width = "100%";
  setTimeout(() => { bar.hidden = true; inner.style.width = "0%"; }, 400);
  await loadRingtones();
  state.formAlarm.audio_file_id = rec.id;
  renderRingList();
  if (setDefault) {
    setDefaultRingtone(rec.id);
    renderAlarmLibrary();
    renderAlarmPicks();
  }
  toast(`Uploaded "${rec.name}"`);
}

// =========================================================
// TOAST
// =========================================================
let toastTimer;
function toast(msg, variant = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("is-danger", variant === "danger");
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("is-show");
    setTimeout(() => { el.hidden = true; }, 300);
  }, 2200);
}

// =========================================================
// REMINDER + ALARM HANDLERS (wired to CHR.scheduler)
// =========================================================
CHR.reminderFired = function (task) {
  // Soft notification banner + OS notification + short vibration
  showReminderBanner(task);
  CHR.notify.fire(
    `⏰ ${task.taskName}`,
    `Starts at ${task.startTime} · ${fmtOffset(task.alarm.reminder_offset_min)} from now`
  );
  navigator.vibrate?.([120, 80, 120]);
};

CHR.alarmFired = function (task) {
  openAlarmScene(task);
};

function showReminderBanner(task) {
  const el = $("#reminderBanner");
  $("#rbTitle").textContent = task.taskName;
  $("#rbSub").textContent = `Starts at ${task.startTime} · in ${task.alarm.reminder_offset_min} min`;
  el.classList.add("is-show");
  setTimeout(() => el.classList.remove("is-show"), 8000);
}

// =========================================================
// FULL-SCREEN ALARM SCENE
// =========================================================
async function openAlarmScene(task) {
  state.activeAlarm = { task, snoozeCount: 0 };
  const scene = $("#alarmScene");
  $("#alarmTitle").textContent = task.taskName;
  $("#alarmSub").textContent = `Scheduled ${task.startTime} · ${catById(task.category).label}`;
  updateAlarmClock();
  scene.classList.add("is-active");

  // Audio + vibrate + wake lock
  CHR.audio.unlock();
  await CHR.audio.play(task.alarm.audio_file_id, { volume: task.alarm.volume / 100, loop: true });
  CHR.vibrate(task.alarm.vibration_pattern);
  CHR.wake.acquire();

  // OS notification too (in case tab is not focused)
  CHR.notify.fire(`⏰ ${task.taskName}`, `Time to start · tap to open`);

  // Auto-stop after 5 min
  if (state.activeAlarmTimeout) clearTimeout(state.activeAlarmTimeout);
  state.activeAlarmTimeout = setTimeout(() => {
    if (state.activeAlarm?.task.id === task.id) closeAlarmScene("auto");
  }, 5 * 60 * 1000);
}

function updateAlarmClock() {
  const d = new Date();
  const el = $("#alarmClock");
  if (el) el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dl = $("#alarmDate");
  if (dl) {
    const days = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    dl.textContent = `${days[d.getDay()]} · ${pad(d.getDate())} ${["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getMonth()]}`;
  }
}

function snoozeAlarm() {
  const a = state.activeAlarm; if (!a) return;
  const m = a.task.alarm.snooze_duration_min;
  toast(`Snoozed ${m} min`);
  closeAlarmScene("snooze");
  // Re-arm after N minutes
  setTimeout(() => { openAlarmScene(a.task); }, m * 60 * 1000);
}

function stopAlarm() {
  closeAlarmScene("stop");
}

function closeAlarmScene(reason) {
  const scene = $("#alarmScene");
  scene.classList.remove("is-active");
  CHR.audio.stop();
  CHR.vibrateStop();
  CHR.wake.release();
  if (state.activeAlarmTimeout) { clearTimeout(state.activeAlarmTimeout); state.activeAlarmTimeout = null; }
  if (reason === "stop" || reason === "auto") state.activeAlarm = null;
}

// =========================================================
// EVENTS
// =========================================================
function bindEvents() {
  initAuth();
  // Open modal (desktop + mobile FAB)
  $("#btnNew")?.addEventListener("click", () => openModal());
  $("#bnNew")?.addEventListener("click", () => openModal());

  // Close modal
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("#alarmScene").classList.contains("is-active")) return; // don't close alarm with Esc
      if (!$("#modal").hidden) closeModal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#searchInput").focus(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && $("#modal").hidden) { e.preventDefault(); openModal(); }
  });

  // Modal tabs
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".modal-tab");
    if (!tab) return;
    state.modalTab = tab.dataset.tab;
    renderModalTabs();
  });

  // Start time change → recompute reminder "fires at"
  $("#fStart").addEventListener("change", () => {
    if (state.modalTab === "alarm") renderAlarmPane();
  });

  // Toggles
  $("#swReminder").addEventListener("click", () => {
    state.formAlarm.reminder_enabled = !state.formAlarm.reminder_enabled;
    renderAlarmPane(); renderModalTabs();
  });
  $("#swAlarm").addEventListener("click", async () => {
    state.formAlarm.alarm_enabled = !state.formAlarm.alarm_enabled;
    if (state.formAlarm.alarm_enabled) {
      // Ask for permission at the moment we need it
      await CHR.notify.askPermission();
    }
    renderAlarmPane(); renderModalTabs();
  });

  // Volume slider
  $("#volSlider").addEventListener("input", (e) => {
    state.formAlarm.volume = Number(e.target.value);
    e.target.style.setProperty("--val", `${e.target.value}%`);
    $("#volLabel").textContent = `${e.target.value}%`;
  });

  // File upload
  $("#uploadInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await handleUpload(file);
  });
  $("#btnShuffleRings").addEventListener("click", () => {
    renderAlarmPicks();
  });
  $("#alarmUploadInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await handleUpload(file, true);
  });
  // Drop file directly on the label (mobile taps still work via the label)
  const drop = $("#uploadLabel");
  ["dragover","dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.style.background = "rgba(0,229,255,0.1)"; }));
  ["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.style.background = ""; }));
  drop.addEventListener("drop", async e => {
    const file = e.dataTransfer?.files?.[0]; if (file) await handleUpload(file);
  });
  const alarmDrop = $("#alarmUploadLabel");
  ["dragover","dragenter"].forEach(ev => alarmDrop.addEventListener(ev, e => { e.preventDefault(); alarmDrop.style.background = "rgba(0,229,255,0.1)"; }));
  ["dragleave","drop"].forEach(ev => alarmDrop.addEventListener(ev, e => { e.preventDefault(); alarmDrop.style.background = ""; }));
  alarmDrop.addEventListener("drop", async e => {
    const file = e.dataTransfer?.files?.[0]; if (file) await handleUpload(file, true);
  });

  // Form submit
  $("#taskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {
      taskName: $("#fTask").value,
      startTime: $("#fStart").value,
      endTime: $("#fEnd").value,
      category: state.formCat,
      notes: $("#fNotes").value,
      alarm: { ...state.formAlarm },
    };
    if (!data.taskName.trim()) return;
    if (toMinutes(data.endTime) <= toMinutes(data.startTime)) {
      toast("End time must be after start time", "danger"); return;
    }
    if (state.editingId) updateTask(state.editingId, data);
    else addTask(data);
    closeModal();
  });

  // Delete
  $("#btnDelete").addEventListener("click", () => {
    if (state.editingId && confirm("Delete this task?")) {
      deleteTask(state.editingId);
      closeModal();
    }
  });

  // Reset schedule
  $("#btnClearAll")?.addEventListener("click", () => {
    if (!confirm("Reset the schedule and delete all tasks?")) return;
    state.tasks = []; saveTasks(); renderAll();
    toast("Schedule cleared", "danger");
  });

  // Search
  $("#searchInput").addEventListener("input", (e) => {
    state.search = e.target.value; renderGrid();
  });

  // Sidebar nav (desktop)
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach(x => x.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.view = btn.dataset.view;
      if (state.view === "completed") state.filterCat = "all";
      renderGrid(); renderStats(); renderAlarmPage();
    });
  });

  // Bottom-nav (mobile)
  document.querySelectorAll(".bn-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".bn-item").forEach(x => x.classList.remove("is-active"));
      btn.classList.add("is-active");
      const v = btn.dataset.view;
      state.view = v === "focus" ? "today" : v;
      if (v === "focus") { state.filterCat = "focus"; }
      else if (v === "completed") state.filterCat = "all";
      else state.filterCat = "all";
      renderCategories(); renderGrid(); renderStats(); renderAlarmPage();
    });
  });

  // Sidebar cat click
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".cat-row");
    if (row) {
      state.filterCat = state.filterCat === row.dataset.cat ? "all" : row.dataset.cat;
      renderCategories(); renderGrid();
    }
  });

  // Logout
  $("#btnLogout")?.addEventListener("click", () => {
    if (confirm("Logout and lock the app?")) logoutUser();
  });

  // Full-screen alarm buttons
  $("#alarmSnooze").addEventListener("click", snoozeAlarm);
  $("#alarmStop").addEventListener("click", stopAlarm);

  // Reminder banner close
  $("#rbClose").addEventListener("click", () => {
    $("#reminderBanner").classList.remove("is-show");
  });

  // Unlock audio on first interaction (mobile Safari)
  const unlockOnce = () => { CHR.audio.unlock(); document.removeEventListener("touchstart", unlockOnce); document.removeEventListener("click", unlockOnce); };
  document.addEventListener("touchstart", unlockOnce, { once: true, passive: true });
  document.addEventListener("click", unlockOnce, { once: true });

  // Install banner
  wireInstallBanner();
}

// =========================================================
// PWA — install prompt & service worker
// =========================================================
let deferredPrompt = null;
function wireInstallBanner() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const s = $("#installStrip");
    // Only show if user hasn't dismissed today
    if (localStorage.getItem("chrono.installDismissed") === todayStr()) return;
    s.classList.add("is-show");
  });
  $("#installBtn")?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("#installStrip").classList.remove("is-show");
  });
  $("#installX")?.addEventListener("click", () => {
    localStorage.setItem("chrono.installDismissed", todayStr());
    $("#installStrip").classList.remove("is-show");
  });
}
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("sw.js"); } catch {}
}

// =========================================================
// BOOT
// =========================================================
async function boot() {
  await loadRingtones();
  bindEvents();
  renderAll();

  // Live clock + hourly grid refresh
  setInterval(() => {
    renderHeader();
    if (state.activeAlarm) updateAlarmClock();
  }, 1000);
  setInterval(() => { renderGrid(); renderStats(); }, 30000);

  // Kick the alarm/reminder scheduler
  CHR.scheduler.start(() => state.tasks);

  // Register SW (best-effort — silent fail if origin doesn't allow)
  registerServiceWorker();
}
boot();
