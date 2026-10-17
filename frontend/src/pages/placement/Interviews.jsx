/*
 * Placement desk — Interviews: today, tomorrow, this week; write the result,
 * change the time. Each interview is also a meeting on the calendar.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CalendarDays, PhoneCall, Video, MapPin, Phone } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, niceTime, dayLabel, todayStr } from './pl';
import { Seg, Loading, LoadError, Empty } from './ui';
import { ResultModal, ScheduleModal } from './Forms';

const MODE_ICON = { Video, Phone, 'In person': MapPin };
const RES_TONE = { Scheduled: 'info', Cleared: 'success', Rejected: 'danger', 'No show': 'danger', 'On hold': 'neutral', Cancelled: 'neutral' };

export default function Interviews() {
  const meta = usePlacementMeta();
  const [range, setRange] = useState('today');
  const query = range === 'feedback' ? { pending: 1 } : { range };
  const { data, error, reload } = useAsync(() => pl.get('/interviews', query), [range]);
  const { data: counts } = useAsync(async () => {
    const [t, tm, w] = await Promise.all([pl.get('/interviews', { range: 'today' }), pl.get('/interviews', { range: 'tomorrow' }), pl.get('/interviews', { pending: 1 })]);
    return { today: t.length, tomorrow: tm.length, feedback: w.length };
  }, []);
  const [res, setRes] = useState(null);
  const [edit, setEdit] = useState(null);
  const canEdit = !!meta?.can?.edit;
  const today = meta?.today || todayStr();
  const groups = useMemo(() => {
    const m = new Map();
    (data || []).forEach((i) => { const d = i.scheduled_at.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(i); });
    return [...m.entries()];
  }, [data]);

  return (
    <div data-testid="pl-interviews">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Seg label="When" value={range} onChange={setRange} options={[['today', 'Today', counts?.today], ['tomorrow', 'Tomorrow', counts?.tomorrow], ['week', 'Next 7 days'], ['upcoming', 'All upcoming'], ['feedback', 'Need feedback', counts?.feedback], ['past', 'Past']]} />
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : groups.length === 0 ? (
        <div className="card"><Empty icon={CalendarClock} title={range === 'feedback' ? 'No interview is waiting for feedback' : 'No interview here'}>{range === 'today' ? 'Nothing is fixed for today.' : 'Fix interviews from the pipeline board or a candidate.'}</Empty></div>
      ) : groups.map(([day, list]) => (
        <section key={day} className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-2" style={{ color: 'var(--color-muted)' }}><CalendarDays className="w-3.5 h-3.5" /> {dayLabel(day, today)} <span className="font-normal">· {list.length}</span></h3>
          <div className="space-y-2">
            {list.map((i) => {
              const Icon = MODE_ICON[i.mode] || Video;
              const overdue = i.result === 'Scheduled' && i.scheduled_at < `${today} ${new Date().toISOString().slice(11, 16)}` && day <= today;
              return (
                <div key={i.id} className="card p-3 flex items-center gap-3 flex-wrap" data-testid={`iv-${i.id}`}>
                  <div className="w-16 text-center shrink-0 rounded-xl py-1.5" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}><div className="text-sm font-bold">{niceTime(i.scheduled_at)}</div><div className="text-[10px] font-semibold">{i.duration_min} min</div></div>
                  <div className="min-w-0 flex-1" style={{ minWidth: '13.75rem' }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/placement/candidates/${i.candidate_id}`} className="text-sm font-semibold text-ink hover:underline">{i.candidate_name}</Link>
                      <Badge tone="special" size="xs">{i.round}</Badge>
                      <Badge tone={RES_TONE[i.result] || 'neutral'} size="xs">{i.result}</Badge>
                      {overdue && <span className="text-[11px] font-medium" style={{ color: 'var(--color-danger-strong)' }}>feedback due</span>}
                    </div>
                    <div className="t-meta truncate"><Link to={`/placement/jobs/${i.job_id}`} className="hover:underline">{i.job_title}</Link> · {i.client_name}</div>
                    <div className="t-meta truncate flex items-center gap-1.5"><Icon className="w-3 h-3" /> {i.mode}{i.panel ? ` · ${i.panel}` : ''}{i.link_or_place && i.mode !== 'Phone' ? ` · ${i.link_or_place}` : ''}</div>
                    {i.feedback && <div className="text-[12.5px] mt-1" style={{ color: 'var(--color-ink-light)' }}>“{i.feedback}”</div>}
                  </div>
                  <div className="t-meta shrink-0 text-right hidden md:block">{i.owner_name || ''}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    {i.mobile && i.result === 'Scheduled' && <a className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} href={`tel:${String(i.mobile).replace(/[^\d+]/g, '')}`} aria-label={`Call ${i.candidate_name}`}><PhoneCall className="w-3.5 h-3.5" /> Call</a>}
                    {canEdit && i.result === 'Scheduled' && <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setEdit(i)} data-testid={`iv-edit-${i.id}`}>Change time</button>}
                    {canEdit && i.result === 'Scheduled' && <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setRes(i)} data-testid={`iv-result-${i.id}`}>Result</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {res && <ResultModal iv={res} onClose={() => setRes(null)} onDone={() => { setRes(null); }} />}
      {edit && <ScheduleModal row={{ id: edit.pipeline_id, candidate_name: edit.candidate_name, job_title: edit.job_title, client_name: edit.client_name, email: edit.email, stage: edit.stage }} iv={edit} onClose={() => setEdit(null)} onDone={() => setEdit(null)} />}
    </div>
  );
}
