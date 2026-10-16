import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import api, { downloadFile } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDateTime, hoursText } from '../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../components/ui.jsx';

const CERT_COLORS = ['#bbf7d0', '#ddd6fe', '#fed7aa', '#fef08a', '#bae6fd', '#fecdd3'];

export function Certificates() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('mine'); // 'mine' | 'verify'
  const [selectedCert, setSelectedCert] = useState(null); // for in-browser certificate modal preview
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCode, setCopiedCode] = useState('');

  // 1. Fetch user certificates
  const { data: certs = [], isLoading } = useQuery({
    queryKey: ['certs'],
    queryFn: async () => (await api.get('/certificates/mine')).data.certificates,
  });

  // 2. Fetch stats for overall volunteer hours
  const { data: stats } = useQuery({
    queryKey: ['my-stats'],
    queryFn: async () => (await api.get('/me/stats')).data,
  });

  // Aggregate stats
  const totalMinutes = useMemo(() => certs.reduce((acc, c) => acc + (c.minutes || 0), 0), [certs]);
  const uniqueOrgs = useMemo(() => new Set(certs.map((c) => c.orgName).filter(Boolean)).size, [certs]);

  // Filter certificates by search
  const filteredCerts = useMemo(() => {
    if (!searchQuery.trim()) return certs;
    const q = searchQuery.toLowerCase().trim();
    return certs.filter(
      (c) =>
        c.eventTitle?.toLowerCase().includes(q) ||
        c.orgName?.toLowerCase().includes(q) ||
        c.code?.toLowerCase().includes(q)
    );
  }, [certs, searchQuery]);

  const copyCodeToClipboard = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(''), 2500);
  };

  const copyShareLink = (code) => {
    const url = `${window.location.origin}/verify/${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(url);
    window.alert(`Copied official verification link:\n${url}`);
  };

  if (isLoading) return <Spinner label="Loading your verified credentials..." />;

  return (
    <div className="organizer-dashboard-wrap" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <span className="dash-alert-badge" style={{ background: '#ddd6fe', color: '#4338ca', marginBottom: '0.5rem', display: 'inline-block' }}>
            🏆 OFFICIAL SERVICE CREDENTIALS
          </span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 950, color: '#0f172a', margin: '0.2rem 0 0' }}>
            Volunteer Certificates
          </h1>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.94rem', color: '#64748b', fontWeight: 650 }}>
            Official proof of service, accredited volunteering hours, and skills credentials issued by event organizers.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-white"
            onClick={() => setActiveTab(activeTab === 'verify' ? 'mine' : 'verify')}
            style={{ fontWeight: 850, border: '2px solid #0f172a', borderRadius: '999px', padding: '0.55rem 1.15rem' }}
          >
            {activeTab === 'verify' ? '← Back to My Certificates' : '🔍 Verify a Certificate Code'}
          </button>
          <Link to="/events" className="btn btn-primary" style={{ padding: '0.55rem 1.25rem', fontWeight: 900, borderRadius: '999px' }}>
            Browse More Shifts →
          </Link>
        </div>
      </div>

      {/* Top 3 Neo-Brutalist Credential Metric Cards */}
      <div className="dash-stats-grid" style={{ marginBottom: '1.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div className="dash-stat-card stat-mint">
          <span className="dash-stat-label">Certificates Earned</span>
          <span className="dash-stat-val">{certs.length}</span>
          <span className="dash-stat-hint">Issued across completed volunteer events</span>
        </div>

        <div className="dash-stat-card stat-yellow">
          <span className="dash-stat-label">Accredited Service</span>
          <span className="dash-stat-val">{hoursText(totalMinutes || stats?.minutes || 0)}</span>
          <span className="dash-stat-hint">Approved by organizing committee leads</span>
        </div>

        <div className="dash-stat-card stat-lavender">
          <span className="dash-stat-label">Recognized Organizations</span>
          <span className="dash-stat-val">{uniqueOrgs}</span>
          <span className="dash-stat-hint">Trusted organizers crediting your portfolio</span>
        </div>
      </div>

      {/* Interactive Tabs & Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem', marginBottom: '1.35rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setActiveTab('mine')}
            style={{
              padding: '6px 16px',
              borderRadius: '999px',
              fontSize: '0.84rem',
              fontWeight: 850,
              cursor: 'pointer',
              border: '2px solid #0f172a',
              background: activeTab === 'mine' ? '#0f172a' : '#ffffff',
              color: activeTab === 'mine' ? '#ffffff' : '#0f172a',
              boxShadow: activeTab === 'mine' ? '2px 2px 0px #0f172a' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            📜 My Certificates ({certs.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('verify')}
            style={{
              padding: '6px 16px',
              borderRadius: '999px',
              fontSize: '0.84rem',
              fontWeight: 850,
              cursor: 'pointer',
              border: '2px solid #0f172a',
              background: activeTab === 'verify' ? '#0f172a' : '#ffffff',
              color: activeTab === 'verify' ? '#ffffff' : '#0f172a',
              boxShadow: activeTab === 'verify' ? '2px 2px 0px #0f172a' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            🔍 Instant Authenticity Check
          </button>
        </div>

        {activeTab === 'mine' && certs.length > 0 && (
          <div style={{ position: 'relative', minWidth: '240px' }}>
            <input
              type="text"
              placeholder="Filter by event, org, or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 12px',
                fontSize: '0.84rem',
                border: '2px solid #0f172a',
                borderRadius: '8px',
                boxShadow: '2px 2px 0 #0f172a',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      {activeTab === 'verify' ? (
        <div className="dash-card" style={{ maxWidth: '680px', margin: '0 auto', background: '#ffffff', border: '3px solid #0f172a', borderRadius: '18px', padding: '1.75rem' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 950, color: '#0f172a' }}>
            🔍 Public Certificate Authenticity Desk
          </h2>
          <p style={{ margin: '0.35rem 0 1.25rem', fontSize: '0.88rem', color: '#64748b', fontWeight: 600 }}>
            Employers, universities, and partners can verify any ShiftCrew volunteering certificate code here.
          </p>
          <VerifyForm />
        </div>
      ) : filteredCerts.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.35rem' }}>
          {filteredCerts.map((c, idx) => {
            const headerColor = CERT_COLORS[idx % CERT_COLORS.length];
            const isCopied = copiedCode === c.code;

            return (
              <div
                key={c._id}
                style={{
                  background: '#ffffff',
                  borderRadius: '18px',
                  border: '2.5px solid #0f172a',
                  boxShadow: '4px 4px 0px #0f172a',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.18s ease',
                }}
              >
                {/* Header ribbon */}
                <div
                  style={{
                    background: headerColor,
                    padding: '0.75rem 1.1rem',
                    borderBottom: '2px solid #0f172a',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', background: '#0f172a', color: '#ffffff', padding: '2px 7px', borderRadius: '4px' }}>
                      VERIFIED CREDENTIAL
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 850,
                      background: '#ffffff',
                      color: '#0f172a',
                      padding: '2px 8px',
                      borderRadius: '5px',
                      border: '1.5px solid #0f172a',
                    }}
                  >
                    ✓ {hoursText(c.minutes)}
                  </span>
                </div>

                {/* Card Body */}
                <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 950, color: '#0f172a' }}>
                      {c.eventTitle}
                    </h3>
                    <div style={{ marginTop: '0.35rem', fontSize: '0.84rem', color: '#475569', fontWeight: 700 }}>
                      Organized by <strong style={{ color: '#0f172a' }}>{c.orgName || 'Host Organization'}</strong>
                    </div>
                  </div>

                  {/* Verification Code Box */}
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1.5px solid #cbd5e1',
                      borderRadius: '10px',
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                        Verification ID
                      </span>
                      <code style={{ fontSize: '0.92rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
                        {c.code}
                      </code>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyCodeToClipboard(c.code)}
                      style={{
                        background: isCopied ? '#bbf7d0' : '#ffffff',
                        border: '1.5px solid #0f172a',
                        borderRadius: '6px',
                        padding: '4px 9px',
                        fontSize: '0.74rem',
                        fontWeight: 850,
                        cursor: 'pointer',
                        color: isCopied ? '#14532d' : '#0f172a',
                        boxShadow: '1px 1px 0 #0f172a',
                      }}
                    >
                      {isCopied ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>

                  {/* Issued timestamp */}
                  <div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 650 }}>
                    📅 Issued: {c.createdAt ? formatDateTime(c.createdAt) : 'Official Completion'}
                  </div>
                </div>

                {/* Card Actions */}
                <div
                  style={{
                    padding: '0.85rem 1.15rem',
                    background: '#f8fafc',
                    borderTop: '2px solid #0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCert(c)}
                    className="btn btn-primary"
                    style={{ padding: '0.42rem 0.95rem', fontSize: '0.8rem', fontWeight: 850 }}
                  >
                    👁️ View Certificate
                  </button>

                  <div style={{ display: 'flex', gap: '0.45rem' }}>
                    <button
                      type="button"
                      className="btn btn-white"
                      onClick={() => downloadFile(`/certificates/${c._id}/pdf`)}
                      style={{ padding: '0.42rem 0.85rem', fontSize: '0.8rem', fontWeight: 800, border: '1.5px solid #0f172a' }}
                      title="Download Official PDF Certificate"
                    >
                      📥 PDF
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => copyShareLink(c.code)}
                      style={{ padding: '0.42rem 0.75rem', fontSize: '0.8rem', fontWeight: 750 }}
                      title="Copy public share link for resume or LinkedIn"
                    >
                      🔗 Share
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No certificates earned yet">
          Complete shifts and get your hours approved. As soon as the organizer completes and wraps up the event, official certificates will be issued and archived here.
          <div style={{ marginTop: '0.85rem' }}>
            <Link to="/events" className="btn btn-primary" style={{ fontWeight: 850 }}>
              Explore Open Volunteering Roles →
            </Link>
          </div>
        </Empty>
      )}

      {/* Interactive Official Certificate In-Browser Modal ("Something From Our Side!") */}
      {selectedCert && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setSelectedCert(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '3.5px solid #0f172a',
              boxShadow: '8px 8px 0px #0f172a',
              maxWidth: '720px',
              width: '100%',
              overflow: 'hidden',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Ribbon */}
            <div
              style={{
                background: '#fef08a',
                borderBottom: '2.5px solid #0f172a',
                padding: '0.75rem 1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 900, fontSize: '0.85rem', color: '#854d0e', textTransform: 'uppercase' }}>
                🎓 Accredited ShiftCrew Credential
              </span>
              <button
                type="button"
                onClick={() => setSelectedCert(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.25rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  color: '#0f172a',
                }}
              >
                ✕
              </button>
            </div>

            {/* Official Parchment Certificate Frame */}
            <div
              style={{
                padding: '2.5rem 2rem',
                background: '#fffdf5',
                border: '10px double #cbd5e1',
                margin: '1.25rem',
                borderRadius: '12px',
                textAlign: 'center',
                position: 'relative',
              }}
            >
              <div style={{ fontSize: '0.78rem', letterSpacing: '3px', fontWeight: 900, color: '#4338ca', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                ShiftCrew Volunteering Network
              </div>

              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 950, color: '#0f172a', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Certificate of Recognition
              </h2>

              <p style={{ fontSize: '0.92rem', color: '#64748b', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
                This is proudly presented to
              </p>

              <div style={{ fontSize: '1.75rem', fontWeight: 950, color: '#0f172a', textDecoration: 'underline', textUnderlineOffset: '6px', margin: '0 0 1.25rem', fontFamily: 'var(--font-display)' }}>
                {selectedCert.volunteerName || user?.name || 'Volunteer Crew Member'}
              </div>

              <p style={{ fontSize: '0.95rem', color: '#334155', lineHeight: '1.6', maxWidth: '520px', margin: '0 auto 1.5rem', fontWeight: 600 }}>
                In sincere appreciation of outstanding dedication and meritorious service at{' '}
                <strong style={{ color: '#0f172a' }}>{selectedCert.eventTitle}</strong>, contributing{' '}
                <strong style={{ color: '#166534' }}>{hoursText(selectedCert.minutes)}</strong> of verified voluntary crew duty organized by{' '}
                <strong style={{ color: '#0f172a' }}>{selectedCert.orgName}</strong>.
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '2px dashed #cbd5e1', paddingTop: '1.25rem', marginTop: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>ISSUED BY</div>
                  <div style={{ fontWeight: 900, color: '#0f172a', fontSize: '0.9rem' }}>{selectedCert.orgName}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Verified Platform Partner</div>
                </div>

                {/* Embedded QR Authenticity Badge */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ background: '#ffffff', padding: '6px', borderRadius: '8px', border: '1.5px solid #0f172a' }}>
                    <QRCodeSVG
                      value={`${window.location.origin}/verify/${encodeURIComponent(selectedCert.code)}`}
                      size={72}
                      level="M"
                    />
                  </div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 800, marginTop: '3px', color: '#0f172a', fontFamily: 'monospace' }}>
                    {selectedCert.code}
                  </span>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>DATE OF ISSUE</div>
                  <div style={{ fontWeight: 850, color: '#0f172a', fontSize: '0.86rem' }}>
                    {selectedCert.createdAt ? new Date(selectedCert.createdAt).toLocaleDateString() : 'Official'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 800 }}>✓ Digitally Signed</div>
                </div>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div
              style={{
                padding: '0.85rem 1.5rem',
                background: '#f8fafc',
                borderTop: '2.5px solid #0f172a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.6rem',
              }}
            >
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => copyShareLink(selectedCert.code)}
                style={{ fontWeight: 800, fontSize: '0.82rem' }}
              >
                🔗 Copy Verification Link
              </button>

              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-white"
                  onClick={() => setSelectedCert(null)}
                  style={{ fontWeight: 800 }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => downloadFile(`/certificates/${selectedCert._id}/pdf`)}
                  style={{ fontWeight: 900 }}
                >
                  📥 Download Official PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Dedicated Verification Form for the Certificates page tab
function VerifyForm() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.get(`/certificates/verify/${encodeURIComponent(code.trim().toUpperCase())}`);
      setResult(data);
    } catch {
      setResult({ error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form onSubmit={check} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. SC-A1B2-C3D4"
          style={{
            flex: 1,
            minWidth: '220px',
            padding: '10px 14px',
            fontSize: '0.95rem',
            fontFamily: 'monospace',
            fontWeight: 800,
            border: '2px solid #0f172a',
            borderRadius: '10px',
            boxShadow: '2px 2px 0px #0f172a',
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()} style={{ fontWeight: 850 }}>
          {busy ? 'Verifying...' : 'Check Credential →'}
        </button>
      </form>

      {result?.error && (
        <Notice tone="error">
          ⚠️ Could not verify credential at this time. Please check your internet connection or try again.
        </Notice>
      )}

      {result && !result.error && (
        result.valid ? (
          <div
            style={{
              background: '#f0fdf4',
              border: '2px solid #16a34a',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '3px 3px 0 #16a34a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: 900, fontSize: '1rem', marginBottom: '0.5rem' }}>
              ✓ Authentic Credential Verified
            </div>
            <div style={{ fontSize: '0.92rem', color: '#14532d', lineHeight: '1.5', fontWeight: 650 }}>
              <strong>{result.volunteerName}</strong> volunteered for <strong>{hoursText(result.minutes)}</strong> at the event{' '}
              <strong>"{result.eventTitle}"</strong>, officially certified by <strong>{result.orgName}</strong>.
            </div>
            {result.issuedAt && (
              <div style={{ fontSize: '0.78rem', color: '#15803d', marginTop: '0.5rem', fontWeight: 600 }}>
                Issued on {new Date(result.issuedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        ) : (
          <Notice tone="error">
            ❌ Invalid Certificate Code: No authentic ShiftCrew credential matches <strong>{code}</strong>.
          </Notice>
        )
      )}
    </div>
  );
}

// Standalone Public Verification Page (/verify and /verify/:code)
export function Verify() {
  const { code: initial } = useParams();
  const [code, setCode] = useState(initial || '');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.get(`/certificates/verify/${encodeURIComponent(code.trim().toUpperCase())}`);
      setResult(data);
    } catch {
      setResult({ error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth wide" style={{ maxWidth: '640px', margin: '2rem auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#166534', marginBottom: '0.5rem', display: 'inline-block' }}>
          🛡️ PUBLIC VERIFICATION PORTAL
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 950, color: '#0f172a', margin: '0.2rem 0' }}>
          Verify a Certificate
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>
          Enter a ShiftCrew certificate code to verify authentic volunteer service.
        </p>
      </div>

      <form onSubmit={check} style={{ marginBottom: '1.25rem' }}>
        <Field label="Certificate Code (e.g. SC-XXXX-XXXX)">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SC-XXXX-XXXX"
              style={{
                flex: 1,
                minWidth: '200px',
                fontFamily: 'monospace',
                fontSize: '1rem',
                fontWeight: 800,
                padding: '10px 14px',
              }}
            />
            <button className="btn btn-primary" disabled={busy || !code.trim()} style={{ fontWeight: 850 }}>
              {busy ? 'Checking...' : 'Verify Now →'}
            </button>
          </div>
        </Field>
      </form>

      {result?.error && <Notice>Could not check certificate right now. Please try again.</Notice>}

      {result && !result.error && (
        result.valid ? (
          <div
            style={{
              background: '#f0fdf4',
              border: '2.5px solid #16a34a',
              borderRadius: '14px',
              padding: '1.5rem',
              boxShadow: '4px 4px 0 #16a34a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: 900, fontSize: '1.1rem', marginBottom: '0.6rem' }}>
              ✓ Authentic Credential Verified
            </div>
            <div style={{ fontSize: '0.95rem', color: '#14532d', lineHeight: '1.55', fontWeight: 650 }}>
              <strong>{result.volunteerName}</strong> successfully volunteered <strong>{hoursText(result.minutes)}</strong> for the event{' '}
              <strong>"{result.eventTitle}"</strong>, officially certified by <strong>{result.orgName}</strong>.
            </div>
          </div>
        ) : (
          <Notice tone="error">
            ❌ No valid certificate matches that code. Please check the code for typos.
          </Notice>
        )
      )}

      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <Link to="/events" className="btn btn-quiet" style={{ fontSize: '0.85rem' }}>
          ← Back to Events
        </Link>
      </div>
    </div>
  );
}
