/* =========================================================
   CHRONO · Alarm Engine
   - Ringtone library (presets + IndexedDB uploads)
   - Reminder tick loop
   - Alarm tick loop + full-screen scene
   - Web Audio playback, Vibration, Notifications, Wake Lock
   ========================================================= */

const CHR = window.CHR = window.CHR || {};

// ------- Vibration patterns -------
CHR.VIB_PATTERNS = {
  off:       null,
  pulse:     [0, 400, 200, 400, 200, 400],
  wave:      [0, 200, 100, 400, 100, 600, 100, 400],
  heartbeat: [0, 120, 80, 200, 400, 120, 80, 200, 400],
};

// ------- Ringtone presets (synthesized on demand — no external files) -------
CHR.PRESETS = [
  { id: "sunrise", name: "Sunrise",  hz: 660, kind: "chime", dur: 12 },
  { id: "neon",    name: "Neon",     hz: 880, kind: "beep",  dur: 12 },
  { id: "chime",   name: "Chime",    hz: 523, kind: "chime", dur: 12 },
  { id: "classic", name: "Classic",  hz: 440, kind: "beep",  dur: 12 },
];

// ==================== IndexedDB (uploaded audio) ====================
const DB_NAME = "chrono-audio";
const DB_STORE = "files";

CHR.db = {
  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },
  async put(record) {
    const db = await this._open();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = () => res(record);
      tx.onerror    = () => rej(tx.error);
    });
  },
  async getAll() {
    const db = await this._open();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  },
  async get(id) {
    const db = await this._open();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => rej(req.error);
    });
  },
  async del(id) {
    const db = await this._open();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  },
};

// ==================== Audio playback ====================
CHR.audio = (() => {
  let ctx = null;
  let currentEl = null;      // HTMLAudioElement for uploaded files
  let currentOsc = null;     // Preset synthesis handle {stop}
  let previewEl = null;
  let previewTimer = null;

  function _ctx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Synthesize a preset alarm using WebAudio (endlessly loopable)
  function _playPreset(preset, { volume = 0.8, loop = true } = {}) {
    const c = _ctx();
    const master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);

    // Fade in
    master.gain.linearRampToValueAtTime(volume, c.currentTime + 0.4);

    let stopped = false;
    let timers = [];

    function scheduleBeep(t, freq, dur) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = preset.kind === "chime" ? "sine" : "triangle";
      osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain).connect(master);
      gain.gain.linearRampToValueAtTime(0.9, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    function scheduleCycle(baseT) {
      if (preset.kind === "chime") {
        // Ascending three-note chime
        scheduleBeep(baseT + 0.0, preset.hz,        0.55);
        scheduleBeep(baseT + 0.35, preset.hz * 1.25, 0.55);
        scheduleBeep(baseT + 0.7, preset.hz * 1.5,   0.7);
      } else {
        // Two quick beeps
        scheduleBeep(baseT + 0.0, preset.hz, 0.22);
        scheduleBeep(baseT + 0.3, preset.hz, 0.22);
        scheduleBeep(baseT + 0.7, preset.hz * 1.1, 0.28);
      }
    }

    function tick() {
      if (stopped) return;
      const t = c.currentTime + 0.05;
      scheduleCycle(t);
      timers.push(setTimeout(tick, 1600));
    }
    tick();

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        timers.forEach(clearTimeout);
        try { master.gain.cancelScheduledValues(c.currentTime); } catch {}
        try { master.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.15); } catch {}
        setTimeout(() => { try { master.disconnect(); } catch {} }, 250);
      },
    };
  }

  async function _resolveRingtone(ringtoneId) {
    // Preset?
    const preset = CHR.PRESETS.find(p => p.id === ringtoneId);
    if (preset) return { kind: "preset", preset };
    // Uploaded?
    const rec = await CHR.db.get(ringtoneId);
    if (rec) return { kind: "file", rec };
    // Fallback to first preset
    return { kind: "preset", preset: CHR.PRESETS[0] };
  }

  async function play(ringtoneId, { volume = 0.8, loop = true } = {}) {
    stop();
    const r = await _resolveRingtone(ringtoneId);
    if (r.kind === "preset") {
      currentOsc = _playPreset(r.preset, { volume, loop });
    } else {
      const url = URL.createObjectURL(r.rec.blob);
      currentEl = new Audio(url);
      currentEl.loop = loop;
      currentEl.volume = volume;
      try { await currentEl.play(); } catch (e) {
        // Autoplay blocked in browser — fall back to preset chime
        currentOsc = _playPreset(CHR.PRESETS[0], { volume, loop });
      }
    }
  }

  function stop() {
    if (currentEl) {
      try { currentEl.pause(); currentEl.src = ""; } catch {}
      currentEl = null;
    }
    if (currentOsc) {
      try { currentOsc.stop(); } catch {}
      currentOsc = null;
    }
  }

  // Preview (max 8s, doesn't fight main alarm)
  async function preview(ringtoneId) {
    stopPreview();
    const r = await _resolveRingtone(ringtoneId);
    if (r.kind === "preset") {
      const handle = _playPreset(r.preset, { volume: 0.6, loop: true });
      previewTimer = setTimeout(() => { handle.stop(); previewEl = null; }, 4000);
      previewEl = { stop: handle.stop };
    } else {
      const url = URL.createObjectURL(r.rec.blob);
      const el = new Audio(url);
      el.volume = 0.7;
      try { await el.play(); previewEl = el;
        previewTimer = setTimeout(() => stopPreview(), 4500);
      } catch { /* ignore */ }
    }
  }

  function stopPreview() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (previewEl) {
      try { previewEl.stop ? previewEl.stop() : (previewEl.pause(), previewEl.src = ""); } catch {}
      previewEl = null;
    }
  }

  // Unlock audio on any user gesture (mobile browsers require this)
  function unlock() {
    try { _ctx(); } catch {}
  }

  return { play, stop, preview, stopPreview, unlock, _ctx };
})();

// ==================== Vibration ====================
CHR.vibrate = (pattern) => {
  if (!("vibrate" in navigator)) return;
  const pat = CHR.VIB_PATTERNS[pattern];
  if (!pat) { navigator.vibrate(0); return; }
  navigator.vibrate(pat);
};
CHR.vibrateStop = () => { try { navigator.vibrate(0); } catch {} };

// ==================== Notifications ====================
CHR.notify = {
  async askPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied")  return "denied";
    return await Notification.requestPermission();
  },
  fire(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, {
        body, tag: "chrono-" + Date.now(),
        icon: "icon-192.png",
        badge: "icon-192.png",
        silent: false,
      });
    } catch {}
  },
};

// ==================== Wake Lock (keeps screen on when alarm rings) ====================
CHR.wake = (() => {
  let lock = null;
  return {
    async acquire() {
      if (!("wakeLock" in navigator)) return;
      try { lock = await navigator.wakeLock.request("screen"); } catch {}
    },
    async release() {
      try { await lock?.release(); } catch {}
      lock = null;
    },
  };
})();

// ==================== Reminder + Alarm scheduling ====================
CHR.scheduler = (() => {
  const fired = new Set();        // "taskId:reminder:YYYY-MM-DD" or "...:alarm:..."
  let tickHandle = null;

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function markKey(taskId, kind) { return `${taskId}:${kind}:${todayKey()}`; }

  function shouldFireToday(task) {
    // Repeat rules: repeat_days = [] means fire today only (one-shot).
    //               non-empty means fire on those weekdays (0=Sun ... 6=Sat)
    const days = task.alarm?.repeat_days || [];
    if (days.length === 0) return true;
    const dow = new Date().getDay();
    return days.includes(dow);
  }

  function mins(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function tick(getTasks) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowSec = now.getSeconds();

    getTasks().forEach(task => {
      const a = task.alarm; if (!a) return;
      const startMin = mins(task.startTime);

      // REMINDER
      if (a.reminder_enabled && shouldFireToday(task)) {
        const fireMin = startMin - (a.reminder_offset_min || 10);
        const key = markKey(task.id, "reminder");
        if (nowMin === fireMin && !fired.has(key)) {
          fired.add(key);
          CHR.reminderFired?.(task);
        }
      }

      // ALARM
      if (a.alarm_enabled && shouldFireToday(task)) {
        const key = markKey(task.id, "alarm");
        if (nowMin === startMin && nowSec < 5 && !fired.has(key)) {
          fired.add(key);
          CHR.alarmFired?.(task);
        }
      }
    });
  }

  function start(getTasks) {
    stop();
    tickHandle = setInterval(() => tick(getTasks), 1000);
  }
  function stop() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }
  function forgetToday(taskId, kind) { fired.delete(markKey(taskId, kind)); }

  return { start, stop, forgetToday };
})();
