/*
 * Team chat in the app (v1.4) — the same chats as the web's Team Chat, in the
 * app's own screens:
 *   /chat        the chats: people and groups, the last message, unread counts;
 *                + : a new chat with a person, a new group, a message to many (broadcast)
 *   /chat/:id    one chat: messages, photos and files, reply, seen ticks; the
 *                group's people, mute, leave
 * New messages come every few seconds while a chat is open; with the app closed
 * they come as phone alerts (when set up).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MessagesSquare, Search, Plus, Users, User, Megaphone, Send, Paperclip, Camera, X, Reply, Copy, Trash2, BellOff, Bell, LogOut,
  Check, CheckCheck, Loader2, ExternalLink, UserPlus, Info,
} from 'lucide-react';
import { GET, POST, DELETE, absolute } from '../lib/api';
import { useApp } from '../lib/app';
import { onAlert } from '../lib/push';
import { niceDate, niceTime } from '../lib/format';
import { openOutside } from '../lib/location';
import { pickFiles, takePhoto, MORE_TYPES } from '../lib/media';
import { TopBar, BottomNav, Loading, Empty, Avatar, Sheet, StatusBars } from '../components/ui';

const toIso = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };
const dayOf = (v) => { const t = new Date(toIso(v)); return Number.isNaN(t.getTime()) ? '' : `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`; };
function when(v) {
  const t = new Date(toIso(v));
  if (Number.isNaN(t.getTime())) return '';
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return niceTime(toIso(v));
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return 'Yesterday';
  return niceDate(toIso(v));
}
function dayTitle(v) {
  const t = new Date(toIso(v));
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return 'Yesterday';
  return niceDate(toIso(v));
}
const isImage = (a) => /^image\/(png|jpe?g|gif|webp)/.test(a.mime_type || '');
const size = (n) => (!n ? '' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

function ConvAvatar({ c }) {
  if (c.type === 'group') return <span className="avatar chat-group-av"><Users size={19} /></span>;
  return <span className="av-wrap"><Avatar name={c.title} />{c.online && <span className="online-dot" />}</span>;
}

/** people to choose (one, or several with ticks) */
function PeoplePicker({ title, multi = false, onDone, onClose, exclude = [], action = 'Next' }) {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [ids, setIds] = useState([]);
  useEffect(() => { GET('/chat/users').then((u) => setUsers(u.filter((x) => !exclude.includes(Number(x.id))))).catch(() => setUsers([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase();
  const shown = (users || []).filter((u) => !term || `${u.full_name || ''} ${u.username || ''}`.toLowerCase().includes(term));
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="search" style={{ marginBottom: 10 }}><Search size={18} /><input className="input" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} data-testid="chat-people-search" /></div>
      {!users ? <Loading /> : !shown.length ? <Empty title="Nobody found" /> : (
        <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
          {shown.map((u) => {
            const on = ids.includes(Number(u.id));
            return (
              <button key={u.id} type="button" className="row" onClick={() => (multi ? setIds(on ? ids.filter((x) => x !== Number(u.id)) : [...ids, Number(u.id)]) : onDone([Number(u.id)]))} data-testid="chat-person">
                {multi && <span className={`tickbox${on ? ' on' : ''}`} aria-hidden="true">{on && <Check size={14} />}</span>}
                <span className="av-wrap"><Avatar name={u.full_name || u.username} />{!!Number(u.online) && <span className="online-dot" />}</span>
                <div className="main"><div className="title">{u.full_name || u.username}</div><div className="line">{Number(u.online) ? 'Online' : u.username}</div></div>
              </button>
            );
          })}
        </div>
      )}
      {multi && (
        <div className="picker-foot">
          <button type="button" className="btn primary block big" disabled={!ids.length} onClick={() => onDone(ids)} data-testid="chat-people-done">{ids.length ? `${action} (${ids.length})` : 'Tick the people'}</button>
        </div>
      )}
    </Sheet>
  );
}

function NewGroup({ onClose, onMade }) {
  const { say } = useApp();
  const [step, setStep] = useState('people');
  const [ids, setIds] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (step === 'people') return <PeoplePicker title="New group: who is in it" multi onClose={onClose} onDone={(x) => { setIds(x); setStep('name'); }} />;
  const make = async () => {
    setBusy(true);
    try { const c = await POST('/chat/groups', { name: name.trim(), member_ids: ids }); onMade(c); } catch (e) { say(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Name the group" onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <input className="input" autoFocus placeholder="Like: Sales North" value={name} onChange={(e) => setName(e.target.value)} data-testid="group-name" />
        <div className="tiny muted">{ids.length} {ids.length === 1 ? 'person' : 'people'} and you.</div>
        <button type="button" className="btn primary block big" disabled={busy || !name.trim()} onClick={make} data-testid="group-make">{busy ? <Loader2 className="spin" /> : <Users size={18} />} Make the group</button>
      </div>
    </Sheet>
  );
}

function Broadcast({ onClose }) {
  const { say } = useApp();
  const [ids, setIds] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ids) return <PeoplePicker title="Message to many: who gets it" multi action="Next" onClose={onClose} onDone={setIds} />;
  const send = async () => {
    setBusy(true);
    try { const r = await POST('/sfa/m/chat/broadcast', { user_ids: ids, body: text.trim() }); say(`Sent to ${r.delivered}. Each gets it in their own chat with you.`, 'ok'); onClose(); } catch (e) { say(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Message to ${ids.length}`} onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <textarea className="input" rows={4} autoFocus placeholder="Type the message" value={text} onChange={(e) => setText(e.target.value)} data-testid="broadcast-text" />
        <button type="button" className="btn primary block big" disabled={busy || !text.trim()} onClick={send} data-testid="broadcast-send">{busy ? <Loader2 className="spin" /> : <Megaphone size={18} />} Send to {ids.length}</button>
      </div>
    </Sheet>
  );
}

export default function ChatList() {
  const { boot, say, setUnread } = useApp();
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [adding, setAdding] = useState('');
  const canSend = !!(boot.chat && boot.chat.create);
  const load = useCallback(() => {
    GET('/sfa/m/chat/conversations').then((x) => {
      setList(x.conversations); setError('');
      setUnread(x.conversations.filter((c) => !c.muted).reduce((a, c) => a + (Number(c.unread) || 0), 0));
    }).catch((e) => setError(e.offline ? 'No internet: the chats show when you are online.' : e.message));
  }, [setUnread]);
  useEffect(() => { load(); const t = setInterval(load, 8000); const off = onAlert(load); return () => { clearInterval(t); off(); }; }, [load]);
  const term = q.trim().toLowerCase();
  const shown = (list || []).filter((c) => (tab === 'unread' ? c.unread > 0 : tab === 'groups' ? c.type === 'group' : true))
    .filter((c) => !term || String(c.title || '').toLowerCase().includes(term) || (c.last_message && String(c.last_message.body || '').toLowerCase().includes(term)));
  const openWith = async (ids) => {
    setAdding('');
    try { const c = await POST('/chat/direct', { user_id: ids[0] }); nav(`/chat/${c.id}`); } catch (e) { say(e.message, 'error'); }
  };
  const unreadN = (list || []).filter((c) => c.unread > 0).length;
  return (
    <div className="screen">
      <TopBar title="Chat" back={false} />
      <StatusBars />
      <div className="body">
        <div className="search"><Search size={18} /><input className="input" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} data-testid="chat-search" /></div>
        <div className="chips">
          {[['all', 'All'], ['unread', `Unread${unreadN ? ` · ${unreadN}` : ''}`], ['groups', 'Groups']].map(([k, label]) => (
            <button key={k} type="button" className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)} data-testid={`chat-tab-${k}`}>{label}</button>
          ))}
        </div>
        {error && <div className="note warn small">{error}</div>}
        {!list && !error ? <Loading /> : list && !shown.length ? (
          <Empty icon={MessagesSquare} title={term || tab !== 'all' ? 'No chats here' : 'No chats yet'}>
            {canSend && !term && tab === 'all' && <button type="button" className="btn primary small" onClick={() => setAdding('person')}>Start a chat</button>}
          </Empty>
        ) : list && (
          <div className="list" data-testid="chat-list">
            {shown.map((c) => {
              const last = c.last_message;
              const mine = last && Number(last.sender_id) === Number(boot.me.id);
              const preview = !last ? (c.type === 'group' ? `${c.member_count} people` : 'Say hello 👋') : `${mine ? 'You: ' : c.type === 'group' ? `${String(last.sender_name || '').split(' ')[0]}: ` : ''}${last.body || (last.attachment_count ? '📎 File' : '')}`;
              return (
                <Link key={c.id} to={`/chat/${c.id}`} className={`row chat-row${c.unread ? ' unread' : ''}`} data-testid="chat-row">
                  <ConvAvatar c={c} />
                  <div className="main">
                    <div className="title flex" style={{ gap: 6 }}><span className="grow ellipsis">{c.title}</span>{last && <span className={`tiny${c.unread ? ' brand-text' : ' faint'}`}>{when(last.created_at)}</span>}</div>
                    <div className="line flex" style={{ gap: 6 }}>
                      <span className="grow ellipsis">{preview}</span>
                      {c.muted && <BellOff size={13} className="faint" />}
                      {c.unread > 0 && <span className="badge-n inline" data-testid="chat-row-unread">{c.unread > 99 ? '99+' : c.unread}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {canSend && <button type="button" className="fab" aria-label="New chat" onClick={() => setAdding('menu')} data-testid="chat-new"><Plus size={26} /></button>}
      {adding === 'menu' && (
        <Sheet title="New" onClose={() => setAdding('')}>
          <div className="list flat" style={{ boxShadow: 'none' }}>
            <button type="button" className="row" onClick={() => setAdding('person')} data-testid="chat-new-person"><span className="thumb"><User size={18} /></span><div className="main"><div className="title">Chat with a person</div><div className="line">One to one</div></div></button>
            <button type="button" className="row" onClick={() => setAdding('group')} data-testid="chat-new-group"><span className="thumb"><Users size={18} /></span><div className="main"><div className="title">New group</div><div className="line">Several people in one chat</div></div></button>
            <button type="button" className="row" onClick={() => setAdding('broadcast')} data-testid="chat-new-broadcast"><span className="thumb"><Megaphone size={18} /></span><div className="main"><div className="title">Message to many</div><div className="line">The same message to each, in their own chat with you</div></div></button>
          </div>
        </Sheet>
      )}
      {adding === 'person' && <PeoplePicker title="Chat with" onClose={() => setAdding('')} onDone={openWith} />}
      {adding === 'group' && <NewGroup onClose={() => setAdding('')} onMade={(c) => { setAdding(''); nav(`/chat/${c.id}`); }} />}
      {adding === 'broadcast' && <Broadcast onClose={() => { setAdding(''); load(); }} />}
      <BottomNav />
    </div>
  );
}

function Attachment({ a, mine }) {
  const url = a.url ? absolute(a.url) : '';
  if (isImage(a) && url) {
    return <button type="button" className="chat-img" onClick={() => openOutside(url)} data-testid="chat-att-img"><img src={url} alt={a.file_name} loading="lazy" /></button>;
  }
  return (
    <button type="button" className={`chat-file${mine ? ' mine' : ''}`} onClick={() => (url ? openOutside(url) : null)} data-testid="chat-att-file">
      <Paperclip size={16} /><span className="grow ellipsis">{a.file_name}</span><span className="tiny">{size(a.size_bytes)}</span>
    </button>
  );
}

function Bubble({ m, group, onAct, modOf }) {
  const rec = m.ref && m.ref.module && m.ref.record_id;
  return (
    <div className={`msg${m.mine ? ' mine' : ''}`} data-testid="chat-msg">
      <button type="button" className="bubble" onClick={() => !m.deleted && onAct(m)} data-testid={m.mine ? 'chat-msg-mine' : 'chat-msg-theirs'}>
        {group && !m.mine && <div className="msg-who">{m.sender_name}</div>}
        {m.reply_to && <div className="msg-quote"><b>{m.reply_to.mine ? 'You' : m.reply_to.sender_name}</b><span>{m.reply_to.body}</span></div>}
        {m.deleted ? <i className="faint">Message deleted</i> : m.body && <div className="msg-text">{m.body}</div>}
        {(m.attachments || []).map((a) => <Attachment key={a.id} a={a} mine={m.mine} />)}
        {rec && (
          modOf(m.ref.module)
            ? <Link to={`/m/${m.ref.module}/${m.ref.record_id}`} className="msg-ref" onClick={(e) => e.stopPropagation()}><ExternalLink size={14} /> {m.ref.label || `${m.ref.module} #${m.ref.record_id}`}</Link>
            : <span className="msg-ref"><Info size={14} /> {m.ref.label || m.ref.module}</span>
        )}
        <div className="msg-meta">{m.edited_at && 'edited · '}{niceTime(toIso(m.created_at))}{m.mine && !m.deleted && (m.seen_by_all ? <CheckCheck size={14} className="seen" data-testid="msg-seen" /> : <Check size={14} />)}</div>
      </button>
    </div>
  );
}

function GroupInfo({ conv, onClose, onChanged, onLeft }) {
  const { boot, say } = useApp();
  const [adding, setAdding] = useState(false);
  const admin = conv.my_role === 'admin';
  const mute = async () => { try { await POST(`/chat/conversations/${conv.id}/mute`, { muted: !conv.muted }); onChanged(); say(conv.muted ? 'Alerts on for this chat.' : 'This chat is muted.', 'ok'); } catch (e) { say(e.message, 'error'); } };
  const leave = async () => {
    if (!window.confirm(`Leave ${conv.title}?`)) return;
    try { await POST(`/chat/conversations/${conv.id}/leave`, {}); onLeft(); } catch (e) { say(e.message, 'error'); }
  };
  const add = async (ids) => { setAdding(false); try { await POST(`/chat/conversations/${conv.id}/members`, { member_ids: ids }); onChanged(); say('Added.', 'ok'); } catch (e) { say(e.message, 'error'); } };
  if (adding) return <PeoplePicker title="Add to the group" multi action="Add" exclude={conv.members.map((x) => Number(x.id))} onClose={() => setAdding(false)} onDone={add} />;
  return (
    <Sheet title={conv.title} onClose={onClose}>
      <div className="col" style={{ gap: 12 }} data-testid="chat-info">
        <button type="button" className="btn outline block" onClick={mute} data-testid="chat-mute">{conv.muted ? <><Bell size={18} /> Turn alerts on</> : <><BellOff size={18} /> Mute this chat</>}</button>
        {conv.type === 'group' && (
          <>
            <div className="card-title" style={{ margin: 0 }}>{conv.member_count} people</div>
            <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
              {conv.members.map((p) => (
                <div key={p.id} className="row">
                  <span className="av-wrap"><Avatar name={p.full_name || p.username} />{!!Number(p.online) && <span className="online-dot" />}</span>
                  <div className="main"><div className="title">{Number(p.id) === Number(boot.me.id) ? 'You' : p.full_name || p.username}</div>{p.role === 'admin' && <div className="line">Group admin</div>}</div>
                </div>
              ))}
            </div>
            {admin && <button type="button" className="btn outline block" onClick={() => setAdding(true)} data-testid="chat-add-people"><UserPlus size={18} /> Add people</button>}
            <button type="button" className="btn ghost block bad-text" onClick={leave} data-testid="chat-leave"><LogOut size={18} /> Leave the group</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

export function ChatThread() {
  const { id } = useParams();
  const cid = Number(id);
  const { boot, say, refreshUnread, module: modOf } = useApp();
  const nav = useNavigate();
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [error, setError] = useState('');
  const [older, setOlder] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [reply, setReply] = useState(null);
  const [act, setAct] = useState(null);
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const cursor = useRef(0);
  const bottom = useRef(null);
  const listRef = useRef(null);
  const canSend = !!(boot.chat && boot.chat.create);

  const toEnd = (smooth = false) => setTimeout(() => bottom.current && bottom.current.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' }), 30);
  const read = useCallback(() => { POST(`/chat/conversations/${cid}/read`, {}).then(() => refreshUnread()).catch(() => {}); }, [cid, refreshUnread]);
  const loadConv = useCallback(() => GET(`/chat/conversations/${cid}`).then(setConv).catch(() => {}), [cid]);
  useEffect(() => {
    setMsgs(null); setConv(null); setError(''); cursor.current = 0;
    GET(`/sfa/m/chat/${cid}/messages`).then((x) => {
      setMsgs(x.messages); setConv(x.conversation); setOlder(x.messages.length >= 40);
      cursor.current = x.messages.reduce((a, m) => Math.max(a, Number(m.id)), 0);
      read(); toEnd();
    }).catch((e) => setError(e.offline ? 'No internet: the chat shows when you are online.' : e.message));
  }, [cid, read]);

  // new messages, and who has seen mine
  const poll = useCallback(() => {
    if (!cursor.current && msgs === null) return;
    POST('/sfa/m/chat/poll', { since: cursor.current, conversation_id: cid }).then((x) => {
      const fresh = (x.messages || []).filter((m) => Number(m.conversation_id) === cid);
      if (x.messages && x.messages.length) cursor.current = Math.max(cursor.current, ...x.messages.map((m) => Number(m.id)));
      const r = x.receipts;
      setMsgs((old) => {
        if (!old) return old;
        let list = old;
        if (fresh.length) { const have = new Set(old.map((m) => m.id)); list = [...old, ...fresh.filter((m) => !have.has(m.id))]; }
        if (r && r.conversation_id === cid) list = list.map((m) => (m.mine && !m.seen_by_all && r.others_count > 0 && Number(m.id) <= r.seen_by_all_upto ? { ...m, seen_by_all: true } : m));
        return list;
      });
      if (fresh.length) { read(); toEnd(true); }
    }).catch(() => {});
  }, [cid, msgs, read]);
  useEffect(() => { const t = setInterval(poll, 4000); const off = onAlert(poll); return () => { clearInterval(t); off(); }; }, [poll]);

  const loadOlder = async () => {
    if (!msgs || !msgs.length) return;
    try {
      const x = await GET(`/sfa/m/chat/${cid}/messages?before=${msgs[0].id}`);
      setMsgs([...x.messages, ...msgs]); setOlder(x.messages.length >= 40);
    } catch (e) { say(e.message, 'error'); }
  };
  const attach = async (camera) => {
    try {
      const got = camera ? [await takePhoto({})].filter(Boolean) : await pickFiles(5 - files.length, { maxMb: 15, accept: MORE_TYPES });
      setFiles([...files, ...got].slice(0, 5));
    } catch (e) { say(e.message, 'error'); }
  };
  const send = async () => {
    const body = text.trim();
    if (!body && !files.length) return;
    setBusy(true);
    try {
      const m = await POST(`/sfa/m/chat/${cid}/send`, { body, reply_to_id: reply ? reply.id : null, files: files.map((f) => ({ data: f.data, mime: f.mime, file_name: f.file_name })) });
      setText(''); setFiles([]); setReply(null);
      cursor.current = Math.max(cursor.current, Number(m.id));
      setMsgs((old) => [...(old || []).filter((x) => x.id !== m.id), m]);
      toEnd(true);
    } catch (e) { say(e.offline ? 'No internet: the message was not sent. Try again when online.' : e.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (m) => {
    setAct(null);
    try { await DELETE(`/chat/messages/${m.id}`); setMsgs((old) => old.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, attachments: [] } : x))); } catch (e) { say(e.message, 'error'); }
  };
  const copy = (m) => { setAct(null); if (navigator.clipboard) navigator.clipboard.writeText(m.body || '').then(() => say('Copied.', 'ok')).catch(() => {}); };

  const group = conv && conv.type === 'group';
  const sub = !conv ? '' : group ? `${conv.member_count} people${conv.online ? ' · someone online' : ''}` : conv.online ? 'Online' : '';
  const rows = useMemo(() => {
    const out = [];
    let last = '';
    for (const m of msgs || []) {
      const d = dayOf(m.created_at);
      if (d !== last) { out.push({ day: m.created_at, key: `d-${m.id}` }); last = d; }
      out.push({ m, key: m.id });
    }
    return out;
  }, [msgs]);

  return (
    <div className="screen no-nav chat-screen">
      <TopBar title={conv ? conv.title : 'Chat'} sub={sub} onBack={() => nav('/chat')} right={conv && <button type="button" className="icon-btn" aria-label="About this chat" onClick={() => setInfo(true)} data-testid="chat-info-open">{conv.muted ? <BellOff size={20} /> : group ? <Users size={20} /> : <Info size={20} />}</button>} />
      <StatusBars />
      <div className="body chat-body" ref={listRef} data-testid="chat-thread">
        {error && <div className="note bad">{error}</div>}
        {!msgs && !error && <Loading />}
        {msgs && older && msgs.length > 0 && <button type="button" className="btn ghost small" style={{ alignSelf: 'center' }} onClick={loadOlder} data-testid="chat-older">Earlier messages</button>}
        {msgs && !msgs.length && <div className="empty small">No messages yet. Say hello 👋</div>}
        {rows.map((r) => (r.day
          ? <div key={r.key} className="day-sep"><span>{dayTitle(r.day)}</span></div>
          : <Bubble key={r.key} m={r.m} group={group} onAct={setAct} modOf={modOf} />))}
        <div ref={bottom} />
      </div>
      {canSend && conv && (
        <div className="composer" data-testid="chat-composer">
          {reply && <div className="composer-reply"><Reply size={14} /><span className="grow ellipsis"><b>{reply.mine ? 'You' : reply.sender_name}</b> {reply.body || 'File'}</span><button type="button" className="icon-btn mini" onClick={() => setReply(null)} aria-label="Do not reply"><X size={16} /></button></div>}
          {files.length > 0 && (
            <div className="chips composer-files">
              {files.map((f, i) => <button key={`${f.file_name}-${i}`} type="button" className="chip on" onClick={() => setFiles(files.filter((_, j) => j !== i))} data-testid="chat-file-chip">{f.preview ? '🖼️' : '📎'} {f.file_name} <X size={13} /></button>)}
            </div>
          )}
          <div className="composer-row">
            <button type="button" className="icon-btn" aria-label="Photo" onClick={() => attach(true)} disabled={files.length >= 5} data-testid="chat-photo"><Camera size={21} /></button>
            <button type="button" className="icon-btn" aria-label="File" onClick={() => attach(false)} disabled={files.length >= 5} data-testid="chat-attach"><Paperclip size={21} /></button>
            <textarea className="input" rows={1} placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} data-testid="chat-input"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); send(); } }} />
            <button type="button" className="send-btn" aria-label="Send" disabled={busy || (!text.trim() && !files.length)} onClick={send} data-testid="chat-send">{busy ? <Loader2 size={20} className="spin" /> : <Send size={20} />}</button>
          </div>
        </div>
      )}
      {act && (
        <Sheet title="Message" onClose={() => setAct(null)}>
          <div className="list flat" style={{ boxShadow: 'none' }}>
            {canSend && <button type="button" className="row" onClick={() => { setReply(act); setAct(null); }} data-testid="msg-reply"><span className="thumb"><Reply size={18} /></span><div className="main"><div className="title">Reply</div></div></button>}
            {act.body && <button type="button" className="row" onClick={() => copy(act)}><span className="thumb"><Copy size={18} /></span><div className="main"><div className="title">Copy the text</div></div></button>}
            {act.mine && <button type="button" className="row" onClick={() => remove(act)} data-testid="msg-delete"><span className="thumb bad-text"><Trash2 size={18} /></span><div className="main"><div className="title bad-text">Delete for everyone</div></div></button>}
            {act.mine && act.seen_by && act.seen_by.length > 0 && <div className="tiny muted" style={{ padding: '8px 12px' }}>Seen by {act.seen_by.map((s) => s.name).join(', ')}</div>}
          </div>
        </Sheet>
      )}
      {info && conv && <GroupInfo conv={conv} onClose={() => setInfo(false)} onChanged={() => { loadConv(); }} onLeft={() => { setInfo(false); nav('/chat', { replace: true }); }} />}
    </div>
  );
}

/** a record shared into a chat from its page (v1.4): choose the chat */
export function ShareToChat({ module, id, label, onClose }) {
  const { say } = useApp();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(0);
  useEffect(() => { GET('/sfa/m/chat/conversations').then((x) => setList(x.conversations)).catch(() => setList([])); }, []);
  const share = async (c) => {
    setBusy(c.id);
    try { await POST(`/sfa/m/chat/${c.id}/send`, { body: '', ref: { module, record_id: Number(id), label } }); say(`Shared with ${c.title}.`, 'ok'); onClose(); } catch (e) { say(e.message, 'error'); } finally { setBusy(0); }
  };
  return (
    <Sheet title="Share in a chat" onClose={onClose}>
      {!list ? <Loading /> : !list.length ? <Empty title="No chats yet" /> : (
        <div className="list flat" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
          {list.map((c) => (
            <button key={c.id} type="button" className="row" disabled={!!busy} onClick={() => share(c)} data-testid="share-chat-row">
              <ConvAvatar c={c} /><div className="main"><div className="title">{c.title}</div></div>{busy === c.id && <Loader2 size={18} className="spin" />}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
