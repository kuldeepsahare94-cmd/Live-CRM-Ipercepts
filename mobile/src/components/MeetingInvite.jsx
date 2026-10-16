/*
 * A meeting's "online" and "who is invited" (v1.4), on the meeting form.
 *
 *   Online: none, Google Meet or Microsoft Teams — the ones this person has
 *   connected (web: Calendar → Connect). After saving, Google / Microsoft make
 *   the real meeting link and the CRM keeps it on the meeting.
 *
 *   Invite: CRM users, leads, contacts (searched by name, e-mail, phone or
 *   company) or any e-mail address typed in. The CRM finds each record's
 *   e-mail itself; one without an e-mail cannot be invited and says so.
 *
 * value: { online: '' | 'google_meet' | 'teams', attendees: [{ kind, module, record_id, name, email }] }
 */
import { useEffect, useRef, useState } from 'react';
import { Video, UserPlus, X, Search, Mail, Loader2, Info } from 'lucide-react';
import { GET, qs } from '../lib/api';
import { Avatar } from './ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLATFORM = { google: ['google_meet', 'Google Meet'], microsoft: ['teams', 'Microsoft Teams'] };
const KIND_LABEL = { user: 'CRM user', lead: 'Lead', contact: 'Contact', external: 'E-mail' };
const keyOf = (a) => String(a.email || `${a.module}:${a.record_id}`).toLowerCase();

/** the platforms this person may use (their connected calendars that can write) */
export function useOnlinePlatforms(enabled) {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    GET('/calendar/connections')
      .then((rows) => setList([...new Set((rows || []).filter((c) => c.status === 'connected' && c.write_enabled && PLATFORM[c.provider]).map((c) => c.provider))].map((p) => ({ id: PLATFORM[p][0], label: PLATFORM[p][1] }))))
      .catch(() => setList([]));
  }, [enabled]);
  return list;
}

function PeopleSearch({ chosen, onAdd }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows(null); return undefined; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      GET(`/calendar/people${qs({ q: term, modules: 'users,leads,contacts', limit: 15 })}`)
        .then((r) => { if (mine === seq.current) setRows(r || []); })
        .catch(() => { if (mine === seq.current) setRows([]); })
        .finally(() => { if (mine === seq.current) setBusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const term = q.trim();
  const typedEmail = EMAIL.test(term) && !chosen.some((a) => keyOf(a) === term.toLowerCase());
  const add = (a) => { onAdd(a); setQ(''); setRows(null); };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="search">
        {busy ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
        <input className="input" placeholder="Name, e-mail, phone — or type an e-mail" value={q} autoCapitalize="none" onChange={(e) => setQ(e.target.value)} data-testid="invite-search" />
      </div>
      {typedEmail && (
        <button type="button" className="row invite-row" onClick={() => add({ kind: 'external', email: term, name: term })} data-testid="invite-email">
          <span className="thumb" style={{ width: 34, height: 34 }}><Mail size={17} /></span>
          <div className="main"><div className="title">Invite {term}</div><div className="line">An e-mail address</div></div>
          <UserPlus size={18} color="var(--brand)" />
        </button>
      )}
      {rows && rows.length > 0 && (
        <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }} data-testid="invite-results">
          {rows.map((r) => {
            const on = chosen.some((a) => (r.email && keyOf(a) === r.email.toLowerCase()) || (a.module === r.module && Number(a.record_id) === Number(r.id)));
            return (
              <button key={`${r.module}-${r.id}`} type="button" className="row invite-row" disabled={on || !r.email} onClick={() => add({ kind: r.kind, module: r.module, record_id: r.id, name: r.name, email: r.email })} data-testid="invite-result">
                <Avatar name={r.name} small />
                <div className="main">
                  <div className="title">{r.name} <span className="tag" style={{ marginLeft: 4 }}>{r.type_label || KIND_LABEL[r.kind] || r.module}</span></div>
                  <div className="line">{r.email || 'No e-mail: cannot be invited'}{r.secondary && r.secondary !== r.email ? ` · ${r.secondary}` : ''}</div>
                </div>
                {on ? <span className="tiny faint">Added</span> : r.email ? <UserPlus size={18} color="var(--brand)" /> : null}
              </button>
            );
          })}
        </div>
      )}
      {rows && !rows.length && !typedEmail && term.length >= 2 && <div className="tiny faint">Nobody found. Type a full e-mail address to invite someone outside the CRM.</div>}
    </div>
  );
}

export default function MeetingInvite({ value, onChange, platforms, canSearch = true }) {
  const v = value || { online: '', attendees: [] };
  const set = (p) => onChange({ ...v, ...p });
  return (
    <div className="card col meet-invite" style={{ gap: 12 }} data-testid="meeting-invite">
      <div className="col" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><Video size={15} /> Online meeting</div>
        {platforms === null ? <Loader2 size={18} className="spin" /> : platforms.length ? (
          <div className="chips" data-testid="online-choices">
            <button type="button" className={`chip${!v.online ? ' on' : ''}`} onClick={() => set({ online: '' })} data-testid="online-none">Not online</button>
            {platforms.map((p) => (
              <button key={p.id} type="button" className={`chip${v.online === p.id ? ' on' : ''}`} onClick={() => set({ online: p.id })} data-testid={`online-${p.id}`}><Video size={14} /> {p.label}</button>
            ))}
          </div>
        ) : (
          <div className="note info small flex" style={{ alignItems: 'flex-start' }} data-testid="online-connect">
            <Info size={16} style={{ flex: 'none', marginTop: 2 }} />
            <span>To make a Google Meet or Teams link from here, connect your Google or Outlook calendar once on the web (Calendar → Connect). A link can also be pasted in the "Video link" box.</span>
          </div>
        )}
        {v.online && <div className="tiny muted">After saving, {v.online === 'teams' ? 'Microsoft' : 'Google'} makes the meeting link. It shows on the meeting in a minute, with Join, Copy and Share.</div>}
      </div>
      <div className="col" style={{ gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}><UserPlus size={15} /> Invite ({v.attendees.length})</div>
        {v.attendees.length > 0 && (
          <div className="chips" data-testid="invite-chosen">
            {v.attendees.map((a) => (
              <button key={keyOf(a)} type="button" className="chip on invite-chip" onClick={() => set({ attendees: v.attendees.filter((x) => keyOf(x) !== keyOf(a)) })} data-testid="invite-chip" title={a.email}>
                {a.name || a.email} <X size={14} />
              </button>
            ))}
          </div>
        )}
        {canSearch
          ? <PeopleSearch chosen={v.attendees} onAdd={(a) => set({ attendees: [...v.attendees.filter((x) => keyOf(x) !== keyOf(a)), a] })} />
          : <div className="tiny faint">Your role cannot invite people from the app.</div>}
        {v.attendees.length > 0 && <div className="tiny muted">Each one gets the invite from the calendar{v.online ? ', with the link' : ''}.</div>}
      </div>
    </div>
  );
}

/** what the meeting already has (when it is changed) */
export function inviteOf(row) {
  let list = [];
  try { list = JSON.parse((row && row.attendees_json) || '[]'); } catch { list = []; }
  return {
    online: (row && row.online_platform) || '',
    attendees: (Array.isArray(list) ? list : []).filter((a) => a && a.email).map((a) => ({ kind: a.kind || 'external', module: a.module || null, record_id: a.record_id || null, name: a.name || a.email, email: a.email })),
  };
}
