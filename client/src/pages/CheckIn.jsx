import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import api, { errorMessage } from '../api/client.js';
import { ATT_LABEL, CATEGORIES, formatShift, formatTime } from '../lib.js';
import { Empty, Field, Notice, Spinner } from '../components/ui.jsx';

const CATEGORY_COLORS = {
  sports: '#ddd6fe',
  community: '#bbf7d0',
  festival: '#fef08a',
  tech: '#bae6fd',
  charity: '#fecdd3',
  conference: '#fed7aa',
  college_fest: '#fef08a',
  general: '#bbf7d0',
};

export function CheckInList() {
  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['lead-shifts'],
    queryFn: async () => (await api.get('/attendance/lead/shifts')).data.shifts,
  });

  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedShiftId, setSelectedShiftId] = useState(null);

  if (isLoading) return <Spinner />;

  // If a shift is selected, display the Scan Volunteers & Roster Desk (Step 3)
  if (selectedShiftId) {
    return (
      <CheckInShift
        shiftId={selectedShiftId}
        onBack={() => setSelectedShiftId(null)}
      />
    );
  }

  // Group shifts by event
  const eventsMap = new Map();
  for (const s of shifts) {
    const eid = String(s.eventId || s.event || 'default');
    if (!eventsMap.has(eid)) {
      eventsMap.set(eid, {
        id: eid,
        title: s.event || 'Untitled Event',
        category: s.eventCategory || 'general',
        venue: s.eventVenue,
        status: s.eventStatus || 'published',
        startDate: s.eventStartDate,
        endDate: s.eventEndDate,
        shifts: [],
        totalConfirmed: 0,
        totalPresent: 0,
      });
    }
    const ev = eventsMap.get(eid);
    ev.shifts.push(s);
    ev.totalConfirmed += s.confirmed || 0;
    ev.totalPresent += s.present || 0;
  }
  const events = Array.from(eventsMap.values());

  // Step 2: An event was selected -> show the roles for this event
  if (selectedEventId) {
    const activeEvent = events.find((e) => e.id === selectedEventId) || events[0];

    return (
      <div className="checkin-wrapper">
        {/* Navigation & Header */}
        <div className="checkin-hero">
          <div className="checkin-hero-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.4rem' }}>
              <span className="checkin-tag">
                {CATEGORIES[activeEvent.category] || 'EVENT'}
              </span>
              <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#0f172a' }}>
                {activeEvent.shifts.length} Role(s)
              </span>
            </div>
            <h1 className="checkin-title">{activeEvent.title}</h1>
            <p className="checkin-subtitle">
              Choose a role below to launch volunteer QR check-in & review attendance.
            </p>
          </div>
          <button
            type="button"
            className="bento-btn bento-btn-secondary"
            onClick={() => setSelectedEventId(null)}
          >
            ← Back to All Events
          </button>
        </div>

        {/* Roles Grid */}
        <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: '0 0 1rem' }}>
          Available Roles ({activeEvent.shifts.length})
        </h2>

        <div className="checkin-roles-grid">
          {activeEvent.shifts.map((shift) => (
            <div
              key={shift._id}
              className="checkin-role-card"
              onClick={() => setSelectedShiftId(shift._id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelectedShiftId(shift._id);
              }}
            >
              <div>
                <div className="checkin-role-top">
                  <h3 className="checkin-role-name">{shift.role}</h3>
                  <span
                    className="shift-countdown-pill"
                    style={{ background: '#fef08a', border: '1.5px solid #0f172a' }}
                  >
                    Open Desk
                  </span>
                </div>

                <div className="checkin-role-time">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>{formatShift(shift.start, shift.end)}</span>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                  <span>Attendance Progress</span>
                  <span>
                    {shift.present} / {shift.confirmed} Present
                  </span>
                </div>
                <div className="checkin-progress-wrap">
                  <div
                    className="checkin-progress-bar"
                    style={{
                      width: `${Math.min(100, ((shift.present || 0) / (shift.confirmed || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  paddingTop: '0.75rem',
                  borderTop: '1.5px dashed #cbd5e1',
                  fontSize: '0.86rem',
                  fontWeight: 900,
                  color: '#0f172a',
                }}
              >
                <span>Launch Scanner & Roster →</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Step 1: No event selected -> show the Square Event Cards
  return (
    <div className="checkin-wrapper">
      <div className="checkin-hero">
        <div className="checkin-hero-left">
          <span className="checkin-tag">📋 ATTENDANCE DESK</span>
          <h1 className="checkin-title">Check-in Desk</h1>
          <p className="checkin-subtitle">
            Select an active event to view its roles and launch volunteer QR scanning.
          </p>
        </div>
      </div>

      {events.length > 0 ? (
        <div className="checkin-events-grid">
          {events.map((ev) => {
            const headerBg = CATEGORY_COLORS[ev.category] || '#bbf7d0';

            return (
              <div
                key={ev.id}
                className="checkin-square-card"
                onClick={() => setSelectedEventId(ev.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedEventId(ev.id);
                }}
              >
                {/* Square Card Top Bar */}
                <div className="checkin-card-topbar" style={{ backgroundColor: headerBg }}>
                  <span className="bento-badge-cat">
                    {CATEGORIES[ev.category] || 'Event'}
                  </span>
                  <span className="card-live-indicator">
                    <span className="live-pulse-dot" />
                    <span>ACTIVE</span>
                  </span>
                </div>

                {/* Square Card Body */}
                <div className="checkin-card-body">
                  <div>
                    <h3 className="checkin-event-name">{ev.title}</h3>
                    <div className="checkin-venue-row">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      <span>{ev.venue?.city || 'Local'}{ev.venue?.name ? ` • ${ev.venue.name}` : ''}</span>
                    </div>
                  </div>

                  <div className="checkin-stats-pills">
                    <div className="checkin-stat-badge">
                      <span>Assigned Roles</span>
                      <span>{ev.shifts.length} Role(s)</span>
                    </div>
                    <div className="checkin-stat-badge" style={{ background: '#ecfdf5' }}>
                      <span>Live Check-in</span>
                      <span>{ev.totalPresent} / {ev.totalConfirmed} Present</span>
                    </div>
                  </div>
                </div>

                {/* Square Card Footer */}
                <div className="checkin-card-footer">
                  <span>Manage Check-in</span>
                  <span style={{ fontSize: '1.1rem' }}>→</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No shifts to run right now">
          When you are a team lead or organizer for an event happening soon, its square card will appear here.
        </Empty>
      )}
    </div>
  );
}

export function CheckInShift({ shiftId: propShiftId, onBack }) {
  const params = useParams();
  const shiftId = propShiftId || params.shiftId;
  const qc = useQueryClient();
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [token, setToken] = useState('');
  const busy = useRef(false);
  const scanner = useRef(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sheet', shiftId],
    queryFn: async () => (await api.get(`/attendance/shifts/${shiftId}/sheet`)).data,
    refetchInterval: 15_000,
  });

  const submit = async (t) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const { data: r } = await api.post('/attendance/scan', { token: t });
      setResult({
        ok: true,
        text:
          r.action === 'check_in'
            ? `✓ ${r.volunteer} checked in${r.late ? ' (late)' : ''}`
            : `✓ ${r.volunteer} checked out (${r.minutes} minutes logged)`,
      });
      qc.invalidateQueries({ queryKey: ['sheet', shiftId] });
      qc.invalidateQueries({ queryKey: ['lead-shifts'] });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setTimeout(() => {
        busy.current = false;
      }, 2500);
    }
  };

  const stop = async () => {
    try {
      await scanner.current?.stop();
      scanner.current?.clear();
    } catch {
      /* already stopped */
    }
    scanner.current = null;
    setScanning(false);
  };

  const start = async () => {
    setResult(null);
    setScanning(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      scanner.current = new Html5Qrcode('qr-reader');
      await scanner.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 240 },
        (text) => submit(text),
        () => {}
      );
    } catch (err) {
      setScanning(false);
      setResult({ ok: false, text: 'Could not open camera. Allow camera permissions, or paste QR code text below.' });
    }
  };

  useEffect(() => () => {
    scanner.current?.stop().catch(() => {});
  }, []);

  const manual = useMutation({
    mutationFn: async ({ signupId, action }) => {
      const reason = window.prompt('Why are you doing this manually? (required, it is logged in the audit log)');
      if (!reason) throw new Error('cancelled');
      return (await api.post('/attendance/manual', { signupId, action, reason })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet', shiftId] });
      qc.invalidateQueries({ queryKey: ['lead-shifts'] });
    },
    onError: (err) => err.message !== 'cancelled' && setResult({ ok: false, text: errorMessage(err) }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <Notice>{errorMessage(error)}</Notice>;

  return (
    <div className="checkin-wrapper">
      {/* Header Banner */}
      <div className="checkin-hero">
        <div className="checkin-hero-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                style={{
                  background: '#fef08a',
                  border: '1.5px solid #0f172a',
                  borderRadius: '99px',
                  padding: '2px 10px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.72rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  color: '#0f172a',
                }}
              >
                ← Back to Roles
              </button>
            ) : (
              <Link
                to="/checkin"
                style={{
                  background: '#fef08a',
                  border: '1.5px solid #0f172a',
                  borderRadius: '99px',
                  padding: '2px 10px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.72rem',
                  fontWeight: 900,
                  textDecoration: 'none',
                  color: '#0f172a',
                }}
              >
                ← Check-in desk
              </Link>
            )}

            {data.shift.eventTitle && (
              <span className="dash-alert-badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>
                {data.shift.eventTitle}
              </span>
            )}
            {data.shift.roleName && (
              <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#0f172a' }}>
                Role: {data.shift.roleName}
              </span>
            )}
          </div>

          <h1 className="checkin-title">Scan volunteers</h1>
          <p className="checkin-subtitle">
            🕒 {formatShift(data.shift.start, data.shift.end)}
          </p>
        </div>

        {onBack ? (
          <button type="button" className="bento-btn bento-btn-secondary" onClick={onBack}>
            ← Back
          </button>
        ) : (
          <Link to="/checkin" className="bento-btn bento-btn-secondary">
            ← All Events
          </Link>
        )}
      </div>

      {result && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Notice tone={result.ok ? 'success' : 'error'}>{result.text}</Notice>
        </div>
      )}

      <div className="checkin-scan-desk">
        {/* Scanner Card */}
        <div className="checkin-scanner-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.15rem' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: scanning ? '#ef4444' : '#10b981',
                border: '1px solid #0f172a',
                display: 'inline-block',
              }}
            />
            <h2 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
              Live Camera Scanner
            </h2>
          </div>

          {scanning ? (
            <div>
              <div id="qr-reader" style={{ border: '2px solid #0f172a', borderRadius: '16px', overflow: 'hidden', marginBottom: '1rem' }} />
              <button
                type="button"
                className="bento-btn bento-btn-secondary"
                onClick={stop}
              >
                Stop Camera
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="bento-btn bento-btn-primary"
              style={{ background: '#bbf7d0', marginBottom: '1.25rem' }}
              onClick={start}
            >
              📷 Start Camera Scanner
            </button>
          )}

          <form
            style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim()) {
                submit(token.trim());
                setToken('');
              }
            }}
          >
            <input
              aria-label="Paste QR code text"
              placeholder="No camera? Paste the code text here"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              type="submit"
              className="bento-btn bento-btn-primary"
              style={{ background: '#fef08a' }}
            >
              Submit Code
            </button>
          </form>
        </div>

        {/* Live Roster Card */}
        <div className="checkin-roster-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
              Roster ({data.roster.length})
            </h2>
            <span className="dash-alert-badge" style={{ background: '#f1f5f9', color: '#0f172a' }}>
              {data.roster.filter((r) => ['checked_in', 'completed', 'approved'].includes(r.status)).length} Checked In
            </span>
          </div>

          {data.roster.length > 0 ? (
            <div className="checkin-roster-list">
              {data.roster.map((r) => (
                <div key={r.signupId} className="checkin-roster-item">
                  <div>
                    <strong style={{ fontSize: '1.02rem', color: '#0f172a' }}>
                      {r.name}
                    </strong>
                    {r.phone && (
                      <span style={{ fontSize: '0.85rem', color: '#64748b', marginLeft: '0.4rem' }}>
                        • {r.phone}
                      </span>
                    )}
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#475569', fontWeight: 650 }}>
                      {r.checkInAt ? `In ${formatTime(r.checkInAt)}` : 'Not checked in yet'}
                      {r.checkOutAt ? `, out ${formatTime(r.checkOutAt)}` : ''}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {/* Status Pill */}
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '99px',
                        border: '1.5px solid #0f172a',
                        fontSize: '0.74rem',
                        fontWeight: 900,
                        background:
                          r.status === 'checked_in' || r.status === 'completed' || r.status === 'approved'
                            ? '#bbf7d0'
                            : r.status === 'no_show'
                            ? '#fee2e2'
                            : '#fef08a',
                        color: r.status === 'no_show' ? '#991b1b' : '#0f172a',
                      }}
                    >
                      {ATT_LABEL[r.status] || r.status}
                    </span>

                    {r.late && (
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '99px',
                          border: '1.5px solid #0f172a',
                          fontSize: '0.72rem',
                          fontWeight: 900,
                          background: '#fed7aa',
                          color: '#9a3412',
                        }}
                      >
                        Late
                      </span>
                    )}

                    {/* Actions */}
                    {r.status === 'expected' && (
                      <>
                        <button
                          type="button"
                          className="dash-accept-btn"
                          style={{ padding: '0.35rem 0.8rem', fontSize: '0.78rem' }}
                          onClick={() => manual.mutate({ signupId: r.signupId, action: 'check_in' })}
                        >
                          Check in
                        </button>
                        <button
                          type="button"
                          className="dash-decline-btn"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                          onClick={() => manual.mutate({ signupId: r.signupId, action: 'no_show' })}
                        >
                          No-show
                        </button>
                      </>
                    )}

                    {r.status === 'checked_in' && (
                      <button
                        type="button"
                        className="bento-btn bento-btn-secondary"
                        style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem' }}
                        onClick={() => manual.mutate({ signupId: r.signupId, action: 'check_out' })}
                      >
                        Check out
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.9rem', fontWeight: 650 }}>
              No confirmed volunteers assigned to this shift yet.
            </div>
          )}

          <div style={{ marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '1.5px dashed #cbd5e1', fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
            ℹ️ Manual actions require a recorded reason and are tracked in the security audit log.
          </div>
        </div>
      </div>
    </div>
  );
}
