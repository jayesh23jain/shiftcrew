import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUserLocation } from '../hooks/useUserLocation.js';
import {
  ATT_LABEL,
  CATEGORIES,
  SIGNUP_LABEL,
  formatShift,
  hoursText,
  payLabel,
  rupees,
  makeGoogleMapsDirectionsUrl,
} from '../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../components/ui.jsx';

function makeGoogleCalendarUrl(event, shift) {
  try {
    const start = new Date(shift?.start || event?.startDate).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const end = new Date(shift?.end || event?.endDate).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const loc = [event?.venue?.name, event?.venue?.address, event?.venue?.city].filter(Boolean).join(', ');
    const details = `ShiftCrew Volunteering Shift: ${shift?.role || 'Crew'} for ${event?.title || 'Event'}.\nReporting Desk check-in required.`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      `${event?.title || 'Event'} - ${shift?.role || 'Shift'}`
    )}&dates=${start}/${end}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;
  } catch {
    return '#';
  }
}

function getCountdownText(start, end) {
  const now = new Date();
  const s = new Date(start);
  const e = new Date(end);
  if (s <= now && e >= now) return '🟢 HAPPENING NOW';
  const diffMs = s - now;
  if (diffMs <= 0) return 'Just started';
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `Starts in ${days}d ${hours % 24}h`;
  }
  return `Starts in ${hours}h ${minutes}m`;
}

const CARD_HEADER_PALETTE = [
  '#bbf7d0', // Mint
  '#fed7aa', // Peach
  '#ddd6fe', // Lavender
  '#fef08a', // Yellow
  '#bae6fd', // Sky Blue
  '#fecdd3', // Rose
];

export default function MyShifts() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { getDistance } = useUserLocation();

  const [activeTab, setActiveTab] = useState('all'); // all | confirmed | pending | completed | cancelled
  const [minimizedShifts, setMinimizedShifts] = useState(new Set()); // Shift IDs that are collapsed
  const [disputing, setDisputing] = useState(null); // attendanceId
  const [disputeShiftInfo, setDisputeShiftInfo] = useState(null);
  const [reason, setReason] = useState('');

  const toggleMinimize = (id) => {
    setMinimizedShifts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMinimizeAll = () => {
    if (minimizedShifts.size === filteredShifts.length) {
      setMinimizedShifts(new Set());
    } else {
      setMinimizedShifts(new Set(filteredShifts.map((s) => s._id)));
    }
  };

  // 1. Fetch user signups & shifts
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: async () => (await api.get('/me/shifts')).data.signups,
    refetchInterval: 15_000,
  });

  // 2. Fetch stats for summary header
  const { data: stats } = useQuery({
    queryKey: ['my-stats'],
    queryFn: async () => (await api.get('/me/stats')).data,
  });

  // 3. Leave Shift Mutation
  const leave = useMutation({
    mutationFn: async (shiftId) => (await api.post(`/shifts/${shiftId}/leave`)).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
      qc.invalidateQueries({ queryKey: ['my-stats'] });
      if (d.lateCancel) {
        window.alert(
          '⚠️ Late Cancellation Penalty: Shifts cancelled less than 24 hours prior reduce your reliability score by 5 points.'
        );
      }
    },
  });

  // 4. Dispute Hours Mutation
  const dispute = useMutation({
    mutationFn: async () => (await api.post('/disputes', { attendanceId: disputing, reason })).data,
    onSuccess: () => {
      setDisputing(null);
      setDisputeShiftInfo(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
  });

  const now = new Date();

  // Find Live Hero Shift (from active confirmed shifts only)
  const heroShift = useMemo(() => {
    const activeConfirmed = data.filter(
      (s) =>
        !s.isCancelled &&
        !s.isEventCancelled &&
        !s.isShiftCancelled &&
        !s.isPaid &&
        s.status === 'confirmed'
    );
    if (!activeConfirmed.length) return null;

    const ongoing = activeConfirmed.find((s) => {
      if (!s.shift) return false;
      const start = new Date(s.shift.start);
      const end = new Date(s.shift.end);
      const active = start <= now && end >= now;
      const checkedIn = s.attendance?.status === 'checked_in';
      return active || checkedIn;
    });
    if (ongoing) return { shiftItem: ongoing, isLive: true };

    const upcomingConfirmed = activeConfirmed
      .filter((s) => s.shift && new Date(s.shift.start) > now)
      .sort((a, b) => new Date(a.shift.start) - new Date(b.shift.start))[0];

    if (upcomingConfirmed) return { shiftItem: upcomingConfirmed, isLive: false };
    return null;
  }, [data, now]);

  // Tab Filter Segmentation
  // 1. "all": shows active shifts (confirmed or pending/waitlisted, not cancelled, not paid)
  const activeShifts = data.filter(
    (s) =>
      !s.isCancelled &&
      !s.isEventCancelled &&
      !s.isShiftCancelled &&
      !s.isPaid &&
      ['confirmed', 'pending', 'waitlisted'].includes(s.status)
  );

  // 2. "confirmed": shows confirmed active spots
  const confirmedShifts = data.filter(
    (s) =>
      !s.isCancelled &&
      !s.isEventCancelled &&
      !s.isShiftCancelled &&
      !s.isPaid &&
      s.status === 'confirmed'
  );

  // 3. "pending": shows pending organizer review or waitlist
  const pendingShifts = data.filter(
    (s) =>
      !s.isCancelled &&
      !s.isEventCancelled &&
      !s.isShiftCancelled &&
      !s.isPaid &&
      ['pending', 'waitlisted'].includes(s.status)
  );

  // 4. "completed": shows completed shifts that you have worked and received payment for
  const completedShifts = data.filter(
    (s) =>
      !s.isCancelled &&
      !s.isEventCancelled &&
      !s.isShiftCancelled &&
      (s.isPaid || (s.attendance && ['completed', 'approved'].includes(s.attendance.status)))
  );

  // 5. "cancelled": shows shifts if you cancelled or the event got cancelled (or rejected)
  const cancelledShifts = data.filter(
    (s) =>
      s.isCancelled ||
      s.isEventCancelled ||
      s.isShiftCancelled ||
      ['cancelled', 'rejected'].includes(s.status)
  );

  const filteredShifts = useMemo(() => {
    switch (activeTab) {
      case 'confirmed':
        return confirmedShifts;
      case 'pending':
        return pendingShifts;
      case 'completed':
        return completedShifts;
      case 'cancelled':
        return cancelledShifts;
      case 'all':
      default:
        return activeShifts;
    }
  }, [activeTab, activeShifts, confirmedShifts, pendingShifts, completedShifts, cancelledShifts]);

  // Aggregate stats
  const totalMinutesWorked = stats?.minutes || 0;
  const totalEarned = stats?.earned || 0;
  const reliability = stats?.reliability || user?.reliabilityScore || 100;

  if (isLoading) return <Spinner label="Loading your crew shifts..." />;
  if (error) return <Notice>{errorMessage(error)}</Notice>;

  return (
    <div className="organizer-dashboard-wrap" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <span className="dash-alert-badge" style={{ background: '#fef08a', color: '#854d0e', marginBottom: '0.5rem', display: 'inline-block' }}>
            🎫 CREW SHIFT MANAGEMENT
          </span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 950, color: '#0f172a', margin: '0.2rem 0 0' }}>
            My shifts
          </h1>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.94rem', color: '#64748b', fontWeight: 650 }}>
            Track assigned shifts, check travel distance, launch GPS directions, access live QR passes, and review hours.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '0.82rem',
              fontWeight: 850,
              border: '2px solid #0f172a',
              background: reliability >= 90 ? '#bbf7d0' : reliability >= 75 ? '#fef08a' : '#fecdd3',
              color: reliability >= 90 ? '#166534' : reliability >= 75 ? '#854d0e' : '#991b1b',
            }}
          >
            ⭐ {reliability}% Reliability Score
          </span>
          <Link to="/events" className="btn btn-primary" style={{ padding: '0.55rem 1.25rem', fontWeight: 900 }}>
            🔍 Browse Open Shifts
          </Link>
        </div>
      </div>

      <Notice>{leave.error && errorMessage(leave.error)}</Notice>

      {/* Feature 1: Hero Active / Next Shift Ticket Pass */}
      {heroShift?.shiftItem && (
        <div className="crew-hero-ticket" style={{ marginBottom: '1.75rem' }}>
          <div className="crew-hero-ticket-left">
            <div className="crew-hero-tag-row">
              {heroShift.isLive ? (
                <span className="upcoming-label-tag live-tag">
                  <span className="live-pulse-dot" />
                  YOU ARE ON DUTY NOW
                </span>
              ) : (
                <span className="upcoming-label-tag" style={{ background: '#bbf7d0', color: '#166534', border: '1.5px solid #0f172a' }}>
                  ⚡ {getCountdownText(heroShift.shiftItem.shift.start, heroShift.shiftItem.shift.end)}
                </span>
              )}
              <span className="crew-hero-role-chip">
                🎯 {heroShift.shiftItem.role}
              </span>
              {heroShift.shiftItem.event?.venue && getDistance(heroShift.shiftItem.event.venue) && (
                <span style={{ background: '#ecfdf5', color: '#047857', border: '1.5px solid #0f172a', padding: '3px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 800 }}>
                  📍 {getDistance(heroShift.shiftItem.event.venue)}
                </span>
              )}
            </div>

            <h2 className="crew-hero-title" style={{ fontSize: '1.6rem' }}>
              {heroShift.shiftItem.event?.title}
            </h2>

            <div className="crew-hero-meta-row" style={{ flexWrap: 'wrap', gap: '0.85rem' }}>
              <span>🕒 {formatShift(heroShift.shiftItem.shift.start, heroShift.shiftItem.shift.end)}</span>
              <span>
                📍 {heroShift.shiftItem.event?.venue?.name ? `${heroShift.shiftItem.event.venue.name}, ` : ''}
                {heroShift.shiftItem.event?.venue?.address ? `${heroShift.shiftItem.event.venue.address}, ` : ''}
                {heroShift.shiftItem.event?.venue?.city || 'Location TBA'}
              </span>
              <span>💵 {payLabel(heroShift.shiftItem.shift)}</span>
            </div>

            <p style={{ margin: '0.45rem 0 0', fontSize: '0.85rem', color: '#334155', fontWeight: 650 }}>
              📝 {heroShift.shiftItem.shift.notes || 'Reporting Desk check-in required. Arrive 15 minutes before start with your QR pass.'}
            </p>
          </div>

          <div className="crew-hero-ticket-right" style={{ minWidth: '220px' }}>
            <Link
              to={`/pass/${heroShift.shiftItem.shift._id}`}
              className="upcoming-action-btn"
              style={{ background: '#0f172a', color: '#ffffff', width: '100%', justifyContent: 'center' }}
            >
              <span>🎫 Open Gate QR Pass</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </Link>

            <div style={{ display: 'flex', gap: '0.5rem', width: '100%', marginTop: '0.5rem' }}>
              {heroShift.shiftItem.event?.venue && (
                <a
                  href={makeGoogleMapsDirectionsUrl(heroShift.shiftItem.event.venue)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-white"
                  style={{ flex: 1, fontSize: '0.78rem', padding: '0.45rem 0.65rem', textAlign: 'center', justifyContent: 'center', border: '1.5px solid #0f172a' }}
                  title="Open turn-by-turn directions in Google Maps"
                >
                  🗺️ Directions
                </a>
              )}
              <a
                href={makeGoogleCalendarUrl(heroShift.shiftItem.event, heroShift.shiftItem.shift)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-quiet"
                style={{ flex: 1, fontSize: '0.78rem', padding: '0.45rem 0.65rem', textAlign: 'center', justifyContent: 'center' }}
              >
                📅 Add Cal
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Feature 2: 3-Tile Neo-Brutalist Crew KPI Overview */}
      <div className="dash-stats-grid" style={{ marginBottom: '1.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div className="dash-stat-card stat-mint">
          <span className="dash-stat-label">Total Shifts</span>
          <span className="dash-stat-val">{data.length}</span>
          <span className="dash-stat-hint">{completedShifts.length} completed & settled</span>
        </div>

        <div className="dash-stat-card stat-lavender">
          <span className="dash-stat-label">Active Shifts</span>
          <span className="dash-stat-val">{activeShifts.length}</span>
          <span className="dash-stat-hint">{confirmedShifts.length} confirmed • {pendingShifts.length} pending review</span>
        </div>

        <div className="dash-stat-card stat-peach">
          <span className="dash-stat-label">Reliability Score</span>
          <span className="dash-stat-val">{reliability}%</span>
          <span className="dash-stat-hint">
            {reliability >= 90 ? '⭐ Top Tier standing' : reliability >= 75 ? '⚡ Standard standing' : '⚠️ Low standing'}
          </span>
        </div>
      </div>

      {/* Inline Dispute Modal */}
      {disputing && (
        <div className="dash-card" style={{ marginBottom: '1.5rem', background: '#fffbeb', border: '2.5px solid #f59e0b', borderRadius: '18px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: '#92400e' }}>
                ⚠️ Raise an Hours or Attendance Dispute
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#78350f', fontWeight: 600 }}>
                {disputeShiftInfo ? `${disputeShiftInfo.eventTitle} • Role: ${disputeShiftInfo.role}` : 'Submit hours adjustment details directly to the organizing committee.'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ fontSize: '0.8rem' }}
              onClick={() => { setDisputing(null); setDisputeShiftInfo(null); }}
            >
              ✕ Cancel
            </button>
          </div>

          <Notice>{dispute.error && errorMessage(dispute.error)}</Notice>

          <form onSubmit={(e) => { e.preventDefault(); dispute.mutate(); }}>
            <Field
              label="Describe what happened"
              hint="e.g. Worked until 7:30 PM for closing teardown, but only 4 hours were recorded on the gate scanner."
            >
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Give details of your actual check-in/out times, team lead name, or duty location..."
                required
              />
            </Field>

            <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.85rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={dispute.isPending || !reason.trim()}
                style={{ fontWeight: 800 }}
              >
                {dispute.isPending ? 'Submitting Dispute...' : 'Submit Dispute to Organizer →'}
              </button>
              <button
                type="button"
                className="btn btn-white"
                onClick={() => { setDisputing(null); setDisputeShiftInfo(null); }}
              >
                Nevermind
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feature 3: Neo-Brutalist Filter Tabs Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Shifts', count: activeShifts.length },
            { id: 'confirmed', label: 'Confirmed Spots', count: confirmedShifts.length },
            { id: 'pending', label: 'Pending Review', count: pendingShifts.length },
            { id: 'completed', label: 'Completed & Paid', count: completedShifts.length },
            { id: 'cancelled', label: 'Cancelled / Rejected', count: cancelledShifts.length },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  border: '2px solid #0f172a',
                  background: active ? '#0f172a' : '#ffffff',
                  color: active ? '#ffffff' : '#0f172a',
                  boxShadow: active ? '2px 2px 0px #0f172a' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label} ({tab.count})
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 700 }}>
            Showing {filteredShifts.length} of {data.length} enrolled shifts
          </span>

          {filteredShifts.length > 0 && (
            <button
              type="button"
              onClick={toggleMinimizeAll}
              className="btn btn-white"
              style={{
                padding: '5px 12px',
                fontSize: '0.78rem',
                fontWeight: 850,
                border: '2px solid #0f172a',
                borderRadius: '999px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '1.5px 1.5px 0px #0f172a',
              }}
            >
              {minimizedShifts.size === filteredShifts.length ? '⊞ Expand All Cards' : '⊟ Minimize All Cards'}
            </button>
          )}
        </div>
      </div>

      {/* Feature 4: Shift Bento Cards Grid */}
      {filteredShifts.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
          {filteredShifts.map((s, idx) => {
            if (!s.shift) return null;

            const shiftStart = new Date(s.shift.start).getTime();
            const shiftEnd = new Date(s.shift.end).getTime();
            const isConfirmed = s.status === 'confirmed';
            const isUpcoming = shiftStart > Date.now();
            const isOngoing = shiftStart <= Date.now() && shiftEnd >= Date.now();
            const isMinimized = minimizedShifts.has(s._id);
            const att = s.attendance;
            const canDispute =
              att &&
              ['approved', 'rejected', 'no_show', 'completed'].includes(att.status) &&
              !att.dispute &&
              Date.now() - shiftEnd < 7 * 86400000;

            const distanceText = s.event?.venue ? getDistance(s.event.venue) : null;
            const mapsDirectionsUrl = s.event?.venue ? makeGoogleMapsDirectionsUrl(s.event.venue) : null;
            const headerColor = CARD_HEADER_PALETTE[idx % CARD_HEADER_PALETTE.length];

            return (
              <div
                key={s._id}
                style={{
                  background: '#ffffff',
                  borderRadius: isMinimized ? '14px' : '18px',
                  border: '2.5px solid #0f172a',
                  boxShadow: isMinimized ? '2.5px 2.5px 0px #0f172a' : '4px 4px 0px #0f172a',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.15s ease',
                }}
              >
                {isMinimized ? (
                  /* Ultra-Compact Minimized Strip: Event Name, Role, Payment Status & Expand */
                  <div
                    style={{
                      background: headerColor,
                      padding: '0.65rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.6rem',
                    }}
                  >
                    {/* Left: Category + Event Title + Role */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', minWidth: 0 }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 900, textTransform: 'uppercase', background: '#0f172a', color: '#ffffff', padding: '2px 6px', borderRadius: '4px' }}>
                        {CATEGORIES[s.event?.category] || 'Event'}
                      </span>
                      <strong style={{ fontSize: '1.05rem', color: '#0f172a', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Link to={`/events/${s.event?._id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {s.event?.title || 'Volunteering Event'} ↗
                        </Link>
                      </strong>
                      <span style={{ fontSize: '0.78rem', fontWeight: 850, color: '#4338ca', background: '#ffffff', padding: '2px 8px', borderRadius: '5px', border: '1.2px solid #0f172a', whiteSpace: 'nowrap' }}>
                        🎯 Role: {s.role}
                      </span>
                    </div>

                    {/* Right: Payment Status Badge + Expand Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '0.76rem',
                          fontWeight: 850,
                          background: s.isPaid ? '#bbf7d0' : s.isEventCancelled || s.isCancelled ? '#fee2e2' : '#fef08a',
                          color: s.isPaid ? '#14532d' : s.isEventCancelled || s.isCancelled ? '#991b1b' : '#854d0e',
                          padding: '2px 8px',
                          borderRadius: '5px',
                          border: '1.2px solid #0f172a',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        💳 {s.isPaid ? `Paid & Settled (₹${s.payable?.amount || s.estPay || 0})` : s.isEventCancelled ? 'Event Cancelled' : s.status === 'cancelled' ? 'Cancelled' : `Payment: ${payLabel(s.shift)}`}
                      </span>

                      <button
                        type="button"
                        onClick={() => toggleMinimize(s._id)}
                        className="btn btn-white"
                        style={{
                          padding: '3px 9px',
                          fontSize: '0.72rem',
                          fontWeight: 850,
                          border: '1.5px solid #0f172a',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          background: '#ffffff',
                          boxShadow: '1px 1px 0px #0f172a',
                        }}
                      >
                        ▼ Expand
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Header ribbon */}
                    <div
                      style={{
                        background: headerColor,
                        padding: '0.65rem 1rem',
                        borderBottom: '2px solid #0f172a',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', background: '#0f172a', color: '#ffffff', padding: '2px 7px', borderRadius: '4px' }}>
                          {CATEGORIES[s.event?.category] || 'Event'}
                        </span>
                        {isOngoing && (
                          <span className="live-tag" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                            <span className="live-pulse-dot" /> LIVE
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <Pill
                          tone={
                            s.isEventCancelled || s.isCancelled || s.status === 'cancelled' || s.status === 'rejected'
                              ? 'bad'
                              : s.isPaid
                              ? 'good'
                              : isConfirmed
                              ? 'good'
                              : 'warn'
                          }
                        >
                          {s.isEventCancelled
                            ? 'Event Cancelled'
                            : s.isPaid
                            ? 'Paid & Settled'
                            : s.status === 'cancelled'
                            ? 'Cancelled by You'
                            : s.status === 'rejected'
                            ? 'Application Declined'
                            : SIGNUP_LABEL[s.status] || s.status}
                        </Pill>

                        <button
                          type="button"
                          onClick={() => toggleMinimize(s._id)}
                          style={{
                            background: '#ffffff',
                            border: '1.5px solid #0f172a',
                            borderRadius: '6px',
                            padding: '2px 8px',
                            fontSize: '0.72rem',
                            fontWeight: 850,
                            color: '#0f172a',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            boxShadow: '1px 1px 0 #0f172a',
                          }}
                          title="Minimize card"
                        >
                          ▲ Minimize
                        </button>
                      </div>
                    </div>

                {/* Card Body */}
                <div style={{ padding: '1.15rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {/* Event Title & Role */}
                  <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                      <Link to={`/events/${s.event?._id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {s.event?.title || 'Volunteering Event'} ↗
                      </Link>
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#4338ca' }}>
                        🎯 Role: {s.role}
                      </span>
                      {s.event?.organization?.name && (
                        <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 650 }}>
                          • Org: {s.event.organization.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Cancellation Reason or Paid Completion Alert */}
                  {s.isEventCancelled && (
                    <div
                      style={{
                        background: '#fee2e2',
                        border: '1.5px solid #ef4444',
                        borderRadius: '10px',
                        padding: '0.6rem 0.75rem',
                      }}
                    >
                      <div
                        style={{
                          color: '#991b1b',
                          fontWeight: 850,
                          fontSize: '0.82rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                        }}
                      >
                        🚫 Event Cancelled by Organizer
                      </div>
                      <div style={{ color: '#7f1d1d', fontSize: '0.78rem', marginTop: '3px', fontWeight: 650 }}>
                        Reason: {s.event?.cancelReason || 'Organizer cancelled this event.'}
                      </div>
                    </div>
                  )}

                  {!s.isEventCancelled && (s.status === 'cancelled' || s.isShiftCancelled) && (
                    <div
                      style={{
                        background: '#fef2f2',
                        border: '1.5px solid #f87171',
                        borderRadius: '10px',
                        padding: '0.55rem 0.75rem',
                      }}
                    >
                      <div style={{ color: '#991b1b', fontWeight: 800, fontSize: '0.82rem' }}>
                        {s.status === 'rejected'
                          ? '✕ Application Declined by Organizer'
                          : `⚠️ Shift Cancelled by You ${s.lateCancel ? '(-5 Reliability Penalty)' : ''}`}
                      </div>
                    </div>
                  )}

                  {s.isPaid && (
                    <div
                      style={{
                        background: '#f0fdf4',
                        border: '1.5px solid #86efac',
                        borderRadius: '10px',
                        padding: '0.55rem 0.75rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ color: '#166534', fontWeight: 850, fontSize: '0.82rem' }}>
                          🎉 Shift Completed & Paid
                        </div>
                        <div style={{ color: '#15803d', fontSize: '0.76rem', fontWeight: 650 }}>
                          Stipend successfully disbursed
                        </div>
                      </div>
                      <span
                        style={{
                          background: '#bbf7d0',
                          color: '#14532d',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: 900,
                          fontSize: '0.84rem',
                          border: '1px solid #14532d',
                        }}
                      >
                        ₹{s.payable?.amount || s.estPay || 0}
                      </span>
                    </div>
                  )}

                  {/* Timing & Pay Pill */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', background: '#f8fafc', padding: '0.45rem 0.75rem', borderRadius: '10px', border: '1.5px solid #e2e8f0' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 750, color: '#0f172a' }}>
                      🕒 {formatShift(s.shift.start, s.shift.end)}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 850, background: '#fef08a', color: '#854d0e', padding: '2px 8px', borderRadius: '5px', border: '1px solid #0f172a' }}>
                      💵 {payLabel(s.shift)}
                    </span>
                  </div>

                  {/* Venue Location & Distance & Directions Button */}
                  <div style={{ background: '#f0fdf4', padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1.5px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.45rem' }}>
                      <div style={{ fontSize: '0.82rem', color: '#166534', fontWeight: 700, lineHeight: 1.35 }}>
                        📍 {s.event?.venue?.name ? `${s.event.venue.name}, ` : ''}
                        {s.event?.venue?.address ? `${s.event.venue.address}, ` : ''}
                        <strong>{s.event?.venue?.city || 'Location TBA'}</strong>
                      </div>

                      {distanceText && (
                        <span style={{ flexShrink: 0, background: '#dcfce7', color: '#14532d', border: '1.2px solid #86efac', padding: '1px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 850 }}>
                          📍 {distanceText}
                        </span>
                      )}
                    </div>

                    {mapsDirectionsUrl && (
                      <div style={{ marginTop: '0.15rem' }}>
                        <a
                          href={mapsDirectionsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 850,
                            color: '#047857',
                            textDecoration: 'none',
                          }}
                        >
                          <span>🗺️ Open Turn-by-Turn Google Maps Directions ↗</span>
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Attendance & Gate Status Pill Bar */}
                  {att && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', padding: '0.35rem 0' }}>
                      <Pill tone={att.status === 'approved' ? 'good' : att.status === 'no_show' || att.status === 'rejected' ? 'bad' : 'neutral'}>
                        Gate: {ATT_LABEL[att.status]}
                      </Pill>
                      {att.late && <Pill tone="warn">⚠️ Late Arrival</Pill>}
                      {att.earlyCheckout && <Pill tone="bad">🏃 Early Departure (-5 Rel)</Pill>}
                      {att.status === 'approved' && (
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#166534' }}>
                          ✓ {hoursText(att.approvedMinutes)} approved
                        </span>
                      )}
                      {att.dispute && <Pill tone="warn">Dispute: {att.dispute}</Pill>}
                    </div>
                  )}

                  {/* Reporting Notes */}
                  {s.shift.notes && (
                    <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 650 }}>
                      📝 <em>"{s.shift.notes}"</em>
                    </span>
                  )}
                </div>

                {/* Card Action Footer */}
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    background: '#f8fafc',
                    borderTop: '2px solid #0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {isConfirmed && !s.isCancelled && !s.isEventCancelled && !s.isPaid ? (
                      <Link
                        to={`/pass/${s.shift._id}`}
                        className="btn btn-primary"
                        style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 850 }}
                      >
                        🎫 QR Pass
                      </Link>
                    ) : s.isCancelled || s.isEventCancelled ? (
                      <span
                        style={{
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          color: '#dc2626',
                          background: '#fee2e2',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: '1.5px solid #f87171',
                        }}
                      >
                        🚫 Pass Deactivated
                      </span>
                    ) : s.isPaid ? (
                      <span
                        style={{
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          color: '#166534',
                          background: '#dcfce7',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: '1.5px solid #86efac',
                        }}
                      >
                        ✓ Settled & Paid
                      </span>
                    ) : null}

                    <a
                      href={makeGoogleCalendarUrl(s.event, s.shift)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-white"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.76rem', border: '1.5px solid #0f172a' }}
                      title="Add to Google Calendar"
                    >
                      📅 Cal
                    </a>
                  </div>

                  <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                    {isUpcoming && isConfirmed && !s.isCancelled && !s.isEventCancelled && (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        style={{ fontSize: '0.76rem', color: '#dc2626' }}
                        onClick={() => {
                          const isLate = shiftStart - Date.now() < 24 * 60 * 60 * 1000;
                          const warn = isLate
                            ? '⚠️ WARNING: This shift starts in less than 24 hours. Cancelling now will reduce your Reliability Score by 5 points.\n\nAre you sure you want to cancel?'
                            : 'Cancel your spot for this shift?';
                          if (window.confirm(warn)) {
                            leave.mutate(s.shift._id);
                          }
                        }}
                        disabled={leave.isPending}
                      >
                        Cancel Spot
                      </button>
                    )}

                    {canDispute && (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        style={{ fontSize: '0.76rem', color: '#b45309', fontWeight: 750 }}
                        onClick={() => {
                          setDisputing(att._id);
                          setDisputeShiftInfo({ eventTitle: s.event?.title, role: s.role });
                        }}
                      >
                        ⚠️ Dispute Hours
                      </button>
                    )}
                  </div>
                </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          title={
            activeTab === 'all'
              ? 'No active volunteering shifts'
              : activeTab === 'confirmed'
              ? 'No confirmed active spots'
              : activeTab === 'pending'
              ? 'No shifts pending review'
              : activeTab === 'completed'
              ? 'No completed & paid shifts'
              : 'No cancelled shifts'
          }
        >
          {activeTab === 'all' ? (
            <div>
              You don't have any active shifts right now. All confirmed and pending shifts will appear here.
              <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link to="/events" className="btn btn-primary" style={{ fontWeight: 850 }}>
                  Explore Open Shifts & Volunteer Roles →
                </Link>
                {completedShifts.length > 0 && (
                  <button type="button" className="btn btn-white" onClick={() => setActiveTab('completed')} style={{ fontWeight: 800 }}>
                    View Completed & Paid ({completedShifts.length})
                  </button>
                )}
                {cancelledShifts.length > 0 && (
                  <button type="button" className="btn btn-white" onClick={() => setActiveTab('cancelled')} style={{ fontWeight: 800 }}>
                    View Cancelled ({cancelledShifts.length})
                  </button>
                )}
              </div>
            </div>
          ) : activeTab === 'completed' ? (
            <div>
              Shifts you have completed and received payment for will be stored here with hours and stipend receipts.
            </div>
          ) : activeTab === 'cancelled' ? (
            <div>
              Shifts where the event was cancelled by the organizer or cancelled by you will be listed here with cancellation reasons.
            </div>
          ) : (
            <div>
              No shifts match the <strong>{activeTab}</strong> filter. Switch back to "All Shifts" or explore new roles!
            </div>
          )}
        </Empty>
      )}
    </div>
  );
}
