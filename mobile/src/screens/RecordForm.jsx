/*
 * Add or change a record. The form is made from THIS company's fields (the
 * ones its administrator shows on "create" / "edit"), so every company gets
 * its own form without a new app.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, ChevronRight } from 'lucide-react';
import { useApp } from '../lib/app';
import { getRecord, saveRecord, titleOf, EDITABLE } from '../lib/records';
import { TopBar, Loading, Empty, Field, RecordPicker, Sheet, StatusBars, VoiceArea } from '../components/ui';
import GeoPick from '../components/GeoPick';
import { get, set } from '../lib/store';
import { linkCall } from '../lib/calls';
import { geoKind, addressKind } from '../lib/geo';
import AddressPick from '../components/AddressPick';
import MeetingInvite, { useOnlinePlatforms, inviteOf } from '../components/MeetingInvite';
import { PATCH } from '../lib/api';
import { EmailsInput, useExtraEmails, cleanExtras, extraProblem } from '../components/MoreEmails';

const LIST_MODULES = new Set(['leads', 'contacts', 'accounts', 'opportunities', 'quotations', 'subscriptions', 'meetings', 'calls', 'tasks', 'products']);
const LINKS = {
  contacts: [['account_id', 'Customer']],
  opportunities: [['account_id', 'Customer'], ['primary_contact_id', 'Contact']],
  subscriptions: [['account_id', 'Customer']],
  quotations: [['account_id', 'Customer'], ['contact_id', 'Contact'], ['opportunity_id', 'Deal']],
};
const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'created_by', 'related_module', 'related_record_id',
  // (v1.4) a meeting's invite and online link are chosen in their own box, not typed
  'attendees_json', 'online_platform', 'online_provider', 'online_meeting_id', 'online_dial_in', 'online_status', 'online_error']);

// (v1.7) the same checks as the server: a typo is shown under the field, before the Save
const PHONE_OK = /^[0-9+\-() ]+$/;
export function checkField(f, raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '' || v === null || v === undefined) return '';
  if (f.type === 'phone') {
    const digits = String(v).replace(/\D/g, '');
    if (!PHONE_OK.test(String(v)) || digits.length < 7 || digits.length > 15) return 'Enter a valid number (7 to 15 digits, e.g. 98765 43210).';
  }
  if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v))) return 'Enter a valid email, like name@company.com.';
  if (f.type === 'url' && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(String(v)) && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(String(v))) return 'Enter a web address like https://example.com';
  if (['number', 'decimal', 'currency', 'percent'].includes(f.type) && Number.isNaN(Number(v))) return 'Enter a number.';
  return '';
}
// a NEW lead opens as a short form: the few fields a salesperson types on the spot; the rest is under "More details"
const LEAD_QUICK = new Set(['student_name', 'mobile', 'account_name', 'email', 'source', 'country', 'state', 'city', 'status', 'assigned_counselor']);

function nextHour() {
  const t = new Date(Date.now() + 3600000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}:00`;
}
const forInput = (f, v) => {
  if (v === null || v === undefined) return f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : '';
  if (f.type === 'date') return String(v).slice(0, 10);
  if (f.type === 'datetime') return String(v).replace(' ', 'T').slice(0, 16);
  if (f.type === 'checkbox') return !!Number(v);
  if (f.type === 'multiselect') { if (Array.isArray(v)) return v; try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return String(v).split(',').filter(Boolean); } }
  return String(v);
};

function Input({ f, value, onChange, names, onPick, values, onSet, isNew }) {
  const common = { className: 'input', 'data-testid': `f-${f.api_name}` };
  // Country → State → City: linked lists (India by default)
  const addr = values ? addressKind(f) : null;
  if (addr) return <AddressPick value={value} onChange={onChange} values={values} onSet={onSet} prefix={addr.prefix} testid={`f-${f.api_name}`} />;
  const geo = values ? geoKind(f) : null;
  if (geo) return <GeoPick kind={geo.kind} prefix={geo.prefix} value={value} onChange={onChange} values={values} onSet={onSet} isNew={isNew} testid={`f-${f.api_name}`} />;
  switch (f.type) {
    case 'textarea': case 'rich_text': case 'address':
      return <VoiceArea value={value} placeholder={f.placeholder} onChange={onChange} testid={`f-${f.api_name}`} />;
    case 'number': case 'decimal': case 'currency': case 'percent':
      return <input {...common} type="number" inputMode="decimal" step="any" value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'date': return <input {...common} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime': return <input {...common} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'time': return <input {...common} type="time" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'email': return <input {...common} type="email" inputMode="email" autoCapitalize="none" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'phone': return <input {...common} type="tel" inputMode="tel" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'url': return <input {...common} type="url" inputMode="url" autoCapitalize="none" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox': return <label className="toggle"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} data-testid={`f-${f.api_name}`} /> {f.label}</label>;
    case 'dropdown': case 'radio':
      return (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'multiselect':
      return (
        <div className="chips" data-testid={`f-${f.api_name}`}>
          {f.options.map((o) => {
            const on = value.includes(o.value);
            return <button key={o.value} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>{o.label}</button>;
          })}
        </div>
      );
    case 'lookup':
      return (
        <button type="button" className="input flex between" onClick={onPick} data-testid={`f-${f.api_name}`} style={{ textAlign: 'left' }}>
          <span className={value ? '' : 'faint'}>{value ? (names[f.api_name] || `#${value}`) : 'Choose…'}</span><ChevronRight size={18} className="faint" />
        </button>
      );
    default:
      return <input {...common} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function RecordForm() {
  const { module, id } = useParams();
  const [params] = useSearchParams();
  const { module: modOf, say, boot } = useApp();
  const nav = useNavigate();
  const mod = modOf(module);
  // (v1.4) a meeting: online (Google Meet / Teams) and who is invited
  const inviting = module === 'meetings' && !!(boot.calendar && boot.calendar.edit && boot.calendar.view);
  const platforms = useOnlinePlatforms(inviting);
  const [invite, setInvite] = useState({ online: '', attendees: [] });
  const invite0 = useRef('');
  const [values, setValues] = useState(null);
  const [names, setNames] = useState({});
  const [picking, setPicking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dup, setDup] = useState(null);
  const [errs, setErrs] = useState({});
  const [allFields, setAllFields] = useState(false);
  const loadedExtras = useExtraEmails(module, id);       // (v1.8) other email addresses (null while loading)
  const [extras, setExtras] = useState(null);
  useEffect(() => { if (loadedExtras && extras === null) setExtras(loadedExtras); }, [loadedExtras]); // eslint-disable-line react-hooks/exhaustive-deps
  const related = params.get('related_module') && params.get('related_record_id') ? { module: params.get('related_module'), id: Number(params.get('related_record_id')) } : null;

  const fields = useMemo(() => {
    if (!mod) return [];
    const shown = mod.fields.filter((f) => EDITABLE.has(f.type) && !HIDDEN.has(f.api_name) && (f.required || (id ? f.edit : f.create)));
    // a lookup to a module the app has no list of cannot be chosen here (the web can)
    return shown.filter((f) => f.type !== 'lookup' || LIST_MODULES.has(f.lookup_module));
  }, [mod, id]);
  // (v1.4) a link given by the page it was opened from (a contact or deal added from a customer's
  // page) that is not on this form: kept and saved all the same
  const presets = useMemo(() => {
    if (!mod || id) return [];
    const shown = new Set(fields.map((f) => f.api_name));
    const known = [...mod.fields.filter((f) => f.type === 'lookup')];
    // the links of the CRM's own tables, also when the company's form does not list them
    for (const [api, label] of LINKS[module] || []) if (!known.some((f) => f.api_name === api)) known.push({ api_name: api, label, type: 'lookup', system: true });
    return known.filter((f) => !shown.has(f.api_name) && params.get(f.api_name) && /^\d+$/.test(params.get(f.api_name)))
      .map((f) => ({ field: f, value: params.get(f.api_name), label: params.get(`${f.api_name}_label`) || '' }));
  }, [mod, id, fields]); // eslint-disable-line react-hooks/exhaustive-deps

  // the form is filled once (a fresh field list from the server later must not wipe what is typed)
  const filled = useRef('');
  useEffect(() => {
    if (!mod || filled.current === `${module}:${id || ''}`) return;
    filled.current = `${module}:${id || ''}`;
    if (id) {
      getRecord(module, id, mod.fields).then(({ row, custom }) => {
        const all = { ...row, ...custom };
        if (module === 'meetings') { const inv = inviteOf(row); setInvite(inv); invite0.current = JSON.stringify(inv); }
        const v = {}; const n = {};
        fields.forEach((f) => {
          v[f.api_name] = forInput(f, all[f.api_name]);
          if (f.type === 'lookup' && all[f.api_name]) { const base = f.api_name.replace(/_id$/, ''); n[f.api_name] = all[`${base}_name`] || ''; }
        });
        setValues(v); setNames(n);
      }).catch((e) => setError(e.message));
    } else {
      const v = {};
      fields.forEach((f) => {
        const pre = params.get(f.api_name);
        v[f.api_name] = forInput(f, pre ?? f.default_value);
        if (f.type === 'datetime' && !v[f.api_name] && /start/.test(f.api_name)) v[f.api_name] = nextHour();
      });
      setValues(v);
    }
  }, [mod, id, fields]); // eslint-disable-line react-hooks/exhaustive-deps

  // (v1.4) opened from a section's ✎: that section comes into view
  const section = params.get('section');
  useEffect(() => {
    if (!values || !section) return;
    const el = [...document.querySelectorAll('.form-sec')].find((x) => x.dataset.section === section);
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }, [!!values, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const slim = module === 'leads' && !id;
  const isQuick = (f) => !slim || allFields || f.required || LEAD_QUICK.has(f.api_name);
  const hidden = slim && !allFields ? fields.filter((f) => !isQuick(f)).length : 0;
  const shownFields = fields.filter(isQuick);
  // the first email field gets the "+" for more addresses
  const mainEmail = (fields.find((f) => f.api_name === 'email' && f.type === 'email') || fields.find((f) => f.type === 'email') || {}).api_name;
  if (!mod) return <div className="screen no-nav"><TopBar title="Not in the app" /><Empty title="Your role cannot open this." /></div>;
  const save = async (duplicate = 'ask') => {
    setError('');
    const bad = {};
    fields.forEach((f) => { const m = checkField(f, values[f.api_name]); if (m) bad[f.api_name] = m; });
    setErrs(bad);
    if (Object.keys(bad).length) {
      const first = fields.find((f) => bad[f.api_name]);
      if (first && slim && !LEAD_QUICK.has(first.api_name)) setAllFields(true);
      setError(`Please correct: ${fields.filter((f) => bad[f.api_name]).map((f) => f.label).join(', ')}`); return;
    }
    const missing = fields.filter((f) => f.required && (values[f.api_name] === '' || values[f.api_name] === null || (Array.isArray(values[f.api_name]) && !values[f.api_name].length)));
    if (missing.length) { setError(`Fill in: ${missing.map((f) => f.label).join(', ')}`); return; }
    const exBad = mainEmail ? extraProblem(extras, values[mainEmail]) : '';
    if (exBad) { setError(exBad); return; }
    setBusy(true);
    try {
      const all = { ...values };
      const extra = related ? [{ api_name: 'related_module', type: 'text', system: true }, { api_name: 'related_record_id', type: 'number', system: true }] : [];
      if (related) { all.related_module = related.module; all.related_record_id = related.id; }
      presets.forEach((p) => { all[p.field.api_name] = p.value; });
      const out = await saveRecord(module, id, all, [...fields, ...extra, ...presets.map((p) => p.field)], { duplicate, extraEmails: mainEmail && extras !== null ? cleanExtras(extras) : null });
      if (out.duplicate) { setDup(out); return; }
      if (out.warning) say(out.warning, 'error'); else say(id ? 'Saved.' : `${mod.singular} added.`, 'ok');
      const newId = (out.row && out.row.id) || id;
      // (v1.4) the meeting's invite and online link: through the calendar, which sends the invites and asks for the link
      if (inviting && newId && JSON.stringify(invite) !== (invite0.current || JSON.stringify({ online: '', attendees: [] }))) {
        try {
          await PATCH(`/calendar/events/${newId}`, { attendees: invite.attendees, online_platform: invite.online || null, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone });
          if (invite.online) say('Saved. The meeting link is being made.', 'ok');
        } catch (e) { say(`The meeting is saved, but ${e.message.charAt(0).toLowerCase()}${e.message.slice(1)}`, 'error'); }
      }
      // a new lead / customer made for a call the CRM did not know (v1.3.1): the call is saved on it
      const ac = !id && params.get('after_call') ? get('after_call') : null;
      if (ac && ac.ref === params.get('after_call') && newId) { linkCall(ac, { module, id: newId, name: titleOf(module, { ...all, ...(out.row || {}) }) }); set('after_call', null); }
      nav(`/m/${module}/${newId}`, { replace: true });
    } catch (e) { setError(e.offline ? 'No internet: this needs the internet. Try again when online.' : e.message); } finally { setBusy(false); }
  };

  return (
    <div className="screen no-nav">
      <TopBar title={id ? `Change ${mod.singular.toLowerCase()}` : `New ${mod.singular.toLowerCase()}`} />
      <StatusBars />
      {!values ? (error ? <div className="body"><div className="note bad">{error}</div></div> : <Loading />) : (
        <form className="body" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="card col" style={{ gap: 14 }}>
            {related && <div className="note info small">For: {params.get('related_name') || `${related.module} #${related.id}`}</div>}
            {presets.map((p) => <div key={p.field.api_name} className="note info small" data-testid="form-preset">{p.field.label}: {p.label || `#${p.value}`}</div>)}
            {!id && params.get('after_call') && <div className="note info small" data-testid="form-after-call">The call is saved on this {mod.singular.toLowerCase()} with its recording.</div>}
            {shownFields.map((f, i) => [
              // (v1.4) the form's sections as small titles; "✎" on a section of the record page opens here
              (i === 0 ? shownFields.length > 6 && f.section : f.section && f.section !== shownFields[i - 1].section) && <div key={`sec-${f.section}`} className="form-sec" data-section={f.section}>{f.section}</div>,
              f.type === 'checkbox'
              ? <Input key={f.api_name} f={f} value={values[f.api_name]} onChange={(v) => setValues((p) => ({ ...p, [f.api_name]: v }))} values={values} onSet={(k, v) => setValues((p) => ({ ...p, [k]: v }))} />
              : (
                <Field key={f.api_name} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help || (f.type === 'phone' ? '10-digit mobile number, e.g. 98765 43210' : '')} error={errs[f.api_name]}>
                  {f.api_name === mainEmail && extras !== null
                    ? <EmailsInput value={values[f.api_name]} testid={`f-${f.api_name}`} extras={extras} onExtras={setExtras}
                        onChange={(v) => { setValues((p) => ({ ...p, [f.api_name]: v })); if (errs[f.api_name]) setErrs((e) => ({ ...e, [f.api_name]: checkField(f, v) })); }} />
                    : <Input f={f} value={values[f.api_name]} names={names} onChange={(v) => { setValues((p) => ({ ...p, [f.api_name]: v })); if (errs[f.api_name]) setErrs((e) => ({ ...e, [f.api_name]: checkField(f, v) })); }} onPick={() => setPicking(f)} values={values} isNew={!id} onSet={(k, v) => setValues((p) => ({ ...p, [k]: v }))} />}
                </Field>
              )])}
            {hidden > 0 && <button type="button" className="btn outline small" onClick={() => setAllFields(true)} data-testid="form-more">More details ({hidden})</button>}
            {!fields.length && <div className="muted">This form has no fields the app can fill in. Use the web.</div>}
          </div>
          {inviting && <MeetingInvite value={invite} onChange={setInvite} platforms={platforms} />}
          {error && <div className="note bad" data-testid="form-error">{error}</div>}
          <button type="submit" className="btn primary block big" disabled={busy} data-testid="form-save">{busy ? <Loader2 className="spin" /> : null} Save</button>
        </form>
      )}
      {picking && (
        <RecordPicker module={picking.lookup_module} title={`Choose ${picking.label.toLowerCase()}`} onClose={() => setPicking(null)}
          onPick={(r) => { setValues({ ...values, [picking.api_name]: String(r.id) }); setNames({ ...names, [picking.api_name]: r.title }); setPicking(null); }} />
      )}
      {dup && (
        <Sheet title="Already in the CRM?" onClose={() => setDup(null)}>
          <div className="col">
            <div className="note warn">{dup.message}</div>
            {(dup.duplicate.matches || []).slice(0, 3).map((x) => (
              x.id ? <button key={x.id} type="button" className="btn outline block" onClick={() => {
                const ac = !id && params.get('after_call') ? get('after_call') : null;
                if (ac && ac.ref === params.get('after_call')) { linkCall(ac, { module, id: x.id, name: x.title || titleOf(module, x) }); set('after_call', null); say('The call is saved on it.', 'ok'); }
                nav(`/m/${module}/${x.id}`, { replace: true });
              }}>Open {x.title || titleOf(module, x)}</button> : null
            ))}
            {dup.duplicate.can_create !== false && <button type="button" className="btn primary block" onClick={() => { setDup(null); save('create'); }} data-testid="dup-create">Add it anyway</button>}
            <button type="button" className="btn ghost block" onClick={() => setDup(null)}>Back to the form</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
