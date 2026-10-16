// ============================================================================
// Phase 54 — v1.8.0: more than one email address on a record
// ============================================================================
// Like SuiteCRM: a record has its main (primary) address in its own `email`
// column — everything that already reads that column keeps working — and any
// number of EXTRA addresses here, each of which can be marked "opted out" (do
// not send mail to it) or "invalid" (it bounces).
// One table for every module (leads, contacts, accounts, custom modules…).
// ============================================================================
const db = require('./db-metadata');

db.exec(`
CREATE TABLE IF NOT EXISTS record_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  email_lower TEXT NOT NULL,
  opted_out INTEGER DEFAULT 0,
  invalid_email INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_record_emails_record ON record_emails(module, record_id);
CREATE INDEX IF NOT EXISTS idx_record_emails_addr ON record_emails(email_lower);
`);
