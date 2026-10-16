/*
 * Placement desk (app): one candidate — call (and say how it went), WhatsApp,
 * move between stages, put on an opening, the history.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PhoneCall, MessageCircle, Plus, ArrowRightLeft, FileText, Mail, MapPin, Briefcase, ClipboardEdit } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { useApp, listen } from '../../lib/app';
import { GET } from '../../lib/api';
import { openWhatsApp } from '../../lib/whatsapp';
import { niceDate, niceTime } from '../../lib/format';
import { P, meta, startPlCall, pendingPlCall } from '../../lib/placement';
import { TopBar, Loading, Avatar, StatusBars } from '../../components/ui';
import { CallOutcome, MoveStage, PickOpening } from '../../components/placement/Sheets';

const STAGE_TAG = { Joined: 'ok', 'Offer accepted': 'ok', Offered: 'warn', Rejected: 'bad', 'On hold': '', 'Interview L1': 'info', 'Interview L2': 'info', 'Final round': 'info' };
const stamp = (v) => String(v || '').replace(' ', 'T');

export default function PlacementCandidate() {
  const { id } = useParams();
  const { say } = useApp();
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null);                // 'outcome' | { move: row } | 'open'
  const load = useCallback(() => GET(P(`/candidates/${id}`)).then((r) => { setC(r); setError(''); }).catch((e) => setError(e.offline ? 'No internet: this opens when you are online.' : e.message)), [id]);
  useEffect(() => { meta(); load(); }, [load]);
  useEffect(() => { const p = pendingPlCall(); if (p && p.id === Number(id)) setSheet('outcome'); }, [id]);
  useEffect(() => listen(CapApp.addListener('resume', () => { const p = pendingPlCall(); if (p && p.id === Number(id)) setSheet('outcome'); })), [id]);

  if (error) return <div className="screen no-nav"><TopBar title="Candidate" /><div className="body"><div className="note warn">{error}</div><button type="button" className="btn outline" onClick={load}>Try again</button></div></div>;
  if (!c) return <div className="screen no-nav"><TopBar title="Candidate" /><div className="body"><Loading /></div></div>;
  const call = () => startPlCall({ id: c.id, name: c.name, number: c.mobile });
  const skills = String(c.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
  const blocked = ['Do not call', 'Blacklisted'].includes(c.status);

  return (
    <div className="screen no-nav" data-testid="pl-cand">
      <TopBar title={c.name} sub={c.code} />
      <StatusBars />
      <div className="body">
        <div className="card col" style={{ gap: 10 }}>
          <div className="flex"><Avatar name={c.name} big /><div className="grow"><div className="strong" style={{ fontSize: 17 }}>{c.name}</div><div className="small muted">{[c.designation, c.current_company].filter(Boolean).join(' · ')}</div></div><span className={`tag ${c.status === 'Placed' ? 'ok' : blocked ? 'bad' : ''}`}>{c.status}</span></div>
          <div className="small col" style={{ gap: 4 }}>
            {c.city && <div className="flex"><MapPin size={14} className="muted" /> {c.city}</div>}
            {c.email && <div className="flex"><Mail size={14} className="muted" /> {c.email}</div>}
            <div className="muted">{c.total_exp ? `${c.total_exp} yrs experience` : ''}{c.current_ctc ? ` · now ${c.current_ctc} L` : ''}{c.expected_ctc ? ` · wants ${c.expected_ctc} L` : ''}{c.notice_period ? ` · notice ${c.notice_period}` : ''}</div>
            {c.resume && <div className="flex"><FileText size={14} className="muted" /> Resume on file: {c.resume.file_name}</div>}
          </div>
          {skills.length > 0 && <div className="chips">{skills.map((s) => <span key={s} className="tag info">{s}</span>)}</div>}
          {c.next_follow_up && <div className="note info small">Next call: {niceDate(c.next_follow_up.slice(0, 10))}{c.next_follow_up.length > 10 ? ` ${niceTime(stamp(c.next_follow_up))}` : ''}</div>}
          {blocked && <div className="note bad small">Marked "{c.status}". Do not call.</div>}
          <div className="btns">
            {c.mobile && !blocked && <button type="button" className="btn good" onClick={call} data-testid="pc-call"><PhoneCall size={18} /> Call</button>}
            {c.mobile && !blocked && <button type="button" className="btn outline" onClick={() => openWhatsApp(c.mobile, `Hi ${c.name.split(' ')[0]}, `)} data-testid="pc-wa"><MessageCircle size={18} /> WhatsApp</button>}
            <button type="button" className="btn outline" onClick={() => setSheet('outcome')} data-testid="pc-log"><ClipboardEdit size={18} /> Log a call</button>
          </div>
        </div>

        <div className="card col" style={{ gap: 10 }}>
          <div className="card-title"><Briefcase size={15} /> On openings ({c.pipelines.length})</div>
          {!c.pipelines.length && <div className="small muted">Not on any opening yet.</div>}
          <div className="list flat" style={{ boxShadow: 'none', border: c.pipelines.length ? '1px solid var(--line-soft)' : 0 }}>
            {c.pipelines.map((p) => (
              <div key={p.id} className="row" data-testid={`pc-pipe-${p.id}`}>
                <div className="main"><div className="title">{p.job_title}</div><div className="line">{p.client_name} · {p.job_code}</div>{p.reject_reason && <div className="line">Out: {p.reject_reason}</div>}</div>
                <span className={`tag ${STAGE_TAG[p.stage] || ''}`}>{p.stage}</span>
                {p.stage !== 'Joined' && <button type="button" className="icon-btn" aria-label="Move to another stage" onClick={() => setSheet({ move: { ...p, candidate_name: c.name } })} data-testid={`pc-move-${p.id}`}><ArrowRightLeft size={20} color="var(--brand)" /></button>}
              </div>
            ))}
          </div>
          {!blocked && <button type="button" className="btn outline" onClick={() => setSheet('open')} data-testid="pc-open"><Plus size={18} /> Put on an opening</button>}
        </div>

        {c.interviews.length > 0 && (
          <div className="card col" style={{ gap: 8 }}>
            <div className="card-title">Interviews</div>
            {c.interviews.slice(0, 5).map((i) => (
              <div key={i.id} className="small flex between"><span>{niceDate(i.scheduled_at.slice(0, 10))} {niceTime(stamp(i.scheduled_at))} · {i.round} · {i.job_title}</span><span className={`tag ${i.result === 'Cleared' ? 'ok' : ['Rejected', 'No show'].includes(i.result) ? 'bad' : 'info'}`}>{i.result}</span></div>
            ))}
          </div>
        )}

        <div className="card col" style={{ gap: 8 }}>
          <div className="card-title">Calls and notes</div>
          {!c.contacts.length && <div className="small muted">No call yet.</div>}
          {c.contacts.slice(0, 8).map((k) => (
            <div key={k.id} className="small col" style={{ gap: 2, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
              <div className="flex between"><span className="strong">{k.channel}{k.outcome ? ` · ${k.outcome}` : ''}</span><span className="tiny muted">{niceDate(k.at.slice(0, 10))}</span></div>
              {k.remark && <div className="muted">{k.remark}</div>}
              {k.next_follow_up && !k.follow_up_done && <div className="tiny" style={{ color: 'var(--info)' }}>Next: {niceDate(k.next_follow_up.slice(0, 10))}</div>}
            </div>
          ))}
        </div>
        {c.notes && <div className="card"><div className="card-title">Notes</div><div className="small">{c.notes}</div></div>}
      </div>
      {sheet === 'outcome' && <CallOutcome person={{ id: c.id, name: c.name }} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); setTimeout(load, 1200); }} />}
      {sheet && sheet.move && <MoveStage row={sheet.move} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet === 'open' && <PickOpening candidate={c} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
    </div>
  );
}
