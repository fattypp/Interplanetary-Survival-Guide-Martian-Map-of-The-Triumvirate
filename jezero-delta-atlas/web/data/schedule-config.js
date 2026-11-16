/* ==========================================================================
   SCHEDULE SETTINGS: the ONE place where every number of the automatic schedule lives.
   Edit a value, save the file, reload the page (the planner tab reads this object at load).
   What every key does, its safe range and examples: docs/SCHEDULE.md (repo root).
   Times are 24-hour "HH:MM" strings on the day clock; durations are minutes unless the key says hours.
   If a value is missing or out of range the engine falls back to a safe value (it never crashes).
   ========================================================================== */
window.JEZERO_SCHEDULE_CONFIG = {

  /* ---- planning horizon ---- */
  days: 7,                 // how many days ahead the schedule is built (1 to 30)

  /* ---- length of a day ----
     By default the schedule uses ordinary 24-hour days (simple and matches the computer clock).
     A real Martian day (a "sol") lasts 24 h 39.6 min. Set sol to true and every day of the
     schedule becomes 24 h 39.6 min long, counted from midnight of today (clock times like
     "22:00" then mean "22 hours after the start of that sol"). */
  sol: false,

  /* ---- sleep (sacred: never moved, never shortened) ---- */
  sleep: {
    hours: 8,              // sleep per day (4 to 12). Default 8 hours.
    start: '22:00'         // bedtime. Wake-up = start + hours (06:00 by default)
  },

  /* ---- mental break / recreation (sacred) ---- */
  recreation: {
    minutes: 60,           // per day (0 to 240). 0 switches it off. Default 1 hour.
    start: '19:00'         // preferred start; slides later if something fixed is in the way
  },

  /* ---- meals (sacred): add, remove or edit entries freely ---- */
  meals: [
    { title: 'Breakfast', start: '07:00', minutes: 30 },
    { title: 'Lunch',     start: '12:00', minutes: 30 },
    { title: 'Dinner',    start: '18:00', minutes: 30 }
  ],

  /* ---- health check (sacred, recurring; the Planner tab also lists it as a to-do item) ---- */
  health: {
    enabled: true,
    start: '08:00',        // time of the first check of each day
    intervalHours: 24,     // 24 = once per day, 12 = twice per day, 48 = every second day. This is THE health-check interval of the whole app: suit.js reads it from here
    minutes: 15            // length of the block
  },

  /* ---- work (tasks and mission objectives) ---- */
  work: {
    maxBlockMinutes: 90,           // longest single work block; longer jobs are split into several blocks (15 to 240)
    breakMinutes: 10,              // rest left after a work block when the same job continues in the next block (0 to 60)
    minPieceMinutes: 15,           // do not squeeze a work piece shorter than this into a small gap (5 to 60)
    defaultTaskMinutes: 30,        // used when a task has no valid estimate
    missionObjectiveMinutes: 60,   // time given to each mission objective (they carry no estimate of their own)
    missionObjectiveImportance: 3  // importance 1 to 5 given to mission objectives
  },

  /* ---- how urgency raises the ranking ---- */
  urgentWithinHours: 24,   // a task due within this many hours gets...
  urgentBoost: 2,          // ...this many extra importance points when ranking (0 to 4)

  /* ---- reminders and adaptation (the monitor) ---- */
  checkEverySeconds: 30,           // how often (mission seconds) the monitor looks at the schedule
  remindAtStart: true,             // a small notice when a block starts
  reminderAfterEndMinutes: [0, 5], // escalating reminders this many minutes after a block should have ended without being ticked "done"
  graceMinutes: 10,                // minutes after the block end after which it counts as MISSED and the schedule is adapted
  staleAfterHours: 12,             // a saved schedule older than this is silently rebuilt on load (no misses counted)

  /* ---- escalation (report to Earth) ---- */
  escalateAfterMisses: 3           // missed blocks before a report is sent to Earth (1 to 20); queued until a room is joined.
};
