/*
 * Placement desk (app): add a candidate on the spot — with the resume (a photo of
 * the paper, or a file), a duplicate check on mobile / email, and (if wanted) put
 * on an opening at once. Without internet it waits in the outbox.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Paperclip, X, Loader2, AlertTriangle } from 'lucide-react';
import { useApp } from '../../lib/app';
import { GET, POST, qs, OfflineError } from '../../lib/api';
import { add as outboxAdd, newRef } from '../../lib/outbox';
import { takePhoto, pickFiles } from '../../lib/media';
import { P, meta, cachedMeta } from '../../lib/placement';
import { TopBar, Field, StatusBars } from '../../components/ui';

const EMPTY = { name: '', mobile: '', email: '', city: '', current_company: '', designation: '', total_exp: '', current_ctc: '', expected_ctc: '', notice_period: '', skills: '', source: 'Walk-in', job_id: '' };

export default function PlacementAdd() {
  const { say, sync } = useApp();
  const nav = useNavigate();
  const m = cachedMeta();
  const [f, setF] = useState(EMPTY);
  const [resume, setResume] = useState(null);              // { file_name, mime, data_b64, name }
  const [jobs, setJobs] = useState([]);
  const [dups, setDups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checked = useRef('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  useEffect(() => { meta(); GET(P('/jobs?status=Open')).then(setJobs).catch(() => {}); }, []);

  const check = async () => {
    const key = `${f.mobile}|${f.email}`;
    if ((!f.mobile && !f.email) || key === checked.current) return;
    checked.current = key;
    try { const r = await GET(P(`/candidates/check${qs({ mobile: f.mobile, email: f.email })}`)); setDups(r.duplicates || []); } catch { setDups([]); }
  };
  const photo = async () => {
    try { const p = await takePhoto({ max: 1800 }); if (p) setResume({ file_name: `resume-${Date.now()}.jpg`, mime: 'image/jpeg', data_b64: p.data, name: 'Photo of the resume' }); } catch (e) { say(e.message, 'error'); }
  };
  const file = async () => {
    try {
      const [x] = await pickFiles(1, { maxMb: 5, accept: 'application/pdf,.doc,.docx,.txt,image/*' });
      if (x) setResume({ file_name: x.file_name, mime: x.mime, data_b64: x.data, name: x.file_name });
    } catch (e) { say(e.message, 'error'); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { setError('Enter the name.'); return; }
    if (!f.mobile.trim() && !f.email.trim()) { setError('Enter the mobile number or the email.'); return; }
    setBusy(true); setError('');
    const body = { ...f, name: f.name.trim(), job_id: f.job_id || undefined };
    Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });
    if (resume) body.resume = { file_name: resume.file_name, mime: resume.mime, data_b64: resume.data_b64 };
    try {
      const out = await POST(P('/candidates'), body);
      say(f.job_id ? 'Candidate added, and put on the opening.' : 'Candidate added.', 'ok');
      nav(`/placement/c/${out.id}`, { replace: true });
    } catch (x) {
      if (x instanceof OfflineError || x.offline) {
        outboxAdd({ kind: 'pl-candidate', label: `New candidate: ${f.name.trim()}`, method: 'POST', path: P('/candidates'), body, ref: newRef('plk') });
        sync();
        say('No internet. The candidate is kept on the phone and will be sent.', 'ok');
        nav('/placement', { replace: true });
        return;
      }
      if (x.status === 409 && x.data && x.data.duplicates) setDups(x.data.duplicates);
      setError(x.message); setBusy(false);
    }
  };

  const dup = dups[0];
  return (
    <div className="screen no-nav" data-testid="pl-add-screen">
      <TopBar title="Add a candidate" />
      <StatusBars />
      <form className="body" onSubmit={save}>
        {error && <div className="note bad small" role="alert" data-testid="pa-error">{error}</div>}
        {dup && (
          <div className="note warn small flex" style={{ alignItems: 'flex-start' }} data-testid="pa-dup">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <div className="grow"><div className="strong">Already in the CRM</div>{dup.name} ({dup.code}){dup.current_company ? ` · ${dup.current_company}` : ''} has this {dup.mobile && f.mobile ? 'mobile number' : 'email'}. <Link to={`/placement/c/${dup.id}`} style={{ textDecoration: 'underline' }}>Open</Link></div>
          </div>
        )}
        <div className="card col" style={{ gap: 12 }}>
          <Field label="Full name *"><input className="input" value={f.name} onChange={set('name')} autoComplete="off" data-testid="pa-name" /></Field>
          <Field label="Mobile"><input className="input" inputMode="tel" value={f.mobile} onChange={set('mobile')} onBlur={check} placeholder="98xxx xxxxx" data-testid="pa-mobile" /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} onBlur={check} data-testid="pa-email" /></Field>
          <Field label="Current company"><input className="input" value={f.current_company} onChange={set('current_company')} /></Field>
          <Field label="Designation"><input className="input" value={f.designation} onChange={set('designation')} /></Field>
          <Field label="City"><input className="input" value={f.city} onChange={set('city')} /></Field>
          <div className="flex" style={{ gap: 8 }}>
            <Field label="Experience (yrs)"><input className="input" type="number" inputMode="decimal" step="0.1" min="0" value={f.total_exp} onChange={set('total_exp')} /></Field>
            <Field label="Notice period"><select className="input" value={f.notice_period} onChange={set('notice_period')}><option value="">—</option>{m.notice_periods.map((n) => <option key={n}>{n}</option>)}</select></Field>
          </div>
          <div className="flex" style={{ gap: 8 }}>
            <Field label="Current CTC (L)"><input className="input" type="number" inputMode="decimal" step="0.1" min="0" value={f.current_ctc} onChange={set('current_ctc')} /></Field>
            <Field label="Expected CTC (L)"><input className="input" type="number" inputMode="decimal" step="0.1" min="0" value={f.expected_ctc} onChange={set('expected_ctc')} /></Field>
          </div>
          <Field label="Skills" hint="Separate with commas"><input className="input" value={f.skills} onChange={set('skills')} placeholder="Java, Spring Boot, AWS" data-testid="pa-skills" /></Field>
          <Field label="Source"><select className="input" value={f.source} onChange={set('source')}>{m.sources.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>

        <div className="card col" style={{ gap: 10 }}>
          <div className="card-title"><Paperclip size={15} /> Resume</div>
          {resume ? (
            <div className="flex" style={{ gap: 8 }}><div className="grow small strong ellipsis" data-testid="pa-resume">{resume.name}</div><button type="button" className="icon-btn" aria-label="Remove the resume" onClick={() => setResume(null)}><X size={18} /></button></div>
          ) : <div className="small muted">A photo of the paper resume, or a PDF / Word file.</div>}
          <div className="btns">
            <button type="button" className="btn outline" onClick={photo} data-testid="pa-photo"><Camera size={18} /> Take a photo</button>
            <button type="button" className="btn outline" onClick={file} data-testid="pa-file"><Paperclip size={18} /> Choose a file</button>
          </div>
        </div>

        <div className="card col" style={{ gap: 10 }}>
          <Field label="Put on an opening (optional)">
            <select className="input" value={f.job_id} onChange={set('job_id')} data-testid="pa-job">
              <option value="">Not now</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.client_name}</option>)}
            </select>
          </Field>
        </div>
        <button type="submit" className="btn primary big block" disabled={busy} data-testid="pa-save">{busy ? <Loader2 className="spin" /> : null} Save candidate</button>
      </form>
    </div>
  );
}
