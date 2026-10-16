/*
 * Customers near me: on a map and in a list, nearest first.
 * (v1.5) Tap a pin or a customer: a sheet with what to do there and then —
 * Call, WhatsApp, Navigate, Check in, Task, Details — without opening the page.
 * Nobody near: a bigger circle in one tap, or the phone's location settings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigation, RefreshCw, MapPinOff, Phone, MessageCircle, MapPin, CheckSquare, ExternalLink, Settings2, Expand } from 'lucide-react';
import { useApp } from '../lib/app';
import { GET, qs } from '../lib/api';
import { here, navigateTo, openLocationSettings, openOutside, isNative } from '../lib/location';
import { distanceText, niceDate, phoneFor } from '../lib/format';
import { openWhatsApp } from '../lib/whatsapp';
import { TopBar, BottomNav, Loading, Empty, StatusBars, Sheet, StatusTag, Avatar } from '../components/ui';
import MapView from '../components/MapView';
import { colorOf } from '../components/icons';

const LABEL = { leads: 'Lead', contacts: 'Contact', accounts: 'Account' };
const RADII = [1, 3, 10, 25];

function CustomerSheet({ r, onClose }) {
  const nav = useNavigate();
  const { day, say, module: modOf } = useApp();
  const onDuty = !!(day && day.session);
  const name = encodeURIComponent(r.name);
  const go = (to) => { onClose(); nav(to); };
  const acts = [
    r.phone && { k: 'call', icon: Phone, label: 'Call', c: '#16A34A', run: () => (modOf('calls') && modOf('calls').can.create ? go(`/call/${r.module}/${r.id}?dial=1`) : openOutside(`tel:${phoneFor(r.phone)}`)) },
    r.phone && { k: 'wa', icon: MessageCircle, label: 'WhatsApp', c: '#16A34A', run: () => openWhatsApp(r.phone, '') },
    { k: 'nav', icon: Navigation, label: 'Navigate', c: '#2563EB', run: () => navigateTo(r.lat, r.lng) },
    { k: 'checkin', icon: MapPin, label: 'Check in', c: '#4F46E5', run: () => (onDuty ? go(`/visit/new?module=${r.module}&id=${r.id}&name=${name}`) : say('Punch in first (on Home).', 'error')) },
    modOf('tasks') && modOf('tasks').can.create && { k: 'task', icon: CheckSquare, label: 'Task', c: '#7C3AED', run: () => go(`/m/tasks/new?related_module=${r.module}&related_record_id=${r.id}&related_name=${name}`) },
    { k: 'details', icon: ExternalLink, label: 'Details', c: '#475569', run: () => go(`/m/${r.module}/${r.id}`) },
  ].filter(Boolean);
  return (
    <Sheet title="" onClose={onClose}>
      <div className="col" style={{ gap: 12 }} data-testid="near-sheet">
        <div className="flex" style={{ gap: 12, alignItems: 'flex-start' }}>
          <Avatar name={r.name} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong" style={{ fontSize: 17 }}>{r.name}</div>
            <div className="small muted">{[LABEL[r.module], r.sub].filter(Boolean).join(' · ')}</div>
            <div className="small brand-text">{distanceText(r.distance_m)} away</div>
          </div>
          {r.status && <StatusTag value={r.status} />}
        </div>
        {r.address && <div className="small muted flex" style={{ gap: 6, alignItems: 'flex-start' }}><MapPin size={14} style={{ flex: 'none', marginTop: 2 }} /> {r.address}</div>}
        <div className="tiny muted">{r.last_visit_at ? `Last visit: ${niceDate(r.last_visit_at)}` : 'Not visited yet'}</div>
        <div className="tiles near-acts" data-testid="near-actions">
          {acts.map((a) => (
            <button key={a.k} type="button" className="tile act" onClick={a.run} data-testid={`near-${a.k}`}>
              <span className="ic" style={{ background: `color-mix(in srgb, ${a.c} 13%, transparent)`, color: a.c }}><a.icon size={20} /></span><span className="act-label">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export default function Nearby() {
  const { boot } = useApp();
  const [radius, setRadius] = useState(3);
  const [me, setMe] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const load = useCallback(async () => {
    setError(''); setRows(null); setSel(null);
    try {
      const fix = await here({ timeout: 15000, good: 100 });
      setMe(fix);
      const x = await GET(`/sfa/nearby${qs({ lat: fix.lat, lng: fix.lng, radius_km: radius })}`);
      setRows(x.results || []);
    } catch (e) { setError(e.message); setRows([]); }
  }, [radius]);
  useEffect(() => { load(); }, [load]);
  const key = (r) => `${r.module}-${r.id}`;
  const pins = useMemo(() => (rows || []).map((r) => ({
    id: key(r), lat: r.lat, lng: r.lng, color: sel && key(sel) === key(r) ? '#111A3A' : colorOf(r.module), text: (r.name || '?').slice(0, 1).toUpperCase(),
    title: r.name, sub: `${LABEL[r.module]} · ${distanceText(r.distance_m)}${r.sub ? ` · ${r.sub}` : ''}`, openText: 'What to do', onClick: () => setSel(r),
  })), [rows, sel]);
  const bigger = RADII.find((k) => k > radius);
  if (!boot.sfa.enabled) return <div className="screen"><TopBar title="Nearby" back={false} /><Empty title="Field force is not switched on." /><BottomNav /></div>;
  return (
    <div className="screen">
      <TopBar title="Nearby customers" back={false} right={<button type="button" className="icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={20} /></button>} />
      <StatusBars />
      <div className="body">
        <div className="chips">{RADII.map((k) => <button key={k} type="button" className={`chip${radius === k ? ' on' : ''}`} onClick={() => setRadius(k)} data-testid={`near-r-${k}`}>{k} km</button>)}</div>
        <MapView me={me} pins={pins} fitKey={`${radius}|${rows ? rows.length : 0}`} testid="near-map" />
        {error && (
          <div className="note warn col" style={{ gap: 6 }} data-testid="near-error">
            <span>{error}</span>
            {isNative && <button type="button" className="btn outline small" style={{ alignSelf: 'flex-start' }} onClick={openLocationSettings}><Settings2 size={15} /> Check location settings</button>}
          </div>
        )}
        {!rows ? <Loading text="Finding where you are…" /> : !rows.length ? (!error && (
          <Empty icon={MapPinOff} title={`No customers within ${radius} km`}>
            <div className="small muted">Customers get a place at their first visit, or with "Customer is here" on their page.</div>
            {bigger && <button type="button" className="btn primary small" onClick={() => setRadius(bigger)} data-testid="near-bigger"><Expand size={15} /> Increase to {bigger} km</button>}
            {isNative && <button type="button" className="btn ghost small" onClick={openLocationSettings} data-testid="near-settings">Check location settings</button>}
          </Empty>
        )) : (
          <>
            <div className="tiny muted">{rows.length} nearby · nearest first</div>
            <div className="list map-list" data-testid="near-list">
              {rows.map((r) => (
                <div key={key(r)} className={`row${sel && key(sel) === key(r) ? ' sel-row' : ''}`} data-testid="near-row">
                  <span className="map-badge" style={{ '--c': colorOf(r.module) }}>{(r.name || '?').slice(0, 1).toUpperCase()}</span>
                  <button type="button" className="main" style={{ textAlign: 'left' }} onClick={() => setSel(r)} data-testid="near-open">
                    <div className="title">{r.name}</div>
                    <div className="line">{LABEL[r.module]}{r.sub ? ` · ${r.sub}` : ''}{r.last_visit_at ? ` · visited ${niceDate(r.last_visit_at)}` : ''}</div>
                  </button>
                  <span className="dist-pill">{distanceText(r.distance_m)}</span>
                  <button type="button" className="icon-btn" style={{ color: 'var(--brand)' }} aria-label="Directions" onClick={() => navigateTo(r.lat, r.lng)}><Navigation size={20} /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {sel && <CustomerSheet r={sel} onClose={() => setSel(null)} />}
      <BottomNav />
    </div>
  );
}
