// /api/record-emails/:module/:id — the extra email addresses of one record.
const express = require('express');
const recordEmails = require('../services/recordEmails');

const router = express.Router();
const can = (req, module, action) => {
  const p = req.user && req.user.permissions && req.user.permissions[module];
  return !!(req.user && p && p[action]);
};
const okModule = (m) => /^[a-z][a-z0-9_]{0,60}$/.test(String(m));

router.get('/:module/:id', (req, res) => {
  const { module, id } = req.params;
  if (!okModule(module)) return res.status(400).json({ error: 'Unknown module.' });
  if (!can(req, module, 'view') && !can(req, module, 'edit')) return res.status(403).json({ error: `You don't have access to ${module}` });
  res.json(recordEmails.list(module, id));
});

// Lists: the extra addresses of up to 500 records at once ("?ids=1,2,3")
router.get('/:module', (req, res) => {
  const { module } = req.params;
  if (!okModule(module)) return res.status(400).json({ error: 'Unknown module.' });
  if (!can(req, module, 'view') && !can(req, module, 'edit')) return res.status(403).json({ error: `You don't have access to ${module}` });
  res.json(recordEmails.listMany(module, String(req.query.ids || '').split(',')));
});

router.put('/:module/:id', (req, res) => {
  const { module, id } = req.params;
  if (!okModule(module)) return res.status(400).json({ error: 'Unknown module.' });
  if (!can(req, module, 'edit')) return res.status(403).json({ error: `You don't have edit access to ${module}` });
  try {
    const clean = recordEmails.validate(req.body && req.body.emails, req.body && req.body.primary);
    res.json(recordEmails.replace(module, id, clean, req.user.id));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
