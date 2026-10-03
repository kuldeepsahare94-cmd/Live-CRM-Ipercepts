import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, History, Download, Upload, FileText, GitMerge } from 'lucide-react';
import { api } from '../api';
import { usePermissions } from '../context/usePermissions';
import { PageHeader } from '../components/ui';

const inputClass = 'border border-line rounded-lg px-3 py-1.5 text-sm';

function ImportExportSection({ modules }) {
  const [selected, setSelected] = useState('');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // When on, headers the module doesn't have yet become new fields instead
  // of rejecting the file. On by default because that is almost always what
  // someone importing an export from another CRM wants.
  const [autoCreate, setAutoCreate] = useState(true);
  // Duplicate check. What this module can be compared on (mobile, email,
  // company name) and the starting choice come from its duplicate rule.
  const [dupInfo, setDupInfo] = useState(null);
  const [dup, setDup] = useState({ mobile: true, email: true, name: false, action: 'skip' });

  useEffect(() => {
    setDupInfo(null);
    if (!selected) return undefined;
    let live = true;
    api.importDuplicateOptions(selected).then((info) => {
      if (!live) return;
      setDupInfo(info);
      setDup({
        mobile: info.mobile.length > 0 && info.default_by.mobile !== false,
        email: info.email.length > 0 && info.default_by.email !== false,
        name: !!info.name && !!info.default_by.name,
        action: info.default_action || 'skip',
      });
    }).catch(() => { if (live) setDupInfo({ available: false }); });
    return () => { live = false; };
  }, [selected]);

  const changeDup = (patch) => { setDup((d) => ({ ...d, ...patch })); setResult(null); setError(null); };
  const dupChecked = dupInfo?.available && dup.action !== 'allow' && (dup.mobile || dup.email || dup.name);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result)); setResult(null); setError(null); };
    reader.readAsText(file);
    e.target.value = '';
  };

  const run = async (dryRun) => {
    if (!selected || !csv.trim()) return;
    setBusy(true); setResult(null); setError(null);
    try {
      const r = await api.importCsv(selected, csv, dryRun, autoCreate,
        dupChecked ? { mobile: dup.mobile, email: dup.email, name: dup.name, action: dup.action } : undefined);
      setResult(r);
    } catch (err) {
      // The backend returns structured validation detail (which lines failed,
      // which columns are valid) — show it rather than one opaque message.
      setError(err.data && typeof err.data === 'object' && err.data.error ? err.data : { error: err.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-ink mb-1 flex items-center gap-1.5">
        <Database className="w-4 h-4 text-amber" /> Import &amp; Export
      </h2>
      <p className="text-xs text-slate-400 mb-4">Export any module to CSV, or bulk-import records. Imports are all-or-nothing — if any row fails validation, nothing is written.</p>

      <label className="text-xs text-slate-500 font-medium block mb-1">Module</label>
      <select value={selected} onChange={(e) => { setSelected(e.target.value); setResult(null); setError(null); }} className={inputClass + ' w-full mb-3'}>
        <option value="">Select a module…</option>
        {modules.map((m) => <option key={m.api_name} value={m.api_name}>{m.plural_label}</option>)}
      </select>

      {selected && (
        <>
          <div className="flex gap-2 flex-wrap mb-4">
            <a href={api.exportUrl(selected)} className="text-xs border border-line rounded-lg px-3 py-1.5 hover:bg-canvas inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </a>
            <a href={api.importTemplateUrl(selected)} className="text-xs border border-line rounded-lg px-3 py-1.5 hover:bg-canvas inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Blank template
            </a>
            <label className="text-xs border border-line rounded-lg px-3 py-1.5 hover:bg-canvas cursor-pointer inline-flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> Choose CSV file
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </label>
          </div>

          <label className="text-xs text-slate-500 font-medium block mb-1">CSV content</label>
          <textarea value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); setError(null); }} rows={6}
            placeholder="Paste CSV here, or choose a file above. First row must be column headers."
            className="border border-line rounded-lg px-3 py-2 text-xs w-full font-mono" />

          <label className="flex items-start gap-2 mt-3 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={autoCreate} onChange={(e) => { setAutoCreate(e.target.checked); setResult(null); setError(null); }}
              className="mt-0.5 w-3.5 h-3.5" />
            <span>
              <strong className="text-ink">Create missing fields automatically</strong> — columns this module
              doesn't have yet become new fields, with the type worked out from the data. Headers that mean the
              same as an existing field (e.g. "Email Address" → Email) are matched to it instead of duplicated.
            </span>
          </label>

          {dupInfo?.available && (
            <div className="mt-4 rounded-xl border border-line p-3.5" data-import-duplicates>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <GitMerge className="w-3.5 h-3.5 text-amber" /> Duplicate check
              </div>
              <p className="text-xs text-slate-500 mt-1">
                A row is a duplicate when a record with the same value is already in the CRM, or when it is repeated in
                this file. Mobile numbers are compared on their last 10 digits, so +91, 0, spaces and dashes do not matter.
              </p>

              <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap mt-3 text-xs text-slate-600">
                <span className="font-medium text-ink">Check by</span>
                {dupInfo.mobile.length > 0 && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" className="w-3.5 h-3.5" checked={dup.mobile} disabled={dup.action === 'allow'}
                      onChange={(e) => changeDup({ mobile: e.target.checked })} /> Mobile
                  </label>
                )}
                {dupInfo.email.length > 0 && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" className="w-3.5 h-3.5" checked={dup.email} disabled={dup.action === 'allow'}
                      onChange={(e) => changeDup({ email: e.target.checked })} /> Email
                  </label>
                )}
                {dupInfo.name && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" className="w-3.5 h-3.5" checked={dup.name} disabled={dup.action === 'allow'}
                      onChange={(e) => changeDup({ name: e.target.checked })} /> Company name
                  </label>
                )}
              </div>

              <div className="mt-3 text-xs text-slate-600 space-y-1.5">
                <div className="font-medium text-ink">When a row is a duplicate</div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="dup-action" className="mt-0.5 w-3.5 h-3.5" checked={dup.action === 'skip'} onChange={() => changeDup({ action: 'skip' })} />
                  <span><strong className="text-ink">Do not import it</strong> — the row is left out; the record already there is not touched.</span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="dup-action" className="mt-0.5 w-3.5 h-3.5" checked={dup.action === 'merge'} onChange={() => changeDup({ action: 'merge' })} />
                  <span>
                    <strong className="text-ink">Merge into the existing record</strong> — no new record; its empty fields are filled from the row
                    (nothing is overwritten){selected === 'leads' ? ', and the lead shows that it came in again today.' : '.'}
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="dup-action" className="mt-0.5 w-3.5 h-3.5" checked={dup.action === 'allow'} onChange={() => changeDup({ action: 'allow' })} />
                  <span><strong className="text-ink">Import it anyway</strong> — no check; duplicates are created.</span>
                </label>
              </div>
              <p className="text-[11px] text-slate-400 mt-2.5">
                Tip: press <strong>Validate only</strong> first — it lists the duplicate rows without importing anything.
                {' '}<Link to="/duplicates?tab=rules" className="underline">Duplicate rules</Link>
              </p>
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button onClick={() => run(true)} disabled={busy || !csv.trim()}
              className="border border-line text-sm font-medium px-4 py-2 rounded-lg hover:bg-canvas disabled:opacity-50">
              {busy ? 'Checking…' : 'Validate only'}
            </button>
            <button onClick={() => run(false)} disabled={busy || !csv.trim()}
              className="btn btn-primary disabled:opacity-50">
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>

          {result && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-3 space-y-2">
              <div className="font-medium" data-import-result>
                {result.dry_run
                  ? `Looks good — ${result.would_import} row(s) would be imported.`
                  : `Imported ${result.imported} row(s).`}
              </div>

              {result.duplicates && (
                <div data-import-duplicate-result>
                  {result.duplicates.found === 0 ? (
                    <div>No duplicates found (checked by {[result.duplicates.checked.mobile && 'mobile', result.duplicates.checked.email && 'email', result.duplicates.checked.name && 'company name'].filter(Boolean).join(', ') || 'nothing — the file has no mobile or email column'}).</div>
                  ) : (
                    <>
                      <div className="font-medium text-amber">
                        {result.duplicates.found} duplicate row(s): {result.duplicates.already_in_crm} already in the CRM,
                        {' '}{result.duplicates.repeated_in_file} repeated in this file —
                        {' '}{result.duplicates.action === 'merge'
                          ? (result.dry_run ? 'would be merged into the existing records.' : 'merged into the existing records.')
                          : (result.dry_run ? 'would not be imported.' : 'not imported.')}
                      </div>
                      <div className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-emerald-200 bg-white">
                        <table className="w-full text-[11px] text-slate-600">
                          <thead>
                            <tr className="text-left text-slate-400 border-b border-line">
                              <th className="py-1.5 px-2 font-medium">Row</th>
                              <th className="py-1.5 px-2 font-medium">Same</th>
                              <th className="py-1.5 px-2 font-medium">Value</th>
                              <th className="py-1.5 px-2 font-medium">Same as</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.duplicates.rows.map((d) => (
                              <tr key={d.row} className="border-b border-line/60">
                                <td className="py-1 px-2">{d.row}</td>
                                <td className="py-1 px-2">{d.matched_on.join(' + ')}</td>
                                <td className="py-1 px-2">{d.value}</td>
                                <td className="py-1 px-2">{d.same_as}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {result.duplicates.found > result.duplicates.rows.length && (
                        <div className="opacity-70 mt-1">…and {result.duplicates.found - result.duplicates.rows.length} more.</div>
                      )}
                    </>
                  )}
                </div>
              )}

              {(result.fields_created?.length > 0 || result.create?.length > 0) && (
                <div>
                  <div className="font-medium">
                    {result.dry_run ? 'Fields that would be created:' : 'New fields created:'}
                  </div>
                  <ul className="list-disc list-inside mt-0.5">
                    {(result.fields_created || result.create).map((f) => (
                      <li key={f.api_name || f.column}>
                        {f.label} <span className="opacity-70">({f.field_type})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(result.mapped_to_existing?.length > 0 || result.mapped?.length > 0) && (
                <div>
                  <div className="font-medium">Matched to fields you already have:</div>
                  <ul className="list-disc list-inside mt-0.5">
                    {(result.mapped_to_existing || result.mapped).map((m) => (
                      <li key={m.header}>{m.header} → {m.field || m.column}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.skipped?.length > 0 && (
                <div>
                  <div className="font-medium">Ignored:</div>
                  <ul className="list-disc list-inside mt-0.5">
                    {result.skipped.map((sk, i) => <li key={i}>{sk.header} — {sk.reason}</li>)}
                  </ul>
                </div>
              )}

              {result.display_name_filled_from && (
                <div className="opacity-80">
                  Record names were built from {result.display_name_filled_from.join(' + ')}.
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-warn bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
              <div className="font-medium">{error.error}</div>
              {error.issues && (
                <ul className="list-disc list-inside mt-1.5 space-y-0.5">
                  {error.issues.map((i, idx) => <li key={idx}>{i}</li>)}
                </ul>
              )}
              {error.total_issues > (error.issues?.length || 0) && (
                <div className="mt-1">…and {error.total_issues - error.issues.length} more.</div>
              )}
              {error.allowed_columns && (
                <div className="mt-1.5">Valid columns: {error.allowed_columns.join(', ')}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AuditSection({ modules }) {
  const [rows, setRows] = useState([]);
  const [moduleFilter, setModuleFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.listAudit({ module: moduleFilter || undefined, limit: 200 })
      .then(setRows).catch(() => setRows()).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [moduleFilter]);

  // Dropdown option changes (Settings → Dropdown Options) are configuration,
  // not a record: they are logged against the field, with record 0.
  const OPTION_VERBS = {
    option_added: 'added an option to', option_renamed: 'renamed an option of', option_deactivated: 'deactivated an option of',
    option_activated: 'reactivated an option of', option_deleted: 'deleted an option of', options_reordered: 'reordered the options of',
  };
  const fieldName = (r) => (String(r.field_api_name || '').startsWith('list:')
    ? `the ${String(r.field_api_name).slice(5).replace(/_/g, ' ')} list`
    : `${r.singular_label} › ${String(r.field_api_name || '').replace(/_/g, ' ')}`);
  const describe = (r) => {
    if (OPTION_VERBS[r.action]) return `${OPTION_VERBS[r.action]} ${fieldName(r)}`;
    if (r.action === 'created') return `created ${r.singular_label} #${r.record_id}`;
    if (r.action === 'deleted') return `deleted ${r.singular_label} #${r.record_id}`;
    if (r.action === 'field_changed') {
      return `changed ${r.field_api_name} on ${r.singular_label} #${r.record_id}`;
    }
    return `${r.action} ${r.singular_label} #${r.record_id}`;
  };

  return (
    <div className="card p-5 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
          <History className="w-4 h-4 text-amber" /> Audit Log
        </h2>
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className={inputClass}>
          <option value="">All modules</option>
          {modules.map((m) => <option key={m.api_name} value={m.api_name}>{m.plural_label}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-400 mb-4">Who changed what, most recent first. Showing the latest 200 entries.</p>

      {loading && <p className="text-xs text-slate-400">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-xs text-slate-400">No activity recorded yet.</p>}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-line">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Who</th>
                <th className="py-2 pr-3 font-medium">What</th>
                <th className="py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{r.created_at}</td>
                  <td className="py-2 pr-3 text-slate-600">{r.full_name || r.username || '—'}</td>
                  <td className="py-2 pr-3 text-ink">{describe(r)}</td>
                  <td className="py-2 text-slate-500">
                    {r.action === 'field_changed' || r.action === 'option_renamed' || r.action === 'options_reordered'
                      ? <span><span className="line-through opacity-60">{r.old_value || '(empty)'}</span> → {r.new_value || '(empty)'}</span>
                      : OPTION_VERBS[r.action]
                        ? <span>{r.new_value || r.old_value || '—'}</span>
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SettingsData() {
  const can = usePermissions();
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listModulesMeta()
      // Import/export and audit only make sense for modules backed by a real
      // table — custom JSON-backed modules store everything in one blob.
      .then((m) => setModules(m.filter((x) => x.table_name)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 t-meta">Loading…</div>;

  return (
    <div className="max-w-[1600px] mx-auto">
      <PageHeader
        title="Data & Audit"
        subtitle="Bulk import/export, and a record of who changed what."
        icon={Database}
        accent="documents"
      />
{can('settings', 'edit') && <ImportExportSection modules={modules} />}
      {can('settings', 'view') && <AuditSection modules={modules} />}
    </div>
  );
}
