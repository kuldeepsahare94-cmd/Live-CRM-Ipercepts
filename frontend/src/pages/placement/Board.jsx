/*
 * Placement desk — Pipeline board: candidates as cards in the stages of an opening.
 * Drag a card to another stage (or use Move). Used on its own and inside an opening.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Kanban as KanbanIcon } from 'lucide-react';
import { Avatar } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, STAGE_HEX, years, lakh } from './pl';
import { Loading, LoadError, Empty, toast } from './ui';
import { MoveModal, MoveMenu, ScheduleModal } from './Forms';
import { placementChanged } from './pl';

const NEEDS_BOX = ['Rejected', 'Offered', 'Offer accepted', 'Joined'];

export function Card({ c, canMove, showJob, onDragStart, reload }) {
  return (
    <div draggable={canMove && c.stage !== 'Joined'} onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart && onDragStart(c); }}
      className="rounded-xl p-2.5 text-left" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', boxShadow: '0 1px 3px rgba(23,35,60,.05)' }} data-testid={`card-${c.id}`}>
      <div className="flex items-start gap-2">
        <Avatar name={c.candidate_name} size="sm" />
        <div className="min-w-0 flex-1">
          <Link to={`/placement/candidates/${c.candidate_id}`} className="block text-[13px] font-semibold text-ink truncate hover:underline">{c.candidate_name}</Link>
          <div className="t-meta truncate">{c.designation || '—'}{c.current_company ? ` · ${c.current_company}` : ''}</div>
        </div>
      </div>
      {showJob && <div className="mt-1.5 text-[11px] font-medium truncate" style={{ color: 'var(--color-brand)' }}>{c.job_title} · {c.client_name}</div>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--color-muted)' }}>
        <span>{years(c.total_exp)} · {lakh(c.expected_ctc)}</span>
        <span title="Days in this stage" style={{ color: c.days_in_stage >= 10 && !['Joined', 'Rejected', 'On hold'].includes(c.stage) ? 'var(--color-danger-strong)' : undefined }}>{c.days_in_stage}d</span>
      </div>
      {c.stage === 'Rejected' && c.reject_reason && <div className="mt-1.5 text-[11px] rounded-md px-1.5 py-0.5 inline-block" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger-strong)' }}>{c.reject_reason}</div>}
      {canMove && c.stage !== 'Joined' && <div className="mt-2 flex justify-end"><MoveMenu row={c} onMoved={reload} /></div>}
    </div>
  );
}

export function Kanban({ rows, stages, canMove, showJob, reload }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState('');
  const [box, setBox] = useState(null);
  const [showOut, setShowOut] = useState(false);
  const cols = (showOut ? stages : stages.filter((s) => s !== 'Rejected'));
  const by = useMemo(() => {
    const m = {}; stages.forEach((s) => { m[s] = []; });
    rows.forEach((r) => { (m[r.stage] = m[r.stage] || []).push(r); });
    return m;
  }, [rows, stages]);
  const drop = async (stage, e) => {
    e.preventDefault(); setOver('');
    const id = Number(e.dataTransfer.getData('text/plain')) || (drag && drag.id);
    const row = rows.find((r) => r.id === id);
    setDrag(null);
    if (!row || row.stage === stage || !canMove) return;
    if (NEEDS_BOX.includes(stage)) { setBox({ row, to: stage }); return; }
    try { await pl.post(`/pipeline/${row.id}/move`, { stage }); toast(`${row.candidate_name} moved to ${stage}`); placementChanged(); reload && reload(); } catch (x) { toast(x.message, 'bad'); }
  };
  return (
    <div>
      <div className="flex justify-end mb-2">
        <button type="button" className="btn btn-ghost" onClick={() => setShowOut((s) => !s)} data-testid="toggle-out">{showOut ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showOut ? 'Hide' : 'Show'} candidates who are out ({(by.Rejected || []).length})</button>
      </div>
      <div className="flex gap-3 overflow-x-auto thin-scroll pb-3" data-testid="kanban">
        {cols.map((s) => (
          <div key={s} className="shrink-0 rounded-2xl flex flex-col" style={{ width: 232, background: over === s ? 'var(--color-brand-faint)' : 'var(--color-canvas-alt)', border: `1px dashed ${over === s ? 'var(--color-brand)' : 'transparent'}`, maxHeight: '68vh' }}
            onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver('')} onDrop={(e) => drop(s, e)} data-testid={`col-${s}`}>
            <div className="px-3 pt-2.5 pb-2 flex items-center justify-between sticky top-0">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-ink"><span className="w-2 h-2 rounded-full" style={{ background: STAGE_HEX[s] }} />{s}</span>
              <span className="text-[11px] font-semibold px-1.5 rounded-full" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>{(by[s] || []).length}</span>
            </div>
            <div className="px-2 pb-2 space-y-2 overflow-y-auto thin-scroll flex-1">
              {(by[s] || []).map((c) => <Card key={c.id} c={c} canMove={canMove} showJob={showJob} onDragStart={setDrag} reload={reload} />)}
              {(by[s] || []).length === 0 && <div className="text-center t-meta py-6">—</div>}
            </div>
          </div>
        ))}
      </div>
      {box && <MoveModal row={box.row} to={box.to} onClose={() => setBox(null)} onDone={() => { setBox(null); reload && reload(); }} />}
    </div>
  );
}

export default function Board() {
  const meta = usePlacementMeta();
  const [sp, setSp] = useSearchParams();
  const job = sp.get('job') || '';
  const { data: jobs } = useAsync(() => pl.get('/jobs', { status: 'Open' }), []);
  const { data: rows, error, reload } = useAsync(() => pl.get('/pipeline', { job: job || undefined, open_jobs: job ? undefined : 1 }), [job]);
  const [q, setQ] = useState('');
  const list = useMemo(() => (rows || []).filter((r) => !q || `${r.candidate_name} ${r.job_title} ${r.client_name}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const stages = [...(meta?.stages || []), ...(meta?.side_stages || [])];
  return (
    <div data-testid="pl-board">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select className="input w-auto" style={{ maxWidth: 360 }} value={job} onChange={(e) => setSp(e.target.value ? { job: e.target.value } : {})} aria-label="Opening" data-testid="board-job">
          <option value="">All open openings</option>
          {(jobs || []).map((j) => <option key={j.id} value={j.id}>{j.title} · {j.client_name}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Find a candidate" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a candidate" />
        <span className="t-meta">{list.length} cards · drag a card to another stage</span>
      </div>
      <LoadError error={error} onRetry={reload} />
      {!rows ? <Loading /> : list.length === 0 ? <div className="card"><Empty icon={KanbanIcon} title="Nothing on the board">Put candidates on an opening from the Candidates page.</Empty></div>
        : <Kanban rows={list} stages={stages} canMove={!!meta?.can?.edit} showJob={!job} reload={reload} />}
    </div>
  );
}
