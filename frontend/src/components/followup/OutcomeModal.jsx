/*
 * Dispose call — the red "Dispose" button: "what happened" and "what happens next".
 *
 *   1. Response     Was the call connected? (the call timer runs from open,
 *                   stops on the answer; the seconds feed the Call Reports)
 *   2. Disposition  From the connected / not-connected lists, the lead's
 *                   status, notes
 *   3. Next action  Schedule a follow-up (exact date + time, who to remind)
 *                   — or close: no further follow-up.
 *
 * The separate green "Schedule Call" button is gone: its job (setting the next
 * follow-up) is now step 3 here, so follow-ups are set one way only.
 * Disposing a call completes the follow-up that was waiting for it.
 *
 * mode="schedule" skips the call and only schedules (or reschedules) the
 * follow-up — used by the follow-up card's "Schedule" / "Reschedule".
 */
import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, X, Check, CalendarClock, CircleSlash, Info } from 'lucide-react';
import { api } from '../../api';
import { friendlyError } from '../ui';
import { useModuleOptions, useSharedOptions, selectableOptions } from '../fieldOptions';
import FollowUpScheduleFields, { validateSchedule } from './FollowUpScheduleFields';
import { quickPicks, isoToLocalParts, browserTimeZone, formatDue } from './time';

const hhmmss = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  .map((n) => String(n).padStart(2, '0')).join(':');

// Used only if the Lead Status options cannot be loaded.
const FALLBACK_LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Follow-up', 'Converted', 'Not Interested', 'Dropped'];

// The lead status that usually follows an outcome, so the agent isn't
// re-picking the obvious thing on every call. Always editable.
const STATUS_HINT = {
  Interested: 'Interested',
  'Follow-up scheduled': 'Follow-up',
  Converted: 'Converted',
  'Not interested': 'Not Interested',
  'Already purchased': 'Not Interested',
  'Wrong number': 'Dropped',
  'Invalid number': 'Dropped',
};
// Outcomes that normally end the conversation; everything else suggests a follow-up.
const CLOSING = new Set(['Not interested', 'Already purchased', 'Wrong number', 'Invalid number', 'Converted']);

function defaultWhen(connected) {
  const picks = quickPicks();
  const p = connected === false ? picks.find((x) => x.label === 'In 1 hour') : picks.find((x) => x.label === 'Tomorrow 10 AM');
  return p ? { date: p.date, time: p.time } : { date: '', time: '' };
}

function Step({ n, title, children, done }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
          style={done ? { background: 'var(--color-success)', color: '#fff' } : { background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>
          {done ? <Check className="w-3 h-3" /> : n}
        </span>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export default function OutcomeModal({ subject, mode = 'outcome', followUp = null, ownerName, onClose, onSaved }) {
  const scheduleOnly = mode === 'schedule';
  const isLead = subject.module === 'leads';

  // Call timer: starts the moment the modal opens — that is the "call".
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(!scheduleOnly);
  const [connected, setConnected] = useState(scheduleOnly ? true : null);
  const [disposition, setDisposition] = useState('');
  const [leadStatus, setLeadStatus] = useState(subject.status || '');
  const [notes, setNotes] = useState('');
  const [nextAction, setNextAction] = useState('schedule');
  const [nextTouched, setNextTouched] = useState(false);
  const [schedule, setSchedule] = useState(() => {
    if (followUp) {
      const p = isoToLocalParts(followUp.snoozed_until || followUp.due_at);
      return { ...p, time: followUp.has_time ? p.time : '', notes: followUp.notes || '', assigned_user_id: followUp.assigned_user_id || null };
    }
    return { ...defaultWhen(true), notes: '', assigned_user_id: null };
  });
  const [schedErrors, setSchedErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const formStart = useRef(null);

  const yes = useSharedOptions('call_disposition_connected');
  const no = useSharedOptions('call_disposition_not_connected');
  const leadOptions = useModuleOptions(isLead ? 'leads' : null);
  const statusOptions = selectableOptions(leadOptions?.status, subject.status, FALLBACK_LEAD_STATUSES);

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const answerConnected = (val) => {
    setConnected(val);
    setDisposition('');
    setRunning(false);              // stop the call clock once the call ends
    formStart.current = Date.now();
    if (!followUp) setSchedule((s) => ({ ...s, ...defaultWhen(val) }));
  };

  const pickDisposition = (value, label) => {
    setDisposition(value);
    const hint = STATUS_HINT[label] || STATUS_HINT[value];
    if (hint && statusOptions.some((o) => o.value === hint)) setLeadStatus(hint);
    if (!nextTouched) setNextAction(CLOSING.has(label) || CLOSING.has(value) ? 'close' : 'schedule');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!scheduleOnly && !disposition) { setError('Pick a disposition.'); return; }
    let iso = null;
    if (scheduleOnly || nextAction === 'schedule') {
      const v = validateSchedule(schedule);
      setSchedErrors(v.errors);
      if (Object.keys(v.errors).length) { setError('Pick the follow-up date and time.'); return; }
      iso = v.iso;
    }
    setSaving(true);
    try {
      let res;
      if (scheduleOnly) {
        const body = {
          due_at: iso, has_time: true, time_zone: browserTimeZone(), notes: schedule.notes || null,
          assigned_user_id: schedule.assigned_user_id,
        };
        res = followUp
          ? await api.rescheduleFollowUp(followUp.id, body)
          : await api.scheduleFollowUp({ module: subject.module, record_id: subject.id, ...body });
      } else {
        res = await api.disposeCall({
          related_module: subject.module,
          related_record_id: subject.id,
          phone_number: subject.phone || null,
          connected,
          disposition,
          duration_seconds: seconds,
          form_seconds: formStart.current ? Math.round((Date.now() - formStart.current) / 1000) : 0,
          lead_status: isLead ? (leadStatus || undefined) : undefined,
          notes: notes || undefined,
          next_action: nextAction,
          ...(nextAction === 'schedule' ? {
            follow_up_at: iso,
            follow_up_has_time: true,
            follow_up_time_zone: browserTimeZone(),
            follow_up_notes: schedule.notes || null,
            follow_up_assigned_user_id: schedule.assigned_user_id,
          } : {}),
        });
      }
      onSaved?.(res);
    } catch (err) {
      setError(friendlyError(err, 'Could not save.').message);
    } finally { setSaving(false); }
  };

  const list = (connected ? yes : no) || [];
  const offered = list.filter((o) => o.active !== false);
  const showForm = connected !== null;
  const title = scheduleOnly ? (followUp ? 'Reschedule follow-up' : 'Schedule follow-up') : 'Dispose call';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true"
      aria-label={`${title} — ${subject.name}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={submit} className="card relative w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 className="t-section">{title}</h2>
            <p className="t-meta truncate">{subject.name}{subject.phone ? ` · ${subject.phone}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {!scheduleOnly && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full"
                style={{ background: running ? 'var(--color-danger-soft)' : 'var(--color-neutral-soft)',
                  color: running ? 'var(--color-danger)' : 'var(--color-muted)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: running ? 'var(--color-danger)' : 'var(--color-neutral)' }} />
                <span className="text-sm font-medium tabular-nums">{hhmmss(seconds)}</span>
                <span className="text-xs hidden sm:inline">{running ? 'on call' : 'ended'}</span>
              </div>
            )}
            <button type="button" onClick={onClose} aria-label="Close"
              className="text-[var(--color-faint)] hover:text-ink p-1 rounded-lg hover:bg-[var(--color-canvas)]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto thin-scroll space-y-5">
          {error && (
            <div className="text-xs rounded-lg px-3 py-2" role="alert"
              style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}>{error}</div>
          )}

          {!scheduleOnly && (
            <Step n={1} title="Response" done={connected !== null}>
              {connected === null ? (
                <div className="text-center py-2">
                  <p className="text-sm text-ink mb-3">Was the call connected?</p>
                  <div className="flex justify-center gap-3 flex-wrap">
                    <button type="button" onClick={() => answerConnected(false)} className="btn text-white" style={{ background: 'var(--color-danger)' }}>
                      <PhoneOff className="w-4 h-4" /> Not connected
                    </button>
                    <button type="button" onClick={() => answerConnected(true)} className="btn text-white" style={{ background: 'var(--color-success)' }}>
                      <Phone className="w-4 h-4" /> Yes, connected
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink flex items-center gap-2">
                  {connected ? <Phone className="w-4 h-4" style={{ color: 'var(--color-success)' }} /> : <PhoneOff className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />}
                  {connected ? 'Connected' : 'Not connected'} · {hhmmss(seconds)}
                  <button type="button" onClick={() => { setConnected(null); setRunning(true); }} className="text-xs font-medium ml-1" style={{ color: 'var(--color-brand)' }}>Change</button>
                </p>
              )}
            </Step>
          )}

          {!scheduleOnly && showForm && (
            <Step n={2} title="Disposition" done={!!disposition}>
              <div className="flex flex-wrap gap-2">
                {offered.map((o) => (
                  <button key={o.value} type="button" onClick={() => pickDisposition(o.value, o.label)}
                    aria-pressed={disposition === o.value}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                    style={disposition === o.value
                      ? { background: 'var(--color-brand)', color: '#fff', borderColor: 'var(--color-brand)' }
                      : { borderColor: 'var(--color-line)', color: 'var(--color-muted)' }}>
                    {o.label}
                  </button>
                ))}
                {(yes !== null || no !== null) && offered.length === 0 && (
                  <p className="t-meta">No dispositions configured — add them in Settings → Dropdown Options.</p>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                {/* Only leads have a funnel status. Showing this on another
                    module would offer a control that changes nothing. */}
                {isLead && (
                  <div>
                    <label className="t-meta font-medium block mb-1" htmlFor="oc-status">Update lead status</label>
                    <select id="oc-status" className="input w-full" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
                      <option value="">Leave unchanged</option>
                      {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                )}
                <div className={isLead ? '' : 'sm:col-span-2'}>
                  <label className="t-meta font-medium block mb-1" htmlFor="oc-notes">Notes</label>
                  <textarea id="oc-notes" className="input w-full" rows={isLead ? 1 : 2} value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="What was discussed?" />
                </div>
              </div>
            </Step>
          )}

          {(scheduleOnly || showForm) && (
            <Step n={scheduleOnly ? 1 : 3} title={scheduleOnly ? 'When' : 'Next action'}>
              {!scheduleOnly && (
                <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Next action">
                  {[
                    { key: 'schedule', label: 'Schedule follow-up', hint: 'Remind at an exact date & time', icon: CalendarClock },
                    { key: 'close', label: 'Close — no follow-up', hint: 'Dispose without a next step', icon: CircleSlash },
                  ].map((a) => (
                    <button key={a.key} type="button" role="radio" aria-checked={nextAction === a.key}
                      onClick={() => { setNextAction(a.key); setNextTouched(true); }}
                      className="text-left rounded-xl border px-3 py-2.5 transition-colors"
                      style={nextAction === a.key
                        ? { borderColor: 'var(--color-brand)', background: 'var(--color-brand-soft)' }
                        : { borderColor: 'var(--color-line)' }}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <a.icon className="w-4 h-4" style={{ color: nextAction === a.key ? 'var(--color-brand)' : 'var(--color-muted)' }} /> {a.label}
                      </span>
                      <span className="t-meta">{a.hint}</span>
                    </button>
                  ))}
                </div>
              )}

              {(scheduleOnly || nextAction === 'schedule') && (
                <FollowUpScheduleFields value={schedule} errors={schedErrors} ownerName={ownerName}
                  onChange={(patch) => { setSchedule((s) => ({ ...s, ...patch })); setSchedErrors({}); }} />
              )}

              {!scheduleOnly && followUp && (
                <p className="t-meta mt-3 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Saving marks the follow-up that was due {formatDue(followUp)} as completed.
                </p>
              )}
            </Step>
          )}
        </div>

        {(scheduleOnly || showForm) && (
          <div className="flex justify-between items-center gap-2 px-5 py-4 border-t border-line shrink-0">
            <span className="t-meta">{scheduleOnly ? '' : `Call time ${hhmmss(seconds)}`}</span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn btn-primary disabled:opacity-50">
                <Check className="w-4 h-4" />
                {saving ? 'Saving…'
                  : scheduleOnly ? (followUp ? 'Save new time' : 'Schedule follow-up')
                    : 'Save disposition'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
