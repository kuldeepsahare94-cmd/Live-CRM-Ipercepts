/*
 * (v1.10) The timeline of a record: grouped by day (Today · Yesterday · a date), each entry with
 * its time, a coloured icon for its kind, its title, a status pill and a short line. A filter
 * ("All activities" or one kind) and "+ Add activity". A call's recording plays in place.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ChevronDown, Plus, Play, Pause, Clock, PhoneMissed, Mail, ChevronRight, Check } from 'lucide-react';
import { KIND } from './Record360';
import { Badge, dayOf, clock, whenText, isoOf } from './kit';
import { Sheet } from './ui';
import { money, niceDate, talk, today } from '../lib/format';

const EMAIL = { icon: Mail, color: '#0284C7', label: 'Email' };
const kindOf = (t) => (t === 'email' ? EMAIL : KIND[t] || KIND.note);
const PLURAL = { call: 'Calls', visit: 'Visits', meeting: 'Meetings', task: 'Tasks', note: 'Notes', follow_up: 'Follow-ups', order: 'Quotations', deal: 'Deals', invoice: 'Invoices', payment: 'Payments', ticket: 'Tickets', email: 'Emails' };

function dayTitle(d) {
  const t = today();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const full = niceDate(d) + (niceDate(d).match(/\d{4}$/) ? '' : ` ${d.slice(0, 4)}`);
  if (d === t) return ['Today', full];
  if (d === yd) return ['Yesterday', full];
  if (d > t) return ['Coming up', full];
  return [full, ''];
}

function Entry({ it, linkable }) {
  const [play, setPlay] = useState(false);
  const k = kindOf(it.type);
  const Icon = it.type === 'call' && !it.connected ? PhoneMissed : k.icon;
  const to = it.type === 'visit' ? `/visits/${it.id}` : it.module && linkable(it.module) ? `/m/${it.module}/${it.id}` : null;
  // (the time is in the left column; the card adds what the time does not say: a call's length, a plain day)
  const meta = it.type === 'call' ? [clock(it.at), it.seconds ? talk(it.seconds) : ''].filter(Boolean).join('  •  ') : (String(it.at || '').length <= 10 ? whenText(it.at, { time: false }) : '');
  const status = it.status && it.status !== it.title ? it.status : '';
  const head = (
    <>
      <div className="tl2-head">
        <span className="tl2-title">{it.title}</span>
        {status && <Badge value={status} />}
        {it.amount !== undefined && it.amount !== null && <span className="tl2-amount">{money(it.amount)}</span>}
      </div>
      {meta && <div className="tl2-meta"><Clock size={13} /> {meta}</div>}
      {it.sub && <div className="tl2-sub">{it.sub}</div>}
    </>
  );
  return (
    <div className="tl2-row" data-type={it.type} data-testid="tl-entry">
      <div className="tl2-time">{clock(it.at)}</div>
      <div className="tl2-rail"><span className="tl2-node" style={{ '--c': k.color }}><Icon size={18} /></span></div>
      <div className="tl2-card">
        <div className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
          {to ? <Link to={to} className="grow" style={{ color: 'inherit', minWidth: 0 }} data-testid={`tl-open-${it.type}`}>{head}</Link> : <div className="grow" style={{ minWidth: 0 }}>{head}</div>}
          {it.recording && <button type="button" className="tl2-play" aria-label={play ? 'Hide the player' : 'Play the recording'} onClick={() => setPlay(!play)} data-testid="tl-play">{play ? <Pause size={16} /> : <Play size={16} />}</button>}
          {!it.recording && to && <ChevronRight size={18} className="faint" style={{ marginTop: 2 }} />}
        </div>
        {play && <audio controls autoPlay preload="none" src={it.recording} className="rec-audio" data-testid="r360-audio" />}
      </div>
    </div>
  );
}

export default function Timeline2({ items, linkable, onAdd }) {
  const [type, setType] = useState('');
  const [pick, setPick] = useState(false);
  const kinds = useMemo(() => [...new Set(items.map((x) => x.type))], [items]);
  const shown = type ? items.filter((x) => x.type === type) : items;
  const days = [];
  for (const it of shown) {
    const d = dayOf(isoOf(it.at)) || '';
    let g = days.find((x) => x.d === d);
    if (!g) { g = { d, items: [] }; days.push(g); }
    g.items.push(it);
  }
  return (
    <div className="tl2" data-testid="r360-timeline">
      <div className="tl2-bar">
        {kinds.length > 1 && <button type="button" className="typ-btn" onClick={() => setPick(true)} data-testid="tl-filter"><Filter size={16} color="var(--brand)" /> {type ? PLURAL[type] || type : 'All activities'} <ChevronDown size={16} /></button>}
        <span className="grow" />
        {onAdd && <button type="button" className="add-act" onClick={onAdd} data-testid="tl-add"><Plus size={17} /> Add activity</button>}
      </div>
      {!shown.length && <div className="empty small">Nothing yet. Calls, meetings, tasks, notes and emails show here.</div>}
      {days.map((g) => {
        const [a, b] = g.d ? dayTitle(g.d) : ['Undated', ''];
        return (
          <div key={g.d} className="col" style={{ gap: 10 }}>
            <div className="tl2-day" data-testid="tl-day"><b>{a}</b>{b && <> · {b}</>}</div>
            {g.items.map((it) => <Entry key={`${it.type}-${it.id}`} it={it} linkable={linkable} />)}
          </div>
        );
      })}
      {pick && (
        <Sheet title="Show" onClose={() => setPick(false)}>
          <div className="list">
            {['', ...kinds].map((k) => {
              const K = k ? kindOf(k) : null;
              return (
                <button key={k || 'all'} type="button" className="row" onClick={() => { setType(k); setPick(false); }} data-testid={`tl-type-${k || 'all'}`}>
                  {K ? <span className="ini" style={{ width: 32, height: 32, color: K.color, background: `color-mix(in srgb, ${K.color} 13%, #fff)` }}><K.icon size={16} /></span> : <span className="ini" style={{ width: 32, height: 32, color: 'var(--brand)', background: 'var(--brand-soft)' }}><Filter size={16} /></span>}
                  <span className="main title">{k ? PLURAL[k] || k : 'All activities'}</span>
                  <span className="tiny muted">{k ? items.filter((x) => x.type === k).length : items.length}</span>
                  {type === k && <Check size={18} color="var(--brand)" />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}
