/*
 * "Viewing" (v1.4): whose data a list or a dashboard shows — me, everyone I can
 * see, one person, a team, or a role (a group of people with the same job).
 * Only shown to someone who can see other people (a manager, an administrator).
 *
 *   value: 'me' | 'all' | 'user:5' | 'team:2' | 'role:3'
 */
import { useEffect, useState } from 'react';
import { Users, ChevronDown, Search, Check, User, UsersRound, BadgeCheck, Globe } from 'lucide-react';
import { GET } from '../lib/api';
import { get, set } from '../lib/store';
import { Sheet, Loading } from './ui';

let cache = null;     // { uid, opts } — asked once per app start and person
const uid = () => { const m = get('me'); return m ? Number(m.id) : 0; };
/** the people / teams / roles this person may choose */
export function useViewingOptions(enabled = true) {
  const [opts, setOpts] = useState(() => (cache && cache.uid === uid() ? cache.opts : get('viewing_opts')));
  useEffect(() => {
    if (!enabled || (cache && cache.uid === uid())) return;
    GET('/sfa/m/viewing').then((o) => { cache = { uid: uid(), opts: o }; set('viewing_opts', o); setOpts(o); }).catch(() => {});
  }, [enabled]);
  return opts;
}
export function viewLabel(value, opts, { me = 'Me', all = 'Everyone' } = {}) {
  if (!value || value === 'all') return all;
  if (value === 'me') return me;
  const [k, id] = value.split(':');
  const n = Number(id);
  const list = !opts ? [] : k === 'user' ? opts.people : k === 'team' ? opts.teams : opts.roles;
  const hit = (list || []).find((x) => Number(x.id) === n);
  return hit ? hit.name : '…';
}

export default function ViewingPicker({ value, onChange, opts, allowMe = true, allowAll = true, meLabel = 'Mine', allLabel = 'Everyone I can see', testid = 'viewing' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  if (!opts || !opts.can) return null;
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };
  const term = q.trim().toLowerCase();
  const match = (x) => !term || String(x.name).toLowerCase().includes(term);
  const Row = ({ v, icon: Icon, title, sub }) => (
    <button type="button" className="row" onClick={() => pick(v)} data-testid={`${testid}-opt`} data-value={v}>
      <span className="thumb" style={{ width: 34, height: 34, borderRadius: 10, color: 'var(--brand)', background: 'var(--brand-soft)' }}><Icon size={17} /></span>
      <div className="main"><div className="title">{title}</div>{sub && <div className="line">{sub}</div>}</div>
      {value === v && <Check size={18} color="var(--brand)" />}
    </button>
  );
  return (
    <>
      <button type="button" className="chip view-chip" onClick={() => setOpen(true)} data-testid={testid}>
        <Users size={15} /> {viewLabel(value, opts, { me: meLabel, all: allLabel })} <ChevronDown size={15} />
      </button>
      {open && (
        <Sheet title="Whose data" onClose={() => setOpen(false)}>
          <div className="search" style={{ marginBottom: 10 }}><Search size={18} /><input className="input" placeholder="Search a person, team or role" value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testid}-search`} /></div>
          {!opts ? <Loading /> : (
            <div className="col" style={{ gap: 12 }}>
              {!term && (
                <div className="list flat" style={{ boxShadow: 'none' }}>
                  {allowMe && <Row v="me" icon={User} title={meLabel} sub="Only my own" />}
                  {allowAll && <Row v="all" icon={Globe} title={allLabel} sub={opts.sees_all ? 'The whole company' : 'Me and my team'} />}
                </div>
              )}
              {opts.teams.filter(match).length > 0 && (
                <div>
                  <div className="card-title">Teams</div>
                  <div className="list flat" style={{ boxShadow: 'none' }}>{opts.teams.filter(match).map((t) => <Row key={`t${t.id}`} v={`team:${t.id}`} icon={UsersRound} title={t.name} sub={`${t.count} ${t.count === 1 ? 'person' : 'people'}`} />)}</div>
                </div>
              )}
              {opts.roles.filter(match).length > 0 && (
                <div>
                  <div className="card-title">Roles</div>
                  <div className="list flat" style={{ boxShadow: 'none' }}>{opts.roles.filter(match).map((r) => <Row key={`r${r.id}`} v={`role:${r.id}`} icon={BadgeCheck} title={r.name} sub={`${r.count} ${r.count === 1 ? 'person' : 'people'}`} />)}</div>
                </div>
              )}
              <div>
                <div className="card-title">People</div>
                <div className="list flat" style={{ boxShadow: 'none' }}>{opts.people.filter(match).map((p) => <Row key={`u${p.id}`} v={`user:${p.id}`} icon={User} title={p.name} sub={p.role} />)}</div>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
