/*
 * Settings → Placement: the on/off switch, the default terms, and the demo data.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, UserSearch } from 'lucide-react';
import { pl, useAsync, placementSettingsChanged, placementChanged } from './pl';
import { Field, Err, Loading, LoadError, toast } from './ui';

export default function SettingsPlacement() {
  const { data, error, reload } = useAsync(() => pl.get('/settings'), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const cur = f || (data && { enabled: !!data.enabled, fee_percent: data.fee_percent, guarantee_days: data.guarantee_days, gst_percent: data.gst_percent, working_days: data.working_days, cold_days: data.cold_days });
  const on = (k) => (e) => setF({ ...cur, [k]: e.target.value });
  const save = async (patch) => {
    setBusy('save'); setErr('');
    try { await pl.put('/settings', patch || cur); toast('Saved'); setF(null); placementSettingsChanged(); reload(); }
    catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const demo = async (what) => {
    if (what === 'clear' && !window.confirm('Remove all demo data? Real clients, jobs and candidates are not touched.')) return;
    setBusy(what); setErr('');
    try {
      const r = await pl.post(`/demo/${what}`);
      toast(what === 'load' ? 'Demo data loaded' : 'Demo data removed'); placementChanged(); placementSettingsChanged(); reload();
      if (r && r.message) toast(r.message);
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  return (
    <div className="max-w-3xl mx-auto" data-testid="settings-placement">
      <Link to="/settings" className="inline-flex items-center gap-1.5 text-sm mb-3" style={{ color: 'var(--color-muted)' }}><ArrowLeft className="w-4 h-4" /> Settings</Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}><UserSearch className="w-5 h-5" /></span>
        <div><h1 className="text-xl font-bold text-ink">Placement desk</h1><p className="t-meta">Recruitment: openings, candidates, interviews, offers and billing.</p></div>
      </div>
      <LoadError error={error} onRetry={reload} />
      {!cur ? <Loading /> : (
        <div className="space-y-4">
          <Err>{err}</Err>
          <section className="card p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={!!cur.enabled} onChange={(e) => setF({ ...cur, enabled: e.target.checked })} data-testid="pl-enabled" />
              <span><span className="block text-sm font-semibold text-ink">Switch the Placement desk on</span><span className="block t-meta">When it is off, only administrators see it. Other people do not see the menu.</span></span>
            </label>
          </section>
          <section className="card p-4">
            <h2 className="t-section mb-3">Default terms</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="Fee %" hint="of yearly CTC"><input className="input" type="number" step="0.01" value={cur.fee_percent} onChange={on('fee_percent')} data-testid="pl-fee" /></Field>
              <Field label="Guarantee (days)"><input className="input" type="number" value={cur.guarantee_days} onChange={on('guarantee_days')} /></Field>
              <Field label="GST %"><input className="input" type="number" value={cur.gst_percent} onChange={on('gst_percent')} /></Field>
              <Field label="Working days in a month" hint="for contract billing"><input className="input" type="number" value={cur.working_days} onChange={on('working_days')} /></Field>
              <Field label="Opening is cold after (days)" hint="no submission for this long"><input className="input" type="number" value={cur.cold_days} onChange={on('cold_days')} /></Field>
            </div>
            <div className="mt-4 flex justify-end"><button type="button" className="btn btn-primary" disabled={!!busy || !f} onClick={() => save()} data-testid="pl-save">{busy === 'save' ? 'Saving…' : 'Save'}</button></div>
          </section>
          <section className="card p-4">
            <h2 className="t-section mb-1">Demo data</h2>
            <p className="t-meta mb-3">Fills the desk with sample clients, openings, candidates, interviews, offers and invoices, so you can show how it works. It is marked, so it can be removed in one click.</p>
            <p className="text-sm text-ink mb-3">{data.counts.jobs} openings · {data.counts.candidates} candidates ({data.counts.demo} are demo)</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn btn-primary" disabled={!!busy || data.counts.demo > 0} onClick={() => demo('load')} data-testid="pl-demo-load">{busy === 'load' ? 'Loading…' : 'Load demo data'}</button>
              <button type="button" className="btn btn-danger" disabled={!!busy || data.counts.demo === 0} onClick={() => demo('clear')} data-testid="pl-demo-clear">{busy === 'clear' ? 'Removing…' : 'Remove demo data'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
