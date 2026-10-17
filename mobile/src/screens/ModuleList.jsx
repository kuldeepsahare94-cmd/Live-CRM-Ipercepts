/* A list of a module (v1.10 design): a search, a sort button and a filter button (the filters —
 * whose records, which leads, status, pick-lists, dates — wait in the filter panel), then one
 * compact card per record: who / what, its status, the phone with copy, a call button, a ⋮ menu,
 * and a strip with the two facts that matter for that module (last call · next follow-up, close
 * date · last activity, due date · owner…).
 * v1.7: the Leads list opens on ACTIVE leads (Converted, Dropped, Lost and Not Interested are hidden);
 * the panel's Active · No follow-up · All leads change that. A search looks through all leads. */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Search, Inbox, ScanLine, SlidersHorizontal, ArrowUpDown, Phone, MessageCircle, Mail, PhoneCall, CheckSquare, CalendarPlus,
  Pencil, Copy, ExternalLink, CalendarClock, Clock3, User, CalendarDays, Hourglass, Wallet, MapPin, Video,
} from 'lucide-react';
import { useApp } from '../lib/app';
import { GET, qs, absolute } from '../lib/api';
import { money, phoneFor, today, talk, niceDate } from '../lib/format';
import { openOutside } from '../lib/location';
import { openWhatsApp } from '../lib/whatsapp';
import { TopBar, BottomNav, StatusBars, Loading, Empty } from '../components/ui';
import { iconOf, colorOf, VISIT_MODULES } from '../components/icons';
import { get, set } from '../lib/store';
import { useFilterSpec, FilterChips, FilterSheet, EMPTY, countOf, asParam } from '../components/ListFilters';
import ViewingPicker, { useViewingOptions } from '../components/Viewing';
import { RecordCard, MenuSheet, SortSheet, followUpCell, lastCell, whenText, clock, dueState, DuePill, dayOf, copyText } from '../components/kit';

// what each row groups under (meetings and tasks)
function groupOf(module, r) {
  const t = today(); const d = dayOf(r.date);
  if (module === 'meetings') return !d ? 'Past' : d === t ? 'Today' : d > t ? 'Upcoming' : 'Past';
  if (module === 'tasks') return /^(Completed|Done)$/i.test(r.status) ? 'Done' : !d ? 'No date' : d === t ? 'Today' : d < t ? 'Overdue' : 'Upcoming';
  return '';
}
const DONE = /^(completed|done|closed|resolved|cancelled|canceled|paid|accepted|won)$/i;
const join = (...a) => a.filter(Boolean).join(' · ');

/** the card of one row, per module */
function cardOf(module, r, mod) {
  const m = r.more || {};
  const icon = iconOf(module); const iconColor = colorOf(module);
  const phoneLine = r.phone ? { text: r.phone, copy: r.phone } : null;
  switch (module) {
    case 'leads': return {
      title: r.title, badge: { value: r.status }, badges: /^hot$/i.test(m.rating || '') ? [{ value: 'Hot', tone: 'red' }] : [],
      lines: [phoneLine, { text: join(r.sub !== r.phone ? r.sub : '', m.city && m.city !== r.sub ? m.city : '', m.owner) }],
      cells: [lastCell('Last call', m.last_call, 'Never called'), followUpCell(m.next_fu || r.date)],
    };
    case 'contacts': return {
      title: r.title, badge: { value: r.status }, lines: [phoneLine, { text: join(m.job, r.sub) }],
      cells: [m.last_call ? lastCell('Last call', m.last_call) : lastCell('Last activity', m.last_activity, 'Nothing yet'), followUpCell(m.next_fu)],
    };
    case 'accounts': return {
      title: r.title, badge: { value: r.status }, lines: [{ text: join(m.city, m.industry, m.type) }, phoneLine],
      cells: [lastCell('Last activity', m.last_activity, 'Nothing yet'), followUpCell(m.next_fu)],
    };
    case 'opportunities': {
      const st = dueState(r.date, /won|lost/i.test(r.status || ''));
      return {
        title: r.title, badge: { value: r.status }, amount: r.amount !== null ? money(r.amount) : '', lines: [{ text: join(r.sub, m.owner) }],
        cells: [{ icon: CalendarDays, label: 'Close date', value: r.date ? whenText(r.date, { time: false }) : 'Not set', cls: st === 'overdue' ? 'is-red' : r.date ? '' : 'is-faint', pill: st === 'overdue' ? <DuePill state="overdue" /> : null },
          m.next_fu ? followUpCell(m.next_fu) : lastCell('Last activity', m.last_activity, 'Nothing yet')],
      };
    }
    case 'quotations': {
      const late = r.date && m.valid_until && dayOf(m.valid_until) < today() && !/accept|reject|convert/i.test(r.status || '');
      return {
        title: r.title, icon, iconColor, badge: { value: r.status }, amount: money(r.amount), lines: [{ text: join(r.sub, m.contact) }],
        cells: [{ icon: CalendarDays, label: 'Quote date', value: r.date ? whenText(r.date, { time: false }) : '-' },
          { icon: Hourglass, label: 'Valid until', value: m.valid_until ? whenText(m.valid_until, { time: false }) : 'Not set', cls: late ? 'is-red' : m.valid_until ? '' : 'is-faint', pill: late ? <span className="bdg bdg-red bdg-sm">Expired</span> : null }],
      };
    }
    case 'subscriptions': return {
      title: r.title, icon, iconColor, badge: { value: r.status }, amount: money(r.amount), lines: [{ text: join(r.sub, m.frequency) }],
      cells: [{ icon: CalendarClock, label: 'Renewal', value: r.date ? whenText(r.date, { time: false }) : 'Not set', cls: dueState(r.date) === 'overdue' ? 'is-red' : '', pill: r.date ? <DuePill state={dueState(r.date)} /> : null },
        { icon: User, label: 'Owner', value: m.owner || '-' }],
    };
    case 'meetings': return {
      title: r.title, icon: m.link || /online|video/i.test(m.type || '') ? Video : icon, iconColor, badge: { value: r.status },
      lines: [{ text: join(m.related, r.sub) }],
      cells: [{ icon: CalendarDays, label: 'When', value: r.date ? `${whenText(r.date)}${m.end ? ` – ${clock(m.end)}` : ''}` : 'Not set', cls: dueState(r.date) === 'today' ? 'is-green' : '' },
        { icon: User, label: m.type ? m.type : 'With', value: m.owner || '-' }],
    };
    case 'calls': {
      const ok = Number(m.connected) === 1;
      return {
        title: m.who || r.sub || r.title, icon: PhoneCall, iconColor: ok ? '#16A34A' : '#E11D48', badge: { value: m.outcome || r.status, tone: ok ? undefined : 'red' },
        lines: [{ text: join(m.direction, ok ? (Number(m.seconds) ? talk(m.seconds) : 'Connected') : 'Not connected', m.recording ? 'Recorded' : '') }],
        cells: [{ icon: Clock3, label: 'When', value: r.date ? whenText(r.date) : '-' }, { icon: User, label: 'By', value: m.owner || '-' }],
      };
    }
    case 'tasks': {
      const done = /^(Completed|Done)$/i.test(r.status || '');
      const st = dueState(r.date, done);
      return {
        title: r.title, icon, iconColor, badge: { value: r.status }, badges: m.priority && !/^(medium|normal|low)$/i.test(m.priority) ? [{ value: m.priority }] : [],
        lines: [{ text: join(m.related ? `For ${m.related}` : '', m.priority && /^(medium|normal|low)$/i.test(m.priority) ? `${m.priority} priority` : '') }],
        cells: [{ icon: CalendarClock, label: 'Due', value: r.date ? whenText(r.date, { time: false }) : 'No date', cls: st === 'overdue' ? 'is-red' : st === 'today' ? 'is-green' : r.date ? '' : 'is-faint', pill: <DuePill state={st} /> },
          { icon: User, label: 'Assigned to', value: m.owner || '-' }],
      };
    }
    case 'products': return {
      title: r.title, img: r.thumb_url ? absolute(r.thumb_url) : null, icon: r.thumb_url ? null : icon, iconColor, badge: { value: r.status },
      amount: r.amount !== null ? money(r.amount) : '', lines: [{ text: join(r.sub, r.tax_percent ? `${r.tax_percent}% tax` : '', r.unit ? `per ${r.unit}` : '') }],
    };
    case 'tickets': {
      const closed = DONE.test(r.status || '');
      const st = dueState(r.date, closed);
      return {
        title: r.title, icon, iconColor, badge: { value: r.status }, badges: m.priority && /critical|urgent|high/i.test(m.priority) ? [{ value: m.priority }] : [],
        lines: [{ text: join(m.number, r.sub) }],
        cells: [{ icon: CalendarClock, label: 'Resolution due', value: r.date ? whenText(r.date) : 'Not set', cls: st === 'overdue' ? 'is-red' : '', pill: closed ? null : <DuePill state={st} /> },
          { icon: User, label: 'Agent', value: m.owner || 'Unassigned', cls: m.owner ? '' : 'is-faint' }],
      };
    }
    case 'invoices': {
      const bal = Number(m.balance) || 0;
      const st = bal > 0 ? dueState(m.due) : 'none';
      return {
        title: r.title, icon, iconColor, badge: { value: r.status }, amount: money(r.amount), lines: [{ text: join(r.sub, m.owner) }],
        cells: [{ icon: CalendarDays, label: 'Invoice date', value: r.date ? whenText(r.date, { time: false }) : '-' },
          { icon: Wallet, label: bal > 0 ? `Due ${m.due ? niceDate(m.due) : ''}`.trim() : 'Balance', value: bal > 0 ? money(bal) : 'Paid', cls: st === 'overdue' ? 'is-red' : bal > 0 ? '' : 'is-green', pill: bal > 0 && st === 'overdue' ? <DuePill state="overdue" /> : null }],
      };
    }
    case 'payments': return {
      title: r.title, icon, iconColor, badge: { value: r.status }, amount: money(r.amount), lines: [{ text: join(r.sub, m.mode) }],
      cells: [{ icon: CalendarDays, label: 'Date', value: r.date ? whenText(r.date, { time: false }) : '-' }, ...(m.due ? [{ icon: CalendarClock, label: 'Due', value: whenText(m.due, { time: false }) }] : [])],
    };
    default: return { title: r.title, icon, iconColor, badge: { value: r.status }, amount: r.amount !== null && r.amount !== undefined ? money(r.amount) : '', lines: [{ text: join(r.sub, r.date ? whenText(r.date) : '') }] };
  }
}

const remember = new Map();   // the search of each list while the app is open
// the filters, "whose", sort and lead scope of each list are kept on the phone
const kept = (module) => ((get('list_filters') || {})[module]) || {};
const keep = (module, v) => set('list_filters', { ...(get('list_filters') || {}), [module]: v });

export default function ModuleList() {
  const { module } = useParams();
  const { module: modOf, say } = useApp();
  const nav = useNavigate();
  const mod = modOf(module);
  const mem = remember.get(module) || { q: '' };
  const [q, setQ] = useState(mem.q);
  const [view, setView] = useState(() => kept(module).view || 'all');
  const [filters, setFilters] = useState(() => kept(module).f || EMPTY);
  const [sort, setSort] = useState(() => kept(module).sort || 'default');
  const [sheet, setSheet] = useState('');              // '' | 'filter' | 'sort'
  const [menu, setMenu] = useState(null);              // the row whose ⋮ is open
  const [scope, setScope] = useState('active');        // leads only: active | all | nofu
  const spec = useFilterSpec(module);
  const opts = useViewingOptions();
  const fParam = asParam(filters);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback((p) => {
    const ticket = ++seq.current;
    if (p === 1) setRows(null);
    setMore(p > 1);
    const lead = module === 'leads';
    GET(`/sfa/m/list/${module}${qs({ q, view: view === 'all' ? '' : view, f: fParam, page: p, page_size: 30, sort: sort === 'default' ? '' : sort,
      active: lead && !q && scope !== 'all' ? '1' : '', followup: lead && scope === 'nofu' ? 'none' : '' })}`)
      .then((x) => {
        if (ticket !== seq.current) return;
        setRows((old) => (p === 1 || !old ? x.rows : [...old, ...x.rows]));
        setTotal(x.total); setPage(p); setError('');
      })
      .catch((e) => { if (ticket === seq.current) { setError(e.message); if (p === 1) setRows([]); } })
      .finally(() => { if (ticket === seq.current) setMore(false); });
  }, [module, q, view, fParam, scope, sort]);
  useEffect(() => {
    remember.set(module, { q });
    const t = setTimeout(() => load(1), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, module, q]);
  // another list opened in the same screen: its own filters
  useEffect(() => { const k = kept(module); setView(k.view || 'all'); setFilters(k.f || EMPTY); setSort(k.sort || 'default'); setQ((remember.get(module) || {}).q || ''); setScope('active'); }, [module]);
  const changeView = (v) => { setView(v); keep(module, { ...kept(module), view: v }); };
  const changeFilters = (f) => { setFilters(f); keep(module, { ...kept(module), f }); };
  const changeSort = (s) => { setSort(s); keep(module, { ...kept(module), sort: s }); setSheet(''); };

  if (!mod) return <div className="screen"><TopBar title="Not in the app" /><Empty title="Your role cannot open this." /><BottomNav /></div>;
  const lead = module === 'leads';
  const nFilters = countOf(filters) + (view !== 'all' ? 1 : 0) + (lead && scope !== 'active' ? 1 : 0);
  const canFilter = spec && (spec.statuses.length > 0 || spec.fields.length > 0 || spec.date_label || spec.has_created || (spec.view && spec.view.can) || module !== 'products');
  const sorts = (spec && spec.sorts) || [];
  const sortLabel = (sorts.find((s) => s.key === sort) || {}).label;
  const callable = VISIT_MODULES.includes(module) && modOf('calls') && modOf('calls').can.create;
  const callRow = (r) => (callable ? nav(`/call/${module}/${r.id}?dial=1`) : openOutside(`tel:${phoneFor(r.phone)}`));
  const relQs = (r) => `related_module=${module}&related_record_id=${r.id}&related_name=${encodeURIComponent(r.title)}`;
  const menuItems = (r) => {
    const m = r.more || {};
    const can = (x, a = 'create') => !!(modOf(x) && modOf(x).can[a]);
    const own = !['calls', 'meetings', 'tasks', 'products', 'invoices', 'payments'].includes(module);
    return [
      { key: 'open', icon: ExternalLink, label: `Open ${mod.singular.toLowerCase()}`, to: `/m/${module}/${r.id}` },
      r.phone && { key: 'call', icon: Phone, label: 'Call', color: '#16A34A', onClick: () => callRow(r) },
      r.phone && { key: 'wa', icon: MessageCircle, label: 'WhatsApp', color: '#16A34A', onClick: () => openWhatsApp(r.phone, '') },
      m.email && { key: 'mail', icon: Mail, label: 'E-mail', color: '#0284C7', onClick: () => openOutside(`mailto:${m.email}`) },
      callable && { key: 'log', icon: PhoneCall, label: 'Log a call', color: '#EA580C', to: `/call/${module}/${r.id}` },
      own && can('tasks') && { key: 'task', icon: CheckSquare, label: 'Add a task', color: '#7C3AED', to: `/m/tasks/new?${relQs(r)}` },
      own && can('meetings') && { key: 'meeting', icon: CalendarPlus, label: 'Plan a meeting', color: '#E11D48', to: `/m/meetings/new?${relQs(r)}` },
      r.place && { key: 'map', icon: MapPin, label: 'Go there', color: '#2563EB', onClick: () => openOutside(`https://www.google.com/maps/dir/?api=1&destination=${r.place.lat},${r.place.lng}`) },
      mod.can.edit && { key: 'edit', icon: Pencil, label: 'Edit', color: '#475569', to: `/m/${module}/${r.id}/edit` },
      r.phone && { key: 'copy', icon: Copy, label: 'Copy the number', color: '#475569', onClick: () => copyText(r.phone, say) },
    ].filter(Boolean);
  };
  const countText = rows ? `${total} ${lead && scope !== 'all' && !q ? (scope === 'nofu' ? 'active, no follow-up ' : 'active ') : ''}${total === 1 ? mod.singular.toLowerCase() : mod.plural.toLowerCase()}` : '';

  return (
    <div className="screen">
      <TopBar title={mod.plural} sub={countText}
        right={['leads', 'contacts', 'accounts'].includes(module) && mod.can.create ? <button type="button" className="icon-btn" aria-label="Scan a visiting card" onClick={() => nav('/scan-card')} data-testid="list-scan"><ScanLine size={22} /></button> : null} />
      <StatusBars />
      <div className="body">
        <div className="lhead">
          <div className="search"><Search size={18} /><input className="input" type="search" placeholder={`Search ${mod.plural.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="list-search" /></div>
          {sorts.length > 1 && <button type="button" className={`sq-btn${sort !== 'default' ? ' on' : ''}`} aria-label="Sort" onClick={() => setSheet('sort')} data-testid="sort-open"><ArrowUpDown size={20} /></button>}
          {canFilter && (
            <button type="button" className={`sq-btn${nFilters ? ' on' : ''}`} aria-label="Filter" onClick={() => setSheet('filter')} data-testid="filter-open">
              <SlidersHorizontal size={20} />{nFilters > 0 && <span className="sq-n" data-testid="filter-count">{nFilters}</span>}
            </button>
          )}
        </div>
        {(lead && scope !== 'all' && !q && !(filters.status || []).length) || sort !== 'default' ? (
          <div className="lmeta" data-testid="scope-hint">
            <span>{lead && scope !== 'all' && !q && !(filters.status || []).length ? (scope === 'nofu' ? 'Active leads with no follow-up planned' : 'Active leads only (closed ones hidden)') : ''}{sort !== 'default' ? ` Sorted: ${sortLabel || sort}` : ''}</span>
            {lead && scope !== 'all' && !q && !(filters.status || []).length && <button type="button" onClick={() => setScope('all')} data-testid="scope-hint-all">Show all</button>}
          </div>
        ) : null}
        {view !== 'all' && (
          <div className="chips"><button type="button" className="chip on filter-chip" onClick={() => changeView('all')} data-testid="view-chip">{view === 'me' ? 'Mine' : 'Chosen people'} ✕</button></div>
        )}
        <FilterChips value={filters} spec={spec} onChange={changeFilters} />
        {sheet === 'filter' && (
          <FilterSheet spec={spec} value={filters} onClose={() => setSheet('')} onApply={(f) => { changeFilters(f); setSheet(''); }}
            top={(
              <>
                {module !== 'products' && (
                  <div className="col" style={{ gap: 6 }}>
                    <div className="card-title" style={{ margin: 0 }}>Whose</div>
                    <div className="chips list-tools">
                      {opts && opts.can
                        ? <ViewingPicker value={view} onChange={changeView} opts={opts} testid="list-view" />
                        : (
                          <>
                            <button type="button" className={`chip${view !== 'me' ? ' on' : ''}`} onClick={() => changeView('all')}>All I can see</button>
                            <button type="button" className={`chip${view === 'me' ? ' on' : ''}`} onClick={() => changeView('me')} data-testid="list-mine">Mine</button>
                          </>
                        )}
                    </div>
                  </div>
                )}
                {lead && (
                  <div className="col" style={{ gap: 6 }}>
                    <div className="card-title" style={{ margin: 0 }}>Which leads</div>
                    <div className="chips" data-testid="lead-scope">
                      {[['active', 'Active'], ['nofu', 'No follow-up'], ['all', 'All leads']].map(([k, label]) => (
                        <button key={k} type="button" className={`chip${scope === k ? ' on' : ''}`} onClick={() => setScope(k)} data-testid={`scope-${k}`}>{label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )} />
        )}
        {sheet === 'sort' && <SortSheet sorts={sorts} value={sort} onPick={changeSort} onClose={() => setSheet('')} />}
        {error && <div className="note bad">{error}</div>}
        {!rows ? <Loading /> : !rows.length ? (
          <Empty icon={Inbox} title={q || countOf(filters) || view !== 'all' ? 'Nothing found' : lead && scope === 'nofu' ? 'Every active lead has a follow-up 👍' : `No ${mod.plural.toLowerCase()} yet`}>{countOf(filters) > 0 && <button type="button" className="btn ghost small" onClick={() => changeFilters(EMPTY)}>Clear the filters</button>}</Empty>
        ) : (
          <div className="rcs" data-testid="list">
            {rows.map((r, i) => {
              const g = sort === 'default' ? groupOf(module, r) : '';
              const showG = g && g !== groupOf(module, rows[i - 1] || {});
              const c = cardOf(module, r, mod);
              return (
                <Fragment key={r.id}>
                  {showG && <div className="list-group" data-testid="list-group">{g}</div>}
                  <RecordCard to={`/m/${module}/${r.id}`} {...c}
                    onCall={r.phone && module !== 'products' ? () => callRow(r) : null}
                    onMenu={() => setMenu(r)} onCopy={(t) => copyText(t, say)} />
                </Fragment>
              );
            })}
          </div>
        )}
        {rows && rows.length < total && (
          <button type="button" className="btn outline block" disabled={more} onClick={() => load(page + 1)} data-testid="list-more">{more ? 'Loading…' : `Show more (${total - rows.length})`}</button>
        )}
      </div>
      {menu && <MenuSheet title={menu.title} items={menuItems(menu)} onClose={() => setMenu(null)} />}
      {mod.can.create && module !== 'products' && (
        <button type="button" className="fab" aria-label={`New ${mod.singular}`} onClick={() => nav(module === 'quotations' ? '/order/new' : `/m/${module}/new`)} data-testid="fab-new"><Plus size={26} /></button>
      )}
      <BottomNav />
    </div>
  );
}
