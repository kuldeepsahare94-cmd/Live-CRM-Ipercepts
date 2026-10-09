/*
 * Call a customer and log it: tap to dial (the phone's own dialer), come back,
 * say how it went — the call is saved on the customer, with a follow-up if one is needed.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Phone, Loader2 } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { useApp, listen } from '../lib/app';
import { GET, POST } from '../lib/api';
import { titleOf, phoneOf } from '../lib/records';
import { openOutside } from '../lib/location';
import { phoneFor, addDays, today } from '../lib/format';
import { TopBar, Loading, Field, StatusBars } from '../components/ui';

const FALLBACK = { yes: ['Interested', 'Call back later', 'Not interested', 'Already purchased'], no: ['No answer', 'Busy', 'Switched off', 'Wrong number'] };

export default function CallLog() {
  const { module, id } = useParams();
  const [params] = useSearchParams();
  const { say } = useApp();
  const nav = useNavigate();
  const [row, setRow] = useState(null);
  const [options, setOptions] = useState({ yes: FALLBACK.yes, no: FALLBACK.no });
  const [connected, setConnected] = useState(null);
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [follow, setFollow] = useState('');
  const [followAt, setFollowAt] = useState(`${addDays(today(), 1)}T11:00`);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(null);

  useEffect(() => {
    GET(`/${module}/${id}`).then(setRow).catch((e) => setError(e.message));
    const opt = (key) => GET(`/option-lists/shared/${key}/options`).then((l) => (Array.isArray(l) ? l.filter((o) => o.active !== false).map((o) => o.label || o.value) : null)).catch(() => null);
    Promise.all([opt('call_disposition_connected'), opt('call_disposition_not_connected')]).then(([y, n]) => setOptions({ yes: y && y.length ? y : FALLBACK.yes, no: n && n.length ? n : FALLBACK.no }));
  }, [module, id]);

  const phone = phoneOf(row);
  const dial = () => {
    if (!phone) return;
    started.current = Date.now();
    openOutside(`tel:${phoneFor(phone)}`);
  };
  // back from the dialer: how long it was (about)
  useEffect(() => listen(CapApp.addListener('resume', () => { if (started.current) setSeconds(Math.round((Date.now() - started.current) / 1000)); })), []);
  useEffect(() => { if (row && params.get('dial') === '1' && !started.current) dial(); }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (connected === null || !disposition) { setError('Say if the call connected, and how it went.'); return; }
    setBusy(true); setError('');
    try {
      await POST('/calls/dispose', {
        connected, disposition, related_module: module, related_record_id: Number(id), phone_number: phone || undefined,
        duration_seconds: seconds || undefined, notes: notes || undefined, direction: 'Outbound',
        ...(follow === 'yes' ? { next_action: 'schedule', follow_up_at: new Date(followAt).toISOString(), follow_up_notes: notes || undefined } : {}),
      });
      say('Call saved.', 'ok');
      nav(-1);
    } catch (e) { setError(e.offline ? 'No internet: try again when online.' : e.message); } finally { setBusy(false); }
  };

  return (
    <div className="screen no-nav">
      <TopBar title="Call" sub={row ? titleOf(module, row) : ''} />
      <StatusBars />
      {!row ? (error ? <div className="body"><div className="note bad">{error}</div></div> : <Loading />) : (
        <div className="body">
          {phone && <button type="button" className="btn good big block" onClick={dial} data-testid="dial"><Phone /> Call {phone}</button>}
          <div className="card col" style={{ gap: 12 }}>
            <div className="card-title">How did it go?</div>
            <div className="chips">
              <button type="button" className={`chip${connected === true ? ' on' : ''}`} onClick={() => { setConnected(true); setDisposition(''); }} data-testid="call-connected">Spoke to them</button>
              <button type="button" className={`chip${connected === false ? ' on' : ''}`} onClick={() => { setConnected(false); setDisposition(''); }} data-testid="call-not">Did not connect</button>
            </div>
            {connected !== null && (
              <div className="chips" data-testid="call-dispositions">
                {(connected ? options.yes : options.no).map((o) => <button key={o} type="button" className={`chip${disposition === o ? ' on' : ''}`} onClick={() => setDisposition(o)}>{o}</button>)}
              </div>
            )}
            <Field label="Notes"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="call-notes" /></Field>
            <div className="chips">
              <button type="button" className={`chip${follow === '' ? ' on' : ''}`} onClick={() => setFollow('')}>No follow-up</button>
              <button type="button" className={`chip${follow === 'yes' ? ' on' : ''}`} onClick={() => setFollow('yes')} data-testid="call-follow">Follow up</button>
            </div>
            {follow === 'yes' && <Field label="When"><input className="input" type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} /></Field>}
            {seconds > 0 && <div className="tiny muted">The call took about {Math.max(1, Math.round(seconds / 60))} min.</div>}
          </div>
          {error && <div className="note bad" data-testid="call-error">{error}</div>}
          <button type="button" className="btn primary block big" onClick={save} disabled={busy} data-testid="call-save">{busy ? <Loader2 className="spin" /> : null} Save the call</button>
        </div>
      )}
    </div>
  );
}
