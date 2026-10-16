/*
 * The one "Edit record" popup.
 *
 * WHY THIS EXISTS
 * Editing worked three different ways depending on where you were:
 *   - a lead had an "Edit" link on ONE card that opened five inline inputs;
 *     Additional Details and Personal Information could not be edited at all;
 *   - accounts, contacts, deals and the rest swapped the whole Overview tab
 *     for a flat, ungrouped grid of inputs;
 *   - list views either had no edit at all (Leads, Payments) or a pencil that
 *     navigated away to the detail page to open that inline grid.
 *
 * Every one of those now opens this. All of a record's editable fields, in
 * the same sections the detail page shows them in, in a popup over whatever
 * you were looking at — so editing an account from its list doesn't lose
 * your place in the list.
 *
 * WHO SEES IT
 * Callers only render the Edit button when the role has `edit` on that module
 * (Settings → Roles & Permissions). The server enforces the same permission on
 * the save, so hiding the button is a courtesy, not the security boundary.
 *
 * Three exports:
 *   EditRecordModal          the popup itself — sections in, values out
 *   UniversalRecordEditModal loads a metadata-driven module's fields, layout
 *                            and record, and saves it (accounts, contacts,
 *                            deals, tickets, payments, custom modules…)
 *   groupFields              the default "which card does this field go in"
 *                            rule, shared with the detail page so the two
 *                            always group the same way
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Pencil, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { geoSeed } from './geo/GeoField';
import { api } from '../api';
import { FieldInput, getFieldValue, recordTitle } from '../pages/universal/fieldUtils';
import { EmailsField, extraEmailProblem, cleanExtras } from './EmailsField';
import { accentFor } from '../theme/moduleAccents';
import { friendlyError } from './ui';
import { checkFormat, kindOfType } from '../formChecks';

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------
// When a module has no layout configured, fields are grouped by what they
// are. Kept identical to the detail page's grouping (it imports this) so a
// field is never in "Contact" on the page and "Details" in the popup.
const FIELD_GROUPS = [
  // Checked first: "sla_state" would otherwise match Address on "state".
  { title: 'Service Level', match: /^sla_|_due_at$|^first_response|^resolution_(time|minutes)|^csat/i },
  { title: 'Contact', match: /email|phone|mobile|website|fax/i },
  { title: 'Address', match: /address|city|state|country|postal|zip|street/i },
  { title: 'Commercial', match: /amount|value|revenue|price|total|currency|discount|tax|payment|billing/i },
  { title: 'Ownership', match: /owner|assigned|team|created_by|source/i },
  { title: 'Dates', match: /date|_at$|expiry|renewal|valid/i },
];

export function groupFields(fieldList, primaryTitle = 'Details') {
  const groups = new Map();
  const primary = [];
  fieldList.forEach((f) => {
    const g = FIELD_GROUPS.find((x) => x.match.test(f.api_name));
    if (!g) { primary.push(f); return; }
    if (!groups.has(g.title)) groups.set(g.title, []);
    groups.get(g.title).push(f);
  });
  const out = [];
  if (primary.length) out.push({ title: primaryTitle, fields: primary });
  FIELD_GROUPS.forEach((g) => {
    if (groups.has(g.title)) out.push({ title: g.title, fields: groups.get(g.title) });
  });
  return out;
}

// Long-text fields take the full row; everything else sits two to a row.
const WIDE_TYPES = new Set(['textarea', 'rich_text', 'multiselect']);
const isWide = (f) => WIDE_TYPES.has(f.field_type) || f.wide;

// "Changed" means changed in a way a person would notice. A field that was
// null and is now '' has not been edited; a number typed back as a string
// has not either.
const norm = (v) => {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? '1' : '';
  return String(v);
};

// ---------------------------------------------------------------------------
// The popup
// ---------------------------------------------------------------------------
export function EditRecordModal({
  title, recordName, accent = 'var(--color-brand)',
  sections, initial, loading = false, loadError = '',
  focusSection, onSubmit, onClose,
  // (v1.8) the same popup also CREATES a record (the "+ Add" of a list or of a
  // sub-panel): mode 'create' changes the icon, the button and the footer;
  // `extra` is more form (line items, a photo…) shown after the fields;
  // `beforeSubmit(values)` may return a message to stop the save.
  mode = 'edit', submitLabel, extra = null, extraAfter = null, beforeSubmit = null,
  // (v1.8) more than one email address: `initialExtras` is the record's extra
  // addresses (null = this module has no email field, or they are still loading)
  initialExtras = null,
}) {
  const creating = mode === 'create';
  const [values, setValues] = useState(initial || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState([]);
  const [shapeErrors, setShapeErrors] = useState({});
  const [active, setActive] = useState(0);
  const [extras, setExtras] = useState(initialExtras || []);
  const extrasSeeded = useRef(Boolean(initialExtras));
  useEffect(() => {
    if (initialExtras && !extrasSeeded.current) { extrasSeeded.current = true; setExtras(initialExtras); }
  }, [initialExtras]);
  const body = useRef(null);
  const sectionRefs = useRef([]);
  // While the popup is scrolling itself (to a section someone chose), the
  // scroll handler must not second-guess which tab is active.
  const jumping = useRef(0);

  // Values arrive after the popup opens when it loads its own record. Seeded
  // ONCE: if the caller re-renders and hands over an equal-but-new object,
  // re-seeding would wipe out everything typed so far.
  const seeded = useRef(Boolean(initial));
  useEffect(() => {
    if (initial && !seeded.current) { seeded.current = true; setValues(initial); }
  }, [initial]);

  const allFields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
  const changed = useMemo(
    () => allFields.filter((f) => norm(values[f.api_name]) !== norm(initial?.[f.api_name])).map((f) => f.api_name),
    [allFields, values, initial],
  );
  // the field that gets the "+" for more addresses: the module's first email field
  const emailField = useMemo(() => allFields.find((f) => f.api_name === 'email' && f.field_type === 'email') || allFields.find((f) => f.field_type === 'email') || null, [allFields]);
  const extrasKey = (l) => JSON.stringify(cleanExtras(l));
  const extrasChanged = !!emailField && extrasKey(extras) !== extrasKey(initialExtras || []);
  const dirty = changed.length > 0 || extrasChanged;

  // Closing a popup with edits in it asks first. Losing ten fields of typing
  // to a stray click on the backdrop is the classic way this kind of form
  // makes people distrust it.
  const requestClose = () => {
    // eslint-disable-next-line no-alert
    if (dirty && !saving && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e) => {
      // A picker open inside the popup handles its own Escape first and marks
      // the event handled — that must close the picker, not the popup.
      if (e.key === 'Escape' && !e.defaultPrevented) requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Opened from one card's pencil: scroll to that card's section. It is the
  // same full popup either way — the pencil just saves a scroll.
  useEffect(() => {
    if (loading || !focusSection) return;
    const i = sections.findIndex((s) => s.key === focusSection || s.title === focusSection);
    if (i > 0 && sectionRefs.current[i] && body.current) {
      jumping.current = Date.now();
      body.current.scrollTop = sectionRefs.current[i].offsetTop - 8;
      setActive(i);
    }
  }, [loading, focusSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight the section tab for whichever section is at the top of the
  // scroll area.
  const onScroll = () => {
    if (Date.now() - jumping.current < 700) return;
    const top = body.current.scrollTop + 24;
    let idx = 0;
    sectionRefs.current.forEach((el, i) => { if (el && el.offsetTop <= top) idx = i; });
    if (body.current.scrollTop + body.current.clientHeight >= body.current.scrollHeight - 4) idx = sections.length - 1;
    setActive(idx);
  };
  const jumpTo = (i) => {
    const el = sectionRefs.current[i];
    jumping.current = Date.now();
    if (el && body.current) body.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    setActive(i);
  };

  const set = (k, v) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    if (missing.includes(k)) setMissing((m) => m.filter((x) => x !== k));
    setShapeErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  };

  const submit = async (e) => {
    e.preventDefault();
    const blank = allFields.filter((f) => f.required && norm(values[f.api_name]) === '').map((f) => f.api_name);
    // (v1.7) a typed value must have the right shape (phone, email, link, number)
    const shape = {};
    allFields.forEach((f) => { if (blank.includes(f.api_name)) return; const m = checkFormat(kindOfType(f.field_type), values[f.api_name]); if (m) shape[f.api_name] = m; });
    setShapeErrors(shape);
    if (Object.keys(shape).length && !blank.length) {
      const first = Object.keys(shape)[0];
      setError('Please correct the fields marked in red.');
      const i = sections.findIndex((s2) => s2.fields.some((f) => f.api_name === first));
      if (i >= 0) jumpTo(i);
      return;
    }
    if (blank.length) {
      setMissing(blank);
      setError(`Fill in the required field${blank.length === 1 ? '' : 's'} marked in red.`);
      // Take them to the first one rather than leaving them to hunt for it.
      const i = sections.findIndex((s) => s.fields.some((f) => f.api_name === blank[0]));
      if (i >= 0) jumpTo(i);
      return;
    }
    if (!creating && !dirty) { onClose(); return; }
    if (emailField) {
      const bad = extraEmailProblem(extras, values[emailField.api_name]);
      if (bad) { setError(bad); const i = sections.findIndex((s2) => s2.fields.some((f) => f.api_name === emailField.api_name)); if (i >= 0) jumpTo(i); return; }
    }
    if (beforeSubmit) { const msg = beforeSubmit(values); if (msg) { setError(msg); return; } }
    setSaving(true); setError('');
    try {
      await onSubmit(values, changed, emailField ? { extras: cleanExtras(extras), changed: extrasChanged, primary: values[emailField.api_name] } : null);
    } catch (err) {
      if (!err.cancelled) setError(friendlyError(err, creating ? 'Could not create the record.' : 'Could not save your changes.').message || 'Could not save your changes.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4"
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={requestClose} />
      <form onSubmit={submit} noValidate
        className="relative bg-white w-full sm:max-w-3xl max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-line">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm"
              style={{ background: accent }}>
              {creating ? <Plus className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold leading-tight" style={{ color: 'var(--color-ink)' }}>{title}</h2>
              {recordName && (
                <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>{recordName}</p>
              )}
            </div>
            <button type="button" onClick={requestClose} aria-label="Close"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--color-canvas)] shrink-0">
              <X className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
            </button>
          </div>

          {/* Section tabs — a map of the form, and a way to jump in it. Only
              worth the space when there is more than a screenful. */}
          {!loading && sections.length > 2 && (
            <div className="flex gap-1 mt-3 -mb-1 overflow-x-auto thin-scroll">
              {sections.map((s, i) => (
                <button key={s.key || s.title} type="button" onClick={() => jumpTo(i)}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors"
                  style={active === i
                    ? { background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }
                    : { color: 'var(--color-muted)' }}>
                  {s.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div ref={body} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 py-4 relative">
          {loading ? (
            <div className="py-16 flex items-center justify-center gap-2 text-[13px]" style={{ color: 'var(--color-muted)' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--color-danger)' }}>{loadError}</div>
          ) : allFields.length === 0 ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--color-muted)' }}>
              {creating ? 'No fields are set up for creating this record. An admin can change that in Settings → Modules.' : 'No fields on this record are set up as editable. An admin can change that in Settings → Modules.'}
            </div>
          ) : (
            <div className="space-y-5">
              {sections.map((s, si) => (
                <section key={s.key || s.title} ref={(el) => { sectionRefs.current[si] = el; }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-1 h-4 rounded-full shrink-0" style={{ background: accent }} />
                    <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {s.title}
                    </h3>
                    <span className="flex-1 h-px" style={{ background: 'var(--color-line)' }} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                    {s.fields.map((f) => {
                      const bad = missing.includes(f.api_name);
                      return (
                        <div key={f.api_name} className={isWide(f) ? 'sm:col-span-2 min-w-0' : 'min-w-0'}
                          data-field={f.api_name}>
                          <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--color-ink)' }}>
                            {f.label}
                            {f.required ? <span style={{ color: 'var(--color-danger)' }}> *</span> : null}
                          </label>
                          <div className={bad ? 'rounded-lg ring-2 ring-[var(--color-danger)]' : ''}>
                            {emailField && f.api_name === emailField.api_name
                              ? <EmailsField field={f} value={values[f.api_name]} onChange={(v) => set(f.api_name, v)} extras={extras} onExtras={setExtras} inputClass="input w-full" />
                              : <FieldInput field={f} value={values[f.api_name]} onChange={(v) => set(f.api_name, v)} values={values} onSet={set} />}
                          </div>
                          {f.help_text && !bad && (
                            <p className="text-[11px] mt-1" style={{ color: 'var(--color-faint)' }}>{f.help_text}</p>
                          )}
                          {bad && (
                            <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{f.label} is required.</p>
                          )}
                          {!bad && shapeErrors[f.api_name] && (
                            <p className="text-[11px] mt-1" role="alert" data-testid={`err-${f.api_name}`} style={{ color: 'var(--color-danger)' }}>{shapeErrors[f.api_name]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {extra && extraAfter === si && <div className="mt-4">{extra}</div>}
                </section>
              ))}
              {extra && extraAfter === null && extra}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-line flex items-center gap-3"
          style={{ background: 'var(--color-canvas)' }}>
          <div className="flex-1 min-w-0 text-[12px]">
            {error ? (
              <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-danger)' }}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
              </span>
            ) : creating ? (
              <span style={{ color: 'var(--color-faint)' }}><span style={{ color: 'var(--color-danger)' }}>*</span> required</span>
            ) : dirty ? (
              <span style={{ color: 'var(--color-muted)' }}>
                {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span style={{ color: 'var(--color-faint)' }}>No changes yet</span>
            )}
          </div>
          <button type="button" onClick={requestClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || loading || !!loadError || (!creating && !dirty)}
            className="btn btn-primary disabled:opacity-50" data-testid="record-modal-save">
            {saving ? 'Saving…' : (submitLabel || (creating ? 'Create' : 'Save changes'))}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata-driven modules
// ---------------------------------------------------------------------------
// Pass whatever the caller already has (module, fields, record, layout) and
// the rest is fetched. A list page has the module and fields but only a list
// row; a detail page has everything.
export function UniversalRecordEditModal({
  moduleApiName, recordId, module: moduleIn, fields: fieldsIn, record: recordIn, layout: layoutIn,
  // { api_name: ['A', 'B'] } — options for a dropdown whose list was never
  // configured in Settings (Payments' status ships that way). Only fills an
  // EMPTY list; a list an admin has set up always wins.
  fallbackOptions,
  focusSection, onClose, onSaved,
}) {
  const [module, setModule] = useState(moduleIn || null);
  const [fields, setFields] = useState(fieldsIn || null);
  const [record, setRecord] = useState(recordIn || null);
  const [layout, setLayout] = useState(layoutIn === undefined ? null : layoutIn);
  const [loadError, setLoadError] = useState('');
  const [recExtras, setRecExtras] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = moduleIn || await api.getModuleMeta(moduleApiName);
        const [f, rec] = await Promise.all([
          fieldsIn || api.listModuleFields(mod.id),
          // Always the full record: a list row may be a trimmed projection.
          recordIn || api.universalGet(mod, recordId),
        ]);
        // Custom fields on a standard module live in a separate store.
        const hasCustom = mod.table_name && f.some((x) => !x.is_system && x.show_in_edit);
        const custom = hasCustom && !recordIn
          ? await api.getCustomFieldValues(mod.api_name, recordId).catch(() => ({}))
          : {};
        const lay = layoutIn !== undefined
          ? layoutIn
          : await api.getModuleLayout(mod.id, 'detail').then((r) => r.layout_json || { sections: [] }).catch(() => ({ sections: [] }));
        if (cancelled) return;
        const ex = await api.recordEmails(mod.api_name, recordId).catch(() => []);
        if (cancelled) return;
        setRecExtras(Array.isArray(ex) ? ex : []);
        setModule(mod); setFields(f); setRecord({ ...rec, ...custom }); setLayout(lay);
      } catch (e) {
        if (!cancelled) setLoadError(friendlyError(e, 'Could not load this record.').message);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleApiName, recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  const editFields = useMemo(() => (fields || []).filter((f) => f.show_in_edit).map((f) => {
    const fb = fallbackOptions?.[f.api_name];
    if (!fb) return f;
    let has = [];
    try { has = JSON.parse(f.options_json || '[]'); } catch { /* treat as empty */ }
    return has.length ? f : { ...f, options_json: JSON.stringify(fb.map((v) => ({ value: v, label: v }))) };
  }), [fields, fallbackOptions]);

  // Sections follow the detail page: the admin's layout if one is saved, the
  // default grouping otherwise. A field that is editable but not placed in
  // the layout still gets a home, rather than being silently uneditable.
  const sections = useMemo(() => {
    if (!editFields.length) return [];
    const byName = new Map(editFields.map((f) => [f.api_name, f]));
    const placed = new Set();
    const out = [];
    (layout?.sections || []).forEach((s, i) => {
      const fs = (s.fields || []).flat().map((n) => byName.get(n)).filter(Boolean);
      fs.forEach((f) => placed.add(f.api_name));
      if (fs.length) out.push({ key: `layout-${i}`, title: s.title || 'Details', fields: fs });
    });
    const rest = editFields.filter((f) => !placed.has(f.api_name));
    if (rest.length) {
      groupFields(rest, out.length ? 'Other details' : 'Details')
        .forEach((g) => out.push({ key: g.title, title: g.title, fields: g.fields }));
    }
    return out;
  }, [editFields, layout]);

  const initial = useMemo(() => {
    if (!record) return null;
    const v = {};
    editFields.forEach((f) => { v[f.api_name] = getFieldValue(record, f); });
    return v;
  }, [record, editFields]);

  const loading = !loadError && (!module || !fields || !record || layout === null);

  const save = async (values, _changed, em) => {
    // System fields (real columns) go through the module's own update route;
    // custom fields on a table-backed module go through the custom-field
    // store. A custom (JSON) module has no system columns, so it is one call.
    const systemPayload = {};
    const customPayload = {};
    editFields.forEach((f) => {
      if (module.table_name && !f.is_system) customPayload[f.api_name] = values[f.api_name];
      else systemPayload[f.api_name] = values[f.api_name];
    });
    const calls = [];
    if (Object.keys(systemPayload).length) calls.push(api.universalUpdate(module, recordId, systemPayload));
    if (Object.keys(customPayload).length) calls.push(api.saveCustomFieldValues(module.api_name, recordId, customPayload));
    await Promise.all(calls);
    // (v1.8) the extra email addresses — after the record, so they are checked against its main address
    if (em && em.changed) await api.saveRecordEmails(module.api_name, recordId, em.extras, em.primary);
    onSaved?.();
  };

  const accent = module ? accentFor(module.api_name).solid : undefined;

  return (
    <EditRecordModal
      title={module ? `Edit ${module.singular_label}` : 'Edit record'}
      recordName={record && fields ? recordTitle(record, fields) : ''}
      accent={accent}
      sections={sections}
      initial={initial}
      initialExtras={recExtras}
      loading={loading}
      loadError={loadError}
      focusSection={focusSection}
      onSubmit={save}
      onClose={onClose} />
  );
}

// ---------------------------------------------------------------------------
// Creating a record — the same popup, the same sections
// ---------------------------------------------------------------------------
// What a record starts with: each field's configured default (and the geography
// seed). Used by every "+ Add" so a new record starts the same way everywhere.
export function createDefaults(fields) {
  const out = geoSeed(fields);
  fields.forEach((f) => {
    if (f.default_value === null || f.default_value === undefined || f.default_value === '') return;
    out[f.api_name] = f.field_type === 'checkbox'
      ? ['1', 'true', 'yes'].includes(String(f.default_value).toLowerCase())
      : f.default_value;
  });
  return out;
}
// Fields that only mean something once a record has lived a while: never asked
// for while creating it.
const NOT_WHEN_CREATING = /^(closure_reason|resolution|resolved_at|closed_at|closed_by|first_response_at|sla_.*|csat.*)$/i;
// the fields that are really "attach a file": a plain box would only hold a name
const FILE_NAMED = /^attachments?$/i;

export function createSections(fields, layout) {
  const usable = fields.filter((f) => f.show_in_create && !NOT_WHEN_CREATING.test(f.api_name) && !FILE_NAMED.test(f.api_name));
  const byName = new Map(usable.map((f) => [f.api_name, f]));
  const placed = new Set();
  const out = [];
  (layout?.sections || []).forEach((sec, i) => {
    const fs = (sec.fields || []).flat().map((n) => byName.get(n)).filter(Boolean);
    fs.forEach((f) => placed.add(f.api_name));
    if (fs.length) out.push({ key: `layout-${i}`, title: sec.title || 'Details', fields: fs });
  });
  const rest = usable.filter((f) => !placed.has(f.api_name));
  if (rest.length) groupFields(rest, out.length ? 'Other details' : 'Details').forEach((g) => out.push({ key: g.title, title: g.title, fields: g.fields }));
  // what must be filled in comes first inside each card; the rest keeps its order
  out.forEach((sec) => { sec.fields = [...sec.fields.filter((f) => f.required), ...sec.fields.filter((f) => !f.required)]; });
  // …and the card with the required fields comes first
  out.sort((a, b) => Number(b.fields.some((f) => f.required)) - Number(a.fields.some((f) => f.required)));
  return out;
}

/**
 * "+ Add" for any metadata-driven module: from its list, or from a sub-panel of
 * another record (then `hidden` holds the link fields and `link` fills them in).
 * @param moduleApiName  e.g. 'contacts'
 * @param module / fields  when the caller already has them (saves a fetch)
 * @param hidden  api_names that are set for the person, never shown
 * @param link    values merged into what is saved (the parent record)
 * @param note    one line under the title: "Will be linked to …"
 * @param toBody  (values) => body   last-moment changes to what is sent
 * @param extra   more form (quotation items, a photo…), at the end — or inside the card number `extraAfter` (0 = the first)
 * @param beforeSubmit (values) => message | null
 * @param onCreated (created record, body)
 */
export function UniversalCreateModal({
  moduleApiName, module: moduleIn, fields: fieldsIn, hidden = [], link = {}, note = '', toBody, extra = null, extraAfter = null, beforeSubmit = null, onClose, onCreated,
}) {
  const [module, setModule] = useState(moduleIn || null);
  const [fields, setFields] = useState(fieldsIn || null);
  const [layout, setLayout] = useState(undefined);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = moduleIn || await api.getModuleMeta(moduleApiName);
        const f = fieldsIn || await api.listModuleFields(mod.id);
        const lay = await api.getModuleLayout(mod.id, 'detail').then((r) => r.layout_json || { sections: [] }).catch(() => ({ sections: [] }));
        if (cancelled) return;
        setModule(mod); setFields(f); setLayout(lay);
      } catch (e) {
        if (!cancelled) setLoadError(friendlyError(e, 'Could not load the form.').message);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleApiName]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (fields || []).filter((f) => !hidden.includes(f.api_name)), [fields, hidden.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => (layout === undefined ? [] : createSections(shown, layout)), [shown, layout]);
  const initial = useMemo(() => createDefaults(shown.filter((f) => f.show_in_create)), [shown]);
  const loading = !loadError && (!module || !fields || layout === undefined);

  const save = async (values, _changed, em) => {
    const body = { ...values, ...link };
    const sent = toBody ? toBody(body) : body;
    if (em && em.extras.length) sent._extra_emails = em.extras;
    const created = await api.universalCreate(module, sent);
    onCreated?.(created, body);
  };
  const accent = module ? accentFor(module.api_name).solid : undefined;
  return (
    <EditRecordModal
      mode="create"
      title={module ? `New ${module.singular_label}` : 'New record'}
      recordName={note}
      accent={accent}
      sections={sections}
      initial={initial}
      initialExtras={[]}
      loading={loading}
      loadError={loadError}
      extra={extra}
      extraAfter={extraAfter}
      beforeSubmit={beforeSubmit}
      onSubmit={save}
      onClose={onClose} />
  );
}

export default UniversalRecordEditModal;
