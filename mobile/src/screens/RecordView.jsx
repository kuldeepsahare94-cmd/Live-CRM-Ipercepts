/* One record: what it is, what can be done with it (call, WhatsApp, go there, check in, order…), its details. */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Phone, MessageCircle, Navigation, MapPin, Pencil, ShoppingCart, CheckSquare, CalendarPlus, PhoneCall, Crosshair, Check, Loader2 } from 'lucide-react';
import { useApp } from '../lib/app';
import { GET, PUT, qs, absolute } from '../lib/api';
import { getRecord, titleOf, phoneOf, show } from '../lib/records';
import { here, navigateTo, openOutside } from '../lib/location';
import { money, niceDate, niceTime, phoneFor } from '../lib/format';
import { TopBar, StatusBars, Loading, Empty, StatusTag, BottomNav } from '../components/ui';
import { VISIT_MODULES, PLACE_MODULES } from '../components/icons';

const ORDER_FROM = { accounts: 'account_id', contacts: 'account_id', opportunities: 'account_id' };

function Action({ icon: Icon, label, onClick, to, color = 'var(--brand)', testid }) {
  const inner = <><span className="ic" style={{ background: 'var(--line-soft)', color }}><Icon size={20} /></span>{label}</>;
  return to ? <Link to={to} className="tile" data-testid={testid}>{inner}</Link> : <button type="button" className="tile" onClick={onClick} data-testid={testid}>{inner}</button>;
}

export default function RecordView() {
  const { module, id } = useParams();
  const { module: modOf, boot, day, say, module: m } = useApp();
  const nav = useNavigate();
  const mod = modOf(module);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [place, setPlace] = useState(undefined);
  const [visits, setVisits] = useState([]);
  const [busy, setBusy] = useState('');
  const sfa = boot.sfa.enabled;
  const visitable = sfa && VISIT_MODULES.includes(module);

  const load = useCallback(() => {
    setError('');
    getRecord(module, id, mod ? mod.fields : []).then(setData).catch((e) => setError(e.message));
    if (visitable) {
      GET(`/sfa/places/${module}/${id}`).then((x) => setPlace(x.place)).catch(() => setPlace(null));
      GET(`/sfa/visits${qs({ related_module: module, related_record_id: id })}`).then((x) => setVisits(x.rows.slice(0, 5))).catch(() => setVisits([]));
    }
  }, [module, id, mod, visitable]);
  useEffect(() => { load(); }, [load]);

  if (!mod) return <div className="screen"><TopBar title="Not in the app" /><Empty title="Your role cannot open this." /></div>;
  if (error) return <div className="screen"><TopBar title={mod.singular} /><div className="body"><div className="note bad">{error}</div></div><BottomNav /></div>;
  if (!data) return <div className="screen"><TopBar title={mod.singular} /><Loading /></div>;
  const row = data.row;
  const values = { ...row, ...data.custom };
  const phone = phoneOf(row);
  const title = titleOf(module, row);
  const onDuty = !!(day && day.session);
  const orderAccount = ORDER_FROM[module] ? (module === 'accounts' ? row.id : row.account_id) : null;
  const canOrder = m('quotations') && m('quotations').can.create && m('products') && orderAccount;
  const status = row.status || row.contact_status || row.stage_name || '';

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

  const actions = [
    phone && { icon: Phone, label: 'Call', color: 'var(--ok)', onClick: () => (m('calls') && m('calls').can.create ? nav(`/call/${module}/${id}?dial=1`) : openOutside(`tel:${phoneFor(phone)}`)), testid: 'act-call' },
    phone && { icon: MessageCircle, label: 'WhatsApp', color: '#16A34A', onClick: () => openOutside(`https://wa.me/${phoneFor(phone, { whatsapp: true })}`), testid: 'act-wa' },
    place && { icon: Navigation, label: 'Go there', onClick: () => navigateTo(place.lat, place.lng), testid: 'act-nav' },
    visitable && { icon: MapPin, label: 'Check in', color: '#2563EB', onClick: () => (onDuty ? nav(`/visit/new?module=${module}&id=${id}&name=${encodeURIComponent(title)}`) : say('Punch in first (on Home).', 'error')), testid: 'act-checkin' },
    module === 'meetings' && sfa && { icon: MapPin, label: 'Check in', color: '#2563EB', onClick: () => (onDuty ? nav(`/visit/new?meeting=${id}`) : say('Punch in first (on Home).', 'error')), testid: 'act-checkin' },
    canOrder && { icon: ShoppingCart, label: 'New order', color: '#0891B2', to: `/order/new?account=${orderAccount}${module === 'contacts' ? `&contact=${row.id}` : ''}${module === 'opportunities' ? `&opportunity=${row.id}` : ''}`, testid: 'act-order' },
    VISIT_MODULES.includes(module) && m('calls') && m('calls').can.create && !phone && { icon: PhoneCall, label: 'Log call', to: `/call/${module}/${id}`, testid: 'act-log' },
    VISIT_MODULES.includes(module) && m('tasks') && m('tasks').can.create && { icon: CheckSquare, label: 'Task', to: `/m/tasks/new?related_module=${module}&related_record_id=${id}`, testid: 'act-task' },
    VISIT_MODULES.includes(module) && m('meetings') && m('meetings').can.create && { icon: CalendarPlus, label: 'Meeting', to: `/m/meetings/new?related_module=${module}&related_record_id=${id}`, testid: 'act-meeting' },
    module === 'tasks' && row.status !== 'Completed' && mod.can.edit && { icon: Check, label: busy === 'done' ? 'Saving…' : 'Mark done', color: 'var(--ok)', onClick: markDone, testid: 'act-done' },
    visitable && PLACE_MODULES.includes(module) && mod.can.edit && !place && { icon: busy === 'place' ? Loader2 : Crosshair, label: 'Customer is here', onClick: setHere, testid: 'act-place' },
  ].filter(Boolean);

  const detail = mod.fields.filter((f) => f.detail !== false && show(f, values[f.api_name], row) !== '' && !['id'].includes(f.api_name));
  return (
    <div className="screen">
      <TopBar title={title} sub={mod.singular} right={mod.can.edit && <Link className="icon-btn" to={`/m/${module}/${id}/edit`} aria-label="Edit" data-testid="edit"><Pencil size={20} /></Link>} />
      <StatusBars />
      <div className="body">
        <div className="card col">
          <div className="flex between wrap">
            <div className="strong" style={{ fontSize: 18 }}>{title}</div>
            <StatusTag value={status} />
          </div>
          {(row.account_name || row.city) && <div className="muted small">{[row.account_name, row.city].filter(Boolean).join(' · ')}</div>}
          {row.grand_total !== undefined && row.grand_total !== null && <div className="strong" style={{ fontSize: 20 }}>{money(row.grand_total)}</div>}
          {place && <div className="tiny faint flex"><MapPin size={12} /> Place saved{place.source === 'visit' ? ' from a visit' : ''}</div>}
        </div>
        {actions.length > 0 && <div className="tiles" data-testid="actions">{actions.map((a) => <Action key={a.testid} {...a} />)}</div>}

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

        <div className="card">
          <div className="card-title">Details</div>
          <dl className="kv" data-testid="details">
            {detail.map((f) => [<dt key={`${f.api_name}-k`}>{f.label}</dt>, <dd key={`${f.api_name}-v`}>{show(f, values[f.api_name], row)}</dd>])}
          </dl>
        </div>

        {visitable && visits.length > 0 && (
          <div>
            <div className="card-title" style={{ padding: '0 4px' }}>Visits</div>
            <div className="list">
              {visits.map((v) => (
                <div key={v.id} className="row">
                  <div className="main"><div className="title">{v.user_name} · {niceDate(v.in_at)}</div><div className="line">{niceTime(v.in_at)}{v.out_at ? `–${niceTime(v.out_at)}` : ''}{v.outcome ? ` · ${v.outcome}` : ''}{v.notes ? ` · ${v.notes}` : ''}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}
        {module === 'accounts' && <Related title="Contacts" module="contacts" rows={row.contacts} label={(r) => [r.first_name, r.last_name].filter(Boolean).join(' ')} sub={(r) => r.mobile || r.job_title} />}
        {['accounts', 'contacts'].includes(module) && <Related title="Deals" module="opportunities" rows={row.opportunities} label={(r) => r.opportunity_name} sub={(r) => money(r.amount)} />}
        {['accounts', 'contacts', 'opportunities'].includes(module) && <Related title="Orders / quotations" module="quotations" rows={row.quotations} label={(r) => r.quote_number} sub={(r) => `${money(r.grand_total)} · ${r.status || ''}`} />}
      </div>
      <BottomNav />
    </div>
  );
}

function Related({ title, module, rows, label, sub }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return (
    <div>
      <div className="card-title" style={{ padding: '0 4px' }}>{title}</div>
      <div className="list">
        {rows.slice(0, 10).map((r) => (
          <Link key={r.id} to={`/m/${module}/${r.id}`} className="row" style={{ color: 'inherit' }}>
            <div className="main"><div className="title">{label(r) || `#${r.id}`}</div><div className="line">{sub(r)}</div></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
