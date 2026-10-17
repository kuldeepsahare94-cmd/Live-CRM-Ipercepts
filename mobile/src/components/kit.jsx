/*
 * (v1.10) The app's design kit: the pieces every list and record page is made of,
 * so every module looks and behaves the same.
 *
 *   Badge        a status / rating / priority pill, its colour from its meaning
 *   Initials     the round initials of a person or a company (soft colour)
 *   FollowUp     a follow-up date with its Overdue / Today / Upcoming pill
 *   RecordCard   one row of a list: initials, name, status, phone (copy), call, ⋮, and a strip of two facts
 *   Facts        the strip of 3–4 key facts on a record page
 *   LinkCard     a record this one belongs to (customer, contact, deal…), opening its page
 *   SortSheet    how a list is sorted
 *   MenuSheet    the ⋮ menu of a row
 *   copyText     copy to the clipboard, with a short note
 */
import { Link } from 'react-router-dom';
import { Copy, ChevronRight, Phone, MoreVertical, Check, CalendarClock, Clock3 } from 'lucide-react';
import { Sheet } from './ui';
import { niceDate, niceTime, today } from '../lib/format';

// --- colours by meaning -------------------------------------------------------------------
// (the same word always gets the same colour, on every screen)
const TONE_RULES = [
  ['red', /\b(not interested|not connected|not answered|no answer|closed lost|unpaid|inactive|lost)\b/i],
  ['green', /\b(won|closed won|converted|complete|completed|done|paid|accepted|active|interested|connected|held|resolved|success|received|approved|met)\b/i],
  ['red', /\b(lost|closed lost|reject|rejected|cancel|cancelled|canceled|dead|not interested|junk|expired|overdue|breach|breached|missed|failed|unpaid|critical|urgent|hot|inactive|dropped)\b/i],
  ['orange', /\b(new|warm|high|follow[- ]?up|negotiation|partially paid|partial|at risk|hold|on hold)\b/i],
  ['amber', /\b(pending|in progress|open|due|waiting|not started|medium|proposal sent)\b/i],
  ['purple', /\b(demo|demo planned|demo done|proposal|priority|qualified)\b/i],
  ['blue', /\b(contacted|qualification|needs analysis|sent|viewed|scheduled|assigned|cold|low|planned|on track)\b/i],
  ['grey', /\b(draft|deferred|not set|none|closed)\b/i],
];
export function toneOf(value) {
  const v = String(value || '');
  for (const [tone, re] of TONE_RULES) if (re.test(v)) return tone;
  return 'indigo';
}
export function Badge({ value, tone, icon: Icon, testid }) {
  if (value === null || value === undefined || value === '') return null;
  return <span className={`bdg bdg-${tone || toneOf(value)}`} data-testid={testid}>{Icon && <Icon size={12} />}{value}</span>;
}

// --- initials -------------------------------------------------------------------------------
const SOFT = [['#FCE7F3', '#DB2777'], ['#E0F2FE', '#0284C7'], ['#DCFCE7', '#15803D'], ['#FFEDD5', '#EA580C'], ['#EDE9FE', '#7C3AED'], ['#E0E7FF', '#4338CA'], ['#CCFBF1', '#0F766E'], ['#FEF3C7', '#B45309']];
export const initialsOf = (name) => String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
export function softColour(name) {
  const n = String(name || '?');
  return SOFT[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % SOFT.length];
}
export function Initials({ name, size = 44, solid = false, img }) {
  const [bg, fg] = softColour(name);
  if (img) return <img className="ini" src={img} alt="" loading="lazy" style={{ width: size, height: size }} />;
  return (
    <span className={`ini${solid ? ' solid' : ''}`} style={solid ? { width: size, height: size, fontSize: size * 0.36 } : { width: size, height: size, background: bg, color: fg, fontSize: size * 0.36 }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

// --- dates ----------------------------------------------------------------------------------
// ("2026-10-09 10:30:00" from the server is UTC; a plain day stays a day)
export const isoOf = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };
export const dayOf = (v) => {
  const s = isoOf(v);
  if (!s) return '';
  if (s.length <= 10) return s.slice(0, 10);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? s.slice(0, 10) : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const hasTime = (v) => { const s = String(v || ''); return s.length > 10 && !/T00:00:00(\.000)?Z?$/.test(s) && !/ 00:00:00$/.test(s); };
const ampm = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); if (Number.isNaN(h)) return ''; return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/** "Today, 4:00 PM" · "Yesterday" · "15 Oct" · "15 Oct, 11:20 AM" */
export function whenText(v, { time = true } = {}) {
  const s = isoOf(v);
  if (!s) return '';
  const d = dayOf(s); const t = today();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const td = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`;
  const dayWord = d === t ? 'Today' : d === yd ? 'Yesterday' : d === td ? 'Tomorrow' : niceDate(d);
  return time && hasTime(v) ? `${dayWord}, ${ampm(niceTime(s))}` : dayWord;
}
export const clock = (v) => (hasTime(v) ? ampm(niceTime(isoOf(v))) : '');
/** the state of a date to act on: overdue | today | upcoming | none */
export function dueState(v, done = false) {
  if (!v) return 'none';
  if (done) return 'done';
  const d = dayOf(v); const t = today();
  return d < t ? 'overdue' : d === t ? 'today' : 'upcoming';
}
const DUE = { overdue: ['Overdue', 'red'], today: ['Today', 'green'], upcoming: ['Upcoming', 'blue'], done: ['Done', 'grey'] };
export function DuePill({ state, always = false }) {
  if (!DUE[state] || (state === 'upcoming' && !always)) return null;   // (only what needs doing stands out)
  return <span className={`bdg bdg-${DUE[state][1]} bdg-sm`}>{DUE[state][0]}</span>;
}

// --- one row of a list -------------------------------------------------------------------------
/**
 * @param to        the record's page
 * @param title     its name
 * @param badge     its status ({ value, tone })
 * @param lines     small lines under the name: [{ text, copy, cls }]
 * @param amount    a sum shown on the right
 * @param cells     the strip under it: [{ icon, label, value, cls, pill }] (two at most)
 * @param onCall    the green call button
 * @param onMenu    the ⋮ button
 */
export function RecordCard({ to, title, initials, img, icon: Icon, iconColor, badge, badges = [], lines = [], amount, cells = [], onCall, onMenu, testid = 'list-row', onCopy }) {
  return (
    <div className="rc" data-testid={testid}>
      <div className="rc-top">
        <Link to={to} className="rc-av" tabIndex={-1} aria-hidden="true">
          {Icon ? <span className="ini" style={{ width: 44, height: 44, background: `color-mix(in srgb, ${iconColor} 13%, #fff)`, color: iconColor }}><Icon size={20} /></span> : <Initials name={initials || title} img={img} />}
        </Link>
        <Link to={to} className="rc-main">
          <div className="rc-title-row">
            <span className="rc-title">{title}</span>
            {badge && <Badge value={badge.value} tone={badge.tone} />}
            {badges.map((b) => <Badge key={b.value} value={b.value} tone={b.tone} />)}
          </div>
          {lines.filter((l) => l && l.text).map((l, i) => (
            <div key={i} className={`rc-line ${l.cls || ''}`}>
              <span className="ellipsis">{l.text}</span>
              {l.copy && <button type="button" className="rc-copy" aria-label="Copy" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCopy && onCopy(l.copy); }}><Copy size={14} /></button>}
            </div>
          ))}
        </Link>
        <div className="rc-end">
          {amount !== undefined && amount !== null && amount !== '' && <span className="rc-amount">{amount}</span>}
          <div className="rc-btns">
            {onCall && <button type="button" className="rc-call" aria-label="Call" onClick={onCall} data-testid="row-call"><Phone size={19} /></button>}
            {onMenu && <button type="button" className="rc-more" aria-label="More" onClick={onMenu} data-testid="row-menu"><MoreVertical size={19} /></button>}
          </div>
        </div>
      </div>
      {cells.length > 0 && (
        <Link to={to} className="rc-strip" data-testid="row-strip">
          {cells.map((c, i) => (
            <div key={i} className="rc-cell">
              {c.icon && <span className={`rc-cell-ic ${c.cls || ''}`}><c.icon size={18} /></span>}
              <span className="rc-cell-txt">
                <span className="rc-cell-l"><span className="ellipsis">{c.label}</span>{c.pill}</span>
                <span className={`rc-cell-v ${c.cls || ''}`}>{c.value}</span>
              </span>
            </div>
          ))}
          <ChevronRight size={18} className="rc-chev" />
        </Link>
      )}
    </div>
  );
}

/** the cell "Follow-up · 15 Oct · [Overdue]" */
export function followUpCell(v, done = false) {
  const st = dueState(v, done);
  return {
    icon: CalendarClock, label: 'Follow-up', value: v ? whenText(v) : 'Not planned',
    cls: st === 'overdue' ? 'is-red' : st === 'today' ? 'is-green' : v ? '' : 'is-faint',
    pill: v ? <DuePill state={st} /> : <span className="bdg bdg-grey bdg-sm">–</span>,
  };
}
export function lastCell(label, v, empty) {
  return { icon: Clock3, label, value: v ? whenText(v) : empty, cls: v ? '' : 'is-faint' };
}

/** the strip of key facts on a record page */
export function Facts({ items }) {
  const shown = items.filter((x) => x && x.value);
  if (!shown.length) return null;
  return (
    <div className="facts" data-testid="facts">
      {shown.map((x) => (
        <div key={x.label} className="fact">
          <span className="fact-ic"><x.icon size={17} /></span>
          <span className="fact-txt"><span className="fact-l">{x.label}</span><span className="fact-v">{x.value}</span></span>
        </div>
      ))}
    </div>
  );
}

/** a record this one belongs to, opening its page */
export function LinkCard({ to, label, title, icon: Icon, color, sub }) {
  const body = (
    <>
      <span className="ini" style={{ width: 38, height: 38, background: `color-mix(in srgb, ${color} 13%, #fff)`, color }}><Icon size={18} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="lc-label">{label}</span>
        <span className="lc-title ellipsis">{title}</span>
        {sub && <span className="lc-sub ellipsis">{sub}</span>}
      </span>
      {to && <ChevronRight size={18} className="faint" />}
    </>
  );
  return to ? <Link to={to} className="lc" data-testid="link-card">{body}</Link> : <div className="lc" data-testid="link-card">{body}</div>;
}

/** how a list is sorted */
export function SortSheet({ sorts, value, onPick, onClose }) {
  return (
    <Sheet title="Sort by" onClose={onClose}>
      <div className="list" data-testid="sort-sheet">
        {sorts.map((s) => (
          <button key={s.key} type="button" className="row" onClick={() => onPick(s.key)} data-testid={`sort-${s.key}`}>
            <span className="main title" style={{ fontWeight: value === s.key ? 700 : 500 }}>{s.label}</span>
            {value === s.key && <Check size={18} color="var(--brand)" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** the ⋮ menu of a row: [{ icon, label, onClick | to, color }] */
export function MenuSheet({ title, items, onClose, onGo }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list" data-testid="row-menu-sheet">
        {items.filter(Boolean).map((it) => {
          const inner = <><span className="ini" style={{ width: 34, height: 34, background: `color-mix(in srgb, ${it.color || '#4F46E5'} 12%, #fff)`, color: it.color || '#4F46E5' }}><it.icon size={17} /></span><span className="main title">{it.label}</span><ChevronRight size={16} className="faint" /></>;
          return it.to
            ? <Link key={it.label} to={it.to} className="row" style={{ color: 'inherit' }} onClick={onClose} data-testid={`menu-${it.key || it.label}`}>{inner}</Link>
            : <button key={it.label} type="button" className="row" onClick={() => { onClose(); (onGo || ((f) => f()))(it.onClick); }} data-testid={`menu-${it.key || it.label}`}>{inner}</button>;
        })}
      </div>
    </Sheet>
  );
}

export function copyText(text, say) {
  const done = () => say && say('Copied.', 'ok');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(String(text)).then(done, () => say && say(String(text))); return; }
  } catch { /* fall through */ }
  const t = document.createElement('textarea'); t.value = String(text); document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch { /* nothing */ } finally { t.remove(); }
}
