/*
 * Call a customer and log it.
 *
 * Tap "Call": the phone's dialer opens. Back in the app, the phone's call history
 * gives the real start, end and length, and if the customer answered. With
 * "auto log" (Settings → Field force → Calls) the call is saved at once; the
 * person can still add the outcome, a remark (spoken or typed), the lead's
 * status and a follow-up — it is added to the same call.
 * Everything goes through the outbox, so it works without internet too.
 *
 * (v1.5) From the Auto Dialer (?session=…): the outcome is told to the session
 * when it is saved, and the next call waits for it. With ?via=ivr the call goes
 * through MCube: it rings the person's phone, then the customer; MCube says when
 * it ended and how long it was, and the outcome fills in THAT call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Phone, Loader2, MessageCircle, CheckCircle2, PhoneOff, Clock, FileAudio } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { useApp, listen } from '../lib/app';
import { GET, POST } from '../lib/api';
import { reportResult } from '../lib/dialer';
import { titleOf, phoneOf } from '../lib/records';
import { addDays, today, niceTime, talk } from '../lib/format';
import { get } from '../lib/store';
import { startCall, pendingCall, clearPendingCall, findPhoneCall, callBody, queueCall, attachRecording, whatsappAfter, phoneStatus, askCallLog, askAudio, canReadPhone, linkLater, digits10, queueRecordingFile } from '../lib/calls';
import RecordingPicker from '../components/RecordingPicker';
import { TopBar, Loading, Field, StatusBars, VoiceArea } from '../components/ui';

const FALLBACK = { yes: ['Interested', 'Call back later', 'Not interested', 'Already purchased'], no: ['No answer', 'Busy', 'Switched off', 'Wrong number'] };
const FALLBACK_STATUS = ['New', 'Contacted', 'Interested', 'Follow-up', 'Converted', 'Not Interested', 'Dropped'];

const at = (day, hm) => { const [y, m, d] = day.split('-').map(Number); const [h, mi] = hm.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const local = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
function quickTimes() {
  const now = new Date();
  const out = [];
  const evening = at(today(), '18:00');
  if (evening - now > 45 * 60000) out.push({ key: 'evening', label: 'This evening', when: evening });
  out.push({ key: 'tomorrow', label: 'Tomorrow', when: at(addDays(today(), 1), '11:00') });
  out.push({ key: '3days', label: 'In 3 days', when: at(addDays(today(), 3), '11:00') });
  out.push({ key: 'week', label: 'Next week', when: at(addDays(today(), 7), '11:00') });
  return out;
}

export default function CallLog() {
  const { module, id } = useParams();
  const [params] = useSearchParams();
  const { say, boot, module: mod, online, sync } = useApp();
  const nav = useNavigate();
  const rules = (boot && boot.calls) || {};
  const [row, setRow] = useState(null);
  const [options, setOptions] = useState({ yes: FALLBACK.yes, no: FALLBACK.no });
  const [phase, setPhase] = useState('ready');          // ready → calling → after
  const [call, setCall] = useState(null);               // the phone's call (start, length, answered)
  const [guess, setGuess] = useState(0);                // seconds, when the phone's call history cannot be read
  const [autoSaved, setAutoSaved] = useState(false);
  const [connected, setConnected] = useState(null);
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [follow, setFollow] = useState('');
  const [followAt, setFollowAt] = useState(local(at(addDays(today(), 1), '11:00')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needLog, setNeedLog] = useState(false);
  const ref = useRef(null);                             // this call's reference (saved once)
  const handled = useRef(false);
  const tapAt = useRef(0);
  const [late, setLate] = useState(false);
  const [pickRec, setPickRec] = useState(false);
  const [recDone, setRecDone] = useState(false);
  const inSession = !!params.get('session');
  const viaIvr = params.get('via') === 'ivr';
  const [ivr, setIvr] = useState(null);                 // (MCube) the call's session { id }
  const [ivrCall, setIvrCall] = useState(null);         // (MCube) the call as MCube reported it

  useEffect(() => {
    GET(`/${module}/${id}`).then((r) => { setRow(r); if (module === 'leads') setStatus(r.status || ''); }).catch((e) => setError(e.message));
    const opt = (key) => GET(`/option-lists/shared/${key}/options`).then((l) => (Array.isArray(l) ? l.filter((o) => o.active !== false).map((o) => o.label || o.value) : null)).catch(() => null);
    Promise.all([opt('call_disposition_connected'), opt('call_disposition_not_connected')]).then(([y, n]) => setOptions({ yes: y && y.length ? y : FALLBACK.yes, no: n && n.length ? n : FALLBACK.no }));
    phoneStatus().then((s) => setNeedLog(s.available && !s.callLog));
  }, [module, id]);

  const phone = phoneOf(row);
  const name = row ? titleOf(module, row) : '';
  const leadStatuses = (() => {
    const f = module === 'leads' && mod('leads') ? (mod('leads').fields || []).find((x) => x.api_name === 'status') : null;
    const l = f && f.options && f.options.length ? f.options.map((o) => o.value) : FALLBACK_STATUS;
    return status && !l.includes(status) ? [status, ...l] : l;
  })();

  // (v1.5) through MCube: the CRM asks MCube to call; this screen waits for the end of the call
  const dialIvr = async () => {
    setError(''); setBusy(true);
    try {
      const out = await POST('/telephony/call', { module, record_id: Number(id), number: phone });
      setIvr(out.session); setPhase('calling');
    } catch (e) { setError(e.offline ? 'No internet: MCube calls need the internet.' : e.message); } finally { setBusy(false); }
  };
  const ivrEnded = useCallback(async (s) => {
    let c = null;
    try { c = (await GET(`/telephony/pending?module=${module}&record_id=${id}`)).call; } catch { c = null; }
    setIvrCall(c || (s ? { connected: !!s.connected, duration_seconds: s.duration_seconds || 0 } : null));
    const conn = c ? c.connected : s ? !!s.connected : null;
    setConnected(conn);
    if (conn === false) setDisposition('No answer');
    setPhase('after');
  }, [module, id]);
  useEffect(() => {
    if (!viaIvr || phase !== 'calling' || !ivr) return undefined;
    let gone = false;
    const look = async () => {
      try {
        const { sessions } = await GET('/telephony/live');
        if (gone) return;
        const s = (sessions || []).find((x) => Number(x.id) === Number(ivr.id));
        if (s && s.status === 'failed') { setError(s.error || 'MCube could not start the call.'); setPhase('ready'); setIvr(null); return; }
        if (!s || !s.live) ivrEnded(s);
      } catch { /* the next look */ }
    };
    const t = setInterval(look, 2500);
    look();
    return () => { gone = true; clearInterval(t); };
  }, [viaIvr, phase, ivr, ivrEnded]);

  const dial = async () => {
    if (!phone) return;
    if (viaIvr) { dialIvr(); return; }
    // the phone's call history (asked once): the real start, length and answer
    if (canReadPhone()) {
      const s = await phoneStatus();
      if (!s.callLog) setNeedLog(!(await askCallLog()));
      if (rules.recordings && !s.audio) await askAudio();
    }
    handled.current = false;
    startCall({ module, id, name, number: phone });
    setPhase('calling');
  };

  // back from the dialer (or the app was opened again after Android closed it)
  const afterCall = async () => {
    const p = pendingCall();
    if (!p || p.module !== module || p.id !== Number(id) || handled.current) return;
    handled.current = true;
    tapAt.current = p.at;
    setPhase('after');
    const c = await findPhoneCall(p);
    if (c) {
      clearPendingCall();
      setLate(false);
      ref.current = c.ref;
      setCall(c);
      setConnected(c.connected);
      if (!c.connected) setDisposition('No answer');
      if (rules.auto_log) {
        queueCall(callBody({ module, id, call: c, number: p.number }), `Call with ${p.name || 'customer'}`);
        setAutoSaved(true);
        sync();
        attachRecording(c).catch(() => {});
      }
    } else {
      ref.current = `ac-${p.at}`;
      setGuess(Math.round((Date.now() - p.at) / 1000));
      // not in the phone's call history yet (the call is still on, or the phone writes it late):
      // the next return to the app looks again; saved now, the real length is added later
      if ((await phoneStatus()).callLog) { setLate(true); handled.current = false; } else clearPendingCall();
    }
  };
  const afterRef = useRef(afterCall);
  afterRef.current = afterCall;
  useEffect(() => listen(CapApp.addListener('resume', () => afterRef.current())), []);
  // (this does not wait for the record: a call made before Android closed the app is filled in even offline)
  useEffect(() => {
    // a call from the phone's call history ("Phone calls" → Log)
    const logged = params.get('from') === 'phone' ? get('log_call') : null;
    if (logged && logged.match && logged.match.module === module && Number(logged.match.id) === Number(id)) {
      ref.current = logged.ref;
      setCall(logged); setConnected(logged.connected); setPhase('after');
      return;
    }
    const p = pendingCall();
    if (p && p.module === module && p.id === Number(id) && (params.get('after') === '1' || Date.now() - p.at > 3000)) afterRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // (MCube, opened again to save the outcome of a call that has ended)
    if (row && viaIvr && params.get('after') === '1') { ivrEnded(null); return; }
    if (row && params.get('dial') === '1' && phase === 'ready' && (viaIvr || !pendingCall())) dial();
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveIvr = async () => {
    const isConnected = connected !== null ? connected : !!(ivrCall && ivrCall.connected);
    let followUpAt;
    if (follow) {
      const when = follow === 'pick' ? new Date(followAt) : quickTimes().find((q) => q.key === follow).when;
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) { setError('Pick a follow-up time in the future.'); return; }
      followUpAt = when.toISOString();
    }
    setBusy(true); setError('');
    const body = callBody({
      module, id, call: null, number: phone,
      outcome: { ref: `ivr-${ivr ? ivr.id : Date.now()}`, connected: isConnected, disposition: disposition || (isConnected ? 'Connected' : 'No answer'), notes: notes.trim() || undefined,
        lead_status: module === 'leads' && status && status !== row.status ? status : undefined, follow_up_at: followUpAt, source: 'mcube' },
    });
    body.telephony_session_id = ivr ? ivr.id : undefined;
    if (ivrCall && ivrCall.call_id) body.call_id = ivrCall.call_id;
    try {
      await POST('/calls/dispose', body);
      if (inSession) reportResult(module, id, { connected: isConnected, disposition: body.disposition });
      say('Call saved.', 'ok');
      nav(-1);
    } catch (e) {
      if (e.status === 409) { if (inSession) reportResult(module, id, { connected: isConnected, disposition: body.disposition }); say(e.message, 'info'); nav(-1); return; }
      setError(e.offline ? 'No internet: try again when online.' : e.message);
    } finally { setBusy(false); }
  };

  const save = () => {
    if (viaIvr && phase === 'after') { saveIvr(); return; }
    // (the outcome is not required — v1.3.2: a call saved by itself needs nothing more; the remark,
    // the lead's status or a follow-up can be saved alone)
    const statusChanged = module === 'leads' && status && row && status !== row.status;
    if (autoSaved && !disposition && connected === (call ? call.connected : null) && !notes.trim() && !statusChanged && !follow) {
      if (inSession) reportResult(module, id, { connected: !!(call && call.connected), disposition: '' });
      clearPendingCall(); say('Call saved.', 'ok'); nav(-1); return;
    }
    const isConnected = connected !== null ? connected : call ? call.connected : false;
    let followUpAt;
    if (follow) {
      const when = follow === 'pick' ? new Date(followAt) : quickTimes().find((q) => q.key === follow).when;
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) { setError('Pick a follow-up time in the future.'); return; }
      followUpAt = when.toISOString();
    }
    setBusy(true); setError('');
    if (!ref.current) ref.current = `ac-${Date.now()}`;
    const body = callBody({
      module, id, call, number: phone,
      outcome: {
        ref: ref.current, mode: 'update', connected: isConnected, disposition: disposition || undefined, notes: notes.trim() || undefined,
        lead_status: module === 'leads' && status && status !== row.status ? status : undefined,
        follow_up_at: followUpAt, duration_seconds: call ? undefined : guess || undefined,
      },
    });
    queueCall(body, `Call with ${name}`);
    if (inSession) reportResult(module, id, { connected: isConnected, disposition: body.disposition });
    if (ref.current.startsWith('ac-') && tapAt.current && digits10(phone)) linkLater({ ref: ref.current, digits: digits10(phone), at: tapAt.current, module, id: Number(id) });
    clearPendingCall();
    if (call && !autoSaved) attachRecording(call).catch(() => {});
    sync();
    say(online ? 'Call saved.' : 'Saved on the phone — sent when online.', 'ok');
    setBusy(false);
    nav(-1);
  };

  const quick = quickTimes();
  return (
    <div className="screen no-nav">
      <TopBar title={inSession ? 'Auto dialer · call' : 'Call'} sub={name} />
      <StatusBars />
      {!row ? (error ? <div className="body"><div className="note bad">{error}</div></div> : <Loading />) : (
        <div className="body">
          {phase !== 'after' && !(viaIvr && phase === 'calling') && phone && <button type="button" className="btn good big block" onClick={dial} data-testid="dial"><Phone /> Call {phone}</button>}
          {needLog && phase !== 'after' && <div className="note warn" data-testid="need-log">Allow “Call logs” for iCRM, so the app knows when the call started, how long it was and if it was answered.</div>}
          {phase === 'calling' && !viaIvr && <div className="note info" data-testid="calling">After the call, come back to iCRM: the call is filled in here.</div>}
          {phase === 'calling' && viaIvr && (
            <div className="card col" style={{ gap: 8 }} data-testid="ivr-calling">
              <div className="flex strong"><Loader2 size={18} className="spin" /> MCube is calling: your phone first, then {name}.</div>
              <div className="tiny muted">This screen goes on by itself when the call ends.</div>
              <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => ivrEnded(null)} data-testid="ivr-ended">The call has ended</button>
            </div>
          )}
          {phase === 'after' && viaIvr && (
            <div className="card col" style={{ gap: 4 }} data-testid="ivr-facts">
              {ivrCall ? <div className="strong flex" style={{ gap: 6 }}>{ivrCall.connected ? <CheckCircle2 size={18} color="var(--ok)" /> : <PhoneOff size={18} color="var(--bad)" />} {ivrCall.connected ? 'Answered' : 'Not answered'}{ivrCall.duration_seconds ? ` · ${talk(ivrCall.duration_seconds)}` : ''} <span className="tiny muted">(MCube)</span></div>
                : <div className="tiny muted">MCube has not sent the call's details yet. Save the outcome: they are added when they come.</div>}
            </div>
          )}

          {phase === 'after' && !viaIvr && (
            <div className="card col" style={{ gap: 6 }} data-testid="call-facts">
              {call ? (
                <>
                  <div className="strong" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{call.connected ? <CheckCircle2 size={18} color="var(--ok)" /> : <PhoneOff size={18} color="var(--bad)" />} {call.connected ? 'Answered' : 'Not answered'} · {talk(call.duration)}</div>
                  <div className="tiny muted"><Clock size={12} /> {niceTime(new Date(call.date).toISOString())} – {niceTime(new Date(call.end).toISOString())}</div>
                  {autoSaved && <div className="tiny" style={{ color: 'var(--ok)' }} data-testid="auto-saved">Saved by itself. Add the outcome below if you like.</div>}
                </>
              ) : (
                late ? <div className="tiny muted" data-testid="call-late">The call is not in the phone's call history yet. Save now: its real time and length are added by themselves later.</div>
                  : <div className="tiny muted" data-testid="call-guess">The phone's call history could not be read{guess ? `: about ${Math.max(1, Math.round(guess / 60))} min since you tapped Call` : ''}.</div>
              )}
              {call && call.connected && canReadPhone() && !recDone && (
                <button type="button" className="btn ghost" onClick={() => setPickRec(true)} data-testid="call-add-rec"><FileAudio size={18} /> Add recording</button>
              )}
              {recDone && <div className="tiny" style={{ color: 'var(--ok)' }}>The recording is being sent.</div>}
              {phone && <button type="button" className="btn ghost" onClick={() => whatsappAfter(phone, name)} data-testid="call-whatsapp"><MessageCircle size={18} /> WhatsApp {rules.whatsapp_text ? 'message' : ''}</button>}
            </div>
          )}

          <div className="card col" style={{ gap: 12 }}>
            <div className="card-title">How did it go? <span className="tiny faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(if you like)</span></div>
            <div className="chips">
              <button type="button" className={`chip${connected === true ? ' on' : ''}`} onClick={() => { setConnected(true); setDisposition(''); }} data-testid="call-connected">Spoke to them</button>
              <button type="button" className={`chip${connected === false ? ' on' : ''}`} onClick={() => { setConnected(false); setDisposition(''); }} data-testid="call-not">Did not connect</button>
            </div>
            {connected !== null && (
              <div className="chips" data-testid="call-dispositions">
                {(connected ? options.yes : options.no).map((o) => <button key={o} type="button" className={`chip${disposition === o ? ' on' : ''}`} onClick={() => setDisposition(o)}>{o}</button>)}
              </div>
            )}
            <Field label="Remark"><VoiceArea value={notes} onChange={setNotes} placeholder="Type, or tap the mic and speak" testid="call-notes" /></Field>
            {module === 'leads' && (
              <Field label="Lead status">
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="call-status">
                  {leadStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            )}
            <div className="card-title" style={{ marginTop: 4 }}>Follow-up</div>
            <div className="chips" data-testid="call-follow-picks">
              <button type="button" className={`chip${follow === '' ? ' on' : ''}`} onClick={() => setFollow('')}>None</button>
              {quick.map((q) => <button key={q.key} type="button" className={`chip${follow === q.key ? ' on' : ''}`} onClick={() => setFollow(q.key)} data-testid={`follow-${q.key}`}>{q.label}</button>)}
              <button type="button" className={`chip${follow === 'pick' ? ' on' : ''}`} onClick={() => setFollow('pick')} data-testid="call-follow">Pick</button>
            </div>
            {follow === 'pick' && <Field label="When"><input className="input" type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} data-testid="follow-at" /></Field>}
            {follow && follow !== 'pick' && <div className="tiny muted">{quick.find((q) => q.key === follow).when.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
          </div>
          {pickRec && call && (
            <RecordingPicker call={call} onClose={() => setPickRec(false)}
              onPick={(f) => {
                // (the call must reach the CRM first: saved now when it is not yet)
                if (!autoSaved) { queueCall(callBody({ module, id, call, number: phone }), `Call with ${name}`); setAutoSaved(true); }
                queueRecordingFile({ ref: call.ref, file: f, duration: call.duration }); setPickRec(false); setRecDone(true); sync();
              }} />
          )}
          {error && <div className="note bad" data-testid="call-error">{error}</div>}
          <button type="button" className="btn primary block big" onClick={save} disabled={busy} data-testid="call-save">{busy ? <Loader2 className="spin" /> : null} {autoSaved ? 'Save the outcome' : 'Save the call'}</button>
          {autoSaved && <button type="button" className="btn ghost block" onClick={() => { if (inSession) reportResult(module, id, { connected: !!(call && call.connected), disposition: '' }); nav(-1); }} data-testid="call-done">Done (the call is already saved)</button>}
        </div>
      )}
    </div>
  );
}
