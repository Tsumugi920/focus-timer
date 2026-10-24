/* 专注时钟 · 番茄钟 + 任务清单 + 专注统计
 * 纯原生 JavaScript，无任何外部依赖；数据保存在浏览器 localStorage。
 * 结构：工具函数 → 读写与校验 → 计时器 → 任务 → 统计图表 → 设置弹窗 → 渲染与装配。
 */
(function () {
  'use strict';

  var LS_STATE = 'focusTimer.state.v1';
  var LS_STATS = 'focusTimer.stats.v1';
  var LS_TIMER = 'focusTimer.timer.v1';

  var MODES = {
    focus: { label: '专注' },
    short: { label: '短休息' },
    long: { label: '长休息' }
  };

  var DEFAULT_SETTINGS = {
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    longEvery: 4,
    autoBreak: false,
    autoFocus: false,
    sound: true,
    notify: true
  };

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function clampInt(v, min, max, fallback) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* 存储不可用时静默降级为内存态 */
    }
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMs(ms) {
    var total = Math.ceil(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  /* ---------- 状态读写（宽松校验，坏数据回退默认） ---------- */

  function loadState() {
    var data = readJSON(LS_STATE);
    var st = {
      settings: Object.assign({}, DEFAULT_SETTINGS),
      tasks: [],
      currentTaskId: null,
      cycle: 0
    };
    if (!data || typeof data !== 'object') return st;

    if (data.settings && typeof data.settings === 'object') {
      var s = data.settings;
      var d = DEFAULT_SETTINGS;
      st.settings.focusMin = clampInt(s.focusMin, 1, 180, d.focusMin);
      st.settings.shortMin = clampInt(s.shortMin, 1, 60, d.shortMin);
      st.settings.longMin = clampInt(s.longMin, 1, 90, d.longMin);
      st.settings.longEvery = clampInt(s.longEvery, 2, 8, d.longEvery);
      st.settings.autoBreak = !!s.autoBreak;
      st.settings.autoFocus = !!s.autoFocus;
      st.settings.sound = s.sound !== false;
      st.settings.notify = s.notify !== false;
    }
    if (Array.isArray(data.tasks)) {
      data.tasks.forEach(function (t) {
        if (t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim()) {
          st.tasks.push({
            id: typeof t.id === 'string' && t.id ? t.id : makeId(),
            name: t.name.trim().slice(0, 100),
            done: !!t.done,
            pomodoros: clampInt(t.pomodoros, 0, 9999, 0),
            createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now()
          });
        }
      });
    }
    st.cycle = clampInt(data.cycle, 0, 9999, 0);
    if (typeof data.currentTaskId === 'string') st.currentTaskId = data.currentTaskId;
    if (st.currentTaskId && !findTask(st.tasks, st.currentTaskId)) st.currentTaskId = null;
    return st;
  }

  function findTask(tasks, id) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
    }
    return null;
  }

  function saveState() { writeJSON(LS_STATE, state); }

  function loadStats() {
    var data = readJSON(LS_STATS);
    var out = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(function (k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && data[k] && typeof data[k] === 'object') {
          out[k] = {
            minutes: clampInt(data[k].minutes, 0, 1440, 0),
            pomodoros: clampInt(data[k].pomodoros, 0, 96, 0)
          };
        }
      });
    }
    return out;
  }

  /* ---------- 运行时状态 ---------- */

  var state = loadState();
  var S = state.settings;
  var stats = loadStats();

  function settingsFor(mode) {
    return mode === 'focus' ? S.focusMin : mode === 'short' ? S.shortMin : S.longMin;
  }
  function durationMs(mode) { return settingsFor(mode) * 60000; }

  function loadTimer() {
    var t = readJSON(LS_TIMER);
    var mode = t && MODES[t.mode] ? t.mode : 'focus';
    var total = durationMs(mode);
    var remain = t && typeof t.remainMs === 'number' && isFinite(t.remainMs)
      ? t.remainMs : total;
    remain = Math.min(Math.max(remain, 0), total);
    var running = !!(t && t.running && typeof t.endAt === 'number' && isFinite(t.endAt));
    return {
      mode: mode,
      running: running,
      endAt: running ? t.endAt : null,
      remainMs: remain,
      sessionMin: clampInt(t && t.sessionMin, 1, 180, settingsFor(mode))
    };
  }

  var timer = loadTimer();
  var titleFlashUntil = 0;

  function saveTimer() {
    writeJSON(LS_TIMER, {
      mode: timer.mode,
      running: timer.running,
      endAt: timer.endAt,
      remainMs: timer.remainMs,
      sessionMin: timer.sessionMin
    });
  }

  /* ---------- 提示音与通知（能力检测，缺失时静默跳过） ---------- */

  var audioCtx = null;

  function ensureAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    } catch (e) { /* 忽略 */ }
  }

  function playChime() {
    try {
      if (!audioCtx) ensureAudio();
      if (!audioCtx || audioCtx.state !== 'running') return;
      var t0 = audioCtx.currentTime;
      [880, 1108.73, 1318.51].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var start = t0 + i * 0.18;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.55);
      });
    } catch (e) { /* 忽略 */ }
  }

  function showNotification(title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body: body, tag: 'focus-timer' });
      }
    } catch (e) { /* 忽略 */ }
  }

  function notifyFinished(wasFocus, sessionMin) {
    var title = wasFocus ? '🍅 专注完成！' : '☕ 休息结束';
    var body = wasFocus
      ? '已完成 ' + sessionMin + ' 分钟专注，休息一下吧'
      : '精力恢复啦，开始下一轮专注吧';
    if (S.notify) showNotification(title, body);
    if (S.sound) playChime();
  }

  /* ---------- 计时器核心 ---------- */

  function remainingMs() {
    if (!timer.running) return timer.remainMs;
    return Math.max(0, timer.endAt - Date.now());
  }

  function startTimer() {
    if (timer.running) return;
    ensureAudio(); /* 借用户手势解锁音频，供结束时提示音使用 */
    if (timer.remainMs <= 0) timer.remainMs = durationMs(timer.mode);
    timer.endAt = Date.now() + timer.remainMs;
    timer.running = true;
    saveTimer();
    renderTimer();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remainMs = remainingMs();
    timer.running = false;
    timer.endAt = null;
    saveTimer();
    renderTimer();
  }

  function resetTimer() {
    timer.running = false;
    timer.endAt = null;
    timer.remainMs = durationMs(timer.mode);
    timer.sessionMin = settingsFor(timer.mode);
    saveTimer();
    renderTimer();
  }

  function switchMode(mode) {
    timer.mode = mode;
    timer.running = false;
    timer.endAt = null;
    timer.remainMs = durationMs(mode);
    timer.sessionMin = settingsFor(mode);
    saveTimer();
    renderTimer();
  }

  /* 完成一段倒计时：专注段计入统计并给关联任务 +1，然后切到下一段 */
  function completeSession() {
    var finished = timer.mode;
    var sessionMin = timer.sessionMin || settingsFor(finished);
    timer.running = false;
    timer.endAt = null;
    timer.remainMs = 0;

    var next = 'focus';
    if (finished === 'focus') {
      recordFocus(sessionMin);
      state.cycle += 1;
      next = state.cycle % Math.max(2, S.longEvery) === 0 ? 'long' : 'short';
    }

    timer.mode = next;
    timer.remainMs = durationMs(next);
    timer.sessionMin = settingsFor(next);
    saveTimer();

    notifyFinished(finished === 'focus', sessionMin);
    titleFlashUntil = Date.now() + 6000;

    var autoStart = finished === 'focus' ? S.autoBreak : S.autoFocus;
    if (autoStart) {
      timer.endAt = Date.now() + timer.remainMs;
      timer.running = true;
      saveTimer();
    }
    renderAll();
  }

  function recordFocus(minutes) {
    var key = todayKey();
    var day = stats[key] || { minutes: 0, pomodoros: 0 };
    day.minutes += minutes;
    day.pomodoros += 1;
    stats[key] = day;
    writeJSON(LS_STATS, stats);

    var task = findTask(state.tasks, state.currentTaskId);
    if (task) task.pomodoros += 1;
    saveState();
  }

  /* ---------- 任务 ---------- */

  function addTask(name) {
    var trimmed = name.trim().slice(0, 100);
    if (!trimmed) return false;
    state.tasks.unshift({
      id: makeId(),
      name: trimmed,
      done: false,
      pomodoros: 0,
      createdAt: Date.now()
    });
    saveState();
    renderTasks();
    renderTimer();
    return true;
  }

  function toggleTask(id) {
    var task = findTask(state.tasks, id);
    if (!task) return;
    task.done = !task.done;
    if (task.done && state.currentTaskId === id) state.currentTaskId = null;
    saveState();
    renderTasks();
    renderTimer();
  }

  function deleteTask(id) {
    var before = state.tasks.length;
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    if (state.tasks.length === before) return;
    if (state.currentTaskId === id) state.currentTaskId = null;
    saveState();
    renderTasks();
    renderTimer();
  }

  function toggleFocusTask(id) {
    var task = findTask(state.tasks, id);
    if (!task || task.done) return;
    state.currentTaskId = state.currentTaskId === id ? null : id;
    saveState();
    renderTasks();
    renderTimer();
  }

  /* ---------- 统计 ---------- */

  function last7() {
    var keys = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      keys.push({
        key: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        day: d.getDay(),
        label: (d.getMonth() + 1) + '/' + d.getDate()
      });
    }
    return keys;
  }

  var CHART_MAX_PX = 120;

  function renderStats() {
    var days = last7();
    var today = todayKey();
    var max = 1;
    days.forEach(function (d) {
      var v = stats[d.key];
      if (v && v.minutes > max) max = v.minutes;
    });

    var weekMin = 0, weekPomo = 0, todayMin = 0, todayPomo = 0;
    var cols = days.map(function (d) {
      var v = stats[d.key] || { minutes: 0, pomodoros: 0 };
      weekMin += v.minutes;
      weekPomo += v.pomodoros;
      if (d.key === today) { todayMin = v.minutes; todayPomo = v.pomodoros; }
      var isToday = d.key === today;
      var h = v.minutes > 0 ? Math.max(6, Math.round(v.minutes / max * CHART_MAX_PX)) : 3;
      var weekday = '周' + '日一二三四五六'.charAt(d.day);
      var tip = d.label + ' ' + weekday + '：' + v.minutes + ' 分钟 · ' + v.pomodoros + ' 番茄';
      return '<div class="col' + (isToday ? ' today' : '') + '" title="' + esc(tip) + '">' +
        '<div class="col-plot"><span class="val">' + (v.minutes > 0 ? v.minutes : '') + '</span>' +
        '<div class="bar' + (v.minutes > 0 ? '' : ' zero') + '" style="height:' + h + 'px"></div></div>' +
        '<span class="day">' + weekday + '</span><span class="date">' + esc(d.label) + '</span></div>';
    });
    $('chart').innerHTML = cols.join('');

    $('stats-summary').innerHTML =
      '今日 <b>' + todayMin + '</b> 分钟 · <b>' + todayPomo + '</b> 番茄' +
      '<span class="sep">|</span>近 7 天 <b>' + weekMin + '</b> 分钟 · <b>' + weekPomo + '</b> 番茄';
  }

  /* ---------- 渲染 ---------- */

  var lastTimeText = '';

  function renderTimer() {
    var remain = remainingMs();
    var text = fmtMs(remain);
    if (text !== lastTimeText) {
      $('time-display').textContent = text;
      lastTimeText = text;
    }

    var total = durationMs(timer.mode);
    $('ring').style.setProperty('--p', String(Math.max(0, Math.min(1, remain / total))));

    var tabs = $('mode-tabs').querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-mode') === timer.mode);
    }
    document.body.setAttribute('data-mode', timer.mode);
    $('mode-label').textContent = MODES[timer.mode].label;
    $('btn-start').textContent = timer.running ? '暂停' : '开始';

    /* 标题倒计时；结束后短暂显示完成提示 */
    var title;
    if (Date.now() < titleFlashUntil) {
      title = '🍅 专注完成！';
    } else {
      title = (timer.running ? '▶ ' : '') + text + ' · ' + MODES[timer.mode].label + ' · 专注时钟';
    }
    document.title = title;

    renderCycle();
    renderCurrentTask();
  }

  function renderCycle() {
    var every = Math.max(2, S.longEvery);
    var cycle = state.cycle;
    var filled = cycle === 0 ? 0 : (cycle % every === 0 ? every : cycle % every);
    var html = '';
    for (var i = 0; i < every; i++) {
      html += '<span class="dot' + (i < filled ? ' filled' : '') + '"></span>';
    }
    $('cycle-dots').innerHTML = html;
  }

  function renderCurrentTask() {
    var task = findTask(state.tasks, state.currentTaskId);
    var el = $('current-task');
    if (task) {
      el.innerHTML = '<span class="tag">正在专注</span> ' + esc(task.name);
      el.classList.add('linked');
    } else {
      el.textContent = '未选择专注任务，可在任务清单点「专注」关联';
      el.classList.remove('linked');
    }
  }

  function renderTasks() {
    var list = $('task-list');
    list.innerHTML = state.tasks.map(function (t) {
      var cls = 'task-item' + (t.done ? ' done' : '');
      var focusLabel = state.currentTaskId === t.id ? '专注中' : '专注';
      return '<li class="' + cls + '" data-id="' + esc(t.id) + '">' +
        '<input type="checkbox" class="task-toggle"' + (t.done ? ' checked' : '') +
        ' aria-label="完成 ' + esc(t.name) + '" />' +
        '<span class="task-name">' + esc(t.name) + '</span>' +
        '<span class="task-count" title="累计完成番茄数">🍅 ' + t.pomodoros + '</span>' +
        '<button type="button" class="task-btn focus-btn' +
        (state.currentTaskId === t.id ? ' current' : '') + '"' +
        (t.done ? ' disabled' : '') + ' data-action="focus">✔ ' + focusLabel + '</button>' +
        '<button type="button" class="task-btn del-btn" data-action="del"' +
        ' aria-label="删除 ' + esc(t.name) + '">✕</button>' +
        '</li>';
    }).join('');
    $('task-empty').hidden = state.tasks.length > 0;
  }

  function renderAll() {
    renderTimer();
    renderTasks();
    renderStats();
  }

  /* ---------- 设置弹窗 ---------- */

  function openSettings() {
    $('set-focus').value = String(S.focusMin);
    $('set-short').value = String(S.shortMin);
    $('set-long').value = String(S.longMin);
    $('set-every').value = String(S.longEvery);
    $('chk-autobreak').checked = S.autoBreak;
    $('chk-autofocus').checked = S.autoFocus;
    $('chk-sound').checked = S.sound;
    $('chk-notify').checked = S.notify;
    updateNotifyHint();
    $('settings-overlay').hidden = false;
  }

  function closeSettings() {
    $('settings-overlay').hidden = true;
  }

  function updateNotifyHint() {
    var hint = $('notify-hint');
    try {
      if (typeof Notification === 'undefined') {
        hint.textContent = '当前浏览器不支持桌面通知，将只在页面上提示。';
      } else if (Notification.permission === 'denied') {
        hint.textContent = '通知权限已被拒绝，可在浏览器地址栏重新允许后刷新页面。';
      } else if (Notification.permission === 'default') {
        hint.textContent = '保存时若勾选了桌面通知，浏览器会弹出授权请求。';
      } else {
        hint.textContent = '通知权限已开启。';
      }
    } catch (e) {
      hint.textContent = '';
    }
  }

  function saveSettings() {
    S.focusMin = clampInt($('set-focus').value, 1, 180, S.focusMin);
    S.shortMin = clampInt($('set-short').value, 1, 60, S.shortMin);
    S.longMin = clampInt($('set-long').value, 1, 90, S.longMin);
    S.longEvery = clampInt($('set-every').value, 2, 8, S.longEvery);
    S.autoBreak = $('chk-autobreak').checked;
    S.autoFocus = $('chk-autofocus').checked;
    S.sound = $('chk-sound').checked;
    S.notify = $('chk-notify').checked;

    if (S.notify) {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          var p = Notification.requestPermission();
          if (p && typeof p.then === 'function') {
            p.then(function () { updateNotifyHint(); }).catch(function () {});
          }
        }
      } catch (e) { /* 忽略 */ }
    }

    /* 未在计时中：立即按新时长刷新当前段；计时中则保持本轮不动 */
    if (!timer.running) {
      timer.remainMs = durationMs(timer.mode);
      timer.sessionMin = settingsFor(timer.mode);
      saveTimer();
    }
    saveState();
    renderAll();
    closeSettings();
  }

  /* ---------- 事件与启动 ---------- */

  function bindEvents() {
    $('btn-start').addEventListener('click', function () {
      if (timer.running) pauseTimer(); else startTimer();
    });
    $('btn-reset').addEventListener('click', resetTimer);

    $('mode-tabs').addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.tab') : null;
      if (!btn) return;
      var mode = btn.getAttribute('data-mode');
      if (mode && MODES[mode]) switchMode(mode);
    });

    $('task-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('task-input');
      if (!addTask(input.value)) {
        input.classList.add('invalid');
        setTimeout(function () { input.classList.remove('invalid'); }, 900);
        return;
      }
      input.value = '';
      input.focus();
    });

    $('task-list').addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;
      var li = btn.closest('li');
      var id = li ? li.getAttribute('data-id') : null;
      if (!id) return;
      if (btn.getAttribute('data-action') === 'del') deleteTask(id);
      else toggleFocusTask(id);
    });

    $('task-list').addEventListener('change', function (e) {
      if (!e.target || !e.target.classList || !e.target.classList.contains('task-toggle')) return;
      var li = e.target.closest('li');
      var id = li ? li.getAttribute('data-id') : null;
      if (id) toggleTask(id);
    });

    $('btn-settings').addEventListener('click', openSettings);
    $('btn-cancel').addEventListener('click', closeSettings);
    $('btn-save').addEventListener('click', saveSettings);
    $('settings-overlay').addEventListener('click', function (e) {
      if (e.target === $('settings-overlay')) closeSettings();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('settings-overlay').hidden) closeSettings();
    });
  }

  function tick() {
    if (timer.running && Date.now() >= timer.endAt) {
      completeSession();
      return;
    }
    renderTimer();
  }

  function init() {
    bindEvents();
    if (timer.running && timer.endAt <= Date.now()) {
      /* 页面关闭期间倒计时已经结束：按完成处理（计入统计后进入下一段） */
      completeSession();
    } else {
      renderAll();
    }
    setInterval(tick, 250);
  }

  init();
})();
