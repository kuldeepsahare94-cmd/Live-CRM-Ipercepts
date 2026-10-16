/*
 * Follow-ups (v1.5; v1.7: only follow-ups a person planned, plus a "Not planned" list of
 * active leads that have none): the day's to-do list, a screen of its own (menu → Follow-ups,
 * or a tile on Home).
 *   My view / Team view (a manager: the whole team, a team, a role, a person)
 *   Overdue · Today · This week · Pick dates, with their counts; a search
 *   each one: Call · WhatsApp · Reschedule · Done; tap it: the customer opens
 *   "Call them all": the Auto Dialer with these follow-ups
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Phone, MessageCircle, CalendarClock, Check, Search, Loader2, AlertTriangle, CalendarRange, PhoneForwarded, RefreshCw } from 'lucide-react';
import { GET, POST, qs } from '../lib/api';
import { useApp } from '../lib/app';
import { niceDate, niceTime, today, addDays, phoneFor } from '../lib/format';
import { openOutside } from '../lib/location';
import { openWhatsApp } from '../lib/whatsapp';
import { colorOf, iconOf, VISIT_MODULES } from '../components/icons';
import { TopBar, BottomNav, Loading, Empty, Avatar, StatusBars } from '../components/ui';
import ViewingPicker, { useViewingOptions } from '../components/Viewing';
import QuickEdit from '../components/QuickEdit';

const toIso = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };
const TILES = [['overdue', 'Overdue', '#DC2626'], ['today', 'Today', '#4F46E5'], ['week', 'This week', '#0891B2'], ['none', 'Not planned', '#B45309']];
function lateText(r) {
  if (!r.overdue) return '';
  const days = Math.floor((Date.parse(`${today()}T00:00:00`) - Date.parse(`${r.due_date}T00:00:00`)) / 86400000);
  return days >= 1 ? `Overdue · ${days} day${days === 1 ? '' : 's'}` : 'Overdue';
}
const RATING = { hot: 'bad', warm: 'warn', cold: 'info' };

export default function FollowUpsScreen() {
  const { boot, say, module: modOf } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const opts = useViewingOptions(!!(boot.me && boot.me.view_others));
  const range = ['overdue', 'today', 'week', 'dates', 'none'].includes(params.get('range')) ? params.get('range') : 'today';
  const view = params.get('view') || 'me';
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 6));
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);
  const [edit, setEdit] = useState(null);
  const set = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = useCallback(() => {
    setError('');
    GET(`/sfa/m/follow-ups${qs({ range, view, q: term, from: range === 'dates' ? from : '', to: range === 'dates' ? to : '' })}`)
      .then(setData).catch((e) => setError(e.offline ? 'No internet: the follow-ups show when you are online.' : e.message));
  }, [range, view, term, from, to]);
  useEffect(() => { setData(null); load(); }, [load]);

  const team = view !== 'me';
  const c = (data && data.counts) || {};
  const done = async (r) => {
    setBusy(r.id);
    try { await POST(`/follow-ups/${r.id}/complete`, {}); say('Done.', 'ok'); load(); } catch (e) { say(e.message, 'error'); } finally { setBusy(0); }
  };
  const call = (r) => {
    if (VISIT_MODULES.includes(r.module) && modOf('calls') && modOf('calls').can.create && modOf(r.module)) nav(`/call/${r.module}/${r.record_id}?dial=1`);
    else openOutside(`tel:${phoneFor(r.phone)}`);
  };
  const open = (r) => { if (modOf(r.module)) nav(`/m/${r.module}/${r.record_id}`); else say('This record opens on the web.', 'info'); };
  const rows = data ? data.rows : [];
  const noPlan = range === 'none';
  // a lead with no follow-up: open it and plan one (the quick editor, follow-up tab)
  const callable = rows.filter((r) => r.phone).length;

  return (
    <div className="screen">
      <TopBar title="Follow-ups" back={false} right={<button type="button" className="icon-btn" aria-label="Refresh" onClick={load}><RefreshCw size={20} /></button>} />
      <StatusBars />
      <div className="body">
        {boot.me.view_others && (
          <div className="flex wrap" style={{ gap: 8 }}>
            <div className="seg two-tabs" role="tablist" style={{ flex: 1 }}>
              <button type="button" role="tab" aria-selected={!team} className={`seg-b${!team ? ' on' : ''}`} onClick={() => set('view', '')} data-testid="fu-my">My view</button>
              <button type="button" role="tab" aria-selected={team} className={`seg-b${team ? ' on' : ''}`} onClick={() => set('view', 'all')} data-testid="fu-team">Team view</button>
            </div>
            {team && <ViewingPicker value={view} onChange={(v) => set('view', v)} opts={opts} allowMe={false} allLabel="My whole team" testid="fu-view" />}
          </div>
        )}
        <div className="fu-tiles" role="tablist">
          {TILES.map(([k, label, color]) => (
            <button key={k} type="button" role="tab" aria-selected={range === k} className={`fu-tile${range === k ? ' on' : ''}`} style={{ '--c': color }} onClick={() => set('range', k)} data-testid={`fu-tile-${k}`}>
              <b>{c[k] ?? '–'}</b><span>{k === 'overdue' && c.overdue ? <><AlertTriangle size={12} /> {label}</> : label}</span>
            </button>
          ))}
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <div className="search grow"><Search size={18} /><input className="input" placeholder="Search a name or a note" value={q} onChange={(e) => setQ(e.target.value)} data-testid="fu-search" /></div>
          <button type="button" className={`chip${range === 'dates' ? ' on' : ''}`} onClick={() => set('range', 'dates')} data-testid="fu-dates"><CalendarRange size={15} /> Dates</button>
        </div>
        {range === 'dates' && (
          <div className="grid2">
            <label className="field"><span>From</span><input className="input small-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="fu-from" /></label>
            <label className="field"><span>To</span><input className="input small-input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} data-testid="fu-to" /></label>
          </div>
        )}
        {team && data && data.by_person.length > 0 && (
          <div className="tiny muted" data-testid="fu-people">{data.by_person.map((p) => `${p.name} ${p.count}${p.overdue ? ` (${p.overdue} late)` : ''}`).join(' · ')}</div>
        )}
        {noPlan && <div className="note small" data-testid="fu-noplan-hint">Active leads with no follow-up planned. Tap Plan to set one.</div>}
        {!noPlan && callable > 0 && modOf('calls') && modOf('calls').can.create && (
          <Link to={`/dialer?source=fu-${range}${team ? `&view=${encodeURIComponent(view)}` : ''}`} className="btn outline block" data-testid="fu-dial-all"><PhoneForwarded size={18} /> Call them one by one ({callable})</Link>
        )}
        {error && <div className="note warn small">{error}</div>}
        {!data && !error ? <Loading /> : data && !rows.length ? (
          <Empty icon={Check} title={term ? 'Nothing found' : noPlan ? 'Every active lead has a follow-up 👍' : range === 'overdue' ? 'Nothing overdue 👍' : range === 'today' ? 'No follow-ups today' : 'No follow-ups here'} />
        ) : data && (
          <div className="col" style={{ gap: 10 }} data-testid="fu-list">
            {rows.map((r) => {
              const Icon = iconOf(r.module);
              return (
                <div key={r.id} className={`card fu-item${r.overdue ? ' late' : ''}`} data-testid="fu-item">
                  <button type="button" className="fu-main" onClick={() => open(r)} data-testid="fu-open">
                    <span className="thumb" style={{ width: 38, height: 38, background: `${colorOf(r.module)}14`, color: colorOf(r.module) }}><Icon size={18} /></span>
                    <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                      <span className="strong ellipsis block">{r.title}</span>
                      {r.company && <span className="tiny muted ellipsis block">{r.company}</span>}
                      <span className={`tiny block${r.overdue ? ' bad-text' : ' muted'}`} data-testid="fu-when">
                        {r.no_plan ? `${r.lead_status || 'Lead'} · added ${niceDate(r.created_at)}${r.last_call ? ` · last call ${niceDate(r.last_call)}` : ' · never called'}` : <>{r.overdue ? `${lateText(r)} · ` : ''}{niceDate(r.due_date)}</>}{!r.no_plan && r.has_time ? ` · ${niceTime(toIso(r.snoozed_until || r.due_at))}` : ''}{!r.no_plan && r.subject && r.subject !== 'Follow-up' ? ` · ${r.subject}` : ''}
                      </span>
                      {team && r.assignee_name && <span className="tiny muted flex" style={{ gap: 4 }}><Avatar name={r.assignee_name} small /> {r.assignee_name}</span>}
                    </span>
                    {r.rating && <span className={`tag ${RATING[String(r.rating).toLowerCase()] || ''}`}>{r.rating}</span>}
                  </button>
                  {r.notes && <div className="tiny muted fu-note">{r.notes}</div>}
                  <div className="fu-acts">
                    {r.phone && <button type="button" className="fu-act ok" onClick={() => call(r)} data-testid="fu-call"><Phone size={16} /> Call</button>}
                    {r.phone && <button type="button" className="fu-act wa" onClick={() => openWhatsApp(r.phone, '')} data-testid="fu-wa"><MessageCircle size={16} /> WhatsApp</button>}
                    <button type="button" className="fu-act" onClick={() => setEdit(r)} data-testid="fu-reschedule"><CalendarClock size={16} /> {r.no_plan ? 'Plan' : 'Reschedule'}</button>
                    {!r.no_plan && <button type="button" className="fu-act done" disabled={busy === r.id} onClick={() => done(r)} data-testid="fu-done">{busy === r.id ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Done</button>}
                  </div>
                </div>
              );
            })}
            {data.more && <div className="tiny faint center">Showing the first {rows.length}. Search or pick dates to see others.</div>}
          </div>
        )}
      </div>
      {edit && <QuickEdit module={edit.module} id={edit.record_id} title={edit.title} only="follow" followUp={edit.no_plan ? null : { id: edit.id, due_at: edit.snoozed_until || edit.due_at, has_time: edit.has_time }} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <BottomNav />
    </div>
  );
}
