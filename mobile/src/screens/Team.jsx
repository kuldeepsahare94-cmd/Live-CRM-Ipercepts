/*
 * For a manager (v1.4): two dashboards.
 *   Team — the team's follow-ups (overdue, today, this week, chosen dates; how
 *          many each person has), and with Field force on: where the team is
 *          now and each person's day. "Whose": the whole team, a team, a role,
 *          one person.
 *   Me   — my own follow-ups, calls and day.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, BatteryLow, CheckCheck, PhoneCall, MapPin, Route } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GET } from '../lib/api';
import { useApp } from '../lib/app';
import { get, set } from '../lib/store';
import { km, talk } from '../lib/format';
import { TopBar, BottomNav, Loading, Empty, Avatar, StatusBars } from '../components/ui';
import MapView from '../components/MapView';
import DayRoute from '../components/DayRoute';
import FollowUps from '../components/FollowUps';
import ViewingPicker, { useViewingOptions } from '../components/Viewing';

const STATE = { working: ['Working', '#16A34A'], visiting: ['At a customer', '#2563EB'], no_signal: ['No signal', '#D97706'], done: ['Day over', '#64748B'], leave: ['On leave', '#DB2777'], absent: ['Not in', '#CBD5E1'] };
const ago = (m) => (m === null || m === undefined ? '' : m < 1 ? 'now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`);

/** the people a "whose" choice means (for the map and the list) */
function idsOf(view, opts) {
  if (!opts || !view || view === 'all') return null;
  const [k, id] = view.split(':'); const n = Number(id);
  if (k === 'user') return [n];
  if (k === 'team') { const t = opts.teams.find((x) => x.id === n); return t && t.members ? t.members : []; }
  if (k === 'role') return opts.people.filter((p) => p.role_id === n).map((p) => p.id);
  return null;
}

function MyDashboard() {
  const { boot, day } = useApp();
  const [calls, setCalls] = useState(null);
  useEffect(() => { if (boot.calls && boot.calls.enabled) GET('/sfa/calls/today').then(setCalls).catch(() => {}); }, [boot]);
  const s = day && day.session;
  return (
    <>
      <div className="figures" data-testid="me-figures">
        {calls && <div className="card figure"><b>{calls.calls}</b><span><PhoneCall size={12} /> calls today · {talk(calls.seconds)}</span></div>}
        {boot.sfa.enabled && <div className="card figure"><b>{day && day.visits ? day.visits.length : 0}</b><span><MapPin size={12} /> visits today</span></div>}
        {boot.sfa.enabled && <div className="card figure"><b>{km(day ? day.km_today : 0)}</b><span>{s ? 'on duty' : 'travelled today'}</span></div>}
      </div>
      <FollowUps view="me" title="My follow-ups" foldKey="fold_team_me" testid="me-followups" />
      {boot.sfa.enabled && s && <Link to="/day" className="btn outline block"><Route size={18} /> My route today</Link>}
    </>
  );
}

export default function Team() {
  const { boot } = useApp();
  const sfa = boot.sfa && boot.sfa.enabled && boot.me.is_manager;
  const opts = useViewingOptions();
  const [tab, setTabState] = useState(() => get('team_tab') || 'team');
  const setTab = (t) => { setTabState(t); set('team_tab', t); };
  const [view, setView] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [person, setPerson] = useState(null);
  const load = useCallback(() => {
    if (!sfa) return;
    GET('/sfa/live').then((x) => { setData(x); setError(''); }).catch((e) => setError(e.message));
  }, [sfa]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const ids = idsOf(view, opts);
  const people = useMemo(() => (data ? data.people : []).filter((p) => !ids || ids.includes(Number(p.id))), [data, ids]);
  const pins = useMemo(() => people.filter((p) => p.lat !== null && p.state !== 'absent' && p.state !== 'leave').map((p) => ({
    id: p.id, lat: p.lat, lng: p.lng, color: STATE[p.state][1], text: p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), title: p.name, sub: `${STATE[p.state][0]}${p.visit ? ` · ${p.visit.name}` : ''}${p.minutes_ago !== null && p.minutes_ago !== undefined ? ` · ${ago(p.minutes_ago)}` : ''}`, openText: 'Their day', onClick: () => setPerson(p),
  })), [people]);
  if (person) {
    return (
      <div className="screen">
        <TopBar title={person.name} sub="Their day" onBack={() => setPerson(null)} />
        <div className="body"><DayRoute userId={person.id} /></div>
        <BottomNav />
      </div>
    );
  }
  const counts = people.reduce((a, p) => ({ ...a, [p.state]: (a[p.state] || 0) + 1 }), {});
  return (
    <div className="screen">
      <TopBar title="My team" back={false} right={<>{sfa && (boot.sfa.plan_on || boot.sfa.leave_on) && <Link to="/approvals" className="icon-btn" aria-label="Approvals" data-testid="team-approvals"><CheckCheck size={20} /></Link>}{sfa && <button type="button" className="icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={20} /></button>}</>} />
      <StatusBars />
      <div className="body">
        <div className="seg two-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'team'} className={`seg-b${tab === 'team' ? ' on' : ''}`} onClick={() => setTab('team')} data-testid="team-tab-team">Team dashboard</button>
          <button type="button" role="tab" aria-selected={tab === 'me'} className={`seg-b${tab === 'me' ? ' on' : ''}`} onClick={() => setTab('me')} data-testid="team-tab-me">My dashboard</button>
        </div>
        {tab === 'me' ? <MyDashboard /> : (
          <>
            <div className="flex wrap" style={{ gap: 6 }}>
              <ViewingPicker value={view} onChange={setView} opts={opts} allowMe={false} allLabel="My whole team" testid="team-view" />
            </div>
            <FollowUps view={view} title="Team follow-ups" foldKey="fold_team_fu" testid="team-followups" team />
            {sfa && error && <div className="note bad">{error}</div>}
            {sfa && (!data ? <Loading /> : !people.length ? <Empty title="Nobody here" /> : (
              <>
                <div className="chips">{Object.keys(STATE).filter((k) => counts[k]).map((k) => <span key={k} className="status-chip" style={{ '--c': STATE[k][1] }}>{STATE[k][0]} · {counts[k]}</span>)}</div>
                <MapView pins={pins} fitKey={`${pins.length}-${view}`} testid="team-map" />
                <div className="list map-list" data-testid="team-list">
                  {people.map((p) => (
                    <button key={p.id} type="button" className="row" onClick={() => setPerson(p)}>
                      <Avatar name={p.name} />
                      <div className="main">
                        <div className="title">{p.name}</div>
                        <div className="line">
                          <span className="status-chip" style={{ '--c': STATE[p.state][1] }}>{STATE[p.state][0]}</span>
                          {p.visit ? ` · ${p.visit.name}` : ''}{p.in_time ? ` · in ${p.in_time}` : ''}{p.late ? ' (late)' : ''}
                        </div>
                      </div>
                      <div className="end col" style={{ gap: 2, alignItems: 'flex-end' }}>
                        {p.km_today > 0 && <span>{km(p.km_today)}</span>}
                        {(p.calls_today > 0 || data.call_target > 0) && <span className="tiny" data-testid="team-calls">{p.calls_today || 0}{data.call_target > 0 ? ` / ${data.call_target}` : ''} calls · {talk(p.talk_seconds)}</span>}
                        <span className="tiny">{ago(p.minutes_ago)}</span>
                        {p.battery !== null && p.battery < 20 && <span className="tiny flex" style={{ color: 'var(--bad)' }}><BatteryLow size={14} />{p.battery}%</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ))}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
