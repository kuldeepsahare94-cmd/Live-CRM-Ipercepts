// ============================================================================
// More than one email address on a record (SuiteCRM style).
// ============================================================================
// The main address stays in the record's own `email` column (so lists, search,
// mail merge, imports and the old screens all keep working). The EXTRA ones
// are in `record_emails`, each with "opted out" and "invalid" marks.
// ============================================================================
const db = require('../db');

const MAX_EXTRA = 10;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

const bad = (message) => { const e = new Error(message); e.status = 400; return e; };
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/** Checks what came in; returns the clean list or throws a message a person can read. */
function validate(list, primary) {
  if (!Array.isArray(list)) throw bad('The extra email addresses must be a list.');
  if (list.length > MAX_EXTRA) throw bad(`At most ${MAX_EXTRA} extra email addresses.`);
  const seen = new Set();
  const main = String(primary || '').trim().toLowerCase();
  const out = [];
  for (const raw of list) {
    const email = String((raw && typeof raw === 'object' ? raw.email : raw) || '').trim();
    if (!email) continue;                               // an empty row is simply not kept
    if (email.length > 254 || !EMAIL.test(email)) throw bad(`"${email.slice(0, 60)}" is not a valid email address.`);
    const low = email.toLowerCase();
    if (low === main) continue;                          // the same as the main address
    if (seen.has(low)) throw bad(`${email} is entered twice.`);
    seen.add(low);
    out.push({ email, opted_out: flag(raw && raw.opted_out), invalid: flag(raw && (raw.invalid || raw.invalid_email)) });
  }
  return out;
}

function list(module, id) {
  return db.prepare('SELECT id, email, opted_out, invalid_email AS invalid FROM record_emails WHERE module = ? AND record_id = ? ORDER BY sort_order, id')
    .all(String(module), Number(id)).map((r) => ({ id: r.id, email: r.email, opted_out: !!r.opted_out, invalid: !!r.invalid }));
}

/** { id: [emails…] } for many records at once (lists) */
function listMany(module, ids) {
  const out = {};
  const clean = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 500);
  if (!clean.length) return out;
  const rows = db.prepare(`SELECT record_id, email, opted_out, invalid_email AS invalid FROM record_emails WHERE module = ? AND record_id IN (${clean.map(() => '?').join(',')}) ORDER BY sort_order, id`)
    .all(String(module), ...clean);
  for (const r of rows) (out[r.record_id] = out[r.record_id] || []).push({ email: r.email, opted_out: !!r.opted_out, invalid: !!r.invalid });
  return out;
}

/** Replaces all the extra addresses of one record. */
function replace(module, id, items, userId) {
  const m = String(module);
  const rid = Number(id);
  db.prepare('DELETE FROM record_emails WHERE module = ? AND record_id = ?').run(m, rid);
  items.forEach((it, i) => {
    db.prepare('INSERT INTO record_emails (module, record_id, email, email_lower, opted_out, invalid_email, sort_order, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(m, rid, it.email, it.email.toLowerCase(), it.opted_out ? 1 : 0, it.invalid ? 1 : 0, i, userId || null);
  });
  return list(m, rid);
}

/** Adds addresses the record does not have yet (a create that turned out to reuse an existing record must not wipe what it had). */
function merge(module, id, items, userId) {
  const have = list(module, id);
  const known = new Set(have.map((x) => x.email.toLowerCase()));
  const all = [...have.map((x) => ({ email: x.email, opted_out: x.opted_out, invalid: x.invalid })), ...items.filter((x) => !known.has(x.email.toLowerCase()))].slice(0, MAX_EXTRA);
  return replace(module, id, all, userId);
}

/** ids of the records of a module that have this address as an EXTRA one */
function idsWithEmail(module, email) {
  const low = String(email || '').trim().toLowerCase();
  if (!low) return [];
  return db.prepare('SELECT DISTINCT record_id FROM record_emails WHERE module = ? AND email_lower = ?').all(String(module), low).map((r) => r.record_id);
}

/** records (module + id) that have this address as an extra one, in any module */
function recordsWithEmail(email) {
  const low = String(email || '').trim().toLowerCase();
  if (!low) return [];
  return db.prepare('SELECT module, record_id FROM record_emails WHERE email_lower = ?').all(low);
}

function removeFor(module, id) {
  try { db.prepare('DELETE FROM record_emails WHERE module = ? AND record_id = ?').run(String(module), Number(id)); } catch { /* best effort */ }
}

module.exports = { MAX_EXTRA, EMAIL, validate, list, listMany, replace, merge, idsWithEmail, recordsWithEmail, removeFor };
