/*
 * Placement desk — the boxes you fill in: move a candidate, fix an interview,
 * write the result, add a candidate, add an opening, put a candidate on an opening.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Paperclip } from 'lucide-react';
import { pl, usePlacementMeta, useAsync, placementChanged, toLocalInput, todayStr, niceWhen, lakh } from './pl';
import { Modal, Field, Err, toast, StageBadge } from './ui';

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ file_name: file.name, mime: file.type || 'application/octet-stream', data_b64: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}
function useForm(initial) {
  const [f, setF] = useState(initial);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const on = (k) => (e) => set(k, e.target.value);
  return [f, set, on, setF];
}
const num = (v) => (v === '' || v === null || v === undefined ? '' : v);

// ---------------------------------------------------------------- move to a stage
export function MoveModal({ row, to, onClose, onDone }) {
  const meta = usePlacementMeta();
  const [f, set, on] = useForm({
    reason: '', remark: '', offered_ctc: row.expected_ctc || '', expected_joining: addDays(todayStr(), 30), joining_date: todayStr(),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { stage: to, remark: f.remark || undefined };
      if (to === 'Rejected') body.reason = f.reason;
      if (to === 'Offered') { body.offered_ctc = f.offered_ctc; body.expected_joining = f.expected_joining; }
      if (to === 'Offer accepted' && f.offered_ctc) body.offered_ctc = f.offered_ctc;
      if (to === 'Joined') body.joining_date = f.joining_date;
      await pl.post(`/pipeline/${row.id}/move`, body);
      toast(to === 'Joined' ? `${row.candidate_name} is placed` : `Moved to ${to}`);
      placementChanged(); onDone && onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`Move to ${to}`} subtitle={`${row.candidate_name} · ${row.job_title}`} onClose={onClose} busy={busy} testid="move-modal"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pl-move" className="btn btn-primary" disabled={busy} data-testid="move-save">{busy ? 'Saving…' : to === 'Rejected' ? 'Mark as out' : 'Move'}</button></>}>
      <form id="pl-move" onSubmit={submit} className="space-y-3">
        <Err>{err}</Err>
        <div className="flex items-center gap-2 text-sm"><StageBadge stage={row.stage} /> <span style={{ color: 'var(--color-faint)' }}>→</span> <StageBadge stage={to} /></div>
        {to === 'Rejected' && (
          <Field label="Why is the candidate out?" required>
            <select className="input" value={f.reason} onChange={on('reason')} required data-autofocus data-testid="move-reason">
              <option value="">Choose a reason</option>
              {(meta?.reject_reasons || []).map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
        )}
        {(to === 'Offered' || to === 'Offer accepted') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Offered CTC (lakh a year)"><input className="input" type="number" step="0.1" min="0" value={num(f.offered_ctc)} onChange={on('offered_ctc')} data-testid="move-ctc" /></Field>
            {to === 'Offered' && <Field label="Expected joining"><input className="input" type="date" value={f.expected_joining} onChange={on('expected_joining')} /></Field>}
          </div>
        )}
        {to === 'Joined' && <Field label="Date of joining" required><input className="input" type="date" value={f.joining_date} max={addDays(todayStr(), 7)} onChange={on('joining_date')} required data-testid="move-join-date" /></Field>}
        <Field label="Remark (optional)"><textarea className="input" rows={2} value={f.remark} onChange={on('remark')} placeholder="What should the next person know?" /></Field>
        {to === 'Joined' && <p className="t-meta">The replacement guarantee starts from this date. After this you can make the invoice from Offers & joinings.</p>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- schedule an interview
const NEXT_ROUND = { Submitted: 'L1', Screened: 'L1', Sourced: 'L1', 'Interview L1': 'L2', 'Interview L2': 'Final', 'Final round': 'HR' };
export function ScheduleModal({ row, iv, onClose, onDone }) {
  const meta = usePlacementMeta();
  const tomorrow = `${addDays(todayStr(), 1)}T11:00`;
  const [f, set, on] = useForm({
    round: iv?.round || NEXT_ROUND[row.stage] || 'L1', scheduled_at: iv ? toLocalInput(iv.scheduled_at) : tomorrow, duration_min: iv?.duration_min || 45,
    mode: iv?.mode || 'Video', panel: iv?.panel || '', link_or_place: iv?.link_or_place || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (iv) await pl.put(`/interviews/${iv.id}`, { ...f, result: 'Scheduled' });
      else await pl.post(`/pipeline/${row.id}/interviews`, f);
      toast(iv ? 'Interview changed' : 'Interview fixed, with a meeting for the calendar');
      placementChanged(); onDone && onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={iv ? 'Change the interview' : 'Fix an interview'} subtitle={`${row.candidate_name} · ${row.job_title}${row.client_name ? ` · ${row.client_name}` : ''}`} onClose={onClose} busy={busy} testid="schedule-modal"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pl-sched" className="btn btn-primary" disabled={busy} data-testid="sched-save">{busy ? 'Saving…' : iv ? 'Save' : 'Fix the interview'}</button></>}>
      <form id="pl-sched" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Err>{err}</Err></div>
        <Field label="Round"><select className="input" value={f.round} onChange={on('round')} data-testid="sched-round">{(meta?.rounds || ['L1', 'L2', 'Final', 'HR']).map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Mode"><select className="input" value={f.mode} onChange={on('mode')}>{(meta?.interview_modes || ['Video', 'Phone', 'In person']).map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Date and time" required><input className="input" type="datetime-local" value={f.scheduled_at} onChange={on('scheduled_at')} required data-testid="sched-when" /></Field>
        <Field label="Minutes"><input className="input" type="number" min="10" max="480" step="5" value={f.duration_min} onChange={on('duration_min')} /></Field>
        <Field label="Panel" className="col-span-2"><input className="input" value={f.panel} onChange={on('panel')} placeholder="Who will take the interview" /></Field>
        <Field label={f.mode === 'In person' ? 'Place' : f.mode === 'Phone' ? 'Phone note' : 'Meeting link'} className="col-span-2"><input className="input" value={f.link_or_place} onChange={on('link_or_place')} placeholder={f.mode === 'In person' ? 'Office address' : f.mode === 'Video' ? 'https://…' : ''} /></Field>
        <p className="t-meta col-span-2">A meeting is added to your calendar, with the candidate{row.email ? ` (${row.email})` : ''} and the recruiter as invited people.</p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- the result of an interview
export function ResultModal({ iv, onClose, onDone }) {
  const meta = usePlacementMeta();
  const [f, set, on] = useForm({ result: 'Cleared', feedback: iv.feedback || '', reason: 'Client rejected', advance: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await pl.put(`/interviews/${iv.id}`, { result: f.result, feedback: f.feedback, reason: f.result === 'Rejected' ? f.reason : undefined, advance: f.advance });
      toast('Result saved'); placementChanged(); onDone && onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="Interview result" subtitle={`${iv.candidate_name} · ${iv.round} · ${niceWhen(iv.scheduled_at)}`} onClose={onClose} busy={busy} testid="result-modal"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pl-result" className="btn btn-primary" disabled={busy} data-testid="result-save">{busy ? 'Saving…' : 'Save result'}</button></>}>
      <form id="pl-result" onSubmit={submit} className="space-y-3">
        <Err>{err}</Err>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Result" required><select className="input" value={f.result} onChange={on('result')} data-testid="result-select">{['Cleared', 'Rejected', 'No show', 'On hold', 'Cancelled'].map((r) => <option key={r}>{r}</option>)}</select></Field>
          {f.result === 'Rejected' && <Field label="Reason"><select className="input" value={f.reason} onChange={on('reason')}>{(meta?.reject_reasons || []).map((r) => <option key={r}>{r}</option>)}</select></Field>}
        </div>
        <Field label="Feedback from the panel"><textarea className="input" rows={3} value={f.feedback} onChange={on('feedback')} placeholder="Strengths, gaps, what the client said" data-testid="result-feedback" /></Field>
        {(f.result === 'Cleared' || f.result === 'Rejected') && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.advance} onChange={(e) => set('advance', e.target.checked)} /> {f.result === 'Cleared' ? 'Move the candidate to the next stage' : 'Take the candidate out of this opening'}</label>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- a candidate
export function CandidateForm({ candidate, onClose, onSaved }) {
  const meta = usePlacementMeta();
  const { data: people } = useAsync(() => pl.get('/people'), []);
  const c = candidate || {};
  const [f, set, on] = useForm({
    name: c.name || '', mobile: c.mobile || '', email: c.email || '', city: c.city || '', current_company: c.current_company || '', designation: c.designation || '',
    total_exp: num(c.total_exp), relevant_exp: num(c.relevant_exp), current_ctc: num(c.current_ctc), expected_ctc: num(c.expected_ctc),
    notice_period: c.notice_period || '30 days', source: c.source || 'Naukri', status: c.status || 'New', owner_id: c.owner_id || '', skills: c.skills || '', notes: c.notes || '',
  });
  const [file, setFile] = useState(null);
  const [dups, setDups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const check = async () => {
    if (!f.mobile && !f.email) { setDups([]); return; }
    try { const r = await pl.get('/candidates/check', { mobile: f.mobile, email: f.email, except: c.id }); setDups(r.duplicates || []); } catch { setDups([]); }
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { ...f, owner_id: f.owner_id || undefined };
      if (file) body.resume = await fileToPayload(file);
      const r = c.id ? await pl.put(`/candidates/${c.id}`, body) : await pl.post('/candidates', body);
      toast(c.id ? 'Candidate saved' : 'Candidate added'); placementChanged(); onSaved && onSaved(r.id);
    } catch (x) { setErr(x.message); if (x.duplicates) setDups(x.duplicates); setBusy(false); }
  };
  return (
    <Modal title={c.id ? 'Edit candidate' : 'Add candidate'} subtitle={c.id ? c.code : 'A mobile number or an email is needed. We check that the person is not already in the CRM.'} wide onClose={onClose} busy={busy} testid="candidate-form"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pl-cand" className="btn btn-primary" disabled={busy} data-testid="cand-save">{busy ? 'Saving…' : 'Save candidate'}</button></>}>
      <form id="pl-cand" onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-full"><Err>{err}</Err></div>
        {dups.length > 0 && (
          <div className="col-span-full rounded-xl px-3 py-2.5 text-sm flex items-start gap-2" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning-strong)' }} data-testid="dup-warning">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>Already in the CRM: {dups.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link to={`/placement/candidates/${d.id}`} className="underline font-medium" onClick={onClose}>{d.name} ({d.code})</Link></span>)}</div>
          </div>
        )}
        <Field label="Full name" required className="col-span-2 sm:col-span-1"><input className="input" value={f.name} onChange={on('name')} required data-testid="cand-name" /></Field>
        <Field label="Mobile"><input className="input" value={f.mobile} onChange={on('mobile')} onBlur={check} placeholder="98xxx xxxxx" data-testid="cand-mobile" /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={on('email')} onBlur={check} /></Field>
        <Field label="City"><input className="input" value={f.city} onChange={on('city')} /></Field>
        <Field label="Current company"><input className="input" value={f.current_company} onChange={on('current_company')} /></Field>
        <Field label="Designation"><input className="input" value={f.designation} onChange={on('designation')} /></Field>
        <Field label="Total experience (years)"><input className="input" type="number" step="0.1" min="0" value={f.total_exp} onChange={on('total_exp')} /></Field>
        <Field label="Relevant experience (years)"><input className="input" type="number" step="0.1" min="0" value={f.relevant_exp} onChange={on('relevant_exp')} /></Field>
        <Field label="Notice period"><select className="input" value={f.notice_period} onChange={on('notice_period')}>{(meta?.notice_periods || []).map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="Current CTC (lakh a year)"><input className="input" type="number" step="0.1" min="0" value={f.current_ctc} onChange={on('current_ctc')} /></Field>
        <Field label="Expected CTC (lakh a year)"><input className="input" type="number" step="0.1" min="0" value={f.expected_ctc} onChange={on('expected_ctc')} /></Field>
        <Field label="Source"><select className="input" value={f.source} onChange={on('source')}>{(meta?.sources || []).map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="Owner"><select className="input" value={f.owner_id} onChange={on('owner_id')}><option value="">Me</option>{(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        {c.id && <Field label="Status"><select className="input" value={f.status} onChange={on('status')}>{(meta?.candidate_status || []).map((n) => <option key={n}>{n}</option>)}</select></Field>}
        <Field label="Skills" className="col-span-full" hint="Separate with commas"><input className="input" value={f.skills} onChange={on('skills')} placeholder="Java, Spring Boot, AWS" data-testid="cand-skills" /></Field>
        <Field label="Notes" className="col-span-full"><textarea className="input" rows={2} value={f.notes} onChange={on('notes')} /></Field>
        <Field label={c.resume ? 'Replace the resume' : 'Resume'} className="col-span-full" hint="PDF, Word, text or a photo, up to 6 MB">
          <div className="flex items-center gap-2"><Paperclip className="w-4 h-4" style={{ color: 'var(--color-faint)' }} /><input type="file" accept=".pdf,.doc,.docx,.txt,image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} data-testid="cand-resume" className="text-sm" /></div>
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- an opening
export function JobForm({ job, onClose, onSaved }) {
  const meta = usePlacementMeta();
  const { data: clients } = useAsync(() => pl.get('/clients'), []);
  const { data: people } = useAsync(() => pl.get('/people'), []);
  const j = job || {};
  const [f, set, on] = useForm({
    title: j.title || '', account_id: j.account_id || '', hiring_type: j.hiring_type || 'Permanent', positions: j.positions || 1, priority: j.priority || 'Normal',
    location: j.location || '', exp_min: num(j.exp_min), exp_max: num(j.exp_max), ctc_min: num(j.ctc_min), ctc_max: num(j.ctc_max), bill_rate: num(j.bill_rate),
    fee_percent: num(j.fee_percent), skills: j.skills || '', target_date: j.target_date || addDays(todayStr(), 30), jd_text: j.jd_text || '',
    recruiter_ids: (j.recruiters || []).map((r) => r.id), status: j.status || 'Open',
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const contract = f.hiring_type === 'Contract';
  const toggle = (id) => set('recruiter_ids', f.recruiter_ids.includes(id) ? f.recruiter_ids.filter((x) => x !== id) : [...f.recruiter_ids, id]);
  const pickClient = (e) => {
    const id = Number(e.target.value) || '';
    set('account_id', id);
    const cl = (clients || []).find((c) => c.id === id);
    if (cl && !j.id && cl.fee_percent && !f.fee_percent) set('fee_percent', cl.fee_percent);
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { ...f };
      if (contract) { body.ctc_min = ''; body.ctc_max = ''; body.fee_percent = ''; } else body.bill_rate = '';
      if (file) body.jd_file = await fileToPayload(file);
      const r = j.id ? await pl.put(`/jobs/${j.id}`, body) : await pl.post('/jobs', body);
      toast(j.id ? 'Opening saved' : 'Opening created'); placementChanged(); onSaved && onSaved(r.id);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={j.id ? `Edit ${j.code}` : 'New job opening'} subtitle={j.id ? j.client_name : 'The job code is made for you, like JOB-2026-0043'} wide onClose={onClose} busy={busy} testid="job-form"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pl-job" className="btn btn-primary" disabled={busy} data-testid="job-save">{busy ? 'Saving…' : 'Save opening'}</button></>}>
      <form id="pl-job" onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-full"><Err>{err}</Err></div>
        <Field label="Position title" required className="col-span-full sm:col-span-2"><input className="input" value={f.title} onChange={on('title')} required data-testid="job-title" /></Field>
        <Field label="Client" required><select className="input" value={f.account_id} onChange={pickClient} required data-testid="job-client"><option value="">Choose the client</option>{(clients || []).map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}</select></Field>
        <Field label="Hiring type"><select className="input" value={f.hiring_type} onChange={on('hiring_type')} data-testid="job-kind">{(meta?.hiring_types || []).map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="Positions"><input className="input" type="number" min="1" value={f.positions} onChange={on('positions')} /></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={on('priority')}><option>Normal</option><option>Hot</option></select></Field>
        <Field label="Location" className="col-span-2 sm:col-span-1"><input className="input" value={f.location} onChange={on('location')} placeholder="Pune (Hybrid)" /></Field>
        <Field label="Experience, from (years)"><input className="input" type="number" step="0.5" min="0" value={f.exp_min} onChange={on('exp_min')} /></Field>
        <Field label="Experience, up to (years)"><input className="input" type="number" step="0.5" min="0" value={f.exp_max} onChange={on('exp_max')} /></Field>
        {contract ? (
          <Field label="Bill rate (rupees a month)" required><input className="input" type="number" min="0" step="500" value={f.bill_rate} onChange={on('bill_rate')} required data-testid="job-rate" /></Field>
        ) : (
          <>
            <Field label="CTC from (lakh a year)"><input className="input" type="number" step="0.5" min="0" value={f.ctc_min} onChange={on('ctc_min')} /></Field>
            <Field label="CTC up to (lakh a year)"><input className="input" type="number" step="0.5" min="0" value={f.ctc_max} onChange={on('ctc_max')} /></Field>
            <Field label="Fee % of CTC" hint="Empty = the client's agreed fee"><input className="input" type="number" step="0.01" min="0" max="100" value={f.fee_percent} onChange={on('fee_percent')} /></Field>
          </>
        )}
        <Field label="Target date"><input className="input" type="date" value={f.target_date} onChange={on('target_date')} /></Field>
        {j.id && <Field label="Status"><select className="input" value={f.status} onChange={on('status')}>{(meta?.job_status || []).map((n) => <option key={n}>{n}</option>)}</select></Field>}
        <Field label="Must-have skills" className="col-span-full" hint="Separate with commas. They are used to suggest people from your database."><input className="input" value={f.skills} onChange={on('skills')} placeholder="Java, Spring Boot, AWS" data-testid="job-skills" /></Field>
        <div className="col-span-full">
          <span className="block text-xs font-medium mb-1 text-ink">Recruiters on this opening</span>
          <div className="flex flex-wrap gap-2">
            {(people || []).map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={f.recruiter_ids.includes(p.id)} className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={f.recruiter_ids.includes(p.id) ? { background: 'var(--color-brand)', color: '#fff' } : { background: 'var(--color-canvas-alt)', color: 'var(--color-ink-light)' }}>{p.name}</button>
            ))}
          </div>
        </div>
        <Field label="Job description" className="col-span-full"><textarea className="input" rows={4} value={f.jd_text} onChange={on('jd_text')} /></Field>
        <Field label={j.jd_file ? 'Replace the JD file' : 'JD file (optional)'} className="col-span-full"><input type="file" accept=".pdf,.doc,.docx,.txt" onChange={(e) => setFile(e.target.files[0] || null)} className="text-sm" /></Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- put a candidate on an opening
export function AddToJobModal({ candidate, onClose, onDone }) {
  const { data: jobs } = useAsync(() => pl.get('/jobs', { status: 'Open' }), []);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = useMemo(() => (jobs || []).filter((j) => !q || `${j.title} ${j.client_name} ${j.code}`.toLowerCase().includes(q.toLowerCase())), [jobs, q]);
  useEffect(() => { setErr(''); }, [pick]);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await pl.post('/pipeline', { job_id: pick, candidate_id: candidate.id }); toast(`${candidate.name} is on the opening`); placementChanged(); onDone && onDone(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="Put on an opening" subtitle={`${candidate.name}${candidate.designation ? ` · ${candidate.designation}` : ''}`} onClose={onClose} busy={busy} testid="addjob-modal"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || !pick} onClick={submit} data-testid="addjob-save">{busy ? 'Adding…' : 'Add to opening'}</button></>}>
      <Err>{err}</Err>
      <input className="input mb-3" placeholder="Search openings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search openings" />
      <div className="space-y-1.5 max-h-72 overflow-y-auto thin-scroll" role="radiogroup" aria-label="Openings">
        {list.map((j) => (
          <button key={j.id} type="button" role="radio" aria-checked={pick === j.id} onClick={() => setPick(j.id)} className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3"
            style={{ border: `1px solid ${pick === j.id ? 'var(--color-brand)' : 'var(--color-line)'}`, background: pick === j.id ? 'var(--color-brand-soft)' : 'var(--color-surface)' }} data-testid={`pick-job-${j.id}`}>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink truncate">{j.title}{j.priority === 'Hot' ? ' 🔥' : ''}</span><span className="block t-meta truncate">{j.code} · {j.client_name} · {j.location || ''}</span></span>
            <span className="t-meta shrink-0">{j.hiring_type === 'Contract' ? 'Contract' : `${lakh(j.ctc_min)}–${lakh(j.ctc_max)}`}</span>
          </button>
        ))}
        {jobs && list.length === 0 && <div className="t-meta py-6 text-center">No open opening matches.</div>}
      </div>
    </Modal>
  );
}

/** The stage buttons used on a pipeline row everywhere: a menu of "move to". */
export function MoveMenu({ row, onMoved }) {
  const meta = usePlacementMeta();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(null);
  const [sched, setSched] = useState(false);
  const stages = [...(meta?.stages || []), ...(meta?.side_stages || [])].filter((s) => s !== row.stage);
  const needsBox = (s) => ['Rejected', 'Offered', 'Offer accepted', 'Joined'].includes(s);
  const go = async (s) => {
    setOpen(false);
    if (needsBox(s)) { setTo(s); return; }
    try { await pl.post(`/pipeline/${row.id}/move`, { stage: s }); toast(`Moved to ${s}`); placementChanged(); onMoved && onMoved(); } catch (x) { toast(x.message, 'bad'); }
  };
  if (row.stage === 'Joined') return null;
  return (
    <span className="relative inline-block">
      <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid={`move-${row.id}`}>Move</button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul role="menu" className="absolute right-0 mt-1 z-50 w-48 rounded-xl py-1 shadow-xl max-h-72 overflow-y-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)' }}>
            <li><button type="button" role="menuitem" className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 font-medium" style={{ color: 'var(--color-brand)' }} onClick={() => { setOpen(false); setSched(true); }}>Fix an interview…</button></li>
            {stages.map((s) => <li key={s}><button type="button" role="menuitem" className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => go(s)} data-testid={`move-to-${s}`}>{s}</button></li>)}
          </ul>
        </>
      )}
      {to && <MoveModal row={row} to={to} onClose={() => setTo(null)} onDone={() => { setTo(null); onMoved && onMoved(); }} />}
      {sched && <ScheduleModal row={row} onClose={() => setSched(false)} onDone={() => { setSched(false); onMoved && onMoved(); }} />}
    </span>
  );
}
