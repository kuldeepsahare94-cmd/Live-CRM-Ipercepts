// ============================================================================
// Files from and for the app (v1.4): a record's files (Documents) and the
// files of a chat.
//
//   The app sends a file inside the request (base64), like its photos and
//   recordings, and it is kept where the web keeps its uploads (DATA_DIR).
//
//   To OPEN a file the app needs a link that works without the sign-in header
//   (the phone opens it in its viewer). So a file comes with a signed link:
//     /api/m-file/doc/12?e=<until>&t=<signature>      (good for about a week)
//   The signature is made with the server's own secret: it cannot be guessed,
//   and it is only handed to someone who was allowed to see the file.
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { UPLOAD_DIR } = require('../../dataDir');

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'video/mp4',
]);
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/webm': '.webm', 'video/mp4': '.mp4' };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const secret = () => `${require('../../middleware/auth').JWT_SECRET}:m-file`;
const sign = (kind, id, exp) => crypto.createHmac('sha256', secret()).update(`${kind}:${id}:${exp}`).digest('base64url').slice(0, 32);
/** a link to open a file without signing in; the same for a whole day, so the phone can keep it */
function signedUrl(kind, id) {
  const exp = (Math.floor(Date.now() / 86400000) + 8) * 86400;
  return `/api/m-file/${kind}/${Number(id)}?e=${exp}&t=${sign(kind, Number(id), exp)}`;
}

/** { data (base64 or a data: URL), mime, file_name } → the file on disk */
function saveUpload(file, { allowed = ALLOWED } = {}) {
  if (!file || typeof file !== 'object' || typeof file.data !== 'string') throw bad('The file was not received.');
  let data = file.data;
  let mime = String(file.mime || '').toLowerCase().split(';')[0].trim();
  const m = /^data:([^;,]+)?(;base64)?,/.exec(data);
  if (m) { mime = mime || String(m[1] || '').toLowerCase(); data = data.slice(m[0].length); }
  if (!allowed.has(mime)) throw bad(`Files of this kind cannot be added here (${mime || 'unknown'}). Photos, PDF, Word, Excel and text files can.`);
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw bad('The file is empty.');
  if (buf.length > MAX_BYTES) throw bad('A file can be 15 MB at most.');
  const name = String(file.file_name || 'file').replace(/[\\/\u0000]/g, '_').trim().slice(0, 150) || 'file';
  const ext = (path.extname(name).slice(0, 12).replace(/[^.\w]/g, '') || EXT[mime] || '');
  const stored = `m-${crypto.randomBytes(16).toString('hex')}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  return { stored_name: stored, mime_type: mime, size_bytes: buf.length, file_name: name };
}
const remove = (stored) => { try { fs.unlinkSync(path.join(UPLOAD_DIR, stored)); } catch { /* gone */ } };

/** Add a file to a record (Documents) from the app. */
function addToRecord(user, b = {}) {
  const access = require('../recordAccess');
  const can = (m, a) => access.isSuper(user) || !!(user.permissions && user.permissions[m] && user.permissions[m][a]);
  const module = String(b.module || '');
  const recId = Number(b.record_id) || 0;
  if (!/^[a-z][a-z0-9_]*$/.test(module) || !recId) throw bad('Which record is the file for?');
  if (!can('documents', 'create')) throw bad('Your role cannot add files.', 403);
  if (!access.parentVisible(user, module, recId)) throw bad(access.denial(user, module).error || 'This record belongs to someone else.', 403);
  const saved = saveUpload(b.file);
  const title = String(b.title || '').trim().slice(0, 200) || saved.file_name;
  let info;
  try {
    info = db.prepare(`INSERT INTO documents (title, file_name, stored_name, mime_type, size_bytes, external_url, related_module, related_record_id, description, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(title, saved.file_name, saved.stored_name, saved.mime_type, saved.size_bytes, null, module, recId, b.description ? String(b.description).slice(0, 1000) : null, user.id);
  } catch (e) { remove(saved.stored_name); throw e; }
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
  try { require('../workflowAutomation').fireWorkflows('documents', 'record_created', row, null, user.id); } catch { /* ignore */ }
  return { id: Number(row.id), title: row.title, file_name: row.file_name, mime_type: row.mime_type, size_bytes: Number(row.size_bytes) || 0, at: row.created_at, url: signedUrl('doc', row.id) };
}

/** GET /api/m-file/:kind/:id?e=&t= — no sign-in: the signed link is the permission */
function serve(req, res) {
  const kind = req.params.kind;
  const id = Number(req.params.id) || 0;
  const exp = Number(req.query.e) || 0;
  const t = String(req.query.t || '');
  const good = sign(kind, id, exp);
  if (!['doc', 'chat'].includes(kind) || !id || t.length !== good.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good))) {
    return res.status(403).json({ error: 'This link is not valid. Open the file again from the app.' });
  }
  if (exp * 1000 < Date.now()) return res.status(403).json({ error: 'This link has expired. Open the file again from the app.' });
  const row = kind === 'doc'
    ? db.prepare('SELECT file_name, stored_name, mime_type, external_url FROM documents WHERE id = ?').get(id)
    : db.prepare('SELECT file_name, stored_name, mime_type FROM chat_attachments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'The file is no longer in the CRM.' });
  if (!row.stored_name && row.external_url) return res.redirect(row.external_url);
  const full = path.resolve(UPLOAD_DIR, String(row.stored_name || ''));
  if (!row.stored_name || !full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return res.status(400).json({ error: 'The file could not be found.' });
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'The file is no longer on the server.' });
  const mime = row.mime_type || 'application/octet-stream';
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|audio\/|video\/|text\/plain)/.test(mime);
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${String(row.file_name || 'file').replace(/[^\w.\- ()]/g, '_')}"`);
  return fs.createReadStream(full).pipe(res);
}

module.exports = { signedUrl, saveUpload, addToRecord, serve, remove, ALLOWED, MAX_BYTES };
