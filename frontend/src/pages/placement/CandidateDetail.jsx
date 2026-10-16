/*
 * Placement desk — one candidate: profile, the openings they are on, calls and
 * follow-ups, interviews and the history of every move.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Mail, MessageCircle, PhoneCall, Pencil, Plus } from 'lucide-react';
import { Badge, Avatar } from '../../components/ui';
import { api } from '../../api';
import { pl, useAsync, usePlacementMeta, placementChanged, lakh, years, niceDate, niceWhen } from './pl';
import { Modal, Field, Err, Loading, LoadError, Empty, Panel, Seg, StageBadge, toast, th, td, rowStyle, Skills } from './ui';
import { CandidateForm, AddToJobModal, MoveMenu } from './Forms';
import { candTone } from './Candidates';

const waLink = (m) => `https://wa.me/${String(m || '').replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`;

function LogContactModal({ candidate, onClose, onDone }) {
  const meta = usePlacementMeta();
  const [f, setF] = useState({ channel: 'Call', outcome: 'Interested', remark: '', next_follow_up: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const quick = (days) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(d.getUTCDate() + days); setF((x) => ({ ...x, next_follow_up: `${d.toISOString().slice(0, 10)}T11:00` })); };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await pl.post(`/candidates/${candidate.id}/contact`, { ...f, next_follow_up: f.next_follow_up || undefined }); toast('Saved'); placementChanged(); onDone(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="Log a call or message" subtitle={candidate.name} onClose={onClose} busy={busy} testid="contact-modal"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pl-contact" className="btn btn-primary" disabled={busy} data-testid="contact-save">{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="pl-contact" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Err>{err}</Err></div>
        <Field label="How"><select className="input" value={f.channel} onChange={on('channel')}>{['Call', 'WhatsApp', 'Email', 'Meeting'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="What came of it"><select className="input" value={f.outcome} onChange={on('outcome')} data-testid="contact-outcome">{(meta?.contact_outcomes || []).map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Remark" className="col-span-2"><textarea className="input" rows={2} value={f.remark} onChange={on('remark')} placeholder="What was said" data-testid="contact-remark" /></Field>
        <Field label="Call again on" className="col-span-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input className="input" style={{ maxWidth: 220 }} type="datetime-local" value={f.next_follow_up} onChange={on('next_follow_up')} data-testid="contact-next" />
            {[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([t, d]) => <button key={t} type="button" className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--color-canvas-alt)' }} onClick={() => quick(d)}>{t}</button>)}
          </div>
        </Field>
        {f.outcome === 'Wrong number' && <p className="t-meta col-span-2">The candidate will be marked "Do not call".</p>}
      </form>
    </Modal>
  );
}

export default function CandidateDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const meta = usePlacementMeta();
  const { data: c, error, reload } = useAsync(() => pl.get(`/candidates/${id}`), [id]);
  const [tab, setTab] = useState('jobs');
  const [edit, setEdit] = useState(false);
  const [log, setLog] = useState(false);
  const [add, setAdd] = useState(false);
  if (!c) return error ? <LoadError error={error} onRetry={reload} /> : <Loading />;
  const canEdit = !!meta?.can?.edit;
  const done = async (cid) => { try { await pl.post(`/contacts/${cid}/done`); placementChanged(); } catch (x) { toast(x.message, 'bad'); } };
  const blocked = ['Do not call', 'Blacklisted'].includes(c.status);

  return (
    <div data-testid="pl-cand-detail">
      <button type="button" className="btn btn-ghost mb-2" onClick={() => nav('/placement/candidates')}><ArrowLeft className="w-4 h-4" /> All candidates</button>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card p-4 xl:col-span-1 self-start">
          <div className="flex items-start gap-3">
            <Avatar name={c.name} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-ink">{c.name}</h2>
              <div className="t-meta">{c.code} · owner {c.owner_name || '—'}</div>
              <div className="mt-1.5"><Badge tone={candTone(c.status)}>{c.status}</Badge></div>
            </div>
            {canEdit && <button type="button" className="btn btn-ghost" onClick={() => setEdit(true)} aria-label="Edit candidate" data-testid="edit-cand"><Pencil className="w-4 h-4" /></button>}
          </div>
          {blocked && <div className="mt-3 text-[13px] rounded-lg px-3 py-2" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger-strong)' }}>Marked "{c.status}". The person cannot be put on an opening.{c.notes ? ` ${c.notes}` : ''}</div>}
          <div className="flex items-center gap-2 flex-wrap mt-4">
            {c.mobile && !blocked && <a className="btn btn-primary" href={`tel:${String(c.mobile).replace(/[^\d+]/g, '')}`} data-testid="call-cand"><PhoneCall className="w-4 h-4" /> Call</a>}
            {c.mobile && !blocked && <a className="btn btn-secondary" href={waLink(c.mobile)} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4" /> WhatsApp</a>}
            {c.email && !blocked && <a className="btn btn-secondary" href={`mailto:${c.email}`}><Mail className="w-4 h-4" /> Email</a>}
            {canEdit && <button type="button" className="btn btn-secondary" onClick={() => setLog(true)} data-testid="log-contact">Log a call</button>}
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            {[
              ['Mobile', c.mobile], ['Email', c.email], ['City', c.city], ['Current company', c.current_company], ['Designation', c.designation],
              ['Experience', `${years(c.total_exp)} total · ${years(c.relevant_exp)} relevant`], ['CTC now → expected', `${lakh(c.current_ctc)} → ${lakh(c.expected_ctc)}`], ['Notice period', c.notice_period], ['Source', c.source],
              ['Last contacted', c.last_contacted ? niceDate(c.last_contacted) : 'never'], ['Added', niceDate(c.created_at)],
            ].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="t-meta shrink-0">{k}</dt><dd className="text-right text-ink break-all">{v || '—'}</dd></div>)}
          </dl>
          <div className="mt-3"><div className="t-meta mb-1">Skills</div><Skills text={c.skills} max={12} /></div>
          {c.resume && (
            <button type="button" className="btn btn-secondary mt-4 w-full justify-center" onClick={() => api.openPlacementFile(c.resume.id).catch((x) => toast(x.message, 'bad'))} data-testid="open-resume"><Download className="w-4 h-4" /> Resume · {c.resume.file_name}</button>
          )}
          {!c.resume && <div className="t-meta mt-4">No resume uploaded. Edit the candidate to add one.</div>}
          {c.next_follow_up && <div className="mt-4 text-[13px] rounded-lg px-3 py-2" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>Next call: <b>{niceWhen(c.next_follow_up)}</b></div>}
        </div>

        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Seg label="Candidate view" value={tab} onChange={setTab} options={[['jobs', 'Openings', c.pipelines.length], ['calls', 'Calls & follow-ups', c.contacts.length], ['interviews', 'Interviews', c.interviews.length], ['timeline', 'History', c.timeline.length]]} />
            {canEdit && !blocked && c.status !== 'Placed' && <button type="button" className="btn btn-primary" onClick={() => setAdd(true)} data-testid="put-on-job"><Plus className="w-4 h-4" /> Put on an opening</button>}
          </div>

          {tab === 'jobs' && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}><th className={th}>Opening</th><th className={th}>Client</th><th className={th}>Stage</th><th className={th}>Since</th><th className={th} /></tr></thead>
                <tbody>
                  {c.pipelines.map((p) => (
                    <tr key={p.id} style={rowStyle}>
                      <td className={td}><Link to={`/placement/jobs/${p.job_id}`} className="font-medium text-ink hover:underline">{p.job_title}</Link><div className="t-meta">{p.job_code}{p.hiring_type === 'Contract' ? ' · Contract' : ''}</div></td>
                      <td className={td}>{p.client_name}</td>
                      <td className={td}><StageBadge stage={p.stage} />{p.reject_reason ? <div className="t-meta mt-0.5">{p.reject_reason}</div> : null}</td>
                      <td className={td}>{niceDate(p.stage_changed_at)}</td>
                      <td className={td}>{canEdit && p.job_status === 'Open' && <MoveMenu row={{ ...p, candidate_name: c.name, expected_ctc: c.expected_ctc, email: c.email, client_name: p.client_name }} onMoved={reload} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.pipelines.length === 0 && <Empty title="Not on any opening yet">Use "Put on an opening".</Empty>}
            </div>
          )}

          {tab === 'calls' && (
            <Panel pad={false}>
              <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }} data-testid="contact-list">
                {c.contacts.map((k) => (
                  <li key={k.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}><PhoneCall className="w-4 h-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink"><b className="font-medium">{k.channel}</b> · {k.outcome || '—'} <span className="t-meta">· {niceWhen(k.at)} · {k.by_name || ''}</span></div>
                      {k.remark && <div className="text-[13px] mt-0.5" style={{ color: 'var(--color-ink-light)' }}>{k.remark}</div>}
                      {k.next_follow_up && <div className="text-xs mt-1" style={{ color: k.follow_up_done ? 'var(--color-faint)' : 'var(--color-brand)' }}>{k.follow_up_done ? 'Follow-up done' : `Call again ${niceWhen(k.next_follow_up)}`}{!k.follow_up_done && canEdit && <button type="button" className="underline ml-2" onClick={() => done(k.id)}>Mark done</button>}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              {c.contacts.length === 0 && <Empty title="No call is logged yet" />}
            </Panel>
          )}

          {tab === 'interviews' && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}><th className={th}>When</th><th className={th}>Round</th><th className={th}>Opening</th><th className={th}>Result</th><th className={th}>Feedback</th></tr></thead>
                <tbody>
                  {c.interviews.map((i) => (
                    <tr key={i.id} style={rowStyle}><td className={td}>{niceWhen(i.scheduled_at)}</td><td className={td}>{i.round} · {i.mode}</td><td className={td}>{i.job_title}<div className="t-meta">{i.client_name}</div></td><td className={td}><Badge status={i.result}>{i.result}</Badge></td><td className={td} style={{ maxWidth: 320 }}>{i.feedback || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              {c.interviews.length === 0 && <Empty title="No interview yet" />}
            </div>
          )}

          {tab === 'timeline' && (
            <Panel pad={false}>
              <ol className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }}>
                {c.timeline.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--color-brand)' }} />
                    <div className="min-w-0 flex-1"><div className="text-ink">{t.from_stage ? <>{t.from_stage} → <b>{t.to_stage}</b></> : <b>{t.to_stage}</b>} <span className="t-meta">· {t.job_title} · {t.client_name}</span></div>
                      {(t.remark || t.reason) && <div className="t-meta">{[t.reason, t.remark].filter(Boolean).join(' · ')}</div>}</div>
                    <div className="t-meta text-right shrink-0">{niceWhen(t.at)}<div>{t.by_name || ''}</div></div>
                  </li>
                ))}
              </ol>
              {c.timeline.length === 0 && <Empty title="Nothing has happened yet" />}
            </Panel>
          )}
        </div>
      </div>
      {edit && <CandidateForm candidate={c} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />}
      {log && <LogContactModal candidate={c} onClose={() => setLog(false)} onDone={() => setLog(false)} />}
      {add && <AddToJobModal candidate={c} onClose={() => setAdd(false)} onDone={() => { setAdd(false); setTab('jobs'); }} />}
    </div>
  );
}
