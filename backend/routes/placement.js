// ============================================================================
// Placement desk (recruitment consultancy) — everything under /api/placement
// ============================================================================
//   GET  /meta                          what the screens need to start (also: is it on for me)
//   GET|PUT /settings                   the switch and the defaults (administrators)
//   POST /demo/load | /demo/clear       demo data (administrators)
//   GET  /people                        the users, for pickers
//   GET  /dashboard                     the figures of the home page
//
//   GET  /clients  /clients/accounts  /clients/:id      POST /clients      PUT /clients/:id
//   GET  /jobs  /jobs/:id  /jobs/:id/board  /jobs/:id/suggest
//   POST /jobs      PUT /jobs/:id     POST /jobs/:id/status    DELETE /jobs/:id
//   GET  /candidates  /candidates/check  /candidates/follow-ups  /candidates/:id
//   POST /candidates   PUT /candidates/:id   DELETE /candidates/:id
//   POST /candidates/:id/contact       POST /contacts/:id/done
//   GET  /pipeline  /pipeline/:id      POST /pipeline   POST /pipeline/:id/move   DELETE /pipeline/:id
//   GET  /interviews                   POST /pipeline/:id/interviews   PUT|DELETE /interviews/:id
//   GET  /offers                       PUT /offers/:id   POST /offers/:id/invoice
//   GET  /deployed  /deployed/:id      POST /deployed   PUT /deployed/:id   POST /deployed/:id/renew   DELETE
//   GET  /timesheets?month=YYYY-MM     POST /timesheets   POST /timesheets/:id/approve   POST /timesheets/invoice
//   GET  /invoices                     GET /files/:id
// ============================================================================

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/auth');
const access = require('../services/recordAccess');
const S = require('../services/placement/store');
const jobs = require('../services/placement/jobs');
const cands = require('../services/placement/candidates');
const pipe = require('../services/placement/pipeline');
const contract = require('../services/placement/contract');
const dash = require('../services/placement/dashboard');

const router = express.Router();
const { bad } = S;

function fail(res, e) {
  const status = Number(e && e.status) || 500;
  if (status >= 500) console.error('[placement]', e && e.stack ? e.stack : e);
  const out = { error: status >= 500 ? 'Something went wrong while saving. Please try again.' : e.message };
  if (e && e.duplicates) out.duplicates = e.duplicates;
  if (e && e.pipeline_id) out.pipeline_id = e.pipeline_id;
  if (e && e.invoice_id) out.invoice_id = e.invoice_id;
  res.status(status).json(out);
}
const run = (fn, status = 200) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.status(status).json(out);
  } catch (e) { fail(res, e); }
};
const isAdmin = (user) => access.isSuper(user) || !!(user && user.permissions && user.permissions.settings && user.permissions.settings.edit);
const view = requirePermission('placement', 'view');
const create = requirePermission('placement', 'create');
const edit = requirePermission('placement', 'edit');
const del = requirePermission('placement', 'delete');
// Offered to people once an administrator has switched it on (Settings → Placement); until then to administrators only.
function on(req, res, next) {
  if (S.isEnabled() || isAdmin(req.user)) return next();
  return res.status(403).json({ error: 'The Placement desk is not switched on. Ask your administrator.', off: true });
}
const adminOnly = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Only an administrator can change this.' }));
const notFound = () => bad('Not found.', 404);
const id = (req, name = 'id') => { const v = S.idOf(req.params[name]); if (!v) throw bad('Not found.', 404); return v; };

// ---------------------------------------------------------------- start
router.get('/meta', run((req) => {
  const perm = req.user.permissions && req.user.permissions.placement;
  const enabled = S.isEnabled();
  const admin = isAdmin(req.user);
  const available = !!(perm && perm.view) && (enabled || admin);
  const out = { available, enabled, is_admin: admin, admin_only: !enabled && admin, can: perm ? { create: !!perm.create, edit: !!perm.edit, delete: !!perm.delete, export: !!perm.export } : {} };
  if (!available) return out;
  return {
    ...out,
    stages: S.STAGES, side_stages: S.SIDE_STAGES, reject_reasons: S.REJECT_REASONS, sources: S.SOURCES, candidate_status: S.CAND_STATUS,
    job_status: S.JOB_STATUS, hiring_types: S.HIRING, rounds: S.ROUNDS, interview_modes: S.IV_MODES, interview_results: S.IV_RESULTS,
    offer_status: S.OFFER_STATUS, contact_outcomes: S.CONTACT_OUTCOMES, notice_periods: S.NOTICE,
    settings: S.getSettings(), me: { id: req.user.id, name: req.user.full_name || req.user.username }, today: S.today(),
  };
}));

router.get('/settings', adminOnly, run(() => ({
  ...S.getSettings(),
  counts: {
    jobs: Number(db.prepare('SELECT COUNT(*) c FROM pl_jobs').get().c), candidates: Number(db.prepare('SELECT COUNT(*) c FROM pl_candidates').get().c),
    demo: Number(db.prepare('SELECT COUNT(*) c FROM pl_candidates WHERE is_demo = 1').get().c),
  },
})));
router.put('/settings', adminOnly, run((req) => {
  const b = req.body || {};
  const checks = { fee_percent: [0, 100], guarantee_days: [0, 730], gst_percent: [0, 40], working_days: [1, 31], cold_days: [1, 120] };
  if (b.enabled !== undefined) {
    if (![true, false, 1, 0, '1', '0', 'true', 'false'].includes(b.enabled)) throw bad('The switch must be on or off.');
    S.setSetting('enabled', b.enabled === true || b.enabled === 1 || b.enabled === '1' || b.enabled === 'true');
  }
  for (const [k, [lo, hi]] of Object.entries(checks)) {
    if (b[k] === undefined) continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw bad(`${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}.`);
    S.setSetting(k, v);
  }
  return S.getSettings();
}));
router.post('/demo/load', adminOnly, run((req) => require('../services/placement/seed').load(req.user), 201));
router.post('/demo/clear', adminOnly, run(() => require('../services/placement/seed').clear()));

// everything below needs the module to be on, and the permission
router.use(on);

router.get('/people', view, run(() => db.prepare("SELECT id, COALESCE(full_name, username) AS name FROM users WHERE active = 1 ORDER BY 2").all()));
router.get('/dashboard', view, run((req) => dash.summary(req.user)));

// ---------------------------------------------------------------- clients
router.get('/clients', view, run((req) => jobs.listClients(req.query)));
router.get('/clients/accounts', view, run((req) => jobs.otherAccounts(req.query.q)));
router.get('/clients/:id', view, run((req) => jobs.getClient(id(req)) || (() => { throw notFound(); })()));
router.post('/clients', create, run((req) => ({ id: jobs.saveClient(req.body, req.user.id, null) }), 201));
router.put('/clients/:id', edit, run((req) => ({ id: jobs.saveClient(req.body, req.user.id, id(req)) })));

// ---------------------------------------------------------------- jobs
router.get('/jobs', view, run((req) => jobs.listJobs(req.query, req.user)));
router.get('/jobs/:id', view, run((req) => jobs.getJob(id(req), req.user) || (() => { throw notFound(); })()));
router.get('/jobs/:id/board', view, run((req) => {
  const j = jobs.getJob(id(req), req.user);
  if (!j) throw notFound();
  return { job: j, ...pipe.board(j.id, req.user) };
}));
router.get('/jobs/:id/suggest', view, run((req) => {
  if (!jobs.getJob(id(req), req.user)) throw notFound();
  return cands.suggest(id(req), req.user);
}));
router.post('/jobs', create, run((req) => ({ id: jobs.createJob(req.body, req.user) }), 201));
router.put('/jobs/:id', edit, run((req) => {
  if (!jobs.getJob(id(req), req.user)) throw notFound();
  return { id: jobs.updateJob(id(req), req.body, req.user) };
}));
router.post('/jobs/:id/status', edit, run((req) => {
  if (!jobs.getJob(id(req), req.user)) throw notFound();
  jobs.setStatus(id(req), req.body && req.body.status);
  return { id: id(req) };
}));
router.delete('/jobs/:id', del, run((req) => {
  if (!jobs.getJob(id(req), req.user)) throw notFound();
  jobs.deleteJob(id(req));
  return { ok: true };
}));

// ---------------------------------------------------------------- candidates
router.get('/candidates', view, run((req) => cands.list(req.query, req.user)));
router.get('/candidates/check', view, run((req) => ({ duplicates: cands.findDuplicates(req.query.mobile, req.query.email, S.idOf(req.query.except)) })));
router.get('/candidates/follow-ups', view, run((req) => cands.followUps(req.user, { upto: req.query.upto, mine: req.query.mine === '1' })));
router.get('/candidates/facets', view, run((req) => cands.facets(req.user)));
router.get('/candidates/:id', view, run((req) => cands.get(id(req), req.user) || (() => { throw notFound(); })()));
// (the phone adds a person and puts him on an opening in one go: job_id is optional)
router.post('/candidates', create, run((req) => {
  const jobId = S.idOf(req.body && req.body.job_id);
  if (jobId) {
    const job = db.prepare('SELECT id, status FROM pl_jobs WHERE id = ?').get(jobId);
    if (!job) throw bad('That opening no longer exists.', 404);
    if (job.status !== 'Open') throw bad(`This opening is ${String(job.status).toLowerCase()}. Choose another or none.`);
  }
  return db.transaction(() => {
    const newId = cands.create(req.body, req.user);
    const out = { id: newId };
    if (jobId) out.pipeline_id = pipe.addToJob(jobId, newId, req.user);
    return out;
  })();
}, 201));
router.put('/candidates/:id', edit, run((req) => {
  if (!cands.get(id(req), req.user)) throw notFound();
  return { id: cands.update(id(req), req.body, req.user) };
}));
router.delete('/candidates/:id', del, run((req) => {
  if (!cands.get(id(req), req.user)) throw notFound();
  cands.remove(id(req));
  return { ok: true };
}));
router.post('/candidates/:id/contact', edit, run((req) => {
  if (!cands.get(id(req), req.user)) throw notFound();
  return { id: cands.logContact(id(req), req.body, req.user) };
}, 201));
router.post('/contacts/:id/done', edit, run((req) => { cands.markFollowUpDone(id(req)); return { ok: true }; }));

// ---------------------------------------------------------------- pipeline
router.get('/pipeline', view, run((req) => pipe.list(req.query, req.user)));
router.get('/pipeline/:id', view, run((req) => pipe.get(id(req), req.user) || (() => { throw notFound(); })()));
router.post('/pipeline', edit, run((req) => {
  const b = req.body || {};
  const jid = S.idOf(b.job_id); const cid = S.idOf(b.candidate_id);
  if (!jid || !cid) throw bad('Choose the opening and the candidate.');
  if (!jobs.getJob(jid, req.user)) throw notFound();
  return { id: pipe.addToJob(jid, cid, req.user, b.stage) };
}, 201));
router.post('/pipeline/:id/move', edit, run((req) => {
  if (!pipe.get(id(req), req.user)) throw notFound();
  return pipe.move(id(req), req.body, req.user);
}));
router.delete('/pipeline/:id', del, run((req) => {
  if (!pipe.get(id(req), req.user)) throw notFound();
  pipe.removeFromJob(id(req));
  return { ok: true };
}));

// ---------------------------------------------------------------- interviews
router.get('/interviews', view, run((req) => pipe.listInterviews(req.query, req.user)));
router.post('/pipeline/:id/interviews', edit, run((req) => {
  if (!pipe.get(id(req), req.user)) throw notFound();
  const iid = pipe.scheduleInterview(id(req), req.body, req.user);
  return pipe.getInterview(iid);
}, 201));
router.put('/interviews/:iid', edit, run((req) => {
  const iid = id(req, 'iid');
  const cur = pipe.getInterview(iid);
  if (!cur || !pipe.get(cur.pipeline_id, req.user)) throw notFound();
  pipe.updateInterview(iid, req.body, req.user);
  return pipe.getInterview(iid);
}));
router.delete('/interviews/:iid', del, run((req) => {
  const iid = id(req, 'iid');
  const cur = pipe.getInterview(iid);
  if (!cur || !pipe.get(cur.pipeline_id, req.user)) throw notFound();
  pipe.removeInterview(iid);
  return { ok: true };
}));

// ---------------------------------------------------------------- offers and billing
router.get('/offers', view, run((req) => pipe.listOffers(req.query, req.user)));
router.put('/offers/:id', edit, run((req) => {
  const o = pipe.listOffers({}, req.user).find((x) => x.id === id(req));
  if (!o) throw notFound();
  pipe.updateOffer(id(req), req.body, req.user);
  return pipe.listOffers({}, req.user).find((x) => x.id === id(req));
}));
router.post('/offers/:id/invoice', create, run((req) => {
  if (!pipe.listOffers({}, req.user).find((x) => x.id === id(req))) throw notFound();
  return pipe.createInvoice(id(req), req.user);
}, 201));
router.get('/invoices', view, run((req) => dash.invoices(req.query, req.user)));

// ---------------------------------------------------------------- contract staffing
router.get('/deployed', view, run((req) => contract.list(req.query, req.user)));
router.get('/deployed/:id', view, run((req) => contract.get(id(req), req.user) || (() => { throw notFound(); })()));
router.post('/deployed', create, run((req) => ({ id: contract.create(req.body, req.user) }), 201));
router.put('/deployed/:id', edit, run((req) => {
  if (!contract.get(id(req), req.user)) throw notFound();
  return { id: contract.update(id(req), req.body) };
}));
router.post('/deployed/:id/renew', edit, run((req) => {
  if (!contract.get(id(req), req.user)) throw notFound();
  return { id: contract.renew(id(req), req.body) };
}));
router.delete('/deployed/:id', del, run((req) => {
  if (!contract.get(id(req), req.user)) throw notFound();
  contract.remove(id(req));
  return { ok: true };
}));
router.get('/timesheets', view, run((req) => contract.month(req.query.month || S.today().slice(0, 7), req.query, req.user)));
router.post('/timesheets', edit, run((req) => ({ id: contract.saveSheet(req.body, req.user) }), 201));
router.post('/timesheets/invoice', create, run((req) => contract.invoiceMonth(req.body, req.user), 201));
router.post('/timesheets/:id/approve', edit, run((req) => ({ id: contract.approve(id(req), req.user) })));

// ---------------------------------------------------------------- files (a resume, a job description)
router.get('/files/:id', view, (req, res) => {
  try {
    const fid = id(req);
    const f = jobs.getFile(fid);
    if (!f) throw notFound();
    const okCand = db.prepare(`SELECT c.id FROM pl_candidates c WHERE c.resume_file_id = ? AND ${S.candScope(req.user, 'c')}`).get(fid);
    const okJob = !okCand && db.prepare(`SELECT j.id FROM pl_jobs j WHERE j.jd_file_id = ? AND ${S.jobScope(req.user, 'j')}`).get(fid);
    if (!okCand && !okJob) throw notFound();
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${String(f.file_name || 'file').replace(/[^\w.\-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(f.data_b64 || '', 'base64'));
  } catch (e) { fail(res, e); }
});

module.exports = router;
