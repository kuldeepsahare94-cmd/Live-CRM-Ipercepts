/*
 * More than one email address (v1.8): the main address is the record's own
 * email box; under it a "+" adds another. Each extra can be marked Opted out
 * (no mail) or Invalid (it bounces). Same rules as the web.
 */
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { GET } from '../lib/api';

export const looksLikeEmail = (v) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(v || '').trim());

export function cleanExtras(list) {
  return (Array.isArray(list) ? list : []).filter((x) => String(x.email || '').trim())
    .map((x) => ({ email: String(x.email).trim(), opted_out: !!x.opted_out, invalid: !!x.invalid }));
}

export function extraProblem(list, main) {
  const seen = new Set([String(main || '').trim().toLowerCase()].filter(Boolean));
  for (const x of cleanExtras(list)) {
    if (!looksLikeEmail(x.email)) return `"${x.email}" is not a valid email address.`;
    if (seen.has(x.email.toLowerCase())) return `${x.email} is entered twice.`;
    seen.add(x.email.toLowerCase());
  }
  return '';
}

/** the extra addresses of a record; null while loading or when the server has none to give */
export function useExtraEmails(module, id) {
  const [list, setList] = useState(id ? null : []);
  useEffect(() => {
    let off = false;
    if (!id) { setList([]); return undefined; }
    GET(`/record-emails/${module}/${id}`).then((r) => { if (!off) setList(Array.isArray(r) ? r : []); }).catch(() => { if (!off) setList([]); });
    return () => { off = true; };
  }, [module, id]);
  return list;
}

/** the email box with its "+" and the extra rows */
export function EmailsInput({ value, onChange, extras, onExtras, testid }) {
  const list = Array.isArray(extras) ? extras : [];
  const setRow = (i, patch) => onExtras(list.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <div className="col" style={{ gap: 8 }} data-testid="emails-field">
      <div className="flex" style={{ gap: 8 }}>
        <input className="input grow" type="email" inputMode="email" autoCapitalize="none" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} placeholder="Main email" />
        <button type="button" className="icon-btn" aria-label="Add another email address" data-testid="email-add" disabled={list.length >= 10}
          onClick={() => onExtras([...list, { email: '', opted_out: false, invalid: false }])}><Plus size={20} /></button>
      </div>
      {list.map((x, i) => (
        <div key={i} className="col" style={{ gap: 6 }} data-testid="email-extra">
          <div className="flex" style={{ gap: 8 }}>
            <input className="input grow" type="email" inputMode="email" autoCapitalize="none" value={x.email} placeholder="Another email" aria-label={`Email ${i + 2}`}
              style={x.opted_out || x.invalid ? { textDecoration: 'line-through' } : undefined}
              onChange={(e) => setRow(i, { email: e.target.value })} />
            <button type="button" className="icon-btn" aria-label="Remove this email address" onClick={() => onExtras(list.filter((_, n) => n !== i))}><X size={20} /></button>
          </div>
          <div className="chips">
            <button type="button" className={`chip${x.opted_out ? ' on' : ''}`} aria-pressed={!!x.opted_out} onClick={() => setRow(i, { opted_out: !x.opted_out })}>Opted out</button>
            <button type="button" className={`chip${x.invalid ? ' on' : ''}`} aria-pressed={!!x.invalid} onClick={() => setRow(i, { invalid: !x.invalid })}>Invalid</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** the extra addresses for reading: each a mail link, marked */
export function ExtraList({ list, onMail }) {
  if (!Array.isArray(list) || !list.length) return null;
  return (
    <div className="col" style={{ gap: 4, width: '100%' }} data-testid="extra-emails">
      {list.map((x) => (
        <div key={x.email} className="flex small" style={{ gap: 8 }}>
          <a href={`mailto:${x.email}`} className="grow ellipsis" onClick={(e) => { if (onMail) { e.preventDefault(); onMail(x.email); } }}
            style={x.opted_out || x.invalid ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{x.email}</a>
          {x.opted_out && <span className="tiny faint">Opted out</span>}
          {x.invalid && <span className="tiny faint">Invalid</span>}
        </div>
      ))}
    </div>
  );
}
