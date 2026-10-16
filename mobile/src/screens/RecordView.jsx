/*
 * One record (v1.4, the new record page — the same for every module):
 *   the head (name, company, phone, e-mail, status)
 *   the actions (Call, WhatsApp, Check in, Task, Meeting, More…)
 *   a few figures (calls, visits, last contact)
 *   tabs: Details (its fields, in the form's sections, each with ✎) · Related
 *   (contacts, deals, orders, invoices… with "+ Add") · Timeline · Activities
 *   (calls, meetings, tasks, follow-ups with "+") · Notes · Files
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Phone, MessageCircle, Navigation, MapPin, Pencil, ShoppingCart, CheckSquare, CalendarPlus, PhoneCall, Crosshair, Check, Loader2, FileAudio,
  Mail, MoreHorizontal, MoreVertical, Copy, ExternalLink, Clock, ListTree, Network, Activity, StickyNote, Paperclip, Plus, BellRing, Share2,
  User, Building2, MapPinned, Info, Video, Link2, MessagesSquare, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useApp } from '../lib/app';
import { GET, PUT, POST, qs, absolute } from '../lib/api';
import { getRecord, titleOf, phoneOf, show, PHONE_FIELDS } from '../lib/records';
import { here, navigateTo, openOutside } from '../lib/location';
import { money, niceDate, niceTime, phoneFor } from '../lib/format';
import { TopBar, StatusBars, Loading, Empty, StatusTag, BottomNav, Avatar, Sheet, VoiceArea, Field } from '../components/ui';
import { Timeline, List, ago } from '../components/Record360';
import RecordingPicker from '../components/RecordingPicker';
import { canReadPhone, digits10, queueRecordingFile } from '../lib/calls';
import { openWhatsApp } from '../lib/whatsapp';
import { pickFiles, takePhoto } from '../lib/media';
import { VISIT_MODULES, PLACE_MODULES } from '../components/icons';
import { ShareToChat } from './Chat';
import QuickEdit from '../components/QuickEdit';

const ORDER_FROM = { accounts: 'account_id', contacts: 'account_id', opportunities: 'account_id' };
const HIDDEN = new Set(['id', 'related_module', 'related_record_id', 'attendees_json', 'online_meeting_id', 'online_status', 'online_error', 'online_provider', 'online_dial_in']);
const EMAILS = new Set(['email', 'secondary_email', 'email_address']);
const ACTIVITY_OWN = new Set(['meetings', 'calls', 'tasks', 'products']);   // no calls / meetings of their own
const toIso = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };

function copyText(text, say) {
  const done = () => say('Copied.', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(text)).then(done).catch(() => say(String(text), 'info'));
  else say(String(text), 'info');
}

function Action({ icon: Icon, label, onClick, to, color = 'var(--brand)', testid }) {
  const inner = <><span className="ic" style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, color }}><Icon size={22} /></span><span className="act-label">{label}</span></>;
  return to ? <Link to={to} className="tile act" data-testid={testid}>{inner}</Link> : <button type="button" className="tile act" onClick={onClick} data-testid={testid}>{inner}</button>;
}

/** a call: who it was with (v1.3.1) — the customer's name, status and number, tap to open */
function CallWith({ module, id, phone }) {
  const { module: modOf } = useApp();
  const [rec, setRec] = useState(null);
  const m = modOf(module);
  useEffect(() => { if (m) GET(`/${module}/${id}`).then(setRec).catch(() => setRec(false)); }, [module, id, m]);
  const name = rec ? titleOf(module, rec) : '';
  const status = rec ? (rec.status || rec.contact_status || rec.account_status || rec.stage_name || '') : '';
  const body = (
    <>
      <Avatar name={name || '?'} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tiny muted">Call with · {m ? m.singular : module}</div>
        <div className="strong">{rec === null ? '…' : name || `#${id}`}</div>
        {(phone || (rec && phoneOf(rec))) && <div className="tiny muted flex"><Phone size={12} /> {phone || phoneOf(rec)}</div>}
      </div>
      {status && <StatusTag value={status} />}
    </>
  );
  return m
    ? <Link to={`/m/${module}/${id}`} className="card flex" style={{ color: 'inherit', alignItems: 'center', gap: 12 }} data-testid="call-with">{body}</Link>
    : <div className="card flex" style={{ alignItems: 'center', gap: 12 }} data-testid="call-with">{body}</div>;
}

/** a meeting: online link (Join / Copy / Share) and who is invited (v1.4) */
function MeetingOnline({ row, onRefresh }) {
  const { say } = useApp();
  let people = [];
  try { people = JSON.parse(row.attendees_json || '[]'); } catch { people = []; }
  const link = row.video_link;
  const online = link || row.online_platform;
  if (!online && !people.length) return null;
  const plat = row.online_platform === 'teams' ? 'Microsoft Teams' : row.online_platform === 'google_meet' ? 'Google Meet' : 'Online';
  const share = () => openWhatsApp('', `${row.meeting_title}\n${niceDate(row.start_datetime)} ${niceTime(row.start_datetime)}\nJoin: ${link}`);
  return (
    <div className="card col meet-online" data-testid="meeting-online">
      {online && (
        <>
          <div className="flex"><Video size={18} color="var(--brand)" /><span className="strong grow">{plat} meeting</span></div>
          {link ? (
            <>
              <div className="tiny muted ellipsis" data-testid="meeting-link">{link}</div>
              <div className="btns">
                <button type="button" className="btn primary small" onClick={() => openOutside(link)} data-testid="meeting-join"><Video size={16} /> Join</button>
                <button type="button" className="btn outline small" onClick={() => copyText(link, say)} data-testid="meeting-copy"><Copy size={16} /> Copy link</button>
                <button type="button" className="btn outline small" onClick={share} data-testid="meeting-share"><MessageCircle size={16} /> Share</button>
              </div>
            </>
          ) : row.online_status === 'failed' ? (
            <div className="note bad small">The link could not be made{row.online_error ? `: ${row.online_error}` : ''}. Check the calendar connection on the web.</div>
          ) : (
            <div className="note info small flex" data-testid="meeting-link-wait">The link is being made by {plat}. It shows here in a minute. <button type="button" className="link-btn" onClick={onRefresh}>Check now</button></div>
          )}
        </>
      )}
      {people.length > 0 && (
        <div className="col" style={{ gap: 4 }} data-testid="meeting-attendees">
          <div className="card-title" style={{ margin: '6px 0 0' }}>Invited ({people.length})</div>
          {people.map((a) => (
            <div key={a.email} className="flex small"><Avatar name={a.name || a.email} small /><span className="grow ellipsis">{a.name || a.email}</span><span className="tiny faint ellipsis" style={{ maxWidth: '45%' }}>{a.email}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

const SECTION_ICON = (name) => (/contact|phone|mobile/i.test(name) ? Phone : /company|account|organi[sz]ation|business/i.test(name) ? Building2 : /address|location|place/i.test(name) ? MapPinned : /owner|assign/i.test(name) ? User : /basic|personal|lead|info/i.test(name) ? User : Info);

/** the record's fields, in the sections of its form, each section with ✎ */
function Sections({ module, id, mod, row, values, canEdit }) {
  const { module: modOf, say } = useApp();
  // (v1.5) the empty fields wait under "View all fields", so the page shows what is known
  const [all, setAll] = useState(false);
  const every = mod.fields.filter((f) => f.detail !== false && !HIDDEN.has(f.api_name));
  const filled = (f) => { const t = show(f, values[f.api_name], row); return t !== '' && t !== null && t !== undefined; };
  const empty = every.filter((f) => !filled(f)).length;
  const fields = all || empty < 3 ? every : every.filter(filled);
  const groups = [];
  for (const f of fields) {
    const name = f.section || 'Details';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, fields: [] }; groups.push(g); }
    g.fields.push(f);
  }
  return (
    <div className="col" style={{ gap: 12 }} data-testid="details">
      {groups.map((g) => {
        const Icon = SECTION_ICON(g.name);
        return (
          <div key={g.name} className="card sec-card" data-testid="detail-section">
            <div className="sec-head">
              <Icon size={19} color="var(--brand)" />
              <span className="grow strong">{g.name}</span>
              {canEdit && <Link to={`/m/${module}/${id}/edit?section=${encodeURIComponent(g.name)}`} className="icon-btn sec-edit" aria-label={`Change ${g.name}`} data-testid="section-edit"><Pencil size={18} /></Link>}
            </div>
            <dl className="sec-kv">
              {g.fields.map((f) => {
                const raw = values[f.api_name];
                const text = show(f, raw, row);
                const isPhone = f.type === 'phone' || PHONE_FIELDS.includes(f.api_name);
                const isMail = f.type === 'email' || EMAILS.has(f.api_name);
                const lookup = f.type === 'lookup' && raw && modOf(f.lookup_module);
                let dd;
                if (!text) dd = <span className="faint">-</span>;
                else if (/status|stage/.test(f.api_name) && ['dropdown', 'radio', 'text'].includes(f.type)) dd = <StatusTag value={text} />;
                else if (isPhone) dd = <><a href={`tel:${phoneFor(text)}`} className="grow">{text}</a><button type="button" className="icon-btn mini" aria-label="Copy" onClick={() => copyText(text, say)}><Copy size={16} /></button></>;
                else if (isMail) dd = <><a href={`mailto:${text}`} className="grow ellipsis">{text}</a><button type="button" className="icon-btn mini" aria-label="Copy" onClick={() => copyText(text, say)}><Copy size={16} /></button></>;
                else if (lookup) dd = <><Link to={`/m/${f.lookup_module}/${raw}`} className="grow" style={{ color: 'inherit' }}>{text}</Link><Link to={`/m/${f.lookup_module}/${raw}`} className="icon-btn mini" aria-label="Open"><ExternalLink size={16} /></Link></>;
                else if (f.type === 'url') dd = <button type="button" className="link-btn grow ellipsis" onClick={() => openOutside(/^https?:/.test(text) ? text : `https://${text}`)}>{text}</button>;
                else dd = <span className="grow">{text}</span>;
                return [<dt key={`${f.api_name}-k`}>{f.label}</dt>, <dd key={`${f.api_name}-v`} data-field={f.api_name}>{dd}</dd>];
              })}
            </dl>
          </div>
        );
      })}
      {empty >= 3 && (
        <button type="button" className="btn ghost small" style={{ alignSelf: 'center' }} onClick={() => setAll(!all)} data-testid="all-fields">
          {all ? <><ChevronUp size={16} /> Hide the empty fields</> : <><ChevronDown size={16} /> View all fields ({empty} empty)</>}
        </button>
      )}
    </div>
  );
}

/** a short list with "Show all" */
function Group({ tab, label, icon: Icon, color, rows, count, add, linkable, testid }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <div className="col rel-group" style={{ gap: 6 }} data-testid={testid || `rel-${tab}`}>
      <div className="flex rel-head">
        <span className="thumb" style={{ width: 30, height: 30, borderRadius: 9, color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}><Icon size={16} /></span>
        <span className="strong grow">{label}</span>
        {count > 0 && <span className="seg-n">{count}</span>}
        {add && (add.to
          ? <Link to={add.to} className="btn small outline add-btn" data-testid={`add-${tab}`}><Plus size={15} /> {add.label || 'Add'}</Link>
          : <button type="button" className="btn small outline add-btn" onClick={add.onClick} data-testid={`add-${tab}`}><Plus size={15} /> {add.label || 'Add'}</button>)}
      </div>
      {rows.length > 0 ? <List tab={tab} rows={shown} linkable={linkable} /> : <div className="tiny faint" style={{ paddingLeft: 38 }}>None yet.</div>}
      {rows.length > 4 && !all && <button type="button" className="btn ghost small" onClick={() => setAll(true)}>Show all {count > rows.length ? `(latest ${rows.length} of ${count})` : `(${rows.length})`}</button>}
    </div>
  );
}

/** schedule a follow-up (date and time, a note) */
function FollowUpSheet({ module, id, title, onClose, onDone }) {
  const { say } = useApp();
  const d = new Date(Date.now() + 86400000);
  const [day, setDay] = useState(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  const [time, setTime] = useState('11:00');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const at = new Date(`${day}T${time || '09:00'}:00`);
      await POST('/follow-ups', { module, record_id: Number(id), due_at: at.toISOString(), has_time: !!time, date: day, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, notes, subject: 'Follow-up' });
      say('Follow-up set.', 'ok'); onDone();
    } catch (e) { say(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Follow-up · ${title}`} onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <div className="grid2">
          <Field label="Day"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} data-testid="fu-day" /></Field>
          <Field label="Time"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="fu-time" /></Field>
        </div>
        <Field label="Note"><VoiceArea value={notes} onChange={setNotes} testid="fu-notes" placeholder="What to talk about" /></Field>
        <button type="button" className="btn primary block big" disabled={busy || !day} onClick={save} data-testid="fu-save">{busy ? <Loader2 className="spin" /> : <BellRing size={18} />} Set the follow-up</button>
      </div>
    </Sheet>
  );
}

function NoteSheet({ module, id, onClose, onDone }) {
  const { say } = useApp();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!body.trim()) { say('Write the note first.', 'error'); return; }
    setBusy(true);
    try { await POST('/notes', { title: title.trim() || null, body: body.trim(), related_module: module, related_record_id: Number(id) }); say('Note added.', 'ok'); onDone(); } catch (e) { say(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Add a note" onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Title (if you like)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="note-title" /></Field>
        <Field label="Note"><VoiceArea value={body} onChange={setBody} testid="note-body" placeholder="Type or speak" /></Field>
        <button type="button" className="btn primary block big" disabled={busy} onClick={save} data-testid="note-save">{busy ? <Loader2 className="spin" /> : <StickyNote size={18} />} Save the note</button>
      </div>
    </Sheet>
  );
}

const fileIcon = (m) => (/^image\//.test(m || '') ? '🖼️' : /pdf/.test(m || '') ? '📄' : /sheet|excel|csv/.test(m || '') ? '📊' : /word|document/.test(m || '') ? '📝' : /audio/.test(m || '') ? '🎵' : '📎');
const size = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

const TABS = [['details', 'Details', ListTree], ['related', 'Related', Network], ['timeline', 'Timeline', Clock], ['activities', 'Activities', Activity], ['notes', 'Notes', StickyNote], ['files', 'Files', Paperclip]];
const REL = {
  leads: ['visits', 'opportunities', 'quotations'],
  contacts: ['opportunities', 'quotations', 'invoices', 'proformas', 'payments', 'tickets', 'subscriptions', 'visits'],
  accounts: ['contacts', 'opportunities', 'quotations', 'invoices', 'proformas', 'payments', 'tickets', 'subscriptions', 'visits'],
  opportunities: ['quotations', 'invoices', 'proformas', 'payments', 'subscriptions', 'visits'],
  subscriptions: ['payments'],
};
const REL_LABEL = { visits: ['Visits', MapPin, '#2563EB'], opportunities: ['Deals', Network, '#C026D3'], quotations: ['Orders / quotations', ShoppingCart, '#0D9488'], contacts: ['Contacts', User, '#0D9488'], invoices: ['Invoices', ListTree, '#4F46E5'], proformas: ['Proformas', ListTree, '#6366F1'], payments: ['Payments', Check, '#059669'], tickets: ['Tickets', Info, '#E11D48'], subscriptions: ['Subscriptions', Clock, '#059669'] };
const ACT = [['calls', 'Calls', PhoneCall, '#16A34A'], ['meetings', 'Meetings', CalendarPlus, '#7C3AED'], ['tasks', 'Tasks', CheckSquare, '#0891B2'], ['visits', 'Visits', MapPin, '#2563EB'], ['follow_ups', 'Follow-ups', BellRing, '#EA580C']];

export default function RecordView() {
  const { module, id } = useParams();
  const [params, setParams] = useSearchParams();
  const { module: modOf, boot, day, say } = useApp();
  const m = modOf;
  const nav = useNavigate();
  const mod = modOf(module);
  const [data, setData] = useState(null);
  const [rel, setRel] = useState(null);
  const [relError, setRelError] = useState('');
  const [error, setError] = useState('');
  const [place, setPlace] = useState(undefined);
  const [busy, setBusy] = useState('');
  const [pickRec, setPickRec] = useState(false);
  const [recSent, setRecSent] = useState(false);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState('');
  const [actTab, setActTab] = useState('calls');
  const tab = params.get('tab') || 'details';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const sfa = boot.sfa.enabled;
  const visitable = sfa && VISIT_MODULES.includes(module);

  const loadRel = useCallback(() => {
    setRelError('');
    GET(`/sfa/m/related/${module}/${id}`).then(setRel).catch((e) => { setRel({ counts: {}, sections: {}, figures: {}, timeline: [] }); setRelError(e.offline ? 'No internet: this shows when you are online.' : e.message); });
  }, [module, id]);
  const load = useCallback(() => {
    setError('');
    getRecord(module, id, mod ? mod.fields : []).then(setData).catch((e) => setError(e.message));
    if (visitable) GET(`/sfa/places/${module}/${id}`).then((x) => setPlace(x.place)).catch(() => setPlace(null));
    loadRel();
  }, [module, id, mod, visitable, loadRel]);
  useEffect(() => { load(); }, [load]);

  const row = data ? data.row : null;
  const title = row ? titleOf(module, row) : '';
  const tabs = useMemo(() => TABS.filter(([k]) => {
    if (k === 'related') return !!REL[module];
    if (k === 'activities') return !ACTIVITY_OWN.has(module);
    if (k === 'notes') return boot.notes ? boot.notes.view : true;
    if (k === 'files') return boot.documents ? boot.documents.view : true;
    if (k === 'timeline') return module !== 'products';
    return true;
  }), [module, boot]);

  if (!mod) return <div className="screen"><TopBar title="Not in the app" /><Empty title="Your role cannot open this." /></div>;
  if (error) return <div className="screen"><TopBar title={mod.singular} /><div className="body"><div className="note bad">{error}</div></div><BottomNav /></div>;
  if (!data) return <div className="screen"><TopBar title={`${mod.singular} details`} /><Loading /></div>;
  const values = { ...row, ...data.custom };
  const phone = phoneOf(row);
  const email = row.email || row.email_address || '';
  const onDuty = !!(day && day.session);
  const orderAccount = ORDER_FROM[module] ? (module === 'accounts' ? row.id : row.account_id) : null;
  const canOrder = m('quotations') && m('quotations').can.create && m('products') && orderAccount;
  const status = row.status || row.contact_status || row.stage_name || '';
  const company = row.account_name || row.company_name || row.organization || '';
  const can = (x, a = 'create') => !!(m(x) && m(x).can[a]);
  const canNote = boot.notes ? boot.notes.create : true;
  const canFile = boot.documents ? boot.documents.create : true;
  const linkable = (x) => !!modOf(x);
  const relName = encodeURIComponent(title);
  const relQs = `related_module=${module}&related_record_id=${id}&related_name=${relName}`;

  const setHere = async () => {
    setBusy('place');
    try {
      const fix = await here();
      const out = await PUT(`/sfa/places/${module}/${id}`, { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy });
      setPlace(out.place); say('Saved: the customer is here.', 'ok');
    } catch (e) { say(e.message, 'error'); } finally { setBusy(''); }
  };
  const markDone = async () => {
    setBusy('done');
    try { await PUT(`/tasks/${id}`, { status: 'Completed', completed_date: new Date().toISOString().slice(0, 10) }); say('Done!', 'ok'); load(); } catch (e) { say(e.message, 'error'); } finally { setBusy(''); }
  };
  const addFile = async (camera = false) => {
    setMore(false);
    try {
      const list = camera ? [await takePhoto({})].filter(Boolean) : await pickFiles(1, { maxMb: 15 });
      if (!list.length) return;
      setBusy('file');
      const f = list[0];
      await POST('/sfa/m/files', { module, record_id: Number(id), title: f.file_name, file: { data: f.data, mime: f.mime, file_name: f.file_name } });
      say('File added.', 'ok'); setTab('files'); loadRel();
    } catch (e) { say(e.offline ? 'No internet: add the file when you are online.' : e.message, 'error'); } finally { setBusy(''); }
  };
  const share = () => {
    const text = [title, company, phone, email].filter(Boolean).join('\n');
    if (navigator.share) navigator.share({ title, text }).catch(() => {}); else copyText(text, say);
  };
  const call = () => (can('calls') ? nav(`/call/${module}/${id}?dial=1`) : openOutside(`tel:${phoneFor(phone)}`));
  const checkIn = () => (onDuty ? nav(module === 'meetings' ? `/visit/new?meeting=${id}` : `/visit/new?module=${module}&id=${id}&name=${relName}`) : say('Punch in first (on Home).', 'error'));
  const meetingNew = `/m/meetings/new?${relQs}`;

  // the actions: the first five show, the rest are under "More"
  const all = [
    phone && { icon: Phone, label: 'Call', color: '#16A34A', onClick: call, testid: 'act-call' },
    phone && { icon: MessageCircle, label: 'WhatsApp', color: '#16A34A', onClick: () => openWhatsApp(phone, ''), testid: 'act-wa' },
    (visitable || (module === 'meetings' && sfa)) && { icon: MapPin, label: 'Check In', color: '#2563EB', onClick: checkIn, testid: 'act-checkin' },
    module === 'meetings' && row.video_link && { icon: Video, label: 'Join', color: '#7C3AED', onClick: () => openOutside(row.video_link), testid: 'act-join' },
    module === 'tasks' && row.status !== 'Completed' && mod.can.edit && { icon: busy === 'done' ? Loader2 : Check, label: busy === 'done' ? 'Saving…' : 'Mark done', color: '#16A34A', onClick: markDone, testid: 'act-done' },
    !ACTIVITY_OWN.has(module) && can('tasks') && { icon: CheckSquare, label: 'Task', color: '#7C3AED', to: `/m/tasks/new?${relQs}`, testid: 'act-task' },
    !ACTIVITY_OWN.has(module) && can('meetings') && { icon: CalendarPlus, label: 'Meeting', color: '#E11D48', to: meetingNew, testid: 'act-meeting' },
    email && { icon: Mail, label: 'E-mail', color: '#0284C7', onClick: () => openOutside(`mailto:${email}`), testid: 'act-mail' },
    place && { icon: Navigation, label: 'Go there', color: '#2563EB', onClick: () => navigateTo(place.lat, place.lng), testid: 'act-nav' },
    canOrder && { icon: ShoppingCart, label: 'New order', color: '#0891B2', to: `/order/new?account=${orderAccount}${module === 'contacts' ? `&contact=${row.id}` : ''}${module === 'opportunities' ? `&opportunity=${row.id}` : ''}`, testid: 'act-order' },
    VISIT_MODULES.includes(module) && can('calls') && { icon: PhoneCall, label: 'Log call', color: '#EA580C', to: `/call/${module}/${id}`, testid: 'act-log' },
    !ACTIVITY_OWN.has(module) && { icon: BellRing, label: 'Follow-up', color: '#EA580C', onClick: () => { setMore(false); setSheet('fu'); }, testid: 'act-followup' },
    canNote && { icon: StickyNote, label: 'Note', color: '#CA8A04', onClick: () => { setMore(false); setSheet('note'); }, testid: 'act-note' },
    canFile && { icon: Paperclip, label: busy === 'file' ? 'Adding…' : 'File', color: '#475569', onClick: () => addFile(false), testid: 'act-file' },
    visitable && PLACE_MODULES.includes(module) && mod.can.edit && !place && { icon: busy === 'place' ? Loader2 : Crosshair, label: 'Customer is here', color: '#2563EB', onClick: setHere, testid: 'act-place' },
    boot.chat && boot.chat.create && { icon: MessagesSquare, label: 'Send in chat', color: '#7C3AED', onClick: () => { setMore(false); setSheet('chat'); }, testid: 'act-chat' },
    { icon: Share2, label: 'Share', color: '#475569', onClick: share, testid: 'act-share' },
  ].filter(Boolean);
  const first = all.length > 6 ? all.slice(0, 5) : all;
  const rest = all.length > 6 ? all.slice(5) : [];

  // a call: its recording (the phone's file can be chosen by hand when it was not found)
  const callStart = module === 'calls' ? Date.parse(String(row.start_time || row.created_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(row.start_time || '')) ? '' : 'Z')) : 0;
  const callFor = module === 'calls' && callStart ? { date: callStart, end: row.end_time ? Date.parse(row.end_time) : callStart + (Number(row.duration_seconds) || 0) * 1000, duration: Number(row.duration_seconds) || 0, digits: digits10(row.phone_number), name: '' } : null;
  const f = (rel && rel.figures) || {};
  const counts = (rel && rel.counts) || {};
  const sec = (k) => (rel && rel.sections && rel.sections[k]) || [];
  // the record's open follow-up (Quick edit moves it, instead of making a second one)
  const nextFu = (() => { const r = sec('follow_ups').find((x) => /schedul|overdue|due|pending/i.test(x.status || '') || !x.status); return r ? { id: r.id, due_at: r.at || r.due_at, has_time: r.has_time !== 0 && r.has_time !== false } : null; })();
  const goRel = () => setTab(REL[module] ? 'related' : 'timeline');
  const stats = [
    f.calls !== undefined && { k: 'calls', label: 'Calls', value: f.calls, icon: PhoneCall, c: '#16A34A', go: () => { setActTab('calls'); setTab('activities'); } },
    f.visits !== undefined && { k: 'visits', label: 'Visits', value: f.visits, icon: MapPin, c: '#2563EB', go: goRel },
    f.last_contact !== undefined && { k: 'last', label: 'Last contact', value: f.last_contact ? ago(f.last_contact) : '-', icon: Clock, c: '#7C3AED', go: () => setTab('timeline'), small: true },
    f.pipeline_value !== undefined && { k: 'deals', label: `Deals · ${counts.opportunities || 0}`, value: money(f.pipeline_value), icon: Network, c: '#C026D3', go: goRel, small: true },
    f.orders_value !== undefined && { k: 'orders', label: `Orders · ${counts.quotations || 0}`, value: money(f.orders_value), icon: ShoppingCart, c: '#0D9488', go: goRel, small: true },
    f.invoiced !== undefined && { k: 'invoiced', label: f.balance_due ? `Invoiced · ${money(f.balance_due)} due` : 'Invoiced · all paid', value: money(f.invoiced), icon: ListTree, c: '#4F46E5', go: goRel, small: true },
    f.paid !== undefined && { k: 'paid', label: 'Received', value: money(f.paid), icon: Check, c: '#059669', go: goRel, small: true },
    f.next_follow_up && { k: 'next', label: 'Next follow-up', value: niceDate(toIso(f.next_follow_up)), icon: BellRing, c: '#EA580C', go: () => { setActTab('follow_ups'); setTab('activities'); }, small: true },
  ].filter(Boolean);

  // what can be added from the Related tab
  const relAdd = (k) => {
    if (k === 'contacts' && module === 'accounts' && can('contacts')) return { to: `/m/contacts/new?account_id=${id}&account_id_label=${relName}` };
    if (k === 'opportunities' && can('opportunities')) {
      if (module === 'accounts') return { to: `/m/opportunities/new?account_id=${id}&account_id_label=${relName}` };
      if (module === 'contacts') return { to: `/m/opportunities/new?primary_contact_id=${id}&primary_contact_id_label=${relName}${row.account_id ? `&account_id=${row.account_id}&account_id_label=${encodeURIComponent(row.account_name || '')}` : ''}` };
    }
    if (k === 'quotations' && canOrder) return { to: `/order/new?account=${orderAccount}${module === 'contacts' ? `&contact=${row.id}` : ''}${module === 'opportunities' ? `&opportunity=${row.id}` : ''}`, label: 'New order' };
    if (k === 'subscriptions' && can('subscriptions') && orderAccount) return { to: `/m/subscriptions/new?account_id=${orderAccount}&account_id_label=${encodeURIComponent(module === 'accounts' ? title : row.account_name || '')}` };
    if (k === 'visits' && visitable) return { onClick: checkIn, label: 'Check in' };
    return null;
  };
  const actAdd = {
    calls: can('calls') && VISIT_MODULES.includes(module) ? { to: `/call/${module}/${id}`, label: 'Log call' } : null,
    meetings: can('meetings') ? { to: meetingNew } : null,
    tasks: can('tasks') ? { to: `/m/tasks/new?${relQs}` } : null,
    follow_ups: { onClick: () => setSheet('fu') },
    visits: visitable ? { onClick: checkIn, label: 'Check in' } : null,
  };
  const actTabs = ACT.filter(([k]) => k !== 'visits' || (rel && rel.sections && rel.sections.visits) || counts.visits > 0);

  return (
    <div className="screen">
      <TopBar title={`${mod.singular} details`} right={<>
        {mod.can.edit && <Link className="icon-btn" to={`/m/${module}/${id}/edit`} aria-label="Edit" data-testid="edit"><Pencil size={20} /></Link>}
        <button type="button" className="icon-btn" aria-label="More" onClick={() => setMore(true)} data-testid="more-top"><MoreVertical size={20} /></button>
      </>} />
      <StatusBars />
      <div className="body">
        <div className="card hero-card rec-head" data-testid="record-head">
          <div className="flex" style={{ alignItems: 'flex-start', gap: 14 }}>
            <Avatar name={title} big />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="rec-title" data-testid="record-title">{title}</div>
              {(company || row.city || row.state) && <div className="muted rec-sub">{[company, !company && row.city, !company && row.state].filter(Boolean).join(' · ')}</div>}
              {(phone || email) && (
                <div className="rec-contacts">
                  {phone && <button type="button" className="rec-contact" onClick={call} data-testid="head-phone"><Phone size={15} /> {phone}</button>}
                  {email && <button type="button" className="rec-contact ellipsis" onClick={() => openOutside(`mailto:${email}`)} data-testid="head-email"><Mail size={15} /> {email}</button>}
                </div>
              )}
            </div>
            {status && <span className="rec-status"><StatusTag value={status} /></span>}
          </div>
          {row.grand_total !== undefined && row.grand_total !== null && <div className="strong grad-text" style={{ fontSize: 22 }}>{money(row.grand_total)}</div>}
          {row.amount !== undefined && row.amount !== null && module === 'opportunities' && <div className="strong grad-text" style={{ fontSize: 22 }}>{money(row.amount)}</div>}
          {module === 'meetings' && row.start_datetime && <div className="small muted flex"><Clock size={14} /> {niceDate(row.start_datetime)} · {niceTime(row.start_datetime)}{row.end_datetime ? `–${niceTime(row.end_datetime)}` : ''}</div>}
          {place && <div className="tiny faint flex"><MapPin size={12} /> Place saved{place.source === 'visit' ? ' from a visit' : ''}</div>}
          {!ACTIVITY_OWN.has(module) && (
            <button type="button" className="btn outline small quick-btn" onClick={() => setSheet('quick')} data-testid="head-quick"><Zap size={15} /> Quick edit · status, follow-up, note</button>
          )}
        </div>

        {first.length > 0 && (
          <div className="act-row" data-testid="actions">
            {first.map((a) => <Action key={a.testid} {...a} />)}
            {rest.length > 0 && <Action icon={MoreHorizontal} label="More" color="#4F46E5" onClick={() => setMore(true)} testid="act-more" />}
          </div>
        )}

        {stats.length > 0 && (
          <div className="stat-row" data-testid="r360-kpis">
            {stats.map((x) => (
              <button key={x.k} type="button" className="stat" onClick={x.go} data-testid={`stat-${x.k}`}>
                <span className="stat-ic" style={{ '--c': x.c }}><x.icon size={20} /></span>
                <span className="grow" style={{ minWidth: 0 }}><span className={`stat-v${x.small ? ' small' : ''}`}>{x.value}</span><span className="stat-l">{x.label}</span></span>
              </button>
            ))}
          </div>
        )}

        <div className="seg rec-tabs" role="tablist" data-testid="r360-tabs">
          {tabs.map(([k, label, Icon]) => {
            const n = k === 'notes' ? counts.notes : k === 'files' ? counts.files : k === 'activities' ? ['calls', 'meetings', 'tasks', 'follow_ups'].reduce((a, x) => a + (counts[x] || 0), 0) : k === 'related' ? (REL[module] || []).reduce((a, x) => a + (counts[x] || 0), 0) : 0;
            return (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg-b${tab === k ? ' on' : ''}`} onClick={() => setTab(k)} data-testid={`r360-tab-${k}`}>
                <Icon size={15} /> {label}{n > 0 && <span className="seg-n">{n}</span>}
              </button>
            );
          })}
        </div>
        {relError && tab !== 'details' && <div className="note warn small">{relError}</div>}

        {tab === 'details' && (
          <>
            {module === 'quotations' && Array.isArray(row.items) && (
              <div className="list" data-testid="quote-items">
                {row.items.map((it) => (
                  <div key={it.id} className="row">
                    {it.product_thumb_url ? <img className="thumb" src={absolute(it.product_thumb_url)} alt="" /> : <span className="thumb"><ShoppingCart size={18} /></span>}
                    <div className="main"><div className="title">{it.product_name || it.description}</div><div className="line">{Number(it.quantity)} × {money(it.unit_price)}{Number(it.tax_percent) ? ` + ${Number(it.tax_percent)}% tax` : ''}</div></div>
                    <div className="end strong" style={{ color: 'var(--ink)' }}>{money(it.line_total)}</div>
                  </div>
                ))}
                <div className="row"><div className="main muted">Tax</div><div className="end">{money(row.tax_total)}</div></div>
                <div className="row"><div className="main strong">Total</div><div className="end strong" style={{ color: 'var(--ink)' }}>{money(row.grand_total)}</div></div>
              </div>
            )}
            {module === 'meetings' && <MeetingOnline row={row} onRefresh={load} />}
            {module === 'calls' && row.related_module && row.related_record_id && <CallWith module={row.related_module} id={row.related_record_id} phone={row.phone_number} />}
            {module === 'calls' && (
              <div className="card col" data-testid="call-recording">
                <div className="card-title"><FileAudio size={15} /> Recording</div>
                {row.call_recording_url ? <audio controls preload="none" src={absolute(row.call_recording_url)} className="rec-audio" />
                  : recSent ? <div className="small" style={{ color: 'var(--ok)' }}>The recording is being sent.</div>
                    : <div className="small muted">No recording yet.</div>}
                {!row.call_recording_url && !recSent && callFor && canReadPhone() && Number(row.connected) === 1 && (
                  <button type="button" className="btn outline" onClick={() => setPickRec(true)} data-testid="call-add-rec"><FileAudio size={18} /> Add recording from this phone</button>
                )}
              </div>
            )}
            {module === 'tasks' && row.related_module && row.related_record_id && modOf(row.related_module) && (
              <Link to={`/m/${row.related_module}/${row.related_record_id}`} className="card flex" style={{ color: 'inherit' }} data-testid="task-for"><Link2 size={18} color="var(--brand)" /><span className="grow small">For: {row.related_name || `${modOf(row.related_module).singular} #${row.related_record_id}`}</span><ExternalLink size={16} className="faint" /></Link>
            )}
            <Sections module={module} id={id} mod={mod} row={row} values={values} canEdit={mod.can.edit} />
          </>
        )}

        {tab === 'related' && (!rel ? <Loading /> : (
          <div className="card col" style={{ gap: 14 }} data-testid="r360-related">
            {(REL[module] || []).filter((k) => counts[k] > 0 || relAdd(k)).map((k) => {
              const [label, Icon, c] = REL_LABEL[k];
              return <Group key={k} tab={k} label={label} icon={Icon} color={c} rows={sec(k)} count={counts[k] || 0} add={relAdd(k)} linkable={linkable} />;
            })}
            {module === 'leads' && !rel.converted && <div className="tiny muted" data-testid="r360-not-converted">Deals, orders and invoices show here when the lead is converted to a customer (on the web: Convert).</div>}
            {rel.converted && (
              <div className="note info small" data-testid="r360-converted">
                Converted:{' '}
                {rel.converted.account_id && <Link to={`/m/accounts/${rel.converted.account_id}`}>customer</Link>}
                {rel.converted.contact_id && <> · <Link to={`/m/contacts/${rel.converted.contact_id}`}>contact</Link></>}
                {rel.converted.opportunity_id && <> · <Link to={`/m/opportunities/${rel.converted.opportunity_id}`}>deal</Link></>}
              </div>
            )}
          </div>
        ))}

        {tab === 'timeline' && (!rel ? <Loading /> : <Timeline items={rel.timeline || []} linkable={linkable} />)}

        {tab === 'activities' && (!rel ? <Loading /> : (
          <div className="col" style={{ gap: 10 }} data-testid="r360-activities">
            <div className="chips">
              {actTabs.map(([k, label]) => <button key={k} type="button" className={`chip${actTab === k ? ' on' : ''}`} onClick={() => setActTab(k)} data-testid={`act-tab-${k}`}>{label}{counts[k] ? ` · ${counts[k]}` : ''}</button>)}
            </div>
            {actTabs.filter(([k]) => k === actTab).map(([k, label, Icon, c]) => (
              <div key={k} className="card"><Group tab={k} label={label} icon={Icon} color={c} rows={sec(k)} count={counts[k] || 0} add={actAdd[k]} linkable={linkable} testid={`r360-list-${k}`} /></div>
            ))}
          </div>
        ))}

        {tab === 'notes' && (!rel ? <Loading /> : (
          <div className="col" style={{ gap: 10 }} data-testid="r360-notes">
            {canNote && <button type="button" className="btn outline block" onClick={() => setSheet('note')} data-testid="add-note"><Plus size={18} /> Add a note</button>}
            {!sec('notes').length ? <div className="empty small">No notes yet.</div> : sec('notes').map((n) => (
              <div key={n.id} className="card note-card" data-testid="note-row">
                {n.title && <div className="strong">{n.title}</div>}
                <div className="small rec-text">{String(n.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim()}</div>
                <div className="tiny faint flex"><Clock size={11} /> {niceDate(toIso(n.at))} · {niceTime(toIso(n.at))}</div>
              </div>
            ))}
          </div>
        ))}

        {tab === 'files' && (!rel ? <Loading /> : (
          <div className="col" style={{ gap: 10 }} data-testid="r360-files">
            {canFile && (
              <div className="btns">
                <button type="button" className="btn outline" onClick={() => addFile(true)} disabled={busy === 'file'} data-testid="add-photo">📷 Photo</button>
                <button type="button" className="btn outline" onClick={() => addFile(false)} disabled={busy === 'file'} data-testid="add-file">{busy === 'file' ? <Loader2 className="spin" size={18} /> : <Paperclip size={18} />} File</button>
              </div>
            )}
            {!sec('files').length ? <div className="empty small">No files yet.</div> : (
              <div className="list">
                {sec('files').map((x) => (
                  <button key={x.id} type="button" className="row" onClick={() => (x.url ? openOutside(absolute(x.url)) : say('This file has no link.', 'error'))} data-testid="file-row">
                    <span className="thumb" style={{ fontSize: 20 }}>{fileIcon(x.mime_type)}</span>
                    <div className="main"><div className="title">{x.title || x.file_name}</div><div className="line">{[size(x.size_bytes), niceDate(toIso(x.at))].filter(Boolean).join(' · ')}</div></div>
                    <ExternalLink size={16} className="faint" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {more && (
        <Sheet title={title} onClose={() => setMore(false)}>
          <div className="tiles" data-testid="more-actions">{all.map((a) => <Action key={a.testid} {...a} onClick={a.onClick ? () => { setMore(false); a.onClick(); } : undefined} />)}</div>
        </Sheet>
      )}
      {sheet === 'fu' && <FollowUpSheet module={module} id={id} title={title} onClose={() => setSheet('')} onDone={() => { setSheet(''); loadRel(); }} />}
      {sheet === 'quick' && <QuickEdit module={module} id={id} title={title} row={row} followUp={nextFu} onClose={() => setSheet('')} onSaved={() => { setSheet(''); load(); }} />}
      {sheet === 'chat' && <ShareToChat module={module} id={id} label={title} onClose={() => setSheet('')} />}
      {sheet === 'note' && <NoteSheet module={module} id={id} onClose={() => setSheet('')} onDone={() => { setSheet(''); setTab('notes'); loadRel(); }} />}
      {pickRec && callFor && <RecordingPicker call={callFor} onClose={() => setPickRec(false)} onPick={(fl) => { queueRecordingFile({ callId: row.id, file: fl, duration: callFor.duration }); setPickRec(false); setRecSent(true); }} />}
      <BottomNav />
    </div>
  );
}

