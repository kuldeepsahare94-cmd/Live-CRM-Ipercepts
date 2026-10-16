/*
 * Follow-ups on a dashboard (v1.4): Overdue · Today · This week · Pick dates.
 * Mine on Home; my team's on the Team screen (with how many each person has).
 * Tap one: its record opens. The tick: done. The phone: call.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellRing, Check, Phone, ChevronRight, ChevronDown, CalendarRange, Loader2, ArrowRight, Clock } from 'lucide-react';
import { GET, POST, qs } from '../lib/api';
import { useApp } from '../lib/app';
import { get, set } from '../lib/store';
import { niceDate, niceTime, today, addDays, phoneFor } from '../lib/format';
import { openOutside } from '../lib/location';
import { colorOf, iconOf } from './icons';
import { Loading, Avatar } from './ui';

const RANGES = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['dates', 'Pick dates']];
const toIso = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };
function whenOf(r) {
  const d = niceDate(r.due_date);
  return r.has_time ? `${d} · ${niceTime(toIso(r.snoozed_until || r.due_at))}` : `${d} · no time set`;
}

export default function FollowUps({ view = 'me', title = 'My follow-ups', foldKey = 'fold_fu_open', testid = 'followups', team = false }) {
  const { module: modOf, say } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(() => get(foldKey) !== false);
  const [range, setRange] = useState(() => get(`${foldKey}_range`) || 'today');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 6));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);
  const [person, setPerson] = useState(0);
  const load = useCallback(() => {
    setError('');
    GET(`/sfa/m/follow-ups${qs({ range, view, from: range === 'dates' ? from : '', to: range === 'dates' ? to : '' })}`)
      .then((d) => { setData(d); }).catch((e) => setError(e.offline ? 'No internet: the follow-ups show when you are online.' : e.message));
  }, [range, view, from, to]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { setPerson(0); }, [view, range]);
  const toggle = () => { set(foldKey, !open); setOpen(!open); };
  const choose = (k) => { setRange(k); set(`${foldKey}_range`, k); setData(null); };
  const done = async (r) => {
    setBusy(r.id);
    try { await POST(`/follow-ups/${r.id}/complete`, {}); say('Follow-up done.', 'ok'); load(); } catch (e) { say(e.message, 'error'); } finally { setBusy(0); }
  };
  const go = (r) => { if (modOf(r.module)) nav(`/m/${r.module}/${r.record_id}`); else say('This record opens on the web.', 'info'); };
  const call = (r) => {
    if (['leads', 'contacts', 'accounts', 'opportunities'].includes(r.module) && modOf('calls') && modOf('calls').can.create) nav(`/call/${r.module}/${r.record_id}?dial=1`);
    else openOutside(`tel:${phoneFor(r.phone)}`);
  };
  const c = (data && data.counts) || {};
  const rows = data ? (person ? data.rows.filter((r) => Number(r.assignee_id) === person) : data.rows) : [];
  return (
    <div className="card col fu-card" style={{ gap: 10 }} data-testid={testid}>
      <button type="button" className="fold-head" onClick={toggle} aria-expanded={open} data-testid={`${testid}-toggle`}>
        <BellRing size={15} /> <span className="grow">{title}</span>
        {c.overdue > 0 && <span className="seg-n bad-n" title="Overdue">{c.overdue}</span>}
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <>
          <div className="seg fu-seg" role="tablist">
            {RANGES.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={range === k} className={`seg-b${range === k ? ' on' : ''}${k === 'overdue' && c.overdue ? ' warn-b' : ''}`} onClick={() => choose(k)} data-testid={`${testid}-range-${k}`}>
                {k === 'dates' && <CalendarRange size={14} />}{label}{k !== 'dates' && c[k] !== undefined && <span className="seg-n">{c[k]}</span>}
              </button>
            ))}
          </div>
          {range === 'dates' && (
            <div className="grid2">
              <label className="field"><span>From</span><input className="input small-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid={`${testid}-from`} /></label>
              <label className="field"><span>To</span><input className="input small-input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} data-testid={`${testid}-to`} /></label>
            </div>
          )}
          {error && <div className="note warn small">{error}</div>}
          {team && data && data.by_person.length > 1 && (
            <div className="kpi-strip" data-testid={`${testid}-people`}>
              <button type="button" className={`chip${!person ? ' on' : ''}`} onClick={() => setPerson(0)}>Everyone · {data.total}</button>
              {data.by_person.map((p) => (
                <button key={p.id} type="button" className={`chip${person === p.id ? ' on' : ''}`} onClick={() => setPerson(person === p.id ? 0 : p.id)} data-testid={`${testid}-person`}>
                  {p.name} · {p.count}{p.overdue ? <span className="tag bad" style={{ marginLeft: 2 }}>{p.overdue} late</span> : null}
                </button>
              ))}
            </div>
          )}
          {!data && !error ? <Loading /> : data && !rows.length ? (
            <div className="small muted center" style={{ padding: '10px 0' }} data-testid={`${testid}-empty`}>
              {range === 'overdue' ? 'Nothing overdue. 👍' : range === 'today' ? 'No follow-ups today.' : range === 'week' ? 'No follow-ups this week.' : 'No follow-ups on these days.'}
            </div>
          ) : data && (
            <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line-soft)' }}>
              {rows.map((r) => {
                const Icon = iconOf(r.module);
                return (
                  <div key={r.id} className="row fu-row" data-testid={`${testid}-row`}>
                    <span className="thumb" style={{ width: 36, height: 36, background: `${colorOf(r.module)}14`, color: colorOf(r.module) }}><Icon size={17} /></span>
                    <div className="main" role="link" onClick={() => go(r)}>
                      <div className="title">{r.title}</div>
                      <div className={`line${r.overdue ? ' bad-text' : ''}`}>{whenOf(r)}{r.subject && r.subject !== 'Follow-up' ? ` · ${r.subject}` : ''}</div>
                      {team && r.assignee_name && <div className="tiny muted flex" style={{ gap: 4 }}><Avatar name={r.assignee_name} small /> {r.assignee_name}</div>}
                    </div>
                    {r.phone && <button type="button" className="icon-btn" style={{ color: 'var(--ok)' }} aria-label="Call" onClick={() => call(r)} data-testid={`${testid}-call`}><Phone size={18} /></button>}
                    <button type="button" className="icon-btn tick-btn" aria-label="Done" disabled={busy === r.id} onClick={() => done(r)} data-testid={`${testid}-done`}>
                      {busy === r.id ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
                    </button>
                  </div>
                );
              })}
              {data.more && <div className="tiny faint center" style={{ padding: 8 }}>Showing the first {data.rows.length}.</div>}
            </div>
          )}
          {/* (v1.5) the full list: reschedule, WhatsApp, search, call them one by one */}
          {!team && <Link to={`/follow-ups?range=${range}`} className="btn ghost small" style={{ alignSelf: 'flex-start' }} data-testid={`${testid}-all`}>Open all follow-ups <ArrowRight size={15} /></Link>}
        </>
      )}
    </div>
  );
}

/**
 * "Next up" on Home (v1.5): the next follow-up of today (or the first late one),
 * with Call — so there is no searching for what to do next.
 */
export function NextUp() {
  const { module: modOf } = useApp();
  const nav = useNavigate();
  const [next, setNext] = useState(null);
  useEffect(() => {
    Promise.all([GET('/sfa/m/follow-ups?range=today&view=me'), GET('/sfa/m/follow-ups?range=overdue&view=me')]).then(([t, o]) => {
      const now = Date.now() - 3600000;
      const at = (r) => Date.parse(toIso(r.snoozed_until || r.due_at)) || 0;
      const todays = t.rows.filter((r) => !r.overdue).sort((a, b) => at(a) - at(b));
      setNext(todays.find((r) => !r.has_time || at(r) >= now) || o.rows[0] || todays[0] || false);
    }).catch(() => setNext(false));
  }, []);
  if (!next) return null;
  const call = () => {
    if (['leads', 'contacts', 'accounts', 'opportunities'].includes(next.module) && modOf('calls') && modOf('calls').can.create && modOf(next.module)) nav(`/call/${next.module}/${next.record_id}?dial=1`);
    else openOutside(`tel:${phoneFor(next.phone)}`);
  };
  return (
    <div className={`card flex next-up${next.overdue ? ' late' : ''}`} data-testid="next-up">
      <button type="button" className="grow" style={{ textAlign: 'left', minWidth: 0 }} onClick={() => (modOf(next.module) ? nav(`/m/${next.module}/${next.record_id}`) : null)}>
        <div className="tiny muted flex" style={{ gap: 4 }}><Clock size={12} /> {next.overdue ? 'Late — do this first' : 'Next up'}</div>
        <div className="strong ellipsis">{next.title}</div>
        <div className={`tiny${next.overdue ? ' bad-text' : ' muted'}`}>{whenOf(next)}{next.subject && next.subject !== 'Follow-up' ? ` · ${next.subject}` : ''}</div>
      </button>
      {next.phone && <button type="button" className="btn good small" onClick={call} data-testid="next-up-call"><Phone size={16} /> Call</button>}
    </div>
  );
}
