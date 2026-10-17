/*
 * Placement desk — Candidates: search, filter, add. The people we place.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react';
import { Badge, Avatar } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, lakh, years, niceDate } from './pl';
import { Seg, SearchBox, Loading, LoadError, Empty, th, td, rowStyle, Skills } from './ui';
import { CandidateForm } from './Forms';

export const candTone = (s) => ({ New: 'info', Screened: 'special', Active: 'success', Placed: 'success', 'Do not call': 'danger', Blacklisted: 'danger' }[s] || 'neutral');
const PAGE = 40;

export default function Candidates() {
  const meta = usePlacementMeta();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: '', source: '', city: '', notice: '', exp_min: '', exp_max: '' });
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(0); };
  const { data, error, reload, loading } = useAsync(() => pl.get('/candidates', { ...f, limit: PAGE, offset: page * PAGE }), [JSON.stringify(f), page]);
  const { data: facets } = useAsync(() => pl.get('/candidates/facets'), []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [page]);
  const rows = data?.rows || [];
  const total = data?.total || 0;

  return (
    <div data-testid="pl-candidates">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Seg label="Status" value={f.status} onChange={(v) => set('status', v)} options={[['', 'All'], ['New', 'New'], ['Screened', 'Screened'], ['Active', 'Active'], ['Placed', 'Placed']]} />
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Name, mobile, skill, company" width={280} />
        <select className="input w-auto" value={f.source} onChange={(e) => set('source', e.target.value)} aria-label="Source"><option value="">Any source</option>{(meta?.sources || []).map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input w-auto" value={f.city} onChange={(e) => set('city', e.target.value)} aria-label="City"><option value="">Any city</option>{(facets?.cities || []).map((c) => <option key={c.value}>{c.value}</option>)}</select>
        <select className="input w-auto" value={f.notice} onChange={(e) => set('notice', e.target.value)} aria-label="Notice period"><option value="">Any notice</option>{(meta?.notice_periods || []).map((s) => <option key={s}>{s}</option>)}</select>
        <span className="inline-flex items-center gap-1"><input className="input" style={{ width: '4.375rem' }} type="number" min="0" placeholder="Yrs from" value={f.exp_min} onChange={(e) => set('exp_min', e.target.value)} aria-label="Experience from" /><input className="input" style={{ width: '4.375rem' }} type="number" min="0" placeholder="to" value={f.exp_max} onChange={(e) => set('exp_max', e.target.value)} aria-label="Experience up to" /></span>
        {['Do not call', 'Blacklisted'].map((s) => <button key={s} type="button" className="text-xs px-2 py-1 rounded-full" onClick={() => set('status', f.status === s ? '' : s)} style={f.status === s ? { background: 'var(--color-danger)', color: '#fff' } : { background: 'var(--color-canvas-alt)', color: 'var(--color-muted)' }}>{s}</button>)}
        <div className="flex-1" />
        {meta?.can?.create && <button type="button" className="btn btn-primary" onClick={() => setForm(true)} data-testid="new-candidate"><Plus className="w-4 h-4" /> Add candidate</button>}
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : (
        <div className={`card overflow-hidden ${loading ? 'opacity-80' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cand-table">
              <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                <th className={th}>Candidate</th><th className={th}>Current role</th><th className={th}>Exp.</th><th className={th}>CTC now → expected</th><th className={th}>Notice</th><th className={th}>City</th><th className={th}>Skills</th><th className={th}>Source</th><th className={th}>Last contact</th><th className={th}>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={rowStyle} className="cursor-pointer hover:bg-slate-50/60" onClick={() => nav(`/placement/candidates/${c.id}`)} data-testid={`cand-row-${c.id}`}>
                    <td className={td}><div className="flex items-center gap-2.5"><Avatar name={c.name} size="sm" /><div className="min-w-0"><Link to={`/placement/candidates/${c.id}`} className="font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link><div className="t-meta">{c.code} · {c.mobile || c.email || '—'}</div></div></div></td>
                    <td className={td}><div className="text-ink">{c.designation || '—'}</div><div className="t-meta">{c.current_company || ''}</div></td>
                    <td className={td}>{years(c.total_exp)}</td>
                    <td className={td}>{lakh(c.current_ctc)} → <b className="text-ink">{lakh(c.expected_ctc)}</b></td>
                    <td className={td}>{c.notice_period || '—'}</td>
                    <td className={td}>{c.city || '—'}</td>
                    <td className={td} style={{ maxWidth: '14.375rem' }}><Skills text={c.skills} max={3} /></td>
                    <td className={td}>{c.source || '—'}</td>
                    <td className={td}>{c.last_contacted ? niceDate(c.last_contacted) : <span className="t-meta">never</span>}</td>
                    <td className={td}><Badge tone={candTone(c.status)}>{c.status}</Badge>{c.live_jobs > 0 && <div className="t-meta mt-0.5">{c.live_jobs} live</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <Empty icon={Users} title="No candidate matches">Change the filters or add a new candidate.</Empty>}
          {total > PAGE && (
            <div className="flex items-center gap-2 px-4 py-2.5 t-meta" style={{ borderTop: '1px solid var(--color-line)' }} data-testid="pager">
              <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
              <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
              <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      )}
      {form && <CandidateForm onClose={() => setForm(false)} onSaved={(id) => { setForm(false); nav(`/placement/candidates/${id}`); }} />}
    </div>
  );
}
