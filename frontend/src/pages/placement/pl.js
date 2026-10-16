/*
 * Placement desk: what the screens share.
 *
 *   usePlacementMeta()   is it on for me, the stage list, the reasons, who I am
 *   pl.get / post ...    the server links (everything is under /api/placement)
 *   inr / lakh / dates   how money and dates are written
 *   useAsync(fn, deps)   load something, with a loading and an error state
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';

const qs = (p) => {
  const e = Object.entries(p || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  return e.length ? `?${e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? 1 : v)}`).join('&')}` : '';
};
export const pl = {
  get: (path, params) => api.placement('GET', path + qs(params)),
  post: (path, body) => api.placement('POST', path, body || {}),
  put: (path, body) => api.placement('PUT', path, body || {}),
  del: (path) => api.placement('DELETE', path),
};

// ---- the start-up answer, asked once per sign-in and shared by every screen
let meta = null; let owner = null; let loading = null;
const listeners = new Set();
const token = () => localStorage.getItem('cd_token') || '';
export function loadPlacementMeta(force = false) {
  const me = token();
  if (!me) { meta = null; owner = null; return Promise.resolve(null); }
  if (owner !== me) { meta = null; loading = null; owner = me; }
  if (meta && !meta.failed && !force) return Promise.resolve(meta);
  if (loading) return force ? loading.then(() => loadPlacementMeta(true)) : loading;
  const mine = pl.get('/meta')
    .then((m) => { if (owner === me) { meta = m; listeners.forEach((fn) => fn(m)); } return m; })
    .catch(() => { if (owner === me && (!meta || meta.failed)) { meta = { available: false, failed: true }; listeners.forEach((fn) => fn(meta)); } return meta; })
    .finally(() => { if (loading === mine) loading = null; });
  loading = mine;
  return mine;
}
if (typeof window !== 'undefined') window.addEventListener('icrm:placement-settings', () => { loadPlacementMeta(true); });
export function usePlacementMeta() {
  const [m, setM] = useState(owner === token() ? meta : null);
  useEffect(() => {
    listeners.add(setM);
    loadPlacementMeta().then((x) => setM(x));
    return () => { listeners.delete(setM); };
  }, []);
  return m;
}
export const placementSettingsChanged = () => window.dispatchEvent(new CustomEvent('icrm:placement-settings'));
/** Something was saved: open lists and the dashboard may reload. */
export const placementChanged = () => window.dispatchEvent(new CustomEvent('icrm:placement-changed'));
export function usePlacementChanged(fn) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const on = () => latest.current();
    window.addEventListener('icrm:placement-changed', on);
    return () => window.removeEventListener('icrm:placement-changed', on);
  }, []);
}

/** Load something; `reload()` loads it again (also when something was saved elsewhere). */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    Promise.resolve().then(fn)
      .then((data) => { if (mine === seq.current) setState({ data, error: '', loading: false }); })
      .catch((e) => { if (mine === seq.current) setState((s) => ({ data: s.data, error: e.message || 'Could not load.', loading: false })); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  usePlacementChanged(run);
  return { ...state, reload: run };
}

// ---- how things are written
export const inr = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};
/** 1.2 crore / 54.3 lakh / 85,000 — for fees and billing. */
export const inrShort = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2).replace(/\.?0+$/, '')} L`;
  return inr(v);
};
export const lakh = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '—' : `${Number(n)} L`);
export const years = (n) => (n === null || n === undefined || n === '' ? '—' : `${Number(n)} yrs`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function niceDate(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] === String(new Date().getFullYear()) ? '' : ` ${m[1]}`}` : String(iso);
}
export function niceTime(iso) {
  const m = /[ T](\d{2}):(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
export const niceWhen = (iso) => `${niceDate(iso)}${niceTime(iso) ? `, ${niceTime(iso)}` : ''}`;
export const monthName = (ym) => { const m = /^(\d{4})-(\d{2})$/.exec(ym || ''); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ym; };
export function dayLabel(iso, today) {
  const d = String(iso || '').slice(0, 10);
  if (!d || !today) return niceDate(iso);
  const diff = Math.round((new Date(`${d}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return niceDate(iso);
}
/** the CRM's idea of today and now, as the strings the server uses */
export const todayStr = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const toLocalInput = (s) => String(s || '').replace(' ', 'T').slice(0, 16);

export const STAGE_TONE = {
  Sourced: 'neutral', Screened: 'info', Submitted: 'special', 'Interview L1': 'attention', 'Interview L2': 'attention', 'Final round': 'warning',
  Offered: 'warning', 'Offer accepted': 'success', Joined: 'success', 'On hold': 'neutral', Rejected: 'danger',
};
export const STAGE_HEX = {
  Sourced: '#94A3B8', Screened: '#3B82F6', Submitted: '#8B5CF6', 'Interview L1': '#F97316', 'Interview L2': '#EA580C', 'Final round': '#F59E0B',
  Offered: '#D97706', 'Offer accepted': '#10B981', Joined: '#059669', 'On hold': '#94A3B8', Rejected: '#F43F5E',
};
