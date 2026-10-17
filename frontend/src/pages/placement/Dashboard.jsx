/*
 * Placement desk — Dashboard: what needs attention today, and how the desk is doing.
 */
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, CalendarClock, PhoneCall, ReceiptText, ShieldCheck, Trophy, UserCheck, Send, BadgeCheck, Snowflake, Repeat } from 'lucide-react';
import { pl, useAsync, inr, inrShort, niceDate, niceTime, dayLabel, monthName, STAGE_HEX } from './pl';
import { Panel, Stat, Loading, LoadError, Empty } from './ui';

function Bar({ value, max, color = 'var(--color-brand)' }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-canvas-alt)' }}>
      <div className="h-full rounded-full" style={{ width: `${max ? Math.max(2, Math.round((value / max) * 100)) : 0}%`, background: color }} />
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const { data: d, error, loading, reload } = useAsync(() => pl.get('/dashboard'), []);
  if (!d) return error ? <LoadError error={error} onRetry={reload} /> : <Loading />;
  const funnelMax = Math.max(1, ...d.funnel.filter((f) => f.stage !== 'Rejected').map((f) => f.count));
  const live = d.funnel.filter((f) => !['Rejected', 'Joined'].includes(f.stage));
  const trendMax = Math.max(1, ...d.trend.map((t) => t.fee));
  const rate = d.submissions.previous ? Math.round(((d.submissions.week - d.submissions.previous) / d.submissions.previous) * 100) : null;
  const reasonMax = Math.max(1, ...d.reasons.map((r) => r.count));
  const srcMax = Math.max(1, ...d.sources.map((s) => s.candidates));

  return (
    <div className={loading ? 'opacity-90' : ''} data-testid="pl-dashboard">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5" data-testid="pl-figures">
        <Stat icon={Briefcase} tint="#D97706" label="Open positions" value={d.open.positions} sub={`${d.open.jobs} openings · ${d.open.hot} hot`} onClick={() => nav('/placement/jobs')} testid="fig-open" />
        <Stat icon={Send} tint="#6C4FF7" label="Submitted this week" value={d.submissions.week} sub={`last week ${d.submissions.previous}${rate !== null ? ` (${rate >= 0 ? '+' : ''}${rate}%)` : ''}`} onClick={() => nav('/placement/board')} testid="fig-sub" />
        <Stat icon={CalendarClock} tint="#0284C7" label="Interviews today" value={d.interviews.today} sub={`tomorrow ${d.interviews.tomorrow}${d.interviews.awaiting_feedback ? ` · ${d.interviews.awaiting_feedback} need feedback` : ''}`} alert={d.interviews.awaiting_feedback > 0} onClick={() => nav('/placement/interviews')} testid="fig-iv" />
        <Stat icon={BadgeCheck} tint="#D97706" label="Offers pending" value={d.offers.pending} sub={`fee ${inrShort(d.offers.pending_fee)} at stake`} onClick={() => nav('/placement/offers')} testid="fig-offers" />
        <Stat icon={UserCheck} tint="#059669" label="Joined this month" value={d.joined.month} sub={`fee ${inrShort(d.joined.month_fee)} · last month ${d.joined.previous_month}`} onClick={() => nav('/placement/offers?status=Joined')} testid="fig-joined" />
        <Stat icon={ReceiptText} tint="#16A34A" label="Fee to invoice" value={inrShort(d.fees.uninvoiced)} sub={`${d.fees.uninvoiced_count} joined · billed 30d ${inrShort(d.fees.billed_30)}`} onClick={() => nav('/placement/offers?status=Joined&uninvoiced=1')} testid="fig-fee" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Panel title="Pipeline right now" action={<Link to="/placement/board" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>Open the board</Link>} testid="pl-funnel">
          <div className="space-y-2.5">
            {live.map((f) => (
              <div key={f.stage} className="grid items-center gap-3" style={{ gridTemplateColumns: '7rem 1fr 2.125rem' }}>
                <span className="text-[13px] text-ink">{f.stage}</span>
                <Bar value={f.count} max={funnelMax} color={STAGE_HEX[f.stage]} />
                <span className="text-sm font-semibold text-ink text-right">{f.count}</span>
              </div>
            ))}
          </div>
          <div className="t-meta mt-3">On open and on-hold openings. {d.funnel.find((f) => f.stage === 'Rejected')?.count || 0} candidates are out.</div>
        </Panel>

        <Panel title="Interviews coming up" action={<Link to="/placement/interviews" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>All interviews</Link>} testid="pl-next-iv">
          {d.next_interviews.length === 0 ? <Empty title="No interview is fixed" /> : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }}>
              {d.next_interviews.map((i) => (
                <li key={i.id} className="py-2.5 flex items-start gap-3">
                  <div className="w-14 shrink-0 text-center rounded-lg py-1" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>
                    <div className="text-[10px] font-semibold uppercase">{dayLabel(i.scheduled_at, d.as_of)}</div>
                    <div className="text-xs font-bold">{niceTime(i.scheduled_at)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{i.candidate_name}</div>
                    <div className="t-meta truncate">{i.round} · {i.job_title} · {i.client_name}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Offers waiting to join" action={<Link to="/placement/offers" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>All offers</Link>} testid="pl-joining">
          {d.joining_soon.length === 0 ? <Empty title="No offer is open" /> : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }}>
              {d.joining_soon.map((o) => (
                <li key={o.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{o.candidate_name}</div>
                    <div className="t-meta truncate">{o.job_title} · {o.client_name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-semibold text-ink">{o.offered_ctc} L</div>
                    <div className="t-meta">{o.status === 'Accepted' ? 'accepted · ' : 'offered · '}joins {niceDate(o.expected_joining)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Panel title="Recruiters, last 30 days" testid="pl-leaders" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-muted)' }}>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide px-4 py-2">Recruiter</th>
                <th className="text-right text-[11px] font-semibold uppercase px-2 py-2">Sub</th>
                <th className="text-right text-[11px] font-semibold uppercase px-2 py-2">Int</th>
                <th className="text-right text-[11px] font-semibold uppercase px-2 py-2">Join</th>
                <th className="text-right text-[11px] font-semibold uppercase px-4 py-2">Fee</th>
              </tr></thead>
              <tbody>
                {d.leaderboard.map((r, k) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--color-line-soft)' }}>
                    <td className="px-4 py-2.5 font-medium text-ink"><span className="inline-flex items-center gap-2">{k === 0 && r.fee > 0 ? <Trophy className="w-4 h-4" style={{ color: '#D97706' }} /> : <span className="w-4" />}{r.name}</span></td>
                    <td className="px-2 py-2.5 text-right">{r.submissions}</td>
                    <td className="px-2 py-2.5 text-right">{r.interviews}</td>
                    <td className="px-2 py-2.5 text-right font-semibold">{r.joined}</td>
                    <td className="px-4 py-2.5 text-right">{inrShort(r.fee)}</td>
                  </tr>
                ))}
                {d.leaderboard.length === 0 && <tr><td colSpan={5}><Empty title="No activity yet" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Fee from joinings, last 6 months" testid="pl-trend">
          <div className="flex items-end gap-3 h-40">
            {d.trend.map((t) => (
              <div key={t.month} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5" title={`${monthName(t.month)}: ${t.placements} joined, ${inr(t.fee)}`}>
                <span className="text-[11px] font-semibold text-ink">{t.fee ? inrShort(t.fee) : ''}</span>
                <div className="w-full rounded-t-lg" style={{ height: `${t.fee ? Math.max(6, Math.round((t.fee / trendMax) * 100)) : 3}%`, background: t.fee ? 'linear-gradient(180deg, var(--color-brand), #8B7BFA)' : 'var(--color-canvas-alt)' }} />
                <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{monthName(t.month).slice(0, 3)}</span>
                <span className="text-[10px]" style={{ color: 'var(--color-faint)' }}>{t.placements} joined</span>
              </div>
            ))}
          </div>
          <div className="t-meta mt-3">{d.days_to_fill !== null ? `On average an opening is filled in ${d.days_to_fill} days.` : 'Days to fill shows once an opening is filled.'}</div>
        </Panel>

        <Panel title="Where candidates come from" testid="pl-sources">
          <div className="space-y-2.5">
            {d.sources.map((s) => (
              <div key={s.source}>
                <div className="flex items-center justify-between text-[13px] mb-1"><span className="text-ink font-medium">{s.source}</span><span className="t-meta">{s.candidates} candidates · {s.placed} placed ({s.rate}%)</span></div>
                <Bar value={s.candidates} max={srcMax} color="#0D9488" />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Panel title="Openings going cold" testid="pl-cold" action={<Snowflake className="w-4 h-4" style={{ color: 'var(--color-info)' }} />}>
          {d.cold.length === 0 ? <Empty title="Every opening has had movement">Nothing is quiet for long.</Empty> : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }}>
              {d.cold.map((j) => (
                <li key={j.id}><Link to={`/placement/jobs/${j.id}`} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-ink truncate">{j.title}</div><div className="t-meta truncate">{j.code} · {j.client_name}</div></div>
                  <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--color-danger-strong)' }}>{j.quiet_days} days quiet</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Calls to make" testid="pl-followups" action={<PhoneCall className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />}>
          {d.follow_ups.length === 0 ? <Empty title="No follow-up is due" /> : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }}>
              {d.follow_ups.map((f) => (
                <li key={f.id}><Link to={`/placement/candidates/${f.candidate_id}`} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-ink truncate">{f.name}</div><div className="t-meta truncate">{f.designation || ''}{f.current_company ? ` · ${f.current_company}` : ''}</div></div>
                  <span className="text-xs shrink-0 font-medium" style={{ color: f.next_follow_up.slice(0, 10) < d.as_of ? 'var(--color-danger-strong)' : 'var(--color-ink-light)' }}>{dayLabel(f.next_follow_up, d.as_of)}{niceTime(f.next_follow_up) ? ` ${niceTime(f.next_follow_up)}` : ''}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Why candidates drop out" testid="pl-reasons">
          <div className="space-y-2.5">
            {d.reasons.map((r) => (
              <div key={r.reason}>
                <div className="flex items-center justify-between text-[13px] mb-1"><span className="text-ink">{r.reason}</span><span className="font-semibold text-ink">{r.count}</span></div>
                <Bar value={r.count} max={reasonMax} color="#F43F5E" />
              </div>
            ))}
            {d.reasons.length === 0 && <Empty title="Nobody has dropped out yet" />}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title="Contract staffing" testid="pl-contract" action={<Link to="/placement/deployed" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>Deployed resources</Link>}>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div><div className="text-lg font-bold text-ink">{d.contract.active}</div><div className="t-meta">deployed</div></div>
            <div><div className="text-lg font-bold text-ink">{inrShort(d.contract.billing)}</div><div className="t-meta">billing / month</div></div>
            <div><div className="text-lg font-bold" style={{ color: 'var(--color-success-strong)' }}>{inrShort(d.contract.margin)}</div><div className="t-meta">margin · {d.contract.margin_percent}%</div></div>
          </div>
          {d.contract.renewals.length === 0 ? <div className="t-meta">No contract ends in the next 30 days.</div> : (
            <>
              <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5 text-ink"><Repeat className="w-3.5 h-3.5" /> Renewals due ({d.contract.renewal_count})</div>
              <ul className="space-y-1.5">
                {d.contract.renewals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-[13px]"><span className="truncate pr-2">{r.person_name} · {r.client_name}</span><span className="shrink-0 font-medium" style={{ color: r.ends_in <= 14 ? 'var(--color-danger-strong)' : 'var(--color-warning-strong)' }}>{r.ends_in} days</span></li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Money" testid="pl-money" action={<Link to="/placement/invoices" className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>Invoices</Link>}>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted" style={{ color: 'var(--color-muted)' }}>Billed in the last 30 days</dt><dd className="font-semibold text-ink">{inr(d.fees.billed_30)}</dd></div>
            <div className="flex justify-between"><dt style={{ color: 'var(--color-muted)' }}>Not yet paid by clients</dt><dd className="font-semibold text-ink">{inr(d.fees.outstanding)}</dd></div>
            <div className="flex justify-between"><dt style={{ color: 'var(--color-muted)' }}>Joined, invoice not made</dt><dd className="font-semibold" style={{ color: d.fees.uninvoiced ? 'var(--color-warning-strong)' : 'var(--color-ink)' }}>{inr(d.fees.uninvoiced)}</dd></div>
            <div className="flex justify-between"><dt style={{ color: 'var(--color-muted)' }}>Fee in open offers</dt><dd className="font-semibold text-ink">{inr(d.fees.pipeline)}</dd></div>
          </dl>
        </Panel>

        <Panel title="Replacement guarantee ending" testid="pl-guarantee" action={<ShieldCheck className="w-4 h-4" style={{ color: 'var(--color-success)' }} />}>
          {d.guarantee_ending.length === 0 ? <Empty title="No guarantee ends in 14 days" /> : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-line-soft)' }}>
              {d.guarantee_ending.map((g) => (
                <li key={g.id} className="py-2.5 flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm"><b className="font-medium text-ink">{g.candidate_name}</b> <span className="t-meta">· {g.client_name}</span></span><span className="text-xs shrink-0 font-medium">{niceDate(g.guarantee_end)}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
