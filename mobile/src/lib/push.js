/*
 * Phone alerts (v1.4): a notification even when the app is closed — a chat
 * message, a follow-up that is due, a lead or task given to me, a meeting
 * invite, a plan or leave to approve.
 *
 * Android delivers them through Firebase (Google). Two things are needed:
 *   1. the app was built with the company's Firebase file (GitHub secret
 *      ICRM_GOOGLE_SERVICES_JSON) — then __PUSH__ is true;
 *   2. the CRM has the Firebase key (web: Settings → Field force → Phone alerts).
 * Without them, nothing here runs and the app works as before.
 *
 * Tapping an alert opens the right screen (its "route": /chat/5, /m/leads/12…).
 */
import { Capacitor } from '@capacitor/core';
import { POST, PUT, GET, qs } from './api';
import { get, set } from './store';

const native = Capacitor.isNativePlatform();
const BUILT = typeof __PUSH__ !== 'undefined' && __PUSH__;           // eslint-disable-line no-undef
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';  // eslint-disable-line no-undef

let started = false;
let state = { built: native && BUILT, permission: '', error: '' };
let goTo = null;
let waiting = '';                 // an alert tapped before the screens were ready
const received = new Set();

/** where a tapped alert goes (the app's router) */
export function onAlertTapped(fn) {
  goTo = fn;
  if (waiting && fn) { const r = waiting; waiting = ''; fn(r); }
  return () => { if (goTo === fn) goTo = null; };
}
/** an alert that came while the app was open (e.g. a chat message: the count goes up) */
export function onAlert(fn) { received.add(fn); return () => received.delete(fn); }
export const pushState = () => ({ ...state, token: get('push_token') || '' });

/** Start alerts for the person signed in (asks the phone's permission once). */
export async function startPush(boot) {
  if (!state.built || !boot || !boot.push || !boot.push.ready) return pushState();
  const { PushNotifications } = await import('@capacitor/push-notifications');
  if (!started) {
    started = true;
    await PushNotifications.createChannel({
      id: 'icrm_alerts', name: 'iCRM alerts', description: 'Chat messages, follow-ups, work given to you, approvals',
      importance: 5, visibility: 1, sound: 'default', vibration: true, lights: true,
    }).catch(() => {});
    PushNotifications.addListener('registration', ({ value }) => {
      set('push_token', value);
      POST('/sfa/m/push/register', { token: value, platform: 'android', app_version: VERSION }).then(() => { state = { ...state, error: '' }; }).catch((e) => { state = { ...state, error: e.message }; });
    });
    PushNotifications.addListener('registrationError', (e) => { state = { ...state, error: (e && e.error) || 'The phone could not be set up for alerts.' }; });
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const route = a && a.notification && a.notification.data && a.notification.data.route;
      if (!route || !/^\/[\w/\-?=&.%:]*$/.test(route)) return;
      if (goTo) goTo(route); else waiting = route;
    });
    PushNotifications.addListener('pushNotificationReceived', (n) => { received.forEach((fn) => { try { fn(n); } catch { /* ignore */ } }); });
  }
  let perm = await PushNotifications.checkPermissions().catch(() => ({ receive: 'denied' }));
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions().catch(() => ({ receive: 'denied' }));
  state = { ...state, permission: perm.receive };
  if (perm.receive !== 'granted') return pushState();
  await PushNotifications.register().catch((e) => { state = { ...state, error: e.message }; });
  return pushState();
}

/** This phone's alert choices (chat, follow-ups, …) as the CRM keeps them. */
export async function alertPrefs() {
  const token = get('push_token');
  if (!token) return null;
  return GET(`/sfa/m/push/device${qs({ token })}`).catch(() => null);
}
export function saveAlertPrefs(prefs) { return PUT('/sfa/m/push/prefs', { token: get('push_token'), prefs }); }
export function testAlert() { return POST('/sfa/m/push/test', {}); }
/** sign out: no more alerts for this person on this phone */
export async function stopPush() {
  const token = get('push_token');
  if (token) await POST('/sfa/m/push/unregister', { token }).catch(() => {});
}
