/*
 * The Auto Dialer (v1.5) — see lib/dialer.js.
 *   /dialer       choose who to call (follow-ups or leads), my / team view, the
 *                 wait between calls, how to call; see the list; Confirm & Start
 *   /dialer/run   the session: "4 of 30", the person, Pause / Skip / Stop, the
 *                 next call counting down only after the last one was saved;
 *                 at the end, the summary
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PhoneForwarded, Play, Pause, SkipForward, Square, ListChecks, ArrowLeft, Loader2, Phone, CheckCircle2, PhoneOff, Info, AlertTriangle, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { GET } from '../lib/api';
import { useApp } from '../lib/app';
import { get, set as keep } from '../lib/store';
import {
  SOURCES, MAX, buildQueue, startSession, session as getSession, current, counts, markCalling, advance, pause, resume, stop, clearSession,
} from '../lib/dialer';
import { TopBar, BottomNav, Loading, Empty, Avatar, StatusBars } from '../components/ui';
import ViewingPicker, { useViewingOptions } from '../components/Viewing';
import { useFilterSpec, FilterSheet, FilterChips, EMPTY, countOf, asParam } from '../components/ListFilters';

const DELAYS = [3, 5, 10];
const label = (k) => (SOURCES.find(([x]) => x === k) || [k, k])[1];

/** is this person an MCube agent (the CRM can call through MCube for them)? */
function useIvr() {
  const [ivr, setIvr] = useState(null);
  useEffect(() => { GET('/telephony/status').then((s) => setIvr(!!(s && s.can_call))).catch(() => setIvr(false)); }, []);
  return ivr;
}

export default function DialerSetup() {
  const { boot } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const ivrOk = useIvr();
  const opts = useViewingOptions(!!(boot.me && boot.me.view_others));
  const kept = get('dial_setup') || {};
  const [source, setSource] = useState(params.get('source') || kept.source || 'fu-today');
  const [view, setView] = useState(params.get('view') || kept.view || 'me');
  const [delay, setDelay] = useState(kept.delay || 5);
  const [via, setVia] = useState(kept.via || '');
  const [filters, setFilters] = useState(kept.filters || EMPTY);
  const [sheet, setSheet] = useState(false);
  const [step, setStep] = useState('setup');
  const [queue, setQueue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const spec = useFilterSpec('leads');
  const old = getSession();
  const going = old && (old.state === 'active' || old.state === 'paused');
  const how = via || (ivrOk ? 'ivr' : 'phone');
  const team = view !== 'me';
  const fParam = asParam(filters);

  // how many there are, each time the choice changes
  const ask = useRef(0);
  useEffect(() => {
    const mine = ++ask.current;
    setQueue(null); setError('');
    buildQueue({ source, view, filters: fParam, via: how })
      .then((q) => { if (mine === ask.current) setQueue(q); })
      .catch((e) => { if (mine === ask.current) setError(e.offline ? 'No internet: the list needs the internet.' : e.message); });
  }, [source, view, fParam, how]);
  const remember = () => keep('dial_setup', { source, view, delay, via, filters });

  const start = () => {
    if (!queue || !queue.items.length) return;
    if (going && !window.confirm('A calling session is still open. End it and start this one?')) return;
    setBusy(true);
    remember();
    startSession({ items: queue.items, source, sourceLabel: `${label(source)}${source === 'leads' && countOf(filters) ? ' (filtered)' : ''}`, view, delay, via: how });
    nav('/dialer/run?go=1', { replace: true });
  };

  if (step === 'preview') {
    return (
      <div className="screen no-nav">
        <TopBar title="Queue preview" sub="Check the list before calling" onBack={() => setStep('setup')} />
        <StatusBars />
        <div className="body">
          <div className="card col dial-summary" data-testid="dial-summary">
            <div className="strong">{queue.items.length} {queue.items.length === 1 ? 'person' : 'people'} · {label(source)}</div>
            <div className="tiny muted">{team ? 'Team view' : 'My view'} · {delay} sec between calls · {how === 'ivr' ? 'through MCube' : "through this phone's dialer"}</div>
          </div>
          <div className="col" style={{ gap: 8 }} data-testid="dial-queue">
            {queue.items.map((it, i) => (
              <div key={it.key} className="card flex dial-row" data-testid="dial-queue-row">
                <span className="dial-n">{i + 1}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong ellipsis">{it.name}</div>
                  <div className="tiny muted ellipsis">{[it.sub, it.due].filter(Boolean).join(' · ')}</div>
                </div>
                {it.rating && <span className="tag">{it.rating}</span>}
              </div>
            ))}
          </div>
          {queue.left.length > 0 && (
            <details className="card" data-testid="dial-left">
              <summary className="small strong">{queue.left.length} left out (why)</summary>
              <div className="col" style={{ gap: 4, marginTop: 8 }}>
                {queue.left.map((x, i) => <div key={`${x.key || x.id}-${i}`} className="tiny"><b>{x.name}</b> — {x.reason}</div>)}
              </div>
            </details>
          )}
          <div className="btns">
            <button type="button" className="btn outline" onClick={() => setStep('setup')} data-testid="dial-back"><ArrowLeft size={18} /> Back</button>
            <button type="button" className="btn primary" onClick={start} disabled={busy} data-testid="dial-start"><Play size={18} /> Confirm & start</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title="Auto dialer" sub="Call a list, one by one" back={false} />
      <StatusBars />
      <div className="body">
        {going && (
          <Link to="/dialer/run" className="card flex note info" style={{ alignItems: 'center' }} data-testid="dial-continue">
            <PhoneForwarded size={20} />
            <div className="grow"><div className="strong">A session is {old.state === 'paused' ? 'paused' : 'on'}</div><div className="tiny">{counts(old).processed} of {old.items.length} · {old.source_label}</div></div>
            <span className="btn small primary">Open</span>
          </Link>
        )}
        <div className="card col" style={{ gap: 12 }}>
          <span className="tag bad" style={{ alignSelf: 'flex-start' }}>Off until you start it</span>
          {boot.me.view_others && (
            <div className="col" style={{ gap: 6 }}>
              <div className="card-title" style={{ margin: 0 }}>View</div>
              <div className="flex wrap" style={{ gap: 8 }}>
                <div className="seg two-tabs" style={{ flex: 1 }}>
                  <button type="button" className={`seg-b${!team ? ' on' : ''}`} onClick={() => setView('me')} data-testid="dial-my">My view</button>
                  <button type="button" className={`seg-b${team ? ' on' : ''}`} onClick={() => setView('all')} data-testid="dial-team">Team view</button>
                </div>
                {team && <ViewingPicker value={view} onChange={setView} opts={opts} allowMe={false} allLabel="My whole team" testid="dial-view" />}
              </div>
            </div>
          )}
          <div className="col" style={{ gap: 6 }}>
            <div className="card-title" style={{ margin: 0 }}>Call</div>
            <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
              {SOURCES.map(([k, l]) => (
                <button key={k} type="button" className="row" onClick={() => setSource(k)} data-testid={`dial-src-${k}`}>
                  <span className={`radio${source === k ? ' on' : ''}`} aria-hidden="true" /><div className="main"><div className="title">{l}</div></div>
                </button>
              ))}
            </div>
            {source === 'leads' && (
              <>
                <button type="button" className="btn outline small" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet(true)} data-testid="dial-filters"><SlidersHorizontal size={15} /> Which leads{countOf(filters) ? ` · ${countOf(filters)}` : ' (all)'}</button>
                <FilterChips value={filters} spec={spec} onChange={setFilters} />
              </>
            )}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="card-title" style={{ margin: 0 }}>Wait between calls</div>
            <div className="chips">{DELAYS.map((d) => <button key={d} type="button" className={`chip${delay === d ? ' on' : ''}`} onClick={() => setDelay(d)} data-testid={`dial-delay-${d}`}>{d} sec</button>)}</div>
            <div className="tiny muted">The wait starts only after the last call's outcome is saved.</div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="card-title" style={{ margin: 0 }}>Calls go through</div>
            {ivrOk === null ? <Loader2 size={16} className="spin" /> : (
              <div className="chips">
                {ivrOk && <button type="button" className={`chip${how === 'ivr' ? ' on' : ''}`} onClick={() => setVia('ivr')} data-testid="dial-via-ivr">MCube</button>}
                <button type="button" className={`chip${how === 'phone' ? ' on' : ''}`} onClick={() => setVia('phone')} data-testid="dial-via-phone">This phone's dialer</button>
              </div>
            )}
            <div className="tiny muted flex" style={{ alignItems: 'flex-start', gap: 6 }}>
              <Info size={14} style={{ flex: 'none', marginTop: 1 }} />
              {how === 'ivr'
                ? <span>MCube rings your phone first, then the customer. It tells the CRM when the call ended and how long it was.</span>
                : <span>The dialer opens with the number — tap the green call button (Android lets an app only open the dialer). Come back to iCRM after the call.</span>}
            </div>
          </div>
        </div>
        {error && <div className="note warn small">{error}</div>}
        <div className="card flex" style={{ alignItems: 'center' }} data-testid="dial-count">
          <ListChecks size={20} color="var(--brand)" />
          <div className="grow">
            {!queue ? <span className="small muted">Counting…</span> : <><div className="strong">{queue.items.length} to call</div>{queue.left.length > 0 && <div className="tiny muted">{queue.left.length} left out (no number, same number…)</div>}</>}
            {queue && queue.items.length >= MAX && <div className="tiny warn-text">At most {MAX} in one session.</div>}
          </div>
        </div>
        <button type="button" className="btn primary block big" disabled={!queue || !queue.items.length || busy} onClick={() => { remember(); setStep('preview'); }} data-testid="dial-preview">See the list, then start</button>
        {queue && !queue.items.length && <div className="small muted center">Nobody to call here. Choose another list.</div>}
        {sheet && <FilterSheet spec={spec} value={filters} onClose={() => setSheet(false)} onApply={(f) => { setFilters(f); setSheet(false); }} />}
      </div>
      <BottomNav />
    </div>
  );
}

export function DialerRun() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [s, setS] = useState(() => getSession());
  const [left, setLeft] = useState(0);
  const refresh = useCallback(() => setS(getSession()), []);
  const it = current(s);

  const call = useCallback(() => {
    const now = getSession();
    const c = current(now);
    // (once: never a second call while one is open)
    if (!c || now.state !== 'active' || c.state !== 'pending') return;
    markCalling();
    nav(`/call/${c.module}/${c.id}?dial=1&session=${now.id}${now.via === 'ivr' ? '&via=ivr' : ''}`);
  }, [nav]);

  // back from the call screen: saved → the next one counts down; not saved → ask
  useEffect(() => {
    const now = getSession();
    if (!now) return;
    const c = current(now);
    if (now.state === 'active' && c && c.state === 'calling' && c.result) { advance('done'); refresh(); return; }
    // the first call starts at once (the person pressed Start)
    if (params.get('go') === '1' && now.state === 'active' && c && c.state === 'pending' && !now.next_at) { call(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the countdown to the next call
  useEffect(() => {
    if (!s || s.state !== 'active' || !s.next_at) { setLeft(0); return undefined; }
    let t = null;
    const tick = () => {
      const ms = s.next_at - Date.now();
      if (ms <= 0) { clearInterval(t); setLeft(0); call(); return; }
      setLeft(Math.ceil(ms / 1000));
    };
    t = setInterval(tick, 250);
    tick();
    return () => clearInterval(t);
  }, [s, call]);

  if (!s) return <div className="screen"><TopBar title="Auto dialer" /><Empty icon={PhoneForwarded} title="No calling session"><Link to="/dialer" className="btn primary small">Start one</Link></Empty><BottomNav /></div>;
  const n = counts(s);

  if (s.state === 'done' || s.state === 'stopped') {
    return (
      <div className="screen">
        <TopBar title="Session summary" sub={s.source_label} onBack={() => nav('/')} />
        <div className="body">
          <div className="card col center" style={{ gap: 6 }} data-testid="dial-done">
            <CheckCircle2 size={44} color="var(--ok)" />
            <div className="strong" style={{ fontSize: 18 }}>{s.state === 'done' ? 'Session completed' : 'Session stopped'}</div>
            <div className="small muted">{n.processed} of {n.total} done</div>
          </div>
          <div className="dial-figs" data-testid="dial-figs">
            <div className="card"><b>{n.done}</b><span>Calls saved</span></div>
            <div className="card ok"><b>{n.connected}</b><span>Spoke to them</span></div>
            <div className="card warn"><b>{n.not_connected}</b><span>Not connected</span></div>
            <div className="card"><b>{n.skipped}</b><span>Skipped</span></div>
            {n.pending > 0 && <div className="card"><b>{n.pending}</b><span>Not called</span></div>}
          </div>
          <div className="tiny muted center">From the calls saved in this session.</div>
          <div className="btns">
            <Link to="/m/calls" className="btn outline" data-testid="dial-calls">See the calls</Link>
            <button type="button" className="btn primary" onClick={() => { clearSession(); nav('/dialer', { replace: true }); }} data-testid="dial-new">New session</button>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const unsaved = it && it.state === 'calling' && !it.result;
  const paused = s.state === 'paused';
  const doSkip = () => { advance('skip'); refresh(); };
  const doStop = () => { if (window.confirm('Stop the session? The ones not called stay in your follow-ups.')) { stop(); refresh(); } };
  return (
    <div className="screen">
      <TopBar title="Auto dialer" sub={paused ? 'Paused' : 'Calling session'} onBack={() => nav('/')} />
      <StatusBars />
      <div className="body">
        <span className={`tag ${paused ? 'warn' : 'ok'}`} style={{ alignSelf: 'flex-start' }} data-testid="dial-state">{paused ? 'Session paused' : 'Calling in progress'}</span>
        <div className="strong" style={{ fontSize: 20 }} data-testid="dial-pos">{Math.min(n.processed + 1, n.total)} of {n.total}</div>
        <div className="bar"><span style={{ width: `${Math.round((n.processed / Math.max(1, n.total)) * 100)}%` }} /></div>
        {it && (
          <div className="card col center dial-card" data-testid="dial-current">
            <Avatar name={it.name} big />
            <div className="strong" style={{ fontSize: 18 }}>{it.name}</div>
            {it.sub && <div className="small muted">{it.sub}</div>}
            <div className="brand-text">{it.phone}</div>
            {it.due && <div className="tiny muted">Follow-up: {it.due}</div>}
          </div>
        )}
        {unsaved ? (
          <div className="card col" style={{ gap: 8 }} data-testid="dial-unsaved">
            <div className="flex strong"><AlertTriangle size={18} color="var(--warn)" /> The call's outcome is not saved yet</div>
            <div className="tiny muted">The next call waits until it is saved — or skip it.</div>
            <div className="btns">
              <button type="button" className="btn primary" onClick={() => nav(`/call/${it.module}/${it.id}?after=1&session=${s.id}${s.via === 'ivr' ? '&via=ivr' : ''}`)} data-testid="dial-save-call">Save the call</button>
              <button type="button" className="btn outline" onClick={doSkip} data-testid="dial-skip-unsaved"><SkipForward size={16} /> Skip</button>
            </div>
          </div>
        ) : paused ? (
          <div className="card col" style={{ gap: 6 }} data-testid="dial-paused">
            <div className="strong">No call starts until you resume.</div>
            <div className="tiny muted">{n.pending} left · the list and its order are kept.</div>
          </div>
        ) : left > 0 ? (
          <div className="card col center" data-testid="dial-countdown"><div className="strong" style={{ fontSize: 28 }}>{left}</div><div className="tiny muted">Next call in {left} s</div></div>
        ) : it && it.state === 'pending' ? (
          <button type="button" className="btn good big block" onClick={call} data-testid="dial-call-now"><Phone /> Call now</button>
        ) : null}
        <div className="btns">
          {paused
            ? <button type="button" className="btn primary" onClick={() => { resume(); refresh(); }} data-testid="dial-resume"><Play size={18} /> Resume</button>
            : <button type="button" className="btn outline" onClick={() => { pause(); refresh(); }} data-testid="dial-pause"><Pause size={18} /> Pause</button>}
          {!unsaved && <button type="button" className="btn outline" onClick={doSkip} data-testid="dial-skip"><SkipForward size={18} /> Skip</button>}
          <button type="button" className="btn outline bad-text" onClick={doStop} data-testid="dial-stop"><Square size={16} /> Stop</button>
        </div>
        <div className="tiny muted center">{n.done} saved · {n.skipped} skipped · {n.pending} left · {s.delay} sec between calls</div>
        <details className="card">
          <summary className="small strong">The list</summary>
          <div className="col" style={{ gap: 4, marginTop: 8 }}>
            {s.items.map((x, i) => (
              <div key={x.key} className="flex tiny" style={{ gap: 6 }}>
                <span className="dial-n sm">{i + 1}</span><span className="grow ellipsis">{x.name}</span>
                {x.state === 'done' ? (x.result && x.result.connected ? <CheckCircle2 size={14} color="var(--ok)" /> : <PhoneOff size={14} color="var(--warn)" />) : x.state === 'skipped' ? <span className="faint">skipped</span> : i === s.pos ? <span className="brand-text">now</span> : null}
              </div>
            ))}
          </div>
        </details>
        <button type="button" className="btn ghost small" style={{ alignSelf: 'center' }} onClick={() => nav('/dialer')}><RotateCcw size={14} /> Back to the setup</button>
      </div>
      <BottomNav />
    </div>
  );
}
