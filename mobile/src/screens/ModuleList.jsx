/* A list of a module: search, filters (v1.4), whose (mine / a person / a team / a role), more pages, a + to add.
 * v1.7: the Leads list opens on ACTIVE leads (Converted, Dropped, Lost and Not Interested are hidden);
 * the chips Active · All leads · No follow-up change that. A search looks through all leads. */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Phone, Inbox, ScanLine } from 'lucide-react';
import { useApp } from '../lib/app';
import { GET, qs, absolute } from '../lib/api';
import { money, niceDate, niceTime, phoneFor, today, talk } from '../lib/format';
import { openOutside } from '../lib/location';
import { TopBar, BottomNav, StatusBars, Loading, Empty, StatusTag } from '../components/ui';
import { iconOf, colorOf } from '../components/icons';
import { get, set } from '../lib/store';
import { useFilterSpec, FilterButton, FilterChips, FilterSheet, EMPTY, countOf, asParam } from '../components/ListFilters';
import ViewingPicker, { useViewingOptions } from '../components/Viewing';

// (v1.7) what each row says, per module — a salesperson reads the row, not the record
const isoOf = (v) => { const s = String(v || ''); if (!s) return ''; return /[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? s : `${s.replace(' ', 'T')}Z`; };
const dayOf = (v) => String(v || '').slice(0, 10);
function groupOf(module, r) {
  const t = today(); const d = dayOf(r.date);
  if (module === 'meetings') return !d ? 'Past' : d === t ? 'Today' : d > t ? 'Upcoming' : 'Past';
  if (module === 'tasks') return /^(Completed|Done)$/i.test(r.status) ? 'Done' : !d ? 'No date' : d === t ? 'Today' : d < t ? 'Overdue' : 'Upcoming';
  return '';
}
function rowLines(module, r) {
  const m = r.more || {}; const t = today(); const d = dayOf(r.date);
  if (module === 'leads') {
    const a = [r.phone, m.city].filter(Boolean).join(' · ');
    const fu = !d ? { text: 'No follow-up planned', cls: 'warn-text' } : d < t ? { text: `Follow-up overdue · ${niceDate(d)}`, cls: 'bad-text' } : d === t ? { text: 'Follow-up today', cls: 'ok-text' } : { text: `Follow-up ${niceDate(d)}`, cls: 'muted' };
    return { title: r.title, lines: [{ text: a || r.sub }, { text: `${m.last_call ? `Last call ${niceDate(isoOf(m.last_call))}` : 'Never called'} · ${fu.text}`, cls: fu.cls }] };
  }
  if (module === 'calls') {
    const dir = String(m.direction || '').toLowerCase();
    const bits = [dir ? dir[0].toUpperCase() + dir.slice(1) : '', m.outcome || r.status, r.date ? `${niceDate(isoOf(r.date))} ${niceTime(isoOf(r.date))}` : '', Number(m.seconds) > 0 ? talk(m.seconds) : ''].filter(Boolean);
    return { title: m.who || r.sub || r.title, lines: [{ text: bits.join(' · ') }, ...(m.who && r.title && !/^(connected|not connected|missed|no answer|busy|call)\b/i.test(r.title) ? [{ text: r.title, cls: 'faint' }] : [])] };
  }
  if (module === 'meetings') {
    const when = r.date ? `${niceDate(isoOf(r.date))} ${niceTime(isoOf(r.date))}${m.end ? `–${niceTime(isoOf(m.end))}` : ''}` : '';
    return { title: r.title, lines: [{ text: [when, m.type, r.sub].filter(Boolean).join(' · ') }] };
  }
  if (module === 'tasks') {
    const done = /^(Completed|Done)$/i.test(r.status);
    const cls = !done && d && d < t ? 'bad-text' : !done && d === t ? 'ok-text' : '';
    return { title: r.title, lines: [{ text: [d ? (d < t && !done ? `Overdue · ${niceDate(d)}` : d === t ? 'Today' : niceDate(d)) : 'No date', r.sub].filter(Boolean).join(' · '), cls }] };
  }
  return { title: r.title, lines: [{ text: [r.sub, r.date ? niceDate(r.date) : ''].filter(Boolean).join(' · ') }] };
}

const remember = new Map();   // the search of each list while the app is open
// (v1.4) the filters and "whose" of each list are kept on the phone
const kept = (module) => ((get('list_filters') || {})[module]) || {};
const keep = (module, v) => set('list_filters', { ...(get('list_filters') || {}), [module]: v });

export default function ModuleList() {
  const { module } = useParams();
  const { module: modOf } = useApp();
  const nav = useNavigate();
  const mod = modOf(module);
  const mem = remember.get(module) || { q: '' };
  const [q, setQ] = useState(mem.q);
  const [view, setView] = useState(() => kept(module).view || 'all');
  const [filters, setFilters] = useState(() => kept(module).f || EMPTY);
  const [sheet, setSheet] = useState(false);
  const [scope, setScope] = useState('active');           // leads only: active | all | nofu
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
    GET(`/sfa/m/list/${module}${qs({ q, view: view === 'all' ? '' : view, f: fParam, page: p, page_size: 30,
      active: lead && !q && scope !== 'all' ? '1' : '', followup: lead && scope === 'nofu' ? 'none' : '' })}`)
      .then((x) => {
        if (ticket !== seq.current) return;
        setRows((old) => (p === 1 || !old ? x.rows : [...old, ...x.rows]));
        setTotal(x.total); setPage(p); setError('');
      })
      .catch((e) => { if (ticket === seq.current) { setError(e.message); if (p === 1) setRows([]); } })
      .finally(() => { if (ticket === seq.current) setMore(false); });
  }, [module, q, view, fParam, scope]);
  useEffect(() => {
    remember.set(module, { q });
    const t = setTimeout(() => load(1), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, module, q]);
  // another list opened in the same screen: its own filters
  useEffect(() => { const k = kept(module); setView(k.view || 'all'); setFilters(k.f || EMPTY); setQ((remember.get(module) || {}).q || ''); setScope('active'); }, [module]);
  const changeView = (v) => { setView(v); keep(module, { ...kept(module), view: v }); };
  const changeFilters = (f) => { setFilters(f); keep(module, { ...kept(module), f }); };

  if (!mod) return <div className="screen"><TopBar title="Not in the app" /><Empty title="Your role cannot open this." /><BottomNav /></div>;
  const Icon = iconOf(module);
  return (
    <div className="screen">
      <TopBar title={mod.plural} sub={rows ? `${total} ${module === 'leads' && scope !== 'all' && !q ? (scope === 'nofu' ? 'active, no follow-up' : 'active ') : ''}${total === 1 ? mod.singular.toLowerCase() : mod.plural.toLowerCase()}`.replace('  ', ' ') : ''}
        right={['leads', 'contacts', 'accounts'].includes(module) && mod.can.create ? <button type="button" className="icon-btn" aria-label="Scan a visiting card" onClick={() => nav('/scan-card')} data-testid="list-scan"><ScanLine size={21} /></button> : null} />
      <StatusBars />
      <div className="body">
        <div className="search"><Search size={18} /><input className="input" type="search" placeholder={`Search ${mod.plural.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="list-search" /></div>
        <div className="chips list-tools">
          {module !== 'products' && (opts && opts.can
            ? <ViewingPicker value={view} onChange={changeView} opts={opts} testid="list-view" />
            : (
              <>
                <button type="button" className={`chip${view !== 'me' ? ' on' : ''}`} onClick={() => changeView('all')}>All I can see</button>
                <button type="button" className={`chip${view === 'me' ? ' on' : ''}`} onClick={() => changeView('me')} data-testid="list-mine">Mine</button>
              </>
            ))}
          {spec && (spec.statuses.length > 0 || spec.fields.length > 0 || spec.date_label || spec.has_created) && <FilterButton count={countOf(filters)} onClick={() => setSheet(true)} />}
        </div>
        {module === 'leads' && (
          <div className="chips" data-testid="lead-scope">
            {[['active', 'Active'], ['nofu', 'No follow-up'], ['all', 'All leads']].map(([k, label]) => (
              <button key={k} type="button" className={`chip${scope === k ? ' on' : ''}`} onClick={() => setScope(k)} data-testid={`scope-${k}`}>{label}</button>
            ))}
          </div>
        )}
        {module === 'leads' && scope !== 'all' && !q && !(filters.status || []).length && (
          <div className="tiny muted" data-testid="scope-hint">
            {scope === 'nofu' ? 'Active leads with no follow-up planned.' : 'Showing active leads. Converted, Dropped, Lost and Not Interested are hidden.'} <button type="button" className="link-btn" onClick={() => setScope("all")} data-testid="scope-hint-all">Show all</button>
          </div>
        )}
        <FilterChips value={filters} spec={spec} onChange={changeFilters} />
        {sheet && <FilterSheet spec={spec} value={filters} onClose={() => setSheet(false)} onApply={(f) => { changeFilters(f); setSheet(false); }} />}
        {error && <div className="note bad">{error}</div>}
        {!rows ? <Loading /> : !rows.length ? (
          <Empty icon={Inbox} title={q || countOf(filters) || view !== 'all' ? 'Nothing found' : module === 'leads' && scope === 'nofu' ? 'Every active lead has a follow-up 👍' : `No ${mod.plural.toLowerCase()} yet`}>{countOf(filters) > 0 && <button type="button" className="btn ghost small" onClick={() => changeFilters(EMPTY)}>Clear the filters</button>}</Empty>
        ) : (
          <div className="list" data-testid="list">
            {rows.map((r, i) => {
              const g = groupOf(module, r); const showG = g && g !== groupOf(module, rows[i - 1] || {});
              const rl = rowLines(module, r);
              return (
              <Fragment key={r.id}>
              {showG && <div className="list-group" data-testid="list-group">{g}</div>}
              <div className="row" data-testid="list-row">
                {r.thumb_url ? <img className="thumb" src={absolute(r.thumb_url)} alt="" loading="lazy" />
                  : <span className="thumb" style={{ background: `${colorOf(module)}14`, color: colorOf(module) }}><Icon size={20} /></span>}
                <Link to={`/m/${module}/${r.id}`} className="main" style={{ color: 'inherit' }}>
                  <div className="title">{rl.title}</div>
                  {rl.lines.map((l, k) => <div key={k} className={`line ${l.cls || ''}`}>{l.text}</div>)}
                </Link>
                <div className="end col" style={{ gap: 4, alignItems: 'flex-end' }}>
                  {r.amount !== null && r.amount !== undefined && <span className="strong" style={{ color: 'var(--ink)' }}>{money(r.amount)}</span>}
                  <StatusTag value={r.status} />
                </div>
                {r.phone && <button type="button" className="icon-btn" aria-label="Call" onClick={() => (['leads', 'contacts', 'accounts', 'opportunities'].includes(module) && modOf('calls') && modOf('calls').can.create ? nav(`/call/${module}/${r.id}?dial=1`) : openOutside(`tel:${phoneFor(r.phone)}`))} style={{ color: 'var(--ok)' }}><Phone size={20} /></button>}
              </div>
              </Fragment>
              );
            })}
          </div>
        )}
        {rows && rows.length < total && (
          <button type="button" className="btn outline block" disabled={more} onClick={() => load(page + 1)} data-testid="list-more">{more ? 'Loading…' : `Show more (${total - rows.length})`}</button>
        )}
      </div>
      {mod.can.create && module !== 'products' && (
        <button type="button" className="fab" aria-label={`New ${mod.singular}`} onClick={() => nav(module === 'quotations' ? '/order/new' : `/m/${module}/new`)} data-testid="fab-new"><Plus size={26} /></button>
      )}
      <BottomNav />
    </div>
  );
}
