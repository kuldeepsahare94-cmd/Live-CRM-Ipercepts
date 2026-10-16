/*
 * Placement desk — Offers & joinings: from the offer to the joining, the
 * replacement guarantee, and the invoice for the fee.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, ReceiptText } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, placementChanged, inr, lakh, niceDate, todayStr } from './pl';
import { Modal, Field, Err, Seg, Loading, LoadError, Empty, toast, th, td, rowStyle } from './ui';

const TONE = { Offered: 'warning', Accepted: 'info', Declined: 'danger', Joined: 'success', Dropped: 'danger' };

function OfferModal({ o, onClose }) {
  const meta = usePlacementMeta();
  const [f, setF] = useState({ offered_ctc: o.offered_ctc ?? '', fee_percent: o.fee_percent ?? '', expected_joining: o.expected_joining || '', actual_joining: o.actual_joining || todayStr(), decline_reason: 'Candidate not interested', notes: o.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const feePreview = f.offered_ctc && f.fee_percent ? Math.round(Number(f.offered_ctc) * 100000 * (Number(f.fee_percent) / 100)) : 0;
  const send = async (extra) => {
    setBusy(true); setErr('');
    try {
      await pl.put(`/offers/${o.id}`, { offered_ctc: f.offered_ctc, fee_percent: f.fee_percent || undefined, expected_joining: f.expected_joining || undefined, notes: f.notes, ...extra });
      toast('Offer saved'); placementChanged(); onClose();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const open = ['Offered', 'Accepted'].includes(o.status);
  return (
    <Modal title="Offer" subtitle={`${o.candidate_name} · ${o.job_title} · ${o.client_name}`} onClose={onClose} busy={busy} testid="offer-modal"
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({})} data-testid="offer-save">Save details</button>
      </>}>
      <Err>{err}</Err>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Offered CTC (lakh a year)"><input className="input" type="number" step="0.1" min="0" value={f.offered_ctc} onChange={on('offered_ctc')} data-testid="offer-ctc" /></Field>
        <Field label="Fee %" hint={feePreview ? `Fee: ${inr(feePreview)} (before GST)` : ''}><input className="input" type="number" step="0.01" min="0" max="100" value={f.fee_percent} onChange={on('fee_percent')} data-testid="offer-fee" /></Field>
        {o.status !== 'Joined' && <Field label="Expected joining"><input className="input" type="date" value={f.expected_joining} onChange={on('expected_joining')} /></Field>}
        {o.status === 'Joined' && <Field label="Actual joining"><input className="input" type="date" value={f.actual_joining} onChange={on('actual_joining')} /></Field>}
        <Field label="Notes" className="col-span-2"><textarea className="input" rows={2} value={f.notes} onChange={on('notes')} /></Field>
      </div>
      {meta?.can?.edit && open && (
        <div className="mt-4 pt-4 space-y-3" style={{ borderTop: '1px solid var(--color-line)' }}>
          <div className="text-xs font-semibold text-ink">What happened?</div>
          <div className="flex flex-wrap gap-2">
            {o.status === 'Offered' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => send({ status: 'Accepted' })} data-testid="offer-accepted">Candidate accepted</button>}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({ status: 'Joined', actual_joining: f.actual_joining })} data-testid="offer-joined">Candidate joined</button>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <Field label="Joining date (if joined)"><input className="input" type="date" value={f.actual_joining} onChange={on('actual_joining')} /></Field>
            <div className="flex gap-2 items-end">
              <Field label="If out, why" className="flex-1"><select className="input" value={f.decline_reason} onChange={on('decline_reason')}>{(meta?.reject_reasons || []).map((r) => <option key={r}>{r}</option>)}</select></Field>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => send({ status: 'Declined', decline_reason: f.decline_reason })} data-testid="offer-declined">Declined</button>
            </div>
          </div>
        </div>
      )}
      {meta?.can?.edit && o.status === 'Joined' && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-line)' }}>
          <div className="text-xs font-semibold text-ink mb-2">The person left?</div>
          <div className="flex gap-2 items-end">
            <Field label="Reason" className="flex-1"><select className="input" value={f.decline_reason} onChange={on('decline_reason')}>{(meta?.reject_reasons || []).map((r) => <option key={r}>{r}</option>)}</select></Field>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { if (window.confirm('Mark this joining as dropped? The opening will be open again for a replacement.')) send({ status: 'Dropped', decline_reason: f.decline_reason }); }} data-testid="offer-dropped">Left / dropped</button>
          </div>
          <p className="t-meta mt-2">The position opens again, so a replacement can be placed under the guarantee.</p>
        </div>
      )}
    </Modal>
  );
}

export default function Offers() {
  const meta = usePlacementMeta();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || 'pending';
  const uninvoiced = sp.get('uninvoiced') === '1';
  const { data, error, reload } = useAsync(() => pl.get('/offers'), []);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(0);
  const canCreate = !!meta?.can?.create;
  const counts = useMemo(() => {
    const c = { pending: 0, Joined: 0, out: 0, all: 0, uninv: 0 };
    (data || []).forEach((o) => { c.all += 1; if (['Offered', 'Accepted'].includes(o.status)) c.pending += 1; if (o.status === 'Joined') { c.Joined += 1; if (!o.invoice_id) c.uninv += 1; } if (['Declined', 'Dropped'].includes(o.status)) c.out += 1; });
    return c;
  }, [data]);
  const rows = (data || []).filter((o) => (uninvoiced ? o.status === 'Joined' && !o.invoice_id : status === 'all' ? true : status === 'pending' ? ['Offered', 'Accepted'].includes(o.status) : status === 'out' ? ['Declined', 'Dropped'].includes(o.status) : o.status === status));
  const choose = (s) => setSp(s === 'pending' ? {} : { status: s });
  const invoice = async (o) => {
    if (!window.confirm(`Make the invoice for ${o.candidate_name}?\n\nFee ${inr(o.fee_amount)} (${o.fee_percent}% of ${o.offered_ctc} lakh), plus GST.`)) return;
    setBusy(o.id);
    try { const r = await pl.post(`/offers/${o.id}/invoice`); toast(`Invoice ${r.doc_number} made`); placementChanged(); } catch (x) { toast(x.message, 'bad'); } finally { setBusy(0); }
  };

  return (
    <div data-testid="pl-offers">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Seg label="Offers" value={uninvoiced ? 'uninv' : status} onChange={(v) => (v === 'uninv' ? setSp({ status: 'Joined', uninvoiced: '1' }) : choose(v))}
          options={[['pending', 'Waiting to join', counts.pending], ['Joined', 'Joined', counts.Joined], ['uninv', 'Joined, no invoice', counts.uninv], ['out', 'Declined / dropped', counts.out], ['all', 'All', counts.all]]} />
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="offers-table">
              <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                <th className={th}>Candidate</th><th className={th}>Opening</th><th className={th}>Offer</th><th className={th}>Fee</th><th className={th}>Joining</th><th className={th}>Guarantee</th><th className={th}>Status</th><th className={th}>Invoice</th>
              </tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} style={rowStyle} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setOpen(o)} data-testid={`offer-row-${o.id}`}>
                    <td className={td}><Link to={`/placement/candidates/${o.candidate_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline">{o.candidate_name}</Link><div className="t-meta">{o.owner_name || ''}</div></td>
                    <td className={td}>{o.job_title}<div className="t-meta">{o.client_name}</div></td>
                    <td className={td}><b className="text-ink">{lakh(o.offered_ctc)}</b><div className="t-meta">{niceDate(o.offer_date)}</div></td>
                    <td className={td}>{o.fee_amount ? <><b className="text-ink">{inr(o.fee_amount)}</b><div className="t-meta">{o.fee_percent}%</div></> : <span className="t-meta">contract</span>}</td>
                    <td className={td}>{o.status === 'Joined' ? <>{niceDate(o.actual_joining)}</> : <>{niceDate(o.expected_joining)}{o.joining_in !== null && ['Offered', 'Accepted'].includes(o.status) ? <div className="t-meta" style={{ color: o.joining_in < 0 ? 'var(--color-danger-strong)' : undefined }}>{o.joining_in < 0 ? `${-o.joining_in} days late` : o.joining_in === 0 ? 'today' : `in ${o.joining_in} days`}</div> : null}</>}</td>
                    <td className={td}>{o.status === 'Joined' && o.guarantee_end ? <>{o.in_guarantee ? <span style={{ color: 'var(--color-success-strong)' }}>{o.guarantee_left} days left</span> : <span className="t-meta">over</span>}<div className="t-meta">till {niceDate(o.guarantee_end)}</div></> : '—'}</td>
                    <td className={td}><Badge tone={TONE[o.status]}>{o.status}</Badge>{o.decline_reason ? <div className="t-meta mt-0.5">{o.decline_reason}</div> : null}</td>
                    <td className={td} onClick={(e) => e.stopPropagation()}>
                      {o.invoice_id ? <Link to={`/records/invoices/${o.invoice_id}`} className="underline text-ink">{o.invoice_number}</Link>
                        : o.status === 'Joined' && o.fee_amount && canCreate ? <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy === o.id} onClick={() => invoice(o)} data-testid={`invoice-${o.id}`}><ReceiptText className="w-3.5 h-3.5" /> {busy === o.id ? 'Making…' : 'Make invoice'}</button>
                          : <span className="t-meta">—</span>}
                      {o.invoice_id && <div className="t-meta">{o.invoice_payment}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <Empty icon={BadgeCheck} title="No offer here">Offers appear when a candidate is moved to "Offered" on the pipeline board.</Empty>}
        </div>
      )}
      {open && <OfferModal o={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
