/*
 * Quick edit (v1.5): the few things changed after almost every call or visit,
 * in one small sheet, saved with one tap —
 *   the status (and a lead's rating: Hot / Warm / Cold),
 *   the next follow-up (this evening, tomorrow, in 3 days, next week, or a time),
 *   a note (typed or spoken).
 * Only what is changed is saved, through the CRM's normal links (the same rules
 * as the full form). "Reschedule" is the same sheet with only the follow-up.
 */
import { useMemo, useState } from 'react';
import { Loader2, Check, BellRing } from 'lucide-react';
import { POST, PUT, PATCH } from '../lib/api';
import { useApp } from '../lib/app';
import { addDays, today, niceDate, niceTime } from '../lib/format';
import { Sheet, Field, VoiceArea } from './ui';

const STATUS_FIELD = { leads: 'status', contacts: 'contact_status', accounts: 'status', quotations: 'status', subscriptions: 'status', tasks: 'status', meetings: 'status' };
const at = (day, hm) => { const [y, m, d] = day.split('-').map(Number); const [h, mi] = hm.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const local = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
const toIso = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };

/** the quick choices for a follow-up time, from now */
export function quickTimes() {
  const now = new Date();
  const out = [];
  const in2h = new Date(now.getTime() + 2 * 3600000); in2h.setMinutes(0, 0, 0);
  if (in2h.getHours() < 20 && in2h.toDateString() === now.toDateString()) out.push({ key: '2h', label: 'In 2 hours', when: in2h });
  const evening = at(today(), '18:00');
  if (evening - now > 45 * 60000) out.push({ key: 'evening', label: 'This evening', when: evening });
  out.push({ key: 'tomorrow', label: 'Tomorrow', when: at(addDays(today(), 1), '11:00') });
  out.push({ key: '3days', label: 'In 3 days', when: at(addDays(today(), 3), '11:00') });
  out.push({ key: 'week', label: 'Next week', when: at(addDays(today(), 7), '11:00') });
  return out;
}

/** the time chosen: a quick choice or a picked date and time (null = none) */
function chosenTime(follow, followAt) {
  if (!follow) return null;
  const when = follow === 'pick' ? new Date(followAt) : (quickTimes().find((q) => q.key === follow) || {}).when;
  return when && !Number.isNaN(when.getTime()) ? when : null;
}

export function FollowUpPicker({ value, onChange, pickAt, onPickAt, allowNone = true, testid = 'qe' }) {
  const quick = useMemo(quickTimes, []);
  const when = chosenTime(value, pickAt);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="chips" data-testid={`${testid}-follow-picks`}>
        {allowNone && <button type="button" className={`chip${value === '' ? ' on' : ''}`} onClick={() => onChange('')}>No change</button>}
        {quick.map((q) => <button key={q.key} type="button" className={`chip${value === q.key ? ' on' : ''}`} onClick={() => onChange(q.key)} data-testid={`${testid}-follow-${q.key}`}>{q.label}</button>)}
        <button type="button" className={`chip${value === 'pick' ? ' on' : ''}`} onClick={() => onChange('pick')} data-testid={`${testid}-follow-pick`}>Pick</button>
      </div>
      {value === 'pick' && <input className="input" type="datetime-local" value={pickAt} min={local(new Date())} onChange={(e) => onPickAt(e.target.value)} data-testid={`${testid}-follow-at`} />}
      {when && value !== 'pick' && <div className="tiny muted">{when.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
    </div>
  );
}

/**
 * @param module, id, title   the record
 * @param row                 the record as loaded (its status now), if there
 * @param followUp            its open follow-up { id, due_at, has_time } — moved instead of a new one
 * @param only                'follow' = Reschedule (only the follow-up)
 */
export default function QuickEdit({ module, id, title, row = null, followUp = null, only = '', onClose, onSaved }) {
  const { module: modOf, say } = useApp();
  const mod = modOf(module);
  const statusApi = STATUS_FIELD[module];
  const fieldOf = (api) => (mod && api ? (mod.fields || []).find((f) => f.api_name === api && (f.options || []).length) : null);
  const sField = only ? null : fieldOf(statusApi);
  const rField = only || module !== 'leads' ? null : fieldOf('lead_rating');
  const canEdit = !!(mod && mod.can && mod.can.edit);
  const [status, setStatus] = useState(row && statusApi ? row[statusApi] || '' : '');
  const [rating, setRating] = useState(row ? row.lead_rating || '' : '');
  const [follow, setFollow] = useState(only ? 'tomorrow' : '');
  const [pickAt, setPickAt] = useState(local(at(addDays(today(), 1), '11:00')));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = (f, cur) => { const l = f.options.map((o) => o.value); return cur && !l.includes(cur) ? [cur, ...l] : l; };

  const save = async () => {
    if (busy) return;
    setError('');
    const changes = {};
    if (sField && canEdit && status && status !== (row ? row[statusApi] || '' : '')) changes[statusApi] = status;
    if (rField && canEdit && rating !== (row ? row.lead_rating || '' : '')) changes.lead_rating = rating || null;
    const when = chosenTime(follow, pickAt);
    if (follow && !when) { setError('Pick the day and time of the follow-up.'); return; }
    if (when && when.getTime() < Date.now() - 60000) { setError('Pick a follow-up time in the future.'); return; }
    if (!Object.keys(changes).length && !when && !note.trim()) { onClose(); return; }
    setBusy(true);
    const done = [];
    try {
      if (Object.keys(changes).length) { await PUT(`/${module}/${id}`, changes); done.push(changes[statusApi] ? `status ${changes[statusApi]}` : 'rating'); }
      if (when) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (followUp && followUp.id) await PATCH(`/follow-ups/${followUp.id}`, { due_at: when.toISOString(), has_time: true, time_zone: tz });
        else await POST('/follow-ups', { module, record_id: Number(id), due_at: when.toISOString(), has_time: true, date: local(when).slice(0, 10), time_zone: tz, subject: 'Follow-up', notes: note.trim() || undefined });
        done.push(`follow-up ${niceDate(when.toISOString())} ${niceTime(when.toISOString())}`);
      }
      if (note.trim() && !only) { await POST('/notes', { body: note.trim(), related_module: module, related_record_id: Number(id) }); done.push('note'); }
      say(`Saved: ${done.join(', ')}.`, 'ok');
      onSaved && onSaved({ changes, when });
    } catch (e) {
      // (what was typed stays; what was already saved is not sent twice)
      setError(e.offline ? 'No internet: try again when online.' : e.message);
      if (done.length) say(`Saved: ${done.join(', ')}. The rest was not.`, 'error');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={only ? `Reschedule · ${title}` : `Quick edit · ${title}`} onClose={onClose}>
      <div className="col" style={{ gap: 14 }} data-testid="quick-edit">
        {sField && canEdit && (
          <div className="col" style={{ gap: 6 }}>
            <div className="card-title" style={{ margin: 0 }}>{sField.label}</div>
            <div className="chips" data-testid="qe-status">
              {options(sField, status).map((v) => <button key={v} type="button" className={`chip${status === v ? ' on' : ''}`} onClick={() => setStatus(v)} data-testid="qe-status-opt">{v}</button>)}
            </div>
          </div>
        )}
        {rField && canEdit && (
          <div className="col" style={{ gap: 6 }}>
            <div className="card-title" style={{ margin: 0 }}>{rField.label}</div>
            <div className="chips" data-testid="qe-rating">
              {options(rField, rating).map((v) => <button key={v} type="button" className={`chip${rating === v ? ' on' : ''}`} onClick={() => setRating(rating === v ? '' : v)} data-testid="qe-rating-opt">{v}</button>)}
            </div>
          </div>
        )}
        <div className="col" style={{ gap: 6 }}>
          <div className="card-title" style={{ margin: 0 }}><BellRing size={14} /> {followUp ? 'Move the follow-up' : 'Next follow-up'}</div>
          {followUp && followUp.due_at && <div className="tiny muted" data-testid="qe-now">Now: {niceDate(toIso(followUp.due_at))}{followUp.has_time ? ` · ${niceTime(toIso(followUp.due_at))}` : ''}</div>}
          <FollowUpPicker value={follow} onChange={setFollow} pickAt={pickAt} onPickAt={setPickAt} allowNone={!only} />
        </div>
        {!only && <Field label="Note (if you like)"><VoiceArea value={note} onChange={setNote} placeholder="Type, or tap the mic and speak" testid="qe-note" /></Field>}
        {error && <div className="note bad small" data-testid="qe-error">{error}</div>}
        <div className="picker-foot btns">
          <button type="button" className="btn outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy} data-testid="qe-save">{busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />} Save</button>
        </div>
      </div>
    </Sheet>
  );
}
