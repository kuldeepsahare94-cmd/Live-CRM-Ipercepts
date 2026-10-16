// ============================================================================
// Phase 53 — v1.7.0 polish
// ============================================================================
// A follow-up is something a person planned. A missed call used to make a
// "Call back — missed call" follow-up by itself, which filled everyone's
// Follow-ups with calls nobody planned. From now on:
//   - a missed call still notifies the owner and shows in Calls, but it does
//     not make a follow-up (the setting stays, switched off by default);
//   - the ones already made are cancelled once, here.
// Runs once (a flag row), so switching the setting on later is respected.
// ============================================================================
const db = require('./db-metadata');

db.exec(`CREATE TABLE IF NOT EXISTS schema_flags (
  name TEXT PRIMARY KEY,
  done_at TEXT DEFAULT (datetime('now'))
)`);

function once(name, fn) {
  if (db.prepare('SELECT 1 FROM schema_flags WHERE name = ?').get(name)) return;
  try { fn(); } catch (e) { console.warn(`[phase53] ${name}:`, e.message); return; }
  db.prepare('INSERT INTO schema_flags (name) VALUES (?)').run(name);
}

once('v170_missed_call_followups', () => {
  // 1. the setting: off (an administrator can still switch it on)
  try {
    const row = db.prepare("SELECT id, value FROM telephony_settings WHERE name = 'settings'").get();
    if (row) {
      const s = JSON.parse(row.value || '{}') || {};
      if (s.missed_followup !== false) {
        s.missed_followup = false;
        db.prepare("UPDATE telephony_settings SET value = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(s), row.id);
      }
    }
  } catch { /* telephony was never set up */ }
  // 2. the open ones made by missed calls are cancelled (the record's follow-up date is cleared with them)
  const open = db.prepare("SELECT id FROM follow_ups WHERE origin = 'missed_call' AND status = 'Scheduled'").all();
  if (!open.length) return;
  const fu = require('./services/followUps');
  for (const f of open) {
    try { fu.cancel(f.id, { userId: null, note: 'A missed call no longer makes a follow-up' }); } catch (e) { console.warn('[phase53] cancel', f.id, e.message); }
  }
});
