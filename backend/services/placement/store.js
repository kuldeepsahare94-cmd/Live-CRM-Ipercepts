// ============================================================================
// Placement desk — shared helpers, lists and the on / off switch.
// ============================================================================
// Used only by services/placement/* and routes/placement.js.
// ============================================================================

const db = require('../../db');
const access = require('../recordAccess');

const TZ = process.env.CRM_TIMEZONE || 'Asia/Kolkata';

const STAGES = ['Sourced', 'Screened', 'Submitted', 'Interview L1', 'Interview L2', 'Final round', 'Offered', 'Offer accepted', 'Joined'];
const SIDE_STAGES = ['On hold', 'Rejected'];
const ALL_STAGES = [...STAGES, ...SIDE_STAGES];
const REJECT_REASONS = ['Client rejected', 'Candidate not interested', 'CTC mismatch', 'Counter offer', 'Backed out', 'Did not turn up'];
const SOURCES = ['Naukri', 'LinkedIn', 'Referral', 'Walk-in', 'Database'];
const CAND_STATUS = ['New', 'Screened', 'Active', 'Placed', 'Do not call', 'Blacklisted'];
const JOB_STATUS = ['Open', 'On hold', 'Filled', 'Closed', 'Lost'];
const HIRING = ['Permanent', 'Contract'];
const ROUNDS = ['L1', 'L2', 'Final', 'HR'];
const IV_MODES = ['Video', 'Phone', 'In person'];
const IV_RESULTS = ['Scheduled', 'Cleared', 'Rejected', 'No show', 'On hold', 'Cancelled'];
const OFFER_STATUS = ['Offered', 'Accepted', 'Declined', 'Joined', 'Dropped'];
const CONTACT_OUTCOMES = ['Interested', 'Not interested', 'Call back', 'Not reachable', 'Wrong number', 'Switched off'];
const NOTICE = ['Immediate', '15 days', '30 days', '45 days', '60 days', '90 days'];

const bad = (message, status = 400, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const money = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad('A number was expected.');
  return n;
};
const idOf = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v)) return Number(v) || null;
  return null;
};
const text = (v, max = 4000) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const oneOf = (v, list, what) => {
  if (v === undefined || v === null || v === '') return null;
  const hit = list.find((x) => x.toLowerCase() === String(v).toLowerCase());
  if (!hit) throw bad(`${what} must be one of: ${list.join(', ')}.`);
  return hit;
};

// today in the CRM's time zone, as 2026-10-16
function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function nowLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}
const addDays = (iso, n) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthOf = (iso) => String(iso).slice(0, 7);

// The 10 digits of a mobile number: "+91 98765-43210" and "9876543210" are the same person.
const mobileKey = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : null; };
const emailKey = (e) => { const v = String(e || '').trim().toLowerCase(); return v.includes('@') ? v : null; };

// ---------------------------------------------------------------------------
// The switch and the defaults
// ---------------------------------------------------------------------------
const DEFAULTS = { enabled: '0', fee_percent: '8.33', guarantee_days: '90', gst_percent: '18', working_days: '26', cold_days: '10' };
function getSettings() {
  const rows = db.prepare('SELECT name, value FROM pl_settings').all();
  const m = { ...DEFAULTS };
  for (const r of rows) m[r.name] = r.value;
  return {
    enabled: m.enabled === '1',
    fee_percent: Number(m.fee_percent) || 8.33,
    guarantee_days: Number(m.guarantee_days) || 90,
    gst_percent: Number(m.gst_percent) || 0,
    working_days: Number(m.working_days) || 26,
    cold_days: Number(m.cold_days) || 10,
  };
}
function setSetting(name, value) {
  if (!Object.keys(DEFAULTS).includes(name)) throw bad(`Unknown setting "${name}".`);
  const row = db.prepare('SELECT id FROM pl_settings WHERE name = ?').get(name);
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  if (row) db.prepare("UPDATE pl_settings SET value = ?, updated_at = datetime('now') WHERE id = ?").run(v, row.id);
  else db.prepare('INSERT INTO pl_settings (name, value) VALUES (?, ?)').run(name, v);
}
const isEnabled = () => getSettings().enabled;

// ---------------------------------------------------------------------------
// Who sees which rows (the "Can see" level of the Roles page)
// ---------------------------------------------------------------------------
// null = everything; otherwise the people whose work this person may see.
function visibleIds(user) {
  if (!user || access.isSuper(user)) return null;
  const p = user.permissions && user.permissions.placement;
  const s = p && p.scope;
  if (s === 'own') return [Number(user.id)];
  if (s === 'team') return access.teamOf(user.id);
  return null;
}
const inList = (ids) => ids.map((n) => Number(n) || 0).join(',') || '0';
// jobs: mine, or one I am a recruiter on
function jobScope(user, a = 'j') {
  const ids = visibleIds(user);
  if (!ids) return '1=1';
  const l = inList(ids);
  return `(${a}.owner_id IN (${l}) OR ${a}.created_by IN (${l}) OR EXISTS (SELECT 1 FROM pl_job_recruiters r WHERE r.job_id = ${a}.id AND r.user_id IN (${l})))`;
}
function candScope(user, a = 'c') {
  const ids = visibleIds(user);
  if (!ids) return '1=1';
  const l = inList(ids);
  return `(${a}.owner_id IN (${l}) OR ${a}.created_by IN (${l}))`;
}
function pipeScope(user, a = 'p', j = 'j') {
  const ids = visibleIds(user);
  if (!ids) return '1=1';
  return `(${a}.owner_id IN (${inList(ids)}) OR ${jobScope(user, j)})`;
}

function nextCode(table, prefix, pad = 4) {
  const rows = db.prepare(`SELECT code FROM ${table} WHERE code LIKE ?`).all(`${prefix}%`);
  let max = 0;
  for (const r of rows) { const n = parseInt(String(r.code).slice(prefix.length), 10); if (n > max) max = n; }
  return `${prefix}${String(max + 1).padStart(pad, '0')}`;
}
const nextJobCode = (year = today().slice(0, 4)) => nextCode('pl_jobs', `JOB-${year}-`, 4);
const nextCandCode = () => nextCode('pl_candidates', 'CAN-', 4);

const userName = (id) => { const u = id && db.prepare('SELECT full_name, username FROM users WHERE id=?').get(id); return u ? (u.full_name || u.username) : null; };

module.exports = {
  TZ, STAGES, SIDE_STAGES, ALL_STAGES, REJECT_REASONS, SOURCES, CAND_STATUS, JOB_STATUS, HIRING, ROUNDS, IV_MODES, IV_RESULTS,
  OFFER_STATUS, CONTACT_OUTCOMES, NOTICE,
  bad, money, numOrNull, idOf, text, oneOf, today, nowLocal, addDays, monthOf, mobileKey, emailKey,
  getSettings, setSetting, isEnabled, visibleIds, jobScope, candScope, pipeScope, nextCode, nextJobCode, nextCandCode, userName, inList,
};
