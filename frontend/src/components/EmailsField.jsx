/*
 * More than one email address, SuiteCRM style (v1.8).
 *
 * The main address is the record's own email box. Under it, a "+" adds another
 * row. Every extra row can be marked "Opted out" (do not send it mail) or
 * "Invalid" (it bounces), made the main address, or removed.
 *
 *   <EmailsField field={f} value={values.email} onChange={…}
 *                extras={values._extra_emails} onExtras={…} />
 *
 * `extras` is [{ email, opted_out, invalid }]. The form that holds it sends it
 * with the record (`_extra_emails`) and the server keeps it.
 */
import { useEffect, useState } from 'react';
import { Plus, X, Star, Ban, AlertTriangle } from 'lucide-react';
import { api } from '../api';

const looksLikeEmail = (v) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(v || '').trim());

export function EmailsField({ field, value, onChange, extras, onExtras, inputClass = 'input w-full', error = '' }) {
  const list = Array.isArray(extras) ? extras : [];
  const setRow = (i, patch) => onExtras(list.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const remove = (i) => onExtras(list.filter((_, n) => n !== i));
  const add = () => { if (list.length < 10) onExtras([...list, { email: '', opted_out: false, invalid: false }]); };
  // the row becomes the main address; the old main address takes its place in the list
  const makeMain = (i) => {
    const row = list[i];
    const old = String(value || '').trim();
    const next = list.filter((_, n) => n !== i);
    if (old) next.unshift({ email: old, opted_out: false, invalid: false });
    onChange(row.email);
    onExtras(next);
  };
  const dup = (i) => {
    const low = String(list[i].email || '').trim().toLowerCase();
    return !!low && (low === String(value || '').trim().toLowerCase() || list.some((x, n) => n !== i && String(x.email || '').trim().toLowerCase() === low));
  };
  return (
    <div className="space-y-1.5" data-testid="emails-field">
      <div className="flex items-center gap-2">
        <input type="email" className={`${inputClass} min-w-0 flex-1`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Main email" aria-label={`${field.label || 'Email'} (main)`} data-testid="email-main" />
        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-1 rounded shrink-0" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>Main</span>
        <button type="button" onClick={add} disabled={list.length >= 10} title="Add another email address" aria-label="Add another email address" data-testid="email-add"
          className="w-9 h-9 shrink-0 rounded-lg border border-line flex items-center justify-center hover:bg-[var(--color-canvas)] disabled:opacity-40">
          <Plus className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
        </button>
      </div>
      {list.map((x, i) => {
        const wrong = (x.email && !looksLikeEmail(x.email)) || dup(i);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2" data-testid="email-extra">
            <input type="email" className={`${inputClass} flex-1 min-w-[190px]`} value={x.email} onChange={(e) => setRow(i, { email: e.target.value })} placeholder="Another email" aria-label={`Email ${i + 2}`}
              style={wrong ? { boxShadow: '0 0 0 2px var(--color-danger)' } : (x.opted_out || x.invalid) ? { textDecoration: 'line-through', color: 'var(--color-muted)' } : undefined} autoFocus={!x.email && i === list.length - 1} />
            <span className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setRow(i, { opted_out: !x.opted_out })} aria-pressed={!!x.opted_out} title="Opted out: do not send mail to this address"
              className="h-9 px-2 shrink-0 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1"
              style={x.opted_out ? { background: 'var(--color-warning-soft)', color: 'var(--color-warning-strong)', borderColor: 'var(--color-warning-soft)' } : { borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
              <Ban className="w-3.5 h-3.5" /> <span>Opted out</span>
            </button>
            <button type="button" onClick={() => setRow(i, { invalid: !x.invalid })} aria-pressed={!!x.invalid} title="Invalid: this address bounces"
              className="h-9 px-2 shrink-0 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1"
              style={x.invalid ? { background: 'var(--color-danger-soft)', color: 'var(--color-danger-strong)', borderColor: 'var(--color-danger-soft)' } : { borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> <span>Invalid</span>
            </button>
            <button type="button" onClick={() => makeMain(i)} disabled={!looksLikeEmail(x.email)} title="Make this the main email address" aria-label="Make this the main email address"
              className="w-9 h-9 shrink-0 rounded-lg border border-line flex items-center justify-center hover:bg-[var(--color-canvas)] disabled:opacity-40"><Star className="w-4 h-4" style={{ color: 'var(--color-muted)' }} /></button>
            <button type="button" onClick={() => remove(i)} title="Remove this address" aria-label="Remove this email address"
              className="w-9 h-9 shrink-0 rounded-lg border border-line flex items-center justify-center hover:bg-[var(--color-canvas)]"><X className="w-4 h-4" style={{ color: 'var(--color-muted)' }} /></button>
            </span>
          </div>
        );
      })}
      {error && <p className="text-[11px]" role="alert" data-testid="err-email" style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}

/** The extra addresses for reading (a detail page): each is a mail link, with its marks. */
export function ExtraEmails({ list }) {
  if (!Array.isArray(list) || !list.length) return null;
  return (
    <span className="block mt-1 space-y-0.5" data-testid="extra-emails">
      {list.map((x) => (
        <span key={x.email} className="block text-[13px]">
          <a href={`mailto:${x.email}`} className={`hover:underline ${x.opted_out || x.invalid ? 'line-through text-[var(--color-muted)]' : 'text-[var(--color-brand)]'}`}>{x.email}</a>
          {x.opted_out && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning-strong)' }}>Opted out</span>}
          {x.invalid && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger-strong)' }}>Invalid</span>}
        </span>
      ))}
    </span>
  );
}

/** What is wrong with the extra addresses, as one message (empty when fine). */
export function extraEmailProblem(extras, primary) {
  const list = Array.isArray(extras) ? extras : [];
  const seen = new Set([String(primary || '').trim().toLowerCase()].filter(Boolean));
  for (const x of list) {
    const e = String(x.email || '').trim();
    if (!e) continue;
    if (!looksLikeEmail(e)) return `"${e}" is not a valid email address.`;
    if (seen.has(e.toLowerCase())) return `${e} is entered twice.`;
    seen.add(e.toLowerCase());
  }
  return '';
}

/** Rows to send: empty rows dropped */
export const cleanExtras = (extras) => (Array.isArray(extras) ? extras.filter((x) => String(x.email || '').trim()).map((x) => ({ email: String(x.email).trim(), opted_out: !!x.opted_out, invalid: !!x.invalid })) : []);

/** The extra addresses of one record, loaded for a detail page. `again` is any value that changes when the record is reloaded. */
export function useRecordEmails(module, id, again) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let off = false;
    if (!module || !id) { setList([]); return undefined; }
    api.recordEmails(module, id).then((r) => { if (!off) setList(Array.isArray(r) ? r : []); }).catch(() => { if (!off) setList([]); });
    return () => { off = true; };
  }, [module, id, again]);
  return list;
}
