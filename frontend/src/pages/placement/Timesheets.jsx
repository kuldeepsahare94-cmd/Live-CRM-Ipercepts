/*
 * Placement desk — Timesheets: approved days for each deployed person in a
 * month, what to bill and pay, and one invoice for each client.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ReceiptText, Clock } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, placementChanged, inr, monthName, todayStr } from './pl';
import { Loading, LoadError, Empty, toast, th, td, rowStyle, Stat } from './ui';

const TONE = { 'Not entered': 'neutral', Draft: 'warning', Approved: 'info', Invoiced: 'success' };
const shift = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function Row({ r, month, canEdit, onSaved }) {
  const [days, setDays] = useState(String(r.approved_days ?? 0));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDays(String(r.approved_days ?? 0)); }, [r.approved_days, r.id, month]);
  const locked = r.status === 'Invoiced' || !canEdit;
  const wd = r.working_days;
  const n = Number(days);
  const bad = days === '' || !Number.isFinite(n) || n < 0 || n > wd;
  const live = bad ? null : { bill: Math.round((r.bill_rate / wd) * n), pay: Math.round((r.pay_rate / wd) * n) };
  const dirty = String(r.approved_days ?? 0) !== days;
  const save = async (approve) => {
    if (bad) { toast(`Days must be between 0 and ${wd}.`, 'bad'); return; }
    setBusy(true);
    try { await pl.post('/timesheets', { deployed_id: r.deployed_id, month, approved_days: n, working_days: wd, approve }); toast(approve ? 'Approved' : 'Saved'); placementChanged(); onSaved(); }
    catch (x) { toast(x.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <tr style={rowStyle} data-testid={`ts-row-${r.deployed_id}`}>
      <td className={td}><div className="font-medium text-ink">{r.person_name}</div><div className="t-meta">{r.role_title || ''}</div></td>
      <td className={td}>{r.client_name}</td>
      <td className={td}>
        {locked ? <b className="text-ink">{r.approved_days}</b> : (
          <input className="input" style={{ width: 70, padding: '4px 8px', borderColor: bad ? 'var(--color-danger)' : undefined }} type="number" min="0" max={wd} step="0.5" value={days} onChange={(e) => setDays(e.target.value)} aria-label={`Approved days for ${r.person_name}`} data-testid={`ts-days-${r.deployed_id}`} />
        )}
        <span className="t-meta ml-1.5">of {wd}</span>
      </td>
      <td className={td}>{live && !locked ? inr(live.bill) : inr(r.billable)}</td>
      <td className={td}>{live && !locked ? inr(live.pay) : inr(r.payout)}</td>
      <td className={td}><b className="text-ink">{live && !locked ? inr(live.bill - live.pay) : inr(r.margin)}</b></td>
      <td className={td}><Badge tone={TONE[r.status]} size="xs">{r.status}</Badge></td>
      <td className={`${td} text-right whitespace-nowrap`}>
        {!locked && <>
          <button type="button" className="btn btn-secondary mr-2" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy || (!dirty && r.exists)} onClick={() => save(false)} data-testid={`ts-save-${r.deployed_id}`}>Save</button>
          {r.status !== 'Approved' && <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => save(true)} data-testid={`ts-approve-${r.deployed_id}`}>Approve</button>}
          {r.status === 'Approved' && dirty && <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => save(true)}>Save & approve</button>}
        </>}
        {r.invoice_id && <Link to={`/records/invoices/${r.invoice_id}`} className="underline text-ink text-xs">Invoice</Link>}
      </td>
    </tr>
  );
}

export default function Timesheets() {
  const meta = usePlacementMeta();
  const [month, setMonth] = useState((meta?.today || todayStr()).slice(0, 7));
  const { data, error, reload } = useAsync(() => pl.get('/timesheets', { month }), [month]);
  const [busy, setBusy] = useState(0);
  const canEdit = !!meta?.can?.edit;
  const ready = useMemo(() => {
    const m = new Map();
    (data?.rows || []).forEach((r) => { if (r.status === 'Approved' && !r.invoice_id) { const e = m.get(r.account_id) || { name: r.client_name, n: 0, amount: 0 }; e.n += 1; e.amount += r.billable; m.set(r.account_id, e); } });
    return [...m.entries()];
  }, [data]);
  const invoice = async (accountId, e) => {
    if (!window.confirm(`Make one invoice for ${e.name}, ${monthName(month)}?\n\n${e.n} ${e.n === 1 ? 'person' : 'people'}, ${inr(e.amount)} before GST.`)) return;
    setBusy(accountId);
    try { const r = await pl.post('/timesheets/invoice', { month, account_id: accountId }); toast(`Invoice ${r.doc_number} made`); placementChanged(); } catch (x) { toast(x.message, 'bad'); } finally { setBusy(0); }
  };
  const t = data?.totals;
  return (
    <div data-testid="pl-timesheets">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="inline-flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-line)' }}>
          <button type="button" className="px-2.5 py-1.5 hover:bg-slate-50" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-3 text-sm font-medium text-ink min-w-[110px] text-center" data-testid="ts-month">{monthName(month)}</span>
          <button type="button" className="px-2.5 py-1.5 hover:bg-slate-50" onClick={() => setMonth(shift(month, 1))} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <span className="t-meta">Working days in a month: {meta?.settings?.working_days ?? 26}</span>
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat icon={Clock} label="People on contract" value={t.resources} />
            <Stat icon={ReceiptText} label="To bill" value={inr(t.billable)} tint="#2563EB" />
            <Stat icon={ReceiptText} label="To pay out" value={inr(t.payout)} tint="#F59E0B" />
            <Stat icon={ReceiptText} label="Margin" value={inr(t.margin)} sub={`${t.margin_percent}% of billing`} tint="#10B981" />
          </div>
          {ready.length > 0 && canEdit && (
            <div className="card p-3 mb-4 flex items-center gap-3 flex-wrap" style={{ background: 'var(--color-brand-soft)' }} data-testid="ts-ready">
              <span className="text-sm font-medium text-ink">Ready to invoice:</span>
              {ready.map(([id, e]) => (
                <button key={id} type="button" className="btn btn-primary" disabled={busy === id} onClick={() => invoice(id, e)} data-testid={`ts-invoice-${id}`}>
                  <ReceiptText className="w-4 h-4" /> {e.name} · {inr(e.amount)}
                </button>
              ))}
            </div>
          )}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="ts-table">
                <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                  <th className={th}>Person</th><th className={th}>Client</th><th className={th}>Approved days</th><th className={th}>Bill</th><th className={th}>Pay</th><th className={th}>Margin</th><th className={th}>Status</th><th className={th} />
                </tr></thead>
                <tbody>{data.rows.map((r) => <Row key={`${r.deployed_id}-${month}`} r={r} month={month} canEdit={canEdit} onSaved={reload} />)}</tbody>
              </table>
            </div>
            {data.rows.length === 0 && <Empty icon={Clock} title="No one was on contract this month">Deploy a resource first. Then enter the approved days here each month.</Empty>}
          </div>
        </>
      )}
    </div>
  );
}
