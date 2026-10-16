import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../api/client.js';
import { formatDateTime } from '../lib.js';
import { Spinner } from '../components/ui.jsx';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function getNotificationMeta(n) {
  const type = (n.type || '').toLowerCase();
  const title = (n.title || '').toLowerCase();
  const body = (n.body || '').toLowerCase();

  if (type.includes('payout') || title.includes('paid') || title.includes('stipend') || body.includes('stipend')) {
    return {
      category: 'payout',
      badgeText: 'STIPEND & PAYOUT',
      icon: '💰',
      bgTone: '#ecfdf5',
      borderColor: '#10b981',
      badgeBg: '#dcfce7',
      badgeColor: '#15803d',
      actionLabel: 'View Earnings ↗',
      defaultLink: '/earnings',
    };
  }

  if (type.includes('reminder') || title.includes('shift in') || title.includes('starting soon')) {
    return {
      category: 'shift',
      badgeText: 'SHIFT REMINDER',
      icon: '⏰',
      bgTone: '#fffbeb',
      borderColor: '#f59e0b',
      badgeBg: '#fef3c7',
      badgeColor: '#b45309',
      actionLabel: 'Open Pass ↗',
      defaultLink: '/my-shifts',
    };
  }

  if (type.includes('hours') || title.includes('hours were approved') || title.includes('hours')) {
    return {
      category: 'shift',
      badgeText: 'HOURS ACCREDITED',
      icon: '⏱️',
      bgTone: '#f0f9ff',
      borderColor: '#0284c7',
      badgeBg: '#e0f2fe',
      badgeColor: '#0369a1',
      actionLabel: 'View Timesheet ↗',
      defaultLink: '/my-shifts',
    };
  }

  if (type.includes('certificate') || title.includes('certificate')) {
    return {
      category: 'broadcast',
      badgeText: 'CREDENTIAL ISSUED',
      icon: '📜',
      bgTone: '#faf5ff',
      borderColor: '#a855f7',
      badgeBg: '#f3e8ff',
      badgeColor: '#7e22ce',
      actionLabel: 'View Certificate ↗',
      defaultLink: '/certificates',
    };
  }

  if (type.includes('dispute') || title.includes('dispute')) {
    return {
      category: 'broadcast',
      badgeText: 'RESOLUTION UPDATE',
      icon: '⚖️',
      bgTone: '#fff1f2',
      borderColor: '#f43f5e',
      badgeBg: '#ffe4e6',
      badgeColor: '#be123c',
      actionLabel: 'Check Dispute ↗',
      defaultLink: '/my-shifts',
    };
  }

  if (type.includes('signup') || title.includes('approved') || title.includes('declined') || title.includes('offered')) {
    return {
      category: 'shift',
      badgeText: 'ROSTER UPDATE',
      icon: '🎫',
      bgTone: '#f5f3ff',
      borderColor: '#8b5cf6',
      badgeBg: '#ede9fe',
      badgeColor: '#6d28d9',
      actionLabel: 'View Shift ↗',
      defaultLink: '/my-shifts',
    };
  }

  if (type.includes('cancel') || title.includes('cancelled')) {
    return {
      category: 'shift',
      badgeText: 'EVENT CANCELLED',
      icon: '🛑',
      bgTone: '#fef2f2',
      borderColor: '#ef4444',
      badgeBg: '#fee2e2',
      badgeColor: '#b91c1c',
      actionLabel: 'Details ↗',
      defaultLink: '/my-shifts',
    };
  }

  // Default broadcast announcement
  return {
    category: 'broadcast',
    badgeText: 'ORGANIZER NOTICE',
    icon: '📢',
    bgTone: '#fff7ed',
    borderColor: '#f97316',
    badgeBg: '#ffedd5',
    badgeColor: '#c2410c',
    actionLabel: 'Open Notice ↗',
    defaultLink: null,
  };
}

export default function Notifications() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'unread', 'payout', 'shift', 'broadcast'
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread'] });
  };

  const markAll = useMutation({
    mutationFn: async () => api.post('/notifications/read', {}),
    onSuccess: invalidate,
  });

  const markSingle = useMutation({
    mutationFn: async (id) => api.post('/notifications/read', { ids: [id] }),
    onSuccess: invalidate,
  });

  const allNotifications = data?.notifications || [];
  const unreadCount = data?.unread || 0;

  // Category counts
  const payoutCount = useMemo(() => {
    return allNotifications.filter((n) => getNotificationMeta(n).category === 'payout').length;
  }, [allNotifications]);

  const shiftCount = useMemo(() => {
    return allNotifications.filter((n) => getNotificationMeta(n).category === 'shift').length;
  }, [allNotifications]);

  const broadcastCount = useMemo(() => {
    return allNotifications.filter((n) => getNotificationMeta(n).category === 'broadcast').length;
  }, [allNotifications]);

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    let list = allNotifications;

    if (activeTab === 'unread') {
      list = list.filter((n) => !n.readAt);
    } else if (activeTab === 'payout') {
      list = list.filter((n) => getNotificationMeta(n).category === 'payout');
    } else if (activeTab === 'shift') {
      list = list.filter((n) => getNotificationMeta(n).category === 'shift');
    } else if (activeTab === 'broadcast') {
      list = list.filter((n) => getNotificationMeta(n).category === 'broadcast');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((n) =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.body && n.body.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allNotifications, activeTab, searchQuery]);

  if (isLoading) return <Spinner label="Loading notification center..." />;

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '3.5rem' }}>
      {/* 1. Page Header & Live Status Banner */}
      <div
        style={{
          background: '#ffffff',
          border: '3px solid #0f172a',
          borderRadius: '24px',
          boxShadow: '6px 6px 0px #0f172a',
          padding: '1.75rem 2rem',
          marginBottom: '1.75rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '1.65rem' }}>🔔</span>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '2.2rem',
                  fontWeight: 950,
                  color: '#0f172a',
                  margin: 0,
                  lineHeight: 1.1,
                }}
              >
                Notifications & Broadcasts
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: '0.94rem', fontWeight: 700, color: '#475569' }}>
              {unreadCount > 0 ? (
                <span style={{ color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '9px', height: '9px', borderRadius: '999px', background: '#f59e0b', display: 'inline-block' }} />
                  You have <strong>{unreadCount} unread</strong> {unreadCount === 1 ? 'alert' : 'alerts'} requiring attention
                </span>
              ) : (
                <span style={{ color: '#15803d', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '9px', height: '9px', borderRadius: '999px', background: '#22c55e', display: 'inline-block' }} />
                  You are all caught up! No unread notifications.
                </span>
              )}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {unreadCount > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                style={{
                  fontWeight: 850,
                  fontSize: '0.86rem',
                  padding: '0.55rem 1.25rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                ✓ Mark all as read
              </button>
            )}

            <Link
              to="/my-shifts"
              className="btn btn-white"
              style={{
                fontWeight: 800,
                fontSize: '0.86rem',
                border: '2px solid #0f172a',
                padding: '0.55rem 1.15rem',
              }}
            >
              My Shifts →
            </Link>
          </div>
        </div>
      </div>

      {/* 2. Top Bento Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        {/* Total */}
        <div
          onClick={() => setActiveTab('all')}
          style={{
            background: activeTab === 'all' ? '#f8fafc' : '#ffffff',
            border: activeTab === 'all' ? '2.5px solid #0f172a' : '2px solid #cbd5e1',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            boxShadow: activeTab === 'all' ? '4px 4px 0px #0f172a' : '2px 2px 0px #e2e8f0',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px' }}>
              ALL NOTIFICATIONS
            </span>
            <span style={{ fontSize: '1.15rem' }}>📬</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 950, color: '#0f172a', marginTop: '0.25rem' }}>
            {allNotifications.length}
          </div>
        </div>

        {/* Unread Alerts */}
        <div
          onClick={() => setActiveTab('unread')}
          style={{
            background: activeTab === 'unread' ? '#fef3c7' : '#ffffff',
            border: activeTab === 'unread' ? '2.5px solid #0f172a' : '2px solid #cbd5e1',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            boxShadow: activeTab === 'unread' ? '4px 4px 0px #0f172a' : '2px 2px 0px #e2e8f0',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', color: unreadCount > 0 ? '#b45309' : '#64748b', letterSpacing: '0.5px' }}>
              UNREAD INBOX
            </span>
            <span style={{ fontSize: '1.15rem' }}>⚡</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 950, color: unreadCount > 0 ? '#b45309' : '#0f172a', marginTop: '0.25rem' }}>
            {unreadCount}
          </div>
        </div>

        {/* Payouts */}
        <div
          onClick={() => setActiveTab('payout')}
          style={{
            background: activeTab === 'payout' ? '#dcfce7' : '#ffffff',
            border: activeTab === 'payout' ? '2.5px solid #0f172a' : '2px solid #cbd5e1',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            boxShadow: activeTab === 'payout' ? '4px 4px 0px #0f172a' : '2px 2px 0px #e2e8f0',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', color: '#15803d', letterSpacing: '0.5px' }}>
              STIPENDS & FUNDS
            </span>
            <span style={{ fontSize: '1.15rem' }}>💰</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 950, color: '#15803d', marginTop: '0.25rem' }}>
            {payoutCount}
          </div>
        </div>

        {/* Shifts */}
        <div
          onClick={() => setActiveTab('shift')}
          style={{
            background: activeTab === 'shift' ? '#e0f2fe' : '#ffffff',
            border: activeTab === 'shift' ? '2.5px solid #0f172a' : '2px solid #cbd5e1',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            boxShadow: activeTab === 'shift' ? '4px 4px 0px #0f172a' : '2px 2px 0px #e2e8f0',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', color: '#0369a1', letterSpacing: '0.5px' }}>
              DUTY & REMINDERS
            </span>
            <span style={{ fontSize: '1.15rem' }}>⏰</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 950, color: '#0369a1', marginTop: '0.25rem' }}>
            {shiftCount}
          </div>
        </div>
      </div>

      {/* 3. Filter Navigation & Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {/* Pills Navigation */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${allNotifications.length})` },
            { id: 'unread', label: `Unread (${unreadCount})` },
            { id: 'payout', label: `💰 Stipends (${payoutCount})` },
            { id: 'shift', label: `⏰ Shifts (${shiftCount})` },
            { id: 'broadcast', label: `📢 Notices (${broadcastCount})` },
          ].map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: isSelected ? '#0f172a' : '#ffffff',
                  color: isSelected ? '#ffffff' : '#0f172a',
                  border: '2px solid #0f172a',
                  boxShadow: isSelected ? '3px 3px 0px #0f172a' : 'none',
                  borderRadius: '999px',
                  padding: '0.45rem 1rem',
                  fontSize: '0.84rem',
                  fontWeight: 850,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div style={{ position: 'relative', minWidth: '240px', flex: '1', maxWidth: '320px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notifications..."
            style={{
              width: '100%',
              padding: '0.5rem 2rem 0.5rem 0.9rem',
              borderRadius: '999px',
              border: '2px solid #0f172a',
              fontSize: '0.86rem',
              fontWeight: 650,
              background: '#ffffff',
              boxShadow: '2px 2px 0px #0f172a',
              outline: 'none',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 900,
                color: '#64748b',
                fontSize: '0.9rem',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 4. Notification Cards Feed */}
      {filteredNotifications.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            border: '2.5px dashed #94a3b8',
            borderRadius: '20px',
            padding: '3.5rem 2rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📭</div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 950, color: '#0f172a', margin: '0 0 0.4rem' }}>
            {searchQuery ? 'No matching notifications found' : activeTab === 'unread' ? 'Zero unread alerts' : 'No notifications in this folder'}
          </h3>
          <p style={{ margin: '0 0 1.25rem', color: '#64748b', fontSize: '0.92rem', fontWeight: 650 }}>
            {searchQuery
              ? `We couldn't find any results for "${searchQuery}". Try a different keyword.`
              : activeTab === 'unread'
              ? 'Awesome! You have read and resolved all incoming alerts.'
              : 'Reminders, duty approvals, and UPI payment updates will appear here automatically.'}
          </p>
          {(searchQuery || activeTab !== 'all') && (
            <button
              onClick={() => {
                setActiveTab('all');
                setSearchQuery('');
              }}
              className="btn btn-primary"
              style={{ fontWeight: 850, fontSize: '0.84rem', padding: '0.45rem 1.15rem' }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredNotifications.map((n) => {
            const meta = getNotificationMeta(n);
            const isUnread = !n.readAt;
            const targetLink = n.link || meta.defaultLink;

            return (
              <div
                key={n._id}
                style={{
                  background: isUnread ? '#ffffff' : '#fafafa',
                  border: isUnread ? '2.5px solid #0f172a' : '2px solid #cbd5e1',
                  borderLeft: isUnread ? `7px solid ${meta.borderColor}` : '2px solid #cbd5e1',
                  borderRadius: '16px',
                  boxShadow: isUnread ? '4px 4px 0px #0f172a' : '2px 2px 0px #e2e8f0',
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Left Side: Icon + Content */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flex: '1', minWidth: '280px' }}>
                  {/* Category Icon Badge */}
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '12px',
                      background: meta.bgTone,
                      border: `2px solid ${meta.borderColor}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.4rem',
                      flexShrink: 0,
                      boxShadow: '2px 2px 0px #0f172a',
                    }}
                  >
                    {meta.icon}
                  </div>

                  {/* Body Content */}
                  <div style={{ flex: '1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                      {/* Category Tag */}
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 900,
                          textTransform: 'uppercase',
                          background: meta.badgeBg,
                          color: meta.badgeColor,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          border: `1.2px solid ${meta.borderColor}`,
                          letterSpacing: '0.4px',
                        }}
                      >
                        {meta.badgeText}
                      </span>

                      {/* Unread Pill */}
                      {isUnread && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 900,
                            textTransform: 'uppercase',
                            background: '#0f172a',
                            color: '#ffffff',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            letterSpacing: '0.5px',
                          }}
                        >
                          NEW
                        </span>
                      )}

                      {/* Relative Time */}
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>
                        • {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>

                    {/* Notification Title */}
                    <h3
                      style={{
                        margin: '0 0 0.35rem',
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.15rem',
                        fontWeight: 950,
                        color: '#0f172a',
                        lineHeight: 1.25,
                      }}
                    >
                      {n.title}
                    </h3>

                    {/* Notification Body Text */}
                    {n.body && (
                      <p
                        style={{
                          margin: '0 0 0.55rem',
                          color: '#334155',
                          fontSize: '0.92rem',
                          lineHeight: 1.5,
                          fontWeight: 550,
                        }}
                      >
                        {n.body}
                      </p>
                    )}

                    {/* Exact Formatted Timestamp */}
                    <div style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 650 }}>
                      📅 {formatDateTime(n.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Right Side: Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0, marginTop: '0.25rem' }}>
                  {isUnread && (
                    <button
                      onClick={() => markSingle.mutate(n._id)}
                      disabled={markSingle.isPending}
                      title="Mark as read"
                      style={{
                        background: '#ffffff',
                        border: '1.5px solid #0f172a',
                        borderRadius: '8px',
                        padding: '0.45rem 0.75rem',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        color: '#475569',
                        cursor: 'pointer',
                        boxShadow: '1.5px 1.5px 0px #0f172a',
                      }}
                    >
                      ✓ Read
                    </button>
                  )}

                  {targetLink && (
                    <Link
                      to={targetLink}
                      onClick={() => {
                        if (isUnread) markSingle.mutate(n._id);
                      }}
                      className={isUnread ? 'btn btn-primary' : 'btn btn-white'}
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 850,
                        padding: '0.45rem 1rem',
                        border: '2px solid #0f172a',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {meta.actionLabel}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
