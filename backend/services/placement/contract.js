// ============================================================================
// Placement desk — contract staffing: deployed resources and monthly timesheets.
// ============================================================================
const db = require('../../db');
const S = require('./store');

const { bad } = S;

const DEP_SELECT = `
  SELECT d.*, a.account_name AS client_name, COALESCE(u.full_name, u.username) AS owner_name, j.code AS job_code
  FROM pl_deployed d JOIN accounts a ON a.id = d.account_id LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN pl_jobs j ON j.id = d.job_id`;

function depShape(d) {
  const today = S.today();
  const bill = Number(d.bill_rate) || 0; const pay = Number(d.pay_rate) || 0;
  const endsIn = d.end_date ? Math.round((new Date(`${d.end_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null;
  return {
    ...d, margin: bill - pay, margin_percent: bill ? Math.round(((bill - pay) / bill) * 1000) / 10 : 0,
    ends_in: d.status === 'Active' ? endsIn : null,
    renewal_due: d.status === 'Active' && endsIn !== null && endsIn <= 30,
  };
}
function scope(user) {
  const ids = S.visibleIds(user);
  if (!ids) return '1=1';
  const l = S.inList(ids);
  return `(d.owner_id IN (${l}) OR (d.job_id IS NOT NULL AND ${S.jobScope(user, 'j')}))`;
}

function list(q = {}, user) {
  const where = [scope(user)]; const params = [];
  if (q.status && q.status !== 'all') { where.push('d.status = ?'); params.push(q.status); }
  if (S.idOf(q.client)) { where.push('d.account_id = ?'); params.push(S.idOf(q.client)); }
  if (q.renewal === '1') { where.push("d.status = 'Active' AND d.end_date IS NOT NULL AND d.end_date <= ?"); params.push(S.today(30)); }
  if (q.q) { where.push('(LOWER(d.person_name) LIKE ? OR LOWER(d.role_title) LIKE ? OR LOWER(a.account_name) LIKE ?)'); const l = `%${String(q.q).toLowerCase()}%`; params.push(l, l, l); }
  return db.prepare(`${DEP_SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE d.status WHEN 'Active' THEN 0 ELSE 1 END, d.end_date, d.id`).all(...params).map(depShape);
}
function get(id, user) {
  const d = db.prepare(`${DEP_SELECT} WHERE d.id = ? AND ${scope(user)}`).get(id);
  if (!d) return null;
  const sheets = db.prepare('SELECT * FROM pl_timesheets WHERE deployed_id = ? ORDER BY month DESC').all(id);
  return { ...depShape(d), timesheets: sheets };
}
function fields(b, cur) {
  const pick = (k, fn) => (b[k] === undefined ? (cur ? cur[k] : null) : fn(b[k]));
  const out = {
    account_id: pick('account_id', S.idOf), job_id: pick('job_id', S.idOf), candidate_id: pick('candidate_id', S.idOf),
    person_name: pick('person_name', (v) => S.text(v, 160)), role_title: pick('role_title', (v) => S.text(v, 160)),
    bill_rate: pick('bill_rate', S.numOrNull), pay_rate: pick('pay_rate', S.numOrNull),
    start_date: pick('start_date', (v) => S.text(v, 10)), end_date: pick('end_date', (v) => S.text(v, 10)),
    owner_id: pick('owner_id', S.idOf), notes: pick('notes', (v) => S.text(v, 2000)),
    status: b.status === undefined ? (cur ? cur.status : 'Active') : S.oneOf(b.status, ['Active', 'Ended'], 'Status'),
  };
  if (!out.person_name && out.candidate_id) {
    const c = db.prepare('SELECT name FROM pl_candidates WHERE id = ?').get(out.candidate_id);
    if (c) out.person_name = c.name;
  }
  if (!out.person_name) throw bad('Enter the name of the person.');
  if (!out.account_id || !db.prepare('SELECT id FROM accounts WHERE id = ?').get(out.account_id)) throw bad('Choose the client.');
  if (!(out.bill_rate > 0)) throw bad('Enter the bill rate (per month).');
  if (out.pay_rate === null || out.pay_rate < 0) throw bad('Enter the pay rate (per month).');
  if (out.start_date && out.end_date && out.end_date < out.start_date) throw bad('The contract ends before it starts.');
  return out;
}
function create(body, user) {
  const f = fields(body || {}, null);
  return db.prepare(`INSERT INTO pl_deployed (account_id, job_id, candidate_id, person_name, role_title, bill_rate, pay_rate, start_date, end_date, status, owner_id, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.account_id, f.job_id, f.candidate_id, f.person_name, f.role_title, f.bill_rate, f.pay_rate, f.start_date || S.today(), f.end_date,
    f.status || 'Active', f.owner_id || user.id, f.notes).lastInsertRowid;
}
function update(id, body) {
  const cur = db.prepare('SELECT * FROM pl_deployed WHERE id = ?').get(id);
  if (!cur) return null;
  const f = fields(body || {}, cur);
  db.prepare(`UPDATE pl_deployed SET account_id=?, job_id=?, candidate_id=?, person_name=?, role_title=?, bill_rate=?, pay_rate=?, start_date=?, end_date=?, status=?, owner_id=?, notes=?,
    updated_at=datetime('now') WHERE id=?`).run(f.account_id, f.job_id, f.candidate_id, f.person_name, f.role_title, f.bill_rate, f.pay_rate, f.start_date, f.end_date, f.status, f.owner_id, f.notes, id);
  return id;
}
function renew(id, body) {
  const cur = db.prepare('SELECT * FROM pl_deployed WHERE id = ?').get(id);
  if (!cur) throw bad('That resource no longer exists.', 404);
  const end = S.text(body && body.end_date, 10);
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw bad('Choose the new end date.');
  if (cur.end_date && end <= cur.end_date) throw bad('The new end date must be after the current one.');
  const bill = body.bill_rate !== undefined && body.bill_rate !== '' ? S.numOrNull(body.bill_rate) : cur.bill_rate;
  const pay = body.pay_rate !== undefined && body.pay_rate !== '' ? S.numOrNull(body.pay_rate) : cur.pay_rate;
  db.prepare("UPDATE pl_deployed SET end_date = ?, bill_rate = ?, pay_rate = ?, status = 'Active', updated_at = datetime('now') WHERE id = ?").run(end, bill, pay, id);
  return id;
}
function remove(id) {
  const n = Number(db.prepare("SELECT COUNT(*) c FROM pl_timesheets WHERE deployed_id = ? AND status = 'Invoiced'").get(id).c);
  if (n) throw bad('Invoices were made for this resource. End the contract instead of deleting it.');
  db.prepare('DELETE FROM pl_deployed WHERE id = ?').run(id);
}

// ------------------------------ timesheets ---------------------------------
const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
function calc(dep, approvedDays, workingDays) {
  const wd = Number(workingDays) || S.getSettings().working_days;
  const ad = Math.max(0, Math.min(Number(approvedDays) || 0, wd));
  const billable = Math.round((Number(dep.bill_rate) / wd) * ad);
  const payout = Math.round((Number(dep.pay_rate) / wd) * ad);
  return { working_days: wd, approved_days: ad, billable, payout, margin: billable - payout };
}

// Every resource who was on a contract during the month, with the sheet if there is one.
function month(m, q = {}, user) {
  if (!/^\d{4}-\d{2}$/.test(String(m))) throw bad('Choose a month.');
  const where = [scope(user), 'd.start_date <= ?', '(d.end_date IS NULL OR d.end_date >= ?)']; const params = [monthEnd(m), monthStart(m)];
  if (S.idOf(q.client)) { where.push('d.account_id = ?'); params.push(S.idOf(q.client)); }
  const rows = db.prepare(`${DEP_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.account_name, d.person_name`).all(...params);
  const sheets = new Map(db.prepare('SELECT * FROM pl_timesheets WHERE month = ?').all(m).map((t) => [t.deployed_id, t]));
  const out = rows.map((d) => {
    const t = sheets.get(d.id);
    const base = t || { id: null, deployed_id: d.id, month: m, status: 'Not entered', ...calc(d, 0, S.getSettings().working_days), invoice_id: null };
    return { ...base, person_name: d.person_name, role_title: d.role_title, client_name: d.client_name, account_id: d.account_id, bill_rate: d.bill_rate, pay_rate: d.pay_rate, exists: !!t };
  });
  const sum = (k) => out.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return {
    month: m, rows: out,
    totals: { billable: sum('billable'), payout: sum('payout'), margin: sum('margin'), approved_days: sum('approved_days'), resources: out.length,
      margin_percent: sum('billable') ? Math.round((sum('margin') / sum('billable')) * 1000) / 10 : 0 },
  };
}

function saveSheet(body, user) {
  const b = body || {};
  const dep = db.prepare('SELECT * FROM pl_deployed WHERE id = ?').get(S.idOf(b.deployed_id));
  if (!dep) throw bad('Choose the resource.');
  if (!/^\d{4}-\d{2}$/.test(String(b.month))) throw bad('Choose a month.');
  const days = S.numOrNull(b.approved_days);
  if (days === null || days < 0) throw bad('Enter the approved days.');
  const wd = b.working_days === undefined || b.working_days === '' ? S.getSettings().working_days : S.numOrNull(b.working_days);
  if (!(wd > 0) || wd > 31) throw bad('Working days must be between 1 and 31.');
  if (days > wd) throw bad(`Approved days cannot be more than the working days (${wd}).`);
  const c = calc(dep, days, wd);
  const cur = db.prepare('SELECT * FROM pl_timesheets WHERE deployed_id = ? AND month = ?').get(dep.id, b.month);
  if (cur && cur.status === 'Invoiced') throw bad('This month is already invoiced.');
  const status = b.approve === true ? 'Approved' : (cur ? cur.status : 'Draft');
  if (cur) {
    db.prepare(`UPDATE pl_timesheets SET working_days=?, approved_days=?, billable=?, payout=?, margin=?, status=?, approved_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(c.working_days, c.approved_days, c.billable, c.payout, c.margin, status, status === 'Approved' ? user.id : cur.approved_by, cur.id);
    return cur.id;
  }
  return db.prepare(`INSERT INTO pl_timesheets (deployed_id, month, working_days, approved_days, billable, payout, margin, status, approved_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(dep.id, b.month, c.working_days, c.approved_days, c.billable, c.payout, c.margin, status, status === 'Approved' ? user.id : null).lastInsertRowid;
}
function approve(id, user) {
  const t = db.prepare('SELECT * FROM pl_timesheets WHERE id = ?').get(id);
  if (!t) throw bad('That timesheet no longer exists.', 404);
  if (t.status === 'Invoiced') throw bad('This month is already invoiced.');
  db.prepare("UPDATE pl_timesheets SET status = 'Approved', approved_by = ?, updated_at = datetime('now') WHERE id = ?").run(user.id, id);
  return id;
}

// One invoice for one client and one month: a line for each approved resource.
function invoiceMonth(body, user) {
  const docs = require('../documentService');
  const m = String(body && body.month);
  const accountId = S.idOf(body && body.account_id);
  if (!/^\d{4}-\d{2}$/.test(m) || !accountId) throw bad('Choose the month and the client.');
  const sheets = db.prepare(`SELECT t.*, d.person_name, d.role_title, d.bill_rate FROM pl_timesheets t JOIN pl_deployed d ON d.id = t.deployed_id
    WHERE t.month = ? AND d.account_id = ? AND t.status = 'Approved' AND t.invoice_id IS NULL ORDER BY d.person_name`).all(m, accountId);
  if (!sheets.length) throw bad('There is no approved timesheet left to invoice for this client and month.');
  const terms = db.prepare('SELECT payment_terms FROM pl_client_terms WHERE account_id = ?').get(accountId) || {};
  const gst = S.getSettings().gst_percent;
  return db.transaction(() => {
    const id = docs.create('invoice', {
      account_id: accountId, payment_terms: terms.payment_terms || 'Net 30',
      notes: `Contract staffing for ${m}.`,
      items: sheets.map((t) => ({
        description: `${t.person_name}${t.role_title ? ` (${t.role_title})` : ''} · ${t.approved_days} of ${t.working_days} days · ${m}`,
        hsn_sac: '998513', quantity: 1, unit: 'Nos', unit_price: t.billable, tax_percent: gst,
      })),
    }, user.id);
    db.prepare(`UPDATE pl_timesheets SET status = 'Invoiced', invoice_id = ?, updated_at = datetime('now') WHERE id IN (${sheets.map((t) => t.id).join(',')})`).run(id);
    const d = db.prepare('SELECT id, doc_number, grand_total FROM sales_documents WHERE id = ?').get(id);
    return { invoice_id: id, doc_number: d.doc_number, grand_total: d.grand_total, lines: sheets.length };
  })();
}

module.exports = { list, get, create, update, renew, remove, month, saveSheet, approve, invoiceMonth };
