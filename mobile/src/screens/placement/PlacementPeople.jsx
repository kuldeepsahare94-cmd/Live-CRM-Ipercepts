/* Placement desk (app): every candidate, with a search and filters (newest first). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { GET, qs } from '../../lib/api';
import { P, cachedMeta } from '../../lib/placement';
import { TopBar, BottomNav, Loading, Empty, Avatar, StatusBars } from '../../components/ui';

export default function PlacementPeople() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('available');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const m = cachedMeta();
  const load = (offset = 0) => {
    const params = { q: q.trim(), limit: 30, offset };
    if (status === 'available') params.available = 1; else if (status !== 'all') params.status = status;
    return GET(P(`/candidates${qs(params)}`)).then((r) => { setRows((old) => (offset ? [...(old || []), ...r.rows] : r.rows)); setTotal(r.total); setError(''); })
      .catch((e) => setError(e.offline ? 'No internet.' : e.message));
  };
  useEffect(() => { setRows(null); const t = setTimeout(() => load(0), 250); return () => clearTimeout(t); }, [q, status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="screen" data-testid="pl-people">
      <TopBar title="Candidates" sub={rows ? `${total} found` : ''} right={<Link to="/placement/new" className="icon-btn" aria-label="Add a candidate"><UserPlus size={22} /></Link>} />
      <StatusBars />
      <div className="body">
        <input className="input" placeholder="Name, mobile, skill, company, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" data-testid="pp-search" />
        <div className="chips">
          {[['available', 'Available'], ['all', 'All'], ...['New', 'Screened', 'Active', 'Placed'].map((s) => [s, s])].map(([k, l]) => <button key={k} type="button" className={`chip${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        {error && <div className="note warn small">{error}</div>}
        {!rows && !error ? <Loading /> : (
          <div className="list">
            {(rows || []).map((c) => (
              <Link key={c.id} to={`/placement/c/${c.id}`} className="row" style={{ color: 'inherit' }} data-testid={`pp-${c.id}`}>
                <Avatar name={c.name} />
                <div className="main"><div className="title">{c.name}</div><div className="line">{[c.designation, c.current_company].filter(Boolean).join(' · ') || c.mobile}</div><div className="line">{c.total_exp ? `${c.total_exp} yrs` : ''}{c.expected_ctc ? ` · wants ${c.expected_ctc} L` : ''}{c.notice_period ? ` · ${c.notice_period}` : ''}</div></div>
                <span className="tag">{c.status}</span>
              </Link>
            ))}
            {rows && !rows.length && <Empty title="No candidate here">Change the search, or add the person.</Empty>}
          </div>
        )}
        {rows && rows.length < total && <button type="button" className="btn outline block" disabled={more} onClick={async () => { setMore(true); await load(rows.length); setMore(false); }}>Show more</button>}
      </div>
      <BottomNav />
    </div>
  );
}
