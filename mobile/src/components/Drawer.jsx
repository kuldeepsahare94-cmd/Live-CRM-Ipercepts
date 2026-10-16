/*
 * The menu (v1.4): every module of this CRM and every part of the app, in a
 * drawer that slides in from the left — so Home keeps its space for today's
 * work. Opened with the ☰ button.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { BellRing, PhoneForwarded, Menu, X, MessagesSquare, ClipboardList, Route, CalendarOff, ReceiptText, CheckCheck, Map as MapIcon, MapPin, PhoneCall, Settings, MoreHorizontal, ScanLine, LayoutDashboard } from 'lucide-react';
import { useApp } from '../lib/app';
import { get } from '../lib/store';
import { canReadPhone } from '../lib/calls';
import { iconOf, colorOf } from './icons';
import { Avatar } from './ui';

function Item({ to, icon: Icon, color = 'var(--brand)', label, badge, testid, onGo }) {
  return (
    <Link to={to} className="drawer-item" onClick={onGo} data-testid={testid}>
      <span className="ic" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}><Icon size={18} /></span>
      <span className="grow">{label}</span>
      {badge > 0 && <span className="seg-n bad-n">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
}

export function Drawer({ onClose }) {
  const { boot, unread } = useApp();
  const loc = useLocation();
  const first = useState(loc.pathname)[0];
  // (a tap on an item goes there: the drawer closes by itself)
  useEffect(() => { if (loc.pathname !== first) onClose(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const sfa = boot.sfa && boot.sfa.enabled;
  const has = (api, a = 'view') => boot.modules.some((m) => m.api_name === api && m.can[a]);
  const work = [
    // (v1.5) the day's to-do list, and calling a list one by one
    { to: '/follow-ups', icon: BellRing, color: '#EA580C', label: 'Follow-ups', testid: 'menu-followups' },
    has('calls', 'create') && { to: '/dialer', icon: PhoneForwarded, color: '#16A34A', label: 'Auto dialer', testid: 'menu-dialer' },
    boot.chat && boot.chat.view && { to: '/chat', icon: MessagesSquare, color: '#7C3AED', label: 'Chat', badge: unread, testid: 'menu-chat' },
    (boot.me.view_others || boot.me.is_manager) && { to: '/team', icon: sfa ? MapIcon : LayoutDashboard, color: '#0EA5E9', label: 'My team', testid: 'menu-team' },
    sfa && boot.sfa.plan_on && { to: '/plans', icon: ClipboardList, color: '#4F46E5', label: 'My plan', testid: 'menu-plans' },
    sfa && boot.sfa.plan_on && { to: '/route', icon: Route, color: '#0891B2', label: "Today's route", testid: 'menu-route' },
    sfa && { to: '/nearby', icon: MapPin, color: '#16A34A', label: 'Nearby', testid: 'menu-nearby' },
    sfa && (boot.sfa.plan_on || boot.sfa.leave_on) && boot.me.is_manager && { to: '/approvals', icon: CheckCheck, color: '#D97706', label: 'Approvals', testid: 'menu-approvals' },
    sfa && boot.sfa.leave_on && { to: '/leave', icon: CalendarOff, color: '#DB2777', label: 'My leave', testid: 'menu-leave' },
    boot.expenses && { to: '/expenses', icon: ReceiptText, color: '#0D9488', label: 'Expenses', testid: 'menu-expenses' },
    canReadPhone() && boot.calls && boot.calls.enabled && { to: '/calls/phone', icon: PhoneCall, color: '#EA580C', label: 'Phone calls', testid: 'menu-phone-calls' },
    ['leads', 'contacts', 'accounts'].some((m) => has(m, 'create')) && { to: '/scan-card', icon: ScanLine, color: '#7C3AED', label: 'Scan a card', testid: 'menu-scan' },
  ].filter(Boolean);
  return createPortal(
    <div className="drawer-back" onClick={onClose} role="dialog" aria-label="Menu" data-testid="drawer">
      <nav className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <Avatar name={boot.me.name} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong ellipsis">{boot.me.name}</div>
            <div className="tiny ellipsis" style={{ opacity: 0.85 }}>{[boot.me.role, boot.name || get('company')].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" className="icon-btn" style={{ color: '#fff' }} onClick={onClose} aria-label="Close the menu" data-testid="drawer-close"><X size={22} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-title">Your CRM</div>
          <div data-testid="modules">
            {boot.modules.map((m) => <Item key={m.api_name} to={`/m/${m.api_name}`} icon={iconOf(m.api_name)} color={colorOf(m.api_name)} label={m.plural} testid={`mod-${m.api_name}`} onGo={onClose} />)}
          </div>
          {work.length > 0 && <div className="drawer-title">Work</div>}
          {work.map((w) => <Item key={w.to} {...w} onGo={onClose} />)}
          <div className="drawer-title">App</div>
          <Item to="/settings" icon={Settings} color="#475569" label="Settings" testid="menu-settings" onGo={onClose} />
          <Item to="/more" icon={MoreHorizontal} color="#475569" label="More (sending, sign out)" testid="menu-more" onGo={onClose} />
        </div>
      </nav>
    </div>,
    document.body,
  );
}

/** the ☰ button that opens the menu (with the unread chats on it) */
export default function MenuButton({ light = false }) {
  const { unread } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`icon-btn menu-btn${light ? ' light' : ''}`} onClick={() => setOpen(true)} aria-label="Menu" data-testid="menu">
        <Menu size={22} />{unread > 0 && <span className="menu-dot" />}
      </button>
      {open && <Drawer onClose={() => setOpen(false)} />}
    </>
  );
}
