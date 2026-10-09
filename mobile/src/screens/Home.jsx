/*
 * Home: on duty or not (punch in / out), where I am now (an open visit),
 * today's meetings, quick actions, and the modules of this CRM.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, LogOut, MapPin, Navigation, Camera, CalendarDays, ShoppingCart, PhoneCall, ReceiptText, UserPlus, Loader2, AlertTriangle, Route } from 'lucide-react';
import { useApp } from '../lib/app';
import { get } from '../lib/store';
import { punchIn, punchOut } from '../lib/fieldwork';
import { takePhoto } from '../lib/media';
import { km, niceTime, since } from '../lib/format';
import { BottomNav, StatusBars } from '../components/ui';
import { iconOf, colorOf } from '../components/icons';

function DutyCard() {
  const { boot, day, setDay, tracking, say } = useApp();
  const [busy, setBusy] = useState('');
  const sfa = boot.sfa;
  const s = day && day.session;
  const done = day && day.sessions && day.sessions.filter((x) => x.out_at);
  const act = async (what) => {
    setBusy(what);
    try {
      const needSelfie = what === 'in' ? sfa.selfie_in : sfa.selfie_out;
      let selfie = null;
      if (needSelfie) {
        say('Take a selfie to punch ' + what + '.');
        selfie = await takePhoto({ selfie: true });
        if (!selfie) { setBusy(''); return; }
      }
      const next = what === 'in' ? await punchIn({ boot, day, selfie }) : await punchOut({ day, selfie });
      setDay(next);
      say(what === 'in' ? 'Punched in. Have a good day!' : 'Punched out. See you tomorrow!', 'ok');
    } catch (e) { say(e.message, 'error'); } finally { setBusy(''); }
  };
  if (!sfa.can_punch) return null;
  return (
    <div className="card duty" data-testid="duty-card">
      <div className="state">
        <span className={`dot${s ? ' on' : ''}`} />
        <div className="grow">
          <div className="strong" data-testid="duty-state">{s ? `On duty since ${s.in_time || niceTime(s.in_at)}` : 'Off duty'}</div>
          <div className="small muted">
            {s ? `${since(s.in_at)} · ${km(day.km_today ?? s.km)}${day.visits ? ` · ${day.visits.length} visit${day.visits.length === 1 ? '' : 's'}` : ''}`
              : done && done.length ? `Today: ${done[0].in_time}–${done[done.length - 1].out_time} · ${km(day.km_today)}` : 'Punch in when you start work.'}
          </div>
        </div>
        {s && s.pending && <span className="tag info">Not sent yet</span>}
      </div>
      {s && tracking.error && <div className="note warn small flex"><AlertTriangle size={16} />{tracking.error}</div>}
      {s ? (
        <button type="button" className="btn danger big block" onClick={() => act('out')} disabled={!!busy} data-testid="punch-out">
          {busy ? <Loader2 className="spin" /> : <LogOut />} Punch out
        </button>
      ) : (
        <button type="button" className="btn good big block" onClick={() => act('in')} disabled={!!busy} data-testid="punch-in">
          {busy ? <><Loader2 className="spin" /> Finding where you are…</> : <><LogIn /> Punch in</>}
        </button>
      )}
      {s && <Link to="/day" className="small flex" style={{ justifyContent: 'center' }}><Route size={15} /> My route today</Link>}
    </div>
  );
}

function OpenVisit() {
  const { day } = useApp();
  const v = day && day.open_visit;
  if (!v) return null;
  return (
    <Link to="/visit" className="card flex" style={{ background: 'var(--info-soft)', color: 'var(--ink)' }} data-testid="open-visit">
      <MapPin size={22} style={{ color: 'var(--info)' }} />
      <div className="grow">
        <div className="strong">At {v.related_name || 'a customer'}</div>
        <div className="small muted">Since {v.in_time || niceTime(v.in_at)} · {since(v.in_at)}</div>
      </div>
      <span className="btn small primary">Check out</span>
    </Link>
  );
}

function Meetings() {
  const { day, boot } = useApp();
  const nav = useNavigate();
  const list = (day && day.meetings) || [];
  if (!list.length) return null;
  const inside = !!(day && day.session);
  return (
    <div>
      <div className="card-title" style={{ padding: '0 4px' }}><CalendarDays size={15} /> Today's meetings</div>
      <div className="list">
        {list.map((m) => (
          <div key={m.id} className="row">
            <div style={{ width: 46 }} className="strong small">{niceTime(m.start_datetime)}</div>
            <Link to={`/m/meetings/${m.id}`} className="main" style={{ color: 'inherit' }}>
              <div className="title">{m.meeting_title}</div>
              <div className="line">{m.related_name || m.location || ''}</div>
            </Link>
            {m.visit_status === 'closed' ? <span className="tag ok">Done</span>
              : m.visit_status === 'open' ? <span className="tag info">Here</span>
                : boot.sfa.enabled && inside ? <button type="button" className="btn small primary" onClick={() => nav(`/visit/new?meeting=${m.id}`)} data-testid={`meeting-checkin-${m.id}`}>Check in</button>
                  : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { boot, day } = useApp();
  const nav = useNavigate();
  const mods = boot.modules;
  const has = (api, action = 'view') => mods.some((m) => m.api_name === api && m.can[action]);
  const sfaOn = boot.sfa.enabled;
  const onDuty = !!(day && day.session);
  const quick = [
    sfaOn && { label: 'Check in', icon: MapPin, color: '#2563EB', go: () => (onDuty ? nav('/visit/new') : nav('/visit/new?off=1')), id: 'checkin' },
    has('leads', 'create') && { label: 'New lead', icon: UserPlus, color: '#C026D3', go: () => nav('/m/leads/new'), id: 'lead' },
    has('quotations', 'create') && has('products') && { label: 'New order', icon: ShoppingCart, color: '#0891B2', go: () => nav('/order/new'), id: 'order' },
    has('calls', 'create') && { label: 'Log a call', icon: PhoneCall, color: '#EA580C', go: () => nav(`/m/${has('leads') ? 'leads' : 'accounts'}`), id: 'call' },
    boot.expenses && { label: 'Expense', icon: ReceiptText, color: '#0D9488', go: () => nav('/expenses?add=1'), id: 'expense' },
    sfaOn && { label: 'Nearby', icon: Navigation, color: '#16A34A', go: () => nav('/nearby'), id: 'nearby' },
  ].filter(Boolean);
  const hour = new Date().getHours();
  return (
    <div className="screen">
      <div className="hero">
        <div className="company">{boot.name || get('company')}</div>
        <h1>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {String(boot.me.name || '').split(' ')[0]}</h1>
      </div>
      <StatusBars />
      <div className="body lift">
        {sfaOn && <DutyCard />}
        <OpenVisit />
        {quick.length > 0 && (
          <div className="tiles" data-testid="quick">
            {quick.map((q) => (
              <button key={q.id} type="button" className="tile" onClick={q.go} data-testid={`quick-${q.id}`}>
                <span className="ic" style={{ background: `${q.color}1A`, color: q.color }}><q.icon size={20} /></span>{q.label}
              </button>
            ))}
          </div>
        )}
        <Meetings />
        <div>
          <div className="card-title" style={{ padding: '0 4px' }}>Your CRM</div>
          <div className="tiles" data-testid="modules">
            {mods.map((m) => {
              const Icon = iconOf(m.api_name);
              const c = colorOf(m.api_name);
              return (
                <Link key={m.api_name} to={`/m/${m.api_name}`} className="tile" data-testid={`mod-${m.api_name}`}>
                  <span className="ic" style={{ background: `${c}1A`, color: c }}><Icon size={20} /></span>{m.plural}
                </Link>
              );
            })}
          </div>
        </div>
        {sfaOn && !onDuty && (boot.sfa.selfie_in) && <p className="tiny faint center"><Camera size={12} /> A selfie is asked at punch in.</p>}
      </div>
      <BottomNav />
    </div>
  );
}

