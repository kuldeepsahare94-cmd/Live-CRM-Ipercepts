// ============================================================================
// Phone alerts (v1.4): a notification on the phone even when the iCRM app is
// closed — a chat message, a follow-up that is due, a lead or task given to
// me, a meeting invite, a plan or leave to approve.
// ============================================================================
// HOW
//   Android delivers them through Google's Firebase Cloud Messaging (FCM). The
//   app asks the phone for its "token" and gives it to the CRM (push_devices);
//   the CRM sends each alert to Google with the company's own Firebase key.
//
//   The key is the Firebase project's "service account" file (JSON). It is
//   pasted once on the web (Settings → Field force → Phone alerts), kept
//   ENCRYPTED, and never sent back. Without it nothing is sent and nothing
//   breaks: the app still shows everything when it is opened.
//
//   Every send runs in the background: an alert never slows down or blocks
//   the thing that caused it (a message, a save).
// ============================================================================
const crypto = require('crypto');
const db = require('../../db');

const KINDS = ['chat', 'followup', 'assigned', 'meeting', 'approval'];
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const fcmBase = () => (process.env.FCM_URL || 'https://fcm.googleapis.com').replace(/\/+$/, '');

let ready_ = false;
function ensureSchema() {
  if (ready_) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      platform TEXT DEFAULT 'android',
      app_version TEXT,
      prefs TEXT,
      last_sent_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id);
  `);
  ready_ = true;
}

// --- the Firebase key ------------------------------------------------------------
function store() { return require('../sfa/store'); }
let configCache = null;
function config() {
  if (configCache && Date.now() - configCache.at < 30000) return configCache.value;
  let value = null;
  try {
    const packed = store().readValue('push_fcm');
    if (packed) value = JSON.parse(require('../secrets').decrypt(packed));
  } catch { value = null; }
  configCache = { at: Date.now(), value };
  return value;
}
const ready = () => !!config();

/** what the settings screen may show: never the key itself */
function status() {
  ensureSchema();
  const c = config();
  let devices = 0; let people = 0;
  try {
    const r = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS p FROM push_devices').get();
    devices = Number(r.n) || 0; people = Number(r.p) || 0;
  } catch { /* none yet */ }
  return { ready: !!c, project_id: c ? c.project_id : null, devices, people, encryption_ready: require('../secrets').isAvailable() };
}

/** the service account file (as text or as an object); '-' removes it */
function saveKey(input) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (input === '-' || input === null) { store().writeValue('push_fcm', ''); configCache = null; return status(); }
  let j = input;
  if (typeof j === 'string') { try { j = JSON.parse(j.trim()); } catch { throw bad('Paste the whole Firebase key file (it starts with { and ends with }).'); } }
  if (!j || typeof j !== 'object' || j.type !== 'service_account' || !j.project_id || !j.client_email || !j.private_key) {
    throw bad('That is not a Firebase service account key. In Firebase: Project settings → Service accounts → "Generate new private key".');
  }
  try { crypto.createPrivateKey(j.private_key); } catch { throw bad('The private key in that file could not be read. Download a new key file and paste it again.'); }
  if (!require('../secrets').isAvailable()) throw bad('The CRM cannot keep keys encrypted yet (CRM_ENCRYPTION_KEY is not set on the server).');
  const keep = { project_id: String(j.project_id), client_email: String(j.client_email), private_key: String(j.private_key), token_uri: String(j.token_uri || 'https://oauth2.googleapis.com/token') };
  store().writeValue('push_fcm', require('../secrets').encrypt(JSON.stringify(keep)));
  configCache = null; tokenCache = null;
  return status();
}

// --- Google's access token (an hour long) ------------------------------------------
let tokenCache = null;
const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
async function accessToken() {
  const c = config();
  if (!c) throw new Error('Phone alerts are not set up.');
  if (tokenCache && tokenCache.email === c.client_email && tokenCache.until > Date.now() + 60000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'RS256', typ: 'JWT' });
  const claims = b64u({ iss: c.client_email, scope: SCOPE, aud: c.token_uri, iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(c.private_key).toString('base64url');
  const res = await fetch(c.token_uri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claims}.${sig}`,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google did not accept the Firebase key (${data.error_description || data.error || res.status}).`);
  tokenCache = { email: c.client_email, token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// --- the phones ---------------------------------------------------------------------
const cleanPrefs = (p) => {
  const out = {};
  for (const k of KINDS) out[k] = !(p && p[k] === false);
  return out;
};
function register(user, { token, platform, app_version: version, prefs } = {}) {
  ensureSchema();
  const t = String(token || '').trim();
  if (!/^[\w:.\-]{20,4096}$/.test(t)) throw Object.assign(new Error('That is not a phone alert token.'), { status: 400 });
  const row = db.prepare('SELECT id, prefs FROM push_devices WHERE token = ?').get(t);
  const p = JSON.stringify(cleanPrefs(prefs || (row && row.prefs ? JSON.parse(row.prefs) : null)));
  if (row) {
    // (the same phone, another person signed in: it is theirs now)
    db.prepare("UPDATE push_devices SET user_id = ?, platform = ?, app_version = ?, prefs = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(Number(user.id), String(platform || 'android').slice(0, 20), String(version || '').slice(0, 20), p, row.id);
  } else {
    db.prepare('INSERT INTO push_devices (user_id, token, platform, app_version, prefs) VALUES (?, ?, ?, ?, ?)')
      .run(Number(user.id), t, String(platform || 'android').slice(0, 20), String(version || '').slice(0, 20), p);
  }
  return device(user, t);
}
function device(user, token) {
  ensureSchema();
  const row = db.prepare('SELECT * FROM push_devices WHERE token = ? AND user_id = ?').get(String(token || ''), Number(user.id));
  return { registered: !!row, ready: ready(), prefs: cleanPrefs(row && row.prefs ? JSON.parse(row.prefs) : null) };
}
function setPrefs(user, token, prefs) {
  ensureSchema();
  const row = db.prepare('SELECT id FROM push_devices WHERE token = ? AND user_id = ?').get(String(token || ''), Number(user.id));
  if (!row) throw Object.assign(new Error('This phone is not set up for alerts yet. Open the app again.'), { status: 404 });
  db.prepare("UPDATE push_devices SET prefs = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(cleanPrefs(prefs)), row.id);
  return device(user, token);
}
/** sign out on this phone: no more alerts for that person here */
function unregister(user, token) {
  ensureSchema();
  db.prepare('DELETE FROM push_devices WHERE token = ? AND user_id = ?').run(String(token || ''), Number(user.id));
  return { ok: true };
}
function devicesOf(userIds, kind) {
  ensureSchema();
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  return db.prepare(`SELECT id, user_id, token, prefs FROM push_devices WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    .filter((d) => { try { return cleanPrefs(d.prefs ? JSON.parse(d.prefs) : null)[kind] !== false; } catch { return true; } });
}

// --- sending ----------------------------------------------------------------------
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
async function sendOne(d, msg) {
  const c = config();
  const token = await accessToken();
  const data = { kind: msg.kind, route: msg.route || '/', ...(msg.data || {}) };
  for (const k of Object.keys(data)) data[k] = String(data[k] ?? '');
  const body = {
    message: {
      token: d.token,
      notification: { title: clip(msg.title, 80), body: clip(msg.body, 240) },
      data,
      android: { priority: 'high', notification: { channel_id: 'icrm_alerts', sound: 'default', tag: msg.tag ? String(msg.tag).slice(0, 60) : undefined } },
    },
  };
  const res = await fetch(`${fcmBase()}/v1/projects/${encodeURIComponent(c.project_id)}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (res.ok) { db.prepare("UPDATE push_devices SET last_sent_at = datetime('now'), last_error = NULL WHERE id = ?").run(d.id); return true; }
  const out = await res.json().catch(() => ({}));
  const why = (out.error && (out.error.status || out.error.message)) || String(res.status);
  const details = JSON.stringify(out.error && out.error.details || []);
  // the app was removed, or the phone gave a new token: this one is finished
  if (res.status === 404 || /UNREGISTERED/.test(why + details) || (res.status === 400 && /registration token|INVALID_ARGUMENT/.test(why + details) && /token/i.test(JSON.stringify(out)))) {
    db.prepare('DELETE FROM push_devices WHERE id = ?').run(d.id);
    return false;
  }
  if (res.status === 401) tokenCache = null;
  db.prepare('UPDATE push_devices SET last_error = ? WHERE id = ?').run(String(why).slice(0, 300), d.id);
  return false;
}

/**
 * Send an alert to these people's phones (in the background).
 * @param msg { kind: 'chat'|'followup'|'assigned'|'meeting'|'approval', title, body, route ('/chat/5'), tag, data }
 * @returns a promise of how many phones it reached (tests wait for it; callers need not)
 */
function notify(userIds, msg) {
  if (!ready() || !KINDS.includes(msg.kind)) return Promise.resolve(0);
  let list;
  try { list = devicesOf(userIds, msg.kind); } catch { return Promise.resolve(0); }
  if (!list.length) return Promise.resolve(0);
  return Promise.all(list.map((d) => sendOne(d, msg).catch((e) => {
    try { db.prepare('UPDATE push_devices SET last_error = ? WHERE id = ?').run(String(e.message).slice(0, 300), d.id); } catch { /* ignore */ }
    return false;
  }))).then((r) => r.filter(Boolean).length);
}
/** "send a test" from the settings screen, or from the app: to my own phones */
async function test(user) {
  if (!ready()) throw Object.assign(new Error('Paste the Firebase key first.'), { status: 400 });
  const list = devicesOf([user.id], 'chat').concat(devicesOf([user.id], 'followup')).filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i);
  if (!list.length) throw Object.assign(new Error('Your phone is not set up for alerts yet: open the iCRM app (version 1.4 or newer), sign in, and allow notifications.'), { status: 400 });
  await accessToken();
  let n = 0; let last = '';
  for (const d of list) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await sendOne(d, { kind: 'chat', title: 'iCRM', body: 'Phone alerts work. 👍', route: '/settings' }).catch((e) => { last = e.message; return false; });
    if (ok) n += 1;
    else if (!last) { const r = db.prepare('SELECT last_error FROM push_devices WHERE id = ?').get(d.id); last = r ? r.last_error : 'the app was removed from that phone'; }
  }
  if (!n) throw Object.assign(new Error(`Not sent: ${last || 'Google did not accept it'}.`), { status: 400 });
  return { sent: n };
}

module.exports = { KINDS, ready, status, saveKey, register, device, setPrefs, unregister, notify, test, ensureSchema };
