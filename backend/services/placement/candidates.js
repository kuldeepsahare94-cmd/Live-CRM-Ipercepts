// ============================================================================
// Placement desk — candidates: profile, duplicate check, resume, contact log.
// ============================================================================
const db = require('../../db');
const S = require('./store');
const jobs = require('./jobs');

const { bad } = S;

const CAND_SELECT = `
  SELECT c.*, COALESCE(u.full_name, u.username) AS owner_name,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.job_id IS NOT NULL AND p.candidate_id = c.id AND p.stage NOT IN ('Rejected','Joined')) AS live_jobs,
    (SELECT COUNT(*) FROM pl_pipeline p WHERE p.candidate_id = c.id) AS total_jobs,
    (SELECT j.title || ' · ' || a.account_name || ' · ' || p.stage FROM pl_pipeline p JOIN pl_jobs j ON j.id = p.job_id JOIN accounts a ON a.id = j.account_id
       WHERE p.candidate_id = c.id AND p.stage NOT IN ('Rejected') ORDER BY p.updated_at DESC, p.id DESC LIMIT 1) AS latest
  FROM pl_candidates c LEFT JOIN users u ON u.id = c.owner_id`;

function shape(c) {
  return { ...c, live_jobs: Number(c.live_jobs) || 0, total_jobs: Number(c.total_jobs) || 0, has_resume: !!c.resume_file_id };
}

function list(q = {}, user) {
  const where = [S.candScope(user, 'c')]; const params = [];
  if (q.status && q.status !== 'all') { where.push('c.status = ?'); params.push(q.status); }
  if (q.source) { where.push('c.source = ?'); params.push(q.source); }
  if (q.city) { where.push('LOWER(c.city) = ?'); params.push(String(q.city).toLowerCase()); }
  if (S.idOf(q.owner)) { where.push('c.owner_id = ?'); params.push(S.idOf(q.owner)); }
  if (q.notice) { where.push('c.notice_period = ?'); params.push(q.notice); }
  if (q.exp_min !== undefined && q.exp_min !== '') { where.push('c.total_exp >= ?'); params.push(Number(q.exp_min)); }
  if (q.exp_max !== undefined && q.exp_max !== '') { where.push('c.total_exp <= ?'); params.push(Number(q.exp_max)); }
  if (S.idOf(q.job)) { where.push('EXISTS (SELECT 1 FROM pl_pipeline p WHERE p.candidate_id = c.id AND p.job_id = ?)'); params.push(S.idOf(q.job)); }
  if (q.available === '1') { where.push("c.status NOT IN ('Do not call','Blacklisted','Placed')"); }
  if (q.q) {
    const like = `%${String(q.q).toLowerCase()}%`;
    const digits = String(q.q).replace(/\D/g, '');
    const parts = ['LOWER(c.name) LIKE ?', 'LOWER(c.email) LIKE ?', 'LOWER(c.skills) LIKE ?', 'LOWER(c.city) LIKE ?', 'LOWER(c.current_company) LIKE ?', 'LOWER(c.designation) LIKE ?', 'LOWER(c.code) LIKE ?'];
    params.push(like, like, like, like, like, like, like);
    if (digits.length >= 4) { parts.push('c.mobile_key LIKE ?'); params.push(`%${digits}%`); }
    where.push(`(${parts.join(' OR ')})`);
  }
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  const total = Number(db.prepare(`SELECT COUNT(*) c FROM pl_candidates c WHERE ${where.join(' AND ')}`).get(...params).c);
  const rows = db.prepare(`${CAND_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit} OFFSET ${offset}`).all(...params).map(shape);
  return { rows, total, limit, offset };
}

function findDuplicates(mobile, email, exceptId) {
  const mk = S.mobileKey(mobile); const ek = S.emailKey(email);
  if (!mk && !ek) return [];
  const parts = []; const params = [];
  if (mk) { parts.push('mobile_key = ?'); params.push(mk); }
  if (ek) { parts.push('email_key = ?'); params.push(ek); }
  let sql = `SELECT id, code, name, mobile, email, status, current_company FROM pl_candidates WHERE (${parts.join(' OR ')})`;
  if (exceptId) { sql += ' AND id <> ?'; params.push(exceptId); }
  return db.prepare(sql).all(...params);
}

function fields(b, cur) {
  const pick = (k, fn) => (b[k] === undefined ? (cur ? cur[k] : null) : fn(b[k]));
  const out = {
    name: pick('name', (v) => S.text(v, 160)),
    mobile: pick('mobile', (v) => S.text(v, 40)),
    email: pick('email', (v) => S.text(v, 160)),
    city: pick('city', (v) => S.text(v, 80)),
    current_company: pick('current_company', (v) => S.text(v, 160)),
    designation: pick('designation', (v) => S.text(v, 160)),
    total_exp: pick('total_exp', S.numOrNull),
    relevant_exp: pick('relevant_exp', S.numOrNull),
    current_ctc: pick('current_ctc', S.numOrNull),
    expected_ctc: pick('expected_ctc', S.numOrNull),
    notice_period: pick('notice_period', (v) => S.text(v, 40)),
    skills: pick('skills', (v) => S.text(v, 500)),
    source: b.source === undefined ? (cur ? cur.source : null) : S.oneOf(b.source, S.SOURCES, 'Source'),
    status: b.status === undefined ? (cur ? cur.status : 'New') : S.oneOf(b.status, S.CAND_STATUS, 'Status'),
    owner_id: pick('owner_id', S.idOf),
    notes: pick('notes', (v) => S.text(v, 4000)),
  };
  if (!out.name) throw bad('Enter the candidate name.');
  if (!out.mobile && !out.email) throw bad('Enter a mobile number or an email.');
  if (out.mobile && !S.mobileKey(out.mobile)) throw bad('The mobile number looks too short.');
  if (out.email && !S.emailKey(out.email)) throw bad('The email is not valid.');
  for (const k of ['total_exp', 'relevant_exp', 'current_ctc', 'expected_ctc']) if (out[k] !== null && out[k] < 0) throw bad('Numbers cannot be below zero.');
  return out;
}

function create(body, user) {
  const b = body || {};
  const f = fields(b, null);
  const dups = findDuplicates(f.mobile, f.email, null);
  if (dups.length) {
    throw bad(`Already in the CRM: ${dups[0].name} (${dups[0].code}) has this ${S.mobileKey(f.mobile) === S.mobileKey(dups[0].mobile) ? 'mobile number' : 'email'}.`, 409, { duplicates: dups });
  }
  return db.transaction(() => {
    const resume = b.resume && b.resume.data_b64 ? jobs.saveFile('resume', b.resume, user.id) : null;
    const id = db.prepare(`INSERT INTO pl_candidates (code, name, mobile, mobile_key, email, email_key, city, current_company, designation, total_exp, relevant_exp,
        current_ctc, expected_ctc, notice_period, skills, source, status, owner_id, resume_file_id, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(S.nextCandCode(), f.name, f.mobile, S.mobileKey(f.mobile), f.email, S.emailKey(f.email), f.city, f.current_company, f.designation, f.total_exp, f.relevant_exp,
        f.current_ctc, f.expected_ctc, f.notice_period, f.skills, f.source, f.status || 'New', f.owner_id || user.id, resume, f.notes, user.id).lastInsertRowid;
    return id;
  })();
}

function update(id, body, user) {
  const cur = db.prepare('SELECT * FROM pl_candidates WHERE id = ?').get(id);
  if (!cur) return null;
  const b = body || {};
  const f = fields(b, cur);
  const dups = findDuplicates(f.mobile, f.email, id);
  if (dups.length) throw bad(`Another candidate already has this ${S.mobileKey(f.mobile) === S.mobileKey(dups[0].mobile) ? 'mobile number' : 'email'}: ${dups[0].name} (${dups[0].code}).`, 409, { duplicates: dups });
  db.transaction(() => {
    let resume = cur.resume_file_id;
    if (b.resume && b.resume.data_b64) resume = jobs.saveFile('resume', b.resume, user.id);
    db.prepare(`UPDATE pl_candidates SET name=?, mobile=?, mobile_key=?, email=?, email_key=?, city=?, current_company=?, designation=?, total_exp=?, relevant_exp=?,
        current_ctc=?, expected_ctc=?, notice_period=?, skills=?, source=?, status=?, owner_id=?, resume_file_id=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(f.name, f.mobile, S.mobileKey(f.mobile), f.email, S.emailKey(f.email), f.city, f.current_company, f.designation, f.total_exp, f.relevant_exp,
        f.current_ctc, f.expected_ctc, f.notice_period, f.skills, f.source, f.status, f.owner_id, resume, f.notes, id);
  })();
  return id;
}

function remove(id) {
  const used = Number(db.prepare('SELECT COUNT(*) c FROM pl_pipeline WHERE candidate_id = ?').get(id).c);
  if (used > 0) throw bad('This candidate is on an opening. Mark the candidate "Do not call" or "Blacklisted" instead of deleting.');
  db.prepare('DELETE FROM pl_candidates WHERE id = ?').run(id);
}

function get(id, user) {
  const c = db.prepare(`${CAND_SELECT} WHERE c.id = ? AND ${S.candScope(user, 'c')}`).get(id);
  if (!c) return null;
  const pipelines = db.prepare(`
    SELECT p.id, p.job_id, p.stage, p.reject_reason, p.stage_changed_at, j.code AS job_code, j.title AS job_title, j.status AS job_status,
           j.hiring_type, a.id AS account_id, a.account_name AS client_name
    FROM pl_pipeline p JOIN pl_jobs j ON j.id = p.job_id JOIN accounts a ON a.id = j.account_id
    WHERE p.candidate_id = ? ORDER BY p.updated_at DESC, p.id DESC`).all(id);
  const contacts = db.prepare(`SELECT k.*, COALESCE(u.full_name, u.username) AS by_name FROM pl_contacts k LEFT JOIN users u ON u.id = k.by_user
    WHERE k.candidate_id = ? ORDER BY k.at DESC, k.id DESC LIMIT 50`).all(id);
  const timeline = db.prepare(`
    SELECT l.id, l.from_stage, l.to_stage, l.remark, l.reason, l.at, COALESCE(u.full_name, u.username) AS by_name, j.title AS job_title, a.account_name AS client_name
    FROM pl_stage_log l JOIN pl_pipeline p ON p.id = l.pipeline_id JOIN pl_jobs j ON j.id = p.job_id JOIN accounts a ON a.id = j.account_id LEFT JOIN users u ON u.id = l.by_user
    WHERE p.candidate_id = ? ORDER BY l.at DESC, l.id DESC LIMIT 60`).all(id);
  const interviews = db.prepare(`
    SELECT i.*, j.title AS job_title, a.account_name AS client_name
    FROM pl_interviews i JOIN pl_pipeline p ON p.id = i.pipeline_id JOIN pl_jobs j ON j.id = p.job_id JOIN accounts a ON a.id = j.account_id
    WHERE p.candidate_id = ? ORDER BY i.scheduled_at DESC LIMIT 30`).all(id);
  return { ...shape(c), resume: jobs.fileInfo(c.resume_file_id), pipelines, contacts, timeline, interviews, next_follow_up: (contacts.find((k) => k.next_follow_up && !k.follow_up_done) || {}).next_follow_up || null };
}

// A call, a message or a meeting with a candidate; what came of it; when to call again.
function logContact(id, body, user) {
  const c = db.prepare('SELECT id, status FROM pl_candidates WHERE id = ?').get(id);
  if (!c) throw bad('That candidate no longer exists.', 404);
  const b = body || {};
  const channel = S.oneOf(b.channel, ['Call', 'WhatsApp', 'Email', 'Meeting'], 'Channel') || 'Call';
  const outcome = S.oneOf(b.outcome, S.CONTACT_OUTCOMES, 'Outcome');
  const next = S.text(b.next_follow_up, 16);
  if (next && !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?$/.test(next)) throw bad('The follow-up date is not a date.');
  const ref = S.text(b.client_ref, 80);
  if (ref) {
    const had = db.prepare('SELECT id FROM pl_contacts WHERE client_ref = ?').get(ref);
    if (had) return had.id;                 // sent before (a retry): saved once
  }
  return db.transaction(() => {
    // an earlier open follow-up is now answered
    db.prepare('UPDATE pl_contacts SET follow_up_done = 1 WHERE candidate_id = ? AND next_follow_up IS NOT NULL AND follow_up_done = 0').run(id);
    const info = db.prepare('INSERT INTO pl_contacts (candidate_id, channel, outcome, remark, next_follow_up, by_user, at, client_ref) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, channel, outcome, S.text(b.remark, 2000), next ? next.replace('T', ' ') : null, user.id, S.nowLocal(), ref || null);
    db.prepare("UPDATE pl_candidates SET last_contacted = ?, updated_at = datetime('now') WHERE id = ?").run(S.today(), id);
    if (outcome === 'Wrong number' || (outcome === 'Not interested' && b.mark_do_not_call === true)) {
      db.prepare("UPDATE pl_candidates SET status = 'Do not call' WHERE id = ? AND status NOT IN ('Placed')").run(id);
    } else if (c.status === 'New' && outcome === 'Interested') {
      db.prepare("UPDATE pl_candidates SET status = 'Screened' WHERE id = ?").run(id);
    }
    return info.lastInsertRowid;
  })();
}
function markFollowUpDone(contactId) {
  db.prepare('UPDATE pl_contacts SET follow_up_done = 1 WHERE id = ?').run(contactId);
}

// The follow-ups that are due: a day or more passed, and nobody answered them yet.
function followUps(user, { upto, mine } = {}) {
  const until = upto || S.today(1);
  const own = mine ? ` AND k.by_user = ${Number(user.id) || 0}` : '';
  return db.prepare(`
    SELECT k.id, k.candidate_id, k.next_follow_up, k.outcome, k.remark, c.name, c.mobile, c.code, c.current_company, c.designation
    FROM pl_contacts k JOIN pl_candidates c ON c.id = k.candidate_id
    WHERE k.next_follow_up IS NOT NULL AND k.follow_up_done = 0 AND SUBSTR(k.next_follow_up, 1, 10) <= ? AND ${S.candScope(user, 'c')}${own}
    ORDER BY k.next_follow_up LIMIT 100`).all(until);
}

function facets(user) {
  const sc = S.candScope(user, 'c');
  return {
    cities: db.prepare(`SELECT c.city AS value, COUNT(*) AS n FROM pl_candidates c WHERE c.city IS NOT NULL AND ${sc} GROUP BY c.city ORDER BY n DESC LIMIT 30`).all(),
  };
}

module.exports = { list, get, create, update, remove, findDuplicates, logContact, markFollowUpDone, followUps, facets };

// People already in the database who look right for an opening: skills in common,
// experience in the band, not already on it, not blocked. A plain ranking, nothing clever.
function suggest(jobId, user) {
  const job = db.prepare('SELECT * FROM pl_jobs WHERE id = ?').get(jobId);
  if (!job) throw bad('That opening no longer exists.', 404);
  const words = [...new Set(String(job.skills || '').toLowerCase().split(/[,/;|]+/).map((w) => w.trim()).filter((w) => w.length > 1))];
  const rows = db.prepare(`${CAND_SELECT} WHERE ${S.candScope(user, 'c')} AND c.status NOT IN ('Do not call','Blacklisted','Placed')
    AND c.id NOT IN (SELECT candidate_id FROM pl_pipeline WHERE job_id = ?) ORDER BY c.created_at DESC LIMIT 1500`).all(jobId);
  const out = [];
  for (const c of rows) {
    const have = String(c.skills || '').toLowerCase();
    const hit = words.filter((w) => have.includes(w));
    let score = hit.length * 10;
    if (!hit.length && words.length) continue;
    const exp = Number(c.total_exp);
    if (Number.isFinite(exp) && job.exp_min !== null && job.exp_max !== null) {
      if (exp >= job.exp_min && exp <= job.exp_max) score += 6; else if (exp >= job.exp_min - 1 && exp <= job.exp_max + 1) score += 2; else score -= 6;
    }
    if (job.ctc_max && c.expected_ctc && Number(c.expected_ctc) <= Number(job.ctc_max) * 1.05) score += 3;
    if (job.location && c.city && String(job.location).toLowerCase().includes(String(c.city).toLowerCase())) score += 3;
    out.push({ ...shape(c), score, matched: hit });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 15);
}
module.exports.suggest = suggest;
