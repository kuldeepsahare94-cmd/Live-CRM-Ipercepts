// ============================================================================
// "Viewing": whose data a list or a dashboard shows (v1.4).
// ============================================================================
// A manager or an administrator can look at one person, a team or a role
// (a "group" of people with the same job) instead of everyone they can see.
//
//   options(user)          the people / teams / roles this user may choose from
//   resolve(user, view)    'me' | 'all' | 'user:5' | 'team:2' | 'role:3'  →  [user ids] | null (= no limit)
//   ownerWhere(module, alias, ids)   SQL that keeps the records owned by those people
//
// Who may look at whom is the same rule as the field-force map: an
// administrator (and the roles chosen in Settings → Field force → "Can see
// everyone") sees everyone; anyone else sees themselves and the people below
// them (Users → Reports to, and the teams they lead). The record visibility of
// Roles & Permissions still applies on top: this only narrows a list down.
// ============================================================================
const db = require('../../db');
const access = require('../recordAccess');
const store = require('./store');

const NAME = (a) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.username)`;

function seesAll(user) {
  if (access.isSuper(user)) return true;
  try { return store.getSettings().viewer_role_ids.includes(Number(user.role_id)); } catch { return false; }
}
/** the user ids this person may look at; null = everyone */
function visibleIds(user) {
  if (seesAll(user)) return null;
  return access.teamOf(user.id).map(Number);
}

function activeUsers() {
  return db.prepare(`SELECT u.id, ${NAME('u')} AS name, u.role_id, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE COALESCE(u.active, 1) = 1 ORDER BY ${NAME('u')}`).all();
}
function teamRows() {
  try {
    const teams = db.prepare('SELECT id, name, lead_user_id FROM teams WHERE COALESCE(active, 1) = 1 ORDER BY name').all();
    const members = db.prepare('SELECT team_id, user_id FROM team_members').all();
    return teams.map((t) => ({
      id: Number(t.id), name: t.name, lead: t.lead_user_id ? Number(t.lead_user_id) : null,
      members: [...new Set([...members.filter((m) => Number(m.team_id) === Number(t.id)).map((m) => Number(m.user_id)), ...(t.lead_user_id ? [Number(t.lead_user_id)] : [])])],
    }));
  } catch { return []; }
}

/** What the "Viewing" picker offers this person. `can` false = only themselves (no picker). */
function options(user) {
  const ids = visibleIds(user);
  const people = activeUsers().filter((u) => ids === null || ids.includes(Number(u.id)))
    .map((u) => ({ id: Number(u.id), name: u.name, role_id: u.role_id ? Number(u.role_id) : null, role: u.role_name || '' }));
  const seen = new Set(people.map((p) => p.id));
  // (a team someone does not lead is offered only when they may see all of its people)
  const teams = teamRows().filter((t) => ids === null || t.lead === Number(user.id) || t.members.every((m) => seen.has(m)))
    .map((t) => ({ id: t.id, name: t.name, members: t.members.filter((m) => seen.has(m)), count: t.members.filter((m) => seen.has(m)).length }))
    .filter((t) => t.count > 0);
  const roleMap = new Map();
  for (const p of people) if (p.role_id) roleMap.set(p.role_id, { id: p.role_id, name: p.role || `Role ${p.role_id}`, count: (roleMap.get(p.role_id)?.count || 0) + 1 });
  return {
    can: people.length > 1,
    sees_all: ids === null,
    me: Number(user.id),
    people,
    teams,
    roles: [...roleMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * The people a "view" means, within what this person may see.
 * @returns null when nothing narrows the list ('all' for someone who sees everyone)
 */
function resolve(user, view) {
  const v = String(view || '').trim();
  if (!v || v === 'all') {
    const ids = visibleIds(user);
    return ids === null ? null : ids;
  }
  if (v === 'me' || v === 'mine') return [Number(user.id)];
  const m = /^(user|team|role):(\d{1,12})$/.exec(v);
  if (!m) throw store.bad('Choose whose data to see again.');
  const id = Number(m[2]);
  let want = [];
  if (m[1] === 'user') want = [id];
  else if (m[1] === 'team') { const t = teamRows().find((x) => x.id === id); want = t ? t.members : []; }
  else want = activeUsers().filter((u) => Number(u.role_id) === id).map((u) => Number(u.id));
  const ids = visibleIds(user);
  const out = ids === null ? want : want.filter((x) => ids.includes(x));
  return out;
}

/** a short label of a view, for a screen ("Asha", "Team North", "Sales Executives") */
function labelOf(user, view) {
  const v = String(view || '');
  if (!v || v === 'all') return 'Everyone';
  if (v === 'me' || v === 'mine') return 'Me';
  const m = /^(user|team|role):(\d+)$/.exec(v);
  if (!m) return '';
  const id = Number(m[2]);
  if (m[1] === 'user') { const u = db.prepare(`SELECT ${NAME('u')} AS name FROM users u WHERE id = ?`).get(id); return u ? u.name : ''; }
  if (m[1] === 'team') { const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(id); return t ? t.name : ''; }
  const r = db.prepare('SELECT name FROM roles WHERE id = ?').get(id); return r ? r.name : '';
}

// how each module's records are owned (the same columns Roles & Permissions uses)
const OWNERS = {
  leads: { name: 'assigned_counselor' },
  contacts: { cols: ['owner_id'] },
  accounts: { cols: ['owner_id'] },
  opportunities: { cols: ['owner_id'] },
  quotations: { cols: ['salesperson_id'] },
  subscriptions: { cols: ['owner_id'] },
  meetings: { cols: ['assigned_user_id', 'organizer_id'] },
  calls: { cols: ['assigned_user_id'], creator: 'created_by' },
  tasks: { cols: ['assigned_to_id'] },
  notes: { cols: [], creator: 'created_by' },
  documents: { cols: [], creator: 'uploaded_by' },
};

/** → { sql: ' AND (…)', params } keeping the records owned by these people ('' when ids is null) */
function ownerWhere(module, alias, ids) {
  if (ids === null || ids === undefined) return { sql: '', params: [] };
  if (!ids.length) return { sql: ' AND 1 = 0', params: [] };
  const a = alias ? `${alias}.` : '';
  const o = OWNERS[module];
  if (!o) return { sql: '', params: [] };
  const marks = ids.map(() => '?').join(',');
  if (o.name) {
    const names = [];
    const rows = db.prepare(`SELECT full_name, username FROM users WHERE id IN (${marks})`).all(...ids);
    for (const r of rows) for (const n of [r.full_name, r.username]) { const k = String(n || '').trim().toLowerCase(); if (k) names.push(k); }
    if (!names.length) return { sql: ' AND 1 = 0', params: [] };
    return { sql: ` AND LOWER(TRIM(COALESCE(${a}${o.name}, ''))) IN (${names.map(() => '?').join(',')})`, params: names };
  }
  const parts = []; const params = [];
  for (const c of o.cols) { parts.push(`${a}${c} IN (${marks})`); params.push(...ids); }
  if (o.creator && !o.cols.length) { parts.push(`${a}${o.creator} IN (${marks})`); params.push(...ids); }
  return parts.length ? { sql: ` AND (${parts.join(' OR ')})`, params } : { sql: '', params: [] };
}

module.exports = { options, resolve, labelOf, ownerWhere, visibleIds, seesAll, OWNERS };
