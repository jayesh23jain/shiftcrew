import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { StatusChip } from './ui.jsx';
import { CATEGORIES } from '../lib.js';
import AssistantDrawer from './AssistantDrawer.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const isOrganizer = user?.role === 'organizer' || user?.role === 'admin';

  // Check if current route is managing a specific event
  const eventManageMatch = location.pathname.match(/^\/manage\/events\/([a-f\d]{24})/i);
  const manageEventId = eventManageMatch ? eventManageMatch[1] : null;
  const isManageEventRoute = Boolean(manageEventId);
  const currentTab = searchParams.get('tab') || 'overview';

  const { data: managedEventData } = useQuery({
    queryKey: ['event', manageEventId],
    queryFn: async () => (await api.get(`/events/${manageEventId}`)).data,
    enabled: !!manageEventId && !!user,
  });
  const managedEvent = managedEventData?.event;

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data.unread,
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const { data: leadShifts } = useQuery({
    queryKey: ['lead-shifts'],
    queryFn: async () => (await api.get('/attendance/lead/shifts')).data.shifts,
    enabled: !!user,
    refetchInterval: 120_000,
  });
  const { data: orgEventsData } = useQuery({
    queryKey: ['events', 'mine'],
    queryFn: async () => (await api.get('/events/mine')).data,
    enabled: !!user && isOrganizer,
  });
  const firstEventId = orgEventsData?.events?.[0]?._id;

  const { data: openSwapsData } = useQuery({
    queryKey: ['swaps', 'open-count'],
    queryFn: async () => (await api.get('/swaps')).data,
    enabled: !!user && !isOrganizer,
    refetchInterval: 30_000,
  });
  const openSwapsCount = openSwapsData?.swaps?.length || 0;

  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => (await api.get('/ai/status')).data,
    enabled: !!user,
    staleTime: 60_000,
  });

  const onLogout = async () => {
    await logout();
    navigate('/');
  };

  if (['/', '/login', '/register'].includes(location.pathname)) {
    return <Outlet />;
  }

  return (
    <div className="layout-root">
      {/* Top Navbar: Spans full width, completely hiding handprints from the top */}
      <header className="glass-topbar">
        <div className="topbar-inner">
          <div className="topbar-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {user && (
              <button
                className="mobile-toggle-btn"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle navigation menu"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  {mobileMenuOpen ? (
                    <>
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </>
                  ) : (
                    <>
                      <line x1="3" y1="12" x2="21" y2="12"></line>
                      <line x1="3" y1="6" x2="21" y2="6"></line>
                      <line x1="3" y1="18" x2="21" y2="18"></line>
                    </>
                  )}
                </svg>
              </button>
            )}

            {/* Themed Brand Logo in Top Navbar */}
            <Link to="/" className="brand-logo">
              <span className="brand-badge-theme" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 12C4.67 12 4 12.67 4 13.5C4 14.33 4.67 15 5.5 15C6.33 15 7 14.33 7 13.5C7 12.67 6.33 12 5.5 12Z" fill="#ffffff" />
                  <path d="M8.5 4.5C7.67 4.5 7 5.17 7 6V11C7 11.83 7.67 12.5 8.5 12.5C9.33 12.5 10 11.83 10 11V6C10 5.17 9.33 4.5 8.5 4.5Z" fill="#ffffff" />
                  <path d="M12 3C11.17 3 10.5 3.67 10.5 4.5V10.5C10.5 11.33 11.17 12 12 12C12.83 12 13.5 11.33 13.5 10.5V4.5C13.5 3.67 12.83 3 12 3Z" fill="#ffffff" />
                  <path d="M15.5 4.5C14.67 4.5 14 5.17 14 6V11C14 11.83 14.67 12.5 15.5 12.5C16.33 12.5 17 11.83 17 11V6C17 5.17 16.33 4.5 15.5 4.5Z" fill="#ffffff" />
                  <path d="M19 7.5C18.17 7.5 17.5 8.17 17.5 9V12C17.5 12.83 18.17 13.5 19 13.5C19.83 13.5 20.5 12.83 20.5 12V9C20.5 8.17 19.83 7.5 19 7.5Z" fill="#ffffff" />
                  <path d="M7 14C7 18.2 9.8 21 13 21C16.2 21 19 18.2 19 14.5C19 13.8 18.6 13 18 13H8C7.4 13 7 13.8 7 14Z" fill="#ffffff" />
                </svg>
              </span>
              <div className="brand-text-block">
                <span className="brand-text">ShiftCrew</span>
                <span className="brand-badge-pill">VOLUNTEER CONNECT</span>
              </div>
            </Link>
          </div>

          <div className="topbar-actions">
            {user ? (
              <>
                {/* Organizer Topbar Action Buttons */}
                {isOrganizer && (
                  <div className="topbar-organizer-actions">
                    {firstEventId && (
                      <Link
                        className="topbar-bento-btn topbar-btn-secondary"
                        to={`/manage/events/${firstEventId}`}
                        style={{ background: '#fef08a', color: '#854d0e', borderColor: '#0f172a', fontWeight: 900 }}
                        title="Open Operational Dashboard"
                      >
                        ⚡ Operations Dashboard
                      </Link>
                    )}
                    <Link className="topbar-bento-btn topbar-btn-secondary" to="/events">
                      Your Events
                    </Link>
                    <Link className="topbar-bento-btn topbar-btn-primary" to="/manage/events/new">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      <span>Create Event</span>
                    </Link>
                  </div>
                )}

                {/* Global Swap Board Button in Top Navbar (volunteers only) */}
                {!isOrganizer && (
                  <NavLink
                    to="/swap-board"
                    className={({ isActive }) => `topbar-bento-btn topbar-swap-btn ${isActive ? 'active' : ''}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
                      border: '1.5px solid #ea580c',
                      color: '#c2410c',
                      fontWeight: 800,
                      padding: '0.42rem 0.85rem',
                      borderRadius: '10px',
                      textDecoration: 'none',
                      fontSize: '0.84rem',
                      boxShadow: '2px 2px 0px rgba(0,0,0,0.85)',
                      transition: 'all 0.15s ease',
                    }}
                    title="Browse Open Shift Swaps across events"
                  >
                    <span style={{ fontSize: '0.95rem' }}>🔄</span>
                    <span>Swap Board</span>
                    {openSwapsCount > 0 && (
                      <span
                        style={{
                          background: '#ea580c',
                          color: '#ffffff',
                          borderRadius: '10px',
                          padding: '0.1rem 0.45rem',
                          fontSize: '0.72rem',
                          fontWeight: 900,
                          marginLeft: '0.2rem',
                        }}
                      >
                        {openSwapsCount}
                      </span>
                    )}
                  </NavLink>
                )}

                {/* Volunteer Hours Pill (volunteers only) */}
                {!isOrganizer && (
                  <div className="topbar-hours-pill" title="Volunteer hours completed">
                    <span className="hours-avatar-circle">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </span>
                    <span className="hours-pill-text">
                      <span className="hours-tag">HOURS:</span>
                      <strong className="hours-val">6</strong>
                    </span>
                  </div>
                )}

                {/* Assistant Trigger in Topbar */}
                {user && (
                  <button
                    type="button"
                    onClick={() => setAssistantOpen(true)}
                    className="btn btn-white"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.42rem 0.85rem',
                      fontSize: '0.8rem',
                      fontWeight: 900,
                      borderRadius: '999px',
                      border: '2px solid #0f172a',
                      background: '#ffffff',
                      color: '#0f172a',
                      boxShadow: '2px 2px 0 #0f172a',
                      cursor: 'pointer',
                      marginRight: '0.15rem',
                    }}
                    title="Ask ShiftCrew Volunteer Assistant"
                  >
                    <span>✨</span>
                    <span>Assistant</span>
                  </button>
                )}

                {/* Cool Themed Notification Bell Button */}
                <Link
                  to="/notifications"
                  className="cool-bell-btn"
                  aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                >
                  <svg className="bell-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  {unread > 0 && (
                    <span className="cool-bell-badge">
                      <span className="badge-ping" />
                      <span className="badge-count">{unread > 9 ? '9+' : unread}</span>
                    </span>
                  )}
                </Link>

                {/* Cool Themed Logout Button */}
                <button className="cool-logout-btn" onClick={onLogout}>
                  <span className="cool-logout-icon-tile">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <polyline points="16 17 21 12 16 7"></polyline>
                      <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                  </span>
                  <span className="cool-logout-text">Log out</span>
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                <Link className="cool-login-btn" to="/login">Log in</Link>
                <Link className="cool-signup-btn" to="/register">Sign up</Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container below Top Navbar */}
      <div className="layout-body">
        {user && (
          <aside className={`glass-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
            {isManageEventRoute ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Back to main dashboard button */}
                <Link
                  to="/dashboard"
                  className="manage-sidebar-back-btn"
                  onClick={() => setMobileMenuOpen(false)}
                  title="Return to organizer dashboard"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                  </svg>
                  <span>Back to Dashboard</span>
                </Link>

                {/* Event Context Card */}
                <div className="manage-sidebar-event-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginBottom: '0.45rem' }}>
                    <span className="manage-sidebar-cat-tag">
                      {managedEvent?.category ? (CATEGORIES[managedEvent.category] || managedEvent.category) : 'EVENT'}
                    </span>
                    {managedEvent?.status && <StatusChip status={managedEvent.status} />}
                  </div>
                  <strong className="manage-sidebar-title" title={managedEvent?.title || 'Managed Event'}>
                    {managedEvent?.title || 'Managed Event'}
                  </strong>
                  <span className="manage-sidebar-subtitle">Event Operations</span>
                </div>

                {/* 6 Event Management Tabs from the Image */}
                <div className="manage-sidebar-section-title">EVENT SECTIONS</div>
                <nav className="sidebar-nav-list" aria-label="Event management sections">
                  {[
                    {
                      id: 'overview',
                      label: 'Overview',
                      icon: (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7"></rect>
                          <rect x="14" y="3" width="7" height="7"></rect>
                          <rect x="14" y="14" width="7" height="7"></rect>
                          <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                      ),
                    },
                    {
                      id: 'live',
                      label: 'Live Control',
                      icon: (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"></circle>
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14M15.54 8.46a5 5 0 0 1 0 7.08M8.46 8.46a5 5 0 0 0 0 7.08"></path>
                        </svg>
                      ),
                    },
                    {
                      id: 'shifts',
                      label: 'Shifts',
                      icon: (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                      ),
                    },
                    {
                      id: 'hours',
                      label: 'Hours',
                      icon: (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 14 10"></polyline>
                          <path d="M16 18l2 2 4-4"></path>
                        </svg>
                      ),
                    },
                    {
                      id: 'funds',
                      label: 'Funds and payouts',
                      icon: (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                          <circle cx="12" cy="12" r="2"></circle>
                          <path d="M6 12h.01M18 12h.01"></path>
                        </svg>
                      ),
                    },
                    {
                      id: 'comms',
                      label: 'Updates and records',
                      icon: (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
                          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                      ),
                    },
                  ].map((t) => {
                    const isSelected = currentTab === t.id || (t.id === 'overview' && !searchParams.get('tab'));
                    return (
                      <Link
                        key={t.id}
                        to={`/manage/events/${manageEventId}${t.id === 'overview' ? '' : `?tab=${t.id}`}`}
                        className={`sidebar-nav-item ${isSelected ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {t.icon}
                        <span>{t.label}</span>
                      </Link>
                    );
                  })}
                </nav>

                {/* Bottom Quick Links */}
                <div className="manage-sidebar-bottom-actions">
                  <Link
                    to={`/events/${manageEventId}`}
                    className="sidebar-quick-btn"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View public event page in new tab"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span>Public Page ↗</span>
                  </Link>
                  <Link
                    to={`/manage/events/${manageEventId}/edit`}
                    className="sidebar-quick-btn"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    <span>Edit Event Details</span>
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {/* User Profile Card right below top navbar over handprints */}
                <div className="sidebar-profile-card">
                  <div className="sidebar-avatar-ring">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                  <div className="sidebar-profile-details">
                    <strong className="sidebar-name">{user.name}</strong>
                    <span className="sidebar-email">{user.email}</span>
                    <span className={`sidebar-role-badge ${user.role}`}>{user.role}</span>
                  </div>
                </div>

                {/* Left-side Navigation Links */}
                <nav className="sidebar-nav-list" aria-label="Main sidebar navigation">
                  <NavLink
                    to="/dashboard"
                    className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7"></rect>
                      <rect x="14" y="3" width="7" height="7"></rect>
                      <rect x="14" y="14" width="7" height="7"></rect>
                      <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    <span>Dashboard</span>
                  </NavLink>

                  <NavLink
                    to="/events"
                    className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span>Events</span>
                  </NavLink>

                  {isOrganizer && (
                    <>
                      {firstEventId && (
                        <NavLink
                          to={`/manage/events/${firstEventId}`}
                          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                          </svg>
                          <span>Event Operations</span>
                        </NavLink>
                      )}

                      <NavLink
                        to="/manage/events/new"
                        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="16"></line>
                          <line x1="8" y1="12" x2="16" y2="12"></line>
                        </svg>
                        <span>Create Event</span>
                      </NavLink>
                    </>
                  )}

                  {!isOrganizer && (
                    <>
                      <NavLink
                        to="/my-shifts"
                        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>My shifts</span>
                      </NavLink>

                      <NavLink
                        to="/swap-board"
                        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" />
                        </svg>
                        <span>Swap Board</span>
                        {openSwapsCount > 0 && (
                          <span style={{ marginLeft: 'auto', background: '#ea580c', color: '#fff', fontSize: '0.72rem', fontWeight: 800, padding: '0.1rem 0.5rem', borderRadius: '10px' }}>
                            {openSwapsCount}
                          </span>
                        )}
                      </NavLink>

                      <NavLink
                        to="/earnings"
                        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                          <line x1="1" y1="10" x2="23" y2="10"></line>
                        </svg>
                        <span>Earnings</span>
                      </NavLink>

                      <NavLink
                        to="/certificates"
                        className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="8" r="7"></circle>
                          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                        </svg>
                        <span>Certificates</span>
                      </NavLink>
                    </>
                  )}

                  {(isOrganizer || leadShifts?.length > 0) && (
                    <NavLink
                      to="/checkin"
                      className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
                        <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
                        <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
                        <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
                        <rect x="7" y="7" width="10" height="10"></rect>
                      </svg>
                      <span>Check-in desk</span>
                    </NavLink>
                  )}

                  {user?.role === 'admin' && (
                    <NavLink
                      to="/admin"
                      className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                      <span>Platform Admin</span>
                    </NavLink>
                  )}

                  <NavLink
                    to="/profile"
                    className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <span>Profile & Settings</span>
                  </NavLink>
                </nav>

                {/* Quick-Actions Hub inside Left Sidebar */}
                {isOrganizer && (
                  <div className="sidebar-quick-hub-box">
                    <div className="sidebar-quick-hub-header">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                      </svg>
                      <span>QUICK ACTIONS</span>
                    </div>
                    <div className="sidebar-quick-hub-grid">
                      <Link
                        to="/manage/events/new"
                        className="sidebar-quick-hub-tile tile-purple"
                        onClick={() => setMobileMenuOpen(false)}
                        title="Create New Event"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>+ Create</span>
                      </Link>

                      <Link
                        to="/checkin"
                        className="sidebar-quick-hub-tile tile-mint"
                        onClick={() => setMobileMenuOpen(false)}
                        title="Open Check-In Desk"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
                          <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
                          <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
                          <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
                          <rect x="7" y="7" width="10" height="10"></rect>
                        </svg>
                        <span>QR Desk</span>
                      </Link>

                      <Link
                        to="/events"
                        className="sidebar-quick-hub-tile tile-sky"
                        onClick={() => setMobileMenuOpen(false)}
                        title="Browse Events"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>Events</span>
                      </Link>

                      <Link
                        to="/profile"
                        className="sidebar-quick-hub-tile tile-yellow"
                        onClick={() => setMobileMenuOpen(false)}
                        title="Organization Profile"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span>Profile</span>
                      </Link>
                    </div>
                  </div>
                )}

                {/* Sidebar Bottom Pill Indicator */}
                <div className="sidebar-bottom-badge">
                  <div className="system-status-indicator">
                    <span className="status-live-dot" />
                    <span className="status-live-text">ShiftCrew Sandbox Active</span>
                  </div>
                </div>
              </>
            )}
          </aside>
        )}

        {/* Content Area */}
        <main className={`layout-content ${!user ? 'logged-out' : ''}`}>
          <div className="content-container">
            <Outlet />
          </div>
          <footer className="footer" style={{ marginTop: '4rem' }}>
            <div className="container" style={{ textAlign: 'center', opacity: 0.8 }}>
              ShiftCrew • Real-time event & volunteer operations in sandbox mode.
            </div>
          </footer>
        </main>
      </div>

      {/* Floating Assistant Launcher */}
      {user && (
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 900,
            background: '#0f172a',
            color: '#ffffff',
            border: '2.5px solid #ffffff',
            borderRadius: '999px',
            padding: '0.65rem 1.15rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 900,
            fontSize: '0.88rem',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.35), 4px 4px 0 #0f172a',
            cursor: 'pointer',
            transition: 'transform 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          title="Open Volunteer AI Assistant"
        >
          <span style={{ fontSize: '1.15rem' }}>✨</span>
          <span>Assistant</span>
          {aiStatus?.canUseUserData && (
            <span
              style={{
                background: '#22c55e',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                display: 'inline-block',
              }}
              title="Assistant Active"
            />
          )}
        </button>
      )}

      {/* Assistant Drawer */}
      <AssistantDrawer isOpen={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}

