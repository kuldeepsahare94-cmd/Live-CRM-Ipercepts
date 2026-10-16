// ============================================================================
// Follow-ups for a dashboard (v1.4): mine, or my team's — overdue, today,
// this week, or between two dates. Used by the app's Home and Team screens and
// by the web dashboard.
//
//   GET /api/sfa/m/follow-ups?range=overdue|today|week|dates&from=&to=&view=me|all|user:5|team:2|role:3
//
// A follow-up is "for" the person it was given to, else whoever owns the record
// (the same rule the reminders use). Only follow-ups on modules the viewer's
// role may open are shown.
// ============================================================================
const db = require('../../db');
const access = require('../recordAccess');
const fu = require('../followUps');
const viewing = require('./viewing');
const store = require('./store');

const RANGES = ['overdue', 'today', 'week', 'dates'];
const MAX_ROWS = 300;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** the last day (Sunday) of the week of a day */
function weekEnd(day) { const d = new Date(`${day}T00:00:00Z`); const wd = d.getUTCDay(); return addDays(day, wd === 0 ? 0 : 7 - wd); }

const can = (user, module) => access.isSuper(user) || !!(user.permissions && user.permissions[module] && user.permissions[module].view);
const PHONE = { leads: 'mobile', contacts: "COALESCE(mobile, phone)", accounts: 'phone', opportunities: null };

function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return new Map();
  return new Map(db.prepare(`SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), username) AS name FROM users WHERE id IN (${list.map(() => '?').join(',')})`).all(...list).map((u) => [Number(u.id), u.name]));
}
function phonesOf(module, ids) {
  const col = PHONE[module];
  if (!col || !ids.length) return new Map();
  try {
    return new Map(db.prepare(`SELECT id, ${col} AS phone FROM ${module} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => [Number(r.id), r.phone || '']));
  } catch { return new Map(); }
}

/**
 * @param q { range, from, to, view }
 */
function list(user, q = {}) {
  const range = RANGES.includes(q.range) ? q.range : 'today';
  const view = q.view || 'me';
  const ids = viewing.resolve(user, view);                 // null = everyone
  const today = fu.crmDate(new Date().toISOString());
  const wEnd = weekEnd(today);
  let from = isDay(q.from) ? q.from : today;
  let to = isDay(q.to) ? q.to : from;
  if (to < from) [from, to] = [to, from];
  if (range === 'dates' && addDays(from, 92) < to) throw store.bad('Choose at most 3 months at a time.');

  // everything that can count: overdue (before today), and up to the end of this week / the dates asked
  const last = [to, wEnd, today].sort().pop();
  const rows = db.prepare(`SELECT * FROM follow_ups WHERE status = 'Scheduled' AND due_date <= ? ORDER BY COALESCE(snoozed_until, due_at) LIMIT 20000`).all(last);
  const infos = fu.infoForRows(rows);
  const now = new Date();
  const mine = [];
  for (const f of rows) {
    if (!can(user, f.related_module)) continue;
    const info = infos.get(`${f.related_module}:${Number(f.related_record_id)}`);
    if (!info) continue;                                      // the record is gone
    const who = fu.assigneeOf(f, info);
    if (ids !== null && !ids.includes(Number(who))) continue;
    mine.push({ f, info, who, status: fu.displayStatus(f, now) });
  }
  // (the follow-ups' own rule: an hour past its time, or a day that has ended; a snoozed one waits)
  const isOverdue = (x) => x.status === 'Overdue';
  const pick = {
    overdue: (x) => isOverdue(x),
    today: (x) => x.f.due_date === today,
    week: (x) => x.f.due_date >= today && x.f.due_date <= wEnd,
    dates: (x) => x.f.due_date >= from && x.f.due_date <= to,
  };
  const counts = { overdue: mine.filter(pick.overdue).length, today: mine.filter(pick.today).length, week: mine.filter(pick.week).length };
  const chosen = mine.filter(pick[range]);
  if (range === 'dates') counts.dates = chosen.length;
  const shown = chosen.slice(0, MAX_ROWS);

  const names = namesOf(shown.map((x) => x.who));
  const phones = new Map();
  for (const mod of [...new Set(shown.map((x) => x.f.related_module))]) {
    phones.set(mod, phonesOf(mod, shown.filter((x) => x.f.related_module === mod).map((x) => Number(x.f.related_record_id))));
  }
  const out = shown.map(({ f, info, who, status }) => ({
    id: Number(f.id), module: f.related_module, record_id: Number(f.related_record_id), title: info.label,
    subject: f.subject || '', notes: f.notes || '', due_at: f.due_at, due_date: f.due_date, has_time: !!f.has_time,
    snoozed_until: f.snoozed_until || null, status, overdue: isOverdue({ f, status }),
    assignee_id: who ? Number(who) : null, assignee_name: names.get(Number(who)) || '',
    phone: (phones.get(f.related_module) || new Map()).get(Number(f.related_record_id)) || '',
  }));
  // the team view: how many each person has
  const byPerson = [];
  if (view !== 'me') {
    const m = new Map();
    for (const x of chosen) {
      const k = Number(x.who) || 0;
      if (!m.has(k)) m.set(k, { id: k, name: '', count: 0, overdue: 0 });
      const p = m.get(k); p.count += 1; if (isOverdue(x)) p.overdue += 1;
    }
    const allNames = namesOf([...m.keys()]);
    for (const p of m.values()) { p.name = allNames.get(p.id) || 'No one'; byPerson.push(p); }
    byPerson.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return {
    range, view, view_label: viewing.labelOf(user, view), today, week_end: wEnd, from: range === 'dates' ? from : null, to: range === 'dates' ? to : null,
    counts, total: chosen.length, rows: out, by_person: byPerson, more: chosen.length > shown.length,
  };
}

module.exports = { list, weekEnd };
