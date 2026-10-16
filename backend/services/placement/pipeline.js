// ============================================================================
// Placement desk — the pipeline (a candidate on a job), interviews, offers,
// joining and the placement invoice.
// ============================================================================
const db = require('../../db');
const S = require('./store');

const { bad } = S;
const STAGE_FOR_ROUND = { L1: 'Interview L1', L2: 'Interview L2', Final: 'Final round', HR: 'Final round' };

const PIPE_SELECT = `
  SELECT p.*, c.name AS candidate_name, c.code AS candidate_code, c.mobile, c.email, c.city, c.current_company, c.designation, c.total_exp,
         c.current_ctc, c.expected_ctc, c.notice_period, c.skills AS candidate_skills, c.status AS candidate_status,
         j.code AS job_code, j.title AS job_title, j.status AS job_status, j.hiring_type, j.account_id, j.positions,
         a.account_name AS client_name, COALESCE(u.full_name, u.username) AS owner_name
  FROM pl_pipeline p JOIN pl_candidates c ON c.id = p.candidate_id JOIN pl_jobs j ON j.id = p.job_id
       JOIN accounts a ON a.id = j.account_id LEFT JOIN users u ON u.id = p.owner_id`;

function daysIn(stageChangedAt) {
  const d = String(stageChangedAt || '').slice(0, 10);
  if (!d) return 0;
  return Math.max(0, Math.round((new Date(`${S.today()}T00:00:00Z`) - new Date(`${d}T00:00:00Z`)) / 86400000));
}

function list(q = {}, user) {
  const where = [S.pipeScope(user, 'p', 'j')]; const params = [];
  if (S.idOf(q.job)) { where.push('p.job_id = ?'); params.push(S.idOf(q.job)); }
  if (S.idOf(q.candidate)) { where.push('p.candidate_id = ?'); params.push(S.idOf(q.candidate)); }
  if (S.idOf(q.client)) { where.push('j.account_id = ?'); params.push(S.idOf(q.client)); }
  if (S.idOf(q.owner)) { where.push('p.owner_id = ?'); params.push(S.idOf(q.owner)); }
  if (q.stage) { where.push('p.stage = ?'); params.push(q.stage); }
  if (q.hide_rejected === '1') where.push("p.stage <> 'Rejected'");
  if (q.open_jobs === '1') where.push("j.status = 'Open'");
  if (q.q) {
    const like = `%${String(q.q).toLowerCase()}%`;
    where.push('(LOWER(c.name) LIKE ? OR LOWER(j.title) LIKE ? OR LOWER(a.account_name) LIKE ?)');
    params.push(like, like, like);
  }
  const rows = db.prepare(`${PIPE_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC, p.id DESC LIMIT 1000`).all(...params);
  return rows.map((r) => ({ ...r, days_in_stage: daysIn(r.stage_changed_at) }));
}
function getRow(id) { return db.prepare(`${PIPE_SELECT} WHERE p.id = ?`).get(id); }
function get(id, user) {
  const r = db.prepare(`${PIPE_SELECT} WHERE p.id = ? AND ${S.pipeScope(user, 'p', 'j')}`).get(id);
  if (!r) return null;
  const log = db.prepare(`SELECT l.*, COALESCE(u.full_name, u.username) AS by_name FROM pl_stage_log l LEFT JOIN users u ON u.id = l.by_user
    WHERE l.pipeline_id = ? ORDER BY l.at DESC, l.id DESC`).all(id);
  const interviews = db.prepare('SELECT * FROM pl_interviews WHERE pipeline_id = ? ORDER BY scheduled_at').all(id);
  const offer = db.prepare('SELECT * FROM pl_offers WHERE pipeline_id = ?').get(id) || null;
  return { ...r, days_in_stage: daysIn(r.stage_changed_at), log, interviews, offer };
}

// The kanban of one job: every stage as a column.
function board(jobId, user) {
  const cards = list({ job: jobId }, user);
  const cols = S.ALL_STAGES.map((stage) => ({ stage, cards: cards.filter((c) => c.stage === stage) }));
  return { stages: S.ALL_STAGES, columns: cols, total: cards.length };
}

function addToJob(jobId, candidateId, user, stage) {
  const job = db.prepare('SELECT * FROM pl_jobs WHERE id = ?').get(jobId);
  if (!job) throw bad('That opening no longer exists.', 404);
  const cand = db.prepare('SELECT * FROM pl_candidates WHERE id = ?').get(candidateId);
  if (!cand) throw bad('That candidate no longer exists.', 404);
  if (job.status !== 'Open') throw bad(`This opening is ${job.status.toLowerCase()}. Open it again to add candidates.`);
  if (cand.status === 'Blacklisted' || cand.status === 'Do not call') throw bad(`${cand.name} is marked "${cand.status}" and cannot be added to an opening.`);
  const dup = db.prepare('SELECT id FROM pl_pipeline WHERE job_id = ? AND candidate_id = ?').get(jobId, candidateId);
  if (dup) throw bad(`${cand.name} is already on this opening.`, 409, { pipeline_id: dup.id });
  const st = stage ? S.oneOf(stage, ['Sourced', 'Screened', 'Submitted'], 'Starting stage') : 'Sourced';
  return db.transaction(() => {
    const id = db.prepare('INSERT INTO pl_pipeline (job_id, candidate_id, stage, owner_id, created_by) VALUES (?,?,?,?,?)')
      .run(jobId, candidateId, st, cand.owner_id || user.id, user.id).lastInsertRowid;
    db.prepare('INSERT INTO pl_stage_log (pipeline_id, from_stage, to_stage, remark, by_user, at) VALUES (?,?,?,?,?,?)')
      .run(id, null, st, 'Added to the opening', user.id, S.nowLocal());
    if (cand.status === 'New') db.prepare("UPDATE pl_candidates SET status = 'Active', updated_at = datetime('now') WHERE id = ?").run(candidateId);
    return id;
  })();
}
function removeFromJob(id) {
  const r = db.prepare('SELECT stage FROM pl_pipeline WHERE id = ?').get(id);
  if (!r) return;
  if (['Offered', 'Offer accepted', 'Joined'].includes(r.stage)) throw bad('There is an offer on this one. Reject or drop it instead of removing it.');
  db.prepare('DELETE FROM pl_pipeline WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Moving between stages. Everything that follows a move (the offer, the
// joining, the opening being full) happens here, so the board, the interview
// result and the offer screen all behave the same way.
// ---------------------------------------------------------------------------
function ensureOffer(row, user, b = {}) {
  let o = db.prepare('SELECT * FROM pl_offers WHERE pipeline_id = ?').get(row.id);
  const terms = db.prepare('SELECT fee_percent, guarantee_days FROM pl_client_terms WHERE account_id = ?').get(row.account_id) || {};
  const job = db.prepare('SELECT fee_percent, hiring_type FROM pl_jobs WHERE id = ?').get(row.job_id) || {};
  const st = S.getSettings();
  const pct = job.fee_percent !== null && job.fee_percent !== undefined ? job.fee_percent : (terms.fee_percent !== undefined && terms.fee_percent !== null ? terms.fee_percent : st.fee_percent);
  const days = terms.guarantee_days !== undefined && terms.guarantee_days !== null ? terms.guarantee_days : st.guarantee_days;
  const ctc = b.offered_ctc !== undefined && b.offered_ctc !== '' ? S.numOrNull(b.offered_ctc) : (o ? o.offered_ctc : row.expected_ctc);
  const fee = ctc ? Math.round(ctc * 100000 * (pct / 100)) : 0;
  if (!o) {
    db.prepare(`INSERT INTO pl_offers (pipeline_id, offered_ctc, offer_date, expected_joining, status, fee_percent, fee_amount, guarantee_days, created_by)
      VALUES (?,?,?,?, 'Offered', ?,?,?,?)`).run(row.id, ctc, b.offer_date || S.today(), b.expected_joining || S.addDays(S.today(), 30), pct, fee, days, user.id);
  } else {
    db.prepare(`UPDATE pl_offers SET offered_ctc = ?, fee_percent = ?, fee_amount = ?, guarantee_days = COALESCE(guarantee_days, ?),
      expected_joining = COALESCE(?, expected_joining), updated_at = datetime('now') WHERE id = ?`).run(ctc, pct, fee, days, b.expected_joining || null, o.id);
  }
  return db.prepare('SELECT * FROM pl_offers WHERE pipeline_id = ?').get(row.id);
}

function jobFullCheck(jobId) {
  const j = db.prepare('SELECT positions, status FROM pl_jobs WHERE id = ?').get(jobId);
  if (!j) return;
  const joined = Number(db.prepare("SELECT COUNT(*) c FROM pl_pipeline WHERE job_id = ? AND stage = 'Joined'").get(jobId).c);
  if (j.status === 'Open' && joined >= Number(j.positions)) {
    db.prepare("UPDATE pl_jobs SET status = 'Filled', closed_on = ?, updated_at = datetime('now') WHERE id = ?").run(S.today(), jobId);
  } else if (j.status === 'Filled' && joined < Number(j.positions)) {
    db.prepare("UPDATE pl_jobs SET status = 'Open', closed_on = NULL, updated_at = datetime('now') WHERE id = ?").run(jobId);
  }
}

function move(id, body, user) {
  const b = body || {};
  const row = getRow(id);
  if (!row) throw bad('That candidate is no longer on the opening.', 404);
  const to = S.oneOf(b.stage, S.ALL_STAGES, 'Stage');
  if (!to) throw bad('Choose a stage.');
  if (to === row.stage) return row;
  if (row.stage === 'Joined') throw bad('A candidate who joined cannot be moved. If the person left, mark the offer as "Dropped".');
  if (['Closed', 'Lost'].includes(row.job_status) && to !== 'Rejected') throw bad(`The opening is ${row.job_status.toLowerCase()}. Open it again first.`);
  let reason = null;
  if (to === 'Rejected') {
    reason = S.oneOf(b.reason, S.REJECT_REASONS, 'Reason');
    if (!reason) throw bad('Choose why this candidate is out.');
  }
  const remark = S.text(b.remark, 1000);
  const joinDate = S.text(b.joining_date || b.actual_joining, 10) || S.today();
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
  if (b.offered_ctc !== undefined && b.offered_ctc !== '' && b.offered_ctc !== null) {
    const c = S.numOrNull(b.offered_ctc);
    if (c === null || !(c > 0) || c > 1000) throw bad('The offered CTC must be more than 0 and not more than 1000 lakh a year.');
  }
  if (to === 'Joined' && (!isDate(joinDate) || joinDate > S.addDays(S.today(), 7))) throw bad('Enter the date of joining (not more than a week ahead).');
  if (b.expected_joining && !isDate(String(b.expected_joining))) throw bad('Enter a proper expected joining date.');

  return db.transaction(() => {
    const fromSide = S.SIDE_STAGES.includes(row.stage);
    const toSide = S.SIDE_STAGES.includes(to);
    const prev = toSide ? (fromSide ? row.prev_stage : row.stage) : null;

    if (to === 'Offered') ensureOffer(row, user, b);
    if (to === 'Offer accepted') {
      const o = ensureOffer(row, user, b);
      db.prepare("UPDATE pl_offers SET status = 'Accepted', updated_at = datetime('now') WHERE id = ?").run(o.id);
    }
    if (to === 'Joined') {
      const o = ensureOffer(row, user, b);
      const terms = Number(o.guarantee_days) || 0;
      db.prepare(`UPDATE pl_offers SET status = 'Joined', actual_joining = ?, guarantee_end = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(joinDate, terms ? S.addDays(joinDate, terms) : null, o.id);
      db.prepare("UPDATE pl_candidates SET status = 'Placed', updated_at = datetime('now') WHERE id = ?").run(row.candidate_id);
    }
    if (to === 'Rejected' && ['Offered', 'Offer accepted'].includes(row.stage)) {
      db.prepare("UPDATE pl_offers SET status = ?, decline_reason = ?, updated_at = datetime('now') WHERE pipeline_id = ?")
        .run(row.stage === 'Offer accepted' ? 'Dropped' : 'Declined', reason, id);
    }
    if (!toSide && ['Offered', 'Offer accepted'].includes(row.stage) && STAGE_ORDER(to) < STAGE_ORDER('Offered')) {
      // taken back to an earlier stage: the offer is withdrawn
      db.prepare("UPDATE pl_offers SET status = 'Dropped', updated_at = datetime('now') WHERE pipeline_id = ?").run(id);
    }
    db.prepare(`UPDATE pl_pipeline SET stage = ?, prev_stage = ?, reject_reason = ?, stage_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(to, prev, reason, id);
    db.prepare('INSERT INTO pl_stage_log (pipeline_id, from_stage, to_stage, remark, reason, by_user, at) VALUES (?,?,?,?,?,?,?)')
      .run(id, row.stage, to, remark, reason, user.id, S.nowLocal());
    if (to === 'Screened') db.prepare("UPDATE pl_candidates SET status = 'Screened' WHERE id = ? AND status = 'New'").run(row.candidate_id);
    if (to === 'Rejected' && row.stage !== 'Rejected') {
      // an Active candidate with nothing else going on goes back to the database
      const live = Number(db.prepare("SELECT COUNT(*) c FROM pl_pipeline WHERE candidate_id = ? AND stage NOT IN ('Rejected') AND id <> ?").get(row.candidate_id, id).c);
      if (!live) db.prepare("UPDATE pl_candidates SET status = 'Screened' WHERE id = ? AND status = 'Active'").run(row.candidate_id);
    }
    jobFullCheck(row.job_id);
    return getRow(id);
  })();
}
function STAGE_ORDER(s) { return S.STAGES.indexOf(s); }

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------
const IV_SELECT = `
  SELECT i.*, p.stage, p.job_id, p.candidate_id, c.name AS candidate_name, c.mobile, c.email, c.code AS candidate_code, c.current_company, c.designation,
         j.title AS job_title, j.code AS job_code, a.account_name AS client_name, j.account_id, COALESCE(u.full_name, u.username) AS owner_name, p.owner_id
  FROM pl_interviews i JOIN pl_pipeline p ON p.id = i.pipeline_id JOIN pl_candidates c ON c.id = p.candidate_id
       JOIN pl_jobs j ON j.id = p.job_id JOIN accounts a ON a.id = j.account_id LEFT JOIN users u ON u.id = p.owner_id`;

function whenOf(v) {
  const s = String(v || '').trim().replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) throw bad('Choose the interview date and time.');
  return s;
}
const plusMinutes = (local, min) => {
  const [d, t] = local.split(' ');
  const dt = new Date(`${d}T${t}:00Z`); dt.setUTCMinutes(dt.getUTCMinutes() + min);
  return dt.toISOString().slice(0, 16);
};

function listInterviews(q = {}, user) {
  const where = [S.pipeScope(user, 'p', 'j')]; const params = [];
  const today = S.today();
  const range = q.range;
  if (range === 'today') { where.push('SUBSTR(i.scheduled_at,1,10) = ?'); params.push(today); }
  else if (range === 'tomorrow') { where.push('SUBSTR(i.scheduled_at,1,10) = ?'); params.push(S.today(1)); }
  else if (range === 'week') { where.push('SUBSTR(i.scheduled_at,1,10) >= ? AND SUBSTR(i.scheduled_at,1,10) <= ?'); params.push(today, S.today(7)); }
  else if (range === 'upcoming') { where.push('SUBSTR(i.scheduled_at,1,10) >= ?'); params.push(today); }
  else if (range === 'past') { where.push('SUBSTR(i.scheduled_at,1,10) < ?'); params.push(today); }
  if (q.result) { where.push('i.result = ?'); params.push(q.result); }
  if (q.pending === '1') { where.push("i.result = 'Scheduled' AND i.scheduled_at < ?"); params.push(S.nowLocal()); }
  if (S.idOf(q.job)) { where.push('p.job_id = ?'); params.push(S.idOf(q.job)); }
  if (S.idOf(q.candidate)) { where.push('p.candidate_id = ?'); params.push(S.idOf(q.candidate)); }
  if (S.idOf(q.owner)) { where.push('p.owner_id = ?'); params.push(S.idOf(q.owner)); }
  const order = range === 'past' ? 'DESC' : 'ASC';
  return db.prepare(`${IV_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.scheduled_at ${order}, i.id LIMIT 300`).all(...params);
}
function getInterview(id) { return db.prepare(`${IV_SELECT} WHERE i.id = ?`).get(id); }

function meetingFor(pipe, iv, user, b) {
  const when = iv.scheduled_at;
  const start = when.replace(' ', 'T');
  const end = plusMinutes(when, iv.duration_min || 45);
  const type = iv.mode === 'In person' ? 'In-Person' : iv.mode === 'Phone' ? 'Phone Call' : 'Video Call';
  const attendees = [];
  if (pipe.email) attendees.push({ kind: 'external', module: null, record_id: null, name: pipe.candidate_name, email: pipe.email });
  const rec = db.prepare('SELECT id, full_name, username, email FROM users WHERE id = ?').get(pipe.owner_id || user.id);
  const recMail = rec && (/@/.test(rec.email || '') ? rec.email : /@/.test(rec.username || '') ? rec.username : null);
  if (recMail && !attendees.some((a) => a.email.toLowerCase() === recMail.toLowerCase())) attendees.push({ kind: 'user', module: 'users', record_id: rec.id, name: rec.full_name || rec.username, email: recMail });
  const title = `Interview ${iv.round}: ${pipe.candidate_name} for ${pipe.job_title} (${pipe.client_name})`;
  const agenda = [`Candidate: ${pipe.candidate_name}${pipe.mobile ? ` (${pipe.mobile})` : ''}`, `Opening: ${pipe.job_code} ${pipe.job_title} at ${pipe.client_name}`, iv.panel ? `Panel: ${iv.panel}` : null].filter(Boolean).join('\n');
  return { title, start, end, type, attendees, agenda, link: iv.mode === 'Video' ? iv.link_or_place : null, place: iv.mode === 'In person' ? iv.link_or_place : null };
}
function writeMeeting(pipe, iv, user, b) {
  if (b && b.create_meeting === false) return null;
  try {
    const m = meetingFor(pipe, iv, user, b);
    if (iv.meeting_id && db.prepare('SELECT id FROM meetings WHERE id = ?').get(iv.meeting_id)) {
      db.prepare(`UPDATE meetings SET meeting_title=?, meeting_type=?, location=?, video_link=?, start_datetime=?, end_datetime=?, agenda=?, attendees_json=?,
        status=?, updated_at=datetime('now') WHERE id=?`).run(m.title, m.type, m.place, m.link, m.start, m.end, m.agenda, JSON.stringify(m.attendees),
        iv.result === 'Cancelled' ? 'Cancelled' : iv.result === 'Scheduled' ? 'Scheduled' : 'Completed', iv.meeting_id);
      return iv.meeting_id;
    }
    const cols = ['meeting_title', 'related_module', 'related_record_id', 'meeting_type', 'location', 'video_link', 'start_datetime', 'end_datetime',
      'organizer_id', 'assigned_user_id', 'status', 'agenda', 'time_zone', 'all_day', 'reminder_minutes', 'attendees_json', 'created_by', 'source'];
    const vals = [m.title, 'accounts', pipe.account_id, m.type, m.place, m.link, m.start, m.end, user.id, pipe.owner_id || user.id, 'Scheduled', m.agenda, S.TZ, 0, 30,
      JSON.stringify(m.attendees), user.id, 'crm'];
    return db.prepare(`INSERT INTO meetings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals).lastInsertRowid;
  } catch (e) {
    console.error('[placement] the meeting for an interview could not be written:', e.message);
    return null;
  }
}

function scheduleInterview(pipelineId, body, user) {
  const b = body || {};
  const pipe = getRow(pipelineId);
  if (!pipe) throw bad('That candidate is no longer on the opening.', 404);
  if (['Rejected', 'Joined'].includes(pipe.stage)) throw bad(`This candidate is ${pipe.stage === 'Joined' ? 'already placed' : 'out of the process'}.`);
  const round = S.oneOf(b.round, S.ROUNDS, 'Round') || 'L1';
  const when = whenOf(b.scheduled_at);
  const mode = S.oneOf(b.mode, S.IV_MODES, 'Mode') || 'Video';
  const dur = Math.min(480, Math.max(10, Math.round(Number(b.duration_min) || 45)));
  return db.transaction(() => {
    const id = db.prepare(`INSERT INTO pl_interviews (pipeline_id, round, scheduled_at, duration_min, mode, panel, link_or_place, result, created_by)
      VALUES (?,?,?,?,?,?,?,'Scheduled',?)`).run(pipelineId, round, when, dur, mode, S.text(b.panel, 300), S.text(b.link_or_place, 300), user.id).lastInsertRowid;
    const iv = db.prepare('SELECT * FROM pl_interviews WHERE id = ?').get(id);
    const mid = writeMeeting(pipe, iv, user, b);
    if (mid) db.prepare('UPDATE pl_interviews SET meeting_id = ? WHERE id = ?').run(mid, id);
    const target = STAGE_FOR_ROUND[round];
    if (target && STAGE_ORDER(pipe.stage) >= 0 && STAGE_ORDER(pipe.stage) < STAGE_ORDER(target) && !['Offered', 'Offer accepted'].includes(pipe.stage)) {
      move(pipelineId, { stage: target, remark: `Interview ${round} scheduled for ${when}` }, user);
    }
    return id;
  })();
}

function updateInterview(id, body, user) {
  const b = body || {};
  const cur = db.prepare('SELECT * FROM pl_interviews WHERE id = ?').get(id);
  if (!cur) return null;
  const pipe = getRow(cur.pipeline_id);
  const next = {
    round: b.round === undefined ? cur.round : S.oneOf(b.round, S.ROUNDS, 'Round'),
    scheduled_at: b.scheduled_at === undefined ? cur.scheduled_at : whenOf(b.scheduled_at),
    duration_min: b.duration_min === undefined ? cur.duration_min : Math.min(480, Math.max(10, Math.round(Number(b.duration_min) || 45))),
    mode: b.mode === undefined ? cur.mode : S.oneOf(b.mode, S.IV_MODES, 'Mode'),
    panel: b.panel === undefined ? cur.panel : S.text(b.panel, 300),
    link_or_place: b.link_or_place === undefined ? cur.link_or_place : S.text(b.link_or_place, 300),
    result: b.result === undefined ? cur.result : S.oneOf(b.result, S.IV_RESULTS, 'Result'),
    feedback: b.feedback === undefined ? cur.feedback : S.text(b.feedback, 4000),
  };
  return db.transaction(() => {
    db.prepare(`UPDATE pl_interviews SET round=?, scheduled_at=?, duration_min=?, mode=?, panel=?, link_or_place=?, result=?, feedback=?, updated_at=datetime('now') WHERE id=?`)
      .run(next.round, next.scheduled_at, next.duration_min, next.mode, next.panel, next.link_or_place, next.result, next.feedback, id);
    const iv = db.prepare('SELECT * FROM pl_interviews WHERE id = ?').get(id);
    if (cur.meeting_id) writeMeeting(pipe, iv, user, b);
    else if (b.scheduled_at !== undefined && next.result === 'Scheduled') {
      const mid = writeMeeting(pipe, iv, user, b);
      if (mid) db.prepare('UPDATE pl_interviews SET meeting_id = ? WHERE id = ?').run(mid, id);
    }
    const changed = b.result !== undefined && next.result !== cur.result;
    if (changed && b.advance !== false) {
      if (next.result === 'Cleared') {
        const here = STAGE_FOR_ROUND[next.round];
        const idx = STAGE_ORDER(pipe.stage);
        if (pipe.stage === here && here !== 'Final round') {
          move(pipe.id, { stage: S.STAGES[idx + 1], remark: `${next.round} cleared` }, user);
        } else if (pipe.stage === 'Final round' && next.round !== 'HR') {
          // final cleared: the next step is the offer, which needs a CTC, so the person moves it
        }
      } else if (next.result === 'Rejected' && !['Rejected', 'Joined'].includes(pipe.stage)) {
        move(pipe.id, { stage: 'Rejected', reason: S.oneOf(b.reason, S.REJECT_REASONS, 'Reason') || 'Client rejected', remark: `${next.round} not cleared${next.feedback ? `: ${next.feedback}` : ''}` }, user);
      } else if (next.result === 'No show' && !['Rejected', 'Joined'].includes(pipe.stage) && b.reject_no_show === true) {
        move(pipe.id, { stage: 'Rejected', reason: 'Did not turn up', remark: `${next.round}: did not turn up` }, user);
      }
    }
    return id;
  })();
}
function removeInterview(id) {
  const cur = db.prepare('SELECT meeting_id FROM pl_interviews WHERE id = ?').get(id);
  if (!cur) return;
  db.prepare('DELETE FROM pl_interviews WHERE id = ?').run(id);
  if (cur.meeting_id) { try { db.prepare("UPDATE meetings SET status = 'Cancelled' WHERE id = ?").run(cur.meeting_id); } catch { /* the meeting is gone */ } }
}

// ---------------------------------------------------------------------------
// Offers, joining, billing
// ---------------------------------------------------------------------------
const OFFER_SELECT = `
  SELECT o.*, p.stage, p.job_id, p.candidate_id, p.owner_id, c.name AS candidate_name, c.code AS candidate_code, c.mobile, c.current_ctc, c.expected_ctc,
         j.code AS job_code, j.title AS job_title, j.account_id, a.account_name AS client_name, COALESCE(u.full_name, u.username) AS owner_name,
         d.doc_number AS invoice_number, d.payment_status AS invoice_payment, d.status AS invoice_status, d.grand_total AS invoice_total
  FROM pl_offers o JOIN pl_pipeline p ON p.id = o.pipeline_id JOIN pl_candidates c ON c.id = p.candidate_id
       JOIN pl_jobs j ON j.id = p.job_id JOIN accounts a ON a.id = j.account_id LEFT JOIN users u ON u.id = p.owner_id
       LEFT JOIN sales_documents d ON d.id = o.invoice_id`;

function listOffers(q = {}, user) {
  const where = [S.pipeScope(user, 'p', 'j')]; const params = [];
  if (q.status && q.status !== 'all') {
    if (q.status === 'pending') where.push("o.status IN ('Offered','Accepted')");
    else { where.push('o.status = ?'); params.push(q.status); }
  }
  if (q.uninvoiced === '1') where.push("o.status = 'Joined' AND o.invoice_id IS NULL");
  if (S.idOf(q.client)) { where.push('j.account_id = ?'); params.push(S.idOf(q.client)); }
  const rows = db.prepare(`${OFFER_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(o.actual_joining, o.expected_joining, o.offer_date) DESC, o.id DESC LIMIT 500`).all(...params);
  const today = S.today();
  return rows.map((r) => ({
    ...r,
    in_guarantee: r.status === 'Joined' && r.guarantee_end && r.guarantee_end >= today,
    guarantee_left: r.status === 'Joined' && r.guarantee_end ? Math.round((new Date(`${r.guarantee_end}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null,
    joining_in: ['Offered', 'Accepted'].includes(r.status) && r.expected_joining ? Math.round((new Date(`${r.expected_joining}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null,
  }));
}

function updateOffer(id, body, user) {
  const b = body || {};
  const o = db.prepare('SELECT * FROM pl_offers WHERE id = ?').get(id);
  if (!o) return null;
  const row = getRow(o.pipeline_id);
  // check what was typed before anything is saved
  const dateOk = (v) => v === null || v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()));
  if (b.offered_ctc !== undefined && b.offered_ctc !== '' && b.offered_ctc !== null) {
    const c = S.numOrNull(b.offered_ctc);
    if (c === null || !(c > 0) || c > 1000) throw bad('The offered CTC must be more than 0 and not more than 1000 lakh a year.');
  }
  if (b.fee_percent !== undefined && b.fee_percent !== '' && b.fee_percent !== null) {
    const f = S.numOrNull(b.fee_percent);
    if (f === null || f < 0 || f > 100) throw bad('The fee % must be between 0 and 100.');
  }
  if (b.guarantee_days !== undefined && b.guarantee_days !== '' && b.guarantee_days !== null) {
    const g = S.numOrNull(b.guarantee_days);
    if (g === null || g < 0 || g > 730) throw bad('The guarantee must be between 0 and 730 days.');
  }
  for (const k of ['offer_date', 'expected_joining', 'actual_joining']) {
    if (b[k] !== undefined && !dateOk(b[k])) throw bad('Enter a proper date.');
  }
  return db.transaction(() => {
    const sets = []; const vals = [];
    const set = (k, v) => { sets.push(`${k} = ?`); vals.push(v); };
    if (b.offered_ctc !== undefined) {
      const ctc = S.numOrNull(b.offered_ctc);
      set('offered_ctc', ctc);
      const pct = b.fee_percent !== undefined ? S.numOrNull(b.fee_percent) : o.fee_percent;
      set('fee_percent', pct);
      set('fee_amount', ctc && pct ? Math.round(ctc * 100000 * (pct / 100)) : 0);
    } else if (b.fee_percent !== undefined) {
      const pct = S.numOrNull(b.fee_percent);
      set('fee_percent', pct);
      set('fee_amount', o.offered_ctc && pct ? Math.round(o.offered_ctc * 100000 * (pct / 100)) : 0);
    }
    if (b.offer_date !== undefined) set('offer_date', S.text(b.offer_date, 10));
    if (b.expected_joining !== undefined) set('expected_joining', S.text(b.expected_joining, 10));
    if (b.notes !== undefined) set('notes', S.text(b.notes, 2000));
    if (b.guarantee_days !== undefined) set('guarantee_days', S.numOrNull(b.guarantee_days));
    if (sets.length) db.prepare(`UPDATE pl_offers SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id);

    const status = b.status === undefined ? null : S.oneOf(b.status, S.OFFER_STATUS, 'Status');
    if (status && status !== o.status) {
      if (status === 'Accepted') move(row.id, { stage: 'Offer accepted', remark: b.remark }, user);
      else if (status === 'Offered') move(row.id, { stage: 'Offered', remark: b.remark }, user);
      else if (status === 'Joined') move(row.id, { stage: 'Joined', joining_date: b.actual_joining, remark: b.remark }, user);
      else if (status === 'Declined') move(row.id, { stage: 'Rejected', reason: S.oneOf(b.decline_reason, S.REJECT_REASONS, 'Reason') || 'Candidate not interested', remark: b.remark }, user);
      else if (status === 'Dropped') {
        const reason = S.oneOf(b.decline_reason, S.REJECT_REASONS, 'Reason') || 'Backed out';
        if (row.stage === 'Joined') {
          // left within the guarantee: the person goes out, the position opens again
          db.prepare("UPDATE pl_pipeline SET stage='Rejected', prev_stage='Joined', reject_reason=?, stage_changed_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(reason, row.id);
          db.prepare('INSERT INTO pl_stage_log (pipeline_id, from_stage, to_stage, remark, reason, by_user, at) VALUES (?,?,?,?,?,?,?)')
            .run(row.id, 'Joined', 'Rejected', S.text(b.remark, 1000) || 'Left within the guarantee period', reason, user.id, S.nowLocal());
          db.prepare("UPDATE pl_offers SET status='Dropped', decline_reason=?, updated_at=datetime('now') WHERE id=?").run(reason, id);
          db.prepare("UPDATE pl_candidates SET status='Active' WHERE id=? AND status='Placed'").run(row.candidate_id);
          jobFullCheck(row.job_id);
        } else {
          move(row.id, { stage: 'Rejected', reason, remark: b.remark }, user);
        }
      }
    }
    if (b.actual_joining !== undefined && (status === null || status === 'Joined') && o.status === 'Joined') {
      const d = S.text(b.actual_joining, 10);
      const days = Number(db.prepare('SELECT guarantee_days FROM pl_offers WHERE id = ?').get(id).guarantee_days) || 0;
      db.prepare('UPDATE pl_offers SET actual_joining = ?, guarantee_end = ? WHERE id = ?').run(d, d && days ? S.addDays(d, days) : null, id);
    }
    return id;
  })();
}

function createInvoice(offerId, user) {
  const docs = require('../documentService');
  const o = db.prepare(`${OFFER_SELECT} WHERE o.id = ?`).get(offerId);
  if (!o) throw bad('That offer no longer exists.', 404);
  if (o.status !== 'Joined') throw bad('The invoice can be made once the candidate has joined.');
  if (o.invoice_id) throw bad(`An invoice was already made: ${o.invoice_number || ''}.`, 409, { invoice_id: o.invoice_id });
  if (!o.fee_amount) throw bad('The fee is zero. Enter the offered CTC and the fee % on the offer first.');
  const terms = db.prepare('SELECT payment_terms FROM pl_client_terms WHERE account_id = ?').get(o.account_id) || {};
  const gst = S.getSettings().gst_percent;
  return db.transaction(() => {
    const id = docs.create('invoice', {
      account_id: o.account_id,
      payment_terms: terms.payment_terms || 'Net 30',
      notes: `Placement fee — ${o.candidate_name}, ${o.job_title} (${o.job_code}). Joined on ${o.actual_joining}.`,
      items: [{
        description: `Placement fee: ${o.candidate_name} as ${o.job_title} · CTC ₹${o.offered_ctc} lakh · ${o.fee_percent}% · joined ${o.actual_joining}`,
        hsn_sac: '998511', quantity: 1, unit: 'Nos', unit_price: o.fee_amount, tax_percent: gst,
      }],
    }, user.id);
    db.prepare("UPDATE pl_offers SET invoice_id = ?, updated_at = datetime('now') WHERE id = ?").run(id, offerId);
    const d = db.prepare('SELECT id, doc_number, grand_total FROM sales_documents WHERE id = ?').get(id);
    return { invoice_id: id, doc_number: d.doc_number, grand_total: d.grand_total };
  })();
}

module.exports = {
  list, get, getRow, board, addToJob, removeFromJob, move,
  listInterviews, getInterview, scheduleInterview, updateInterview, removeInterview,
  listOffers, updateOffer, createInvoice, ensureOffer, daysIn,
};
