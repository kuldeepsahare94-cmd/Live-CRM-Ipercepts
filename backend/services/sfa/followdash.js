// ============================================================================
// Follow-ups for a dashboard (v1.4): mine, or my team's — overdue, today,
// this week, or between two dates. Used by the app's Home and Team screens and
// by the web dashboard.
//
//   GET /api/sfa/m/follow-ups?range=overdue|today|week|dates&from=&to=&view=me|all|user:5|team:2|role:3&q=(search, v1.5)
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

const RANGES = ['overdue', 'today', 'week', 'dates', 'none'];
const CLOSED_LEAD = ['Converted', 'Not Interested', 'Dropped', 'Lost'];
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
 * (v1.7) The leads still being worked on that have NO follow-up planned: no follow-up date and no open
 * follow-up. Only leads (the others have no "worked on" state), only the ones this person may see, and
 * of the people the view asks for. Hot first, then the newest.
 */
function noPlanLeads(user, ids, term, limit) {
  if (!can(user, 'leads')) return { count: 0, rows: [] };
  const where = [`COALESCE(l.status, '') NOT IN (${CLOSED_LEAD.map(() => '?').join(',')})`,
    "COALESCE(TRIM(CAST(l.follow_up_date AS TEXT)), '') = ''",
    "NOT EXISTS (SELECT 1 FROM follow_ups fx WHERE fx.related_module = 'leads' AND fx.related_record_id = l.id AND fx.status = 'Scheduled')"];
  const params = [...CLOSED_LEAD];
  const scope = access.where(user, 'leads', 'l');
  if (scope.sql) { where.push(scope.sql.replace(/^\s*AND\s*/i, '')); params.push(...scope.params); }
  if (ids !== null) {
    const ow = viewing.ownerWhere('leads', 'l', ids);
    if (ow.sql) { where.push(ow.sql.replace(/^\s*AND\s*/i, '')); params.push(...ow.params); }
  }
  if (term) {
    const p = `%${String(term).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(LOWER(COALESCE(l.student_name, '')) LIKE ? OR LOWER(COALESCE(l.mobile, '')) LIKE ? OR LOWER(COALESCE(l.account_name, '')) LIKE ?)");
    params.push(p, p, p);
  }
  const W = `FROM leads l WHERE ${where.join(' AND ')}`;
  const count = Number(db.prepare(`SELECT COUNT(*) AS n ${W}`).get(...params).n) || 0;
  const rows = limit > 0 ? db.prepare(`SELECT l.id, l.student_name, l.account_name, l.mobile, l.status, l.lead_rating, l.assigned_counselor, l.created_at,
      (SELECT MAX(cx.start_time) FROM calls cx WHERE cx.related_module = 'leads' AND cx.related_record_id = l.id) AS last_call
    ${W} ORDER BY CASE LOWER(COALESCE(l.lead_rating, '')) WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END, l.id DESC LIMIT ${Number(limit)}`).all(...params) : [];
  return { count, rows };
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
  // (v1.7) leads nobody has planned a follow-up for
  const termNone = String(q.q || '').trim();
  const nop = noPlanLeads(user, ids, range === 'none' ? termNone : '', range === 'none' ? MAX_ROWS : 0);
  counts.none = range === 'none' && termNone ? noPlanLeads(user, ids, '', 0).count : nop.count;
  if (range === 'none') {
    const owners = new Map(db.prepare("SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), username) AS name FROM users").all().map((u) => [u.name, Number(u.id)]));
    return {
      range, view, view_label: viewing.labelOf(user, view), today, week_end: wEnd, from: null, to: null,
      counts, total: nop.count, by_person: [], more: nop.count > nop.rows.length,
      rows: nop.rows.map((l) => ({
        id: -Number(l.id), module: 'leads', record_id: Number(l.id), title: l.student_name || `#${l.id}`, company: l.account_name || '', subject: '', notes: '',
        due_at: null, due_date: null, has_time: false, snoozed_until: null, status: 'No follow-up', overdue: false, no_plan: true,
        lead_status: l.status || '', rating: l.lead_rating || '', phone: l.mobile || '', created_at: l.created_at, last_call: l.last_call || null,
        assignee_id: owners.get(l.assigned_counselor) || null, assignee_name: l.assigned_counselor || '',
      })),
    };
  }
  // (v1.5) a search: the customer's name, the follow-up's subject or note
  const term = String(q.q || '').trim().toLowerCase();
  const found = (x) => !term || [x.info.label, x.f.subject, x.f.notes].some((v) => String(v || '').toLowerCase().includes(term));
  const chosen = mine.filter(pick[range]).filter(found);
  if (range === 'dates') counts.dates = chosen.length;
  const shown = chosen.slice(0, MAX_ROWS);

  const names = namesOf(shown.map((x) => x.who));
  const phones = new Map();
  for (const mod of [...new Set(shown.map((x) => x.f.related_module))]) {
    phones.set(mod, phonesOf(mod, shown.filter((x) => x.f.related_module === mod).map((x) => Number(x.f.related_record_id))));
  }
  const leadIds = shown.filter((x) => x.f.related_module === 'leads').map((x) => Number(x.f.related_record_id));
  const extra = new Map();
  if (leadIds.length) {
    try {
      db.prepare(`SELECT id, lead_rating, account_name FROM leads WHERE id IN (${leadIds.map(() => '?').join(',')})`).all(...leadIds)
        .forEach((r) => extra.set(Number(r.id), { rating: r.lead_rating || '', company: r.account_name || '' }));
    } catch { /* an older database */ }
  }
  const out = shown.map(({ f, info, who, status }) => ({
    id: Number(f.id), module: f.related_module, record_id: Number(f.related_record_id), title: info.label,
    subject: f.subject || '', notes: f.notes || '', due_at: f.due_at, due_date: f.due_date, has_time: !!f.has_time,
    snoozed_until: f.snoozed_until || null, status, overdue: isOverdue({ f, status }),
    assignee_id: who ? Number(who) : null, assignee_name: names.get(Number(who)) || '',
    phone: (phones.get(f.related_module) || new Map()).get(Number(f.related_record_id)) || '',
    // (v1.5) how hot a lead is (Hot / Warm / Cold), and its company, on the follow-up's card
    rating: f.related_module === 'leads' ? ((extra.get(Number(f.related_record_id)) || {}).rating || '') : '',
    company: f.related_module === 'leads' ? ((extra.get(Number(f.related_record_id)) || {}).company || '') : '',
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
