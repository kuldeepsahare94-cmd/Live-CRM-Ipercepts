// ============================================================================
// Phase 52 — Placement desk (recruitment consultancy)
// ============================================================================
// Everything here starts with pl_ and is used only by routes/placement.js and
// services/placement/*. Nothing else in the CRM reads these tables, so the
// whole section can be lifted out into its own instance later: take this file,
// services/placement, routes/placement.js and frontend/src/pages/placement.
//
// It reuses the CRM's own Accounts (the client company), Users (recruiters),
// Meetings (interview invites) and Sales documents (the placement invoice).
//
//   pl_settings        one row per name: the switch and the defaults
//   pl_client_terms    the recruitment terms of an Account (fee %, guarantee ...)
//   pl_jobs            a job opening (permanent or contract)
//   pl_job_recruiters  who works on it
//   pl_candidates      the people we place
//   pl_pipeline        a candidate on a job, with the stage
//   pl_stage_log       every move: who, when, why
//   pl_interviews      rounds, with the result and the feedback
//   pl_offers          the offer, the joining and the replacement guarantee
//   pl_deployed        a contract resource sitting at a client
//   pl_timesheets      the month of a deployed resource: days, bill, payout, margin
//   pl_contacts        a call / message to a candidate, with the follow-up date
//   pl_files           resumes and job descriptions (kept in the database, so
//                      they survive a restart on hosting without a disk)
// ============================================================================

const db = require('./db-metadata');

db.exec(`
CREATE TABLE IF NOT EXISTS pl_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pl_client_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  agreement_type TEXT DEFAULT 'Permanent',      -- Permanent / Contract / Both
  fee_percent REAL DEFAULT 8.33,                -- of the annual CTC
  payment_terms TEXT DEFAULT 'Net 30',
  guarantee_days INTEGER DEFAULT 90,            -- replacement guarantee
  spoc_name TEXT,
  spoc_phone TEXT,
  spoc_email TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pl_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- resume / jd
  file_name TEXT,
  mime TEXT,
  size INTEGER DEFAULT 0,
  data_b64 TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pl_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                    -- JOB-2026-0043
  title TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  hiring_type TEXT DEFAULT 'Permanent',         -- Permanent / Contract
  positions INTEGER DEFAULT 1,
  skills TEXT,
  exp_min REAL,
  exp_max REAL,
  ctc_min REAL,                                 -- lakh per year (permanent)
  ctc_max REAL,
  bill_rate REAL,                               -- rupees per month (contract)
  location TEXT,
  priority TEXT DEFAULT 'Normal',               -- Hot / Normal
  status TEXT DEFAULT 'Open',                   -- Open / On hold / Filled / Closed / Lost
  fee_percent REAL,
  target_date TEXT,
  opened_on TEXT,
  closed_on TEXT,
  jd_text TEXT,
  jd_file_id INTEGER,
  owner_id INTEGER,
  is_demo INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pl_jobs_status ON pl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pl_jobs_account ON pl_jobs(account_id);

CREATE TABLE IF NOT EXISTS pl_job_recruiters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  UNIQUE (job_id, user_id),
  FOREIGN KEY (job_id) REFERENCES pl_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pl_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                    -- CAN-1042
  name TEXT NOT NULL,
  mobile TEXT,
  mobile_key TEXT,                              -- last 10 digits, for the duplicate check
  email TEXT,
  email_key TEXT,
  city TEXT,
  current_company TEXT,
  designation TEXT,
  total_exp REAL,
  relevant_exp REAL,
  current_ctc REAL,                             -- lakh per year
  expected_ctc REAL,
  notice_period TEXT,
  skills TEXT,
  source TEXT,                                  -- Naukri / LinkedIn / Referral / Walk-in / Database
  status TEXT DEFAULT 'New',                    -- New / Screened / Active / Placed / Do not call / Blacklisted
  owner_id INTEGER,
  last_contacted TEXT,
  resume_file_id INTEGER,
  notes TEXT,
  is_demo INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pl_cand_mobile ON pl_candidates(mobile_key);
CREATE INDEX IF NOT EXISTS idx_pl_cand_email ON pl_candidates(email_key);
CREATE INDEX IF NOT EXISTS idx_pl_cand_status ON pl_candidates(status);
CREATE INDEX IF NOT EXISTS idx_pl_cand_owner ON pl_candidates(owner_id);

CREATE TABLE IF NOT EXISTS pl_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  stage TEXT DEFAULT 'Sourced',
  prev_stage TEXT,                              -- where it was before On hold / Rejected
  reject_reason TEXT,
  stage_changed_at TEXT DEFAULT (datetime('now')),
  owner_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (job_id, candidate_id),
  FOREIGN KEY (job_id) REFERENCES pl_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES pl_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pl_pipe_stage ON pl_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_pl_pipe_cand ON pl_pipeline(candidate_id);

CREATE TABLE IF NOT EXISTS pl_stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  remark TEXT,
  reason TEXT,
  by_user INTEGER,
  at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pipeline_id) REFERENCES pl_pipeline(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pl_log_pipe ON pl_stage_log(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pl_log_at ON pl_stage_log(at);

CREATE TABLE IF NOT EXISTS pl_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL,
  round TEXT DEFAULT 'L1',                      -- L1 / L2 / Final / HR
  scheduled_at TEXT,                            -- 2026-10-16 15:30
  duration_min INTEGER DEFAULT 45,
  mode TEXT DEFAULT 'Video',                    -- Video / Phone / In person
  panel TEXT,
  link_or_place TEXT,
  result TEXT DEFAULT 'Scheduled',              -- Scheduled / Cleared / Rejected / No show / On hold / Cancelled
  feedback TEXT,
  meeting_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pipeline_id) REFERENCES pl_pipeline(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pl_iv_when ON pl_interviews(scheduled_at);

CREATE TABLE IF NOT EXISTS pl_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL UNIQUE,
  offered_ctc REAL,                             -- lakh per year
  offer_date TEXT,
  expected_joining TEXT,
  actual_joining TEXT,
  status TEXT DEFAULT 'Offered',                -- Offered / Accepted / Declined / Joined / Dropped
  decline_reason TEXT,
  fee_percent REAL,
  fee_amount REAL,
  guarantee_days INTEGER,
  guarantee_end TEXT,
  invoice_id INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pipeline_id) REFERENCES pl_pipeline(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pl_deployed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  job_id INTEGER,
  candidate_id INTEGER,
  person_name TEXT NOT NULL,
  role_title TEXT,
  bill_rate REAL DEFAULT 0,                     -- rupees per month, charged to the client
  pay_rate REAL DEFAULT 0,                      -- rupees per month, paid to the resource
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'Active',                 -- Active / Ended
  owner_id INTEGER,
  notes TEXT,
  is_demo INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pl_timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployed_id INTEGER NOT NULL,
  month TEXT NOT NULL,                          -- 2026-09
  working_days REAL DEFAULT 26,
  approved_days REAL DEFAULT 0,
  billable REAL DEFAULT 0,
  payout REAL DEFAULT 0,
  margin REAL DEFAULT 0,
  status TEXT DEFAULT 'Draft',                  -- Draft / Approved / Invoiced
  invoice_id INTEGER,
  approved_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (deployed_id, month),
  FOREIGN KEY (deployed_id) REFERENCES pl_deployed(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pl_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  channel TEXT DEFAULT 'Call',                  -- Call / WhatsApp / Email / Meeting
  outcome TEXT,                                 -- Interested / Not interested / Call back / Not reachable / Wrong number / Switched off
  remark TEXT,
  next_follow_up TEXT,                          -- a day, or a day and time
  follow_up_done INTEGER DEFAULT 0,
  by_user INTEGER,
  at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (candidate_id) REFERENCES pl_candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pl_contacts_cand ON pl_contacts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_pl_contacts_fu ON pl_contacts(next_follow_up);
`);

// A contact sent from the phone twice (a retry after a bad network) is saved once: the app
// gives each one a reference.
if (!db.prepare('PRAGMA table_info(pl_contacts)').all().some((c) => c.name === 'client_ref')) {
  db.exec('ALTER TABLE pl_contacts ADD COLUMN client_ref TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pl_contacts_ref ON pl_contacts(client_ref)');

// The switch: off until an administrator turns it on in Settings → Placement
// (or the server is started with PLACEMENT_ENABLED=1, for a customer that is
// only recruitment).
if (!db.prepare("SELECT id FROM pl_settings WHERE name = 'enabled'").get()) {
  const on = /^(1|true|yes)$/i.test(String(process.env.PLACEMENT_ENABLED || ''));
  db.prepare("INSERT INTO pl_settings (name, value) VALUES ('enabled', ?)").run(on ? '1' : '0');
}

// Permission rows: administrators get everything, every other role starts with
// "can see" only. An administrator raises it on the Roles page.
(function backfillPlacementPermissions() {
  const roles = db.prepare('SELECT id, name FROM roles').all();
  if (!roles.length) return;
  const have = new Set(db.prepare("SELECT role_id FROM role_permissions WHERE module = 'placement'").all().map((r) => r.role_id));
  const ins = db.prepare(`INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (?, 'placement', ?, ?, ?, ?, ?)`);
  for (const r of roles) {
    if (have.has(r.id)) continue;
    const full = r.name === 'Super Admin' || r.name === 'Admin' ? 1 : 0;
    ins.run(r.id, 1, full, full, full, full);
  }
}());

module.exports = db;
