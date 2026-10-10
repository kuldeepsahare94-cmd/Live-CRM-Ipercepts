/*
 * Calls from the phone.
 *
 *   - Tap "Call": the phone's dialer opens. Back in the app, the phone's own call
 *     history says when the call started, how long it was and if it was answered.
 *   - The call is saved on the customer by itself (auto log), or with the
 *     person's outcome, remark and follow-up (the call screen). Offline it waits
 *     in the outbox like everything else.
 *   - Calls made or missed outside the app are found in the phone's call history
 *     and matched to the CRM's leads, contacts and customers.
 *   - The recording the phone's dialer made (Samsung, Xiaomi, Oppo, Vivo,
 *     Realme, OnePlus… have one) is found and saved with the call.
 *
 * Each phone call has one reference ("pc-<time>-<number>"): however it reaches
 * the CRM (the call screen, the auto log, the scan), it is saved once.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { get, set } from './store';
import { add, flush, list as outboxList, mine, newRef, setPreparer } from './outbox';
import { POST } from './api';
import { openOutside } from './location';
import { phoneFor } from './format';

const native = Capacitor.isNativePlatform();
const CallLogNative = native ? registerPlugin('CallLog') : null;

// In a browser (testing) a stand-in can be put on window.__icrmCallLog
const plugin = () => CallLogNative || (typeof window !== 'undefined' ? window.__icrmCallLog : null) || null;
export const canReadPhone = () => !!plugin();

export const digits10 = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 6 ? d.slice(-10) : ''; };
export const refOf = (c) => `pc-${c.date}-${digits10(c.number) || 'x'}`;

export async function phoneStatus() {
  const p = plugin();
  if (!p) return { callLog: false, audio: false, available: false };
  try { return { ...(await p.status()), available: true }; } catch { return { callLog: false, audio: false, available: true }; }
}
export async function askCallLog() {
  const p = plugin(); if (!p) return false;
  try { return !!(await p.requestCallLog()).callLog; } catch { return false; }
}
export async function askAudio() {
  const p = plugin(); if (!p) return false;
  try { return !!(await p.requestAudio()).audio; } catch { return false; }
}

/** the phone's calls since a time (ms), newest first: [{ id, number, digits, type, date, duration, end, name, ref, connected, direction }] */
export async function phoneCalls({ since = Date.now() - 2 * 86400000, limit = 200 } = {}) {
  const p = plugin(); if (!p) return [];
  const r = await p.getCalls({ since, limit });
  return ((r && r.calls) || []).map((c) => {
    const duration = Math.max(0, Number(c.duration) || 0);
    const type = c.type || 'other';
    return {
      ...c, duration, type, digits: digits10(c.number), end: Number(c.date) + duration * 1000, ref: refOf(c),
      direction: type === 'out' ? 'Outbound' : 'Inbound',
      connected: type === 'out' ? duration > 0 : type === 'in',
      missed: type === 'missed' || type === 'rejected',
    };
  });
}

// ---------------------------------------------------------------------------
// A call from the app
// ---------------------------------------------------------------------------
/** Open the dialer; the call is remembered so the app can find it after (also if Android closed the app meanwhile). */
export function startCall({ module, id, name, number }) {
  set('pending_call', { module, id: Number(id), name: name || '', number, digits: digits10(number), at: Date.now() });
  openOutside(`tel:${phoneFor(number)}`);
}
export const pendingCall = () => {
  const p = get('pending_call');
  return p && Date.now() - p.at < 3 * 3600000 ? p : null;
};
export const clearPendingCall = () => set('pending_call', null);
/** (Home opens the call screen for it once, not each time) */
export const markPendingShown = () => { const p = get('pending_call'); if (p) set('pending_call', { ...p, shown: true }); };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** the phone call that followed the tap (the phone writes it a moment after the call ends) */
export async function findPhoneCall(pending, { tries = 4 } = {}) {
  if (!pending || !plugin()) return null;
  for (let i = 0; i < tries; i += 1) {
    let calls = [];
    try { calls = await phoneCalls({ since: pending.at - 15000, limit: 30 }); } catch { return null; }
    const hit = calls.filter((c) => c.type === 'out' && (!pending.digits || c.digits === pending.digits))
      .sort((a, b) => b.date - a.date)[0];
    if (hit) return hit;
    if (i < tries - 1) await wait(1500);
  }
  return null;
}

/** what is said when the person says nothing (auto log) */
export function autoOutcome(c) {
  if (c.connected) return 'Connected';
  if (c.missed) return 'Missed call';
  return 'No answer';
}

/** a call's body for POST /calls/dispose */
export function callBody({ module, id, call, number, outcome = {} }) {
  const c = call || {};
  const start = c.date ? new Date(c.date).toISOString() : outcome.start_time;
  const body = {
    client_ref: outcome.ref || c.ref,
    related_module: module, related_record_id: Number(id),
    phone_number: number || c.number || undefined,
    direction: c.direction || 'Outbound',
    connected: outcome.connected !== undefined ? outcome.connected : !!c.connected,
    disposition: outcome.disposition || autoOutcome(c),
    duration_seconds: c.duration !== undefined ? c.duration : outcome.duration_seconds,
    start_time: start,
    end_time: c.end ? new Date(c.end).toISOString() : undefined,
    call_source: outcome.source || 'app',
    notes: outcome.notes || undefined,
  };
  if (outcome.mode) body.mode = outcome.mode;
  if (outcome.mode === 'update') body.update_ref = newRef('u');     // (a retry of the same outcome is added once)
  if (outcome.lead_status) body.lead_status = outcome.lead_status;
  if (outcome.follow_up_at) {
    body.next_action = 'schedule';
    body.follow_up_at = outcome.follow_up_at;
    body.follow_up_notes = outcome.notes || undefined;
  }
  return body;
}

/** Save a call (through the outbox: also offline). */
export function queueCall(body, label) {
  return add({ kind: 'call', label: label || `Call ${body.connected ? '' : '(not answered) '}`.trim(), method: 'POST', path: '/calls/dispose', body, ref: body.client_ref });
}
/** is this phone call already in the outbox (waiting, or could not be saved: not queued again)? */
export const waitingRefs = () => new Set(mine(outboxList()).filter((x) => x.kind === 'call').map((x) => x.ref));

/*
 * A call saved before the phone's call history had it (the person came back to the app during
 * the call, or the phone wrote it late) has the reference "ac-<tap time>". When the phone's call
 * turns up, its real start, end and length are added to THAT call (not saved as a second one).
 */
export function linkLater({ ref, digits, at, module, id }) {
  set('ac_links', [...(get('ac_links', []) || []).filter((l) => Date.now() - l.at < 86400000), { ref, digits, at, module, id }].slice(-50));
}
function useLinks(calls) {
  const links = get('ac_links', []) || [];
  if (!links.length) return 0;
  const left = [];
  let n = 0;
  for (const l of links) {
    const c = calls.find((x) => x.type === 'out' && x.digits === l.digits && x.date >= l.at - 15000 && x.date <= l.at + 4 * 3600000 && !x.linked);
    if (!c) { if (Date.now() - l.at < 86400000) left.push(l); continue; }
    c.linked = true; c.logged = true;
    set('linked_refs', [...(get('linked_refs', []) || []), c.ref].slice(-300));
    add({ kind: 'call', label: 'Call: the real length', method: 'POST', path: '/calls/dispose', ref: c.ref,
      body: { mode: 'facts', client_ref: l.ref, connected: c.connected, duration_seconds: c.duration, start_time: new Date(c.date).toISOString(), end_time: new Date(c.end).toISOString() } });
    attachRecording({ ...c, ref: l.ref }).catch(() => {});
    n += 1;
  }
  set('ac_links', left);
  return n;
}

// ---------------------------------------------------------------------------
// Recordings made by the phone's dialer
// ---------------------------------------------------------------------------
const RECORDING_PLACES = /call|record|recorder|sound_recorder|voice/i;
const MAX_SEND = 12 * 1024 * 1024;   // a recording up to 12 MB (about 25 minutes of a phone's recording) is sent
/** the dialer's recording of this call, or null */
export async function findRecording(c) {
  const p = plugin();
  if (!p || !c || !c.connected || !c.duration) return null;
  let files = [];
  try { files = ((await p.findRecordings({ from: c.date - 60000, to: c.end + 10 * 60000 })) || {}).files || []; } catch { return null; }
  const d = c.digits;
  const used = new Set(get('rec_files', []) || []);         // (one file is one call's recording)
  const scored = files.filter((f) => !used.has(f.id)).map((f) => {
    let score = 0;
    const name = `${f.name || ''}`;
    if (d && name.replace(/\D/g, '').includes(d)) score += 50;
    if (c.name && name.toLowerCase().includes(String(c.name).toLowerCase())) score += 30;
    if (RECORDING_PLACES.test(`${f.path || ''} ${name}`)) score += 20;
    const t = Math.max(Number(f.added) || 0, Number(f.modified) || 0);
    const gap = Math.abs(t - c.end) / 1000;
    if (gap < 120) score += 20; else if (gap < 600) score += 5;
    const len = (Number(f.duration) || 0) / 1000;
    if (len && Math.abs(len - c.duration) <= Math.max(5, c.duration * 0.15)) score += 25;
    if (!f.size || f.size > MAX_SEND) score = -1;
    return { f, score };
  }).filter((x) => x.score >= 45).sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].f : null;
}

/** Look for the recording a few times (the dialer writes it just after the call) and queue it with the call. */
const looking = new Set();          // (one search per call at a time)
export async function attachRecording(c, { delays = [3000, 12000, 30000] } = {}) {
  const b = get('boot');
  if (!b || !b.calls || !b.calls.recordings || !c || !c.connected) return false;
  if (looking.has(c.ref) || (get('rec_sent', []) || []).includes(c.ref)) return true;
  looking.add(c.ref);
  try { return await lookFor(c, delays); } finally { looking.delete(c.ref); }
}
async function lookFor(c, delays) {
  const st = await phoneStatus();
  if (!st.audio) return false;
  const sent = new Set(get('rec_sent', []) || []);
  for (const ms of delays) {
    await wait(ms);
    const f = await findRecording(c);
    if (f) {
      add({ kind: 'call-recording', label: 'Call recording', method: 'POST', path: '/sfa/call-recordings', ref: newRef('r'),
        body: { client_ref: c.ref, media_id: f.id, file_name: f.name, mime: f.mime, duration: Math.round((Number(f.duration) || 0) / 1000) || c.duration } });
      set('rec_sent', [...sent, c.ref].slice(-300));
      set('rec_files', [...(get('rec_files', []) || []), f.id].slice(-300));
      flush().catch(() => {});
      return true;
    }
  }
  return false;
}

/** the outbox reads the sound file only when it sends it (it is not kept twice on the phone) */
export async function recordingBody(body) {
  if (!body || body.data || body.media_id === undefined) return body;
  const p = plugin();
  if (!p) throw Object.assign(new Error('The recording can only be sent from the phone.'), { permanent: true });
  try {
    const r = await p.readAudio({ id: body.media_id, maxBytes: MAX_SEND });
    const { media_id: _m, ...rest } = body;
    return { ...rest, data: r.data };
  } catch (e) {
    throw Object.assign(new Error(/TOO_BIG|too big/i.test(String(e && (e.code || e.message))) ? 'The recording is too big (more than 12 MB).' : 'The recording is no longer on the phone.'), { permanent: true });
  }
}

// ---------------------------------------------------------------------------
// The phone's recent calls with the CRM's names (Home, "Phone calls" screen)
// ---------------------------------------------------------------------------
/**
 * @returns { calls: [{ ...phone call, match: { module, id, name } | null, logged }], error }
 */
let lastScan = 0;
/** Home looks at the phone's calls at most once a minute (the CRM is asked for the names each time) */
export const scanDue = () => Date.now() - lastScan > 60000;
export async function recentWithMatches({ since = Date.now() - 2 * 86400000 } = {}) {
  const calls = await phoneCalls({ since, limit: 200 });
  if (!calls.length) return { calls: [] };
  const numbers = [...new Set(calls.map((c) => c.digits).filter(Boolean))];
  const r = await POST('/sfa/calls/match', { numbers, refs: calls.map((c) => c.ref) });
  const logged = new Set([...(r.logged || []), ...waitingRefs(), ...(get('linked_refs', []) || [])]);
  set('call_matches', { at: Date.now(), matches: r.matches || {} });
  lastScan = Date.now();
  return { calls: calls.map((c) => ({ ...c, match: (r.matches || {})[c.digits] || null, logged: logged.has(c.ref) })) };
}

/**
 * Calls with customers that are not in the CRM yet: saved by themselves when the
 * company has "auto log" on (only calls made after the app started looking, so
 * months of old history are not added at once).
 */
export async function autoLogMissing(calls) {
  const b = get('boot');
  if (!b || !b.calls || !b.calls.enabled) return 0;
  const linked = useLinks(calls);
  if (!b.calls.auto_log) return linked;
  let from = get('scan_from');
  if (!from) { from = Date.now(); set('scan_from', from); }
  const waiting = waitingRefs();
  let n = linked;
  for (const c of calls) {
    if (!c.match || c.logged || waiting.has(c.ref) || c.date < from) continue;
    if (c.type === 'blocked' || c.type === 'voicemail' || c.type === 'other') continue;
    queueCall(callBody({ module: c.match.module, id: c.match.id, call: c, number: c.number, outcome: { source: 'phone' } }), `Call with ${c.match.name}`);
    c.logged = true;
    n += 1;
    attachRecording(c).catch(() => {});
  }
  return n;
}

/** missed calls from customers that were not called back yet (newest first) */
export function callBacks(calls) {
  const out = [];
  const seen = new Set();
  for (const c of [...calls].sort((a, b) => b.date - a.date)) {
    if (!c.digits || seen.has(c.digits)) continue;
    seen.add(c.digits);
    if (c.missed && c.match) out.push(c);       // the newest call with this number was a missed one
  }
  return out;
}

/** WhatsApp after the call: the company's message with the customer's name */
export function whatsappAfter(number, name) {
  const b = get('boot');
  const text = ((b && b.calls && b.calls.whatsapp_text) || '').replace(/\{name\}/gi, name || '').replace(/\{me\}/gi, (b && b.me && b.me.name) || '').trim();
  const to = phoneFor(number, { whatsapp: true });
  openOutside(`https://wa.me/${to}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
}

setPreparer('call-recording', recordingBody);
