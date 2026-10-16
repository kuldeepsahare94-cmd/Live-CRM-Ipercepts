/*
 * Placement desk — Deployed resources (contract staffing): people placed on
 * a client's contract, bill rate vs pay rate, and when the contract ends.
 */
import { useState } from 'react';
import { Users, Plus, RefreshCw } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, placementChanged, inr, niceDate, todayStr } from './pl';
import { Modal, Field, Err, Loading, LoadError, Empty, SearchBox, Seg, toast, th, td, rowStyle } from './ui';

function DeployForm({ dep, onClose }) {
  const d = dep || {};
  const isNew = !d.id;
  const { data: clients } = useAsync(() => pl.get('/clients'), []);
  const { data: people } = useAsync(() => pl.get('/people'), []);
  const [f, setF] = useState({
    account_id: d.account_id || '', person_name: d.person_name || '', role_title: d.role_title || '', bill_rate: d.bill_rate ?? '', pay_rate: d.pay_rate ?? '',
    start_date: d.start_date || todayStr(), end_date: d.end_date || '', owner_id: d.owner_id || '', notes: d.notes || '', status: d.status || 'Active',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const margin = Number(f.bill_rate) - Number(f.pay_rate);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (isNew) await pl.post('/deployed', f); else await pl.put(`/deployed/${d.id}`, f);
      toast(isNew ? 'Resource added' : 'Saved'); placementChanged(); onClose();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Deploy a resource' : 'Edit resource'} subtitle={isNew ? 'A person working on a client contract' : d.person_name} onClose={onClose} busy={busy} wide testid="deploy-form"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="deploy-form" className="btn btn-primary" disabled={busy} data-testid="deploy-save">{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="deploy-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Err>{err}</Err></div>
        <Field label="Person" required><input className="input" value={f.person_name} onChange={on('person_name')} data-testid="deploy-name" /></Field>
        <Field label="Role"><input className="input" value={f.role_title} onChange={on('role_title')} /></Field>
        <Field label="Client" required><select className="input" value={f.account_id} onChange={on('account_id')} data-testid="deploy-client"><option value="">Choose…</option>{(clients || []).map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}</select></Field>
        <Field label="Managed by"><select className="input" value={f.owner_id} onChange={on('owner_id')}><option value="">Me</option>{(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Bill rate (₹ a month)" required><input className="input" type="number" min="0" value={f.bill_rate} onChange={on('bill_rate')} data-testid="deploy-bill" /></Field>
        <Field label="Pay rate (₹ a month)" required hint={f.bill_rate && f.pay_rate !== '' ? `Margin ${inr(margin)} a month` : ''}><input className="input" type="number" min="0" value={f.pay_rate} onChange={on('pay_rate')} data-testid="deploy-pay" /></Field>
        <Field label="Start date"><input className="input" type="date" value={f.start_date} onChange={on('start_date')} /></Field>
        <Field label="Contract ends"><input className="input" type="date" value={f.end_date} onChange={on('end_date')} /></Field>
        {!isNew && <Field label="Status"><select className="input" value={f.status} onChange={on('status')}><option>Active</option><option>Ended</option></select></Field>}
        <Field label="Notes" className="col-span-2"><textarea className="input" rows={2} value={f.notes} onChange={on('notes')} /></Field>
      </form>
    </Modal>
  );
}

function RenewModal({ dep, onClose }) {
  const [f, setF] = useState({ end_date: '', bill_rate: dep.bill_rate, pay_rate: dep.pay_rate });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => {
    setBusy(true); setErr('');
    try { await pl.post(`/deployed/${dep.id}/renew`, f); toast('Contract renewed'); placementChanged(); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="Renew contract" subtitle={`${dep.person_name} · ${dep.client_name} · now ends ${niceDate(dep.end_date)}`} onClose={onClose} busy={busy} testid="renew-modal"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" onClick={go} disabled={busy} data-testid="renew-save">{busy ? 'Saving…' : 'Renew'}</button></>}>
      <Err>{err}</Err>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New end date" required className="col-span-2"><input className="input" type="date" min={dep.end_date || undefined} value={f.end_date} onChange={on('end_date')} data-testid="renew-date" /></Field>
        <Field label="Bill rate (₹ a month)"><input className="input" type="number" value={f.bill_rate} onChange={on('bill_rate')} /></Field>
        <Field label="Pay rate (₹ a month)"><input className="input" type="number" value={f.pay_rate} onChange={on('pay_rate')} /></Field>
      </div>
    </Modal>
  );
}

export default function Deployed() {
  const meta = usePlacementMeta();
  const [status, setStatus] = useState('Active');
  const [q, setQ] = useState('');
  const [renewal, setRenewal] = useState(false);
  const { data, error, reload } = useAsync(() => pl.get('/deployed', { status, q, renewal }), [status, q, renewal]);
  const [form, setForm] = useState(null);
  const [renew, setRenew] = useState(null);
  const rows = data || [];
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const margin = rows.reduce((s, r) => s + (r.status === 'Active' ? r.margin : 0), 0);
  return (
    <div data-testid="pl-deployed">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search person, role, client" />
        <Seg label="Status" value={status} onChange={setStatus} options={[['Active', 'Active'], ['Ended', 'Ended'], ['all', 'All']]} />
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer"><input type="checkbox" checked={renewal} onChange={(e) => setRenewal(e.target.checked)} data-testid="renewal-only" /> Ending in 30 days</label>
        <div className="flex-1" />
        {meta?.can?.create && <button type="button" className="btn btn-primary" onClick={() => setForm({})} data-testid="deploy-add"><Plus className="w-4 h-4" /> Deploy a resource</button>}
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 t-meta flex gap-5 flex-wrap" style={{ borderBottom: '1px solid var(--color-line-soft)' }}>
            <span><b className="text-ink">{rows.length}</b> people</span>
            {status !== 'Ended' && <span>Margin a month <b className="text-ink">{inr(margin)}</b></span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="deployed-table">
              <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                <th className={th}>Person</th><th className={th}>Client</th><th className={th}>Bill / month</th><th className={th}>Pay / month</th><th className={th}>Margin</th><th className={th}>Contract</th><th className={th}>Status</th><th className={th} />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={rowStyle} data-testid={`dep-row-${r.id}`}>
                    <td className={td}><div className="font-medium text-ink">{r.person_name}</div><div className="t-meta">{r.role_title || ''}</div></td>
                    <td className={td}>{r.client_name}<div className="t-meta">{r.owner_name || ''}</div></td>
                    <td className={td}>{inr(r.bill_rate)}</td>
                    <td className={td}>{inr(r.pay_rate)}</td>
                    <td className={td}><b className="text-ink">{inr(r.margin)}</b><div className="t-meta">{r.margin_percent}%</div></td>
                    <td className={td}>{niceDate(r.start_date)} → {r.end_date ? niceDate(r.end_date) : 'open'}
                      {r.renewal_due && <div className="text-[11px] font-medium" style={{ color: r.ends_in < 0 ? 'var(--color-danger-strong)' : 'var(--color-warning-strong, #B45309)' }}>{r.ends_in < 0 ? `ended ${-r.ends_in} days ago` : `ends in ${r.ends_in} days`}</div>}</td>
                    <td className={td}><Badge tone={r.status === 'Active' ? 'success' : 'neutral'} size="xs">{r.status}</Badge></td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      {meta?.can?.edit && r.status === 'Active' && <button type="button" className="btn btn-secondary mr-2" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setRenew(r)} data-testid={`renew-${r.id}`}><RefreshCw className="w-3.5 h-3.5" /> Renew</button>}
                      {meta?.can?.edit && <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setForm(r)}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <Empty icon={Users} title="No one deployed here">People placed on a client's contract appear here, with their monthly margin.</Empty>}
        </div>
      )}
      {form && <DeployForm dep={form.id ? form : null} onClose={() => setForm(null)} />}
      {renew && <RenewModal dep={renew} onClose={() => setRenew(null)} />}
    </div>
  );
}
