/*
 * Placement desk (recruitment consultancy) — /placement
 *
 *   Dashboard · Job openings · Candidates · Pipeline board · Interviews ·
 *   Offers & joinings · Clients · Deployed resources · Timesheets · Invoices
 *
 * A self-contained section: the server side is routes/placement.js and
 * services/placement/*, the tables start with pl_. It is switched on per
 * customer in Settings → Placement, and the Roles page decides who sees it.
 */
import { lazy, Suspense } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Briefcase, Settings as SettingsIcon } from 'lucide-react';
import { PageHeader, EmptyState } from '../../components/ui';
import { usePlacementMeta, loadPlacementMeta } from './pl';
import { Loading } from './ui';

const Dashboard = lazy(() => import('./Dashboard'));
const Jobs = lazy(() => import('./Jobs'));
const JobDetail = lazy(() => import('./JobDetail'));
const Candidates = lazy(() => import('./Candidates'));
const CandidateDetail = lazy(() => import('./CandidateDetail'));
const Board = lazy(() => import('./Board'));
const Interviews = lazy(() => import('./Interviews'));
const Offers = lazy(() => import('./Offers'));
const Clients = lazy(() => import('./Clients'));
const Deployed = lazy(() => import('./Deployed'));
const Timesheets = lazy(() => import('./Timesheets'));
const Invoices = lazy(() => import('./Invoices'));

export const PLACEMENT_TABS = [
  ['/placement', 'Dashboard', true],
  ['/placement/jobs', 'Job openings'],
  ['/placement/candidates', 'Candidates'],
  ['/placement/board', 'Pipeline board'],
  ['/placement/interviews', 'Interviews'],
  ['/placement/offers', 'Offers & joinings'],
  ['/placement/clients', 'Clients'],
  ['/placement/deployed', 'Deployed'],
  ['/placement/timesheets', 'Timesheets'],
  ['/placement/invoices', 'Invoices'],
];

export default function Placement() {
  const meta = usePlacementMeta();
  if (!meta) return <Loading />;
  if (meta.failed) {
    return (
      <div className="max-w-xl mx-auto mt-10">
        <EmptyState icon={Briefcase} title="The Placement desk could not be loaded" description="Check your connection and try again.">
          <button type="button" className="btn btn-primary" onClick={() => loadPlacementMeta(true)}>Try again</button>
        </EmptyState>
      </div>
    );
  }
  if (!meta.available) {
    return (
      <div className="max-w-xl mx-auto mt-10">
        <EmptyState icon={Briefcase} title="The Placement desk is not switched on"
          description="Ask your administrator to switch it on, or to give your role the Placement desk permission.">
          <Link to="/" className="btn btn-secondary">Back to the dashboard</Link>
        </EmptyState>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Placement desk" subtitle="Openings, candidates, interviews, offers and billing — for permanent hiring and contract staffing" icon={Briefcase} accent="opportunities">
        {meta.is_admin && (
          <Link to="/settings/placement" className="btn btn-secondary" title="Switch, fee and guarantee defaults, demo data"><SettingsIcon className="w-4 h-4" /> Settings</Link>
        )}
      </PageHeader>
      {meta.admin_only && (
        <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning-strong)' }} data-testid="pl-off-banner">
          The Placement desk is switched off. Only administrators see it until it is switched on in <Link to="/settings/placement" className="underline font-medium">Settings → Placement</Link>.
        </div>
      )}
      <nav className="flex gap-1 overflow-x-auto thin-scroll mb-5 pb-1" aria-label="Placement sections" style={{ borderBottom: '1px solid var(--color-line)' }}>
        {PLACEMENT_TABS.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={!!end} data-testid={`pl-tab-${to.split('/').pop() || 'dashboard'}`}
            className="px-3 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg -mb-px"
            style={({ isActive }) => (isActive
              ? { color: 'var(--color-brand)', borderBottom: '2px solid var(--color-brand)' }
              : { color: 'var(--color-muted)', borderBottom: '2px solid transparent' })}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="candidates" element={<Candidates />} />
          <Route path="candidates/:id" element={<CandidateDetail />} />
          <Route path="board" element={<Board />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="offers" element={<Offers />} />
          <Route path="clients" element={<Clients />} />
          <Route path="deployed" element={<Deployed />} />
          <Route path="timesheets" element={<Timesheets />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="*" element={<EmptyState icon={Briefcase} title="This page does not exist" />} />
        </Routes>
      </Suspense>
    </div>
  );
}
