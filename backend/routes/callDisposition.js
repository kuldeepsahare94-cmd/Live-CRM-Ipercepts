// Call disposition + call analytics.
//
// The dispose flow mirrors how a dialler actually works:
//   1. Agent opens Dispose on a lead -> the client starts a timer.
//   2. Agent answers "was it connected?", picks a disposition, optionally
//      sets a follow-up.
//   3. Client POSTs here with the elapsed seconds. The server is the one
//      that stamps disposed_at, so report timestamps can't be spoofed by a
//      wrong clock on the agent's machine.
//
// Mount: app.use('/api/calls', requireAuth, require('./routes/callDisposition'));
// (mounted BEFORE routes/calls.js so these specific paths win over the
// generic /:id handlers in the activity router)

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requirePermission } = require('../middleware/auth');
const { fireWorkflows } = require('../services/workflowAutomation');
const followUps = require('../services/followUps');

const hhmmss = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');
};

// POST /api/calls/dispose — the red "Dispose" button.
// One action records what happened AND what happens next:
//   response   connected: true/false, duration, notes
//   outcome    disposition (from the call-outcome lists), lead status
//   next step  next_action: 'schedule' -> follow_up_at (exact instant, ISO)
//                                         [+ follow_up_notes, follow_up_assigned_user_id]
//              next_action: 'close'    -> no further follow-up
// Either way the follow-up that was open on the record is marked Completed,
// because this is the interaction it was waiting for.
//
// Older clients that send only follow_up_date (a plain date) still work: that
// schedules a date-only follow-up and leaves everything else as it was.
router.post('/dispose', requirePermission('calls', 'create'), (req, res) => {
  const b = req.body || {};
  if (b.connected === undefined || b.connected === null) {
    return res.status(400).json({ error: 'connected (true/false) is required' });
  }
  if (!b.disposition) return res.status(400).json({ error: 'disposition is required' });
  const nextAction = b.next_action || (b.follow_up_at || b.follow_up_date ? 'schedule' : null);
  if (nextAction && !['schedule', 'close'].includes(nextAction)) {
    return res.status(400).json({ error: "next_action must be 'schedule' or 'close'" });
  }
  if (nextAction === 'schedule' && !b.follow_up_at && !b.follow_up_date) {
    return res.status(400).json({ error: 'Pick the follow-up date and time.' });
  }

  const module = b.related_module || 'leads';
  const recordId = b.related_record_id ? Number(b.related_record_id) : null;

  // Validate the follow-up BEFORE anything is written, so a bad time never
  // leaves a half-logged call behind.
  let due = null;
  if (nextAction === 'schedule') {
    if (b.follow_up_at) {
      const d = new Date(b.follow_up_at);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Pick a valid follow-up date and time.' });
      if (d.getTime() < Date.now() - 5 * 60000) return res.status(400).json({ error: 'Pick a follow-up time in the future.' });
      due = { dueAt: d.toISOString(), hasTime: b.follow_up_has_time !== false };
    } else {
      due = { date: String(b.follow_up_date).slice(0, 16), hasTime: false };
    }
    if (!recordId) return res.status(400).json({ error: 'A follow-up needs the record it belongs to.' });
  }

  const durationSeconds = Math.max(0, Math.round(Number(b.duration_seconds) || 0));
  const formSeconds = Math.max(0, Math.round(Number(b.form_seconds) || 0));
  const connected = b.connected ? 1 : 0;

  // Subject reads well in the activity timeline without the agent typing one.
  const subject = b.call_subject
    || `${connected ? 'Connected' : 'Not connected'} — ${b.disposition}`;

  // The call row keeps the follow-up's local date and time, so the call
  // record itself still says when the next step is.
  let callFollowUp = null;
  if (due && due.dueAt) {
    const hm = new Intl.DateTimeFormat('en-GB', {
      timeZone: followUps.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(due.dueAt));
    callFollowUp = `${followUps.crmDate(due.dueAt)} ${hm}`;
  } else if (due) {
    callFollowUp = due.date;
  }

  let created;
  let followUp = null;
  let leadBefore = null;       // the lead as it was, when this call also moves its status
  try {
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO calls (
          call_subject, related_module, related_record_id, phone_number, call_type, direction,
          start_time, duration_seconds, duration_minutes, connected, status, call_outcome,
          notes, follow_up_date, next_action, assigned_user_id, created_by, disposed_at, form_seconds
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)
      `).run(
        subject, module, recordId, b.phone_number || null,
        b.call_type || 'Sales Call', b.direction || 'Outbound',
        b.start_time || new Date(Date.now() - durationSeconds * 1000).toISOString(),
        durationSeconds,
        Math.round(durationSeconds / 60),          // kept in sync for existing readers
        connected,
        connected ? 'Completed' : 'No Answer',
        b.disposition,
        b.notes || null, callFollowUp, b.next_action_text || (nextAction === 'close' ? 'No further follow-up' : null),
        req.user.id, req.user.id, formSeconds
      );
      const callId = info.lastInsertRowid;

      // Optionally move the lead's own status in the same action, so the
      // agent doesn't have to edit the lead separately after every call.
      if (module === 'leads' && recordId) {
        if (b.lead_status) {
          const before = db.prepare('SELECT * FROM leads WHERE id=?').get(recordId);
          leadBefore = before || null;
          db.prepare('UPDATE leads SET status=? WHERE id=?').run(b.lead_status, recordId);
          if (before && before.status !== b.lead_status) {
            db.prepare('INSERT INTO lead_activities (lead_id, type, note) VALUES (?,?,?)')
              .run(recordId, 'status_change', `${before.status} → ${b.lead_status}`);
          }
        }
        db.prepare('INSERT INTO lead_activities (lead_id, type, note) VALUES (?,?,?)')
          .run(recordId, 'call',
            `${connected ? 'Connected' : 'Not connected'} · ${b.disposition} · ${hhmmss(durationSeconds)}${b.notes ? ` — ${b.notes}` : ''}`);
      }

      if (recordId && nextAction) {
        followUps.completeOpenForRecord(module, recordId, {
          userId: req.user.id, note: `Outcome: ${b.disposition}${b.notes ? ` — ${b.notes}` : ''}`, callId,
        });
      }
      if (due) {
        followUp = followUps.schedule({
          module, recordId, ...due, timeZone: b.follow_up_time_zone,
          subject: b.follow_up_subject || 'Follow-up call', notes: b.follow_up_notes || null,
          assignedUserId: b.follow_up_assigned_user_id, userId: req.user.id, origin: 'outcome', callId,
          allowPast: !due.dueAt,
        });
      }
      return callId;
    });
    const callId = tx();
    created = db.prepare('SELECT * FROM calls WHERE id=?').get(callId);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Could not save the outcome' });
  }

  fireWorkflows('calls', 'record_created', created, null, req.user.id);
  // The lead's status was moved in the same action: workflows that watch the
  // lead ("status changes to…", "lead marked dead") hear about it too.
  if (leadBefore && leadBefore.status !== b.lead_status) {
    try { fireWorkflows('leads', 'record_updated', db.prepare('SELECT * FROM leads WHERE id=?').get(leadBefore.id), leadBefore, req.user.id); } catch { /* never break the save */ }
  }
  res.status(201).json({ ...created, follow_up: followUp });
});

// GET /api/calls/report?from=&to=&user_id=
// Non-admins are scoped to their own calls; the UI hides the user filter
// for them, but the server enforces it rather than trusting the client.
router.get('/report', requirePermission('calls', 'view'), (req, res) => {
  const canSeeAll = !!req.user.permissions?.users?.view;
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to = req.query.to || from;
  const userId = canSeeAll ? (req.query.user_id || null) : req.user.id;

  const where = [`date(COALESCE(c.disposed_at, c.created_at)) BETWEEN date(?) AND date(?)`];
  const params = [from, to];
  if (userId) { where.push('c.assigned_user_id = ?'); params.push(userId); }
  const W = where.join(' AND ');

  const one = (sql, ...p) => db.prepare(sql).get(...p) || {};

  const overview = one(`
    SELECT
      COUNT(*)                                            AS total_calls,
      COALESCE(SUM(CASE WHEN c.connected=1 THEN 1 ELSE 0 END),0) AS connected_calls,
      COALESCE(SUM(CASE WHEN c.connected=0 THEN 1 ELSE 0 END),0) AS unconnected_calls,
      COALESCE(SUM(c.duration_seconds),0)                 AS total_seconds,
      COALESCE(AVG(c.duration_seconds),0)                 AS avg_seconds,
      COALESCE(AVG(NULLIF(c.form_seconds,0)),0)           AS avg_form_seconds,
      COALESCE(SUM(CASE WHEN c.direction='Outbound' THEN 1 ELSE 0 END),0) AS outbound,
      COALESCE(SUM(CASE WHEN c.direction='Inbound'  THEN 1 ELSE 0 END),0) AS inbound
    FROM calls c WHERE ${W}
  `, ...params);

  // Talk time is only meaningful across connected calls — averaging in
  // zero-length unconnected attempts would understate it badly.
  const connectedAvg = one(`
    SELECT COALESCE(AVG(c.duration_seconds),0) AS v FROM calls c WHERE ${W} AND c.connected=1
  `, ...params).v || 0;

  const dispositions = db.prepare(`
    SELECT c.call_outcome AS disposition,
           COUNT(*) AS count,
           COALESCE(SUM(c.duration_seconds),0) AS total_seconds,
           MAX(c.connected) AS connected
    FROM calls c WHERE ${W} AND c.call_outcome IS NOT NULL
    GROUP BY c.call_outcome ORDER BY count DESC
  `).all(...params);

  const byAgent = canSeeAll ? db.prepare(`
    SELECT COALESCE(u.full_name, u.username, 'Unassigned') AS agent,
           COUNT(*) AS total_calls,
           COALESCE(SUM(CASE WHEN c.connected=1 THEN 1 ELSE 0 END),0) AS connected_calls,
           COALESCE(SUM(c.duration_seconds),0) AS total_seconds
    FROM calls c LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE ${W} GROUP BY c.assigned_user_id ORDER BY total_calls DESC
  `).all(...params) : [];

  const byDay = db.prepare(`
    SELECT date(COALESCE(c.disposed_at, c.created_at)) AS day,
           COUNT(*) AS total_calls,
           COALESCE(SUM(CASE WHEN c.connected=1 THEN 1 ELSE 0 END),0) AS connected_calls,
           COALESCE(SUM(c.duration_seconds),0) AS total_seconds
    FROM calls c WHERE ${W} GROUP BY day ORDER BY day
  `).all(...params);

  // Follow-up health, scoped to the same agent where one is selected.
  const today = new Date().toISOString().slice(0, 10);
  const leadWhere = userId ? 'AND l.assigned_counselor = (SELECT COALESCE(full_name, username) FROM users WHERE id=?)' : '';
  const leadParams = userId ? [userId] : [];

  const dueToday = one(`SELECT COUNT(*) c FROM leads l WHERE date(l.follow_up_date)=date(?) ${leadWhere}`, today, ...leadParams).c || 0;
  const overdue = one(`SELECT COUNT(*) c FROM leads l WHERE l.follow_up_date IS NOT NULL AND date(l.follow_up_date) < date(?) AND l.status NOT IN ('Converted','Not Interested','Dropped') ${leadWhere}`, today, ...leadParams).c || 0;
  const doneToday = one(`SELECT COUNT(DISTINCT c.related_record_id) c FROM calls c WHERE c.related_module='leads' AND date(COALESCE(c.disposed_at,c.created_at))=date(?) ${userId ? 'AND c.assigned_user_id=?' : ''}`, today, ...(userId ? [userId] : [])).c || 0;

  const connectRate = overview.total_calls ? (overview.connected_calls / overview.total_calls) * 100 : 0;
  // Compliance = of the follow-ups that were due, how many were actually
  // called. Reported as null (not 0%) when nothing was due, since 0% would
  // wrongly read as a failure.
  const dueTotal = dueToday + overdue;
  const compliance = dueTotal > 0 ? Math.min(100, (doneToday / dueTotal) * 100) : null;

  res.json({
    range: { from, to, user_id: userId ? Number(userId) : null, scoped: !canSeeAll },
    overview: {
      total_calls: overview.total_calls || 0,
      connected_calls: overview.connected_calls || 0,
      unconnected_calls: overview.unconnected_calls || 0,
      outbound: overview.outbound || 0,
      inbound: overview.inbound || 0,
      total_talk_time: hhmmss(overview.total_seconds),
      total_seconds: overview.total_seconds || 0,
      avg_call_duration: hhmmss(overview.avg_seconds),
      avg_connected_duration: hhmmss(connectedAvg),
      avg_form_time: hhmmss(overview.avg_form_seconds),
      connect_rate: Math.round(connectRate * 10) / 10,
    },
    follow_ups: {
      due_today: dueToday,
      overdue,
      leads_called_today: doneToday,
      compliance_percent: compliance === null ? null : Math.round(compliance * 10) / 10,
    },
    dispositions: dispositions.map((d) => ({
      ...d,
      total_talk_time: hhmmss(d.total_seconds),
      percent: overview.total_calls ? Math.round((d.count / overview.total_calls) * 1000) / 10 : 0,
    })),
    by_agent: byAgent.map((a) => ({
      ...a,
      total_talk_time: hhmmss(a.total_seconds),
      connect_rate: a.total_calls ? Math.round((a.connected_calls / a.total_calls) * 1000) / 10 : 0,
    })),
    by_day: byDay.map((d) => ({ ...d, total_talk_time: hhmmss(d.total_seconds) })),
  });
});

module.exports = router;
