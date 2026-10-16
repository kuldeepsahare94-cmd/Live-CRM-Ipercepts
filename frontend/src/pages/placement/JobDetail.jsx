/*
 * Placement desk — one opening: its board, its candidates, people suggested from
 * the database, and the details (client terms, job description).
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Flame, Pencil, Plus, Search, Sparkles } from 'lucide-react';
import { Badge, Avatar } from '../../components/ui';
import { api } from '../../api';
import { pl, useAsync, usePlacementMeta, placementChanged, lakh, years, inr, niceDate, niceWhen } from './pl';
import { Modal, Err, Loading, LoadError, Empty, Panel, Seg, StageBadge, toast, th, td, rowStyle, Skills } from './ui';
import { Kanban } from './Board';
import { JobForm, MoveMenu } from './Forms';
import { jobTone } from './Jobs';

function AddCandidateModal({ job, onClose, onDone }) {
  const [q, setQ] = useState('');
  const { data, loading } = useAsync(() => pl.get('/candidates', { q, available: 1, limit: 20 }), [q]);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const add = async (c) => {
    setBusy(c.id); setErr('');
    try { await pl.post('/pipeline', { job_id: job.id, candidate_id: c.id }); toast(`${c.name} added`); placementChanged(); onDone(); }
    catch (x) { setErr(x.message); setBusy(0); }
  };
  return (
    <Modal title="Add a candidate to this opening" subtitle={`${job.title} · ${job.client_name}`} onClose={onClose} testid="addcand-modal">
      <Err>{err}</Err>
      <div className="relative mb-3"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-faint)' }} /><input className="input" style={{ paddingLeft: 34 }} placeholder="Name, mobile, skill or city" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus data-testid="addcand-search" /></div>
      <ul className="space-y-1.5 max-h-80 overflow-y-auto thin-scroll">
        {(data?.rows || []).map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ border: '1px solid var(--color-line)' }}>
            <Avatar name={c.name} size="sm" />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium text-ink truncate">{c.name} <span className="t-meta">{c.code}</span></div><div className="t-meta truncate">{c.designation || '—'} · {years(c.total_exp)} · {c.city || '—'} · {lakh(c.expected_ctc)}</div></div>
            <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={!!busy} onClick={() => add(c)} data-testid={`addcand-${c.id}`}>{busy === c.id ? '…' : 'Add'}</button>
          </li>
        ))}
        {!loading && data && data.rows.length === 0 && <li className="t-meta py-6 text-center">Nobody found.</li>}
      </ul>
    </Modal>
  );
}

export default function JobDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const meta = usePlacementMeta();
  const { data: j, error, reload } = useAsync(() => pl.get(`/jobs/${id}`), [id]);
  const { data: rows, reload: reloadRows } = useAsync(() => pl.get('/pipeline', { job: id }), [id]);
  const [tab, setTab] = useState('board');
  const { data: sug, loading: sugLoading } = useAsync(() => (tab === 'suggest' ? pl.get(`/jobs/${id}/suggest`) : Promise.resolve(null)), [id, tab]);
  const [edit, setEdit] = useState(false);
  const [add, setAdd] = useState(false);
  const canEdit = !!meta?.can?.edit;
  if (!j) return error ? <LoadError error={error} onRetry={reload} /> : <Loading />;
  const stages = [...(meta?.stages || []), ...(meta?.side_stages || [])];
  const setStatus = async (status) => {
    try { await pl.post(`/jobs/${j.id}/status`, { status }); toast(`Opening is now ${status}`); placementChanged(); } catch (x) { toast(x.message, 'bad'); }
  };
  const addFromSuggest = async (c) => {
    try { await pl.post('/pipeline', { job_id: j.id, candidate_id: c.id }); toast(`${c.name} added`); placementChanged(); } catch (x) { toast(x.message, 'bad'); }
  };
  const live = (rows || []).filter((r) => r.stage !== 'Rejected');

  return (
    <div data-testid="pl-job-detail">
      <button type="button" className="btn btn-ghost mb-2" onClick={() => nav('/placement/jobs')}><ArrowLeft className="w-4 h-4" /> All openings</button>
      <div className="card p-4 mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-ink">{j.title}</h2>
              <Badge tone={jobTone(j.status)}>{j.status}</Badge>
              {j.priority === 'Hot' && <Badge tone="danger"><Flame className="w-3 h-3 inline -mt-0.5" /> Hot</Badge>}
              {j.hiring_type === 'Contract' && <Badge tone="special">Contract</Badge>}
            </div>
            <div className="t-meta mt-1">{j.code} · <Link to={`/placement/clients?open=${j.account_id}`} className="underline">{j.client_name}</Link> · {j.location || '—'} · opened {niceDate(j.opened_on)} ({j.days_open} days){j.closed_on ? ` · closed ${niceDate(j.closed_on)}` : ''}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {j.jd_file && <button type="button" className="btn btn-secondary" onClick={() => api.openPlacementFile(j.jd_file.id).catch((x) => toast(x.message, 'bad'))}><Download className="w-4 h-4" /> JD</button>}
            {canEdit && j.status === 'Open' && <button type="button" className="btn btn-secondary" onClick={() => setStatus('On hold')}>Put on hold</button>}
            {canEdit && ['On hold', 'Closed', 'Lost', 'Filled'].includes(j.status) && <button type="button" className="btn btn-secondary" onClick={() => setStatus('Open')} data-testid="reopen">Open again</button>}
            {canEdit && ['Open', 'On hold'].includes(j.status) && <button type="button" className="btn btn-secondary" onClick={() => setStatus('Closed')}>Close</button>}
            {canEdit && <button type="button" className="btn btn-secondary" onClick={() => setEdit(true)} data-testid="edit-job"><Pencil className="w-4 h-4" /> Edit</button>}
            {meta?.can?.edit && j.status === 'Open' && <button type="button" className="btn btn-primary" onClick={() => setAdd(true)} data-testid="add-candidate"><Plus className="w-4 h-4" /> Add candidate</button>}
          </div>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mt-4 text-sm">
          {[
            ['Positions', `${j.joined_count} filled of ${j.positions}`],
            ['Experience', j.exp_min !== null ? `${j.exp_min}–${j.exp_max} yrs` : '—'],
            [j.hiring_type === 'Contract' ? 'Bill rate' : 'CTC range', j.hiring_type === 'Contract' ? `${inr(j.bill_rate)} / month` : `${lakh(j.ctc_min)} – ${lakh(j.ctc_max)}`],
            [j.hiring_type === 'Contract' ? 'Margin' : 'Fee', j.hiring_type === 'Contract' ? 'On the timesheet' : `${j.fee_percent ?? j.client_terms?.fee_percent ?? '—'}% of CTC`],
            ['Target date', niceDate(j.target_date)],
            ['Recruiters', (j.recruiters || []).map((r) => r.name).join(', ') || '—'],
            ['In pipeline', `${live.length} live · ${j.submitted_count} sent to client`],
            ['Last movement', j.last_activity ? niceWhen(j.last_activity) : '—'],
          ].map(([k, v]) => <div key={k}><dt className="t-meta">{k}</dt><dd className="font-medium text-ink mt-0.5">{v}</dd></div>)}
        </dl>
        {j.skills && <div className="mt-3"><Skills text={j.skills} max={10} /></div>}
      </div>

      <div className="mb-3"><Seg label="Opening view" value={tab} onChange={setTab} options={[['board', 'Board'], ['list', 'Candidates', (rows || []).length], ['suggest', 'Suggested from database'], ['details', 'Details']]} /></div>

      {tab === 'board' && (rows ? <Kanban rows={rows} stages={stages} canMove={canEdit && j.status !== 'Closed'} reload={reloadRows} /> : <Loading />)}

      {tab === 'list' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}><th className={th}>Candidate</th><th className={th}>Experience</th><th className={th}>Expected</th><th className={th}>Notice</th><th className={th}>Stage</th><th className={th}>In stage</th><th className={th}>Recruiter</th><th className={th} /></tr></thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id} style={rowStyle}>
                  <td className={td}><Link to={`/placement/candidates/${r.candidate_id}`} className="font-medium text-ink hover:underline">{r.candidate_name}</Link><div className="t-meta">{r.designation || ''}{r.current_company ? ` · ${r.current_company}` : ''}</div></td>
                  <td className={td}>{years(r.total_exp)}</td><td className={td}>{lakh(r.expected_ctc)}</td><td className={td}>{r.notice_period || '—'}</td>
                  <td className={td}><StageBadge stage={r.stage} />{r.reject_reason ? <div className="t-meta mt-0.5">{r.reject_reason}</div> : null}</td>
                  <td className={td}>{r.days_in_stage}d</td><td className={td}>{r.owner_name || '—'}</td>
                  <td className={td}>{canEdit && <MoveMenu row={r} onMoved={reloadRows} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && rows.length === 0 && <Empty title="No candidate on this opening yet">Use "Add candidate", or look at the suggestions.</Empty>}
        </div>
      )}

      {tab === 'suggest' && (
        <Panel title="People already in your database who look right" action={<Sparkles className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />} pad={false}>
          {sugLoading && !sug ? <Loading /> : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }} data-testid="suggest-list">
              {(sug || []).map((c) => (
                <li key={c.id} className="px-4 py-3 flex items-center gap-3">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/placement/candidates/${c.id}`} className="text-sm font-medium text-ink hover:underline">{c.name}</Link> <span className="t-meta">{c.code}</span>
                    <div className="t-meta truncate">{c.designation || '—'} · {c.current_company || '—'} · {years(c.total_exp)} · {c.city || '—'} · expects {lakh(c.expected_ctc)} · notice {c.notice_period || '—'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">{c.matched.map((m) => <span key={m} className="text-[11px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--color-success-soft)', color: 'var(--color-success-strong)' }}>{m}</span>)}</div>
                  </div>
                  {canEdit && j.status === 'Open' && <button type="button" className="btn btn-secondary shrink-0" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => addFromSuggest(c)} data-testid={`sug-add-${c.id}`}>Add</button>}
                </li>
              ))}
              {sug && sug.length === 0 && <li><Empty icon={Sparkles} title="Nobody in the database matches the skills">Add the must-have skills to the opening, or source new candidates.</Empty></li>}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel title="Job description" className="lg:col-span-2"><div className="text-sm whitespace-pre-wrap text-ink-light" style={{ color: 'var(--color-ink-light)' }}>{j.jd_text || 'No description written.'}</div></Panel>
          <Panel title="Client terms">
            <dl className="text-sm space-y-2">
              <div className="flex justify-between"><dt className="t-meta">Agreement</dt><dd>{j.client_terms?.agreement_type || '—'}</dd></div>
              <div className="flex justify-between"><dt className="t-meta">Fee</dt><dd>{j.client_terms?.fee_percent ?? '—'}%</dd></div>
              <div className="flex justify-between"><dt className="t-meta">Payment</dt><dd>{j.client_terms?.payment_terms || '—'}</dd></div>
              <div className="flex justify-between"><dt className="t-meta">Guarantee</dt><dd>{j.client_terms?.guarantee_days ?? '—'} days</dd></div>
              <div className="flex justify-between"><dt className="t-meta">Contact</dt><dd className="text-right">{j.client_terms?.spoc_name || '—'}<div className="t-meta">{j.client_terms?.spoc_phone || ''}</div></dd></div>
            </dl>
          </Panel>
        </div>
      )}
      {edit && <JobForm job={j} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />}
      {add && <AddCandidateModal job={j} onClose={() => setAdd(false)} onDone={() => setAdd(false)} />}
    </div>
  );
}
