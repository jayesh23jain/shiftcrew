import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUserLocation } from '../hooks/useUserLocation.js';
import { CATEGORIES, SHIFT_STATE, SIGNUP_LABEL, formatRange, formatShift, payLabel, makeGoogleMapsDirectionsUrl } from '../lib.js';
import { Empty, Notice, Pill, Spinner, StatusChip } from '../components/ui.jsx';

const CAT_COLORS = {
  sports: '#bbf7d0', // Mint
  music: '#fed7aa', // Peach
  tech: '#ddd6fe', // Lavender
  festival: '#fef08a', // Yellow
  charity: '#fecdd3', // Rose
  conference: '#bae6fd', // Sky Blue
  general: '#e2e8f0',
};

function getGoogleCalUrl(event) {
  try {
    const toGCalDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = toGCalDate(event.startDate);
    const end = toGCalDate(event.endDate || event.startDate);
    const loc = [event.venue?.name, event.venue?.address, event.venue?.city].filter(Boolean).join(', ');
    const details = `${event.description || ''}\n\nManaged via ShiftCrew Operations`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${start}/${end}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;
  } catch {
    return '#';
  }
}

function getGoogleMapsUrl(venue) {
  const query = [venue?.name, venue?.address, venue?.city].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function getShiftUrgency(shift) {
  const now = new Date();
  const start = new Date(shift.start);
  const end = new Date(shift.end);

  if (start <= now && end >= now) {
    return { type: 'chip-live', text: '🟢 Live Shift' };
  }
  const diffHours = (start - now) / (1000 * 60 * 60);
  if (diffHours > 0 && diffHours <= 24) {
    return { type: 'chip-soon', text: '⚡ Starts in < 24h' };
  }
  if (shift.spotsLeft === 1) {
    return { type: 'chip-urgent', text: '🔥 Only 1 spot left!' };
  }
  if (shift.spotsLeft === 0) {
    return { type: 'chip-full', text: '🔒 Shift Full' };
  }
  return null;
}

export default function EventDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const code = params.get('code');
  const qc = useQueryClient();
  const { user } = useAuth();
  const { getDistance } = useUserLocation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', id, code],
    queryFn: async () => (await api.get(`/events/${id}`, { params: code ? { code } : {} })).data,
  });
  const { data: shiftData } = useQuery({
    queryKey: ['shifts', id, code],
    queryFn: async () => (await api.get(`/events/${id}/shifts`, { params: code ? { code } : {} })).data,
    enabled: !!data,
  });
  const { data: board } = useQuery({
    queryKey: ['announcements', id],
    queryFn: async () => (await api.get(`/events/${id}/announcements`)).data.announcements,
    enabled: !!data,
  });

  // Shift Swap Board query
  const { data: swapData = [] } = useQuery({
    queryKey: ['event-swaps', id],
    queryFn: async () => (await api.get(`/events/${id}/swaps`)).data.swaps,
    enabled: !!data && !!user,
    refetchInterval: 15_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['shifts', id] });
    qc.invalidateQueries({ queryKey: ['my-shifts'] });
    qc.invalidateQueries({ queryKey: ['event-swaps', id] });
  };
  const join = useMutation({
    mutationFn: async (shiftId) => (await api.post(`/shifts/${shiftId}/join`, { inviteCode: code || undefined })).data,
    onSuccess: refresh,
  });
  const leave = useMutation({
    mutationFn: async (shiftId) => (await api.post(`/shifts/${shiftId}/leave`)).data,
    onSuccess: refresh,
  });

  const claimSwap = useMutation({
    mutationFn: async (swapId) => (await api.post(`/swaps/${swapId}/claim`)).data,
    onSuccess: () => {
      refresh();
      window.alert('✓ Shift swap claimed! You will be notified once organizer approval is completed.');
    },
    onError: (err) => {
      window.alert(errorMessage(err));
    },
  });

  // Volunteer on-ground issue reporting to Control Room
  const [issueMsg, setIssueMsg] = useState('');
  const [issueCategory, setIssueCategory] = useState('supplies');
  const [issueSent, setIssueSent] = useState(false);

  const reportIssue = useMutation({
    mutationFn: async ({ category, message }) =>
      (await api.post(`/events/${id}/mission/report-issue`, { category, message })).data,
    onSuccess: () => {
      setIssueMsg('');
      setIssueSent(true);
      setTimeout(() => setIssueSent(false), 5000);
    },
  });

  if (isLoading) return <Spinner label="Loading event details..." />;
  if (error) {
    return (
      <Empty title="We could not open this event">
        {error.response?.status === 404 ? 'It may have been removed, or it is not public.' : errorMessage(error)}
        {' '}<Link to="/events">Back to events</Link>
      </Empty>
    );
  }

  const { event, canManage } = data;
  const roles = Array.isArray(data.roles) ? data.roles : [];
  const org = data.organization || event.organization;
  const shifts = Array.isArray(shiftData?.shifts) ? shiftData.shifts : [];
  const open = shifts.filter((s) => s.state !== 'cancelled');
  const visibleShifts = canManage ? open : open.filter((s) => s.state !== 'completed');
  const actionError = join.error || leave.error;
  const distance = getDistance(event?.venue);
  const mapsUrl = event?.venue ? makeGoogleMapsDirectionsUrl(event.venue) : getGoogleMapsUrl(event?.venue);
  const calUrl = getGoogleCalUrl(event);

  const headerColor = CAT_COLORS[event.category] || '#bae6fd';

  // Check if current user is registered for any shift in this event
  const registeredShift = shifts.find((s) => s.mySignup && ['confirmed', 'waitlisted', 'pending'].includes(s.mySignup.status));

  const isOngoing =
    event.status === 'ongoing' ||
    (event.startDate &&
      event.endDate &&
      new Date(event.startDate) <= new Date() &&
      new Date(event.endDate) >= new Date());

  return (
    <article className="organizer-dashboard-wrap" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3.5rem' }}>
      {/* 1. Neo-Brutalist Event Hero Banner */}
      <div
        style={{
          background: '#ffffff',
          border: '3px solid #0f172a',
          borderRadius: '24px',
          boxShadow: '6px 6px 0px #0f172a',
          overflow: 'hidden',
          marginBottom: '1.75rem',
        }}
      >
        {/* Category Header Ribbon */}
        <div
          style={{
            background: headerColor,
            borderBottom: '2.5px solid #0f172a',
            padding: '0.85rem 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.65rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                background: '#0f172a',
                color: '#ffffff',
                padding: '3px 9px',
                borderRadius: '6px',
                letterSpacing: '0.5px',
              }}
            >
              {CATEGORIES[event.category] || event.category || 'Event'}
            </span>

            {isOngoing && (
              <span className="live-tag" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                <span className="live-pulse-dot" /> LIVE EVENT
              </span>
            )}

            {event.applicationMode === 'approval' ? (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  background: '#fef3c7',
                  color: '#92400e',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  border: '1.2px solid #b45309',
                }}
              >
                ✋ Organizer Approval Required
              </span>
            ) : (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  background: '#dcfce7',
                  color: '#15803d',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  border: '1.2px solid #16a34a',
                }}
              >
                ⚡ Instant Sign-Up
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {org?.name && (
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  background: '#ffffff',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  border: '1.5px solid #0f172a',
                }}
              >
                🏢 {org.name}
              </span>
            )}
            <StatusChip status={event.status} />
          </div>
        </div>

        {/* Hero Body Content */}
        <div style={{ padding: '1.75rem 2rem' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2.5rem',
              fontWeight: 950,
              color: '#0f172a',
              margin: '0 0 1rem',
              lineHeight: 1.15,
            }}
          >
            {event.title}
          </h1>

          {/* Subline Meta Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1.15rem',
              fontSize: '0.94rem',
              fontWeight: 700,
              color: '#334155',
              marginBottom: '1.35rem',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              📅 {formatRange(event.startDate, event.endDate)}
            </span>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              📍 {event.venue?.name ? `${event.venue.name}, ` : ''}{event.venue?.city || 'Location TBA'}
            </span>

            {distance && (
              <span
                style={{
                  background: '#ecfdf5',
                  color: '#047857',
                  border: '1.5px solid #0f172a',
                  padding: '2px 9px',
                  borderRadius: '999px',
                  fontSize: '0.78rem',
                  fontWeight: 850,
                }}
              >
                📍 {distance} from you
              </span>
            )}
          </div>

          {/* Action Buttons Bar */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{
                  fontWeight: 850,
                  fontSize: '0.86rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0.55rem 1.25rem',
                }}
              >
                🗺️ Open in Google Maps ↗
              </a>
            )}

            <a
              href={calUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-white"
              style={{
                fontWeight: 800,
                fontSize: '0.86rem',
                border: '2px solid #0f172a',
                padding: '0.55rem 1.15rem',
              }}
            >
              📅 Add to Calendar
            </a>

            {canManage && (
              <Link
                className="btn btn-white"
                to={`/manage/events/${event._id}`}
                style={{
                  fontWeight: 850,
                  fontSize: '0.86rem',
                  border: '2px solid #0f172a',
                  padding: '0.55rem 1.25rem',
                  background: '#fef08a',
                  color: '#854d0e',
                }}
              >
                ⚙️ Event Operations Dashboard →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 2. Notice Board (if any announcements) */}
      {Array.isArray(board) && board.length > 0 && (
        <section
          style={{
            background: '#fffbeb',
            border: '2.5px solid #f59e0b',
            borderRadius: '16px',
            boxShadow: '4px 4px 0 #f59e0b',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.75rem',
          }}
          aria-label="Announcements"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.3rem' }}>📢</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 950, color: '#92400e' }}>
              Organizer Broadcast & Notice Board
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {board.slice(0, 3).map((a) => (
              <div
                key={a._id}
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #f59e0b',
                  borderRadius: '10px',
                  padding: '0.85rem 1.1rem',
                }}
              >
                <strong style={{ fontSize: '0.98rem', color: '#0f172a', display: 'block', marginBottom: '0.2rem' }}>
                  {a.title || 'Broadcast Update'}
                </strong>
                <p style={{ margin: 0, color: '#334155', fontSize: '0.88rem', lineHeight: '1.5' }}>
                  {a.message}
                </p>
                {a.createdAt && (
                  <span style={{ display: 'block', fontSize: '0.74rem', color: '#78350f', marginTop: '0.35rem', fontWeight: 600 }}>
                    Posted on {new Date(a.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Main 2-Column Bento Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.75rem', alignItems: 'start' }}>
        {/* Left Column: About & Venue Details */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
          {/* About Event Card */}
          <div className="dash-card" style={{ background: '#ffffff', borderRadius: '20px', padding: '1.5rem', border: '2.5px solid #0f172a', boxShadow: '4px 4px 0px #0f172a' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', margin: '0 0 0.85rem', color: '#0f172a', fontWeight: 950 }}>
              About this event
            </h2>
            <p className="prose" style={{ color: '#334155', lineHeight: '1.65', fontSize: '0.94rem', margin: '0 0 1.25rem' }}>
              {event.description || 'The organizer has not added a detailed description yet.'}
            </p>

            {/* Quick Benefits Tags */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1.5px solid #e2e8f0', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 750, color: '#166534' }}>
                <span>✓</span> Verified Volunteering Certificate issued upon shift completion
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 750, color: '#166534' }}>
                <span>✓</span> Direct UPI stipend disbursement for approved duty hours
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 750, color: '#166534' }}>
                <span>✓</span> Gate scanner QR pass provided for fast on-site verification
              </div>
            </div>

            {event.applicationMode === 'approval' && (
              <div style={{ marginTop: '1.15rem' }}>
                <Notice tone="info">
                  <strong>Approval Required:</strong> The organizer reviews each volunteer application. Your spot remains pending until approved.
                </Notice>
              </div>
            )}
          </div>

          {/* Venue & Maps Card */}
          <div className="dash-card" style={{ background: '#f0fdf4', borderRadius: '20px', padding: '1.5rem', border: '2.5px solid #0f172a', boxShadow: '4px 4px 0px #0f172a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', color: '#166534', letterSpacing: '0.5px' }}>
                  EVENT VENUE & REPORTING DESK
                </span>
                <h3 style={{ margin: '0.2rem 0 0', fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 950, color: '#0f172a' }}>
                  {event.venue?.name || 'Venue TBA'}
                </h3>
              </div>

              {distance && (
                <span style={{ background: '#dcfce7', color: '#14532d', border: '1.5px solid #0f172a', padding: '2px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 850 }}>
                  📍 {distance}
                </span>
              )}
            </div>

            <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: '#166534', fontWeight: 650, lineHeight: '1.4' }}>
              📍 {event.venue?.address ? `${event.venue.address}, ` : ''}
              <strong>{event.venue?.city || 'City Location'}</strong>
            </p>

            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontWeight: 850, padding: '0.55rem 1rem' }}
              >
                🗺️ Open Turn-by-Turn GPS Directions ↗
              </a>
            )}
          </div>

          {/* Reporting Desk Guidelines Card */}
          <div className="dash-card" style={{ background: '#ffffff', borderRadius: '20px', padding: '1.5rem', border: '2.5px solid #0f172a', boxShadow: '4px 4px 0px #0f172a' }}>
            <h4 style={{ margin: '0 0 1rem', fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 950, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
              📋 Crew Reporting Checklist
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                <span style={{ background: '#0f172a', color: '#ffffff', width: '22px', height: '22px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0 }}>
                  1
                </span>
                <span style={{ fontSize: '0.86rem', color: '#334155', fontWeight: 650, lineHeight: '1.4' }}>
                  <strong>Arrival Time:</strong> Arrive at the reporting desk 15 minutes prior to shift start for duty briefing.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                <span style={{ background: '#0f172a', color: '#ffffff', width: '22px', height: '22px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0 }}>
                  2
                </span>
                <span style={{ fontSize: '0.86rem', color: '#334155', fontWeight: 650, lineHeight: '1.4' }}>
                  <strong>Digital QR Pass:</strong> Have your pass ready from <Link to="/my-shifts" style={{ color: '#4338ca', fontWeight: 850, textDecoration: 'underline' }}>My Shifts</Link> for gate check-in.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                <span style={{ background: '#0f172a', color: '#ffffff', width: '22px', height: '22px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0 }}>
                  3
                </span>
                <span style={{ fontSize: '0.86rem', color: '#334155', fontWeight: 650, lineHeight: '1.4' }}>
                  <strong>Automatic Accreditation:</strong> Your check-in records live attendance hours towards your certificate & stipend release.
                </span>
              </div>
            </div>
          </div>

          {/* Volunteer Ground Issue Reporting Card */}
          <div
            className="dash-card"
            style={{
              background: '#fff1f2',
              borderRadius: '20px',
              padding: '1.5rem',
              border: '2.5px solid #0f172a',
              boxShadow: '4px 4px 0px #0f172a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.65rem' }}>
              <span style={{ fontSize: '1.4rem' }}>🚨</span>
              <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 950, color: '#991b1b' }}>
                Report Issue to Event Control Room
              </h4>
            </div>

            <p style={{ margin: '0 0 1rem', fontSize: '0.84rem', color: '#881337', fontWeight: 650, lineHeight: '1.45' }}>
              Experiencing an on-ground problem, shortage, or safety issue? Send an alert directly to the event team in the Mission Control room in real-time.
            </p>

            {issueSent && (
              <div style={{ marginBottom: '1rem' }}>
                <Notice tone="success">
                  ✓ Incident reported to Control Room! The operations team has received your alert.
                </Notice>
              </div>
            )}

            {reportIssue.error && (
              <div style={{ marginBottom: '1rem' }}>
                <Notice tone="danger">{errorMessage(reportIssue.error)}</Notice>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!issueMsg.trim()) return;
                reportIssue.mutate({ category: issueCategory, message: issueMsg.trim() });
              }}
            >
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  Category:
                </label>
                <select
                  value={issueCategory}
                  onChange={(e) => setIssueCategory(e.target.value)}
                  style={{
                    width: '100%',
                    border: '1.5px solid #0f172a',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '0.84rem',
                    fontWeight: 750,
                    background: '#ffffff',
                  }}
                >
                  <option value="supplies">💧 Water / Food / Supplies Shortage</option>
                  <option value="crowd">👥 Crowd Control & Safety Alert</option>
                  <option value="checkin">🎟️ Check-In Desk / QR Pass Scanning Problem</option>
                  <option value="tech">💻 Technical / Sound / Audio Equipment Issue</option>
                  <option value="safety">🛡️ Medical / Emergency / Safety Incident</option>
                  <option value="other">⚡ Other Ground Problem</option>
                </select>
              </div>

              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  Issue Description:
                </label>
                <textarea
                  required
                  rows={3}
                  value={issueMsg}
                  onChange={(e) => setIssueMsg(e.target.value)}
                  placeholder="Describe what's happening (e.g. 'East entrance is running out of wristbands', 'Barricade loose near stage')..."
                  style={{
                    width: '100%',
                    border: '1.5px solid #0f172a',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '0.86rem',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={reportIssue.isPending || !issueMsg.trim()}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '8px 14px',
                  fontWeight: 900,
                  fontSize: '0.88rem',
                  background: '#e11d48',
                  color: '#ffffff',
                  border: '2px solid #0f172a',
                  boxShadow: '3px 3px 0px #0f172a',
                }}
              >
                {reportIssue.isPending ? 'Sending Alert...' : '🚨 Send Urgent Alert to Control Room'}
              </button>
            </form>
          </div>
        </section>

        {/* Right Column: Shift Passes & Booking */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
          {/* Registered Crew Alert Banner */}
          {registeredShift && (
            <div
              style={{
                background: '#fef9c3',
                border: '2.5px solid #0f172a',
                borderRadius: '16px',
                padding: '1.15rem',
                boxShadow: '4px 4px 0px #0f172a',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', color: '#854d0e', letterSpacing: '0.5px' }}>
                    YOUR ACTIVE BOOKING
                  </span>
                  <div style={{ fontSize: '1rem', fontWeight: 900, color: '#0f172a', marginTop: '0.15rem' }}>
                    🎉 Enrolled for {registeredShift.roleName || 'Crew Duty'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {registeredShift.mySignup?.status === 'confirmed' && (
                    <Link to={`/pass/${registeredShift._id}`} className="btn btn-primary" style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 850 }}>
                      🎫 QR Pass
                    </Link>
                  )}
                  <Link to="/my-shifts" className="btn btn-white" style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 800, border: '1.5px solid #0f172a' }}>
                    My Shifts →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Volunteer Shift Swap Board (Visible to volunteers) */}
          {user?.role === 'volunteer' && (
            <div
              className="dash-card"
              style={{
                background: '#ffffff',
                borderRadius: '20px',
                padding: '1.4rem',
                border: '2.5px solid #0f172a',
                boxShadow: '4px 4px 0px #0f172a',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.35rem' }}>🔄</span>
                  <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 950, color: '#0f172a' }}>
                    Shift Swap Board
                  </h3>
                </div>
                <span
                  style={{
                    fontSize: '0.74rem',
                    fontWeight: 850,
                    padding: '2px 9px',
                    borderRadius: '999px',
                    background: '#e0e7ff',
                    color: '#3730a3',
                    border: '1.2px solid #0f172a',
                  }}
                >
                  {swapData.length} Open {swapData.length === 1 ? 'Offer' : 'Offers'}
                </span>
              </div>

              <p style={{ margin: '0 0 1rem', fontSize: '0.84rem', color: '#475569', fontWeight: 650 }}>
                Shifts offered by crew members who need a handover without late-cancel penalties. Claim an open shift to take their spot!
              </p>

              {swapData.length === 0 ? (
                <div style={{ background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.84rem', color: '#64748b', fontWeight: 650 }}>
                    No shifts currently on the swap board. If you cannot attend your confirmed shift, you can offer it for swap from your <Link to="/my-shifts" style={{ color: '#4338ca', fontWeight: 800, textDecoration: 'underline' }}>My Shifts</Link> page!
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {swapData.map((sw) => {
                    const shift = sw.shiftId || {};
                    return (
                      <div
                        key={sw._id}
                        style={{
                          background: '#f8fafc',
                          border: '2px solid #0f172a',
                          borderRadius: '12px',
                          padding: '0.9rem 1.1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <div style={{ fontWeight: 900, color: '#0f172a', fontSize: '0.95rem' }}>
                              🎯 {shift.role?.name || 'Volunteer Duty'}
                            </div>
                            <div style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 700, marginTop: '2px' }}>
                              ⏰ {formatShift(shift.start, shift.end)}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '0.84rem', fontWeight: 900, color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: '6px', border: '1px solid #16a34a' }}>
                              {payLabel(shift)}
                            </span>
                          </div>
                        </div>

                        {/* Offered by & note */}
                        <div style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 650 }}>
                          Offered by: <strong>{sw.fromUser?.name || 'Volunteer'}</strong> (⭐ {sw.fromUser?.reliabilityScore ?? 100} Rel)
                          {sw.note && (
                            <div style={{ fontStyle: 'italic', color: '#475569', marginTop: '2px' }}>
                              "{sw.note}"
                            </div>
                          )}
                        </div>

                        {/* Claim action */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '0.25rem' }}>
                          {sw.isOfferer ? (
                            <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#4338ca', background: '#e0e7ff', padding: '3px 8px', borderRadius: '6px' }}>
                              Your Swap Offer
                            </span>
                          ) : sw.isEligible ? (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => {
                                if (window.confirm('Claim this shift? If organizer approval is enabled, your spot will be locked once reviewed.')) {
                                  claimSwap.mutate(sw._id);
                                }
                              }}
                              disabled={claimSwap.isPending}
                              style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 900 }}
                            >
                              {claimSwap.isPending ? 'Claiming...' : 'Claim Shift 🤝'}
                            </button>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.74rem',
                                fontWeight: 800,
                                color: '#991b1b',
                                background: '#fee2e2',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                border: '1px solid #f87171',
                              }}
                            >
                              ⚠️ {sw.ineligibilityReason || 'Ineligible'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Shift Passes Section Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', margin: 0, color: '#0f172a', fontWeight: 950 }}>
              Available Shift Passes
            </h2>
            <span style={{ fontSize: '0.82rem', fontWeight: 850, background: '#ffffff', border: '2px solid #0f172a', padding: '3px 12px', borderRadius: '999px', color: '#0f172a', boxShadow: '2px 2px 0 #0f172a' }}>
              {visibleShifts.length} {visibleShifts.length === 1 ? 'Slot' : 'Slots'} Open
            </span>
          </div>

          <Notice>{actionError && errorMessage(actionError)}</Notice>

          {roles.length === 0 ? (
            <div className="dash-card" style={{ textAlign: 'center', padding: '2rem', background: '#ffffff', borderRadius: '18px', border: '2px solid #0f172a' }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#64748b' }}>
                No volunteer roles have been published for this event yet.
              </p>
            </div>
          ) : visibleShifts.length === 0 ? (
            <div className="dash-card" style={{ textAlign: 'center', padding: '2rem', background: '#ffffff', borderRadius: '18px', border: '2px dashed #94a3b8' }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#64748b' }}>
                No active shifts open at the moment. Please check back soon!
              </p>
            </div>
          ) : (
            roles.map((r) => {
              const list = visibleShifts.filter((s) => String(s.roleId) === String(r._id));
              if (!list.length) return null;

              return (
                <div key={r._id} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Role Header */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.65rem' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', margin: 0, color: '#0f172a', fontWeight: 950 }}>
                      🎯 {r.name}
                    </h3>
                    {r.description && (
                      <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                        — {r.description}
                      </span>
                    )}
                  </div>

                  {list.map((s) => {
                    const my = s.mySignup;
                    const active = my && ['confirmed', 'pending', 'waitlisted'].includes(my.status);
                    const bookable = ['open', 'full'].includes(s.state);
                    const urgency = getShiftUrgency(s);

                    // Live fill rate percentage calculation
                    const confirmedCount = s.confirmed ?? (s.capacity - s.spotsLeft);
                    const fillPercent = Math.min(100, Math.max(0, Math.round((confirmedCount / s.capacity) * 100)));
                    const isAlmostFull = s.spotsLeft <= 2 && s.spotsLeft > 0;
                    const isFull = s.spotsLeft === 0;

                    return (
                      <div
                        key={s._id}
                        style={{
                          background: '#ffffff',
                          border: '2.5px solid #0f172a',
                          borderRadius: '16px',
                          boxShadow: '4px 4px 0px #0f172a',
                          padding: '1.25rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.85rem',
                        }}
                      >
                        {/* Top Timing & Urgency Badges */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                            🕒 {formatShift(s.start, s.end)}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            {urgency && (
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 850,
                                  padding: '2px 8px',
                                  borderRadius: '5px',
                                  border: '1.2px solid #0f172a',
                                  background: urgency.type === 'chip-urgent' ? '#fee2e2' : '#fef08a',
                                  color: urgency.type === 'chip-urgent' ? '#991b1b' : '#854d0e',
                                }}
                              >
                                {urgency.text}
                              </span>
                            )}

                            <span
                              style={{
                                fontSize: '0.78rem',
                                fontWeight: 900,
                                background: '#fef08a',
                                color: '#854d0e',
                                padding: '2px 8px',
                                borderRadius: '5px',
                                border: '1.2px solid #0f172a',
                              }}
                            >
                              💵 {payLabel(s)}
                            </span>
                          </div>
                        </div>

                        {/* Fill Rate Meter */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 800, marginBottom: '0.35rem' }}>
                            <span>
                              👥 Crew Fill: <strong>{confirmedCount} / {s.capacity} spots</strong>
                            </span>
                            <span style={{ color: isFull ? '#64748b' : isAlmostFull ? '#b45309' : '#166534' }}>
                              {s.spotsLeft > 0 ? `${s.spotsLeft} spot(s) remaining` : `Full ${s.waitlistCount ? `(${s.waitlistCount} waiting)` : ''}`}
                            </span>
                          </div>

                          <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '999px', border: '1.5px solid #0f172a', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${fillPercent}%`,
                                height: '100%',
                                background: isFull ? '#94a3b8' : isAlmostFull ? '#f59e0b' : '#22c55e',
                                transition: 'width 0.4s ease',
                              }}
                            />
                          </div>
                        </div>

                        {/* Notes */}
                        {s.notes && (
                          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 650 }}>
                            📝 <em>"{s.notes}"</em>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{ borderTop: '1.5px solid #f1f5f9', paddingTop: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {active && my.status === 'confirmed' && (
                              <Pill tone="good">✓ Confirmed Spot</Pill>
                            )}
                            {active && my.status === 'pending' && (
                              <Pill tone="warn">⏳ Pending Review</Pill>
                            )}
                            {active && my.status === 'waitlisted' && (
                              <Pill tone="neutral">📋 On Waitlist</Pill>
                            )}
                            {my?.status === 'rejected' && (
                              <Pill tone="bad">Declined</Pill>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {/* Confirmed actions */}
                            {active && my.status === 'confirmed' && (
                              <>
                                <Link to={`/pass/${s._id}`} className="btn btn-primary" style={{ padding: '0.42rem 0.85rem', fontSize: '0.78rem', fontWeight: 850 }}>
                                  🎫 QR Pass
                                </Link>
                                {s.state !== 'in_progress' && s.state !== 'completed' && (
                                  <button
                                    type="button"
                                    className="btn btn-quiet"
                                    onClick={() => leave.mutate(s._id)}
                                    disabled={leave.isPending}
                                    style={{ fontSize: '0.78rem', color: '#dc2626' }}
                                  >
                                    Cancel Spot
                                  </button>
                                )}
                              </>
                            )}

                            {/* Pending actions */}
                            {active && my.status === 'pending' && (
                              <button
                                type="button"
                                className="btn btn-quiet"
                                onClick={() => leave.mutate(s._id)}
                                disabled={leave.isPending}
                                style={{ fontSize: '0.78rem', color: '#dc2626' }}
                              >
                                Withdraw Request
                              </button>
                            )}

                            {/* Waitlisted actions */}
                            {active && my.status === 'waitlisted' && (
                              <button
                                type="button"
                                className="btn btn-quiet"
                                onClick={() => leave.mutate(s._id)}
                                disabled={leave.isPending}
                                style={{ fontSize: '0.78rem' }}
                              >
                                Leave Waitlist
                              </button>
                            )}

                            {/* Bookable actions */}
                            {!active && my?.status !== 'rejected' && bookable && !canManage && (
                              <>
                                {s.state === 'full' ? (
                                  <button
                                    type="button"
                                    className="btn btn-white"
                                    onClick={() => join.mutate(s._id)}
                                    disabled={join.isPending}
                                    style={{ fontWeight: 850, border: '1.5px solid #0f172a', padding: '0.45rem 1rem' }}
                                  >
                                    {join.isPending ? 'Joining...' : '🎟️ Join Waitlist'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => join.mutate(s._id)}
                                    disabled={join.isPending}
                                    style={{ fontWeight: 900, padding: '0.48rem 1.15rem' }}
                                  >
                                    {join.isPending
                                      ? 'Applying...'
                                      : event.applicationMode === 'approval'
                                      ? '✋ Request Spot'
                                      : '⚡ Claim Spot'}
                                  </button>
                                )}
                              </>
                            )}

                            {!active && !bookable && (
                              <Pill>{SHIFT_STATE[s.state]}</Pill>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </section>
      </div>
    </article>
  );
}
