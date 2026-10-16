// ============================================================================
// Placement desk — clients (recruitment terms on an Account), job openings, files.
// ============================================================================
const db = require('../../db');
const S = require('./store');

const { bad } = S;
const SUBMITTED_STAGES = "'Submitted','Interview L1','Interview L2','Final round','Offered','Offer accepted','Joined'";

// ------------------------------- files -------------------------------------
const MAX_FILE = 6 * 1024 * 1024;
const OK_TYPES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain|image\/(png|jpe?g))$/i;
function saveFile(kind, f, userId) {
  if (!f || !f.data_b64) return null;
  const mime = String(f.mime || 'application/octet-stream');
  if (!OK_TYPES.test(mime)) throw bad('Upload a PDF, a Word file, a text file or a picture.');
  const b64 = String(f.data_b64).replace(/^data:[^,]*,/, '');
  const size = Math.floor(b64.length * 0.75);
  if (size > MAX_FILE) throw bad('The file is larger than 6 MB.');
  const info = db.prepare('INSERT INTO pl_files (kind, file_name, mime, size, data_b64, created_by) VALUES (?,?,?,?,?,?)')
    .run(kind, S.text(f.file_name || 'file', 200), mime, size, b64, userId || null);
  return info.lastInsertRowid;
}
function getFile(id) { return db.prepare('SELECT * FROM pl_files WHERE id = ?').get(id); }
function fileInfo(id) {
  if (!id) return null;
  const f = db.prepare('SELECT id, kind, file_name, mime, size, created_at FROM pl_files WHERE id = ?').get(id);
  return f || null;
}

// ------------------------------- clients -----------------------------------
function clientRow(a) {
  return {
    ...a,
    open_jobs: Number(a.open_jobs) || 0, positions_open: Number(a.positions_open) || 0, placed: Number(a.placed) || 0,
    deployed: Number(a.deployed) || 0, fee_billed: S.money(a.fee_billed),
  };
}
const CLIENT_SELECT = `
  SELECT a.id, a.account_name, a.city, a.industry, a.phone, a.email, a.owner_id, a.status,
         t.agreement_type, t.fee_percent, t.payment_terms, t.guarantee_days, t.spoc_name, t.spoc_phone, t.spoc_email, t.notes,
         (SELECT COUNT(*) FROM pl_jobs j WHERE j.account_id = a.id AND j.status = 'Open') AS open_jobs,
         (SELECT COALESCE(SUM(j.positions),0) FROM pl_jobs j WHERE j.account_id = a.id AND j.status = 'Open') AS positions_open,
         (SELECT COUNT(*) FROM pl_offers o JOIN pl_pipeline p ON p.id = o.pipeline_id JOIN pl_jobs j ON j.id = p.job_id
            WHERE j.account_id = a.id AND o.status = 'Joined') AS placed,
         (SELECT COUNT(*) FROM pl_deployed d WHERE d.account_id = a.id AND d.status = 'Active') AS deployed,
         (SELECT COALESCE(SUM(o.fee_amount),0) FROM pl_offers o JOIN pl_pipeline p ON p.id = o.pipeline_id JOIN pl_jobs j ON j.id = p.job_id
            WHERE j.account_id = a.id AND o.status = 'Joined') AS fee_billed
  FROM accounts a JOIN pl_client_terms t ON t.account_id = a.id`;

function listClients(q = {}) {
  const where = ['1=1']; const params = [];
  if (q.q) { where.push('(LOWER(a.account_name) LIKE ? OR LOWER(a.city) LIKE ?)'); params.push(`%${String(q.q).toLowerCase()}%`, `%${String(q.q).toLowerCase()}%`); }
  if (q.agreement) { where.push('t.agreement_type = ?'); params.push(q.agreement); }
  return db.prepare(`${CLIENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.account_name`).all(...params).map(clientRow);
}
function getClient(id) {
  const c = db.prepare(`${CLIENT_SELECT} WHERE a.id = ?`).get(id);
  if (!c) return null;
  const jobs = db.prepare(`SELECT j.id, j.code, j.title, j.status, j.hiring_type, j.positions, j.priority FROM pl_jobs j WHERE j.account_id = ? ORDER BY j.created_at DESC`).all(id);
  const contacts = db.prepare('SELECT id, first_name, last_name, job_title, phone, email FROM contacts WHERE account_id = ? ORDER BY id LIMIT 10').all(id);
  return { ...clientRow(c), jobs, contacts };
}
// accounts that are not yet recruitment clients (to pick an existing company)
function otherAccounts(q) {
  const params = []; let w = 'a.id NOT IN (SELECT account_id FROM pl_client_terms)';
  if (q) { w += ' AND LOWER(a.account_name) LIKE ?'; params.push(`%${String(q).toLowerCase()}%`); }
  return db.prepare(`SELECT a.id, a.account_name, a.city FROM accounts a WHERE ${w} ORDER BY a.account_name LIMIT 25`).all(...params);
}

function termsFrom(b, cur) {
  const st = S.getSettings();
  return {
    agreement_type: S.oneOf(b.agreement_type, ['Permanent', 'Contract', 'Both'], 'Agreement type') || (cur && cur.agreement_type) || 'Permanent',
    fee_percent: b.fee_percent === undefined ? (cur ? cur.fee_percent : st.fee_percent) : S.numOrNull(b.fee_percent),
    payment_terms: b.payment_terms === undefined ? (cur ? cur.payment_terms : 'Net 30') : S.text(b.payment_terms, 80),
    guarantee_days: b.guarantee_days === undefined ? (cur ? cur.guarantee_days : st.guarantee_days) : S.numOrNull(b.guarantee_days),
    spoc_name: b.spoc_name === undefined ? (cur && cur.spoc_name) : S.text(b.spoc_name, 120),
    spoc_phone: b.spoc_phone === undefined ? (cur && cur.spoc_phone) : S.text(b.spoc_phone, 40),
    spoc_email: b.spoc_email === undefined ? (cur && cur.spoc_email) : S.text(b.spoc_email, 160),
    notes: b.notes === undefined ? (cur && cur.notes) : S.text(b.notes),
  };
}
function saveClient(body, userId, id) {
  const b = body || {};
  return db.transaction(() => {
    let accountId = id || S.idOf(b.account_id);
    if (!accountId) {
      const name = S.text(b.account_name, 200);
      if (!name) throw bad('Enter the company name.');
      if (db.prepare('SELECT id FROM accounts WHERE LOWER(account_name) = ?').get(name.toLowerCase())) throw bad('A company with this name already exists. Pick it from the list instead.');
      accountId = db.prepare(`INSERT INTO accounts (account_name, account_type, industry, city, phone, email, owner_id, status)
        VALUES (?,?,?,?,?,?,?,'Active')`).run(name, 'Customer', S.text(b.industry, 80), S.text(b.city, 80), S.text(b.phone, 40), S.text(b.email, 160), S.idOf(b.owner_id) || userId || null).lastInsertRowid;
    } else {
      const a = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
      if (!a) throw bad('That company no longer exists.', 404);
      const sets = []; const vals = [];
      for (const [k, max] of [['account_name', 200], ['industry', 80], ['city', 80], ['phone', 40], ['email', 160]]) {
        if (b[k] !== undefined && S.text(b[k], max)) { sets.push(`${k} = ?`); vals.push(S.text(b[k], max)); }
      }
      if (sets.length) db.prepare(`UPDATE accounts SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, accountId);
    }
    const cur = db.prepare('SELECT * FROM pl_client_terms WHERE account_id = ?').get(accountId);
    const t = termsFrom(b, cur);
    if (cur) {
      db.prepare(`UPDATE pl_client_terms SET agreement_type=?, fee_percent=?, payment_terms=?, guarantee_days=?, spoc_name=?, spoc_phone=?, spoc_email=?, notes=?, updated_at=datetime('now') WHERE account_id=?`)
        .run(t.agreement_type, t.fee_percent, t.payment_terms, t.guarantee_days, t.spoc_name, t.spoc_phone, t.spoc_email, t.notes, accountId);
    } else {
      db.prepare(`INSERT INTO pl_client_terms (account_id, agreement_type, fee_percent, payment_terms, guarantee_days, spoc_name, spoc_phone, spoc_email, notes)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(accountId, t.agreement_type, t.fee_percent, t.payment_terms, t.guarantee_days, t.spoc_name, t.spoc_phone, t.spoc_email, t.notes);
    }
    return accountId;
  })();
}

// ------------------------------- jobs --------------------------------------
const JOB_SELECT = `
  SELECT j.*, a.account_name AS client_name, a.city AS client_city,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id = j.id) AS total_count,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id = j.id AND p.stage NOT IN ('Rejected','Joined')) AS active_count,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id = j.id AND EXISTS
       (SELECT 1 FROM pl_stage_log l WHERE l.pipeline_id = p.id AND l.to_stage IN (${SUBMITTED_STAGES}))) AS submitted_count,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id = j.id AND p.stage IN ('Interview L1','Interview L2','Final round')) AS interview_count,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id = j.id AND p.stage IN ('Offered','Offer accepted')) AS offered_count,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id = j.id AND p.stage = 'Joined') AS joined_count,
    (SELECT MAX(l.at) FROM pl_stage_log l JOIN pl_pipeline p ON p.id = l.pipeline_id WHERE p.job_id = j.id) AS last_activity
  FROM pl_jobs j JOIN accounts a ON a.id = j.account_id`;

function jobRow(j, recruiters) {
  const today = S.today();
  const opened = j.opened_on || String(j.created_at).slice(0, 10);
  const daysOpen = Math.max(0, Math.round((new Date(`${j.closed_on || today}T00:00:00Z`) - new Date(`${opened}T00:00:00Z`)) / 86400000));
  const lastDay = j.last_activity ? String(j.last_activity).slice(0, 10) : opened;
  const quiet = Math.max(0, Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${lastDay}T00:00:00Z`)) / 86400000));
  const cold = j.status === 'Open' && quiet >= S.getSettings().cold_days;
  return {
    ...j,
    total_count: Number(j.total_count) || 0, active_count: Number(j.active_count) || 0, submitted_count: Number(j.submitted_count) || 0,
    interview_count: Number(j.interview_count) || 0, offered_count: Number(j.offered_count) || 0, joined_count: Number(j.joined_count) || 0,
    remaining: Math.max(0, (Number(j.positions) || 0) - (Number(j.joined_count) || 0)),
    days_open: daysOpen, quiet_days: quiet, cold,
    recruiters: recruiters || [],
  };
}
function recruitersOf(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT r.job_id, u.id, COALESCE(u.full_name, u.username) AS name FROM pl_job_recruiters r JOIN users u ON u.id = r.user_id WHERE r.job_id IN (${ids.join(',')})`).all();
  const m = new Map();
  for (const r of rows) { if (!m.has(r.job_id)) m.set(r.job_id, []); m.get(r.job_id).push({ id: r.id, name: r.name }); }
  return m;
}

function listJobs(q = {}, user) {
  const where = [S.jobScope(user)]; const params = [];
  if (q.status && q.status !== 'all') { where.push('j.status = ?'); params.push(q.status); }
  if (q.hiring_type) { where.push('j.hiring_type = ?'); params.push(q.hiring_type); }
  if (S.idOf(q.client)) { where.push('j.account_id = ?'); params.push(S.idOf(q.client)); }
  if (q.priority) { where.push('j.priority = ?'); params.push(q.priority); }
  if (S.idOf(q.recruiter)) { where.push('EXISTS (SELECT 1 FROM pl_job_recruiters r WHERE r.job_id = j.id AND r.user_id = ?)'); params.push(S.idOf(q.recruiter)); }
  if (q.q) {
    const like = `%${String(q.q).toLowerCase()}%`;
    where.push('(LOWER(j.title) LIKE ? OR LOWER(j.code) LIKE ? OR LOWER(a.account_name) LIKE ? OR LOWER(j.skills) LIKE ? OR LOWER(j.location) LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const rows = db.prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE j.priority WHEN 'Hot' THEN 0 ELSE 1 END, j.created_at DESC, j.id DESC`).all(...params);
  const rec = recruitersOf(rows.map((r) => r.id));
  let out = rows.map((r) => jobRow(r, rec.get(r.id)));
  if (q.cold === '1' || q.cold === 1 || q.cold === true) out = out.filter((j) => j.cold);
  return out;
}
function getJob(id, user) {
  const j = db.prepare(`${JOB_SELECT} WHERE j.id = ? AND ${S.jobScope(user)}`).get(id);
  if (!j) return null;
  const row = jobRow(j, recruitersOf([j.id]).get(j.id));
  row.jd_file = fileInfo(j.jd_file_id);
  const terms = db.prepare('SELECT agreement_type, fee_percent, guarantee_days, payment_terms, spoc_name, spoc_phone, spoc_email FROM pl_client_terms WHERE account_id = ?').get(j.account_id);
  row.client_terms = terms || null;
  row.owner_name = S.userName(j.owner_id);
  return row;
}

function jobFields(b, cur) {
  const pick = (k, fn) => (b[k] === undefined ? (cur ? cur[k] : null) : fn(b[k]));
  const out = {
    title: pick('title', (v) => S.text(v, 200)),
    account_id: pick('account_id', S.idOf),
    hiring_type: b.hiring_type === undefined ? (cur ? cur.hiring_type : 'Permanent') : S.oneOf(b.hiring_type, S.HIRING, 'Hiring type'),
    positions: b.positions === undefined ? (cur ? cur.positions : 1) : Math.max(1, Math.round(S.numOrNull(b.positions) || 1)),
    skills: pick('skills', (v) => S.text(v, 500)),
    exp_min: pick('exp_min', S.numOrNull), exp_max: pick('exp_max', S.numOrNull),
    ctc_min: pick('ctc_min', S.numOrNull), ctc_max: pick('ctc_max', S.numOrNull),
    bill_rate: pick('bill_rate', S.numOrNull),
    location: pick('location', (v) => S.text(v, 160)),
    priority: b.priority === undefined ? (cur ? cur.priority : 'Normal') : S.oneOf(b.priority, ['Hot', 'Normal'], 'Priority'),
    fee_percent: pick('fee_percent', S.numOrNull),
    target_date: pick('target_date', (v) => S.text(v, 10)),
    jd_text: pick('jd_text', (v) => S.text(v, 8000)),
    owner_id: pick('owner_id', S.idOf),
  };
  if (!out.title) throw bad('Enter the position title.');
  if (!out.account_id || !db.prepare('SELECT id FROM accounts WHERE id = ?').get(out.account_id)) throw bad('Choose the client.');
  if (out.exp_min !== null && out.exp_max !== null && out.exp_min > out.exp_max) throw bad('Minimum experience is more than the maximum.');
  if (out.ctc_min !== null && out.ctc_max !== null && out.ctc_min > out.ctc_max) throw bad('Minimum CTC is more than the maximum.');
  if (out.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.target_date)) throw bad('The target date is not a date.');
  return out;
}
function setRecruiters(jobId, ids) {
  if (!Array.isArray(ids)) return;
  db.prepare('DELETE FROM pl_job_recruiters WHERE job_id = ?').run(jobId);
  for (const raw of [...new Set(ids.map(S.idOf).filter(Boolean))]) {
    if (db.prepare('SELECT id FROM users WHERE id = ?').get(raw)) db.prepare('INSERT INTO pl_job_recruiters (job_id, user_id) VALUES (?,?)').run(jobId, raw);
  }
}
function createJob(body, user) {
  const b = body || {};
  return db.transaction(() => {
    const f = jobFields(b, null);
    if (!db.prepare('SELECT id FROM pl_client_terms WHERE account_id = ?').get(f.account_id)) throw bad('This company is not set up as a recruitment client yet.');
    if (f.fee_percent === null && f.hiring_type === 'Permanent') {
      const t = db.prepare('SELECT fee_percent FROM pl_client_terms WHERE account_id = ?').get(f.account_id);
      f.fee_percent = t && t.fee_percent !== null ? t.fee_percent : S.getSettings().fee_percent;
    }
    const jdFile = S.text(b.jd_file && b.jd_file.data_b64) ? saveFile('jd', b.jd_file, user.id) : null;
    const code = S.nextJobCode();
    const id = db.prepare(`INSERT INTO pl_jobs (code, title, account_id, hiring_type, positions, skills, exp_min, exp_max, ctc_min, ctc_max, bill_rate,
        location, priority, status, fee_percent, target_date, opened_on, jd_text, jd_file_id, owner_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Open',?,?,?,?,?,?,?)`)
      .run(code, f.title, f.account_id, f.hiring_type, f.positions, f.skills, f.exp_min, f.exp_max, f.ctc_min, f.ctc_max, f.bill_rate,
        f.location, f.priority, f.fee_percent, f.target_date || S.addDays(S.today(), 30), S.today(), f.jd_text, jdFile, f.owner_id || user.id, user.id).lastInsertRowid;
    setRecruiters(id, Array.isArray(b.recruiter_ids) && b.recruiter_ids.length ? b.recruiter_ids : [f.owner_id || user.id]);
    return id;
  })();
}
function updateJob(id, body, user) {
  const cur = db.prepare('SELECT * FROM pl_jobs WHERE id = ?').get(id);
  if (!cur) return null;
  const b = body || {};
  db.transaction(() => {
    const f = jobFields(b, cur);
    let jdFile = cur.jd_file_id;
    if (b.jd_file && b.jd_file.data_b64) jdFile = saveFile('jd', b.jd_file, user.id);
    db.prepare(`UPDATE pl_jobs SET title=?, account_id=?, hiring_type=?, positions=?, skills=?, exp_min=?, exp_max=?, ctc_min=?, ctc_max=?, bill_rate=?,
        location=?, priority=?, fee_percent=?, target_date=?, jd_text=?, jd_file_id=?, owner_id=?, updated_at=datetime('now') WHERE id=?`)
      .run(f.title, f.account_id, f.hiring_type, f.positions, f.skills, f.exp_min, f.exp_max, f.ctc_min, f.ctc_max, f.bill_rate,
        f.location, f.priority, f.fee_percent, f.target_date, f.jd_text, jdFile, f.owner_id, id);
    if (b.status !== undefined) setStatus(id, b.status);
    setRecruiters(id, b.recruiter_ids);
  })();
  return id;
}
function setStatus(id, status) {
  const st = S.oneOf(status, S.JOB_STATUS, 'Status');
  if (!st) throw bad('Choose a status.');
  const cur = db.prepare('SELECT status FROM pl_jobs WHERE id = ?').get(id);
  if (!cur) throw bad('That opening no longer exists.', 404);
  if (cur.status === st) return;
  const closed = ['Filled', 'Closed', 'Lost'].includes(st);
  db.prepare("UPDATE pl_jobs SET status=?, closed_on=?, updated_at=datetime('now') WHERE id=?").run(st, closed ? S.today() : null, id);
}
function deleteJob(id) {
  const used = db.prepare("SELECT COUNT(*) c FROM pl_pipeline WHERE job_id = ?").get(id).c;
  if (Number(used) > 0) throw bad('Candidates are already on this opening. Close it instead of deleting it.');
  db.prepare('DELETE FROM pl_jobs WHERE id = ?').run(id);
}

module.exports = {
  saveFile, getFile, fileInfo, listClients, getClient, otherAccounts, saveClient,
  listJobs, getJob, createJob, updateJob, setStatus, deleteJob, SUBMITTED_STAGES,
};
