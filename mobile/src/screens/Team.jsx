/* For a manager: where the team is now, and each person's day. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, BatteryLow } from 'lucide-react';
import { GET } from '../lib/api';
import { km } from '../lib/format';
import { TopBar, BottomNav, Loading, Empty, Avatar, StatusBars } from '../components/ui';
import MapView from '../components/MapView';
import DayRoute from '../components/DayRoute';

const STATE = { working: ['Working', '#16A34A'], visiting: ['At a customer', '#2563EB'], no_signal: ['No signal', '#D97706'], done: ['Day over', '#64748B'], absent: ['Not in', '#CBD5E1'] };
const ago = (m) => (m === null || m === undefined ? '' : m < 1 ? 'now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`);

export default function Team() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [person, setPerson] = useState(null);
  const load = useCallback(() => { GET('/sfa/live').then((x) => { setData(x); setError(''); }).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const pins = useMemo(() => (data ? data.people : []).filter((p) => p.lat !== null && p.state !== 'absent').map((p) => ({
    id: p.id, lat: p.lat, lng: p.lng, color: STATE[p.state][1], text: p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), title: p.name, onClick: () => setPerson(p),
  })), [data]);
  if (person) {
    return (
      <div className="screen">
        <TopBar title={person.name} sub="Their day" onBack={() => setPerson(null)} />
        <div className="body"><DayRoute userId={person.id} /></div>
        <BottomNav />
      </div>
    );
  }
  const counts = (data ? data.people : []).reduce((a, p) => ({ ...a, [p.state]: (a[p.state] || 0) + 1 }), {});
  return (
    <div className="screen">
      <TopBar title="My team" back={false} right={<button type="button" className="icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={20} /></button>} />
      <StatusBars />
      <div className="body">
        {error && <div className="note bad">{error}</div>}
        {!data ? <Loading /> : !data.people.length ? <Empty title="Nobody in your team yet" /> : (
          <>
            <div className="chips">{Object.keys(STATE).filter((k) => counts[k]).map((k) => <span key={k} className="chip"><span className="dot" style={{ background: STATE[k][1] }} /> {STATE[k][0]} · {counts[k]}</span>)}</div>
            <MapView pins={pins} fitKey={String(pins.length)} testid="team-map" />
            <div className="list" data-testid="team-list">
              {data.people.map((p) => (
                <button key={p.id} type="button" className="row" onClick={() => setPerson(p)}>
                  <Avatar name={p.name} />
                  <div className="main">
                    <div className="title">{p.name}</div>
                    <div className="line">
                      <span style={{ color: STATE[p.state][1], fontWeight: 600 }}>{STATE[p.state][0]}</span>
                      {p.visit ? ` · ${p.visit.name}` : ''}{p.in_time ? ` · in ${p.in_time}` : ''}{p.late ? ' (late)' : ''}
                    </div>
                  </div>
                  <div className="end col" style={{ gap: 2, alignItems: 'flex-end' }}>
                    {p.km_today > 0 && <span>{km(p.km_today)}</span>}
                    <span className="tiny">{ago(p.minutes_ago)}</span>
                    {p.battery !== null && p.battery < 20 && <span className="tiny flex" style={{ color: 'var(--bad)' }}><BatteryLow size={14} />{p.battery}%</span>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
