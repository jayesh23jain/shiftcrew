import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import api, { getAccessToken, errorMessage } from '../../api/client.js';
import { formatRange } from '../../lib.js';
import { Empty, Notice, Spinner } from '../../components/ui.jsx';

function getRoleIcon(name = '') {
  const n = name.toLowerCase();
  if (n.includes('reg') || n.includes('desk') || n.includes('ticket') || n.includes('entry') || n.includes('check')) return '🎟️';
  if (n.includes('stage') || n.includes('sound') || n.includes('av') || n.includes('tech') || n.includes('audio') || n.includes('light')) return '🎙️';
  if (n.includes('food') || n.includes('cater') || n.includes('refresh') || n.includes('snack') || n.includes('water')) return '🍕';
  if (n.includes('secur') || n.includes('crowd') || n.includes('safety') || n.includes('guard') || n.includes('marshal')) return '🛡️';
  if (n.includes('photo') || n.includes('media') || n.includes('video') || n.includes('social')) return '📸';
  if (n.includes('lead') || n.includes('manage') || n.includes('coord') || n.includes('head')) return '👑';
  if (n.includes('hosp') || n.includes('guest') || n.includes('vip')) return '🤝';
  return '⚡';
}

function playAlertChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.15); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  } catch (err) {
    console.warn('Audio chime playback blocked or not supported:', err);
  }
}

// Memoized Shift Tile for performance with large rosters
const ShiftTile = React.memo(function ShiftTile({
  shift,
  onPingBackups,
  onNudge,
  pingingId,
  nudgingId,
  onOpenRoster,
}) {
  const isRed = shift.gap > 0;
  const isAmber = !isRed && shift.late > 0;
  const isGreen = !isRed && !isAmber;

  const statusTone = isRed ? 'danger' : isAmber ? 'warning' : 'success';
  const statusLabel = isRed ? 'Gap / Understaffed' : isAmber ? 'Late Volunteer' : 'Fully Staffed';

  const roleIcon = getRoleIcon(shift.roleName);
  const startTime = new Date(shift.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(shift.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className={`mission-shift-tile tone-${statusTone}`}
      style={{
        border: '2.5px solid #0f172a',
        borderRadius: '16px',
        padding: '1.15rem',
        background: isRed ? '#fff5f5' : isAmber ? '#fffbeb' : '#f0fdf4',
        boxShadow: '4px 4px 0px #0f172a',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '0.85rem',
        position: 'relative',
        transition: 'transform 0.15s ease',
      }}
    >
      {/* Header */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '1.25rem' }}>{roleIcon}</span>
            <strong style={{ fontSize: '1.02rem', fontWeight: 900, color: '#0f172a' }}>{shift.roleName}</strong>
          </div>
          <span
            className={`mission-badge tone-${statusTone}`}
            style={{
              fontSize: '0.72rem',
              fontWeight: 900,
              padding: '2px 8px',
              borderRadius: '999px',
              border: '1.5px solid #0f172a',
              background: isRed ? '#fecdd3' : isAmber ? '#fef08a' : '#bbf7d0',
              color: '#0f172a',
              whiteSpace: 'nowrap',
            }}
          >
            {statusLabel}
          </span>
        </div>

        <div style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>⏰</span>
          <span>{startTime} – {endTime}</span>
        </div>
      </div>

      {/* Capacity & Attendance Visual Bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.3rem' }}>
          <span>Staffing Status:</span>
          <span>
            {shift.present} / {shift.capacity} Filled
            {shift.confirmed > shift.present && ` (${shift.confirmed} confirmed)`}
          </span>
        </div>
        <div
          style={{
            height: '10px',
            background: '#e2e8f0',
            borderRadius: '999px',
            border: '1.5px solid #0f172a',
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <div
            title={`Present: ${shift.present}`}
            style={{
              width: `${Math.min(100, (shift.present / Math.max(1, shift.capacity)) * 100)}%`,
              background: '#22c55e',
              height: '100%',
            }}
          />
          <div
            title={`Late: ${shift.late}`}
            style={{
              width: `${Math.min(100, (shift.late / Math.max(1, shift.capacity)) * 100)}%`,
              background: '#eab308',
              height: '100%',
            }}
          />
        </div>
      </div>

      {/* Metric Breakdown Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.35rem',
          textAlign: 'center',
          background: 'rgba(255,255,255,0.75)',
          padding: '0.5rem',
          borderRadius: '10px',
          border: '1.5px solid #0f172a',
          fontSize: '0.74rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 900, color: '#15803d', fontSize: '0.95rem' }}>{shift.present}</div>
          <div style={{ color: '#475569', fontWeight: 700 }}>Present</div>
        </div>
        <div>
          <div style={{ fontWeight: 900, color: '#b45309', fontSize: '0.95rem' }}>{shift.late}</div>
          <div style={{ color: '#475569', fontWeight: 700 }}>Late</div>
        </div>
        <div>
          <div style={{ fontWeight: 900, color: '#4338ca', fontSize: '0.95rem' }}>{shift.expectedSoon}</div>
          <div style={{ color: '#475569', fontWeight: 700 }}>Soon</div>
        </div>
        <div>
          <div style={{ fontWeight: 900, color: shift.gap > 0 ? '#b91c1c' : '#475569', fontSize: '0.95rem' }}>
            {shift.gap}
          </div>
          <div style={{ color: '#475569', fontWeight: 700 }}>Gap</div>
        </div>
      </div>

      {/* Waitlist info & Action controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 750, color: '#475569' }}>
            Waitlist: <strong style={{ color: '#0f172a' }}>{shift.waitlistCount || 0}</strong>
          </span>

          {shift.waitlistCount > 0 && shift.gap > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              style={{
                fontSize: '0.76rem',
                padding: '4px 9px',
                fontWeight: 900,
                boxShadow: '2px 2px 0px #0f172a',
              }}
              onClick={() => onPingBackups(shift.shiftId)}
              disabled={pingingId === shift.shiftId}
            >
              {pingingId === shift.shiftId ? 'Pinging...' : '📢 Ping Backups'}
            </button>
          )}
        </div>

        {/* View Roster details button */}
        <button
          type="button"
          onClick={() => onOpenRoster(shift)}
          style={{
            background: '#ffffff',
            border: '1.5px solid #0f172a',
            borderRadius: '8px',
            padding: '6px 10px',
            fontSize: '0.78rem',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '0.35rem',
            color: '#0f172a',
          }}
        >
          <span>👥 View Crew Roster ({shift.volunteers?.length || 0})</span>
        </button>
      </div>
    </div>
  );
});

export default function MissionControlTab({ event }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'live' | 'polling' | 'disconnected'
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('shiftcrew_sound_alerts') === 'true';
    } catch {
      return false;
    }
  });
  const [activityTicker, setActivityTicker] = useState([]);
  const [selectedRole, setSelectedRole] = useState('all');
  const [rosterShift, setRosterShift] = useState(null);

  // Actions state
  const [pingingId, setPingingId] = useState(null);
  const [nudgingId, setNudgingId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);

  // Organizer Broadcast State
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastPriority, setBroadcastPriority] = useState('normal');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState('');

  const socketRef = useRef(null);
  const prevAlertsCount = useRef(0);

  const eventId = event._id;

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      localStorage.setItem('shiftcrew_sound_alerts', String(next));
      if (next) playAlertChime();
    } catch {}
  };

  // HTTP Fetch snapshot
  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await api.get(`/events/${eventId}/mission`);
      const data = res.data;
      setSnapshot(data);
      setError(null);

      // Check if new alerts arrived
      if (soundEnabled && data.alerts?.length > prevAlertsCount.current) {
        playAlertChime();
      }
      prevAlertsCount.current = data.alerts?.length || 0;
      return data;
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [eventId, soundEnabled]);

  // Connect Socket.io
  useEffect(() => {
    let active = true;
    let pollTimer = null;

    fetchSnapshot().catch(() => {});

    const token = getAccessToken();
    const socket = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      if (!active) return;
      setConnectionStatus('live');
      socket.emit('join', { eventId });
    });

    socket.on('snapshot', (data) => {
      if (!active) return;
      setSnapshot(data);
      setConnectionStatus('live');
      if (soundEnabled && data.alerts?.length > prevAlertsCount.current) {
        playAlertChime();
      }
      prevAlertsCount.current = data.alerts?.length || 0;
    });

    socket.on('update', (diff) => {
      if (!active) return;
      if (diff.reason) {
        const item = {
          id: Math.random().toString(36).slice(2),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          text: diff.details?.message || `Event updated (${diff.reason})`,
          reason: diff.reason,
        };
        setActivityTicker((prev) => [item, ...prev.slice(0, 19)]);
      }
      fetchSnapshot().catch(() => {});
    });

    socket.on('disconnect', () => {
      if (!active) return;
      setConnectionStatus('polling');
    });

    socket.on('connect_error', (err) => {
      if (!active) return;
      console.warn('Socket connect error, falling back to polling:', err.message);
      setConnectionStatus('polling');
    });

    pollTimer = setInterval(() => {
      if (!socket.connected) {
        fetchSnapshot().catch(() => {
          setConnectionStatus('disconnected');
        });
      }
    }, 10_000);

    return () => {
      active = false;
      clearInterval(pollTimer);
      if (socket) {
        socket.emit('leave', { eventId });
        socket.disconnect();
      }
    };
  }, [eventId, fetchSnapshot, soundEnabled]);

  // Action: Organizer sends broadcast to volunteers
  const handleSendBroadcast = async (e) => {
    e.preventDefault();
    if (!broadcastMsg.trim()) return;

    try {
      setIsBroadcasting(true);
      setBroadcastSuccess('');
      setActionNotice(null);

      const res = await api.post(`/events/${eventId}/mission/broadcast`, {
        title: broadcastTitle.trim() || undefined,
        message: broadcastMsg.trim(),
        priority: broadcastPriority,
      });

      setBroadcastMsg('');
      setBroadcastTitle('');
      setBroadcastSuccess(`✓ Broadcast delivered to ${res.data.count || 0} volunteer notification bar(s)!`);
      setTimeout(() => setBroadcastSuccess(''), 5000);
      fetchSnapshot();
    } catch (err) {
      setActionNotice({ tone: 'danger', message: errorMessage(err) });
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Action: Organizer resolves volunteer-reported issue
  const handleResolveIncident = async (incidentId) => {
    try {
      setResolvingId(incidentId);
      setActionNotice(null);
      await api.post(`/events/${eventId}/mission/resolve-issue`, { incidentId });
      setActionNotice({ tone: 'success', message: 'Incident resolved successfully!' });
      setTimeout(() => setActionNotice(null), 4000);
      fetchSnapshot();
    } catch (err) {
      setActionNotice({ tone: 'danger', message: errorMessage(err) });
    } finally {
      setResolvingId(null);
    }
  };

  // Action: Ping Backups
  const handlePingBackups = async (shiftId) => {
    try {
      setPingingId(shiftId);
      setActionNotice(null);
      const res = await api.post(`/events/${eventId}/mission/ping-backups`, { shiftId });
      setActionNotice({ tone: 'success', message: res.data.message || 'Waitlisted crew notified successfully!' });
      setTimeout(() => setActionNotice(null), 4000);
      fetchSnapshot();
    } catch (err) {
      setActionNotice({ tone: 'danger', message: errorMessage(err) });
    } finally {
      setPingingId(null);
    }
  };

  // Action: Nudge Volunteer
  const handleNudge = async (signupId, volunteerName) => {
    try {
      setNudgingId(signupId);
      setActionNotice(null);
      const res = await api.post(`/events/${eventId}/mission/nudge`, { signupId });
      setActionNotice({ tone: 'success', message: res.data.message || `Notified ${volunteerName || 'volunteer'}!` });
      setTimeout(() => setActionNotice(null), 4000);
      fetchSnapshot();
    } catch (err) {
      setActionNotice({ tone: 'danger', message: errorMessage(err) });
    } finally {
      setNudgingId(null);
    }
  };

  const filteredShifts = useMemo(() => {
    if (!snapshot?.shifts) return [];
    if (selectedRole === 'all') return snapshot.shifts;
    return snapshot.shifts.filter((s) => s.roleId === selectedRole || s.roleName === selectedRole);
  }, [snapshot?.shifts, selectedRole]);

  if (loading && !snapshot) {
    return (
      <div style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
        <Spinner />
        <p style={{ marginTop: '0.85rem', fontWeight: 800, color: '#475569' }}>
          Initializing Mission Control Room...
        </p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div style={{ padding: '2rem 1rem' }}>
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  }

  const kpis = snapshot?.kpis || {
    totalCapacity: 0,
    totalConfirmed: 0,
    totalPresent: 0,
    totalLate: 0,
    totalNoShow: 0,
    totalGap: 0,
    checkInRate: 0,
  };

  const alerts = snapshot?.alerts || [];

  return (
    <div className="mission-control-root" style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
      {/* 1. Cockpit Header Card */}
      <div
        className="mission-cockpit-bar"
        style={{
          background: '#0f172a',
          color: '#ffffff',
          borderRadius: '18px',
          padding: '1.25rem 1.65rem',
          border: '2.5px solid #0f172a',
          boxShadow: '5px 5px 0px #0f172a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🛰️</span>
            <div>
              <h2 style={{ margin: 0, color: '#ffffff', fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 950 }}>
                {event.title} • Live Control Room
              </h2>
              <span style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600 }}>
                📅 {formatRange(event.startDate, event.endDate)} {event.venue?.city ? `• 📍 ${event.venue.city}` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Top Controls: Sound Toggle, Status Badge, Manual Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Sound Alert Toggle */}
          <button
            type="button"
            onClick={toggleSound}
            style={{
              background: soundEnabled ? '#fef08a' : '#1e293b',
              color: soundEnabled ? '#854d0e' : '#cbd5e1',
              border: '1.5px solid #475569',
              borderRadius: '999px',
              padding: '7px 15px',
              fontSize: '0.82rem',
              fontWeight: 850,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              transition: 'all 0.15s ease',
            }}
            title="Toggle audible chimes for critical alerts"
            aria-pressed={soundEnabled}
          >
            <span>{soundEnabled ? '🔔' : '🔕'}</span>
            <span>Sound Alerts: {soundEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* Connection Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '7px 15px',
              borderRadius: '999px',
              border: '1.5px solid #475569',
              background: '#1e293b',
              fontSize: '0.82rem',
              fontWeight: 850,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background:
                  connectionStatus === 'live' ? '#22c55e' : connectionStatus === 'polling' ? '#f59e0b' : '#ef4444',
                boxShadow: connectionStatus === 'live' ? '0 0 10px #22c55e' : 'none',
              }}
            />
            <span style={{ color: '#f8fafc' }}>
              {connectionStatus === 'live'
                ? 'Live Socket'
                : connectionStatus === 'polling'
                ? 'Polling (10s)'
                : 'Offline'}
            </span>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchSnapshot()}
            style={{
              background: '#334155',
              color: '#ffffff',
              border: '1.5px solid #475569',
              borderRadius: '10px',
              padding: '7px 14px',
              fontSize: '0.82rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
            title="Force refresh snapshot from server"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {actionNotice && (
        <Notice tone={actionNotice.tone}>{actionNotice.message}</Notice>
      )}

      {/* 2. KPI Control Strip */}
      <div
        className="mission-kpi-strip"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.85rem',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: '14px',
            padding: '0.9rem 1.1rem',
            boxShadow: '3.5px 3.5px 0px #0f172a',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 850, color: '#475569', textTransform: 'uppercase' }}>
            Present Crew
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 950, color: '#15803d', marginTop: '0.15rem' }}>
            {kpis.totalPresent}
            <span style={{ fontSize: '1rem', color: '#64748b', fontWeight: 700 }}> / {kpis.totalCapacity}</span>
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: '14px',
            padding: '0.9rem 1.1rem',
            boxShadow: '3.5px 3.5px 0px #0f172a',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 850, color: '#475569', textTransform: 'uppercase' }}>
            Confirmed Crew
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 950, color: '#0f172a', marginTop: '0.15rem' }}>
            {kpis.totalConfirmed}
          </div>
        </div>

        <div
          style={{
            background: kpis.totalGap > 0 ? '#fff1f2' : '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: '14px',
            padding: '0.9rem 1.1rem',
            boxShadow: '3.5px 3.5px 0px #0f172a',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 850, color: kpis.totalGap > 0 ? '#be123c' : '#475569', textTransform: 'uppercase' }}>
            Staffing Gap
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 950, color: kpis.totalGap > 0 ? '#b91c1c' : '#0f172a', marginTop: '0.15rem' }}>
            {kpis.totalGap}
          </div>
        </div>

        <div
          style={{
            background: kpis.totalLate > 0 ? '#fefce8' : '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: '14px',
            padding: '0.9rem 1.1rem',
            boxShadow: '3.5px 3.5px 0px #0f172a',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 850, color: kpis.totalLate > 0 ? '#854d0e' : '#475569', textTransform: 'uppercase' }}>
            Late Volunteers
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 950, color: kpis.totalLate > 0 ? '#b45309' : '#0f172a', marginTop: '0.15rem' }}>
            {kpis.totalLate}
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: '14px',
            padding: '0.9rem 1.1rem',
            boxShadow: '3.5px 3.5px 0px #0f172a',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 850, color: '#475569', textTransform: 'uppercase' }}>
            Check-in Rate
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 950, color: '#2563eb', marginTop: '0.15rem' }}>
            {kpis.checkInRate}%
          </div>
        </div>

        <div
          style={{
            background: alerts.length > 0 ? '#fef2f2' : '#f0fdf4',
            border: '2px solid #0f172a',
            borderRadius: '14px',
            padding: '0.9rem 1.1rem',
            boxShadow: '3.5px 3.5px 0px #0f172a',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 850, color: alerts.length > 0 ? '#991b1b' : '#166534', textTransform: 'uppercase' }}>
            Active Alerts
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 950, color: alerts.length > 0 ? '#dc2626' : '#15803d', marginTop: '0.15rem' }}>
            {alerts.length}
          </div>
        </div>
      </div>

      {/* 3. Command Row: Real-Time Incident Alerts (Left) + Volunteer Broadcast Center (Right) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '1.25rem',
          alignItems: 'stretch',
        }}
      >
        {/* Real-Time Incident Alerts */}
        <section
          aria-live="polite"
          role="region"
          aria-label="Mission control alerts"
          style={{
            background: '#ffffff',
            border: '2.5px solid #0f172a',
            borderRadius: '18px',
            padding: '1.35rem',
            boxShadow: '4px 4px 0px #0f172a',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.3rem' }}>⚠️</span>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 950, color: '#0f172a' }}>
                  Real-Time Incident Alerts ({alerts.length})
                </h3>
              </div>
              <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>
                Live updates enabled
              </span>
            </div>

            {alerts.length === 0 ? (
              <div
                style={{
                  padding: '2rem 1.25rem',
                  textAlign: 'center',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1.5px dashed #cbd5e1',
                  color: '#475569',
                  fontWeight: 750,
                  fontSize: '0.92rem',
                }}
              >
                ✅ All shifts are fully staffed and on schedule. No urgent operational incidents reported!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '340px', overflowY: 'auto', paddingRight: '0.2rem' }}>
                {alerts.map((alert) => {
                  const isVolunteerIssue = alert.type === 'volunteer_issue';
                  const isUnderstaffed = alert.type === 'understaffed';
                  const isLate = alert.type === 'late';
                  const isWaitlist = alert.type === 'spot_free_waitlist';

                  let badgeText = '🚨 INCIDENT';
                  let badgeBg = '#fecdd3';
                  if (isVolunteerIssue) {
                    badgeText = `🚨 VOLUNTEER ISSUE: ${(alert.category || 'GROUND').toUpperCase()}`;
                    badgeBg = '#fee2e2';
                  } else if (isUnderstaffed) {
                    badgeText = '🚨 UNDERSTAFFED';
                    badgeBg = '#fecdd3';
                  } else if (isLate) {
                    badgeText = '⏰ LATE VOLUNTEER';
                    badgeBg = '#fef08a';
                  } else if (isWaitlist) {
                    badgeText = '👥 WAITLIST AVAILABLE';
                    badgeBg = '#bae6fd';
                  }

                  return (
                    <div
                      key={alert.id}
                      style={{
                        padding: '0.85rem 1rem',
                        borderRadius: '12px',
                        border: '2px solid #0f172a',
                        background: isVolunteerIssue ? '#fff1f2' : isUnderstaffed ? '#fff5f5' : isLate ? '#fffbeb' : '#f0f9ff',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 950,
                            padding: '2px 8px',
                            borderRadius: '6px',
                            border: '1px solid #0f172a',
                            background: badgeBg,
                            color: '#0f172a',
                          }}
                        >
                          {badgeText}
                        </span>

                        {alert.createdAt && (
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 650 }}>
                            {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a', lineHeight: '1.4' }}>
                        {alert.message}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.2rem' }}>
                        {isVolunteerIssue && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{
                              fontSize: '0.74rem',
                              padding: '4px 10px',
                              fontWeight: 900,
                              background: '#22c55e',
                              color: '#ffffff',
                              border: '1.5px solid #0f172a',
                              boxShadow: '2px 2px 0px #0f172a',
                            }}
                            onClick={() => handleResolveIncident(alert.incidentId)}
                            disabled={resolvingId === alert.incidentId}
                          >
                            {resolvingId === alert.incidentId ? 'Resolving...' : '✓ Mark Resolved'}
                          </button>
                        )}

                        {isWaitlist && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{
                              fontSize: '0.75rem',
                              padding: '4px 10px',
                              fontWeight: 900,
                              boxShadow: '2px 2px 0px #0f172a',
                            }}
                            onClick={() => handlePingBackups(alert.shiftId)}
                            disabled={pingingId === alert.shiftId}
                          >
                            {pingingId === alert.shiftId ? 'Pinging...' : '📢 Ping Backups'}
                          </button>
                        )}

                        {isLate && alert.signupId && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{
                              fontSize: '0.75rem',
                              padding: '4px 10px',
                              fontWeight: 900,
                              boxShadow: '2px 2px 0px #0f172a',
                              background: '#fef08a',
                              color: '#854d0e',
                            }}
                            onClick={() => handleNudge(alert.signupId, alert.volunteerName)}
                            disabled={nudgingId === alert.signupId}
                          >
                            {nudgingId === alert.signupId ? 'Nudging...' : '🔔 Nudge Volunteer'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Organizer Broadcast Message Area (Delivers into Volunteer Notification Bar) */}
        <section
          style={{
            background: '#ffffff',
            border: '2.5px solid #0f172a',
            borderRadius: '18px',
            padding: '1.35rem',
            boxShadow: '4px 4px 0px #0f172a',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.3rem' }}>📢</span>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 950, color: '#0f172a' }}>
                Broadcast to Event Volunteers
              </h3>
            </div>
            <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
              Type an announcement or instruction. It delivers instantly to all registered crew members in their notification bar / bell icon.
            </p>

            {broadcastSuccess && (
              <div style={{ marginBottom: '0.75rem' }}>
                <Notice tone="success">{broadcastSuccess}</Notice>
              </div>
            )}

            <form onSubmit={handleSendBroadcast}>
              <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Optional Title (e.g. Lunch Break, Gate Change)"
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: '180px',
                    border: '1.5px solid #0f172a',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                  }}
                />

                <select
                  value={broadcastPriority}
                  onChange={(e) => setBroadcastPriority(e.target.value)}
                  style={{
                    border: '1.5px solid #0f172a',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '0.84rem',
                    fontWeight: 800,
                    background: broadcastPriority === 'urgent' ? '#fee2e2' : '#ffffff',
                    color: broadcastPriority === 'urgent' ? '#991b1b' : '#0f172a',
                  }}
                >
                  <option value="normal">📢 Normal Announcement</option>
                  <option value="urgent">🚨 Urgent Priority Alert</option>
                </select>
              </div>

              <textarea
                rows={3}
                required
                placeholder="Type your message to all volunteers here... (e.g. 'All registration desk crew please report to Gate B now for briefing.')"
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                style={{
                  width: '100%',
                  border: '1.5px solid #0f172a',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '0.88rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isBroadcasting || !broadcastMsg.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.88rem',
                    fontWeight: 900,
                    boxShadow: '3px 3px 0px #0f172a',
                  }}
                >
                  {isBroadcasting ? 'Broadcasting...' : '📢 Send Broadcast to Notification Bar'}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>

      {/* 4. Operations Console: Live Shift Operations (Left) + Intelligence Sidebar (Right) */}
      <div className="mission-ops-layout">
        {/* Left Column: Shift Operational Status */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.95rem', flexWrap: 'wrap', gap: '0.65rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 950, color: '#0f172a' }}>
                Shift Operational Status ({filteredShifts.length})
              </h3>
              <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                Live real-time monitoring of crew positions, spots filled, late reporting, and waitlists.
              </span>
            </div>

            {/* Role Filter Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label htmlFor="mission-role-filter" style={{ fontSize: '0.84rem', fontWeight: 800, color: '#475569' }}>
                Filter Role:
              </label>
              <select
                id="mission-role-filter"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{
                  border: '2px solid #0f172a',
                  borderRadius: '8px',
                  padding: '5px 10px',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  background: '#ffffff',
                  color: '#0f172a',
                }}
              >
                <option value="all">All Roles ({snapshot?.roles?.length || 0})</option>
                {snapshot?.roles?.map((r) => (
                  <option key={r.roleId} value={r.roleId}>
                    {r.roleName} ({r.present}/{r.capacity})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredShifts.length === 0 ? (
            <Empty title="No shifts found">
              Create volunteer shifts in the Shifts tab to monitor them in Mission Control.
            </Empty>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: filteredShifts.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1.15rem',
              }}
            >
              {filteredShifts.map((shift) => (
                <ShiftTile
                  key={shift.shiftId}
                  shift={shift}
                  onPingBackups={handlePingBackups}
                  onNudge={handleNudge}
                  pingingId={pingingId}
                  nudgingId={nudgingId}
                  onOpenRoster={setRosterShift}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Live Operations Activity Ticker & Role Staffing Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Real-Time Activity Ticker */}
          <div
            style={{
              background: '#ffffff',
              border: '2px solid #0f172a',
              borderRadius: '16px',
              padding: '1.25rem',
              boxShadow: '4px 4px 0px #0f172a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.2rem' }}>📡</span>
              <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 950, color: '#0f172a' }}>
                Live Operations Activity Ticker
              </h4>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: '260px',
                overflowY: 'auto',
                paddingRight: '0.2rem',
              }}
            >
              {activityTicker.length === 0 ? (
                <p style={{ fontSize: '0.84rem', color: '#64748b', margin: 0, fontStyle: 'italic', padding: '0.5rem 0' }}>
                  Awaiting real-time check-in, check-out, broadcasts, or volunteer issue reports...
                </p>
              ) : (
                activityTicker.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: '0.82rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ fontWeight: 750, color: '#0f172a' }}>{item.text}</span>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{item.time}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Role Summary Column */}
          <div
            style={{
              background: '#ffffff',
              border: '2px solid #0f172a',
              borderRadius: '16px',
              padding: '1.25rem',
              boxShadow: '4px 4px 0px #0f172a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.2rem' }}>👥</span>
              <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 950, color: '#0f172a' }}>
                Role Staffing Summary
              </h4>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {snapshot?.roles?.length === 0 ? (
                <p style={{ fontSize: '0.84rem', color: '#64748b', margin: 0, fontStyle: 'italic' }}>
                  No crew roles defined yet.
                </p>
              ) : (
                snapshot?.roles?.map((r) => (
                  <div
                    key={r.roleId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1.5px solid #0f172a',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{r.roleName}</div>
                    <div style={{ fontWeight: 950, color: r.gap > 0 ? '#dc2626' : '#15803d' }}>
                      {r.present} / {r.capacity} Filled
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Roster Modal for Shift Details */}
      {rosterShift && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="roster-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 9999,
          }}
          onClick={() => setRosterShift(null)}
        >
          <div
            style={{
              background: '#ffffff',
              border: '2.5px solid #0f172a',
              borderRadius: '20px',
              padding: '1.5rem',
              maxWidth: '540px',
              width: '100%',
              boxShadow: '6px 6px 0px #0f172a',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 id="roster-modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 950, color: '#0f172a' }}>
                {rosterShift.roleName} Crew Roster
              </h3>
              <button
                type="button"
                onClick={() => setRosterShift(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.3rem',
                  cursor: 'pointer',
                  fontWeight: 900,
                  color: '#0f172a',
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.84rem', color: '#64748b', margin: '0 0 1rem' }}>
              Shift time: {new Date(rosterShift.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
              {new Date(rosterShift.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {rosterShift.volunteers?.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>
                  No volunteers signed up for this shift yet.
                </p>
              ) : (
                rosterShift.volunteers?.map((v) => (
                  <div
                    key={v.signupId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      border: '1.5px solid #0f172a',
                      background: v.status === 'present' ? '#f0fdf4' : v.status === 'late' ? '#fefce8' : '#ffffff',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900, fontSize: '0.92rem', color: '#0f172a' }}>
                        {v.name}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {v.email} {v.phone ? `• ${v.phone}` : ''}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 900,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          border: '1px solid #0f172a',
                          background:
                            v.status === 'present'
                              ? '#bbf7d0'
                              : v.status === 'late'
                              ? '#fef08a'
                              : v.status === 'no_show'
                              ? '#fecdd3'
                              : '#e2e8f0',
                          color: '#0f172a',
                          textTransform: 'capitalize',
                        }}
                      >
                        {v.status === 'present'
                          ? 'Present'
                          : v.status === 'late'
                          ? 'Late (10+ min)'
                          : v.status === 'no_show'
                          ? 'No Show'
                          : 'Expected'}
                      </span>

                      {v.status === 'late' && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            fontWeight: 900,
                            background: '#fef08a',
                            color: '#854d0e',
                          }}
                          onClick={() => handleNudge(v.signupId, v.name)}
                          disabled={nudgingId === v.signupId}
                        >
                          {nudgingId === v.signupId ? 'Nudging...' : '🔔 Nudge'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
