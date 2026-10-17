// ============================================================================
// Everything linked to one record, for the mobile app's record page ("360"):
// visits, calls (with recordings), orders / quotations, deals, meetings, tasks,
// notes, follow-ups — and for a customer also its contacts, invoices,
// proformas, payments, tickets and subscriptions. Counts, a short list of each,
// a few figures, and one timeline of everything.
//
//   GET /api/sfa/m/related/:module/:id     module: leads | contacts | accounts | opportunities
//
// Each list follows the person's record visibility (Roles & Permissions): the
// calls, meetings, tasks and notes of a record they may open are theirs to see
// (as on the web); deals, orders, invoices… only when their role sees them.
// ============================================================================
const db = require('../../db');
const access = require('../recordAccess');
const store = require('./store');

const { bad, idOf } = store;
const MODULES = ['leads', 'contacts', 'accounts', 'opportunities'];
// (v1.4) every module of the app has a record page with notes, files and (for most) activities
const ALL = [...MODULES, 'quotations', 'subscriptions', 'meetings', 'calls', 'tasks', 'products', 'tickets', 'invoices', 'payments'];
const ACTIVITY = new Set(['meetings', 'calls', 'tasks']);
const TABLE = { leads: 'leads', contacts: 'contacts', accounts: 'accounts', opportunities: 'opportunities', quotations: 'quotations', subscriptions: 'subscriptions', meetings: 'meetings', calls: 'calls', tasks: 'tasks', products: 'products', tickets: 'tickets', invoices: 'sales_documents', payments: 'payments' };
const LIMIT = 20;

const isSuper = (user) => access.isSuper(user);
const can = (user, module) => isSuper(user) || !!(user.permissions && user.permissions[module] && user.permissions[module].view);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** one list: its rows (newest first) and how many there are */
function section(user, module, { from, where, params, select, order, activity, relMod, relId }) {
  if (!can(user, module)) return null;
  const scope = activity ? access.whereActivity(user, module, 't', relMod, relId) : access.where(user, module, 't');
  const W = `FROM ${from} WHERE ${where}${scope.sql}`;
  const p = [...params, ...scope.params];
  try {
    const total = Number(db.prepare(`SELECT COUNT(*) AS n ${W}`).get(...p).n) || 0;
    const rows = total ? db.prepare(`SELECT ${select} ${W} ORDER BY ${order} LIMIT ${LIMIT}`).all(...p) : [];
    return { total, rows };
  } catch (e) {
    console.warn(`[related] ${module}:`, e.message);
    return null;
  }
}

function related(user, module, idIn) {
  if (!ALL.includes(module)) throw bad('Not here.', 404);
  const id = idOf(idIn);
  if (!id) throw bad('Not found', 404);
  if (!can(user, module)) throw bad(`Your role cannot open ${module}.`, 403);
  const table = TABLE[module];
  const rec = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!rec) throw bad('Not found', 404);
  if (!access.canOpen(user, module, id)) throw bad('This record belongs to someone else.', 403);

  const out = {};
  const act = (key, mod, select, order) => {
    const s = section(user, mod, { from: `${mod} t`, where: 't.related_module = ? AND t.related_record_id = ?', params: [module, id], select, order, activity: true, relMod: module, relId: id });
    if (s) out[key] = s;
  };
  // --- what was done with it ---------------------------------------------------
  const own = !ACTIVITY.has(module) && !['products', 'invoices', 'payments'].includes(module);    // a call or a task has no calls of its own
  if (own) act('calls', 'calls', `t.id, t.call_subject, t.direction, t.connected, t.status, t.duration_seconds, COALESCE(t.start_time, t.created_at) AS at, t.call_outcome,
    t.notes, t.call_recording_url, t.recording_id, t.call_source, t.phone_number`, 't.id DESC');
  if (own) act('meetings', 'meetings', 't.id, t.meeting_title, t.start_datetime AS at, t.status, t.outcome, t.video_link', 't.start_datetime DESC');
  if (own) act('tasks', 'tasks', 't.id, t.task_title, t.due_date AS at, t.status', "CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END, t.due_date");
  act('notes', 'notes', 't.id, t.title, t.body, t.created_at AS at', 't.id DESC');
  // files on the record (v1.4): each with a link the app can open
  {
    const s = section(user, 'documents', { from: 'documents t', where: 't.related_module = ? AND t.related_record_id = ?', params: [module, id],
      select: 't.id, t.title, t.file_name, t.mime_type, t.size_bytes, t.external_url, t.stored_name, t.created_at AS at, t.uploaded_by', order: 't.id DESC', activity: true, relMod: module, relId: id });
    if (s) {
      const files = require('./mfiles');
      s.rows = s.rows.map((r) => ({ id: r.id, title: r.title, file_name: r.file_name, mime_type: r.mime_type, size_bytes: r.size_bytes, at: r.at,
        url: r.stored_name ? files.signedUrl('doc', r.id) : (r.external_url || null), external: !r.stored_name }));
      out.files = s;
    }
  }
  // follow-ups: as the record (anyone who may open it)
  if (module !== 'products') try {
    const rows = db.prepare(`SELECT id, subject, notes, status, COALESCE(due_at, due_date) AS at, has_time FROM follow_ups WHERE related_module = ? AND related_record_id = ? ORDER BY COALESCE(due_at, due_date) DESC LIMIT ${LIMIT}`).all(module, id);
    const total = Number(db.prepare('SELECT COUNT(*) AS n FROM follow_ups WHERE related_module = ? AND related_record_id = ?').get(module, id).n) || 0;
    out.follow_ups = { total, rows };
  } catch { /* no follow-ups table */ }
  // visits (Field force)
  try {
    if (own && store.getSettings().enabled) {
      const v = require('./field').listVisits(user, { related_module: module, related_record_id: id }).rows;
      out.visits = {
        total: v.length,
        rows: v.slice(0, LIMIT).map((x) => ({ id: x.id, at: x.in_at, out_at: x.out_at, user_name: x.user_name, outcome: x.outcome, notes: x.notes, photos: x.files ? x.files.length : (x.photo_count || 0), status: x.status, recording: x.recording_id ? 1 : 0 })),
      };
    }
  } catch { /* Field force off for this person */ }

  // --- what hangs under it -----------------------------------------------------
  const link = {
    accounts: { opp: 't.account_id', quote: 't.account_id', doc: 't.account_id', pay: 't.account_id', ticket: 't.account_id', sub: 't.account_id' },
    contacts: { opp: 't.primary_contact_id', quote: 't.contact_id', doc: 't.contact_id', pay: 't.contact_id', ticket: 't.contact_id', sub: 't.contact_id' },
    opportunities: { quote: 't.opportunity_id', doc: 't.opportunity_id', pay: 't.opportunity_id', sub: 't.opportunity_id' },
    leads: {},
    subscriptions: { pay: 't.subscription_id' },
  }[module] || {};
  let key = id;
  // a converted lead: what was made from it
  if (module === 'leads') {
    key = null;
    out.converted = rec.converted_account_id || rec.converted_contact_id || rec.converted_opportunity_id ? {
      account_id: num(rec.converted_account_id), contact_id: num(rec.converted_contact_id), opportunity_id: num(rec.converted_opportunity_id),
    } : null;
    if (rec.converted_opportunity_id) {
      const s = section(user, 'opportunities', { from: 'opportunities t LEFT JOIN module_pipeline_stages st ON st.id = t.stage_id', where: 't.id = ?', params: [rec.converted_opportunity_id],
        select: 't.id, t.opportunity_name, t.amount, st.name AS stage, t.expected_close_date, t.created_at AS at', order: 't.id DESC' });
      if (s) out.opportunities = s;
    }
    if (rec.converted_account_id) {
      const s = section(user, 'quotations', { from: 'quotations t', where: 't.account_id = ?', params: [rec.converted_account_id],
        select: 't.id, t.quote_number, t.grand_total, t.status, t.quote_date, t.created_at AS at', order: 't.id DESC' });
      if (s) out.quotations = s;
    }
  }
  if (key && link.opp) {
    const s = section(user, 'opportunities', { from: 'opportunities t LEFT JOIN module_pipeline_stages st ON st.id = t.stage_id', where: `${link.opp} = ?`, params: [key],
      select: 't.id, t.opportunity_name, t.amount, st.name AS stage, t.expected_close_date, t.created_at AS at', order: 't.id DESC' });
    if (s) out.opportunities = s;
  }
  if (key && link.quote) {
    const s = section(user, 'quotations', { from: 'quotations t', where: `${link.quote} = ?`, params: [key],
      select: 't.id, t.quote_number, t.grand_total, t.status, t.quote_date, t.created_at AS at', order: 't.id DESC' });
    if (s) out.quotations = s;
  }
  if (key && module === 'accounts') {
    const s = section(user, 'contacts', { from: 'contacts t', where: 't.account_id = ?', params: [key],
      select: "t.id, TRIM(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) AS name, t.job_title, t.mobile, t.email, t.created_at AS at", order: 't.id DESC' });
    if (s) out.contacts = s;
  }
  if (key && link.doc) {
    for (const [k, mod, type] of [['invoices', 'invoices', 'invoice'], ['proformas', 'proforma_invoices', 'proforma']]) {
      const s = section(user, mod, { from: 'sales_documents t', where: `t.doc_type = ? AND ${link.doc} = ?`, params: [type, key],
        select: 't.id, t.doc_number, t.doc_date, t.grand_total, t.balance_due, t.payment_status, t.status, t.created_at AS at', order: 't.id DESC' });
      if (s) out[k] = s;
    }
  }
  if (key && link.pay) {
    const s = section(user, 'payments', { from: 'payments t', where: `${link.pay} = ?`, params: [key],
      select: 't.id, t.payment_number, t.amount, t.status, t.payment_date, t.due_date, t.created_at AS at', order: 't.id DESC' });
    if (s) out.payments = s;
  }
  if (key && link.ticket) {
    const s = section(user, 'tickets', { from: 'tickets t', where: `${link.ticket} = ?`, params: [key],
      select: 't.id, t.ticket_number, t.subject, t.status, t.created_at AS at', order: 't.id DESC' });
    if (s) out.tickets = s;
  }
  if (key && link.sub) {
    const s = section(user, 'subscriptions', { from: 'subscriptions t', where: `${link.sub} = ?`, params: [key],
      select: 't.id, t.subscription_number, t.plan, t.status, t.recurring_amount, t.renewal_date, t.created_at AS at', order: 't.id DESC' });
    if (s) out.subscriptions = s;
  }

  // (v1.10) e-mails written to / received from this record
  if (['leads', 'contacts', 'accounts', 'opportunities', 'tickets'].includes(module)) {
    const s = section(user, 'emails', { from: 'emails t', where: 't.related_module = ? AND t.related_record_id = ?', params: [module, id],
      select: "t.id, t.subject, t.direction, t.status, t.from_address, t.to_address, COALESCE(t.sent_at, t.received_at, t.created_at) AS at", order: 't.id DESC', activity: true, relMod: module, relId: id });
    if (s) out.emails = s;
  }
  // (v1.10) an account: the leads that were converted into it
  if (module === 'accounts') {
    const s = section(user, 'leads', { from: 'leads t', where: 't.converted_account_id = ?', params: [id],
      select: 't.id, t.student_name AS name, t.status, t.mobile, t.converted_at, t.created_at AS at', order: 't.id DESC' });
    if (s) out.leads = s;
  }
  // (v1.10) a deal: the people at its customer
  if (module === 'opportunities' && rec.account_id) {
    const s = section(user, 'contacts', { from: 'contacts t', where: 't.account_id = ?', params: [rec.account_id],
      select: "t.id, TRIM(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) AS name, t.job_title, t.mobile, t.email, t.created_at AS at", order: `CASE WHEN t.id = ${Number(rec.primary_contact_id) || 0} THEN 0 ELSE 1 END, t.id DESC` });
    if (s) out.contacts = s;
  }
  // (v1.10) a product: the quotations it is on
  if (module === 'products') {
    const s = section(user, 'quotations', { from: 'quotations t', where: 'EXISTS (SELECT 1 FROM quotation_items qi WHERE qi.quotation_id = t.id AND qi.product_id = ?)', params: [id],
      select: 't.id, t.quote_number, t.grand_total, t.status, t.quote_date, t.created_at AS at', order: 't.id DESC' });
    if (s) out.quotations = s;
  }
  // (v1.10) a quotation / an invoice: what was made from it, and what it was made from
  if (module === 'quotations') {
    for (const [k, mod, type] of [['invoices', 'invoices', 'invoice'], ['proformas', 'proforma_invoices', 'proforma']]) {
      const s = section(user, mod, { from: 'sales_documents t', where: 't.doc_type = ? AND t.quotation_id = ?', params: [type, id],
        select: 't.id, t.doc_number, t.doc_date, t.grand_total, t.balance_due, t.payment_status, t.status, t.created_at AS at', order: 't.id DESC' });
      if (s) out[k] = s;
    }
  }
  if (module === 'invoices') {
    const s = section(user, 'payments', { from: 'payments t', where: 't.document_id = ?', params: [id],
      select: 't.id, t.payment_number, t.amount, t.status, t.payment_date, t.due_date, t.created_at AS at', order: 't.id DESC' });
    if (s) out.payments = s;
  }
  // --- what it belongs to (v1.10): the parent records, each one a link to its page --------------
  const links = [];
  const linkTo = (mod, rid, label, sqlTitle, table) => {
    const n = Number(rid);
    if (!n || !can(user, mod)) return;
    try {
      if (!access.canOpen(user, mod, n)) return;
      const r = db.prepare(`SELECT ${sqlTitle} AS title FROM ${table} WHERE id = ?`).get(n);
      if (r) links.push({ module: mod, id: n, label, title: r.title || `#${n}` });
    } catch { /* not readable: left out */ }
  };
  const ACC = ['accounts', 'account_name', 'accounts'];
  const CON = ['contacts', "TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))", 'contacts'];
  const OPP = ['opportunities', 'opportunity_name', 'opportunities'];
  const QUO = ['quotations', 'quote_number', 'quotations'];
  const by = (spec, rid, label) => linkTo(spec[0], rid, label, spec[1], spec[2]);
  if (module === 'contacts') by(ACC, rec.account_id, 'Customer');
  if (module === 'opportunities') { by(ACC, rec.account_id, 'Customer'); by(CON, rec.primary_contact_id, 'Primary contact'); }
  if (['quotations', 'subscriptions', 'tickets', 'invoices', 'payments'].includes(module)) { by(ACC, rec.account_id, 'Customer'); by(CON, rec.contact_id, 'Contact'); by(OPP, rec.opportunity_id, 'Deal'); }
  if (module === 'invoices' || module === 'payments') by(QUO, rec.quotation_id, 'Quotation');
  if (module === 'payments' && rec.document_id) linkTo('invoices', rec.document_id, 'Invoice', 'doc_number', 'sales_documents');
  if ((module === 'payments' || module === 'tickets') && rec.subscription_id) linkTo('subscriptions', rec.subscription_id, 'Subscription', 'subscription_number', 'subscriptions');
  if (module === 'leads') {
    by(ACC, rec.converted_account_id, 'Converted to customer'); by(CON, rec.converted_contact_id, 'Converted to contact'); by(OPP, rec.converted_opportunity_id, 'Converted to deal');
  }
  if ((ACTIVITY.has(module) || module === 'tickets') && rec.related_module && rec.related_record_id) {
    const spec = { leads: ['leads', 'student_name', 'leads'], contacts: CON, accounts: ACC, opportunities: OPP, quotations: QUO }[rec.related_module];
    if (spec) by(spec, rec.related_record_id, 'For');
  }

  // --- a few figures -----------------------------------------------------------
  const sum = (s, f) => (s ? s.rows.reduce((a, r) => a + (Number(r[f]) || 0), 0) : 0);
  const figures = {};
  if (out.emails) figures.emails = out.emails.total;
  if (out.calls) {
    figures.calls = out.calls.total;
    figures.talk_seconds = sum(out.calls, 'duration_seconds');
    figures.last_call = out.calls.rows[0] ? out.calls.rows[0].at : null;
  }
  if (out.visits) { figures.visits = out.visits.total; figures.last_visit = out.visits.rows[0] ? out.visits.rows[0].at : null; }
  if (out.quotations) figures.orders_value = sum(out.quotations, 'grand_total');
  if (out.opportunities) figures.pipeline_value = sum(out.opportunities, 'amount');
  if (out.invoices) { figures.invoiced = sum(out.invoices, 'grand_total'); figures.balance_due = sum(out.invoices, 'balance_due'); }
  if (out.payments) figures.paid = out.payments.rows.filter((p) => /paid|received|success/i.test(p.status || '')).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  // the last time someone spoke to or met them (v1.4)
  {
    const t2 = (v) => { const x = String(v || ''); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(x) || x.length <= 10 ? x : `${x.replace(' ', 'T')}Z`) || 0; };
    const seen = [];
    if (out.calls) out.calls.rows.filter((r) => Number(r.connected) === 1 || !('connected' in r)).forEach((r) => seen.push(r.at));
    if (out.visits) out.visits.rows.forEach((r) => seen.push(r.at));
    if (out.meetings) out.meetings.rows.filter((r) => /complet|held|done/i.test(r.status || '') || t2(r.at) < Date.now()).forEach((r) => seen.push(r.at));
    const best = seen.filter(Boolean).sort((a, b) => t2(b) - t2(a))[0];
    if (out.calls || out.visits || out.meetings) figures.last_contact = best || null;
  }
  if (out.follow_ups) {
    const next = out.follow_ups.rows.filter((f) => !/complete|cancel|done/i.test(f.status || '')).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
    figures.next_follow_up = next ? next.at : null;
  }

  // --- one timeline ------------------------------------------------------------
  const T = [];
  const push = (type, s, fn) => { if (s) for (const r of s.rows) { const x = fn(r); if (x && x.at) T.push({ type, id: Number(r.id), ...x }); } };
  push('call', out.calls, (r) => ({ at: r.at, title: r.call_subject || (Number(r.connected) ? 'Call' : 'Call — not answered'), sub: [r.call_outcome, r.duration_seconds ? `${Math.round(r.duration_seconds / 60)} min` : null, r.notes].filter(Boolean).join(' · '), module: 'calls', recording: r.call_recording_url || null, connected: Number(r.connected) === 1, direction: r.direction, status: Number(r.connected) === 1 ? 'Connected' : (r.status || 'Not connected'), seconds: Number(r.duration_seconds) || 0 }));
  push('visit', out.visits, (r) => ({ at: r.at, title: `Visit${r.user_name ? ` by ${r.user_name}` : ''}`, sub: [r.outcome, r.notes].filter(Boolean).join(' · ') }));
  push('meeting', out.meetings, (r) => ({ at: r.at, title: r.meeting_title || 'Meeting', sub: [r.status, r.outcome].filter(Boolean).join(' · '), module: 'meetings', status: r.status || '' }));
  push('task', out.tasks, (r) => ({ at: r.at, title: r.task_title || 'Task', sub: r.status || '', module: 'tasks', status: r.status || '' }));
  push('note', out.notes, (r) => ({ at: r.at, title: r.title || 'Note', sub: String(r.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) }));
  push('follow_up', out.follow_ups, (r) => ({ at: r.at, title: r.subject || 'Follow-up', sub: r.notes || '', status: r.status || '', has_time: Number(r.has_time) === 1 }));
  push('order', out.quotations, (r) => ({ at: r.at, title: `Quotation ${r.quote_number || ''}`.trim(), sub: '', amount: num(r.grand_total), module: 'quotations', status: r.status || '' }));
  push('deal', out.opportunities, (r) => ({ at: r.at, title: r.opportunity_name || 'Deal', sub: '', amount: num(r.amount), module: 'opportunities', status: r.stage || '' }));
  push('invoice', out.invoices, (r) => ({ at: r.at, title: `Invoice ${r.doc_number || ''}`.trim(), sub: '', amount: num(r.grand_total), module: 'invoices', status: r.payment_status || r.status || '' }));
  push('payment', out.payments, (r) => ({ at: r.at, title: `Payment ${r.payment_number || ''}`.trim(), sub: '', amount: num(r.amount), module: 'payments', status: r.status || '' }));
  push('ticket', out.tickets, (r) => ({ at: r.at, title: r.subject || r.ticket_number || 'Ticket', sub: r.status || '', module: 'tickets', status: r.status || '' }));
  push('email', out.emails, (r) => ({ at: r.at, title: r.subject || '(no subject)', sub: [String(r.direction || '').toLowerCase() === 'inbound' ? `From ${r.from_address || ''}` : `To ${r.to_address || ''}`, r.status].filter(Boolean).join(' · '), status: r.status || '', direction: r.direction }));
  // ("2026-10-09 10:30:00" is UTC as the server writes it; an ISO time stays as it is)
  const t = (v) => { const s = String(v || ''); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`) || 0; };
  T.sort((a, b) => t(b.at) - t(a.at));

  const counts = Object.fromEntries(Object.entries(out).filter(([, v]) => v && typeof v.total === 'number').map(([k, v]) => [k, v.total]));
  // (v1.10) who owns it, by name (the record itself has only the number)
  let owner = module === 'leads' ? (rec.assigned_counselor || null) : null;
  if (!owner) {
    const col = ['owner_id', 'assigned_to_id', 'assigned_user_id', 'salesperson_id', 'assigned_agent_id'].find((c) => rec[c]);
    if (col) { try { const u = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(rec[col]); owner = u ? (u.full_name || u.username) : null; } catch { owner = null; } }
  }
  return { module, id, owner, counts, figures, links, sections: Object.fromEntries(Object.entries(out).filter(([, v]) => v && v.rows).map(([k, v]) => [k, v.rows])), converted: out.converted || null, timeline: T.slice(0, 80) };
}

module.exports = { related };
