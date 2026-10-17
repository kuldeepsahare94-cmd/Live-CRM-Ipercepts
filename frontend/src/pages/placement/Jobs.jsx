/*
 * Placement desk — Job openings: every opening with its counts, filters and a quick view.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Flame, Plus, Snowflake } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, lakh, years, inr, niceDate } from './pl';
import { Seg, SearchBox, Loading, LoadError, Empty, th, td, rowStyle } from './ui';
import { JobForm } from './Forms';

export const jobTone = (s) => ({ Open: 'info', 'On hold': 'neutral', Filled: 'success', Closed: 'neutral', Lost: 'danger' }[s] || 'neutral');

export default function Jobs() {
  const meta = usePlacementMeta();
  const nav = useNavigate();
  const { data: jobs, error, reload } = useAsync(() => pl.get('/jobs'), []);
  const { data: clients } = useAsync(() => pl.get('/clients'), []);
  const [status, setStatus] = useState('Open');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [client, setClient] = useState('');
  const [prio, setPrio] = useState('');
  const [cold, setCold] = useState(false);
  const [form, setForm] = useState(false);

  const counts = useMemo(() => {
    const c = { all: 0 };
    (jobs || []).forEach((j) => { c[j.status] = (c[j.status] || 0) + 1; c.all += 1; });
    return c;
  }, [jobs]);
  const rows = useMemo(() => (jobs || []).filter((j) => (status === 'all' || j.status === status)
    && (!kind || j.hiring_type === kind) && (!client || String(j.account_id) === client) && (!prio || j.priority === prio) && (!cold || j.cold)
    && (!q || `${j.title} ${j.code} ${j.client_name} ${j.skills || ''} ${j.location || ''}`.toLowerCase().includes(q.toLowerCase()))), [jobs, status, q, kind, client, prio, cold]);

  return (
    <div data-testid="pl-jobs">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Seg label="Status" value={status} onChange={setStatus} options={[['Open', 'Open', counts.Open || 0], ['On hold', 'On hold', counts['On hold'] || 0], ['Filled', 'Filled', counts.Filled || 0], ['Closed', 'Closed', (counts.Closed || 0) + (counts.Lost || 0)], ['all', 'All', counts.all]]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search title, client, skill" />
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Hiring type"><option value="">Permanent and contract</option>{(meta?.hiring_types || []).map((k) => <option key={k}>{k}</option>)}</select>
        <select className="input w-auto" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client" style={{ maxWidth: '12.5rem' }}><option value="">All clients</option>{(clients || []).map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}</select>
        <select className="input w-auto" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority"><option value="">Any priority</option><option>Hot</option><option>Normal</option></select>
        <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} /> Going cold</label>
        <div className="flex-1" />
        {meta?.can?.create && <button type="button" className="btn btn-primary" onClick={() => setForm(true)} data-testid="new-job"><Plus className="w-4 h-4" /> New opening</button>}
      </div>
      <LoadError error={error} onRetry={reload} />
      {!jobs ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="jobs-table">
              <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                <th className={th}>Opening</th><th className={th}>Client</th><th className={th}>Positions</th><th className={th}>Experience</th><th className={th}>CTC / rate</th>
                <th className={th}>Recruiters</th><th className={th}>Sourced → Sub → Int → Offer → Joined</th><th className={th}>Open</th><th className={th}>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} style={rowStyle} className="cursor-pointer hover:bg-slate-50/60" onClick={() => nav(`/placement/jobs/${j.id}`)} data-testid={`job-row-${j.id}`}>
                    <td className={td}>
                      <Link to={`/placement/jobs/${j.id}`} className="font-medium text-ink hover:underline flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {j.title}{j.priority === 'Hot' && <Flame className="w-3.5 h-3.5" style={{ color: 'var(--color-danger)' }} aria-label="Hot" />}{j.cold && <Snowflake className="w-3.5 h-3.5" style={{ color: 'var(--color-info)' }} aria-label="Going cold" />}
                      </Link>
                      <div className="t-meta">{j.code} · {j.location || '—'}{j.hiring_type === 'Contract' ? ' · Contract' : ''}</div>
                    </td>
                    <td className={td}>{j.client_name}</td>
                    <td className={td}><b className="text-ink">{j.joined_count}</b> / {j.positions}{j.status === 'Open' && j.remaining > 0 ? <span className="t-meta"> · {j.remaining} to fill</span> : null}</td>
                    <td className={td}>{j.exp_min !== null ? `${j.exp_min}–${j.exp_max} yrs` : '—'}</td>
                    <td className={td}>{j.hiring_type === 'Contract' ? `${inr(j.bill_rate)} / month` : `${lakh(j.ctc_min)} – ${lakh(j.ctc_max)}`}</td>
                    <td className={td}><span className="t-meta">{(j.recruiters || []).map((r) => r.name.split(' ')[0]).join(', ') || '—'}</span></td>
                    <td className={td}><span className="font-medium text-ink">{j.total_count}</span> <span className="t-meta">→</span> {j.submitted_count} <span className="t-meta">→</span> {j.interview_count} <span className="t-meta">→</span> {j.offered_count} <span className="t-meta">→</span> <b className="text-ink">{j.joined_count}</b></td>
                    <td className={td}><span title={`Opened ${niceDate(j.opened_on)}`}>{j.days_open}d</span></td>
                    <td className={td}><Badge tone={jobTone(j.status)}>{j.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <Empty icon={Briefcase} title="No opening matches">Change the filters, or add a new opening.</Empty>}
        </div>
      )}
      {form && <JobForm onClose={() => setForm(false)} onSaved={(id) => { setForm(false); nav(`/placement/jobs/${id}`); }} />}
    </div>
  );
}
