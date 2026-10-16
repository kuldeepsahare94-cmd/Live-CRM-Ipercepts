/*
 * Placement desk — Clients: companies we hire for, with the terms agreed
 * (fee %, payment terms, replacement guarantee, contact person).
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, Plus, Phone, Mail, Briefcase } from 'lucide-react';
import { Badge } from '../../components/ui';
import { pl, useAsync, usePlacementMeta, placementChanged, inrShort } from './pl';
import { Modal, Field, Err, Loading, LoadError, Empty, SearchBox, Seg, toast, th, td, rowStyle } from './ui';
import { jobTone } from './Jobs';

const PAY = ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];
const AGR = [['', 'All'], ['Permanent', 'Permanent'], ['Contract', 'Contract'], ['Both', 'Both']];

function ClientForm({ client, onClose, onSaved }) {
  const meta = usePlacementMeta();
  const st = meta?.settings || {};
  const c = client || {};
  const isNew = !c.id;
  const [pick, setPick] = useState('new');
  const [q, setQ] = useState('');
  const { data: others } = useAsync(() => (isNew ? pl.get('/clients/accounts', { q }) : Promise.resolve([])), [q, isNew]);
  const [f, setF] = useState({
    account_id: '', account_name: c.account_name || '', industry: c.industry || '', city: c.city || '', phone: c.phone || '', email: c.email || '',
    agreement_type: c.agreement_type || 'Permanent', fee_percent: c.fee_percent ?? st.fee_percent ?? 8.33, payment_terms: c.payment_terms || 'Net 30',
    guarantee_days: c.guarantee_days ?? st.guarantee_days ?? 90, spoc_name: c.spoc_name || '', spoc_phone: c.spoc_phone || '', spoc_email: c.spoc_email || '', notes: c.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { ...f };
      if (isNew && pick === 'existing') { if (!f.account_id) throw new Error('Choose the company.'); body.account_name = ''; }
      const r = isNew ? await pl.post('/clients', body) : await pl.put(`/clients/${c.id}`, body);
      toast(isNew ? 'Client added' : 'Client saved'); placementChanged(); onSaved(r.id);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add a client' : 'Edit client'} subtitle={isNew ? 'A company we hire for' : c.account_name} onClose={onClose} busy={busy} wide testid="client-form"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="client-form" className="btn btn-primary" disabled={busy} data-testid="client-save">{busy ? 'Saving…' : 'Save client'}</button></>}>
      <form id="client-form" onSubmit={submit} className="space-y-4">
        <Err>{err}</Err>
        {isNew && (
          <div className="flex items-center gap-3 flex-wrap">
            <Seg label="Company" value={pick} onChange={setPick} options={[['new', 'New company'], ['existing', 'Company already in the CRM']]} />
          </div>
        )}
        {isNew && pick === 'existing' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Search company"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" /></Field>
            <Field label="Company" required><select className="input" value={f.account_id} onChange={on('account_id')} data-testid="client-existing"><option value="">Choose…</option>{(others || []).map((a) => <option key={a.id} value={a.id}>{a.account_name}{a.city ? ` · ${a.city}` : ''}</option>)}</select></Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company name" required className="col-span-2"><input className="input" value={f.account_name} onChange={on('account_name')} data-testid="client-name" /></Field>
            <Field label="Industry"><input className="input" value={f.industry} onChange={on('industry')} /></Field>
            <Field label="City"><input className="input" value={f.city} onChange={on('city')} /></Field>
            {isNew && <><Field label="Phone"><input className="input" value={f.phone} onChange={on('phone')} /></Field><Field label="Email"><input className="input" type="email" value={f.email} onChange={on('email')} /></Field></>}
          </div>
        )}
        <div>
          <div className="t-section mb-2">Terms agreed</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Agreement"><select className="input" value={f.agreement_type} onChange={on('agreement_type')}>{AGR.slice(1).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
            <Field label="Fee %" hint="of yearly CTC"><input className="input" type="number" step="0.01" min="0" max="100" value={f.fee_percent} onChange={on('fee_percent')} /></Field>
            <Field label="Payment terms"><select className="input" value={f.payment_terms} onChange={on('payment_terms')}>{PAY.map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Guarantee (days)"><input className="input" type="number" min="0" max="730" value={f.guarantee_days} onChange={on('guarantee_days')} /></Field>
          </div>
        </div>
        <div>
          <div className="t-section mb-2">Contact person at the client</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name"><input className="input" value={f.spoc_name} onChange={on('spoc_name')} /></Field>
            <Field label="Phone"><input className="input" value={f.spoc_phone} onChange={on('spoc_phone')} /></Field>
            <Field label="Email"><input className="input" type="email" value={f.spoc_email} onChange={on('spoc_email')} /></Field>
          </div>
        </div>
        <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={on('notes')} /></Field>
      </form>
    </Modal>
  );
}

function ClientDetail({ id, onClose, onEdit }) {
  const meta = usePlacementMeta();
  const { data, error } = useAsync(() => pl.get(`/clients/${id}`), [id]);
  return (
    <Modal title={data?.account_name || 'Client'} subtitle={data ? `${data.industry || 'Company'}${data.city ? ` · ${data.city}` : ''}` : ''} onClose={onClose} wide testid="client-detail"
      footer={<>{data && meta?.can?.edit && <button type="button" className="btn btn-secondary" onClick={() => onEdit(data)}>Edit terms</button>}<button type="button" className="btn btn-primary" onClick={onClose}>Close</button></>}>
      <LoadError error={error} />
      {!data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['Agreement', data.agreement_type], ['Fee', data.fee_percent ? `${data.fee_percent}%` : '—'], ['Payment', data.payment_terms || '—'], ['Guarantee', (data.guarantee_days ? `${data.guarantee_days} days` : '—')]].map(([l, v]) => (
              <div key={l} className="rounded-xl p-3" style={{ background: 'var(--color-surface-soft)' }}><div className="t-meta">{l}</div><div className="text-sm font-semibold text-ink">{v}</div></div>
            ))}
          </div>
          <div className="text-sm space-y-1">
            {data.spoc_name && <div className="text-ink font-medium">{data.spoc_name} <span className="t-meta font-normal">· contact person</span></div>}
            {data.spoc_phone && <div className="flex items-center gap-2 t-meta"><Phone className="w-3.5 h-3.5" /> <a href={`tel:${data.spoc_phone}`} className="hover:underline">{data.spoc_phone}</a></div>}
            {data.spoc_email && <div className="flex items-center gap-2 t-meta"><Mail className="w-3.5 h-3.5" /> <a href={`mailto:${data.spoc_email}`} className="hover:underline">{data.spoc_email}</a></div>}
            {data.notes && <p className="t-meta pt-1">{data.notes}</p>}
          </div>
          <div>
            <div className="t-section mb-2">Openings ({data.jobs.length})</div>
            {data.jobs.length === 0 ? <p className="t-meta">No opening yet.</p> : (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-line)' }}>
                {data.jobs.map((j, i) => (
                  <Link key={j.id} to={`/placement/jobs/${j.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50" style={i ? { borderTop: '1px solid var(--color-line-soft)' } : null}>
                    <Briefcase className="w-4 h-4 shrink-0" style={{ color: 'var(--color-faint)' }} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{j.title}<span className="t-meta ml-2">{j.code}</span></span>
                    <span className="t-meta">{j.positions} pos</span>
                    <Badge tone={jobTone(j.status)} size="xs">{j.status}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Clients() {
  const meta = usePlacementMeta();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [agreement, setAgreement] = useState('');
  const { data, error, reload } = useAsync(() => pl.get('/clients', { q, agreement }), [q, agreement]);
  const [form, setForm] = useState(null);
  const open = Number(sp.get('open')) || 0;
  const setOpen = (v) => setSp(v ? { open: String(v) } : {}, { replace: true });
  return (
    <div data-testid="pl-clients">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search client or city" />
        <Seg label="Agreement" value={agreement} onChange={setAgreement} options={AGR} />
        <div className="flex-1" />
        {meta?.can?.create && <button type="button" className="btn btn-primary" onClick={() => setForm({})} data-testid="client-add"><Plus className="w-4 h-4" /> Add client</button>}
      </div>
      <LoadError error={error} onRetry={reload} />
      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="clients-table">
              <thead><tr style={{ background: 'var(--color-surface-soft)', color: 'var(--color-muted)' }}>
                <th className={th}>Client</th><th className={th}>Agreement</th><th className={th}>Fee</th><th className={th}>Open jobs</th><th className={th}>Placed</th><th className={th}>Deployed</th><th className={th}>Fee billed</th><th className={th}>Contact</th>
              </tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} style={rowStyle} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setOpen(c.id)} data-testid={`client-row-${c.id}`}>
                    <td className={td}><div className="font-medium text-ink">{c.account_name}</div><div className="t-meta">{[c.industry, c.city].filter(Boolean).join(' · ')}</div></td>
                    <td className={td}><Badge tone={c.agreement_type === 'Contract' ? 'info' : c.agreement_type === 'Both' ? 'special' : 'neutral'} size="xs">{c.agreement_type}</Badge><div className="t-meta">{c.payment_terms}</div></td>
                    <td className={td}>{c.fee_percent ? `${c.fee_percent}%` : '—'}<div className="t-meta">{c.guarantee_days ? `${c.guarantee_days} d guarantee` : 'no guarantee'}</div></td>
                    <td className={td}><b className="text-ink">{c.open_jobs}</b><div className="t-meta">{c.positions_open} positions</div></td>
                    <td className={td}>{c.placed}</td>
                    <td className={td}>{c.deployed}</td>
                    <td className={td}>{inrShort(c.fee_billed)}</td>
                    <td className={td}><div className="text-ink">{c.spoc_name || '—'}</div><div className="t-meta">{c.spoc_phone || ''}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.length === 0 && <Empty icon={Building2} title="No client yet">Add the companies you hire for. Their terms are used on every opening and invoice.</Empty>}
        </div>
      )}
      {open > 0 && !form && <ClientDetail id={open} onClose={() => setOpen(0)} onEdit={(c) => setForm(c)} />}
      {form && <ClientForm client={form.id ? form : null} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); reload(); if (open) setOpen(open); else if (id) setOpen(id); }} />}
    </div>
  );
}
