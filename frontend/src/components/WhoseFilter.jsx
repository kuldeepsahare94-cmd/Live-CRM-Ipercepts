/*
 * "Whose data" on a list (v1.4): a manager or an administrator looks at one
 * person, a team, or a role (a group of people with the same job) — or
 * everyone they can see. The same choices as in the mobile app.
 *
 * Shown only to someone who can see other people's records. The choice is
 * kept per list in this browser.
 *
 *   value: '' (everyone I can see) | 'me' | 'user:5' | 'team:2' | 'role:3'
 */
import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { api } from '../api';
import { USER_TYPES } from '../pages/universal/fieldUtils';

let cached = null;
let asking = null;
function loadOptions() {
  if (cached) return Promise.resolve(cached);
  if (!asking) asking = api.viewingOptions().then((o) => { cached = o; return o; }).catch(() => ({ can: false })).finally(() => { asking = null; });
  return asking;
}

const keyOf = (module) => `whose:${module}`;
export function useWhose(module) {
  const [value, setValueState] = useState(() => { try { return localStorage.getItem(keyOf(module)) || ''; } catch { return ''; } });
  const [opts, setOpts] = useState(cached);
  useEffect(() => { let on = true; loadOptions().then((o) => { if (on) setOpts(o); }); return () => { on = false; }; }, []);
  useEffect(() => { try { setValueState(localStorage.getItem(keyOf(module)) || ''); } catch { setValueState(''); } }, [module]);
  const setValue = (v) => { setValueState(v); try { if (v) localStorage.setItem(keyOf(module), v); else localStorage.removeItem(keyOf(module)); } catch { /* private window */ } };
  // the people the choice means: ids and names (records keep either, depending on the module)
  const people = useMemo(() => {
    if (!opts || !opts.can || !value) return null;
    const [k, raw] = value.split(':');
    const n = Number(raw);
    let ids = [];
    if (value === 'me') ids = [Number(opts.me)];
    else if (k === 'user') ids = [n];
    else if (k === 'team') { const t = (opts.teams || []).find((x) => Number(x.id) === n); ids = t ? t.members.map(Number) : []; }
    else if (k === 'role') ids = (opts.people || []).filter((p) => Number(p.role_id) === n).map((p) => Number(p.id));
    const names = (opts.people || []).filter((p) => ids.includes(Number(p.id))).map((p) => String(p.name || '').trim().toLowerCase());
    return { ids: new Set(ids.map(String)), names: new Set(names) };
  }, [opts, value]);
  return { value: opts && opts.can ? value : '', setValue, opts, people };
}

/** the field that says whose a record is (owner / assigned to) */
export function ownerFieldOf(fields) {
  const users = (fields || []).filter((f) => USER_TYPES.has(f.field_type));
  return users.find((f) => /owner|assigned|salesperson|counsel/i.test(f.api_name)) || users[0] || null;
}
/** keep the rows of those people */
export function applyWhose(rows, people, field, getValue) {
  if (!people || !field) return rows;
  return rows.filter((r) => {
    const v = getValue(r, field);
    if (v === null || v === undefined || v === '') return false;
    return people.ids.has(String(v)) || people.names.has(String(v).trim().toLowerCase());
  });
}

export default function WhoseFilter({ whose, testid = 'whose' }) {
  const { value, setValue, opts } = whose;
  if (!opts || !opts.can) return null;
  return (
    <label className="relative inline-flex items-center" title="Whose records to show">
      <Users size={15} className="absolute left-2.5 text-slate-400 pointer-events-none" />
      <select value={value} onChange={(e) => setValue(e.target.value)} className="input w-auto min-w-[170px] pl-8" aria-label="Whose records" data-testid={testid}>
        <option value="">{opts.sees_all ? 'Everyone' : 'Me and my team'}</option>
        <option value="me">Only mine</option>
        {(opts.teams || []).length > 0 && (
          <optgroup label="Teams">{opts.teams.map((t) => <option key={`t${t.id}`} value={`team:${t.id}`}>{t.name} ({t.count})</option>)}</optgroup>
        )}
        {(opts.roles || []).length > 0 && (
          <optgroup label="Roles">{opts.roles.map((r) => <option key={`r${r.id}`} value={`role:${r.id}`}>{r.name} ({r.count})</option>)}</optgroup>
        )}
        <optgroup label="People">{(opts.people || []).map((p) => <option key={`u${p.id}`} value={`user:${p.id}`}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>)}</optgroup>
      </select>
    </label>
  );
}
