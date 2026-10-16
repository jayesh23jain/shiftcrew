import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../../api/client.js';
import { formatDateTime, hoursText } from '../../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../../components/ui.jsx';

// Quick Announcement Broadcast Templates
const ANNOUNCE_TEMPLATES = [
  {
    icon: '📍',
    label: 'Reporting Desk Call',
    title: 'Reporting Desk & Badge Collection',
    message: 'Crew members: Please report to the Organizer Registration Desk 20 minutes prior to your shift to pick up your badge, event lanyard, and briefing.',
  },
  {
    icon: '🍕',
    label: 'Meal & Break Call',
    title: 'Crew Meal & Refreshments Available',
    message: 'Volunteer refreshments and lunch packets are now ready at the Hospitality Booth. Please stagger breaks with your co-crew to keep stations covered.',
  },
  {
    icon: '👕',
    label: 'T-Shirt & Swag Pickup',
    title: 'Official Crew T-Shirts & Merch',
    message: 'Your volunteer shirts and event swag kits are available for pickup at the Crew Lounge. Show your digital shift pass to collect.',
  },
  {
    icon: '⚡',
    label: 'Urgent Stage Briefing',
    title: 'Briefing Call at Main Stage',
    message: 'All Stage, Audio, and Safety marshals: please gather behind the main stage for a quick 5-minute schedule sync.',
  },
  {
    icon: '🎉',
    label: 'Wrap-Up & Certificates',
    title: 'Thank You Crew! Check-out & Hours',
    message: 'Huge thanks for making this event incredible! Make sure you scan out at the gate so your hours are verified for payout and certificates.',
  },
];

export default function CommsTab({ event, roles = [] }) {
  const [activeSection, setActiveSection] = useState('all'); // 'all' | 'announce' | 'disputes' | 'certificates' | 'audit'

  // Query counts for badges
  const { data: disputes = [] } = useQuery({
    queryKey: ['disputes', event._id],
    queryFn: async () => (await api.get(`/events/${event._id}/disputes`)).data.disputes,
  });

  const openDisputesCount = disputes.filter((d) => d.status === 'open').length;

  return (
    <div className="comms-manage-wrapper">
      {/* Header Hub */}
      <div className="comms-header-split">
        <div>
          <h2 className="comms-title">
            📢 Updates, Disputes & Event Records
          </h2>
          <p className="comms-subtitle">
            Broadcast instant notifications to volunteers, resolve timesheet disputes, issue verifiable certificates, and review immutable audit trails.
          </p>
        </div>

        {/* Section Navigation Tabs */}
        <div className="comms-nav-pills">
          {[
            { id: 'all', label: 'Overview' },
            { id: 'announce', label: '📢 Announcements' },
            {
              id: 'disputes',
              label: `⚖️ Disputes ${openDisputesCount > 0 ? `(${openDisputesCount} ⚠️)` : ''}`,
            },
            { id: 'certificates', label: '🎓 Certificates' },
            { id: 'audit', label: '📜 Audit Records' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`comms-nav-btn ${activeSection === tab.id ? 'active' : ''}`}
              onClick={() => setActiveSection(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Render Subsections */}
      {(activeSection === 'all' || activeSection === 'announce') && (
        <AnnounceSection event={event} roles={roles} />
      )}

      {(activeSection === 'all' || activeSection === 'disputes') && (
        <DisputesSection event={event} disputes={disputes} />
      )}

      {(activeSection === 'all' || activeSection === 'certificates') && (
        <CertificatesSection event={event} />
      )}

      {(activeSection === 'all' || activeSection === 'audit') && (
        <AuditSection event={event} />
      )}
    </div>
  );
}

/* ==========================================================================
   1. ANNOUNCEMENTS BROADCAST SECTION
   ========================================================================== */
function AnnounceSection({ event, roles }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', message: '', audience: 'all', roleId: '' });
  const [copiedId, setCopiedId] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements', event._id],
    queryFn: async () => (await api.get(`/events/${event._id}/announcements`)).data.announcements,
  });

  const send = useMutation({
    mutationFn: async () =>
      (await api.post(`/events/${event._id}/announcements`, {
        title: form.title || undefined,
        message: form.message,
        audience: form.audience,
        roleId: form.audience === 'role' ? form.roleId : undefined,
      })).data,
    onSuccess: () => {
      setForm({ title: '', message: '', audience: 'all', roleId: '' });
      qc.invalidateQueries({ queryKey: ['announcements', event._id] });
    },
  });

  const applyTemplate = (t) => {
    setForm({
      ...form,
      title: t.title,
      message: t.message,
    });
  };

  const copyAnnouncement = (a) => {
    const text = `${a.title ? `[${a.title}] ` : ''}${a.message}`;
    navigator.clipboard.writeText(text);
    setCopiedId(a._id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="comms-section-card">
      <div className="comms-section-header">
        <div>
          <h3 className="comms-section-title">📢 Broadcast Announcements</h3>
          <p className="comms-section-desc">
            Instantly dispatch push alerts and notifications to confirmed volunteers or specific roles.
          </p>
        </div>
        <span className="comms-badge-pill">
          {announcements.length} Sent
        </span>
      </div>

      {/* 1-Click Broadcast Templates */}
      <div style={{ marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '0.45rem' }}>
          ⚡ QUICK BROADCAST TEMPLATES:
        </span>
        <div className="comms-templates-bar">
          {ANNOUNCE_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              className="comms-template-btn"
              onClick={() => applyTemplate(t)}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      <Notice>{send.error && errorMessage(send.error)}</Notice>
      {send.data && (
        <Notice tone="success">
          ✓ Broadcast dispatched successfully to <strong>{send.data.recipients} volunteer(s)</strong>!
        </Notice>
      )}

      {/* Broadcast Composer */}
      <form
        className="comms-composer-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.message.trim()) return;
          send.mutate();
        }}
      >
        <div className="two">
          <Field label="1. Target Audience">
            <select value={form.audience} onChange={set('audience')}>
              <option value="all">🌐 All Confirmed Volunteers</option>
              <option value="role">🎯 Specific Crew Role</option>
            </select>
          </Field>

          {form.audience === 'role' && (
            <Field label="2. Select Role">
              <select value={form.roleId} onChange={set('roleId')} required>
                <option value="">Choose role...</option>
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field label="Broadcast Headline (Optional)">
          <input
            value={form.title}
            onChange={set('title')}
            placeholder="e.g. Reporting Desk Opening in 15 Minutes!"
          />
        </Field>

        <Field label="Notification Message">
          <textarea
            rows={3}
            value={form.message}
            onChange={set('message')}
            placeholder="Write clear instructions for your volunteers..."
            required
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '0.65rem 1.75rem', fontWeight: 900 }}
            disabled={send.isPending || !form.message.trim()}
          >
            {send.isPending ? 'Broadcasting...' : '🚀 Send Announcement'}
          </button>
        </div>
      </form>

      {/* Previous Broadcasts Stream */}
      {announcements.length > 0 && (
        <div style={{ marginTop: '1.75rem' }}>
          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 950, margin: '0 0 0.85rem', color: '#0f172a' }}>
            Recent Broadcast Stream
          </h4>
          <div className="comms-stream-list">
            {announcements.map((a) => (
              <div key={a._id} className="comms-broadcast-card">
                <div className="comms-broadcast-main">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                      <strong className="comms-broadcast-title">{a.title || 'Event Update'}</strong>
                      <span className="comms-recipient-pill">
                        👥 {a.recipients} Recipient{a.recipients === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className="comms-broadcast-body">{a.message}</p>
                    <span className="comms-broadcast-meta">
                      📅 {formatDateTime(a.createdAt)}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-quiet"
                    style={{ fontSize: '0.78rem', padding: '3px 9px', alignSelf: 'flex-start' }}
                    onClick={() => copyAnnouncement(a)}
                  >
                    {copiedId === a._id ? '✓ Copied!' : '📋 Copy Text'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   2. VOLUNTEER DISPUTES SECTION
   ========================================================================== */
function DisputesSection({ event, disputes }) {
  const qc = useQueryClient();
  const [resolvingId, setResolvingId] = useState(null);
  const [resolveForm, setResolveForm] = useState({ action: 'adjust', minutes: '', note: '' });

  const resolve = useMutation({
    mutationFn: async ({ id, payload }) =>
      (await api.post(`/disputes/${id}/resolve`, payload)).data,
    onSuccess: () => {
      setResolvingId(null);
      setResolveForm({ action: 'adjust', minutes: '', note: '' });
      qc.invalidateQueries({ queryKey: ['disputes', event._id] });
      qc.invalidateQueries({ queryKey: ['attendance', event._id] });
      qc.invalidateQueries({ queryKey: ['payables', event._id] });
    },
  });

  const openResolveModal = (d, defaultAction = 'adjust') => {
    setResolvingId(d._id);
    setResolveForm({
      action: defaultAction,
      minutes: d.attendance?.approvedMinutes || d.attendance?.minutesWorked || 60,
      note: defaultAction === 'adjust' ? 'Verified overtime on gate check' : 'Hours confirmed as recorded by team lead',
    });
  };

  const handleResolveSubmit = (e) => {
    e.preventDefault();
    if (!resolvingId) return;
    resolve.mutate({
      id: resolvingId,
      payload: {
        action: resolveForm.action,
        minutes: resolveForm.action === 'adjust' ? Number(resolveForm.minutes) : undefined,
        note: resolveForm.note,
      },
    });
  };

  const openDisputes = disputes.filter((d) => d.status === 'open');
  const closedDisputes = disputes.filter((d) => d.status !== 'open');

  return (
    <div className="comms-section-card">
      <div className="comms-section-header">
        <div>
          <h3 className="comms-section-title">⚖️ Volunteer Hours Disputes</h3>
          <p className="comms-section-desc">
            Volunteers can file an appeal within 7 days if their shift timesheet or overtime was misrecorded.
          </p>
        </div>
        <span className={`comms-badge-pill ${openDisputes.length > 0 ? 'badge-warn' : ''}`}>
          {openDisputes.length} Open Appeal{openDisputes.length === 1 ? '' : 's'}
        </span>
      </div>

      <Notice>{resolve.error && errorMessage(resolve.error)}</Notice>

      {/* Inline Dispute Resolution Drawer */}
      {resolvingId && (
        <div className="dispute-resolve-drawer">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#1e3a8a' }}>
              ⚙️ Resolve Volunteer Dispute
            </strong>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ padding: '2px 8px', fontSize: '0.78rem' }}
              onClick={() => setResolvingId(null)}
            >
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={handleResolveSubmit}>
            <div className="two">
              <Field label="Resolution Action">
                <select
                  value={resolveForm.action}
                  onChange={(e) => setResolveForm({ ...resolveForm, action: e.target.value })}
                >
                  <option value="adjust">✓ Accept & Correct Hours</option>
                  <option value="reject">✕ Decline Appeal</option>
                </select>
              </Field>

              {resolveForm.action === 'adjust' && (
                <Field label="Corrected Minutes Worked">
                  <input
                    type="number"
                    min="0"
                    max="960"
                    value={resolveForm.minutes}
                    onChange={(e) => setResolveForm({ ...resolveForm, minutes: e.target.value })}
                    required
                  />
                </Field>
              )}
            </div>

            <Field label="Resolution Note to Volunteer">
              <input
                value={resolveForm.note}
                onChange={(e) => setResolveForm({ ...resolveForm, note: e.target.value })}
                placeholder="Explain the correction or reason for decision..."
                required
              />
            </Field>

            <div style={{ display: 'flex', gap: '0.55rem', marginTop: '0.85rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  background: resolveForm.action === 'adjust' ? '#16a34a' : '#dc2626',
                  borderColor: '#0f172a',
                  fontWeight: 900,
                }}
                disabled={resolve.isPending}
              >
                {resolve.isPending
                  ? 'Saving...'
                  : resolveForm.action === 'adjust'
                  ? '✓ Apply Hour Correction'
                  : '✕ Confirm Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Disputes Grid */}
      {disputes.length > 0 ? (
        <div className="disputes-bento-grid">
          {disputes.map((d) => {
            const volunteerName = d.volunteer || 'Volunteer';
            const initial = volunteerName.charAt(0).toUpperCase();
            const isOpen = d.status === 'open';

            return (
              <div key={d._id} className={`dispute-card ${isOpen ? 'dispute-open' : ''}`}>
                <div className="dispute-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className="dispute-avatar">{initial}</div>
                    <div>
                      <strong className="dispute-name">{volunteerName}</strong>
                      <span className="dispute-date">{formatDateTime(d.createdAt)}</span>
                    </div>
                  </div>

                  <Pill tone={isOpen ? 'warn' : d.status === 'resolved' ? 'good' : 'neutral'}>
                    {d.status.toUpperCase()}
                  </Pill>
                </div>

                <div className="dispute-reason-box">
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                    VOLUNTEER CLAIM:
                  </span>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: '#1e293b', fontWeight: 650 }}>
                    "{d.reason}"
                  </p>
                </div>

                {/* Logged Timesheet Reference */}
                {d.attendance && (
                  <div className="dispute-att-ref">
                    <span>
                      Recorded: <strong>{hoursText(d.attendance.minutesWorked || 0)}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Status: <strong>{d.attendance.status}</strong>
                    </span>
                  </div>
                )}

                {/* Resolution Summary */}
                {d.resolution && (
                  <div className="dispute-resolution-box">
                    <strong>Decision:</strong> {d.resolution}
                  </div>
                )}

                {/* Action Buttons */}
                {isOpen && (
                  <div className="dispute-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.8rem', padding: '4px 12px', fontWeight: 900 }}
                      onClick={() => openResolveModal(d, 'adjust')}
                    >
                      ✓ Correct Hours
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      style={{ fontSize: '0.8rem', padding: '4px 10px', color: '#dc2626' }}
                      onClick={() => openResolveModal(d, 'reject')}
                    >
                      ✕ Decline
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No Active Disputes">
          No timesheet disputes have been raised for this event. Volunteers can raise claims within 7 days of their shifts.
        </Empty>
      )}
    </div>
  );
}

/* ==========================================================================
   3. VERIFIABLE CERTIFICATES SECTION & PUBLIC VERIFIER
   ========================================================================== */
function CertificatesSection({ event }) {
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const issue = useMutation({
    mutationFn: async () => (await api.post(`/events/${event._id}/certificates`)).data,
  });

  const ready = ['completed', 'settled'].includes(event.status);

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!verifyCode.trim()) return;
    setVerifying(true);
    try {
      const res = await api.get(`/certificates/verify/${verifyCode.trim()}`);
      setVerifyResult(res.data);
    } catch (err) {
      setVerifyResult({ valid: false, error: errorMessage(err) });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="comms-section-card">
      <div className="comms-section-header">
        <div>
          <h3 className="comms-section-title">🎓 Digital Verifiable Certificates</h3>
          <p className="comms-section-desc">
            Automatically generate and issue cryptographically verifiable certificates with unique verification codes.
          </p>
        </div>
        <span className={`comms-badge-pill ${ready ? 'badge-good' : ''}`}>
          {ready ? '✓ Event Completed' : '⏳ In Progress'}
        </span>
      </div>

      <Notice>{issue.error && errorMessage(issue.error)}</Notice>
      {issue.data && (
        <Notice tone="success">
          🎉 <strong>{issue.data.issued} new certificate(s) issued!</strong> Total eligible volunteers: {issue.data.eligible}.
        </Notice>
      )}

      {/* Issuance Action Card */}
      <div className="cert-issuance-box">
        <div style={{ flex: 1, minWidth: '240px' }}>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: '#0f172a', display: 'block' }}>
            Batch Issue Volunteering Certificates
          </strong>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.86rem', color: '#64748b', fontWeight: 600 }}>
            {ready
              ? 'Event status is marked as Completed. You can now issue certificates to all volunteers with approved hours.'
              : 'Certificates unlock once the event is marked as Completed (under Overview).'}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '0.75rem 1.65rem', fontWeight: 900, whiteSpace: 'nowrap' }}
          onClick={() => {
            if (window.confirm('Issue official digital certificates to all crew members with verified hours?')) {
              issue.mutate();
            }
          }}
          disabled={!ready || issue.isPending}
        >
          {issue.isPending ? 'Generating Certificates...' : '🎓 Issue Official Certificates'}
        </button>
      </div>

      {/* Built-in Certificate Code Verifier */}
      <div className="cert-verifier-box">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
          <span style={{ fontSize: '1.25rem' }}>🔍</span>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: '#0f172a' }}>
            Live Certificate Verification Tool
          </strong>
        </div>
        <p style={{ margin: '0 0 0.85rem', fontSize: '0.84rem', color: '#64748b', fontWeight: 600 }}>
          Verify any volunteer's certificate code (e.g. <code>SC-A1B2-C3D4</code>) using ShiftCrew's public credential verification ledger.
        </p>

        <form onSubmit={handleVerify} style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="cert-verify-input"
            placeholder="Enter certificate code (e.g. SC-1A2B-3C4D)"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.toUpperCase())}
            required
          />
          <button
            type="submit"
            className="btn btn-white"
            style={{ fontWeight: 850 }}
            disabled={verifying}
          >
            {verifying ? 'Verifying...' : 'Verify Credential'}
          </button>
        </form>

        {verifyResult && (
          <div className={`cert-verify-result ${verifyResult.valid ? 'valid' : 'invalid'}`}>
            {verifyResult.valid ? (
              <div>
                <strong style={{ color: '#166534', fontSize: '0.95rem' }}>
                  ✓ Valid Verified Credential
                </strong>
                <div style={{ fontSize: '0.84rem', color: '#1e293b', marginTop: '0.35rem' }}>
                  Issued to: <strong>{verifyResult.volunteerName}</strong> • Event: <strong>{verifyResult.eventTitle}</strong> • Verified Hours: <strong>{hoursText(verifyResult.minutes)}</strong>
                </div>
              </div>
            ) : (
              <div>
                <strong style={{ color: '#991b1b', fontSize: '0.95rem' }}>
                  ✕ Invalid or Unrecognized Certificate Code
                </strong>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#7f1d1d' }}>
                  No certificate matching code "{verifyCode}" exists on the verification ledger.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   4. AUDIT TRAIL & COMPLIANCE RECORDS SECTION
   ========================================================================== */
function AuditSection({ event }) {
  const [filterAction, setFilterAction] = useState('all');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit', event._id],
    queryFn: async () => (await api.get(`/events/${event._id}/audit`)).data.logs,
  });

  const filteredLogs = logs.filter((l) => {
    if (filterAction === 'attendance') return l.action.includes('attendance');
    if (filterAction === 'payout') return l.action.includes('payout');
    if (filterAction === 'dispute') return l.action.includes('dispute');
    if (filterAction === 'certificates') return l.action.includes('certificate');
    return true;
  });

  const exportAuditCsv = () => {
    if (!logs.length) return;
    const headers = ['Action', 'Actor', 'Timestamp', 'Reason / Meta'];
    const rows = logs.map((l) => [
      `"${l.action}"`,
      `"${l.actor || 'System'}"`,
      `"${new Date(l.createdAt).toLocaleString('en-IN')}"`,
      `"${l.meta?.reason || JSON.stringify(l.meta || '')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Audit_Log_${event.title.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="comms-section-card">
      <div className="comms-section-header">
        <div>
          <h3 className="comms-section-title">📜 Immutable Compliance Audit Trail</h3>
          <p className="comms-section-desc">
            Cryptographically logged record of all organizer actions, manual attendance overrides, payout approvals, and adjustments.
          </p>
        </div>

        {logs.length > 0 && (
          <button
            type="button"
            className="manage-action-btn manage-btn-white"
            onClick={exportAuditCsv}
          >
            📥 Export Audit CSV
          </button>
        )}
      </div>

      {/* Filter toolbar */}
      <div className="funds-filter-toolbar">
        <div className="funds-filter-pills">
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginRight: '0.35rem' }}>
            LOG TYPE:
          </span>
          {[
            { id: 'all', label: `All Events (${logs.length})` },
            { id: 'attendance', label: 'Attendance' },
            { id: 'payout', label: 'Payouts' },
            { id: 'dispute', label: 'Disputes' },
            { id: 'certificates', label: 'Certificates' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`funds-filter-btn ${filterAction === tab.id ? 'active' : ''}`}
              onClick={() => setFilterAction(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span style={{ fontSize: '0.8rem', fontWeight: 750, color: '#64748b' }}>
          Showing {filteredLogs.length} of {logs.length}
        </span>
      </div>

      {/* Audit Log Stream */}
      {filteredLogs.length > 0 ? (
        <div className="audit-logs-list">
          {filteredLogs.slice(0, 40).map((l) => (
            <div key={l._id} className="audit-log-item">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className="audit-log-dot"></span>
                <div>
                  <strong className="audit-action-name">{l.action}</strong>
                  <div className="audit-log-meta">
                    by <strong>{l.actor || 'System Automator'}</strong> • {formatDateTime(l.createdAt)}
                    {l.meta?.reason && <span> • Reason: <em>"{l.meta.reason}"</em></span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ padding: '1rem', textAlign: 'center' }}>
          No audit records found matching this filter.
        </p>
      )}
    </div>
  );
}
