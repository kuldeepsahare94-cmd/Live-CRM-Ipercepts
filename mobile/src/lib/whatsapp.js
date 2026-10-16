/*
 * WhatsApp (v1.4): a phone can have both WhatsApp and WhatsApp Business. The
 * person chooses in Settings which one the app opens: "Ask every time",
 * "WhatsApp" or "WhatsApp Business" (kept on this phone). When the chosen one is
 * not on the phone, the other one opens; with neither, the WhatsApp website.
 *
 * On the phone this goes through iCRM's own Android code (PhoneAppsPlugin.java);
 * an older app without it opens the wa.me link as before.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { get, set } from './store';
import { phoneFor } from './format';
import { openOutside } from './location';

const native = Capacitor.isNativePlatform();
const Apps = native ? registerPlugin('PhoneApps') : null;

export const WA_CHOICES = [['ask', 'Ask every time'], ['whatsapp', 'WhatsApp'], ['business', 'WhatsApp Business']];
export const waChoice = () => get('wa_app') || 'ask';
export const setWaChoice = (v) => set('wa_app', WA_CHOICES.some(([k]) => k === v) ? v : 'ask');

/** which WhatsApp apps this phone has: { whatsapp, business } (null when the app cannot tell) */
export async function whatsappApps() {
  if (!Apps) return null;
  try { return await Apps.whatsappApps(); } catch { return null; }
}

/** open a WhatsApp chat with a number (and a message ready to send); no number: choose the person in WhatsApp */
export async function openWhatsApp(number, text = '') {
  const to = number ? phoneFor(number, { whatsapp: true }) : '';
  if (Apps) {
    try { await Apps.openWhatsApp({ phone: to, text: text || '', app: waChoice() }); return; } catch { /* an older app, or no WhatsApp: the website */ }
  }
  openOutside(`https://wa.me/${to}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
}
