/*
 * Settings → Field force (the mobile app for people in the field).
 *
 *   General      switch on; which roles see everyone; how the app connects
 *   Attendance   working hours (late / left early), selfies, a day left open
 *   Tracking     the route between punch in and punch out, and how km are counted
 *   Visits       check-in at customers: selfie, how far is "far", the customer's place
 *   Km expense   the day's km made into an expense at punch out (needs Expenses)
 *   Map          OpenStreetMap, or another map server
 *
 * Who may use it: Roles & Permissions → "Field force" (view = use the app; export = the CSV).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPinned, ArrowLeft, Check, Loader2, Copy } from 'lucide-react';
import { api, absoluteApiBase } from '../api';
import { PageHeader } from '../components/ui';
import { fieldSettingsChanged } from '../components/field/field';

const TABS = [['general', 'General'], ['attendance', 'Attendance'], ['tracking', 'Tracking & km'], ['visits', 'Visits'], ['expense', 'Km expense'], ['map', 'Map']];

function Toggle({ on, onChange, label, testid }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} onClick={() => onChange(!on)} data-testid={testid}
      className="relative w-10 h-6 rounded-full transition-colors shrink-0" style={{ background: on ? 'var(--color-success)' : 'var(--color-line-strong)' }}>
      <span className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: on ? 20 : 4 }} />
    </button>
  );
}
function Row({ title, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 flex-wrap sm:flex-nowrap" style={{ borderBottom: '1px solid var(--color-line-soft)' }}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        {hint && <p className="t-meta mt-0.5 max-w-xl">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Num({ value, onChange, unit, step = 1, min, max, testid, width = 96 }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input type="number" className="input" style={{ width }} value={value} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      {unit && <span className="t-meta">{unit}</span>}
    </span>
  );
}

const NUMBERS = ['interval_seconds', 'distance_filter_m', 'max_accuracy_m', 'max_speed_kmh', 'min_move_m', 'road_factor', 'auto_out_hours', 'visit_radius_m', 'km_expense_min'];

export default function SettingsField() {
  const [payload, setPayload] = useState(null);
  const [f, setF] = useState(null);
  const [tab, setTab] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const take = (p) => {
    setPayload(p);
    const s = p.settings;
    setF({ ...s, ...Object.fromEntries(NUMBERS.map((k) => [k, String(s[k] ?? '')])), km_expense_category_id: s.km_expense_category_id ? String(s.km_expense_category_id) : '' });
  };
  useEffect(() => { api.fieldSettings().then(take).catch((e) => setError(e.message || 'The settings could not be loaded.')); }, []);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setSaved(false); };

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const body = { ...f };
      NUMBERS.forEach((k) => { body[k] = body[k] === '' ? undefined : Number(body[k]); });
      body.km_expense_category_id = f.km_expense_category_id ? Number(f.km_expense_category_id) : null;
      take(await api.saveFieldSettings(body));
      setSaved(true);
      fieldSettingsChanged();
    } catch (e) { setError(e.message || 'The settings could not be saved.'); } finally { setBusy(false); }
  };

  if (!f) {
    return (
      <div>
        <PageHeader title="Field force" icon={MapPinned} accent="meetings" />
        {error ? <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p> : <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-faint)' }} />}
      </div>
    );
  }
  const appAddress = absoluteApiBase().replace(/\/api$/, '');
  const copy = async () => { try { await navigator.clipboard.writeText(appAddress); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the address is on the screen */ } };
  const roles = payload.roles || [];
  const viewers = new Set((f.viewer_role_ids || []).map(Number));

  return (
    <div className="max-w-4xl">
      <Link to="/settings" className="t-meta inline-flex items-center gap-1 mb-3 hover:underline"><ArrowLeft className="w-4 h-4" /> Settings</Link>
      <PageHeader title="Field force" subtitle="Attendance with location, live tracking, km, visits at customers — the mobile app for the field team" icon={MapPinned} accent="meetings">
        <Link to="/field" className="btn btn-secondary">Open Field team</Link>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-testid="field-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save</button>
      </PageHeader>

      {error && <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }} data-testid="field-error">{error}</div>}
      {saved && <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }} data-testid="field-saved">Saved. The app picks the new rules up the next time it opens.</div>}

      <div className="flex items-center gap-1 mb-4 overflow-x-auto thin-scroll" role="tablist" style={{ borderBottom: '1px solid var(--color-line)' }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`ftab-${k}`} className="px-3.5 py-2.5 text-sm font-medium whitespace-nowrap -mb-px"
            style={tab === k ? { color: 'var(--color-brand)', borderBottom: '2px solid var(--color-brand)' } : { color: 'var(--color-muted)', borderBottom: '2px solid transparent' }}>{label}</button>
        ))}
      </div>

      <section className="card px-5 py-1">
        {tab === 'general' && (
          <>
            <Row title="Switch Field force on" hint="Punch in / out, tracking and visits in the mobile app, and the Field team page. Who may use it: Roles & Permissions → Field force.">
              <Toggle on={f.enabled} onChange={(v) => set('enabled', v)} label="Field force on" testid="f-enabled" />
            </Row>
            <Row title="Roles that see everyone" hint="Besides Super Admin. Everyone else sees themselves, and a manager the people who report to them (Users → Reports to).">
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1" data-testid="f-viewers">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={viewers.has(r.id)} onChange={(e) => set('viewer_role_ids', e.target.checked ? [...viewers, r.id] : [...viewers].filter((x) => x !== r.id))} />{r.name}
                  </label>
                ))}
              </div>
            </Row>
            <Row title="The mobile app connects to" hint="People type this address in the app once, then sign in with their CRM user name and password.">
              <span className="inline-flex items-center gap-2">
                <code className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-canvas-alt)' }} data-testid="f-app-address">{appAddress}</code>
                <button type="button" className="btn btn-ghost" style={{ padding: '.3rem .5rem' }} onClick={copy} title="Copy">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
              </span>
            </Row>
          </>
        )}

        {tab === 'attendance' && (
          <>
            <Row title="Work starts at" hint="A punch in later than this is marked late."><input type="time" className="input" style={{ width: 130 }} value={f.work_start} onChange={(e) => set('work_start', e.target.value)} data-testid="f-work-start" /></Row>
            <Row title="Work ends at" hint="A punch out earlier than this is marked “left early”."><input type="time" className="input" style={{ width: 130 }} value={f.work_end} onChange={(e) => set('work_end', e.target.value)} data-testid="f-work-end" /></Row>
            <Row title="Selfie at punch in" hint="The app opens the front camera; the photo is kept with the attendance."><Toggle on={f.selfie_in} onChange={(v) => set('selfie_in', v)} label="Selfie at punch in" testid="f-selfie-in" /></Row>
            <Row title="Selfie at punch out"><Toggle on={f.selfie_out} onChange={(v) => set('selfie_out', v)} label="Selfie at punch out" testid="f-selfie-out" /></Row>
            <Row title="Close a day left open after" hint="Someone forgot to punch out (or the phone died): the day is closed at the last place the phone sent, and marked “no punch out”.">
              <Num value={f.auto_out_hours} onChange={(v) => set('auto_out_hours', v)} unit="hours" min={4} max={24} testid="f-auto-out" />
            </Row>
          </>
        )}

        {tab === 'tracking' && (
          <>
            <Row title="Record the route" hint="Only between punch in and punch out — never outside working time. Off: only the punch and visit places are kept, and km are straight lines between them.">
              <Toggle on={f.track} onChange={(v) => set('track', v)} label="Record the route" testid="f-track" />
            </Row>
            <Row title="Take a point every" hint="Shorter = a more exact route and km, but more battery. 60 seconds is a good balance."><Num value={f.interval_seconds} onChange={(v) => set('interval_seconds', v)} unit="seconds" min={15} max={900} testid="f-interval" /></Row>
            <Row title="…and only after moving" hint="Standing still, the phone sends nothing new (saves battery)."><Num value={f.distance_filter_m} onChange={(v) => set('distance_filter_m', v)} unit="metres" min={0} max={1000} /></Row>
            <Row title="Leave out points less exact than" hint="Indoors GPS can be hundreds of metres off; such points are not counted in km."><Num value={f.max_accuracy_m} onChange={(v) => set('max_accuracy_m', v)} unit="metres" min={10} max={1000} /></Row>
            <Row title="Leave out jumps faster than" hint="A point that would need this speed is a GPS error, not travel."><Num value={f.max_speed_kmh} onChange={(v) => set('max_speed_kmh', v)} unit="km/h" min={20} max={400} /></Row>
            <Row title="Do not count moves smaller than" hint="Standing still, points wander a few metres; that is not travel."><Num value={f.min_move_m} onChange={(v) => set('min_move_m', v)} unit="metres" min={0} max={200} /></Row>
            <Row title="Road factor" hint="Km are measured as straight lines between points. Roads bend: 1.1–1.2 comes close to road km in a city when points are far apart. 1 = no change.">
              <Num value={f.road_factor} onChange={(v) => set('road_factor', v)} step={0.05} min={1} max={1.6} testid="f-road-factor" />
            </Row>
            <p className="t-meta py-3">Points sent from a fake-location app are never counted, and the manager sees a warning.</p>
          </>
        )}

        {tab === 'visits' && (
          <>
            <Row title="Selfie at check-in" hint="At a customer, the app asks for a selfie before the check-in."><Toggle on={f.selfie_visit} onChange={(v) => set('selfie_visit', v)} label="Selfie at check-in" testid="f-selfie-visit" /></Row>
            <Row title="A check-in further than this from the customer is “far”" hint="When the customer's place is known. The manager sees it marked."><Num value={f.visit_radius_m} onChange={(v) => set('visit_radius_m', v)} unit="metres" min={20} max={20000} testid="f-radius" /></Row>
            <Row title="Save the customer's place from the first visit" hint="A lead, contact or account with no place yet gets the place of the first check-in. Used for “nearby” in the app."><Toggle on={f.save_place_on_visit} onChange={(v) => set('save_place_on_visit', v)} label="Save the place" /></Row>
            <Row title="Complete the meeting at check-out" hint="A check-in at a meeting marks it Completed with the notes and outcome of the visit."><Toggle on={f.close_meeting_on_checkout} onChange={(v) => set('close_meeting_on_checkout', v)} label="Complete the meeting" /></Row>
            <Row title="Find a customer's place from the address" hint="With OpenStreetMap's free address search (one address a second). Off: places come from visits or from the app's “the customer is here”.">
              <Toggle on={f.geocode} onChange={(v) => set('geocode', v)} label="Find from the address" testid="f-geocode" />
            </Row>
          </>
        )}

        {tab === 'expense' && (
          <>
            {!payload.expenses_on && <p className="text-sm py-3" style={{ color: 'var(--color-warning-strong)' }}>Expense management is off. Switch it on in <Link to="/settings/expenses" className="underline">Settings → Expenses</Link> first.</p>}
            <Row title="Make the day's km an expense at punch out" hint="The km of the day × the vehicle's rate, added to the person's expenses (not sent yet: they send it with their claim).">
              <Toggle on={f.km_expense} onChange={(v) => set('km_expense', v)} label="Km expense" testid="f-km-expense" />
            </Row>
            <Row title="Expense category" hint="A category of the kind “Own vehicle: km × rate”.">
              <select className="input" style={{ width: 220 }} value={f.km_expense_category_id} onChange={(e) => set('km_expense_category_id', e.target.value)} data-testid="f-km-category">
                <option value="">Choose…</option>
                {payload.km_categories.map((c) => <option key={c.id} value={c.id} disabled={!c.active}>{c.name}{c.active ? '' : ' (off)'}</option>)}
              </select>
            </Row>
            <Row title="Vehicle" hint="Its rate per km comes from Settings → Expenses → Km rates.">
              <select className="input" style={{ width: 220 }} value={f.km_expense_vehicle} onChange={(e) => set('km_expense_vehicle', e.target.value)} data-testid="f-km-vehicle">
                <option value="">Choose…</option>
                {payload.vehicles.map((v) => <option key={v.name} value={v.name} disabled={!v.active}>{v.name} — {v.rate_per_km}/km</option>)}
              </select>
            </Row>
            <Row title="Only when the day has at least" hint="A day of less km makes no expense."><Num value={f.km_expense_min} onChange={(v) => set('km_expense_min', v)} unit="km" step={0.5} min={0} max={1000} /></Row>
          </>
        )}

        {tab === 'map' && (
          <>
            <Row title="Map pictures" hint="Empty = OpenStreetMap (free, fine for a team). For many users or heavy use, take a map service (MapTiler, Mapbox, Stadia…) and paste its tile address with {z}, {x}, {y} and your key.">
              <input className="input" style={{ width: 360 }} value={f.map_tiles_url} placeholder="https://tile.openstreetmap.org/{z}/{x}/{y}.png" onChange={(e) => set('map_tiles_url', e.target.value)} data-testid="f-tiles" />
            </Row>
            <Row title="Credit line" hint="The map service's credit, shown in the corner of the map (most services ask for it).">
              <input className="input" style={{ width: 360 }} value={f.map_attribution} placeholder="© OpenStreetMap contributors" onChange={(e) => set('map_attribution', e.target.value)} />
            </Row>
          </>
        )}
      </section>
    </div>
  );
}
