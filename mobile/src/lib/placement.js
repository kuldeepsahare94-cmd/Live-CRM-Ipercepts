/*
 * Placement desk (recruitment) in the app (v1.6): what the screens share.
 *
 *   meta()                       the stage list, the reasons, the call outcomes (kept on the phone)
 *   startPlCall(person)          open the dialer; the app asks "how did it go?" when the person is back
 *   pendingPlCall() / clear...   the call waiting for its outcome
 *   saveContact(...)             a call outcome + the next follow-up, through the outbox (also offline)
 *   planReminders(list, now)     which interviews get a phone reminder (30 minutes before)
 *   refreshReminders(list)       set them on the phone (only what changed)
 */
import { Capacitor } from '@capacitor/core';
import { get, set } from './store';
import { GET } from './api';
import { add as outboxAdd, newRef } from './outbox';
import { phoneFor } from './format';
import { openOutside } from './location';

const native = Capacitor.isNativePlatform();
export const P = (path) => `/placement${path}`;
export const placementOf = (boot) => (boot && boot.placement) || null;

// ---- the lists (stages, reasons, outcomes)
const FALLBACK = {
  stages: ['Sourced', 'Screened', 'Submitted', 'Interview L1', 'Interview L2', 'Final round', 'Offered', 'Offer accepted', 'Joined'],
  side_stages: ['On hold', 'Rejected'],
  reject_reasons: ['Client rejected', 'Candidate not interested', 'CTC mismatch', 'Counter offer', 'Backed out', 'Did not turn up'],
  contact_outcomes: ['Interested', 'Not interested', 'Call back', 'Not reachable', 'Wrong number', 'Switched off'],
  sources: ['Naukri', 'LinkedIn', 'Referral', 'Walk-in', 'Database'],
  notice_periods: ['Immediate', '15 days', '30 days', '60 days', '90 days'],
};
export const cachedMeta = () => ({ ...FALLBACK, ...(get('pl_meta') || {}) });
/** Ask the server (when online); the last answer stays on the phone. */
export async function meta() {
  try {
    const m = await GET(P('/meta'));
    if (m && m.stages) set('pl_meta', { stages: m.stages, side_stages: m.side_stages, reject_reasons: m.reject_reasons, contact_outcomes: m.contact_outcomes, sources: m.sources, notice_periods: m.notice_periods, today: m.today });
  } catch { /* the last answer is used */ }
  return cachedMeta();
}

// ---- a call to a candidate
const THREE_HOURS = 3 * 3600000;
export function startPlCall({ id, name, number }) {
  set('pl_pending_call', { id: Number(id), name: name || '', number, at: Date.now() });
  openOutside(`tel:${phoneFor(number)}`);
}
export const pendingPlCall = () => {
  const p = get('pl_pending_call');
  return p && Date.now() - p.at < THREE_HOURS ? p : null;
};
export const clearPlCall = () => set('pl_pending_call', null);

const pad = (n) => String(n).padStart(2, '0');
export const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** "Tomorrow 11:00", "In 3 days"… as the follow-up the server wants (a day and a time) */
export function followChoices(now = new Date()) {
  const at = (days, h = 11) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return localStamp(d); };
  return [['', 'No follow-up'], [at(1), 'Tomorrow'], [at(3), 'In 3 days'], [at(7), 'Next week']];
}

/** Save a call outcome (through the outbox: it also works without internet, and a retry is saved once). */
export function saveContact({ id, name, outcome, remark, next, channel = 'Call' }) {
  const ref = newRef('plc');
  const body = { channel, outcome, remark: remark || undefined, next_follow_up: next || undefined, client_ref: ref };
  return outboxAdd({ kind: 'pl-contact', label: `${channel === 'Call' ? 'Call' : channel}: ${name || 'candidate'} (${outcome})`, method: 'POST', path: P(`/candidates/${id}/contact`), body, ref });
}

// ---- interview reminders: 30 minutes before, for the next 3 days
const BASE_ID = 7300;
const MAX_REMINDERS = 20;
const LEAD_MIN = 30;
let last = '';
/** the interviews that get a reminder from `now` (also used by tests in a browser) */
export function planReminders(list, now = new Date()) {
  const out = [];
  for (const iv of list || []) {
    if (iv.result && iv.result !== 'Scheduled') continue;
    const at = new Date(String(iv.scheduled_at || '').replace(' ', 'T'));
    if (Number.isNaN(at.getTime())) continue;
    const when = new Date(at.getTime() - LEAD_MIN * 60000);
    if (when <= now) continue;
    out.push({
      key: iv.id, at: when,
      title: `Interview in ${LEAD_MIN} minutes`,
      body: `${iv.candidate_name} · ${iv.job_title}${iv.client_name ? ` (${iv.client_name})` : ''} · ${iv.round || ''} · ${iv.mode || ''}`.replace(/ · $/, ''),
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS).map((x, i) => ({ ...x, id: BASE_ID + i }));
}
export async function refreshReminders(list) {
  const want = planReminders(list);
  const sig = JSON.stringify(want.map((x) => [x.key, x.at.getTime()]));
  if (sig === last) return want;
  last = sig;
  if (!native) return want;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: Array.from({ length: MAX_REMINDERS }, (_, i) => ({ id: BASE_ID + i })) });
    if (!want.length) return want;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') { const p = await LocalNotifications.requestPermissions(); if (p.display !== 'granted') return want; }
    await LocalNotifications.schedule({ notifications: want.map((x) => ({ id: x.id, title: x.title, body: x.body, schedule: { at: x.at, allowWhileIdle: true } })) });
  } catch { /* reminders are a help, never in the way */ }
  return want;
}
/** sign-out / the reminders of someone else: nothing stays */
export async function clearReminders() {
  last = '';
  if (!native) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: Array.from({ length: MAX_REMINDERS }, (_, i) => ({ id: BASE_ID + i })) });
  } catch { /* nothing to do */ }
}
