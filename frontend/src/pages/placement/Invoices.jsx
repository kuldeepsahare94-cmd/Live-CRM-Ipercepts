/*
 * Placement desk — Invoices raised for placement fees and contract staffing.
 * (They are ordinary CRM invoices; this is just the list for this desk.)
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ReceiptText } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, inr, niceDate, monthName } from './pl';
import { Seg, Loading, LoadError, Empty, Stat, th, td, rowStyle } from './ui';

const PAY_TONE = { Paid: 'success', Partial: 'warning', 'Partially Paid': 'warning', Unpaid: 'danger' };

export default function Invoices() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, reload } = useAsync(() => pl.get('/invoices', { kind, status }), [kind, status]);
  const t = data?.totals;
  return (
    <div data-testid="pl-invoices">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Seg label="Type" value={kind} onChange={setKind} options={[['', 'All'], ['Placement fee', 'Placement fees'], ['Contract staffing', 'Contract staffing']]} />
        <Seg label="Payment" value={status} onChange={setStatus} options={[['', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue']]} />
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Stat icon={ReceiptText} label="Billed" value={inr(t.billed)} />
            <Stat icon={ReceiptText} label="Not yet received" value={inr(t.outstanding)} tint="#F59E0B" />
            <Stat icon={ReceiptText} label="Overdue" value={inr(t.overdue)} tint="#F43F5E" alert={t.overdue > 0} />
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="inv-table">
                <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                  <th className={th}>Invoice</th><th className={th}>Client</th><th className={th}>For</th><th className={th}>Date</th><th className={th}>Due</th><th className={th}>Amount</th><th className={th}>Balance</th><th className={th}>Payment</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.id}-${r.kind}`} style={rowStyle}>
                      <td className={td}><Link to={`/records/invoices/${r.id}`} className="font-medium text-ink underline">{r.doc_number}</Link></td>
                      <td className={td}>{r.client_name}</td>
                      <td className={td}><Badge tone={r.kind === 'Placement fee' ? 'special' : 'info'} size="xs">{r.kind}</Badge><div className="t-meta">{r.kind === 'Contract staffing' ? monthName(r.detail) : r.detail}</div></td>
                      <td className={td}>{niceDate(r.doc_date)}</td>
                      <td className={td}><span style={r.overdue ? { color: 'var(--color-danger-strong)', fontWeight: 600 } : undefined}>{niceDate(r.due_date)}</span></td>
                      <td className={td}><b className="text-ink">{inr(r.grand_total)}</b></td>
                      <td className={td}>{inr(r.balance_due)}</td>
                      <td className={td}><Badge tone={PAY_TONE[r.payment_status] || 'neutral'} size="xs">{r.payment_status || '—'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && <Empty icon={ReceiptText} title="No invoice yet">Make an invoice from "Offers & joinings" or from "Timesheets".</Empty>}
          </div>
        </>
      )}
    </div>
  );
}
