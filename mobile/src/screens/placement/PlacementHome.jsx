/*
 * Placement desk (app): today's interviews (with a reminder 30 minutes before),
 * the follow-ups that are due, find a candidate, add one on the spot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, PhoneCall, Search, UserPlus, Video, MapPin, Phone, Check, RefreshCw, BellRing, Users } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { useApp, listen } from '../../lib/app';
import { GET, POST, qs } from '../../lib/api';
import { get, set } from '../../lib/store';
import { niceTime, niceDate, today, addDays } from '../../lib/format';
import { P, meta, startPlCall, pendingPlCall, refreshReminders } from '../../lib/placement';
import { TopBar, BottomNav, Loading, Empty, Avatar, StatusBars } from '../../components/ui';
import { CallOutcome, InterviewResult } from '../../components/placement/Sheets';

const ICON = { Video, Phone, 'In person': MapPin };
const RES_TAG = { Scheduled: 'info', Cleared: 'ok', Rejected: 'bad', 'No show': 'bad', 'On hold': '' };
const meId = () => { const m = get('me'); return m ? m.id : 0; };
const whoNow = () => (get('pl_who') === 'all' ? 'all' : 'mine');

export default function PlacementHome() {
  const { say } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState('today');           // today / tomorrow / feedback
  const [who, setWho] = useState(whoNow);                  // mine / all (the whole team)
  const [ivs, setIvs] = useState(null);
  const [counts, setCounts] = useState({ today: 0, tomorrow: 0, feedback: 0 });
  const [fups, setFups] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [result, setResult] = useState(null);             // an interview whose result is being written
  const [outcome, setOutcome] = useState(null);           // a call waiting for its outcome
  const shown = useRef(false);

  const load = useCallback(async () => {
    setError('');
    const mine = whoNow() === 'mine' ? meId() : '';
    try {
      const [t, tm, fb, wk, fu] = await Promise.all([
        GET(P(`/interviews${qs({ range: 'today', owner: mine })}`)),
        GET(P(`/interviews${qs({ range: 'tomorrow', owner: mine })}`)),
        GET(P(`/interviews${qs({ pending: 1, owner: mine })}`)),
        // (the phone's reminders are always for MY interviews)
        GET(P(`/interviews${qs({ range: 'week', owner: meId() })}`)),
        GET(P(`/candidates/follow-ups${mine ? '?mine=1' : ''}`)),
      ]);
      setCounts({ today: t.length, tomorrow: tm.length, feedback: fb.length });
      setIvs({ today: t, tomorrow: tm, feedback: fb });
      setFups(fu);
      refreshReminders(wk);
    } catch (e) { setError(e.offline ? 'No internet: the list shows when you are online.' : e.message); }
  }, []);
  const choose = (v) => { set('pl_who', v); setWho(v); setIvs(null); setFups(null); load(); };
  useEffect(() => { meta(); load(); }, [load]);
  useEffect(() => listen(CapApp.addListener('resume', () => { load(); })), [load]);

  // back from a call: how did it go?
  useEffect(() => {
    if (shown.current) return;
    const p = pendingPlCall();
    if (p && !p.shown) { shown.current = true; setOutcome(p); }
  }, []);
  useEffect(() => listen(CapApp.addListener('resume', () => { const p = pendingPlCall(); if (p) setOutcome(p); })), []);

  // find a candidate
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound(null); return undefined; }
    const t = setTimeout(() => { GET(P(`/candidates${qs({ q: term, limit: 20 })}`)).then((r) => setFound(r.rows)).catch(() => setFound([])); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = ivs ? ivs[range] : null;
  const call = (c, name, mobile, id) => { startPlCall({ id, name, number: mobile }); };
  const done = async (f) => {
    try { await POST(P(`/contacts/${f.id}/done`), {}); say('Done.', 'ok'); load(); } catch (e) { say(e.message, 'error'); }
  };

  return (
    <div className="screen" data-testid="pl-home">
      <TopBar title="Placement" back={false} right={<><button type="button" className="icon-btn" aria-label="Refresh" onClick={load}><RefreshCw size={20} /></button><Link to="/placement/new" className="icon-btn" aria-label="Add a candidate" data-testid="pl-add"><UserPlus size={22} /></Link></>} />
      <StatusBars />
      <div className="body">
        <div className="field" style={{ position: 'relative' }}>
          <Search size={18} className="faint" style={{ position: 'absolute', left: 12, top: 14 }} />
          <input className="input" style={{ paddingLeft: 38 }} placeholder="Find a candidate: name, mobile, skill" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a candidate" data-testid="pl-search" />
        </div>

        <div className="seg two-tabs" role="tablist" data-testid="pl-who">
          <button type="button" role="tab" aria-selected={who === 'mine'} className={`seg-b${who === 'mine' ? ' on' : ''}`} onClick={() => choose('mine')} data-testid="pl-who-mine">My work</button>
          <button type="button" role="tab" aria-selected={who === 'all'} className={`seg-b${who === 'all' ? ' on' : ''}`} onClick={() => choose('all')} data-testid="pl-who-all">Everyone</button>
        </div>

        {found ? (
          <div className="list" data-testid="pl-found">
            {found.map((c) => (
              <Link key={c.id} to={`/placement/c/${c.id}`} className="row" style={{ color: 'inherit' }} data-testid={`found-${c.id}`}>
                <Avatar name={c.name} />
                <div className="main"><div className="title">{c.name}</div><div className="line">{[c.designation, c.current_company].filter(Boolean).join(' · ') || c.mobile}</div></div>
                <span className="tag">{c.status}</span>
              </Link>
            ))}
            {!found.length && <Empty title="No one found">Try fewer letters, or add the person.</Empty>}
          </div>
        ) : (
          <>
            <div className="tiles" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <button type="button" className="tile" onClick={() => setRange('today')} data-testid="pl-tile-today"><span className="ic" style={{ background: '#EEF2FF', color: '#4F46E5' }}><CalendarClock size={20} /></span>{counts.today} today</button>
              <button type="button" className="tile" onClick={() => setRange('feedback')} data-testid="pl-tile-feedback"><span className="ic" style={{ background: '#FFF7ED', color: '#EA580C' }}><Check size={20} /></span>{counts.feedback} need result</button>
              <Link to="/placement/new" className="tile" style={{ color: 'inherit' }}><span className="ic" style={{ background: '#ECFDF5', color: '#16A34A' }}><UserPlus size={20} /></span>Add candidate</Link>
            </div>

            <div className="card col" style={{ gap: 10 }}>
              <div className="card-title"><CalendarClock size={15} /> Interviews</div>
              <div className="chips">
                {[['today', `Today ${counts.today}`], ['tomorrow', `Tomorrow ${counts.tomorrow}`], ['feedback', `Need result ${counts.feedback}`]].map(([k, l]) => (
                  <button key={k} type="button" className={`chip${range === k ? ' on' : ''}`} onClick={() => setRange(k)} data-testid={`pl-range-${k}`}>{l}</button>
                ))}
              </div>
              {error && <div className="note warn small">{error}</div>}
              {!list && !error ? <Loading /> : list && !list.length ? (
                <div className="small muted" style={{ padding: '8px 2px' }}>{range === 'feedback' ? 'No interview is waiting for a result.' : range === 'today' ? 'No interview today.' : 'No interview tomorrow.'}</div>
              ) : (
                <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line-soft)' }} data-testid="pl-iv-list">
                  {(list || []).map((i) => {
                    const Icon = ICON[i.mode] || Video;
                    return (
                      <div key={i.id} className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }} data-testid={`pl-iv-${i.id}`}>
                        <div style={{ width: 52 }} className="strong small">{niceTime(i.scheduled_at.replace(' ', 'T'))}<div className="tiny muted">{range === 'feedback' ? niceDate(i.scheduled_at.slice(0, 10)) : `${i.duration_min} min`}</div></div>
                        <Link to={`/placement/c/${i.candidate_id}`} className="main" style={{ color: 'inherit' }}>
                          <div className="title">{i.candidate_name} <span className="tag info" style={{ marginLeft: 4 }}>{i.round}</span></div>
                          <div className="line">{i.job_title} · {i.client_name}</div>
                          <div className="line"><Icon size={12} style={{ verticalAlign: -1 }} /> {i.mode}{i.panel ? ` · ${i.panel}` : ''}</div>
                        </Link>
                        <div className="flex" style={{ gap: 6, flexBasis: '100%', justifyContent: 'flex-end' }}>
                          {i.mobile && i.result === 'Scheduled' && <button type="button" className="btn small outline" onClick={() => call(null, i.candidate_name, i.mobile, i.candidate_id)} data-testid={`pl-iv-call-${i.id}`}><PhoneCall size={15} /> Call</button>}
                          {i.result === 'Scheduled'
                            ? <button type="button" className="btn small primary" onClick={() => setResult(i)} data-testid={`pl-iv-result-${i.id}`}>Result</button>
                            : <span className={`tag ${RES_TAG[i.result] || ''}`}>{i.result}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card col" style={{ gap: 10 }}>
              <div className="card-title"><BellRing size={15} /> Follow-ups due {fups ? `(${fups.length})` : ''}</div>
              {!fups ? <Loading /> : !fups.length ? <div className="small muted">Nothing is due. Well done.</div> : (
                <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line-soft)' }} data-testid="pl-fu-list">
                  {fups.slice(0, 15).map((f) => (
                    <div key={f.id} className="row" data-testid={`pl-fu-${f.id}`}>
                      <Link to={`/placement/c/${f.candidate_id}`} className="main" style={{ color: 'inherit' }}>
                        <div className="title">{f.name}</div>
                        <div className="line">{f.next_follow_up.slice(0, 10) < today() ? 'Overdue · ' : ''}{niceDate(f.next_follow_up.slice(0, 10))}{f.next_follow_up.length > 10 ? ` ${niceTime(f.next_follow_up.replace(' ', 'T'))}` : ''} · {f.outcome || 'call'}</div>
                      </Link>
                      {f.mobile && <button type="button" className="icon-btn" aria-label={`Call ${f.name}`} onClick={() => call(null, f.name, f.mobile, f.candidate_id)}><PhoneCall size={20} color="var(--ok)" /></button>}
                      <button type="button" className="icon-btn" aria-label="Done" onClick={() => done(f)}><Check size={20} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Link to="/placement/people" className="card flex" style={{ color: 'inherit', alignItems: 'center' }} data-testid="pl-all"><Users size={20} color="var(--brand)" /><div className="grow"><div className="strong">All candidates</div><div className="tiny muted">Search and open anyone in the database</div></div></Link>
          </>
        )}
      </div>
      <BottomNav />
      {result && <InterviewResult iv={result} onClose={() => setResult(null)} onSaved={() => { setResult(null); load(); }} />}
      {outcome && <CallOutcome person={{ id: outcome.id, name: outcome.name }} onClose={() => setOutcome(null)} onSaved={() => { setOutcome(null); load(); }} />}
    </div>
  );
}
