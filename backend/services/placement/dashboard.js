// ============================================================================
// Placement desk — the dashboard figures and the invoice list.
// ============================================================================
const db = require('../../db');
const S = require('./store');
const candidates = require('./candidates');
const contract = require('./contract');
const jobsSvc = require('./jobs');

const n = (v) => Number(v) || 0;
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

function summary(user) {
  const today = S.today();
  const tomorrow = S.today(1);
  const weekAgo = S.today(-7);
  const twoWeeksAgo = S.today(-14);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthStart = `${S.monthOf(S.addDays(monthStart, -1))}-01`;
  const js = S.jobScope(user, 'j');
  const ps = S.pipeScope(user, 'p', 'j');

  // positions to fill
  const open = one(`SELECT COUNT(*) AS jobs, COALESCE(SUM(j.positions),0) AS positions,
      COALESCE(SUM(CASE WHEN j.priority='Hot' THEN 1 ELSE 0 END),0) AS hot FROM pl_jobs j WHERE j.status='Open' AND ${js}`);
  const joinedOnOpen = n(one(`SELECT COUNT(*) c FROM pl_pipeline p JOIN pl_jobs j ON j.id=p.job_id WHERE p.stage='Joined' AND j.status='Open' AND ${js}`).c);

  // submissions
  const subSql = `SELECT COUNT(DISTINCT l.pipeline_id) c FROM pl_stage_log l JOIN pl_pipeline p ON p.id=l.pipeline_id JOIN pl_jobs j ON j.id=p.job_id
      WHERE l.to_stage='Submitted' AND SUBSTR(l.at,1,10) > ? AND SUBSTR(l.at,1,10) <= ? AND ${ps}`;
  const subsWeek = n(one(subSql, weekAgo, today).c);
  const subsPrev = n(one(subSql, twoWeeksAgo, weekAgo).c);

  // interviews
  const ivSql = `SELECT COUNT(*) c FROM pl_interviews i JOIN pl_pipeline p ON p.id=i.pipeline_id JOIN pl_jobs j ON j.id=p.job_id
      WHERE SUBSTR(i.scheduled_at,1,10) = ? AND i.result NOT IN ('Cancelled') AND ${ps}`;
  const ivToday = n(one(ivSql, today).c);
  const ivTomorrow = n(one(ivSql, tomorrow).c);
  const awaiting = n(one(`SELECT COUNT(*) c FROM pl_interviews i JOIN pl_pipeline p ON p.id=i.pipeline_id JOIN pl_jobs j ON j.id=p.job_id
      WHERE i.result='Scheduled' AND i.scheduled_at < ? AND ${ps}`, S.nowLocal()).c);

  // offers and joinings
  const offerBase = `FROM pl_offers o JOIN pl_pipeline p ON p.id=o.pipeline_id JOIN pl_jobs j ON j.id=p.job_id`;
  const pending = one(`SELECT COUNT(*) AS c, COALESCE(SUM(o.fee_amount),0) AS fee ${offerBase} WHERE o.status IN ('Offered','Accepted') AND ${ps}`);
  const joinedMonth = one(`SELECT COUNT(*) AS c, COALESCE(SUM(o.fee_amount),0) AS fee ${offerBase} WHERE o.status='Joined' AND o.actual_joining >= ? AND ${ps}`, monthStart);
  const joinedPrev = one(`SELECT COUNT(*) AS c ${offerBase} WHERE o.status='Joined' AND o.actual_joining >= ? AND o.actual_joining < ? AND ${ps}`, prevMonthStart, monthStart);
  const uninvoiced = one(`SELECT COUNT(*) AS c, COALESCE(SUM(o.fee_amount),0) AS fee ${offerBase} WHERE o.status='Joined' AND o.invoice_id IS NULL AND ${ps}`);
  const billedMonth = n(one(`SELECT COALESCE(SUM(d.grand_total),0) AS t FROM sales_documents d
      WHERE d.doc_type='invoice' AND d.status <> 'Cancelled' AND SUBSTR(d.doc_date,1,10) >= ?
        AND (d.id IN (SELECT invoice_id FROM pl_offers WHERE invoice_id IS NOT NULL) OR d.id IN (SELECT invoice_id FROM pl_timesheets WHERE invoice_id IS NOT NULL))`, S.today(-30)).t);
  const outstanding = n(one(`SELECT COALESCE(SUM(d.balance_due),0) AS t FROM sales_documents d
      WHERE d.doc_type='invoice' AND d.status <> 'Cancelled'
        AND (d.id IN (SELECT invoice_id FROM pl_offers WHERE invoice_id IS NOT NULL) OR d.id IN (SELECT invoice_id FROM pl_timesheets WHERE invoice_id IS NOT NULL))`).t);

  // funnel (all candidates on open openings)
  const stageRows = all(`SELECT p.stage, COUNT(*) AS c FROM pl_pipeline p JOIN pl_jobs j ON j.id=p.job_id WHERE j.status IN ('Open','On hold') AND ${ps} GROUP BY p.stage`);
  const stageMap = new Map(stageRows.map((r) => [r.stage, n(r.c)]));
  const funnel = S.ALL_STAGES.map((stage) => ({ stage, count: stageMap.get(stage) || 0 }));

  // recruiter leaderboard, last 30 days
  const since30 = S.today(-30);
  const leaders = all(`SELECT u.id, COALESCE(u.full_name,u.username) AS name,
      (SELECT COUNT(DISTINCT l.pipeline_id) FROM pl_stage_log l JOIN pl_pipeline p ON p.id=l.pipeline_id WHERE p.owner_id=u.id AND l.to_stage='Submitted' AND SUBSTR(l.at,1,10) > ?) AS submissions,
      (SELECT COUNT(*) FROM pl_interviews i JOIN pl_pipeline p ON p.id=i.pipeline_id WHERE p.owner_id=u.id AND SUBSTR(i.scheduled_at,1,10) > ? AND i.result <> 'Cancelled') AS interviews,
      (SELECT COUNT(*) FROM pl_offers o JOIN pl_pipeline p ON p.id=o.pipeline_id WHERE p.owner_id=u.id AND o.status='Joined' AND o.actual_joining > ?) AS joined,
      (SELECT COALESCE(SUM(o.fee_amount),0) FROM pl_offers o JOIN pl_pipeline p ON p.id=o.pipeline_id WHERE p.owner_id=u.id AND o.status='Joined' AND o.actual_joining > ?) AS fee
    FROM users u WHERE u.active = 1 AND u.id IN (SELECT owner_id FROM pl_pipeline WHERE owner_id IS NOT NULL)
    ORDER BY 5 DESC, 2 DESC LIMIT 12`, since30, since30, since30, since30)
    .map((r) => ({ ...r, submissions: n(r.submissions), interviews: n(r.interviews), joined: n(r.joined), fee: n(r.fee) }))
    .sort((a, b) => b.fee - a.fee || b.joined - a.joined || b.submissions - a.submissions);
  const myScope = S.visibleIds(user);
  const board = myScope ? leaders.filter((r) => myScope.includes(Number(r.id))) : leaders;

  // average days to fill
  const filled = all(`SELECT j.opened_on, j.closed_on FROM pl_jobs j WHERE j.status='Filled' AND j.closed_on IS NOT NULL AND j.opened_on IS NOT NULL AND ${js}`);
  const daysToFill = filled.length ? Math.round(filled.reduce((s, r) => s + Math.max(0, (new Date(`${r.closed_on}T00:00:00Z`) - new Date(`${r.opened_on}T00:00:00Z`)) / 86400000), 0) / filled.length) : null;

  // where the candidates come from
  const sources = all(`SELECT c.source AS source, COUNT(*) AS candidates,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM pl_pipeline p WHERE p.candidate_id=c.id AND EXISTS (SELECT 1 FROM pl_stage_log l WHERE l.pipeline_id=p.id AND l.to_stage IN (${jobsSvc.SUBMITTED_STAGES}))) THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN c.status='Placed' THEN 1 ELSE 0 END) AS placed
    FROM pl_candidates c WHERE c.source IS NOT NULL AND ${S.candScope(user, 'c')} GROUP BY c.source ORDER BY placed DESC, candidates DESC`)
    .map((r) => ({ source: r.source, candidates: n(r.candidates), submitted: n(r.submitted), placed: n(r.placed), rate: n(r.candidates) ? Math.round((n(r.placed) / n(r.candidates)) * 1000) / 10 : 0 }));

  // placements and fee for the last 6 months
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(`${monthStart}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const byMonth = all(`SELECT SUBSTR(o.actual_joining,1,7) AS m, COUNT(*) AS c, COALESCE(SUM(o.fee_amount),0) AS fee ${offerBase}
      WHERE o.status='Joined' AND o.actual_joining >= ? AND ${ps} GROUP BY SUBSTR(o.actual_joining,1,7)`, `${months[0]}-01`);
  const bm = new Map(byMonth.map((r) => [r.m, r]));
  const trend = months.map((m) => ({ month: m, placements: n((bm.get(m) || {}).c), fee: n((bm.get(m) || {}).fee) }));

  const reasons = all(`SELECT p.reject_reason AS reason, COUNT(*) AS c FROM pl_pipeline p JOIN pl_jobs j ON j.id=p.job_id WHERE p.stage='Rejected' AND p.reject_reason IS NOT NULL AND ${ps}
      GROUP BY p.reject_reason ORDER BY c DESC`).map((r) => ({ reason: r.reason, count: n(r.c) }));

  const cold = jobsSvc.listJobs({ status: 'Open', cold: '1' }, user).slice(0, 8)
    .map((j) => ({ id: j.id, code: j.code, title: j.title, client_name: j.client_name, quiet_days: j.quiet_days, priority: j.priority, active_count: j.active_count }));

  const nextInterviews = all(`SELECT i.id, i.scheduled_at, i.round, i.mode, c.name AS candidate_name, j.title AS job_title, a.account_name AS client_name, p.id AS pipeline_id
      FROM pl_interviews i JOIN pl_pipeline p ON p.id=i.pipeline_id JOIN pl_candidates c ON c.id=p.candidate_id JOIN pl_jobs j ON j.id=p.job_id JOIN accounts a ON a.id=j.account_id
      WHERE i.result='Scheduled' AND SUBSTR(i.scheduled_at,1,10) >= ? AND ${ps} ORDER BY i.scheduled_at LIMIT 6`, today);
  const joiningSoon = all(`SELECT o.id, o.expected_joining, o.offered_ctc, o.status, c.name AS candidate_name, j.title AS job_title, a.account_name AS client_name
      FROM pl_offers o JOIN pl_pipeline p ON p.id=o.pipeline_id JOIN pl_candidates c ON c.id=p.candidate_id JOIN pl_jobs j ON j.id=p.job_id JOIN accounts a ON a.id=j.account_id
      WHERE o.status IN ('Offered','Accepted') AND ${ps} ORDER BY o.expected_joining LIMIT 6`);
  const followUps = candidates.followUps(user).slice(0, 6);

  // contract staffing
  const dep = contract.list({ status: 'Active' }, user);
  const billing = dep.reduce((s, d) => s + n(d.bill_rate), 0);
  const payout = dep.reduce((s, d) => s + n(d.pay_rate), 0);
  const renewals = dep.filter((d) => d.renewal_due).sort((a, b) => (a.ends_in || 0) - (b.ends_in || 0));

  const guarantee = all(`SELECT o.id, o.guarantee_end, c.name AS candidate_name, a.account_name AS client_name
      FROM pl_offers o JOIN pl_pipeline p ON p.id=o.pipeline_id JOIN pl_candidates c ON c.id=p.candidate_id JOIN pl_jobs j ON j.id=p.job_id JOIN accounts a ON a.id=j.account_id
      WHERE o.status='Joined' AND o.guarantee_end >= ? AND o.guarantee_end <= ? AND ${ps} ORDER BY o.guarantee_end LIMIT 6`, today, S.today(14));

  return {
    as_of: today,
    open: { jobs: n(open.jobs), positions: Math.max(0, n(open.positions) - joinedOnOpen), hot: n(open.hot) },
    submissions: { week: subsWeek, previous: subsPrev },
    interviews: { today: ivToday, tomorrow: ivTomorrow, awaiting_feedback: awaiting },
    offers: { pending: n(pending.c), pending_fee: n(pending.fee) },
    joined: { month: n(joinedMonth.c), month_fee: n(joinedMonth.fee), previous_month: n(joinedPrev.c) },
    fees: { billed_30: billedMonth, pipeline: n(pending.fee), uninvoiced: n(uninvoiced.fee), uninvoiced_count: n(uninvoiced.c), outstanding },
    funnel, leaderboard: board, days_to_fill: daysToFill, sources, trend, reasons, cold,
    next_interviews: nextInterviews, joining_soon: joiningSoon, follow_ups: followUps, guarantee_ending: guarantee,
    contract: { active: dep.length, billing, payout, margin: billing - payout, margin_percent: billing ? Math.round(((billing - payout) / billing) * 1000) / 10 : 0, renewals: renewals.slice(0, 6), renewal_count: renewals.length },
  };
}

// Invoices made from here (placement fee or contract staffing), with how they stand.
function invoices(q = {}, user) {
  const ps = S.pipeScope(user, 'p', 'j');
  const rows = all(`
    SELECT d.id, d.doc_number, d.doc_date, d.due_date, d.grand_total, d.balance_due, d.payment_status, d.status, a.account_name AS client_name, d.account_id,
           'Placement fee' AS kind, c.name AS detail
    FROM sales_documents d JOIN pl_offers o ON o.invoice_id = d.id JOIN pl_pipeline p ON p.id = o.pipeline_id JOIN pl_jobs j ON j.id = p.job_id
         JOIN pl_candidates c ON c.id = p.candidate_id JOIN accounts a ON a.id = d.account_id
    WHERE ${ps}
    UNION ALL
    SELECT d.id, d.doc_number, d.doc_date, d.due_date, d.grand_total, d.balance_due, d.payment_status, d.status, a.account_name AS client_name, d.account_id,
           'Contract staffing' AS kind, MIN(t.month) AS detail
    FROM sales_documents d JOIN pl_timesheets t ON t.invoice_id = d.id JOIN pl_deployed dp ON dp.id = t.deployed_id JOIN accounts a ON a.id = d.account_id
    GROUP BY d.id, d.doc_number, d.doc_date, d.due_date, d.grand_total, d.balance_due, d.payment_status, d.status, a.account_name, d.account_id
    ORDER BY 3 DESC, 1 DESC`);
  const today = S.today();
  let out = rows.map((r) => ({ ...r, grand_total: n(r.grand_total), balance_due: n(r.balance_due), overdue: n(r.balance_due) > 0 && r.due_date && String(r.due_date).slice(0, 10) < today }));
  if (q.kind) out = out.filter((r) => r.kind === q.kind);
  if (q.status === 'unpaid') out = out.filter((r) => n(r.balance_due) > 0);
  if (q.status === 'overdue') out = out.filter((r) => r.overdue);
  const totals = {
    billed: out.reduce((s, r) => s + r.grand_total, 0),
    outstanding: out.reduce((s, r) => s + r.balance_due, 0),
    overdue: out.filter((r) => r.overdue).reduce((s, r) => s + r.balance_due, 0),
  };
  return { rows: out, totals };
}

module.exports = { summary, invoices };
