// ============================================================================
// Phone alerts for "this is yours now" (v1.4): a lead, customer, deal, task or
// quotation given to someone, and a meeting someone is invited to.
//
// Called for every record created or changed anywhere in the CRM (the same
// place the workflows start: services/workflowAutomation.fireWorkflows), so a
// lead assigned by hand, by a rule, by an import or from the app all alert the
// same way. Nobody is alerted about what they did themselves.
// ============================================================================
const db = require('../../db');

const OWNER = {
  leads: { name: 'assigned_counselor', title: (r) => r.student_name, what: 'New lead for you' },
  contacts: { col: 'owner_id', title: (r) => [r.first_name, r.last_name].filter(Boolean).join(' '), what: 'A contact is yours now' },
  accounts: { col: 'owner_id', title: (r) => r.account_name, what: 'A customer is yours now' },
  opportunities: { col: 'owner_id', title: (r) => r.opportunity_name, what: 'A deal is yours now' },
  quotations: { col: 'salesperson_id', title: (r) => r.quote_number, what: 'A quotation is yours now' },
  tasks: { col: 'assigned_to_id', title: (r) => r.task_title, what: 'A task for you', extra: (r) => (r.due_date ? `due ${String(r.due_date).slice(0, 10)}` : '') },
  subscriptions: { col: 'owner_id', title: (r) => r.subscription_number || r.plan, what: 'A subscription is yours now' },
};
const APP = new Set(['leads', 'contacts', 'accounts', 'opportunities', 'quotations', 'subscriptions', 'meetings', 'calls', 'tasks']);

function userIdByName(name) {
  const k = String(name || '').trim().toLowerCase();
  if (!k) return null;
  const u = db.prepare('SELECT id FROM users WHERE LOWER(TRIM(full_name)) = ? OR LOWER(TRIM(username)) = ? ORDER BY id LIMIT 1').get(k, k);
  return u ? Number(u.id) : null;
}
const ownerOf = (cfg, r) => {
  if (!r) return null;
  if (cfg.name) return userIdByName(r[cfg.name]);
  const v = r[cfg.col];
  return v === null || v === undefined || v === '' ? null : Number(v);
};
const attendeeUsers = (r) => {
  let list = [];
  try { list = JSON.parse((r && r.attendees_json) || '[]'); } catch { list = []; }
  return new Set((Array.isArray(list) ? list : []).filter((a) => a && (a.kind === 'user' || a.module === 'users') && a.record_id).map((a) => Number(a.record_id)));
};
function when(v) {
  const s = String(v || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) return s.slice(0, 16);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}, ${m[4]}:${m[5]}`;
}

function maybe(module, eventType, record, previous, actorId) {
  if (!record || record.id === undefined || record.id === null) return;
  if (eventType !== 'record_created' && eventType !== 'record_updated') return;
  let phone;
  try { phone = require('./phone'); } catch { return; }
  if (!phone.ready()) return;
  const actor = Number(actorId) || 0;
  const route = APP.has(module) ? `/m/${module}/${record.id}` : '/';

  if (module === 'meetings') {
    // invited now (and not before), and not the one who made the change
    const before = eventType === 'record_updated' ? attendeeUsers(previous) : new Set();
    const now = attendeeUsers(record);
    const owner = Number(record.assigned_user_id) || null;
    if (owner && owner !== actor && (eventType === 'record_created' || Number(previous && previous.assigned_user_id) !== owner)) now.add(owner);
    const to = [...now].filter((u) => u !== actor && !before.has(u));
    if (!to.length) return;
    phone.notify(to, {
      kind: 'meeting', title: 'Meeting invite', route, tag: `meeting-${record.id}`,
      body: `${record.meeting_title || 'A meeting'} · ${when(record.start_datetime)}${record.video_link ? ' · online' : ''}`,
    }).catch(() => {});
    return;
  }
  const cfg = OWNER[module];
  if (!cfg) return;
  const owner = ownerOf(cfg, record);
  if (!owner || owner === actor) return;
  if (eventType === 'record_updated' && ownerOf(cfg, previous) === owner) return;
  const extra = cfg.extra ? cfg.extra(record) : '';
  phone.notify([owner], {
    kind: 'assigned', title: cfg.what, route, tag: `${module}-${record.id}`,
    body: [cfg.title(record) || `#${record.id}`, extra].filter(Boolean).join(' · '),
  }).catch(() => {});
}

module.exports = { maybe };
