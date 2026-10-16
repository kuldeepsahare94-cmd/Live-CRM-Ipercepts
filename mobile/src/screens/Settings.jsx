/*
 * The app's settings (v1.4), kept on this phone:
 *   WhatsApp      which app opens: ask every time, WhatsApp, or WhatsApp Business
 *   Phone alerts  on or off for chat messages, follow-ups, work given to me,
 *                 meeting invites, approvals; "Send a test"
 */
import { useEffect, useState } from 'react';
import { MessageCircle, BellRing, Check, Loader2, Info, Send } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../lib/app';
import { WA_CHOICES, waChoice, setWaChoice, whatsappApps } from '../lib/whatsapp';
import { pushState, startPush, alertPrefs, saveAlertPrefs, testAlert } from '../lib/push';
import { TopBar, BottomNav, StatusBars } from '../components/ui';

const KINDS = [
  ['chat', 'Chat messages', 'A message to you or your group'],
  ['followup', 'Follow-ups', 'When a follow-up is due'],
  ['assigned', 'Work given to you', 'A lead, customer, deal, task or quotation'],
  ['meeting', 'Meeting invites', 'When you are invited to a meeting'],
  ['approval', 'Approvals', 'Plans and leave to approve, and the answers'],
];

function WhatsAppCard() {
  const { say } = useApp();
  const [choice, setChoice] = useState(waChoice());
  const [apps, setApps] = useState(undefined);
  useEffect(() => { whatsappApps().then(setApps); }, []);
  const pick = (k) => { setWaChoice(k); setChoice(k); say('Saved.', 'ok'); };
  const has = (k) => (!apps ? null : k === 'whatsapp' ? apps.whatsapp : k === 'business' ? apps.business : true);
  return (
    <div className="card col" data-testid="wa-card">
      <div className="card-title"><MessageCircle size={15} /> WhatsApp</div>
      <div className="small muted">Which WhatsApp the app opens when you tap WhatsApp on a customer:</div>
      <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
        {WA_CHOICES.map(([k, label]) => (
          <button key={k} type="button" className="row" onClick={() => pick(k)} data-testid={`wa-${k}`}>
            <span className={`radio${choice === k ? ' on' : ''}`} aria-hidden="true" />
            <div className="main">
              <div className="title">{label}</div>
              <div className="line">{k === 'ask' ? 'The phone asks each time (when both are on the phone)' : has(k) === false ? 'Not on this phone — the other one opens' : has(k) ? 'On this phone' : ''}</div>
            </div>
            {choice === k && <Check size={18} color="var(--brand)" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function AlertsCard() {
  const { boot, say } = useApp();
  const [st, setSt] = useState(pushState());
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState('');
  const native = Capacitor.isNativePlatform();
  useEffect(() => { alertPrefs().then((d) => setPrefs(d ? d.prefs : null)); }, [st.token]);
  const ready = boot.push && boot.push.ready;
  const allow = async () => { setBusy('allow'); try { setSt(await startPush(boot)); } finally { setBusy(''); } };
  const toggle = async (k) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next); setBusy(k);
    try { await saveAlertPrefs(next); } catch (e) { setPrefs(prefs); say(e.message, 'error'); } finally { setBusy(''); }
  };
  const test = async () => { setBusy('test'); try { await testAlert(); say('Sent. It shows on this phone in a moment.', 'ok'); } catch (e) { say(e.message, 'error'); } finally { setBusy(''); } };
  let why = '';
  if (!native) why = 'Phone alerts work in the iCRM app on an Android phone.';
  else if (!st.built) why = 'This copy of the app was built without phone alerts. Your administrator adds the Firebase file to the app once (see the update notes), then a new app is installed.';
  else if (!ready) why = 'Your administrator has not finished setting up phone alerts yet (web: Settings → Field force → Phone alerts).';
  else if (st.permission && st.permission !== 'granted') why = 'Notifications are off for iCRM on this phone.';
  else if (st.error) why = st.error;
  return (
    <div className="card col" data-testid="alerts-card">
      <div className="card-title"><BellRing size={15} /> Phone alerts</div>
      <div className="small muted">A notification even when the app is closed. Tap it to open the right screen.</div>
      {why ? (
        <div className="note info small flex" style={{ alignItems: 'flex-start' }} data-testid="alerts-why"><Info size={16} style={{ flex: 'none', marginTop: 2 }} /><span>{why}</span></div>
      ) : !prefs ? (
        <div className="small muted flex"><Loader2 size={16} className="spin" /> Setting up this phone…</div>
      ) : (
        <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }} data-testid="alerts-prefs">
          {KINDS.map(([k, label, sub]) => (
            <label key={k} className="row" data-testid={`alert-${k}`}>
              <div className="main"><div className="title">{label}</div><div className="line">{sub}</div></div>
              <span className={`switch${prefs[k] ? ' on' : ''}`}><input type="checkbox" checked={!!prefs[k]} disabled={busy === k} onChange={() => toggle(k)} /></span>
            </label>
          ))}
        </div>
      )}
      {native && st.built && ready && st.permission && st.permission !== 'granted' && <button type="button" className="btn outline" onClick={allow} disabled={busy === 'allow'}>Allow notifications</button>}
      {!why && prefs && <button type="button" className="btn outline" onClick={test} disabled={busy === 'test'} data-testid="alert-test">{busy === 'test' ? <Loader2 size={18} className="spin" /> : <Send size={18} />} Send a test</button>}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="screen">
      <TopBar title="Settings" back={false} />
      <StatusBars />
      <div className="body">
        <WhatsAppCard />
        <AlertsCard />
      </div>
      <BottomNav />
    </div>
  );
}
