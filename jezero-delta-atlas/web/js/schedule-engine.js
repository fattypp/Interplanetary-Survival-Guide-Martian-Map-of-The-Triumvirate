/* Schedule engine: PURE logic (no DOM, no Atlas, no clock). Same input gives the same output.
   Owned by the planner feature. Works in the browser (window.ScheduleEngine) and in Node (module.exports).
   Public API:
     buildSchedule(config, todos, objectives, now, opts) -> { blocks, unschedulable:[{todo, reason}], horizonEnd }
     reschedule(config, state, now)                      -> { blocks, unschedulable, reasons:[string] }
   Settings are described in web/data/schedule-config.js and docs/SCHEDULE.md.
   Block shape (docs/ARCHITECTURE.md): { id, start (ISO), end (ISO), type, title, refId }. */
(function (root) {
  'use strict';
  var MIN = 60000, DAY = 86400000;

  /* Safety net only: the real, editable values are in web/data/schedule-config.js. */
  var DEFAULTS = {
    days: 7, sol: false,
    sleep: { hours: 8, start: '22:00' },
    recreation: { minutes: 60, start: '19:00' },
    meals: [{ title: 'Breakfast', start: '07:00', minutes: 30 }, { title: 'Lunch', start: '12:00', minutes: 30 }, { title: 'Dinner', start: '18:00', minutes: 30 }],
    health: { enabled: true, start: '08:00', intervalHours: 24, minutes: 15 },
    work: { maxBlockMinutes: 90, minPieceMinutes: 15, breakMinutes: 10, defaultTaskMinutes: 30, missionObjectiveMinutes: 60, missionObjectiveImportance: 3 },
    urgentWithinHours: 24, urgentBoost: 2,
    checkEverySeconds: 30, remindAtStart: true, reminderAfterEndMinutes: [0, 5], graceMinutes: 10, staleAfterHours: 12,
    escalateAfterMisses: 3
  };

  function num(v, def, lo, hi) { v = Number(v); if (!isFinite(v)) v = def; return Math.min(hi, Math.max(lo, v)); }
  function hm(s, def) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s === undefined ? '' : s).trim());
    if (!m) return def;
    var h = +m[1], mi = +m[2];
    return (h > 23 || mi > 59) ? def : h * 60 + mi;
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, def) { return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 60) : def; }

  /* Fill gaps and clamp every number into its safe range (see docs/SCHEDULE.md). Never throws. */
  function normalizeConfig(c) {
    c = (c && typeof c === 'object') ? c : {};
    var D = DEFAULTS, s = c.sleep || {}, r = c.recreation || {}, h = c.health || {}, w = c.work || {};
    var meals = Array.isArray(c.meals) ? c.meals : D.meals;
    var rem = Array.isArray(c.reminderAfterEndMinutes) ? c.reminderAfterEndMinutes : D.reminderAfterEndMinutes;
    return {
      days: Math.round(num(c.days, D.days, 1, 30)),
      sol: c.sol === true,
      sleep: { hours: num(s.hours, D.sleep.hours, 4, 12), startMin: hm(s.start, hm(D.sleep.start)) },
      recreation: { minutes: num(r.minutes, D.recreation.minutes, 0, 240), startMin: hm(r.start, hm(D.recreation.start)) },
      meals: meals.map(function (m, i) {
        m = m || {};
        return { title: str(m.title, 'Meal ' + (i + 1)), startMin: hm(m.start, 12 * 60), minutes: num(m.minutes, 30, 5, 120) };
      }),
      health: {
        enabled: h.enabled !== false,
        startMin: hm(h.start, hm(D.health.start)),
        intervalHours: num(h.intervalHours, D.health.intervalHours, 1, 24 * 30),
        minutes: num(h.minutes, D.health.minutes, 5, 120)
      },
      work: {
        maxBlockMinutes: num(w.maxBlockMinutes, D.work.maxBlockMinutes, 15, 240),
        minPieceMinutes: num(w.minPieceMinutes, D.work.minPieceMinutes, 5, 60),
        breakMinutes: num(w.breakMinutes, D.work.breakMinutes, 0, 60),
        defaultTaskMinutes: num(w.defaultTaskMinutes, D.work.defaultTaskMinutes, 5, 480),
        missionObjectiveMinutes: num(w.missionObjectiveMinutes, D.work.missionObjectiveMinutes, 5, 480),
        missionObjectiveImportance: Math.round(num(w.missionObjectiveImportance, D.work.missionObjectiveImportance, 1, 5))
      },
      urgentWithinHours: num(c.urgentWithinHours, D.urgentWithinHours, 0, 24 * 30),
      urgentBoost: num(c.urgentBoost, D.urgentBoost, 0, 4),
      checkEverySeconds: num(c.checkEverySeconds, D.checkEverySeconds, 5, 600),
      remindAtStart: c.remindAtStart !== false,
      reminderAfterEndMinutes: rem.map(Number).filter(function (n) { return isFinite(n) && n >= 0; }).sort(function (a, b) { return a - b; }),
      graceMinutes: num(c.graceMinutes, D.graceMinutes, 1, 240),
      staleAfterHours: num(c.staleAfterHours, D.staleAfterHours, 1, 24 * 14),
      escalateAfterMisses: Math.round(num(c.escalateAfterMisses, D.escalateAfterMisses, 1, 20))
    };
  }

  /* ---------- day geometry (ordinary 24 h day, or a 24 h 39.6 min sol) ---------- */
  function dayLenMs(cfg) { return cfg.sol ? (24 * 60 + 39.6) * MIN : DAY; }
  function midnight(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime(); }
  /* time of day `min` minutes after the start of day number d (0 = today) */
  function at(cfg, nowMs, d, min) {
    if (cfg.sol) return midnight(nowMs) + d * dayLenMs(cfg) + min * MIN;
    var n = new Date(nowMs), whole = Math.floor(min);
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + d, 0, whole, 0, 0).getTime() + (min - whole) * MIN;
  }
  function dayStart(cfg, nowMs, d) { return at(cfg, nowMs, d, 0); }
  function dayIndex(cfg, nowMs, ms) {
    if (cfg.sol) return Math.floor((ms - midnight(nowMs)) / dayLenMs(cfg));
    return Math.round((midnight(ms) - midnight(nowMs)) / DAY);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmt(ms) { var d = new Date(ms); return DOW[d.getDay()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function toMs(v) { if (v === null || v === undefined || v === '') return null; var t = (typeof v === 'number') ? v : new Date(v).getTime(); return isFinite(t) ? t : null; }

  /* ---------- fixed (sacred) blocks ---------- */
  function overlaps(list, s, e) {
    for (var i = 0; i < list.length; i++) if (s < list[i].e && e > list[i].s) return true;
    return false;
  }
  function placeFixed(list, pref, dur) {
    for (var k = 0; k <= 72; k++) {                 // slide later in 5-minute steps, at most 6 hours
      var s = pref + k * 5 * MIN, e = s + dur;
      if (!overlaps(list, s, e)) return s;
    }
    return null;
  }
  function fixedBlocks(cfg, nowMs, opts) {
    var list = [], out = [], d, i;
    function add(type, title, s, dur, idExtra) {
      list.push({ s: s, e: s + dur });
      out.push({ id: type + ':' + (idExtra || Math.round(s)), start: s, end: s + dur, type: type, title: title, refId: type });
    }
    var D = cfg.days;
    for (d = -1; d < D; d++) {                      // d = -1: last night's sleep, so awake time right after midnight is right
      add('sleep', 'Sleep', at(cfg, nowMs, d, cfg.sleep.startMin), cfg.sleep.hours * 60 * MIN);
    }
    for (d = -1; d < D; d++) {
      cfg.meals.forEach(function (m) {
        var dur = m.minutes * MIN, s = placeFixed(list, at(cfg, nowMs, d, m.startMin), dur);
        if (s !== null) add('meal', m.title, s, dur);
      });
    }
    if (cfg.health.enabled) {
      var dur = cfg.health.minutes * MIN, iv = cfg.health.intervalHours;
      for (d = -1; d < D; d++) {
        var offs = [];
        if (iv >= 24) { var step = Math.max(1, Math.round(iv / 24)); if (((d % step) + step) % step === 0) offs.push(cfg.health.startMin); }
        else for (var o = cfg.health.startMin; o < 24 * 60; o += iv * 60) offs.push(o);
        offs.forEach(function (off) {
          var s = placeFixed(list, at(cfg, nowMs, d, off), dur);
          if (s !== null) add('health', 'Health check', s, dur);
        });
      }
    }
    if (cfg.recreation.minutes > 0) {
      for (d = -1; d < D; d++) {
        var rd = cfg.recreation.minutes * MIN, rs = placeFixed(list, at(cfg, nowMs, d, cfg.recreation.startMin), rd);
        if (rs !== null) add('recreation', 'Recreation / mental break', rs, rd);
      }
    }
    if (opts && opts.catchUpHealth && cfg.health.enabled) {
      var soon = out.some(function (b) { return b.type === 'health' && b.start >= nowMs && b.start < nowMs + 60 * MIN; });
      if (!soon) {
        var cd = cfg.health.minutes * MIN, cs = placeFixed(list, Math.ceil(nowMs / (5 * MIN)) * 5 * MIN, cd);
        if (cs !== null) { list.push({ s: cs, e: cs + cd }); out.push({ id: 'health:catchup:' + Math.round(cs), start: cs, end: cs + cd, type: 'health', title: 'Health check (catch-up)', refId: 'health' }); }
      }
    }
    return { blocks: out, list: list };
  }

  /* ---------- free time ---------- */
  function freeGaps(from, to, busy) {
    var b = busy.filter(function (x) { return x.e > from && x.s < to; }).sort(function (a, c) { return a.s - c.s; });
    var gaps = [], cur = from;
    b.forEach(function (x) {
      if (x.s > cur) gaps.push([cur, x.s]);
      if (x.e > cur) cur = x.e;
    });
    if (cur < to) gaps.push([cur, to]);
    return gaps;
  }

  /* ---------- items to place ---------- */
  function normalizeItems(cfg, todos, objectives, nowMs, done) {
    done = done || {};
    var items = [];
    (Array.isArray(todos) ? todos : []).forEach(function (t) {
      if (!t || t.done || t.kind === 'health' || t.kind === 'mission') return;
      var id = t.id !== undefined ? String(t.id) : 't' + items.length;
      var est = Number(t.remainingMin !== undefined ? t.remainingMin : t.estMin);
      if (!isFinite(est) || est <= 0) est = (t.remainingMin !== undefined && Number(t.remainingMin) <= 0) ? 0 : cfg.work.defaultTaskMinutes;
      est = Math.round(est);
      if (done['task:' + id]) est = Math.max(0, est - done['task:' + id]);
      items.push({ key: 'task:' + id, type: 'task', refId: id, src: t, title: String(t.title || 'Task'), est: est, deadline: toMs(t.deadline), importance: Math.round(num(t.importance, 3, 1, 5)) });
    });
    (Array.isArray(objectives) ? objectives : []).forEach(function (o) {
      if (!o || o.done) return;
      var id = o.id !== undefined ? String(o.id) : 'o' + items.length;
      var est = Math.round(num(o.remainingMin !== undefined ? o.remainingMin : o.estMin, cfg.work.missionObjectiveMinutes, 0, 1440));
      if (done['mission:' + id]) est = Math.max(0, est - done['mission:' + id]);
      items.push({ key: 'mission:' + id, type: 'mission', refId: id, src: o, title: String(o.title || 'Mission objective'), est: est,
        deadline: toMs(o.deadline), importance: Math.round(num(o.importance, cfg.work.missionObjectiveImportance, 1, 5)) });
    });
    return items.filter(function (it) { return it.est > 0; });
  }
  function score(cfg, it, nowMs) {
    var s = it.importance;
    if (it.deadline !== null && it.deadline > nowMs && it.deadline - nowMs <= cfg.urgentWithinHours * 60 * MIN) s += cfg.urgentBoost;
    return s;
  }
  function byPriority(cfg, nowMs) {
    return function (a, b) {
      var sa = score(cfg, a, nowMs), sb = score(cfg, b, nowMs);
      if (sa !== sb) return sb - sa;
      if (a.importance !== b.importance) return b.importance - a.importance;
      var da = a.deadline === null ? Infinity : a.deadline, db = b.deadline === null ? Infinity : b.deadline;
      if (da !== db) return da < db ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    };
  }
  function byDeadline(a, b) {
    if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return a.key < b.key ? -1 : 1;
  }

  /* Try to fit the whole item into the gaps before `limit`. Returns {pieces, gaps} or null (nothing committed). */
  function placeItem(cfg, gaps, it, limit) {
    var remaining = it.est * MIN, maxB = cfg.work.maxBlockMinutes * MIN, minP = cfg.work.minPieceMinutes * MIN, brk = cfg.work.breakMinutes * MIN;
    var pieces = [], out = [], i;
    if (remaining <= maxB) {                                       // a job that fits one block: prefer one unbroken block in the earliest gap that holds it
      for (i = 0; i < gaps.length; i++) {
        var gs = gaps[i][0], ge = gaps[i][1];
        if (gs >= limit) break;
        if (Math.min(ge, limit) - gs >= remaining) {
          var whole = gaps.slice(0, i); if (gs + remaining < ge) whole.push([gs + remaining, ge]);
          return { pieces: [{ s: gs, e: gs + remaining }], gaps: whole.concat(gaps.slice(i + 1)) };
        }
      }
    }
    for (i = 0; i < gaps.length; i++) {
      var s = gaps[i][0], e = gaps[i][1], cur = s, lim = Math.min(e, limit);
      if (remaining > 0) {
        while (remaining > 0 && cur < lim) {
          var len = lim - cur, piece = Math.min(remaining, len, maxB);
          if (piece < minP && piece < remaining) break;           // too small a scrap to be worth a block
          pieces.push({ s: cur, e: cur + piece });
          remaining -= piece;
          cur += piece + (remaining > 0 ? brk : 0);
        }
      }
      if (cur < e) out.push([Math.min(cur, e), e]);
      if (remaining <= 0) { for (var j = i + 1; j < gaps.length; j++) out.push(gaps[j]); break; }
    }
    if (remaining > 0) return null;
    return { pieces: pieces, gaps: out };
  }
  function freeBefore(gaps, limit) {
    var t = 0;
    gaps.forEach(function (g) { var e = Math.min(g[1], limit); if (e > g[0]) t += e - g[0]; });
    return Math.floor(t / MIN);
  }

  /* ---------- main entry ---------- */
  function buildSchedule(config, todos, objectives, now, opts) {
    opts = opts || {};
    var cfg = normalizeConfig(config);
    var nowMs = toMs(now); if (nowMs === null) nowMs = Date.now();
    var W = Math.ceil(nowMs / (5 * MIN)) * 5 * MIN;                 // earliest start of work: next 5-minute mark
    var H = dayStart(cfg, nowMs, cfg.days);                         // end of the horizon
    var fx = fixedBlocks(cfg, nowMs, opts);
    var busy = fx.list.slice();
    (opts.busy || []).forEach(function (b) {                        // already-done work that must not be overlapped
      var s = toMs(b.start), e = toMs(b.end); if (s !== null && e !== null && e > s) busy.push({ s: s, e: e });
    });
    var gaps0 = freeGaps(W, H, busy);

    var items = normalizeItems(cfg, todos, objectives, nowMs, opts.done);
    var unsched = [], infeasible = [];
    var live = [];
    items.forEach(function (it) {
      if (it.deadline !== null && it.deadline <= nowMs) unsched.push({ todo: it.src, reason: 'Deadline already passed (' + fmt(it.deadline) + '). Edit the deadline to schedule it.' });
      else live.push(it);
    });

    var cmp = byPriority(cfg, nowMs), base = live.slice().sort(cmp);
    var promoted = [], promotedKeys = {}, excluded = {}, placed = {}, failed = [];
    var guard = 0, maxPass = live.length * 2 + 5;
    while (guard++ < maxPass) {
      var order = promoted.slice().sort(byDeadline).concat(base.filter(function (it) { return !promotedKeys[it.key]; }))
        .filter(function (it) { return !hasOwn(excluded, it.key); });
      var gaps = gaps0; placed = {}; failed = [];
      for (var i = 0; i < order.length; i++) {
        var it = order[i], limit = it.deadline !== null ? Math.min(it.deadline, H) : H;
        var res = placeItem(cfg, gaps, it, limit);
        if (res) { gaps = res.gaps; placed[it.key] = res.pieces; } else failed.push(it);
      }
      var fresh = failed.filter(function (f) { return f.deadline !== null && !promotedKeys[f.key]; });
      if (fresh.length) { fresh.forEach(function (f) { promoted.push(f); promotedKeys[f.key] = true; }); continue; }
      var hard = failed.filter(function (f) { return f.deadline !== null; }).sort(byDeadline);
      if (!hard.length) break;
      var F = hard[0];
      /* F failed even at the front of the line: sacrifice the least important earlier deadline item if that is less important than F */
      var cands = promoted.filter(function (p) { return placed[p.key] && p.importance < F.importance && p.deadline <= F.deadline; })
        .sort(function (a, b) { return a.importance - b.importance || b.deadline - a.deadline || (a.key < b.key ? -1 : 1); });
      if (cands.length) { excluded[cands[0].key] = 'Dropped to keep "' + F.title + '" (importance ' + F.importance + '/5) on time; this one is less important (' + cands[0].importance + '/5).'; continue; }
      excluded[F.key] = null;                                   // infeasible even alone at the front
      infeasible.push(F);
    }
    /* unschedulable reasons */
    var all = failed.concat(infeasible, items.filter(function (it) { return excluded[it.key]; }));
    var seen = {};
    all.forEach(function (it) {
      if (seen[it.key]) return; seen[it.key] = true;
      var reason;
      if (excluded[it.key]) reason = excluded[it.key];
      else if (it.deadline !== null) {
        reason = 'Not enough free time before its deadline (' + fmt(it.deadline) + '): needs ' + it.est + ' min, only ' + freeBefore(gaps0, it.deadline) + ' min are free after sleep, meals, health and recreation.';
      } else reason = 'No room in the next ' + cfg.days + ' days (needs ' + it.est + ' min).';
      unsched.push({ todo: it.src, reason: reason });
    });

    /* turn placements into blocks */
    var blocks = fx.blocks.filter(function (b) { return b.end > nowMs && b.start < H + dayLenMs(cfg); }).map(function (b) {
      return { id: b.id, start: iso(b.start), end: iso(b.end), type: b.type, title: b.title, refId: b.refId };
    });
    Object.keys(placed).forEach(function (k) {
      var it = items.filter(function (x) { return x.key === k; })[0], ps = placed[k];
      ps.forEach(function (p, idx) {
        blocks.push({ id: it.key + ':' + Math.round(p.s), start: iso(p.s), end: iso(p.e), type: it.type,
          title: it.title + (ps.length > 1 ? ' (' + (idx + 1) + '/' + ps.length + ')' : ''), refId: it.refId });
      });
    });
    blocks.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1; });
    return { blocks: blocks, unschedulable: unsched, horizonEnd: iso(H) };
  }

  /* ---------- adapting after missed blocks ---------- */
  function firstStarts(blocks) {
    var m = {};
    (blocks || []).forEach(function (b) {
      if (b.type !== 'task' && b.type !== 'mission') return;
      var k = b.type + ':' + b.refId, s = toMs(b.start);
      if (m[k] === undefined || s < m[k]) m[k] = s;
    });
    return m;
  }
  /* state: { todos, objectives, blocks (the current schedule), missed:[blockId], done:{ 'task:<id>': minutesDone }, busy:[blocks] } */
  function reschedule(config, state, now) {
    state = state || {};
    var cfg = normalizeConfig(config), nowMs = toMs(now); if (nowMs === null) nowMs = Date.now();
    var old = state.blocks || [], missedIds = state.missed || [];
    var missed = old.filter(function (b) { return missedIds.indexOf(b.id) >= 0; });
    var healthMissed = missed.some(function (b) { return b.type === 'health'; });
    var res = buildSchedule(config, state.todos, state.objectives, nowMs, { done: state.done, busy: state.busy, catchUpHealth: healthMissed });
    var items = normalizeItems(cfg, state.todos, state.objectives, nowMs, state.done), meta = {};
    items.forEach(function (it) { meta[it.key] = it; });
    var oldFirst = firstStarts(old), newFirst = firstStarts(res.blocks), reasons = [], said = {};
    var grace = cfg.graceMinutes * MIN;

    function dl(it) { return it.deadline !== null ? ', due ' + fmt(it.deadline) : ', no deadline'; }
    missed.forEach(function (b) {
      if (b.type === 'health') { reasons.push('Health check at ' + fmt(toMs(b.start)) + ' was missed: a catch-up check was added at the next free slot.'); return; }
      if (b.type !== 'task' && b.type !== 'mission') return;
      var k = b.type + ':' + b.refId; if (said[k]) return; said[k] = true;
      var it = meta[k];
      if (!it) return;
      if (newFirst[k] !== undefined) reasons.push('Moved "' + it.title + '" from ' + fmt(toMs(b.start)) + ' to ' + fmt(newFirst[k]) + ' because it was not marked done by ' + fmt(toMs(b.end) + grace) +
        ' (importance ' + it.importance + '/5' + dl(it) + ').');
    });
    res.unschedulable.forEach(function (u) {
      var t = u.todo || {}, title = t.title || 'Item';
      reasons.push('Could not keep "' + title + '" in the schedule (importance ' + (t.importance || '?') + '/5): ' + u.reason);
    });
    Object.keys(newFirst).forEach(function (k) {
      if (said[k] || oldFirst[k] === undefined || !meta[k]) return;
      if (newFirst[k] > oldFirst[k] + 5 * MIN) {
        reasons.push('Delayed "' + meta[k].title + '" from ' + fmt(oldFirst[k]) + ' to ' + fmt(newFirst[k]) + ' to make room for missed work and higher-ranked items (importance ' + meta[k].importance + '/5' + dl(meta[k]) + ').');
      }
    });
    if (reasons.length > 12) { var n = reasons.length - 12; reasons = reasons.slice(0, 12); reasons.push('...and ' + n + ' more change' + (n > 1 ? 's' : '') + '.'); }
    return { blocks: res.blocks, unschedulable: res.unschedulable, reasons: reasons, horizonEnd: res.horizonEnd };
  }

  var api = {
    buildSchedule: buildSchedule, reschedule: reschedule, normalizeConfig: normalizeConfig, DEFAULTS: DEFAULTS,
    dayStart: function (config, now, d) { return dayStart(normalizeConfig(config), toMs(now), d); },
    dayIndex: function (config, now, ms) { return dayIndex(normalizeConfig(config), toMs(now), toMs(ms)); },
    dayLengthMinutes: function (config) { return dayLenMs(normalizeConfig(config)) / MIN; },
    fmt: fmt
  };
  root.ScheduleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
