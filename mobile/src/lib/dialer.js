/*
 * The Auto Dialer (v1.5): a calling session kept on the phone.
 *
 *   OFF until the person chooses who to call, sees the list and presses Start.
 *   One call at a time. After each call the outcome is saved (or the person
 *   skips it); only then the next call starts, after 3, 5 or 10 seconds.
 *   Pause, Skip and Stop at any time. The session stays when the app is left.
 *
 * Two ways to call:
 *   phone   the phone's dialer opens with the next number (the person taps the
 *           green button: Android lets an app only open the dialer); back in the
 *           app, the phone's call history gives the real length and answer.
 *   ivr     MCube (when this person is set up as an agent): MCube rings their
 *           phone, then the customer; MCube says when the call ended and how long.
 */
import { get, set } from './store';
import { GET, qs } from './api';
import { digits10 } from './calls';
import { today, addDays, niceDate, niceTime } from './format';

const KEY = 'dial_session';
export const MAX = 200;
export const IVR_MODULES = ['leads', 'contacts', 'accounts'];
export const SOURCES = [
  ['fu-today', "Today's follow-ups"], ['fu-tomorrow', "Tomorrow's follow-ups"], ['fu-week', "This week's follow-ups"],
  ['fu-overdue', 'Overdue follow-ups'], ['leads', 'Leads (by status, rating, source…)'],
];
const toIso = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };

export const session = () => get(KEY) || null;
export const saveSession = (s) => { set(KEY, s); return s; };
export const clearSession = () => set(KEY, null);
const stamp = (s, what) => ({ ...s, log: [...(s.log || []), { at: new Date().toISOString(), what }].slice(-400) });

/** who is to be called: from follow-ups or a lead list; with the ones left out and why */
export async function buildQueue({ source, view = 'me', filters = '', via = 'phone' }) {
  let rows = [];
  if (source && source.startsWith('fu-')) {
    const range = source.slice(3);
    const t1 = addDays(today(), 1);
    const params = range === 'tomorrow' ? { range: 'dates', from: t1, to: t1 } : { range };
    const d = await GET(`/sfa/m/follow-ups${qs({ ...params, view })}`);
    rows = d.rows.map((r) => ({
      module: r.module, id: Number(r.record_id), name: r.title, sub: [r.company, r.assignee_name && view !== 'me' ? r.assignee_name : ''].filter(Boolean).join(' · '),
      phone: r.phone || '', follow_up_id: r.id, rating: r.rating || '',
      due: `${r.overdue ? 'Overdue · ' : ''}${niceDate(r.due_date)}${r.has_time ? ` · ${niceTime(toIso(r.snoozed_until || r.due_at))}` : ''}`,
    }));
  } else {
    for (let page = 1; page <= 3 && rows.length < MAX * 2; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await GET(`/sfa/m/list/leads${qs({ f: filters, view: view === 'all' ? '' : view, page, page_size: 100 })}`);
      rows.push(...d.rows.map((r) => ({ module: 'leads', id: Number(r.id), name: r.title, sub: [r.sub, r.status].filter(Boolean).join(' · '), phone: r.phone || '', status: r.status || '' })));
      if (page * 100 >= Number(d.total || 0)) break;
    }
  }
  const items = []; const left = []; const seen = new Map();
  for (const r of rows) {
    const d = digits10(r.phone);
    if (!d) { left.push({ ...r, reason: 'No phone number' }); continue; }
    if (via === 'ivr' && !IVR_MODULES.includes(r.module)) { left.push({ ...r, reason: 'MCube calls leads, contacts and customers only' }); continue; }
    if (seen.has(d)) { left.push({ ...r, reason: `Same number as ${seen.get(d)}` }); continue; }
    if (items.length >= MAX) { left.push({ ...r, reason: `More than ${MAX} in one session` }); continue; }
    seen.set(d, r.name);
    items.push({ ...r, key: `${r.module}-${r.id}`, state: 'pending' });
  }
  return { items, left };
}

/** Start: the session is on (state "active"), at the first person */
export function startSession({ items, source, sourceLabel, view, delay, via }) {
  return saveSession(stamp({ id: Date.now(), items, pos: 0, state: 'active', source, source_label: sourceLabel, view, delay, via, started_at: new Date().toISOString() }, 'start'));
}
export const current = (s) => (s && s.items[s.pos]) || null;
export const counts = (s) => {
  const out = { total: s ? s.items.length : 0, done: 0, skipped: 0, connected: 0, not_connected: 0, failed: 0, pending: 0 };
  for (const i of (s ? s.items : [])) {
    if (i.state === 'done') { out.done += 1; if (i.result && i.result.connected) out.connected += 1; else out.not_connected += 1; }
    else if (i.state === 'skipped') out.skipped += 1;
    else if (i.state === 'failed') out.failed += 1;
    else out.pending += 1;
  }
  out.processed = out.done + out.skipped + out.failed;
  return out;
};
function nextPos(s) {
  for (let i = s.pos + 1; i < s.items.length; i += 1) if (s.items[i].state === 'pending') return i;
  for (let i = 0; i <= s.pos && i < s.items.length; i += 1) if (s.items[i].state === 'pending') return i;
  return -1;
}
function update(fn) {
  const s = session();
  if (!s) return null;
  const n = fn({ ...s, items: s.items.map((x) => ({ ...x })) });
  return saveSession(n);
}
/** the call screen opened for the current person */
export const markCalling = () => update((s) => { s.items[s.pos].state = 'calling'; s.items[s.pos].called_at = Date.now(); return stamp(s, `call ${s.items[s.pos].key}`); });
/** the call screen saved this person's call (or said it was saved by itself) */
export function reportResult(module, id, result) {
  const s = session();
  if (!s || s.state === 'done' || s.state === 'stopped') return;
  const i = s.items.findIndex((x) => x.module === module && Number(x.id) === Number(id) && x.state === 'calling');
  if (i < 0) return;
  update((n) => { n.items[i].result = { ...result, at: Date.now() }; return stamp(n, `saved ${n.items[i].key}`); });
}
/** after a saved call (or a skip): move on — the countdown to the next call starts (unless paused) */
export function advance(how = 'done') {
  return update((s) => {
    const it = s.items[s.pos];
    if (it && (it.state === 'calling' || it.state === 'pending')) it.state = how === 'skip' ? 'skipped' : how === 'failed' ? 'failed' : (it.result ? 'done' : 'skipped');
    const n = nextPos(s);
    if (n < 0) return stamp({ ...s, state: 'done', ended_at: new Date().toISOString(), next_at: null }, how);
    return stamp({ ...s, pos: n, next_at: s.state === 'active' ? Date.now() + (Number(s.delay) || 5) * 1000 : null }, how);
  });
}
export const pause = () => update((s) => stamp({ ...s, state: 'paused', next_at: null }, 'pause'));
export const resume = () => update((s) => stamp({ ...s, state: 'active', next_at: Date.now() + (Number(s.delay) || 5) * 1000 }, 'resume'));
export const stop = () => update((s) => stamp({ ...s, state: 'stopped', ended_at: new Date().toISOString(), next_at: null }, 'stop'));
