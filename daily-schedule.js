/* =========================================================
   CHRONO · Daily Schedule — Vanilla JS
   ========================================================= */

// -------- Config --------
const START_HOUR = 6;   // 06:00
const END_HOUR   = 23;  // 23:00 (last row shown)
const STORAGE_KEY = "chrono.schedule.v1";
const STORAGE_STREAK = "chrono.streak.v1";

const CATEGORIES = [
  { id: "focus",    label: "Focus",    color: "#00E5FF" },
  { id: "meeting",  label: "Meeting",  color: "#FF3D6E" },
  { id: "personal", label: "Personal", color: "#8A5CFF" },
  { id: "health",   label: "Health",   color: "#7CFFB2" },
  { id: "learning", label: "Learning", color: "#FFC24D" },
];

const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];

// -------- State --------
let state = {
  tasks: loadTasks(),
  view: "today",       // today | upcoming | completed
  filterCat: "all",    // "all" | category id
  search: "",
  editingId: null,
  formCat: "focus",
};

// -------- Storage --------
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedDemoTasks();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : seedDemoTasks();
  } catch { return seedDemoTasks(); }
}
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}
function seedDemoTasks() {
  // First-time demo content so the UI isn't empty
  const demo = [
    { id: uid(), taskName: "Morning stretch & coffee",  startTime: "07:00", endTime: "07:30", category: "health",   notes: "", isCompleted: true  },
    { id: uid(), taskName: "Deep work — API refactor",  startTime: "09:00", endTime: "11:00", category: "focus",    notes: "Ship auth endpoints", isCompleted: false },
    { id: uid(), taskName: "Design review w/ Priya",    startTime: "11:30", endTime: "12:15", category: "meeting",  notes: "", isCompleted: false },
    { id: uid(), taskName: "Lunch + walk",              startTime: "12:30", endTime: "13:30", category: "personal", notes: "", isCompleted: false },
    { id: uid(), taskName: "Study — Systems design",    startTime: "15:00", endTime: "16:00", category: "learning", notes: "", isCompleted: false },
    { id: uid(), taskName: "Gym session",               startTime: "18:00", endTime: "19:00", category: "health",   notes: "", isCompleted: false },
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
  return demo;
}
function uid() {
  return "t_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// -------- Time helpers --------
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fmtHour(h) {
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour).padStart(2,"0")} ${h < 12 ? "AM" : "PM"}`;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function pad(n) { return String(n).padStart(2, "0"); }

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
  // Sidebar cat list
  const list = $("#catList");
  const counts = countByCategory();
  list.innerHTML = CATEGORIES.map(c => `
    <div class="cat-row" data-cat="${c.id}">
      <span class="cat-swatch" style="background:${c.color}; color:${c.color}"></span>
      <span>${c.label}</span>
      <span class="cat-count">${counts[c.id] || 0}</span>
    </div>
  `).join("");

  // Chip row (with All + each category)
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

  // Modal cat picker
  const picker = $("#catPicker");
  picker.innerHTML = CATEGORIES.map(c => `
    <button type="button" class="cat-opt ${state.formCat === c.id ? "is-active" : ""}" data-cat="${c.id}" style="--cat-c:${c.color}">
      <span class="dot"></span>${c.label}
    </button>
  `).join("");
  picker.querySelectorAll(".cat-opt").forEach(el => {
    el.addEventListener("click", () => {
      state.formCat = el.dataset.cat;
      renderCategories();
    });
  });
}

function countByCategory() {
  const out = {};
  state.tasks.forEach(t => { out[t.category] = (out[t.category] || 0) + 1; });
  return out;
}

function renderStats() {
  const visible = filteredTasks();
  const done = visible.filter(t => t.isCompleted).length;
  const total = visible.length;
  const pct = total ? Math.round(done / total * 100) : 0;

  $("#statDone").innerHTML = `${done}<span>/${total} done</span>`;
  $("#ringPct").textContent = `${pct}%`;
  const c = 2 * Math.PI * 18; // 113.1
  $("#ringProgress").style.strokeDashoffset = c - (c * pct / 100);

  // Hours scheduled
  const mins = visible.reduce((sum, t) => sum + Math.max(0, toMinutes(t.endTime) - toMinutes(t.startTime)), 0);
  $("#statHours").innerHTML = `${(mins/60).toFixed(1)}<span>hrs scheduled</span>`;

  // Next up
  const now = nowMinutes();
  const upcoming = state.tasks
    .filter(t => !t.isCompleted && toMinutes(t.startTime) >= now)
    .sort((a,b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  if (upcoming[0]) {
    $("#statNext").textContent = `${upcoming[0].startTime} · ${upcoming[0].taskName}`;
  } else {
    $("#statNext").textContent = "All clear ✓";
  }

  // Streak
  $("#statStreak").innerHTML = `${bumpStreak()}<span>day active</span>`;

  // Nav counts
  $("#navCountToday").textContent = state.tasks.length;
  $("#navCountDone").textContent  = state.tasks.filter(t => t.isCompleted).length;
}

function bumpStreak() {
  try {
    const today = new Date().toDateString();
    const raw = JSON.parse(localStorage.getItem(STORAGE_STREAK) || "null");
    if (!raw) {
      const s = { last: today, count: 1 };
      localStorage.setItem(STORAGE_STREAK, JSON.stringify(s));
      return 1;
    }
    if (raw.last === today) return raw.count;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const wasYesterday = raw.last === y.toDateString();
    const s = { last: today, count: wasYesterday ? raw.count + 1 : 1 };
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
  const totalHours = END_HOUR - START_HOUR + 1;

  // Build hour rows
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

  // Now line
  if (now >= START_HOUR * 60 && now <= (END_HOUR + 1) * 60) {
    const offsetMin = now - START_HOUR * 60;
    const y = (offsetMin / 60) * HOUR_H;
    const nowLine = document.createElement("div");
    nowLine.className = "now-line";
    nowLine.style.top = `${y}px`;
    grid.appendChild(nowLine);
  }

  // Place tasks
  const tasks = filteredTasks();
  $("#gridEmpty").hidden = tasks.length !== 0;

  tasks.forEach(t => {
    const cat = catById(t.category);
    const startMin = toMinutes(t.startTime);
    const endMin = toMinutes(t.endTime);
    if (endMin <= startMin) return;

    // Clamp to visible range
    const visStart = Math.max(startMin, START_HOUR * 60);
    const visEnd   = Math.min(endMin, (END_HOUR + 1) * 60);
    if (visEnd <= visStart) return;

    const offset = visStart - START_HOUR * 60;
    const dur = visEnd - visStart;
    const top = (offset / 60) * HOUR_H;
    const height = Math.max(38, (dur / 60) * HOUR_H - 4);

    const el = document.createElement("div");
    el.className = `task ${t.isCompleted ? "is-done" : ""}`;
    el.style.setProperty("--cat-color", cat.color);
    el.style.top = `${top}px`;
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
    `;
    // Position over the first hour-cell it starts in
    const startHour = Math.floor(visStart / 60);
    const cell = grid.querySelector(`.hour-cell[data-hour="${startHour}"]`);
    if (cell) {
      // Convert absolute top for the cell coord system: subtract cell top
      const cellTop = (startHour - START_HOUR) * HOUR_H;
      el.style.top = `${top - cellTop}px`;
      el.style.left = "8px";
      el.style.right = "8px";
      cell.appendChild(el);
    } else {
      grid.appendChild(el);
    }

    el.addEventListener("click", (e) => {
      if (e.target.closest(".task-check")) {
        toggleTask(t.id);
      } else {
        openModal(t.id);
      }
    });
  });

  // Now label
  $("#nowLabel").textContent = `Now · ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function renderAll() {
  renderHeader();
  renderCategories();
  renderStats();
  renderGrid();
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
// MODAL
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
  } else {
    $("#fTask").value  = "";
    const now = new Date();
    const nextHour = (now.getHours() + 1) % 24;
    $("#fStart").value = `${pad(nextHour)}:00`;
    $("#fEnd").value   = `${pad((nextHour + 1) % 24)}:00`;
    $("#fNotes").value = "";
    state.formCat = "focus";
  }
  renderCategories();

  modal.hidden = false;
  setTimeout(() => $("#fTask").focus(), 100);
}
function closeModal() {
  $("#modal").hidden = true;
  state.editingId = null;
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
// EVENTS
// =========================================================
function bindEvents() {
  // Open modal
  $("#btnNew").addEventListener("click", () => openModal());

  // Close modal
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal").hidden) closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#searchInput").focus();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && $("#modal").hidden) {
      e.preventDefault();
      openModal();
    }
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
    };
    if (!data.taskName.trim()) return;
    if (toMinutes(data.endTime) <= toMinutes(data.startTime)) {
      toast("End time must be after start time", "danger");
      return;
    }
    if (state.editingId) {
      updateTask(state.editingId, data);
    } else {
      addTask(data);
    }
    closeModal();
  });

  // Delete
  $("#btnDelete").addEventListener("click", () => {
    if (state.editingId) {
      deleteTask(state.editingId);
      closeModal();
    }
  });

  // Reset schedule
  $("#btnClearAll").addEventListener("click", () => {
    if (!confirm("Reset the schedule and delete all tasks?")) return;
    state.tasks = [];
    saveTasks();
    renderAll();
    toast("Schedule cleared", "danger");
  });

  // Search
  $("#searchInput").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderGrid();
  });

  // Sidebar nav
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach(x => x.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.view = btn.dataset.view;
      if (state.view === "completed") state.filterCat = "all";
      renderGrid();
      renderStats();
    });
  });

  // Sidebar categories click → set filter
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".cat-row");
    if (row) {
      state.filterCat = state.filterCat === row.dataset.cat ? "all" : row.dataset.cat;
      renderCategories();
      renderGrid();
    }
  });
}

// =========================================================
// BOOT
// =========================================================
function boot() {
  bindEvents();
  renderAll();
  // Tick clock + now-line
  setInterval(() => {
    renderHeader();
    // update now line every 30s
  }, 1000);
  setInterval(() => {
    renderGrid();
    renderStats();
  }, 30000);
}
boot();
