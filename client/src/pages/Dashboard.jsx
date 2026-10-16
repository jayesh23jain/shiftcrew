import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CATEGORIES, ORG_TYPES, formatRange, formatShift, hoursText, rupees, payLabel } from '../lib.js';
import { Empty, EventBadge, Field, Notice, Pill, Spinner, StatusChip } from '../components/ui.jsx';

function makeGoogleCalendarUrl(event, shift) {
  try {
    const start = new Date(shift?.start || event?.startDate).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const end = new Date(shift?.end || event?.endDate).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const loc = [event?.venue?.name, event?.venue?.address, event?.venue?.city].filter(Boolean).join(', ');
    const details = `ShiftCrew Volunteering Shift: ${shift?.role || 'Crew'} for ${event?.title || 'Event'}.`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      event?.title || 'Volunteering Shift'
    )}&dates=${start}/${end}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;
  } catch {
    return '#';
  }
}

function getCountdownText(start, end) {
  const now = new Date();
  const s = new Date(start);
  const e = new Date(end);
  if (s <= now && e >= now) return '🔴 Happening Now';
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

export default function Dashboard() {
  const { user } = useAuth();
  return user.role === 'volunteer' ? <VolunteerHome user={user} /> : <OrganizerHome user={user} />;
}

function VolunteerHome({ user }) {
  // Calendar State for Crew Schedule
  const [calDate, setCalDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 1. Crew Stats (hours, reliability, completed shifts, earned)
  const { data: stats } = useQuery({
    queryKey: ['my-stats'],
    queryFn: async () => (await api.get('/me/stats')).data,
    refetchInterval: 20_000,
  });

  // 2. Volunteer Shifts & Schedule
  const { data: mine = [], isLoading: shiftsLoading } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: async () => (await api.get('/me/shifts')).data.signups,
    refetchInterval: 15_000,
  });

  // 3. Certificates count
  const { data: certs = [] } = useQuery({
    queryKey: ['my-certificates'],
    queryFn: async () => (await api.get('/certificates/mine')).data.certificates,
  });

  // 4. Earnings & Payouts summary
  const { data: earningsData } = useQuery({
    queryKey: ['my-earnings'],
    queryFn: async () => (await api.get('/payouts/mine')).data,
  });

  // 5. Payout Method (UPI Status)
  const { data: payoutMethod } = useQuery({
    queryKey: ['payout-method'],
    queryFn: async () => (await api.get('/payouts/method')).data.method,
  });

  // 6. Recommended Events in city
  const { data: recommendedData, isLoading: recLoading } = useQuery({
    queryKey: ['events', 'home-recommended', user.city],
    queryFn: async () => (await api.get('/events', { params: { limit: 4, ...(user.city ? { city: user.city } : {}) } })).data,
  });

  const profileDone = user.phone && user.city && user.skills?.length;

  // Calendar calculations
  const calYear = calDate.getFullYear();
  const calMonth = calDate.getMonth();
  const firstDayIndex = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const prevMonth = () => setCalDate(new Date(calYear, calMonth - 1, 1));
  const nextMonth = () => setCalDate(new Date(calYear, calMonth + 1, 1));
  const goToToday = () => {
    const d = new Date();
    setCalDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(d);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Helper: check shifts for a specific day
  const getShiftsForDay = (dayNum) => {
    const dayStart = new Date(calYear, calMonth, dayNum, 0, 0, 0);
    const dayEnd = new Date(calYear, calMonth, dayNum, 23, 59, 59);

    return (mine || []).filter((s) => {
      if (!s.shift?.start) return false;
      const shiftStart = new Date(s.shift.start);
      return shiftStart <= dayEnd && shiftStart >= dayStart;
    });
  };

  const selectedDayNum =
    selectedDate.getFullYear() === calYear && selectedDate.getMonth() === calMonth
      ? selectedDate.getDate()
      : null;

  const selectedDayShifts = selectedDayNum ? getShiftsForDay(selectedDayNum) : [];

  // Hero Shift Finder (Feature 2)
  const now = new Date();
  const ongoingShift = (mine || []).find((s) => {
    if (!s.shift) return false;
    const start = new Date(s.shift.start);
    const end = new Date(s.shift.end);
    const active = start <= now && end >= now;
    const checkedIn = s.attendance?.status === 'checked_in';
    return s.status === 'confirmed' && (active || checkedIn);
  });

  const nextUpcomingConfirmed = (mine || [])
    .filter((s) => s.shift && s.status === 'confirmed' && new Date(s.shift.start) > now)
    .sort((a, b) => new Date(a.shift.start) - new Date(b.shift.start))[0];

  const heroShift = ongoingShift || nextUpcomingConfirmed;
  const isHeroOngoing = Boolean(ongoingShift && heroShift?._id === ongoingShift?._id);

  const nextUp = (mine || [])
    .filter((s) => s.shift && s.status === 'confirmed' && new Date(s.shift.end) >= now)
    .sort((a, b) => new Date(a.shift.start) - new Date(b.shift.start))
    .slice(0, 3);

  const CARD_PALETTE = ['#bbf7d0', '#ddd6fe', '#fef08a', '#fecdd3', '#bae6fd', '#fed7aa'];

  return (
    <div className="organizer-dashboard-wrap">
      {/* Welcome Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 950, color: '#0f172a', margin: 0 }}>
            Hi {user.name.split(' ')[0]} 👋
          </h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.94rem', color: '#64748b', fontWeight: 650 }}>
            Welcome to your ShiftCrew portal. Track your service hours, access live gate passes, and collect verifiable credentials.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#166534', padding: '6px 14px', fontSize: '0.82rem' }}>
            ⭐ {stats?.reliability || user.reliabilityScore || 100}% Reliability Score
          </span>
        </div>
      </div>

      {/* Profile Incomplete Notice */}
      {!profileDone && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Notice tone="info">
            💡 <strong>Complete your profile:</strong> Add your phone number, city, and volunteer skills to unlock high-priority shift approvals. <Link to="/profile" style={{ fontWeight: 850, textDecoration: 'underline' }}>Complete Profile →</Link>
          </Notice>
        </div>
      )}

      {/* Feature 1: Top 4 Neo-Brutalist Crew Impact KPI Stat Cards */}
      <div className="dash-stats-grid">
        <div className="dash-stat-card stat-mint">
          <span className="dash-stat-label">Verified Service</span>
          <span className="dash-stat-val">{hoursText(stats?.minutes || 0)}</span>
          <span className="dash-stat-hint">{stats?.shifts || 0} approved shift(s) completed</span>
        </div>

        <div className="dash-stat-card stat-yellow">
          <span className="dash-stat-label">Stipends Earned</span>
          <span className="dash-stat-val">{rupees(stats?.earned || earningsData?.totals?.paid || 0)}</span>
          <span className="dash-stat-hint">
            {earningsData?.totals?.pending ? `+${rupees(earningsData.totals.pending)} pending` : 'All approved stipends settled'}
          </span>
        </div>

        <div className="dash-stat-card stat-lavender">
          <span className="dash-stat-label">Reliability Score</span>
          <span className="dash-stat-val">{stats?.reliability || user.reliabilityScore || 100}%</span>
          <span className="dash-stat-hint">{stats?.attendanceRate || 100}% on-time check-in record</span>
        </div>

        <div className="dash-stat-card stat-peach">
          <span className="dash-stat-label">Verified Credentials</span>
          <span className="dash-stat-val">{certs.length}</span>
          <span className="dash-stat-hint">Official certificates issued</span>
        </div>
      </div>

      {/* Feature 2: Live Shift Pass & Gate Ready Hero Card */}
      {heroShift ? (
        <div className="crew-hero-ticket">
          <div className="crew-hero-ticket-left">
            <div className="crew-hero-tag-row">
              {isHeroOngoing ? (
                <span className="upcoming-label-tag live-tag">
                  <span className="live-pulse-dot" />
                  YOU ARE ON DUTY NOW
                </span>
              ) : (
                <span className="upcoming-label-tag" style={{ background: '#bbf7d0', color: '#166534', border: '1.5px solid #0f172a' }}>
                  ⚡ {getCountdownText(heroShift.shift.start, heroShift.shift.end)}
                </span>
              )}
              <span className="crew-hero-role-chip">
                🎯 {heroShift.role}
              </span>
            </div>

            <h2 className="crew-hero-title">{heroShift.event?.title}</h2>

            <div className="crew-hero-meta-row">
              <span>🕒 {formatShift(heroShift.shift.start, heroShift.shift.end)}</span>
              <span>📍 {heroShift.event?.venue?.name ? `${heroShift.event.venue.name}, ` : ''}{heroShift.event?.venue?.city || 'Location TBA'}</span>
              <span>💵 {payLabel(heroShift.shift)}</span>
            </div>

            <p style={{ margin: '0.45rem 0 0', fontSize: '0.84rem', color: '#334155', fontWeight: 650 }}>
              📝 {heroShift.shift.notes || 'Reporting Desk check-in required. Arrive 15 minutes before start with your QR pass.'}
            </p>
          </div>

          <div className="crew-hero-ticket-right">
            <Link
              to={`/pass/${heroShift.shift._id}`}
              className="upcoming-action-btn"
              style={{ background: '#0f172a', color: '#ffffff', width: '100%', justifyContent: 'center' }}
            >
              <span>🎫 Open Gate QR Pass</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </Link>

            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <a
                href={makeGoogleCalendarUrl(heroShift.event, heroShift.shift)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-white"
                style={{ flex: 1, fontSize: '0.78rem', padding: '0.45rem 0.65rem', textAlign: 'center', justifyContent: 'center' }}
              >
                📅 Add to Cal
              </a>
              <Link
                to="/my-shifts"
                className="btn btn-quiet"
                style={{ flex: 1, fontSize: '0.78rem', padding: '0.45rem 0.65rem', textAlign: 'center', justifyContent: 'center' }}
              >
                Shift Details
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="crew-hero-empty-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.65rem' }}>✨</span>
            <div>
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#0f172a' }}>
                Ready for your next volunteer shift?
              </strong>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                Explore open shifts in your city, earn verified community service hours, and get certificates!
              </p>
            </div>
          </div>
          <Link to="/events" className="btn btn-primary" style={{ fontWeight: 900, whiteSpace: 'nowrap' }}>
            Browse Open Roles ↗
          </Link>
        </div>
      )}

      {/* Feature 5: Quick Actions Bar */}
      <div className="crew-quick-actions-bar">
        <Link to="/my-shifts" className="crew-quick-action-card">
          <div className="crew-quick-icon" style={{ background: '#fef08a' }}>🎫</div>
          <div className="crew-quick-text">
            <strong>My Digital Passes</strong>
            <span>Active & upcoming shifts</span>
          </div>
        </Link>

        <Link to="/profile" className="crew-quick-action-card">
          <div className="crew-quick-icon" style={{ background: '#bbf7d0' }}>💳</div>
          <div className="crew-quick-text">
            <strong>UPI Payout Status</strong>
            <span>{payoutMethod?.upiMasked ? `Verified (${payoutMethod.upiMasked})` : '⚠️ Set up UPI for stipends'}</span>
          </div>
        </Link>

        <Link to="/certificates" className="crew-quick-action-card">
          <div className="crew-quick-icon" style={{ background: '#ddd6fe' }}>🎓</div>
          <div className="crew-quick-text">
            <strong>Verified Credentials</strong>
            <span>{certs.length} certificate(s) issued</span>
          </div>
        </Link>

        <Link to="/earnings" className="crew-quick-action-card">
          <div className="crew-quick-icon" style={{ background: '#fed7aa' }}>💰</div>
          <div className="crew-quick-text">
            <strong>Earnings & Payouts</strong>
            <span>{earningsData?.totals?.paid ? `${rupees(earningsData.totals.paid)} disbursed` : 'Track payout status'}</span>
          </div>
        </Link>
      </div>

      {/* Two-Column Bento Layout (Left: Coming up list + Recommended Events; Right: Calendar) */}
      <div className="dash-bento-split">
        {/* Left Column */}
        <div>
          {/* Coming Up Shifts List (Existing feature modernized) */}
          <div className="dash-card">
            <div className="dash-card-header">
              <h2 className="dash-card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                My Upcoming Shifts ({nextUp.length})
              </h2>
              <Link to="/my-shifts" className="dash-alert-link">
                View All Shifts ↗
              </Link>
            </div>

            {nextUp.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {nextUp.map((s) => (
                  <div key={s._id} className="shift-timeline-item">
                    <div className="shift-timeline-top">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>{s.role}</strong>
                          <span className="shift-pay-pill">{payLabel(s.shift)}</span>
                        </div>
                        <span style={{ fontSize: '0.84rem', color: '#64748b' }}>
                          Event: <strong>{s.event?.title}</strong> • {s.event?.venue?.city || 'Local'}
                        </span>
                      </div>

                      <Link to={`/pass/${s.shift._id}`} className="dash-alert-link" style={{ whiteSpace: 'nowrap' }}>
                        🎫 Show Pass
                      </Link>
                    </div>

                    <div style={{ fontSize: '0.84rem', color: '#334155', marginTop: '0.45rem', fontWeight: 650 }}>
                      🕒 {formatShift(s.shift.start, s.shift.end)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#64748b' }}>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.92rem', fontWeight: 650 }}>
                  You have no shifts scheduled right now.
                </p>
                <Link to="/events" className="btn btn-primary" style={{ padding: '0.45rem 1.15rem', fontSize: '0.85rem' }}>
                  Explore Events & Claim a Spot
                </Link>
              </div>
            )}
          </div>

          {/* Feature 6: Recommended Events in City with Perks */}
          <div className="dash-card dash-card-grow">
            <div className="dash-card-header">
              <div>
                <h2 className="dash-card-title">
                  🎯 {user.city ? `Recommended Events in ${user.city}` : 'Events Looking for Crew'}
                </h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                  Curated volunteer openings matching your city and profile.
                </p>
              </div>
              <Link to="/events" className="dash-alert-link">
                Browse All ↗
              </Link>
            </div>

            {recLoading ? (
              <Spinner />
            ) : recommendedData?.events?.length > 0 ? (
              <div className="crew-recommended-grid">
                {recommendedData.events.map((ev) => (
                  <div key={ev._id} className="crew-event-mini-card">
                    <div className="crew-mini-top">
                      <span className="event-cat-chip" style={{ fontSize: '0.72rem' }}>
                        {CATEGORIES[ev.category] || ev.category}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#166534' }}>
                        📍 {ev.venue?.city || 'Local'}
                      </span>
                    </div>

                    <h3 className="crew-mini-title">{ev.title}</h3>

                    <span className="crew-mini-meta">
                      📅 {formatRange(ev.startDate, ev.endDate)}
                    </span>

                    {/* Perks Ribbon */}
                    <div className="crew-perks-row">
                      <span className="crew-perk-badge">🍕 Free Meals</span>
                      <span className="crew-perk-badge">📜 Verified Certificate</span>
                      <span className="crew-perk-badge">👕 Swag</span>
                    </div>

                    <div className="crew-mini-action-row">
                      <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>
                        {ev.organization?.name ? `By ${ev.organization.name}` : 'Open Application'}
                      </span>
                      <Link to={`/events/${ev._id}`} className="btn btn-primary" style={{ padding: '0.35rem 0.95rem', fontSize: '0.8rem', fontWeight: 900 }}>
                        View & Claim Spot →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No open events nearby">
                Browse <Link to="/events">all events</Link> to discover opportunities across all cities!
              </Empty>
            )}
          </div>
        </div>

        {/* Right Column: Feature 4 Interactive Crew Schedule Calendar */}
        <div>
          <div className="calendar-card">
            <div className="calendar-header">
              <div className="calendar-month-title">
                {monthNames[calMonth]} {calYear}
              </div>
              <div className="calendar-nav-buttons">
                <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous Month">
                  ←
                </button>
                <button className="cal-today-btn" onClick={goToToday}>
                  Today
                </button>
                <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next Month">
                  →
                </button>
              </div>
            </div>

            <div className="calendar-weekdays">
              <span>SUN</span>
              <span>MON</span>
              <span>TUE</span>
              <span>WED</span>
              <span>THU</span>
              <span>FRI</span>
              <span>SAT</span>
            </div>

            <div className="calendar-grid">
              {Array.from({ length: firstDayIndex }).map((_, idx) => (
                <div key={`empty-${idx}`} className="cal-day-cell empty-cell" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const dayShifts = getShiftsForDay(dayNum);
                const hasShift = dayShifts.length > 0;
                const isToday =
                  new Date().getDate() === dayNum &&
                  new Date().getMonth() === calMonth &&
                  new Date().getFullYear() === calYear;
                const isSelected = selectedDayNum === dayNum;

                return (
                  <button
                    key={`day-${dayNum}`}
                    type="button"
                    className={`cal-day-cell ${hasShift ? 'has-event' : ''} ${isToday ? 'is-today' : ''} ${
                      isSelected ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedDate(new Date(calYear, calMonth, dayNum))}
                  >
                    <span>{dayNum}</span>
                    {hasShift && (
                      <div className="cal-event-dot-row">
                        {dayShifts.slice(0, 3).map((s, dotIdx) => (
                          <span
                            key={s._id || dotIdx}
                            className="cal-event-dot"
                            style={{
                              backgroundColor: s.status === 'confirmed' ? '#16a34a' : '#f59e0b',
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Day Inspector with Google Calendar Sync */}
            <div className="cal-day-inspector">
              <div className="cal-inspector-header">
                📅 Shifts on {monthNames[calMonth]} {selectedDayNum || ''}, {calYear} ({selectedDayShifts.length})
              </div>

              {selectedDayShifts.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {selectedDayShifts.map((s) => (
                    <div key={s._id} className="cal-inspector-event-pill" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <strong style={{ fontSize: '0.94rem', display: 'block', color: '#0f172a' }}>
                            {s.role} • {s.event?.title}
                          </strong>
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            🕒 {formatShift(s.shift.start, s.shift.end)}
                          </span>
                        </div>
                        <span
                          className={`chip chip-${s.status === 'confirmed' ? 'ongoing' : 'draft'}`}
                          style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                        >
                          {s.status}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.2rem' }}>
                        <a
                          href={makeGoogleCalendarUrl(s.event, s.shift)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-white"
                          style={{ fontSize: '0.74rem', padding: '2px 8px' }}
                        >
                          📅 Add to Google Cal
                        </a>
                        {s.status === 'confirmed' && (
                          <Link
                            to={`/pass/${s.shift._id}`}
                            className="btn btn-primary"
                            style={{ fontSize: '0.74rem', padding: '2px 8px' }}
                          >
                            🎫 QR Pass
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                  No volunteer shifts scheduled on this day.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrganizerHome({ user }) {
  const qc = useQueryClient();
  const [actionNotice, setActionNotice] = useState(null);

  // Calendar State
  const [calDate, setCalDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const approveMutation = useMutation({
    mutationFn: async (signupId) => {
      const { data } = await api.post(`/signups/${signupId}/approve`);
      return data;
    },
    onSuccess: () => {
      setActionNotice({ tone: 'success', message: 'Volunteer approved and spot confirmed!' });
      qc.invalidateQueries({ queryKey: ['organizer-summary'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['events', 'mine'] });
    },
    onError: (err) => {
      setActionNotice({ tone: 'error', message: errorMessage(err) || 'Failed to approve volunteer' });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (signupId) => {
      const { data } = await api.post(`/signups/${signupId}/reject`, { reason: 'Declined by organizer' });
      return data;
    },
    onSuccess: () => {
      setActionNotice({ tone: 'info', message: 'Volunteer application declined.' });
      qc.invalidateQueries({ queryKey: ['organizer-summary'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['events', 'mine'] });
    },
    onError: (err) => {
      setActionNotice({ tone: 'error', message: errorMessage(err) || 'Failed to decline application' });
    },
  });

  const { data: orgData, isLoading: orgLoading } = useQuery({
    queryKey: ['orgs', 'mine'],
    queryFn: async () => (await api.get('/orgs/mine')).data,
  });

  const { data: evData } = useQuery({
    queryKey: ['events', 'mine'],
    queryFn: async () => (await api.get('/events/mine')).data,
    enabled: !!orgData?.orgs?.length,
  });

  // Dedicated organizer summary: total events, active events, volunteers hired, 48h shifts, alerts
  const { data: summaryData } = useQuery({
    queryKey: ['organizer-summary'],
    queryFn: async () => (await api.get('/events/mine/summary')).data,
    enabled: !!orgData?.orgs?.length,
    refetchInterval: 20_000,
  });

  const isLoading = orgLoading || (evData === undefined && summaryData === undefined);

  if (isLoading) return <Spinner />;
  if (!orgData?.orgs?.length) return <OrgSetup />;

  const allEvents = evData?.events || summaryData?.events || [];

  // Active events: exclude completed, settled, and cancelled
  const activeEvents = allEvents.filter(
    (ev) => !['completed', 'settled', 'cancelled'].includes(ev.status)
  );

  const ongoingCount = activeEvents.filter((e) => e.status === 'ongoing').length;

  const totalEventsCount = summaryData?.totalEvents ?? allEvents.length;
  const activeEventsCount = summaryData?.activeEvents ?? activeEvents.length;
  const volunteersHiredCount = summaryData?.totalVolunteersHired ?? 0;


  // --- Calendar Computation ---
  const calYear = calDate.getFullYear();
  const calMonth = calDate.getMonth();
  const firstDayIndex = new Date(calYear, calMonth, 1).getDay();
  const totalDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const prevMonth = () => setCalDate(new Date(calYear, calMonth - 1, 1));
  const nextMonth = () => setCalDate(new Date(calYear, calMonth + 1, 1));
  const resetToToday = () => {
    const now = new Date();
    setCalDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Helper to check if event falls on a specific calendar day
  const getEventsForDay = (dayNum) => {
    const dayStart = new Date(calYear, calMonth, dayNum, 0, 0, 0);
    const dayEnd = new Date(calYear, calMonth, dayNum, 23, 59, 59);

    return allEvents.filter((ev) => {
      const s = new Date(ev.startDate);
      const e = new Date(ev.endDate);
      return s <= dayEnd && e >= dayStart;
    });
  };

  const selectedDayNum =
    selectedDate.getFullYear() === calYear && selectedDate.getMonth() === calMonth
      ? selectedDate.getDate()
      : null;

  const selectedDayEvents = selectedDayNum ? getEventsForDay(selectedDayNum) : [];

  // Shifts in next 48h and pending crew approvals
  const upcomingShifts = summaryData?.upcomingShifts || [];
  const pendingApprovals = summaryData?.pendingApprovals || [];

  // Format countdown string
  const getCountdownText = (start, end) => {
    const now = new Date();
    const s = new Date(start);
    const e = new Date(end);
    if (s <= now && e >= now) return '🔴 Happening Now';
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
  };

  const eventsNeedingPayout = allEvents.filter((ev) => ev.needsVolunteerPayout);

  const needsAttention = summaryData?.needsAttention || {
    unfilledShifts: [],
    pendingAttendance: 0,
    draftEventsCount: 0,
  };
  const hasAlerts =
    eventsNeedingPayout.length > 0 ||
    needsAttention.unfilledShifts.length > 0 ||
    needsAttention.pendingAttendance > 0 ||
    needsAttention.draftEventsCount > 0;

  const CARD_PALETTE = [
    '#bbf7d0', '#ddd6fe', '#fef08a', '#fecdd3', '#bae6fd',
    '#fed7aa', '#e9d5ff', '#a7f3d0', '#fbcfe8', '#99f6e4'
  ];

  return (
    <div className="organizer-dashboard-wrap">
      {/* Top 4 Neo-Brutalist Bento Stat Cards */}
      <div className="dash-stats-grid">
        <div className="dash-stat-card stat-mint">
          <span className="dash-stat-label">Total Events</span>
          <span className="dash-stat-val">{totalEventsCount}</span>
          <span className="dash-stat-hint">All events created to date</span>
        </div>

        <div className="dash-stat-card stat-yellow">
          <span className="dash-stat-label">Active Events</span>
          <span className="dash-stat-val">{activeEventsCount}</span>
          <span className="dash-stat-hint">Published & ongoing right now</span>
        </div>

        <div className="dash-stat-card stat-lavender">
          <span className="dash-stat-label">Volunteers Hired</span>
          <span className="dash-stat-val">{volunteersHiredCount}</span>
          <span className="dash-stat-hint">Confirmed crew members</span>
        </div>

        <div className="dash-stat-card stat-peach">
          <span className="dash-stat-label">Live & Ongoing</span>
          <span className="dash-stat-val">{ongoingCount}</span>
          <span className="dash-stat-hint">Happening at this moment</span>
        </div>
      </div>

      {/* Two-Column Bento Layout */}
      <div className="dash-bento-split">
        {/* Left Column: Approvals + Needs Attention + Next 48h Shifts */}
        <div>
          {/* 1. Crew Awaiting Shift Approval Card */}
          <div className="dash-card">
            <div className="dash-card-header">
              <h2 className="dash-card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                Crew Awaiting Shift Approval
              </h2>
              {pendingApprovals.length > 0 ? (
                <span className="dash-approval-badge">{pendingApprovals.length} Waiting</span>
              ) : (
                <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#0f172a' }}>All Caught Up</span>
              )}
            </div>

            {actionNotice && (
              <div style={{ marginBottom: '1rem' }}>
                <Notice tone={actionNotice.tone}>{actionNotice.message}</Notice>
              </div>
            )}

            {pendingApprovals.length > 0 ? (
              <div>
                {pendingApprovals.map((appr) => {
                  const isApproving = approveMutation.isPending && approveMutation.variables === appr._id;
                  const isRejecting = rejectMutation.isPending && rejectMutation.variables === appr._id;
                  const isBusy = approveMutation.isPending || rejectMutation.isPending;
                  const initial = appr.volunteerName ? appr.volunteerName.charAt(0).toUpperCase() : 'V';

                  return (
                    <div key={appr._id} className="dash-approval-item">
                      <div className="dash-approval-main">
                        <div className="approval-user-info">
                          <div className="approval-avatar">{initial}</div>
                          <div className="approval-name-block">
                            <span className="approval-name">{appr.volunteerName}</span>
                            <span className="approval-email">{appr.volunteerEmail || appr.volunteerPhone || 'No contact provided'}</span>
                            {appr.volunteerSkills?.length > 0 && (
                              <div className="approval-skills-row">
                                {appr.volunteerSkills.slice(0, 3).map((sk) => (
                                  <span key={sk} className="dash-skill-tag">{sk}</span>
                                ))}
                              </div>
                            )}

                            {/* Reliability Score Badge */}
                            <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 800,
                                  border: '1.5px solid #0f172a',
                                  background: (appr.reliabilityScore ?? 100) >= 90 ? '#bbf7d0' : (appr.reliabilityScore ?? 100) >= 75 ? '#fef08a' : '#fecdd3',
                                  color: (appr.reliabilityScore ?? 100) >= 90 ? '#166534' : (appr.reliabilityScore ?? 100) >= 75 ? '#854d0e' : '#991b1b',
                                }}
                              >
                                {(appr.reliabilityScore ?? 100) >= 90 ? '⭐' : (appr.reliabilityScore ?? 100) >= 75 ? '⚡' : '⚠️'}
                                Reliability: {appr.reliabilityScore ?? 100}%
                                {(appr.reliabilityScore ?? 100) < 75 ? ' (Prior No-Show / Early Checkout)' : (appr.reliabilityScore ?? 100) < 90 ? ' (Moderate Risk)' : ' (Top Reliable)'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="approval-shift-details">
                          <span className="approval-shift-event">
                            {appr.eventTitle}
                            <span className="approval-shift-role">{appr.roleName}</span>
                          </span>
                          <span className="approval-shift-time">
                            🕒 {formatShift(appr.start, appr.end)}
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#0f172a', fontWeight: 700 }}>
                            {appr.spotsLeft > 0 ? `${appr.spotsLeft} spot(s) remaining` : 'Shift currently full (promotes to waitlist)'}
                          </span>
                        </div>
                      </div>

                      <div className="approval-actions">
                        <button
                          type="button"
                          className="dash-decline-btn"
                          onClick={() => rejectMutation.mutate(appr._id)}
                          disabled={isBusy}
                        >
                          {isRejecting ? 'Declining...' : '✕ Decline'}
                        </button>
                        <button
                          type="button"
                          className="dash-accept-btn"
                          onClick={() => approveMutation.mutate(appr._id)}
                          disabled={isBusy}
                        >
                          {isApproving ? 'Approving...' : '✓ Accept Crew'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="dash-all-clear" style={{ background: '#f5f3ff' }}>
                <div className="dash-all-clear-icon" style={{ background: '#8b5cf6' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.96rem', color: '#0f172a' }}>No Crew Awaiting Approval</strong>
                  <span style={{ fontSize: '0.82rem', color: '#475569' }}>
                    When volunteers sign up for shifts requiring organizer approval, you can accept or decline them directly here.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 2. Needs Attention / Urgent Alerts Card */}
          <div className="dash-card dash-card-grow">
            <div className="dash-card-header">
              <h2 className="dash-card-title">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                Needs Attention
              </h2>
              {hasAlerts ? (
                <span className="dash-alert-badge">Action Required</span>
              ) : (
                <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#0f172a' }}>All Clear</span>
              )}
            </div>

            {hasAlerts ? (
              <div>
                {eventsNeedingPayout.map((ev) => (
                  <div
                    key={ev._id}
                    className="dash-alert-item"
                    style={{
                      background: '#fef3c7',
                      borderLeft: '4px solid #f59e0b',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <span className="dash-alert-text">
                      <strong style={{ color: '#b45309' }}>⚠️ Pay Volunteers:</strong> <em>{ev.title}</em> is completed but has{' '}
                      <strong>{ev.unpaidCrewCount || 'pending'}</strong> unpaid crew volunteer(s). Settle stipends to archive event.
                    </span>
                    <Link
                      to={`/manage/events/${ev._id}?tab=funds`}
                      className="dash-alert-link"
                      style={{
                        background: '#f59e0b',
                        color: '#0f172a',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        textDecoration: 'none',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '6px',
                        border: '1.5px solid #0f172a',
                      }}
                    >
                      💰 Pay Crew →
                    </Link>
                  </div>
                ))}

                {needsAttention.unfilledShifts.map((s) => (
                  <div key={s._id} className="dash-alert-item">
                    <span className="dash-alert-text">
                      <strong>{s.roleName}</strong> in {s.eventTitle} has <strong>{s.spotsLeft} unfilled</strong> volunteer spot(s)
                    </span>
                    <Link to={`/manage/events/${s.eventId}?tab=shifts`} className="dash-alert-link">
                      Manage Shift
                    </Link>
                  </div>
                ))}

                {needsAttention.pendingAttendance > 0 && (
                  <div className="dash-alert-item" style={{ background: '#fef9c3' }}>
                    <span className="dash-alert-text">
                      <strong>{needsAttention.pendingAttendance}</strong> volunteer attendance record(s) awaiting your approval
                    </span>
                    <Link to="/checkin" className="dash-alert-link">
                      Review Hours
                    </Link>
                  </div>
                )}

                {needsAttention.draftEventsCount > 0 && (
                  <div className="dash-alert-item" style={{ background: '#f1f5f9' }}>
                    <span className="dash-alert-text">
                      You have <strong>{needsAttention.draftEventsCount}</strong> draft event(s) not yet published to volunteers
                    </span>
                    <Link to="/events" className="dash-alert-link">
                      View Drafts
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="dash-all-clear">
                <div className="dash-all-clear-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.96rem', color: '#0f172a' }}>All Clear!</strong>
                  <span style={{ fontSize: '0.82rem', color: '#475569' }}>
                    No unfilled shifts starting in the next 48h, and no pending volunteer hours.
                  </span>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Interactive Event Calendar */}
        <div>
          <div className="calendar-card">
            <div className="calendar-header">
              <div className="calendar-month-title">
                {monthNames[calMonth]} {calYear}
              </div>
              <div className="calendar-nav-buttons">
                <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous Month">←</button>
                <button className="cal-today-btn" onClick={resetToToday}>Today</button>
                <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next Month">→</button>
              </div>
            </div>

            {/* Weekdays */}
            <div className="calendar-weekdays">
              <span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span>
            </div>

            {/* Month Day Cells */}
            <div className="calendar-grid">
              {/* Offset blanks for first day of month */}
              {Array.from({ length: firstDayIndex }).map((_, i) => (
                <div key={`empty-${i}`} className="cal-day-cell empty-cell" />
              ))}

              {/* Day cells */}
              {Array.from({ length: totalDaysInMonth }).map((_, i) => {
                const day = i + 1;
                const eventsOnThisDay = getEventsForDay(day);
                const hasEvent = eventsOnThisDay.length > 0;
                const isToday =
                  new Date().getDate() === day &&
                  new Date().getMonth() === calMonth &&
                  new Date().getFullYear() === calYear;
                const isSelected = selectedDayNum === day;

                return (
                  <button
                    key={`day-${day}`}
                    className={`cal-day-cell ${hasEvent ? 'has-event' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedDate(new Date(calYear, calMonth, day))}
                  >
                    <span>{day}</span>
                    {hasEvent && (
                      <div className="cal-event-dot-row">
                        {eventsOnThisDay.slice(0, 3).map((ev, dotIdx) => (
                          <span
                            key={ev._id || dotIdx}
                            className="cal-event-dot"
                            style={{
                              backgroundColor:
                                ev.status === 'ongoing' ? '#ef4444' : CARD_PALETTE[dotIdx % CARD_PALETTE.length],
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected Date Event Inspector */}
            <div className="cal-day-inspector">
              <div className="cal-inspector-header">
                📅 Events on {monthNames[calMonth]} {selectedDayNum || ''}, {calYear} ({selectedDayEvents.length})
              </div>

              {selectedDayEvents.length > 0 ? (
                <div>
                  {selectedDayEvents.map((ev) => (
                    <Link
                      key={ev._id}
                      to={`/manage/events/${ev._id}`}
                      className="cal-inspector-event-pill"
                    >
                      <div>
                        <strong style={{ fontSize: '0.9rem', display: 'block' }}>{ev.title}</strong>
                        <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                          {CATEGORIES[ev.category] || 'Event'} • {ev.venue?.city || 'Local'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {ev.needsVolunteerPayout && (
                          <span
                            className="chip"
                            style={{
                              background: '#fef08a',
                              color: '#854d0e',
                              border: '1px solid #854d0e',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              padding: '1px 6px',
                            }}
                          >
                            ⚠️ Pay Crew
                          </span>
                        )}
                        <span className={`chip chip-${ev.status}`} style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                          {ev.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                  No events scheduled on this day.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-Width Upcoming Shifts Bento Section */}
      <div className="dash-card">
        <div className="dash-card-header">
          <h2 className="dash-card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            Upcoming Shifts ({upcomingShifts.length})
          </h2>
          {upcomingShifts.length > 0 && (
            <span className="shift-countdown-pill">
              {getCountdownText(upcomingShifts[0].start, upcomingShifts[0].end)}
            </span>
          )}
        </div>

        {upcomingShifts.length > 0 ? (
          <div className="shifts-bento-grid">
            {upcomingShifts.slice(0, 3).map((shift) => (
              <div key={shift._id} className="shift-timeline-item">
                <div className="shift-timeline-top">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                        {shift.roleName}
                      </strong>
                      <span className="shift-countdown-pill" style={{ background: '#f1f5f9', border: '1.5px solid #0f172a', fontSize: '0.68rem' }}>
                        {getCountdownText(shift.start, shift.end)}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.84rem', color: '#64748b' }}>
                      Event: {shift.eventTitle}
                    </span>
                  </div>
                  <Link to={`/manage/events/${shift.eventId}?tab=shifts`} className="dash-alert-link">
                    Details
                  </Link>
                </div>

                <div style={{ fontSize: '0.86rem', color: '#334155', marginTop: '0.45rem', fontWeight: 650 }}>
                  🕒 {formatRange(shift.start, shift.end)}
                </div>

                <div style={{ marginTop: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 800 }}>
                    <span>Volunteer Fill Rate</span>
                    <span>{shift.confirmed} / {shift.capacity} Confirmed</span>
                  </div>
                  <div className="shift-progress-wrap">
                    <div
                      className="shift-progress-bar"
                      style={{ width: `${Math.min(100, (shift.confirmed / shift.capacity) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#64748b' }}>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.92rem', fontWeight: 650 }}>
              No shifts scheduled in the next 48 hours.
            </p>
            <Link to="/manage/events/new" className="dash-alert-link">
              + Create New Event & Shift
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function OrgSetup() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', type: 'college_club', city: '', description: '' });
  const m = useMutation({
    mutationFn: async () => (await api.post('/orgs', form)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
  const errors = m.error ? fieldErrors(m.error) : {};
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth wide">
      <h1>Set up your organization</h1>
      <p className="muted">Events belong to an organization, like your college club or NGO. You can add teammates later.</p>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
        <Notice>{m.error && errorMessage(m.error)}</Notice>
        <Field label="Organization name" error={errors.name}><input value={form.name} onChange={set('name')} required /></Field>
        <div className="two">
          <Field label="Type">
            <select value={form.type} onChange={set('type')}>
              {Object.entries(ORG_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="City" error={errors.city}><input value={form.city} onChange={set('city')} /></Field>
        </div>
        <Field label="About" error={errors.description}><textarea rows={3} value={form.description} onChange={set('description')} /></Field>
        <button className="btn btn-primary" disabled={m.isPending}>{m.isPending ? 'Creating' : 'Create organization'}</button>
      </form>
    </div>
  );
}
