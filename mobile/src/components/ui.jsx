/* The small pieces every screen uses. */
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, Users, MapPin, Map as MapIcon, MoreHorizontal, Loader2, Search, WifiOff, CloudUpload, ReceiptText } from 'lucide-react';
import { useApp } from '../lib/app';
import { GET, qs } from '../lib/api';
import { mine } from '../lib/outbox';

export function TopBar({ title, sub, back = true, right = null, onBack }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back && <button type="button" className="icon-btn" aria-label="Back" onClick={() => (onBack ? onBack() : nav(-1))}><ArrowLeft size={22} /></button>}
      <h1>{title}{sub && <div className="sub">{sub}</div>}</h1>
      {right}
    </header>
  );
}

export function StatusBars() {
  const { online, outbox: all } = useApp();
  const outbox = mine(all);
  const waiting = outbox.filter((x) => x.state === 'waiting').length;
  const failed = outbox.filter((x) => x.state === 'failed').length;
  if (online && !waiting && !failed) return null;
  return (
    <>
      {!online && <div className="offline-bar" data-testid="offline-bar"><WifiOff size={15} /> No internet — your work is kept on the phone{waiting ? ` (${waiting} to send)` : ''}.</div>}
      {online && waiting > 0 && <div className="offline-bar" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><CloudUpload size={15} /> Sending {waiting}…</div>}
      {failed > 0 && <NavLink to="/more" className="offline-bar" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>{failed} could not be saved — tap to see why</NavLink>}
    </>
  );
}

export function BottomNav() {
  const { boot } = useApp();
  const mods = (boot && boot.modules) || [];
  const sfa = boot && boot.sfa && boot.sfa.enabled;
  const customers = mods.find((m) => m.api_name === 'accounts') || mods.find((m) => m.api_name === 'leads') || mods[0];
  const items = [
    { to: '/', label: 'Home', icon: Home, end: true },
    customers && { to: `/m/${customers.api_name}`, label: customers.plural || 'Customers', icon: Users },
    sfa && { to: '/nearby', label: 'Nearby', icon: MapPin },
    sfa && boot.me.is_manager ? { to: '/team', label: 'Team', icon: MapIcon } : (boot && boot.expenses ? { to: '/expenses', label: 'Expenses', icon: ReceiptText } : null),
    { to: '/more', label: 'More', icon: MoreHorizontal },
  ].filter(Boolean);
  return (
    <nav className="nav">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'on' : '')}>
          <it.icon size={22} />{it.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Loading({ text }) {
  return <div className="loading"><Loader2 className="spin" size={22} />{text && <span style={{ marginLeft: 8 }}>{text}</span>}</div>;
}
export function Empty({ icon: Icon, title, children }) {
  return <div className="empty">{Icon && <Icon size={34} strokeWidth={1.5} />}<div className="strong">{title}</div>{children}</div>;
}
export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className={`toast ${toast.tone}`} role="status" data-testid="toast">{toast.text}</div>;
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose} role="dialog" aria-label={title}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

const TONES = { ok: /won|active|complete|done|paid|accept|order|interest|convert|qualif|closed won/i, bad: /lost|reject|cancel|dead|not interest|junk|expired|overdue/i, warn: /pending|draft|follow|hold|due|open|new|scheduled|not started/i };
export function StatusTag({ value }) {
  if (!value) return null;
  const tone = TONES.ok.test(value) ? 'ok' : TONES.bad.test(value) ? 'bad' : TONES.warn.test(value) ? 'warn' : '';
  return <span className={`tag ${tone}`}>{value}</span>;
}

const COLORS = ['#3B5BFF', '#0D9488', '#D97706', '#C026D3', '#2563EB', '#16A34A', '#E11D48', '#7C3AED'];
export function Avatar({ name }) {
  const n = String(name || '?');
  const ini = n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const c = COLORS[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length];
  return <span className="avatar" style={{ background: c }}>{ini}</span>;
}

export function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

/** Choose a record of a module (a customer for a visit or an order). */
export function RecordPicker({ module, title, onPick, onClose, params = {} }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      GET(`/sfa/m/list/${module}${qs({ q, page_size: 40, ...params })}`)
        .then((x) => { if (mine === seq.current) { setRows(x.rows); setError(''); } })
        .catch((e) => { if (mine === seq.current) setError(e.message); });
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [module, q, JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="search" style={{ marginBottom: 10 }}>
        <Search size={18} />
        <input className="input" autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="picker-search" />
      </div>
      {error && <div className="note bad">{error}</div>}
      {!rows && !error && <Loading />}
      {rows && !rows.length && <Empty title="Nothing found" />}
      {rows && rows.length > 0 && (
        <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
          {rows.map((r) => (
            <button type="button" key={r.id} className="row" onClick={() => onPick(r)} data-testid="picker-row">
              <div className="main"><div className="title">{r.title}</div>{r.sub && <div className="line">{r.sub}</div>}</div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
