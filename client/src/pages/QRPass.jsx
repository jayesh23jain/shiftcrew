import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api, { errorMessage } from '../api/client.js';
import { ATT_LABEL, CATEGORIES, formatDateTime, formatShift, formatTime, makeGoogleMapsDirectionsUrl, payLabel } from '../lib.js';
import { Spinner } from '../components/ui.jsx';

const CAT_COLORS = {
  sports: '#bbf7d0',
  music: '#fed7aa',
  tech: '#ddd6fe',
  festival: '#fef08a',
  charity: '#fecdd3',
  conference: '#bae6fd',
  college_fest: '#fef08a',
  community: '#bbf7d0',
  general: '#e2e8f0',
};

export default function QRPass() {
  const { shiftId } = useParams();
  const [pass, setPass] = useState(null);
  const [error, setError] = useState('');
  const [secs, setSecs] = useState(45);
  const [copied, setCopied] = useState(false);
  const [showTestCode, setShowTestCode] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const { data } = await api.get(`/attendance/pass/${shiftId}`);
        if (!stop) {
          setPass(data);
          setError('');
        }
      } catch (err) {
        if (!stop) {
          setError(errorMessage(err));
          setPass(null);
        }
      }
    };
    load();
    const t = setInterval(load, 45_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [shiftId]);

  useEffect(() => {
    const t = setInterval(() => {
      if (pass?.expiresAt) {
        const remaining = Math.max(0, Math.round((new Date(pass.expiresAt) - Date.now()) / 1000));
        setSecs(remaining);
      }
    }, 500);
    return () => clearInterval(t);
  }, [pass]);

  const copyToken = () => {
    if (!pass?.token) return;
    navigator.clipboard.writeText(pass.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const status = pass?.attendance?.status;
  const event = pass?.event || {};
  const shift = pass?.shift || {};
  const role = pass?.role || {};
  const user = pass?.user || {};
  const headerColor = CAT_COLORS[event.category] || '#bae6fd';
  const mapsUrl = event.venue ? makeGoogleMapsDirectionsUrl(event.venue) : null;

  // Percentage for timer bar
  const timerPercent = Math.min(100, Math.max(0, Math.round((secs / 45) * 100)));

  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '0.25rem 0.5rem 1.5rem' }}>
      {/* Top Navigation Row */}
      <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link
          to="/my-shifts"
          className="btn btn-white"
          style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            border: '2px solid #0f172a',
            boxShadow: '2px 2px 0px #0f172a',
            padding: '0.3rem 0.75rem',
          }}
        >
          ← Back to My Shifts
        </Link>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-white"
              style={{
                fontSize: '0.78rem',
                fontWeight: 800,
                border: '2px solid #0f172a',
                boxShadow: '2px 2px 0px #0f172a',
                padding: '0.3rem 0.65rem',
              }}
            >
              📍 Map
            </a>
          )}
          <button
            onClick={() => window.print()}
            className="btn btn-white"
            style={{
              fontSize: '0.78rem',
              fontWeight: 800,
              border: '2px solid #0f172a',
              boxShadow: '2px 2px 0px #0f172a',
              padding: '0.3rem 0.65rem',
            }}
          >
            🖨️ Print
          </button>
        </div>
      </div>

      {error ? (
        /* Error or Revoked / Settled State Card */
        <div
          style={{
            background: '#ffffff',
            border: '3px solid #0f172a',
            boxShadow: '6px 6px 0px #0f172a',
            borderRadius: '20px',
            padding: '2rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>
            {error.toLowerCase().includes('cancel')
              ? '🚫'
              : error.toLowerCase().includes('paid') || error.toLowerCase().includes('complet')
              ? '🎉'
              : '⚠️'}
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.35rem',
              fontWeight: 950,
              color: '#0f172a',
              margin: '0 0 0.5rem',
            }}
          >
            {error.toLowerCase().includes('cancel')
              ? 'Pass Revoked: Event Cancelled'
              : error.toLowerCase().includes('paid') || error.toLowerCase().includes('complet')
              ? 'Duty Completed & Settled'
              : 'Pass Unavailable'}
          </h2>
          <p
            style={{
              fontSize: '0.9rem',
              color: '#334155',
              lineHeight: '1.5',
              margin: '0 0 1.25rem',
              fontWeight: 600,
            }}
          >
            {error}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link
              to="/my-shifts"
              className="btn btn-primary"
              style={{ padding: '0.55rem 1.15rem', fontWeight: 850, fontSize: '0.88rem' }}
            >
              Return to My Shifts
            </Link>
            <Link
              to="/notifications"
              className="btn btn-white"
              style={{ padding: '0.55rem 1rem', fontSize: '0.85rem', fontWeight: 800, border: '2px solid #0f172a' }}
            >
              🔔 Notifications
            </Link>
          </div>
        </div>
      ) : !pass ? (
        <Spinner label="Loading accreditation pass..." />
      ) : (
        /* Vertical Physical Event Badge (Compact Height - Zero Scroll) */
        <div>
          {/* Lanyard Top Accent */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '-8px', position: 'relative', zIndex: 2 }}>
            <div
              style={{
                width: '24px',
                height: '18px',
                background: '#0f172a',
                borderRadius: '6px 6px 0 0',
                border: '2px solid #0f172a',
                borderBottom: 'none',
              }}
            />
            <div
              style={{
                width: '42px',
                height: '9px',
                background: '#94a3b8',
                border: '2px solid #0f172a',
                borderRadius: '3px',
              }}
            />
          </div>

          {/* Main Badge Card */}
          <div
            style={{
              background: '#ffffff',
              border: '3px solid #0f172a',
              borderRadius: '20px',
              boxShadow: '6px 6px 0px #0f172a',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* Top Lanyard Slot Cutout in Card */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '6px', background: headerColor }}>
              <div
                style={{
                  width: '48px',
                  height: '7px',
                  background: '#0f172a',
                  borderRadius: '999px',
                }}
              />
            </div>

            {/* Event Category & Badge Header Banner */}
            <div
              style={{
                background: headerColor,
                borderBottom: '2.5px solid #0f172a',
                padding: '0.45rem 1rem 0.55rem',
                textAlign: 'center',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    background: '#0f172a',
                    color: '#ffffff',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    letterSpacing: '0.4px',
                  }}
                >
                  {CATEGORIES[event.category] || event.category || 'EVENT'}
                </span>

                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    background: '#ffffff',
                    color: '#0f172a',
                    border: '1.2px solid #0f172a',
                    padding: '1px 7px',
                    borderRadius: '999px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '999px', background: '#22c55e', display: 'inline-block' }} />
                  CREW ACCREDITATION
                </span>
              </div>

              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.35rem',
                  fontWeight: 950,
                  color: '#0f172a',
                  margin: '0 0 0.1rem',
                  lineHeight: 1.15,
                }}
              >
                {event.title || 'Official Event Pass'}
              </h1>

              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                📍 {event.venue?.name ? `${event.venue.name}, ` : ''}{event.venue?.city || 'Venue Location'}
              </div>
            </div>

            {/* Volunteer Identity & Role Profile */}
            <div style={{ padding: '0.6rem 1rem 0.45rem', background: '#ffffff', textAlign: 'center' }}>
              <div
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  color: '#64748b',
                  letterSpacing: '0.5px',
                  marginBottom: '0.1rem',
                }}
              >
                ACCREDITED VOLUNTEER
              </div>

              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.3rem',
                  fontWeight: 950,
                  color: '#0f172a',
                  margin: '0 0 0.3rem',
                }}
              >
                {user.name || 'Crew Member'}
              </h2>

              {/* Role Designation Badges */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                <span
                  style={{
                    background: '#fef3c7',
                    color: '#92400e',
                    border: '1.5px solid #0f172a',
                    padding: '2px 9px',
                    borderRadius: '999px',
                    fontSize: '0.76rem',
                    fontWeight: 850,
                  }}
                >
                  🎯 {role.name || 'Duty Role'}
                </span>

                {user.reliabilityScore !== undefined && (
                  <span
                    style={{
                      background: '#ecfdf5',
                      color: '#047857',
                      border: '1.5px solid #0f172a',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '0.74rem',
                      fontWeight: 850,
                    }}
                  >
                    ⭐ {user.reliabilityScore}/100
                  </span>
                )}
              </div>

              {/* Live Attendance Status Indicator Banner */}
              <div
                style={{
                  background:
                    status === 'present'
                      ? '#dcfce7'
                      : status === 'approved'
                      ? '#e0e7ff'
                      : status === 'rejected'
                      ? '#fee2e2'
                      : '#f8fafc',
                  border: '1.5px solid #0f172a',
                  borderRadius: '9px',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 850,
                  color:
                    status === 'present'
                      ? '#15803d'
                      : status === 'approved'
                      ? '#4338ca'
                      : status === 'rejected'
                      ? '#b91c1c'
                      : '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                {status === 'present' ? (
                  <>🟢 ON DUTY • Checked in {pass.attendance?.checkInAt ? `at ${formatTime(pass.attendance.checkInAt)}` : ''}</>
                ) : status === 'approved' ? (
                  <>🎉 COMPLETED • Hours approved for payout</>
                ) : status === 'rejected' ? (
                  <>⚠️ ATTENDANCE FLAGGED</>
                ) : (
                  <>🟡 NOT CHECKED IN YET • Present pass at desk</>
                )}
              </div>
            </div>

            {/* Perforated Ticket Notches & Perforation Line */}
            <div style={{ position: 'relative', margin: '0.35rem 0' }}>
              {/* Left Notch */}
              <div
                style={{
                  position: 'absolute',
                  left: '-12px',
                  top: '-12px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: '#f8fafc',
                  border: '2.5px solid #0f172a',
                  zIndex: 1,
                }}
              />
              {/* Perforation Dashed Line */}
              <div style={{ borderTop: '2px dashed #0f172a', width: '100%', height: '1px' }} />
              {/* Right Notch */}
              <div
                style={{
                  position: 'absolute',
                  right: '-12px',
                  top: '-12px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: '#f8fafc',
                  border: '2.5px solid #0f172a',
                  zIndex: 1,
                }}
              />
            </div>

            {/* Secure QR Code Station */}
            <div style={{ padding: '0.65rem 1rem 0.75rem', background: '#fafafa', textAlign: 'center' }}>
              {/* Framed QR Code (Compact 165px) */}
              <div
                style={{
                  display: 'inline-block',
                  background: '#ffffff',
                  border: '2.5px solid #0f172a',
                  borderRadius: '16px',
                  padding: '0.65rem',
                  boxShadow: '3px 3px 0px #0f172a',
                  marginBottom: '0.5rem',
                }}
              >
                <QRCodeSVG
                  value={pass.token}
                  size={165}
                  level="H"
                  marginSize={1}
                />
              </div>

              {/* Dynamic Countdown Timer */}
              <div style={{ maxWidth: '240px', margin: '0 auto 0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px', fontSize: '0.74rem', fontWeight: 850 }}>
                  <span style={{ color: '#0f172a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '999px', background: '#3b82f6', display: 'inline-block' }} />
                    Refreshes in
                  </span>
                  <span style={{ color: secs <= 10 ? '#dc2626' : '#0f172a', fontFamily: 'monospace', fontSize: '0.84rem', fontWeight: 900 }}>
                    {secs}s
                  </span>
                </div>

                {/* Live Progress Bar */}
                <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden', border: '1px solid #0f172a' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${timerPercent}%`,
                      background: secs <= 10 ? '#ef4444' : '#10b981',
                      transition: 'width 0.5s linear',
                    }}
                  />
                </div>
              </div>

              {/* Security Hologram Notice */}
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 650, marginBottom: '0.25rem' }}>
                🔒 Anti-screenshot dynamic code
              </div>

              {/* Test Code Drawer Toggle */}
              <button
                type="button"
                onClick={() => setShowTestCode(!showTestCode)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#4338ca',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: '2px',
                }}
              >
                {showTestCode ? '▲ Hide test code' : '▼ Test check-in code'}
              </button>

              {showTestCode && (
                <div
                  style={{
                    marginTop: '0.45rem',
                    padding: '0.5rem',
                    background: '#f1f5f9',
                    borderRadius: '8px',
                    border: '1.2px solid #0f172a',
                    maxWidth: '260px',
                    margin: '0.45rem auto 0',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <input
                      readOnly
                      value={pass.token}
                      onClick={(e) => e.target.select()}
                      style={{
                        flex: '1',
                        fontSize: '0.7rem',
                        fontFamily: 'monospace',
                        padding: '4px 6px',
                        borderRadius: '4px',
                        border: '1px solid #0f172a',
                        background: '#ffffff',
                      }}
                    />
                    <button
                      type="button"
                      onClick={copyToken}
                      className="btn btn-primary"
                      style={{ padding: '2px 8px', fontSize: '0.7rem', fontWeight: 850 }}
                    >
                      {copied ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Shift Logistics & Payout Stub */}
            <div
              style={{
                borderTop: '2px solid #0f172a',
                background: '#ffffff',
                padding: '0.55rem 1rem',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
              }}
            >
              <div>
                <span style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', color: '#64748b', display: 'block' }}>
                  SHIFT SCHEDULE
                </span>
                <div style={{ fontSize: '0.78rem', fontWeight: 850, color: '#0f172a', marginTop: '1px' }}>
                  {shift.start && shift.end ? formatShift(shift.start, shift.end) : 'Schedule on Roster'}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', color: '#64748b', display: 'block' }}>
                  STIPEND
                </span>
                <div style={{ fontSize: '0.78rem', fontWeight: 850, color: '#15803d', marginTop: '1px' }}>
                  {payLabel(shift)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
