// ============================================================================
// Extra email addresses ride along with the record's own save.
// ============================================================================
// A create / edit form sends the record plus `_extra_emails: [{ email,
// opted_out, invalid }]`. This middleware takes that list off the body (so the
// record's own route never sees it), checks it before the record is saved, and
// keeps it once the record's own save has succeeded. One place, so every module
// (leads, contacts, accounts, custom modules…) works the same, and the phone app
// uses the very same routes.
// ============================================================================
const recordEmails = require('../services/recordEmails');

function where(originalUrl) {
  const parts = String(originalUrl).split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'api') return null;
  if (parts[1] === 'records') return parts.length <= 4 ? { module: parts[2], id: Number(parts[3]) || null } : null;
  if (parts.length > 3) return null;
  if (parts.length === 3 && !/^\d+$/.test(parts[2])) return null;
  return { module: parts[1], id: Number(parts[2]) || null };
}

function extraEmails(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT') return next();
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('_extra_emails' in body)) return next();
  const target = where(req.originalUrl);
  const raw = body._extra_emails;
  // (kept for the duplicate check, but out of sight of everything that copies or stores the body)
  delete body._extra_emails;
  if (Array.isArray(raw)) Object.defineProperty(body, '_extra_emails', { value: raw, enumerable: false, configurable: true });
  if (!target || !target.module || raw === null || raw === undefined) return next();
  let clean;
  try { clean = recordEmails.validate(raw, body.email); } catch (e) { return res.status(400).json({ error: e.message }); }
  const json = res.json.bind(res);
  res.json = (payload) => {
    try {
      if (res.statusCode < 300) {
        const id = target.id || (payload && Number(payload.id)) || (payload && payload.record && Number(payload.record.id)) || null;
        if (id) (target.id ? recordEmails.replace : recordEmails.merge)(target.module, id, clean, req.user && req.user.id);
      }
    } catch (e) { console.warn('[record-emails] could not keep the extra addresses:', e.message); }
    return json(payload);
  };
  return next();
}

module.exports = { extraEmails };
