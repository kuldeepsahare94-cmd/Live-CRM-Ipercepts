// ============================================================================
// Team chat in the app (v1.4) — the same chats as the web (Team Chat), with
// what a phone needs on top: files sent inside the request, and links to open
// the files without the sign-in header.
//
//   GET  /api/sfa/m/chat/conversations
//   GET  /api/sfa/m/chat/:id/messages?before=
//   POST /api/sfa/m/chat/:id/send       { body, reply_to_id, files: [{ data, mime, file_name }] }
//   POST /api/sfa/m/chat/poll           { since, conversation_id }
//   GET  /api/sfa/m/chat/unread
//   POST /api/sfa/m/chat/broadcast      { user_ids, body, files }
// Starting a chat, a group, reading and muting use the web's own links (/api/chat/...).
// ============================================================================
const chat = require('../chatService');
const access = require('../recordAccess');
const files = require('./mfiles');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const can = (user, action) => access.isSuper(user) || !!(user.permissions && user.permissions.chat && user.permissions.chat[action]);
function need(user, action = 'view') { if (!can(user, action)) throw bad(action === 'view' ? 'Your role cannot use the chat.' : 'Your role cannot send chat messages.', 403); }

const CHAT_ALLOWED = new Set([...files.ALLOWED].filter((m) => !/^video\//.test(m)));
const withLinks = (m) => (m ? { ...m, attachments: (m.attachments || []).map((a) => ({ ...a, url: files.signedUrl('chat', a.id) })) } : m);

function conversations(user) { need(user); return { conversations: chat.listConversations(Number(user.id)) }; }
function messages(user, id, q = {}) {
  need(user);
  const before = Number(q.before) || null;
  return { messages: chat.messagesFor(Number(id), Number(user.id), { before, limit: Math.min(Number(q.limit) || 40, 100) }).map(withLinks), conversation: chat.getConversation(Number(id), Number(user.id)) };
}
function saveAll(list) {
  const out = [];
  try {
    for (const f of (Array.isArray(list) ? list : []).slice(0, 5)) {
      const s = files.saveUpload(f, { allowed: CHAT_ALLOWED });
      out.push({ file_name: s.file_name, stored_name: s.stored_name, mime_type: s.mime_type, size_bytes: s.size_bytes });
    }
  } catch (e) { out.forEach((x) => files.remove(x.stored_name)); throw e; }
  return out;
}
function send(user, id, b = {}) {
  need(user, 'create');
  const attachments = saveAll(b.files);
  try {
    const ref = b.ref && b.ref.module ? { module: String(b.ref.module), record_id: Number(b.ref.record_id) || null, label: String(b.ref.label || '').slice(0, 200) } : null;
    return withLinks(chat.sendMessage(Number(id), Number(user.id), { body: b.body, replyToId: Number(b.reply_to_id) || null, attachments, ref }));
  } catch (e) { attachments.forEach((x) => files.remove(x.stored_name)); throw e; }
}
function poll(user, b = {}) {
  need(user);
  const out = chat.poll(Number(user.id), Number(b.since) || 0, b.conversation_id ? Number(b.conversation_id) : null);
  return { ...out, messages: out.messages.map(withLinks) };
}
function unread(user) {
  if (!can(user, 'view')) return { total: 0 };
  // (one small count, asked often: not the whole conversation list)
  const db = require('../../db');
  const r = db.prepare(`
    SELECT COALESCE(SUM(x.c), 0) AS t FROM (
      SELECT (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = p.conversation_id
              AND m.id > COALESCE(p.last_read_message_id, 0) AND m.sender_id != ? AND m.deleted_at IS NULL) AS c
      FROM chat_participants p WHERE p.user_id = ? AND p.left_at IS NULL AND COALESCE(p.muted, 0) = 0
    ) x`).get(Number(user.id), Number(user.id));
  return { total: Number(r && r.t) || 0 };
}
function broadcast(user, b = {}) {
  need(user, 'create');
  let ids = b.user_ids;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!list.length) throw bad('Choose the people to send it to.');
  // (each person gets their own copy of the files)
  const out = { delivered: 0, conversations: [] };
  for (const uid of [...new Set(list)].filter((x) => x !== Number(user.id))) {
    const convId = chat.openDirect(Number(user.id), uid);
    const attachments = saveAll(b.files);
    try { chat.sendMessage(convId, Number(user.id), { body: b.body, attachments }); } catch (e) { attachments.forEach((x) => files.remove(x.stored_name)); throw e; }
    out.delivered += 1; out.conversations.push(convId);
  }
  return out;
}

module.exports = { conversations, messages, send, poll, unread, broadcast };
