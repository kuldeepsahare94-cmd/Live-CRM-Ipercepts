/*
 * Placement desk (app): the small sheets — how a call went, the result of an
 * interview, moving a candidate to another stage, putting one on an opening.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../../lib/app';
import { GET, POST, PUT } from '../../lib/api';
import { P, cachedMeta, followChoices, saveContact, clearPlCall } from '../../lib/placement';
import { today } from '../../lib/format';
import { Sheet, Field, VoiceArea } from '../ui';

const Chips = ({ items, value, onPick, testid }) => (
  <div className="chips" role="radiogroup">
    {items.map((it) => {
      const [v, label] = Array.isArray(it) ? it : [it, it];
      return <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`chip${value === v ? ' on' : ''}`} onClick={() => onPick(v)} data-testid={testid ? `${testid}-${String(label).replace(/\s+/g, '-')}` : undefined}>{label}</button>;
    })}
  </div>
);

/** How did the call go? Saved through the outbox (also offline). */
export function CallOutcome({ person, onClose, onSaved }) {
  const { say, sync } = useApp();
  const m = cachedMeta();
  const choices = useMemo(() => followChoices(), []);
  const [outcome, setOutcome] = useState('');
  const [remark, setRemark] = useState('');
  const [next, setNext] = useState(choices[0][0]);
  const [busy, setBusy] = useState(false);
  // "Call back" and "Not reachable" usually need a next call: tomorrow is suggested
  useEffect(() => { if (['Call back', 'Not reachable'].includes(outcome) && !next) setNext(choices[1][0]); }, [outcome]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!outcome) { say('Choose how the call went.', 'error'); return; }
    setBusy(true);
    try {
      saveContact({ id: person.id, name: person.name, outcome, remark: remark.trim(), next });
      clearPlCall();
      sync();
      say(next ? 'Saved. A follow-up is set.' : 'Saved.', 'ok');
      onSaved && onSaved();
    } catch (e) { say(e.message, 'error'); setBusy(false); }
  };
  const skip = () => { clearPlCall(); onClose(); };
  return (
    <Sheet title={`How did the call with ${person.name || 'the candidate'} go?`} onClose={skip}>
      <div className="col" style={{ gap: 12 }} data-testid="call-outcome">
        <Chips items={m.contact_outcomes} value={outcome} onPick={setOutcome} testid="co" />
        <Field label="Note (you can speak it)"><VoiceArea value={remark} onChange={setRemark} rows={3} placeholder="What was said, what the candidate wants" testid="co-remark" /></Field>
        <div className="field"><span>Next call</span><Chips items={choices} value={next} onPick={setNext} testid="co-next" /></div>
        <div className="btns">
          <button type="button" className="btn outline" onClick={skip} disabled={busy}>Not now</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !outcome} data-testid="co-save">{busy ? <Loader2 className="spin" size={18} /> : null} Save</button>
        </div>
      </div>
    </Sheet>
  );
}

/** The result of an interview. */
export function InterviewResult({ iv, onClose, onSaved }) {
  const { say } = useApp();
  const m = cachedMeta();
  const [result, setResult] = useState('Cleared');
  const [feedback, setFeedback] = useState(iv.feedback || '');
  const [reason, setReason] = useState(m.reject_reasons[0]);
  const [advance, setAdvance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      await PUT(P(`/interviews/${iv.id}`), { result, feedback: feedback.trim(), reason: result === 'Rejected' ? reason : undefined, advance });
      say('Result saved.', 'ok'); onSaved && onSaved();
    } catch (e) { setError(e.offline ? 'No internet. Save the result when you are online.' : e.message); setBusy(false); }
  };
  return (
    <Sheet title="Interview result" onClose={onClose}>
      <div className="col" style={{ gap: 12 }} data-testid="iv-result-sheet">
        <div className="small muted">{iv.candidate_name} · {iv.round} · {iv.job_title}</div>
        <Chips items={['Cleared', 'Rejected', 'No show', 'On hold']} value={result} onPick={setResult} testid="ir" />
        {result === 'Rejected' && <Field label="Reason"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{m.reject_reasons.map((r) => <option key={r}>{r}</option>)}</select></Field>}
        <Field label="Feedback (you can speak it)"><VoiceArea value={feedback} onChange={setFeedback} rows={3} placeholder="Strengths, gaps, what the client said" testid="ir-feedback" /></Field>
        {(result === 'Cleared' || result === 'Rejected') && (
          <label className="flex" style={{ gap: 8 }}><input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> <span className="small">{result === 'Cleared' ? 'Move the candidate to the next stage' : 'Take the candidate out of this opening'}</span></label>
        )}
        {error && <div className="note bad small" role="alert">{error}</div>}
        <div className="btns">
          <button type="button" className="btn outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy} data-testid="ir-save">{busy ? <Loader2 className="spin" size={18} /> : null} Save result</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Move a candidate to another stage of an opening. */
export function MoveStage({ row, onClose, onSaved }) {
  const { say } = useApp();
  const m = cachedMeta();
  const stages = [...m.stages, ...m.side_stages].filter((s) => s !== row.stage);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [ctc, setCtc] = useState('');
  const [joined, setJoined] = useState(today());
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!to) { setError('Choose the stage.'); return; }
    if (to === 'Rejected' && !reason) { setError('Choose why the candidate is out.'); return; }
    setBusy(true); setError('');
    try {
      const body = { stage: to, remark: remark.trim() || undefined };
      if (to === 'Rejected') body.reason = reason;
      if (['Offered', 'Offer accepted'].includes(to) && ctc) body.offered_ctc = ctc;
      if (to === 'Joined') body.joining_date = joined;
      await POST(P(`/pipeline/${row.id}/move`), body);
      say(to === 'Joined' ? `${row.candidate_name || 'The candidate'} is placed.` : `Moved to ${to}.`, 'ok');
      onSaved && onSaved();
    } catch (e) { setError(e.offline ? 'No internet. Move the candidate when you are online.' : e.message); setBusy(false); }
  };
  return (
    <Sheet title="Move to another stage" onClose={onClose}>
      <div className="col" style={{ gap: 12 }} data-testid="move-sheet">
        <div className="small muted">{row.job_title}{row.client_name ? ` · ${row.client_name}` : ''} — now <b>{row.stage}</b></div>
        <Chips items={stages} value={to} onPick={(v) => { setTo(v); setError(''); }} testid="mv" />
        {to === 'Rejected' && <Field label="Why is the candidate out?"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="mv-reason"><option value="">Choose a reason</option>{m.reject_reasons.map((r) => <option key={r}>{r}</option>)}</select></Field>}
        {['Offered', 'Offer accepted'].includes(to) && <Field label="Offered CTC (lakh a year)"><input className="input" type="number" inputMode="decimal" step="0.1" min="0" value={ctc} onChange={(e) => setCtc(e.target.value)} data-testid="mv-ctc" /></Field>}
        {to === 'Joined' && <Field label="Date of joining"><input className="input" type="date" value={joined} onChange={(e) => setJoined(e.target.value)} data-testid="mv-date" /></Field>}
        <Field label="Remark (optional)"><textarea className="input" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} /></Field>
        {error && <div className="note bad small" role="alert">{error}</div>}
        <div className="btns">
          <button type="button" className="btn outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !to} data-testid="mv-save">{busy ? <Loader2 className="spin" size={18} /> : null} Move</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Put a candidate on an opening. */
export function PickOpening({ candidate, onClose, onSaved }) {
  const { say } = useApp();
  const [jobs, setJobs] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { GET(P('/jobs?status=Open')).then(setJobs).catch((e) => setError(e.offline ? 'No internet.' : e.message)); }, []);
  const list = (jobs || []).filter((j) => !q || `${j.title} ${j.client_name} ${j.code}`.toLowerCase().includes(q.toLowerCase()));
  const pick = async (j) => {
    setBusy(j.id); setError('');
    try { await POST(P('/pipeline'), { job_id: j.id, candidate_id: candidate.id }); say(`${candidate.name} is on ${j.title}.`, 'ok'); onSaved && onSaved(); }
    catch (e) { setError(e.message); setBusy(0); }
  };
  return (
    <Sheet title="Put on an opening" onClose={onClose}>
      <div className="col" style={{ gap: 10 }} data-testid="pick-opening">
        <input className="input" placeholder="Search openings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search openings" />
        {error && <div className="note bad small" role="alert">{error}</div>}
        {!jobs && !error && <div className="loading"><Loader2 className="spin" size={20} /></div>}
        <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line-soft)' }}>
          {list.map((j) => (
            <button key={j.id} type="button" className="row" onClick={() => pick(j)} disabled={!!busy} data-testid={`po-${j.id}`}>
              <div className="main"><div className="title">{j.title}{j.priority === 'Hot' ? ' 🔥' : ''}</div><div className="line">{j.code} · {j.client_name}{j.location ? ` · ${j.location}` : ''}</div></div>
              {busy === j.id ? <Loader2 className="spin" size={18} /> : null}
            </button>
          ))}
          {jobs && !list.length && <div className="empty">No open opening matches.</div>}
        </div>
      </div>
    </Sheet>
  );
}
