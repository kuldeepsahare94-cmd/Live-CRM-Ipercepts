/*
 * Placement desk: the small pieces its screens are built from.
 * (Looks like the rest of the CRM: the same cards, buttons, inputs and colours.)
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Search, X } from 'lucide-react';
import { Badge } from '../../components/ui';
import { STAGE_TONE } from './pl';

export function Modal({ title, subtitle, onClose, children, footer, wide = false, busy = false, testid }) {
  const box = useRef(null);
  const now = useRef({ busy, onClose });
  now.current = { busy, onClose };
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !now.current.busy) { e.stopPropagation(); now.current.onClose(); } };
    window.addEventListener('keydown', key);
    const first = box.current && box.current.querySelector('[data-autofocus], input:not([type=hidden]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (first && window.matchMedia('(min-width: 640px)').matches) first.focus(); else if (box.current) box.current.focus();
    return () => window.removeEventListener('keydown', key);
  }, []);
  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(15,23,42,.5)' }}
      role="dialog" aria-modal="true" aria-label={title} data-testid={testid} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={box} tabIndex={-1} className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col outline-none`}
        style={{ maxHeight: '94dvh', background: 'var(--color-surface)' }}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--color-line)' }}>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink truncate">{title}</h2>
            {subtitle && <p className="t-meta mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={() => !busy && onClose()} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 shrink-0" style={{ color: 'var(--color-muted)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto thin-scroll flex-1 min-h-0">{children}</div>
        {footer && <div className="px-5 py-3 flex items-center justify-end gap-2 flex-wrap shrink-0" style={{ borderTop: '1px solid var(--color-line)' }}>{footer}</div>}
      </div>
    </div>
  ), document.body);
}

export function Field({ label, hint, children, className = '', required = false }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium mb-1 text-ink">{label}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}</span>
      {children}
      {hint && <span className="block t-meta mt-1">{hint}</span>}
    </label>
  );
}

export function Err({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-xl px-3 py-2.5 text-sm flex items-start gap-2 mb-3" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger-strong)' }}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div className="min-w-0">{children}</div>
    </div>
  );
}

export function Loading({ rows = 0 }) {
  return <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline" style={{ color: 'var(--color-faint)' }} />{rows ? null : null}</div>;
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="py-14 text-center px-4">
      {Icon && <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}><Icon className="w-6 h-6" /></div>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="t-meta mt-1 max-w-sm mx-auto">{children}</div>}
    </div>
  );
}

export function LoadError({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-sm mb-4 flex items-center gap-3" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger-strong)' }} role="alert">
      <span className="min-w-0 flex-1">{error}</span>
      {onRetry && <button type="button" className="underline font-medium" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export const StageBadge = ({ stage }) => <Badge tone={STAGE_TONE[stage] || 'neutral'}>{stage}</Badge>;

/** A row of choices: one is selected. */
export function Seg({ value, onChange, options, label }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--color-line)' }} role="radiogroup" aria-label={label}>
      {options.map(([v, text, n]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className="px-3 py-1.5 text-sm"
          style={value === v ? { background: 'var(--color-brand)', color: '#fff' } : { background: 'var(--color-surface)', color: 'var(--color-ink)' }}>
          {text}{n !== undefined && n !== null ? <span className="ml-1.5 opacity-70 text-xs">{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search', width = 260 }) {
  const [v, setV] = useState(value || '');
  const t = useRef(null);
  useEffect(() => { setV(value || ''); }, [value]);
  return (
    <div className="relative" style={{ width, maxWidth: '100%' }}>
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-faint)' }} />
      <input className="input" style={{ paddingLeft: 34 }} placeholder={placeholder} value={v} aria-label={placeholder}
        onChange={(e) => { const x = e.target.value; setV(x); clearTimeout(t.current); t.current = setTimeout(() => onChange(x), 280); }} />
    </div>
  );
}

/** One figure on a card. */
export function Stat({ icon: Icon, label, value, sub, tint = '#6C4FF7', onClick, testid, alert = false }) {
  const body = (
    <>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${tint}1F`, color: tint }}><Icon className="w-5 h-5" /></span>
      <span className="min-w-0 text-left">
        <span className="block text-xl font-bold text-ink leading-tight truncate">{value}</span>
        <span className="block t-meta truncate">{label}</span>
        {sub ? <span className="block text-[11px] mt-0.5 truncate" style={{ color: alert ? 'var(--color-danger-strong)' : 'var(--color-faint)' }}>{sub}</span> : null}
      </span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="card card-hover p-3.5 flex items-center gap-3 min-w-0 w-full" data-testid={testid}>{body}</button>
    : <div className="card p-3.5 flex items-center gap-3 min-w-0" data-testid={testid}>{body}</div>;
}

export const th = 'text-left text-[11px] font-semibold uppercase tracking-wide px-4 py-2.5 whitespace-nowrap';
export const td = 'px-4 py-3 align-middle';
export const rowStyle = { borderTop: '1px solid var(--color-line-soft)' };

/** A card with a heading. */
export function Panel({ title, action, children, className = '', pad = true, testid }) {
  return (
    <section className={`card ${className}`} data-testid={testid}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <h2 className="t-section">{title}</h2>
          {action}
        </div>
      )}
      <div className={pad ? 'px-4 pb-4' : ''}>{children}</div>
    </section>
  );
}

let toastTimer = null;
export function toast(message, tone = 'ok') {
  let el = document.getElementById('pl-toast');
  if (!el) { el = document.createElement('div'); el.id = 'pl-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = message;
  el.style.cssText = `position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:80;padding:10px 16px;border-radius:12px;font-size:13.5px;font-weight:500;box-shadow:0 8px 28px rgba(15,23,42,.25);color:#fff;background:${tone === 'bad' ? '#E11D48' : '#17233C'};max-width:90vw`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2800);
  el.style.display = 'block';
}

export function PersonCell({ name, sub }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-ink truncate">{name}</div>
      {sub ? <div className="t-meta truncate">{sub}</div> : null}
    </div>
  );
}

export function Skills({ text, max = 4 }) {
  const list = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {list.slice(0, max).map((s) => <span key={s} className="text-[11px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--color-canvas-alt)', color: 'var(--color-ink-light)' }}>{s}</span>)}
      {list.length > max ? <span className="text-[11px] px-1 py-0.5" style={{ color: 'var(--color-faint)' }}>+{list.length - max}</span> : null}
    </div>
  );
}
