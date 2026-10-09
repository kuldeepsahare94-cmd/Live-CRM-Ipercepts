// ============================================================================
// Field force (SFA): what is kept, and the set-up.
// ============================================================================
//   sfa_settings     one row per name: the rules
//   sfa_sessions     a working day: punch in → punch out (time, place, selfie, km)
//   sfa_points       the GPS points of a working day (only between punch in and out)
//   sfa_live         the newest point of each person (the live map reads only this)
//   sfa_visits       a check-in / check-out at a customer (a meeting, a lead, an account…)
//   sfa_files        selfies, photos and files of a punch or a visit (kept IN the database:
//                    the server's disk is wiped at every deploy)
//   sfa_places       where a lead / contact / account is (for "nearby" and to check a visit)
//
// Everything is created on first use; there is nothing to run by hand.
// ============================================================================

const db = require('../../db');

const nowIso = () => new Date().toISOString();
const bad = (message, status = 400, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const blank = (v) => v === '' || v === null || v === undefined;
function idOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v < 1e15 ? v : null;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v)) return Number(v) || null;
  return null;
}
function number(v, what) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  throw bad(`${what} is not a number.`);
}
const text = (v, max) => { const s = String(v ?? '').replace(/\u0000/g, '').trim(); return s ? s.slice(0, max) : null; };

let ready = false;
function ensureSchema() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS sfa_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sfa_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      status TEXT DEFAULT 'in',
      in_at TEXT NOT NULL,
      in_lat REAL, in_lng REAL, in_accuracy REAL, in_address TEXT, in_selfie_id INTEGER, in_note TEXT, in_ref TEXT,
      out_at TEXT,
      out_lat REAL, out_lng REAL, out_accuracy REAL, out_address TEXT, out_selfie_id INTEGER, out_note TEXT, out_ref TEXT,
      auto_out INTEGER DEFAULT 0,
      km REAL DEFAULT 0,
      points INTEGER DEFAULT 0,
      run_lat REAL, run_lng REAL, run_at TEXT,
      expense_id INTEGER,
      device TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sfa_sessions_user ON sfa_sessions (user_id, day);
    CREATE INDEX IF NOT EXISTS idx_sfa_sessions_day ON sfa_sessions (day);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_sessions_in_ref ON sfa_sessions (user_id, in_ref);
    CREATE TABLE IF NOT EXISTS sfa_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      at TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL,
      accuracy REAL, speed REAL, heading REAL,
      battery REAL, charging INTEGER, is_mock INTEGER DEFAULT 0, source TEXT,
      created_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_points_user_at ON sfa_points (user_id, at);
    CREATE INDEX IF NOT EXISTS idx_sfa_points_session ON sfa_points (session_id, at);
    CREATE TABLE IF NOT EXISTS sfa_live (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      session_id INTEGER,
      at TEXT, lat REAL, lng REAL, accuracy REAL, speed REAL, battery REAL, charging INTEGER, is_mock INTEGER DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sfa_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id INTEGER,
      meeting_id INTEGER,
      related_module TEXT, related_record_id INTEGER, related_name TEXT,
      status TEXT DEFAULT 'open',
      in_at TEXT NOT NULL, in_lat REAL, in_lng REAL, in_accuracy REAL, in_distance_m REAL, in_selfie_id INTEGER, in_ref TEXT,
      out_at TEXT, out_lat REAL, out_lng REAL, out_accuracy REAL, out_distance_m REAL,
      far INTEGER DEFAULT 0,
      notes TEXT, outcome TEXT, next_action TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sfa_visits_user ON sfa_visits (user_id, in_at);
    CREATE INDEX IF NOT EXISTS idx_sfa_visits_record ON sfa_visits (related_module, related_record_id);
    CREATE INDEX IF NOT EXISTS idx_sfa_visits_meeting ON sfa_visits (meeting_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_visits_ref ON sfa_visits (user_id, in_ref);
    CREATE TABLE IF NOT EXISTS sfa_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      session_id INTEGER,
      visit_id INTEGER,
      kind TEXT,
      file_name TEXT, mime TEXT, size INTEGER,
      data TEXT, thumb TEXT,
      ref TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sfa_files_visit ON sfa_files (visit_id);
    CREATE TABLE IF NOT EXISTS sfa_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL,
      source TEXT, address TEXT,
      set_by INTEGER, set_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_places_record ON sfa_places (module, record_id);
    CREATE INDEX IF NOT EXISTS idx_sfa_places_geo ON sfa_places (lat, lng);
  `);
  // (a column added after the first version of a table)
  try {
    const files = new Set(db.prepare('PRAGMA table_info(sfa_files)').all().map((c) => c.name));
    if (!files.has('ref')) db.exec('ALTER TABLE sfa_files ADD COLUMN ref TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_files_ref ON sfa_files (visit_id, ref)');
  } catch (e) { console.warn('[sfa] files:', e.message); }
  // one open working day and one open visit per person, even with two servers
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_sessions_one_open ON sfa_sessions (user_id) WHERE status = 'in'");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sfa_visits_one_open ON sfa_visits (user_id) WHERE status = 'open'");
  } catch (e) { console.warn('[sfa] one open day / visit:', e.message); }
  ensurePermissions();
  ready = true;
}

// Every role gets a row for "sfa" (Field force) in Roles & Permissions: people
// may punch in and check in at customers. Only Super Admin and Admin export.
function ensurePermissions() {
  try {
    const roles = db.prepare('SELECT id, name FROM roles').all();
    const have = new Set(db.prepare("SELECT role_id FROM role_permissions WHERE module = 'sfa'").all().map((r) => Number(r.role_id)));
    const ins = db.prepare("INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_export) VALUES (?, 'sfa', 1, 1, 1, 0, ?)");
    for (const r of roles) {
      if (have.has(Number(r.id))) continue;
      ins.run(r.id, /^(super admin|admin)$/i.test(r.name) ? 1 : 0);
    }
  } catch (e) { console.warn('[sfa] permissions:', e.message); }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const DEFAULTS = {
  enabled: false,              // the module is offered once an administrator switches it on
  // tracking (between punch in and punch out only)
  track: true,                 // record the route at all
  interval_seconds: 60,        // the app takes a point at most this often…
  distance_filter_m: 50,       // …and only when the person moved this far
  max_accuracy_m: 100,         // a point less precise than this is not used for km
  max_speed_kmh: 160,          // a jump faster than this is a GPS error, not travel
  min_move_m: 20,              // smaller moves are GPS noise standing still
  road_factor: 1,              // straight lines between points × this (1.0–1.5) to come closer to road distance
  // punch
  selfie_in: false,
  selfie_out: false,
  work_start: '09:30',         // later than this is "late"
  work_end: '18:30',
  auto_out_hours: 16,          // a day left open longer than this is closed at its last point
  // visits
  selfie_visit: false,
  visit_radius_m: 300,         // a check-in further than this from the customer's saved place is pointed out
  save_place_on_visit: true,   // the first check-in at a customer without a place saves it
  close_meeting_on_checkout: true,
  // km as an expense (needs Expenses)
  km_expense: false,
  km_expense_category_id: null,
  km_expense_vehicle: '',
  km_expense_min: 1,
  // finding a customer's place from its address (OpenStreetMap)
  geocode: false,
  // the map pictures (tiles) of the web and the app; blank = OpenStreetMap
  map_tiles_url: '',
  map_attribution: '',
  // who sees everyone (besides Super Admin): these roles
  viewer_role_ids: [],
};

function readValue(name) {
  const row = db.prepare('SELECT value FROM sfa_settings WHERE name = ?').get(name);
  return row ? row.value : null;
}
function writeValue(name, value) {
  const row = db.prepare('SELECT id FROM sfa_settings WHERE name = ?').get(name);
  if (row) db.prepare("UPDATE sfa_settings SET value = ?, updated_at = datetime('now') WHERE id = ?").run(value, row.id);
  else db.prepare('INSERT INTO sfa_settings (name, value) VALUES (?, ?)').run(name, value);
}
const clamp = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const hhmm = (v, dflt) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : dflt);

let cache = null;
function getSettings() {
  ensureSchema();
  const version = db.versionOf(['sfa_settings']);
  if (cache && cache.version === version && Date.now() - cache.at < 15000) return cache.value;
  let stored = {};
  try { stored = JSON.parse(readValue('settings') || '{}') || {}; } catch { stored = {}; }
  const s = { ...DEFAULTS, ...stored };
  s.enabled = !!s.enabled;
  s.track = s.track !== false;
  s.interval_seconds = Math.round(clamp(s.interval_seconds, 15, 900, 60));
  s.distance_filter_m = Math.round(clamp(s.distance_filter_m, 0, 1000, 50));
  s.max_accuracy_m = Math.round(clamp(s.max_accuracy_m, 10, 1000, 100));
  s.max_speed_kmh = Math.round(clamp(s.max_speed_kmh, 20, 400, 160));
  s.min_move_m = Math.round(clamp(s.min_move_m, 0, 200, 20));
  s.road_factor = Math.round(clamp(s.road_factor, 1, 1.6, 1) * 100) / 100;
  s.selfie_in = !!s.selfie_in; s.selfie_out = !!s.selfie_out; s.selfie_visit = !!s.selfie_visit;
  s.work_start = hhmm(s.work_start, '09:30'); s.work_end = hhmm(s.work_end, '18:30');
  s.auto_out_hours = Math.round(clamp(s.auto_out_hours, 4, 24, 16));
  s.visit_radius_m = Math.round(clamp(s.visit_radius_m, 20, 20000, 300));
  s.save_place_on_visit = s.save_place_on_visit !== false;
  s.close_meeting_on_checkout = s.close_meeting_on_checkout !== false;
  s.km_expense = !!s.km_expense;
  s.km_expense_category_id = idOf(s.km_expense_category_id);
  s.km_expense_vehicle = String(s.km_expense_vehicle || '').slice(0, 40);
  s.km_expense_min = clamp(s.km_expense_min, 0, 1000, 1);
  s.geocode = !!s.geocode;
  s.map_tiles_url = String(s.map_tiles_url || '');
  s.map_attribution = String(s.map_attribution || '');
  s.viewer_role_ids = (Array.isArray(s.viewer_role_ids) ? s.viewer_role_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  cache = { at: Date.now(), version, value: s };
  return s;
}

function flag(v, what) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  throw bad(`${what} must be on or off.`);
}
function saveSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Nothing to save.');
  const cur = getSettings();
  const next = { ...cur };
  for (const k of ['enabled', 'track', 'selfie_in', 'selfie_out', 'selfie_visit', 'save_place_on_visit', 'close_meeting_on_checkout', 'km_expense', 'geocode']) {
    if (input[k] !== undefined) next[k] = flag(input[k], `"${k}"`);
  }
  const fig = (k, what, lo, hi) => {
    if (input[k] === undefined) return;
    const n = number(input[k], what);
    if (n < lo || n > hi) throw bad(`${what} must be between ${lo} and ${hi}.`);
    next[k] = n;
  };
  fig('interval_seconds', 'How often a point is taken (seconds)', 15, 900);
  fig('distance_filter_m', 'The distance between points (m)', 0, 1000);
  fig('max_accuracy_m', 'The worst GPS accuracy used (m)', 10, 1000);
  fig('max_speed_kmh', 'The highest speed (km/h)', 20, 400);
  fig('min_move_m', 'The smallest move (m)', 0, 200);
  fig('road_factor', 'The road factor', 1, 1.6);
  fig('auto_out_hours', 'The hours after which a day is closed', 4, 24);
  fig('visit_radius_m', 'The distance of a visit (m)', 20, 20000);
  fig('km_expense_min', 'The least km for an expense', 0, 1000);
  for (const k of ['work_start', 'work_end']) {
    if (input[k] === undefined) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input[k]))) throw bad('Give the time as HH:MM (24 hours).');
    next[k] = String(input[k]);
  }
  if (input.km_expense_category_id !== undefined) {
    const id = blank(input.km_expense_category_id) ? null : idOf(input.km_expense_category_id);
    if (id) {
      let c = null;
      try { c = db.prepare('SELECT id, kind, active FROM expense_categories WHERE id = ?').get(id); } catch { c = null; }
      if (!c) throw bad('That expense category was not found.');
      if (c.kind !== 'mileage') throw bad('Choose an expense category of the kind "Own vehicle: km × rate".');
    }
    next.km_expense_category_id = id;
  }
  if (input.km_expense_vehicle !== undefined) next.km_expense_vehicle = String(input.km_expense_vehicle || '').trim().slice(0, 40);
  if (next.km_expense && (!next.km_expense_category_id || !next.km_expense_vehicle)) throw bad('For the km expense choose its category and the vehicle.');
  if (input.map_tiles_url !== undefined) {
    const u = String(input.map_tiles_url || '').trim();
    if (u && (!/^https:\/\/[^\s"'<>]+$/.test(u) || !u.includes('{z}') || !u.includes('{x}') || !u.includes('{y}') || u.length > 300)) {
      throw bad('The map address must start with https:// and have {z}, {x} and {y} in it.');
    }
    next.map_tiles_url = u;
  }
  if (input.map_attribution !== undefined) next.map_attribution = String(input.map_attribution || '').replace(/[<>]/g, '').trim().slice(0, 200);
  if (input.viewer_role_ids !== undefined) {
    if (!Array.isArray(input.viewer_role_ids)) throw bad('Send the roles as a list.');
    next.viewer_role_ids = [...new Set(input.viewer_role_ids.map(idOf).filter(Boolean))].slice(0, 50);
  }
  writeValue('settings', JSON.stringify(next));
  cache = null;
  return getSettings();
}

ensureSchema();

module.exports = { ensureSchema, getSettings, saveSettings, DEFAULTS, nowIso, bad, blank, idOf, number, text, readValue, writeValue };
