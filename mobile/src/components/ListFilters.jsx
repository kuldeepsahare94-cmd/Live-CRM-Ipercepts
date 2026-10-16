/*
 * The filters of a list (v1.4): several at once — status, the module's own
 * pick-lists (source, rating, industry…), the date it was added, and its own
 * date (follow-up, close, due…). What is chosen shows as chips under the search;
 * tap a chip's × to drop it. The app remembers them for each list.
 *
 *   value: { status: [], fields: { api: [] }, created: { from, to }, date: { from, to } }
 */
import { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { GET } from '../lib/api';
import { niceDate } from '../lib/format';
import { Sheet, Loading } from './ui';

const specs = new Map();       // the filters each list offers (asked once per app start)
export function useFilterSpec(module) {
  const [spec, setSpec] = useState(() => specs.get(module) || null);
  useEffect(() => {
    if (specs.has(module)) { setSpec(specs.get(module)); return; }
    setSpec(null);
    GET(`/sfa/m/filters/${module}`).then((s) => { specs.set(module, s); setSpec(s); }).catch(() => setSpec({ statuses: [], fields: [], view: { can: false } }));
  }, [module]);
  return spec;
}

export const EMPTY = { status: [], fields: {}, created: {}, date: {} };
export function countOf(v) {
  if (!v) return 0;
  return (v.status || []).length + Object.values(v.fields || {}).reduce((a, x) => a + (x || []).length, 0)
    + (v.created && (v.created.from || v.created.to) ? 1 : 0) + (v.date && (v.date.from || v.date.to) ? 1 : 0);
}
/** what goes to the server (nothing when nothing is chosen) */
export const asParam = (v) => (countOf(v) ? JSON.stringify(v) : '');
const span = (r) => (r.from && r.to ? `${niceDate(r.from)} – ${niceDate(r.to)}` : r.from ? `from ${niceDate(r.from)}` : `until ${niceDate(r.to)}`);

/** the chips of what is chosen, each with its × */
export function FilterChips({ value, spec, onChange }) {
  if (!countOf(value)) return null;
  const chips = [];
  (value.status || []).forEach((s) => chips.push({ k: `s-${s}`, text: s, drop: () => onChange({ ...value, status: value.status.filter((x) => x !== s) }) }));
  Object.entries(value.fields || {}).forEach(([api, vals]) => {
    const f = spec && spec.fields.find((x) => x.api_name === api);
    (vals || []).forEach((val) => {
      const label = f ? ((f.options.find((o) => o.value === val) || {}).label || val) : val;
      chips.push({ k: `f-${api}-${val}`, text: f ? `${f.label}: ${label}` : label, drop: () => onChange({ ...value, fields: { ...value.fields, [api]: vals.filter((x) => x !== val) } }) });
    });
  });
  if (value.created && (value.created.from || value.created.to)) chips.push({ k: 'created', text: `Added ${span(value.created)}`, drop: () => onChange({ ...value, created: {} }) });
  if (value.date && (value.date.from || value.date.to)) chips.push({ k: 'date', text: `${(spec && spec.date_label) || 'Date'} ${span(value.date)}`, drop: () => onChange({ ...value, date: {} }) });
  return (
    <div className="chips" data-testid="filter-chips">
      {chips.map((c) => <button key={c.k} type="button" className="chip on filter-chip" onClick={c.drop} data-testid="filter-chip">{c.text} <X size={14} /></button>)}
      <button type="button" className="chip" onClick={() => onChange(EMPTY)} data-testid="filter-clear">Clear all</button>
    </div>
  );
}

export function FilterButton({ count, onClick }) {
  return (
    <button type="button" className={`chip${count ? ' on' : ''}`} onClick={onClick} data-testid="filter-open">
      <SlidersHorizontal size={15} /> Filter{count ? ` · ${count}` : ''}
    </button>
  );
}

function Choices({ options, value, onChange, testid }) {
  return (
    <div className="chips" data-testid={testid}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return <button key={o.value} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} data-testid={`${testid}-opt`}>{o.label}</button>;
      })}
    </div>
  );
}
function Range({ label, value, onChange, testid }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="card-title" style={{ margin: 0 }}>{label}</div>
      <div className="grid2">
        <label className="field"><span>From</span><input className="input small-input" type="date" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} data-testid={`${testid}-from`} /></label>
        <label className="field"><span>To</span><input className="input small-input" type="date" value={value.to || ''} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} data-testid={`${testid}-to`} /></label>
      </div>
    </div>
  );
}

/** the panel: choose, then "Show N" (or "Clear") */
export function FilterSheet({ spec, value, onApply, onClose }) {
  const [v, setV] = useState(() => ({ ...EMPTY, ...value, fields: { ...(value.fields || {}) }, created: { ...(value.created || {}) }, date: { ...(value.date || {}) } }));
  return (
    <Sheet title="Filter" onClose={onClose}>
      {!spec ? <Loading /> : (
        <div className="col" style={{ gap: 16 }} data-testid="filter-sheet">
          {spec.statuses.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <div className="card-title" style={{ margin: 0 }}>{spec.status_label}</div>
              <Choices options={spec.statuses.map((s) => ({ value: s, label: s }))} value={v.status} onChange={(x) => setV({ ...v, status: x })} testid="filter-status" />
            </div>
          )}
          {spec.fields.map((f) => (
            <div key={f.api_name} className="col" style={{ gap: 6 }}>
              <div className="card-title" style={{ margin: 0 }}>{f.label}</div>
              <Choices options={f.options} value={v.fields[f.api_name] || []} onChange={(x) => setV({ ...v, fields: { ...v.fields, [f.api_name]: x } })} testid={`filter-f-${f.api_name}`} />
            </div>
          ))}
          {spec.date_label && <Range label={spec.date_label} value={v.date} onChange={(x) => setV({ ...v, date: x })} testid="filter-date" />}
          {spec.has_created && <Range label="Added" value={v.created} onChange={(x) => setV({ ...v, created: x })} testid="filter-created" />}
          <div className="picker-foot btns">
            <button type="button" className="btn outline" onClick={() => onApply(EMPTY)} data-testid="filter-reset">Clear</button>
            <button type="button" className="btn primary" onClick={() => onApply(v)} data-testid="filter-apply">Show{countOf(v) ? ` (${countOf(v)} filter${countOf(v) === 1 ? '' : 's'})` : ' all'}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
