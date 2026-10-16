import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../../api/client.js';
import { ATT_LABEL, formatShift, formatTime, hoursText } from '../../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../../components/ui.jsx';

export default function HoursTab({ event }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [adjust, setAdjust] = useState(null); // { id, minutes, reason }
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);

  // Manual Entry Form State (Feature 6)
  const [manualShiftId, setManualShiftId] = useState('');
  const [manualSignupId, setManualSignupId] = useState('');
  const [manualAction, setManualAction] = useState('check_in');
  const [manualReason, setManualReason] = useState('Phone battery died / Gate manual override');

  const { data = [], isLoading } = useQuery({
    queryKey: ['attendance', event._id],
    queryFn: async () => (await api.get(`/attendance/events/${event._id}`)).data.records,
  });

  const { data: eventShifts = [] } = useQuery({
    queryKey: ['shifts', event._id],
    queryFn: async () => (await api.get(`/events/${event._id}/shifts`)).data.shifts,
  });

  const { data: shiftSignups = [] } = useQuery({
    queryKey: ['roster', manualShiftId],
    queryFn: async () => (await api.get(`/shifts/${manualShiftId}/signups`)).data.signups,
    enabled: !!manualShiftId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['attendance', event._id] });
    qc.invalidateQueries({ queryKey: ['payables', event._id] });
    qc.invalidateQueries({ queryKey: ['roster'] });
  };

  const approve = useMutation({
    mutationFn: async ({ id, minutes, reason }) =>
      (await api.post(`/attendance/${id}/approve`, minutes === undefined ? {} : { minutes, reason })).data,
    onSuccess: () => {
      setAdjust(null);
      refresh();
    },
  });

  const bulk = useMutation({
    mutationFn: async (ids) => (await api.post('/attendance/approve-bulk', { ids })).data,
    onSuccess: refresh,
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }) =>
      (await api.post(`/attendance/${id}/reject`, { reason })).data,
    onSuccess: refresh,
  });

  const manualOverride = useMutation({
    mutationFn: async (body) => (await api.post('/attendance/manual', body)).data,
    onSuccess: () => {
      setShowManualEntry(false);
      setManualSignupId('');
      refresh();
    },
  });

  if (isLoading) return <Spinner />;

  // Filter groups
  const waiting = data.filter((r) => r.status === 'completed');
  const onDuty = data.filter((r) => r.status === 'checked_in');
  const approved = data.filter((r) => r.status === 'approved');
  const exceptions = data.filter(
    (r) => r.late || r.autoClosed || r.earlyCheckout || r.status === 'no_show' || r.status === 'rejected'
  );

  // Feature 2: Filter by status
  const filteredRecords = data.filter((r) => {
    if (filter === 'needs_review') return r.status === 'completed';
    if (filter === 'on_duty') return r.status === 'checked_in';
    if (filter === 'approved') return r.status === 'approved';
    if (filter === 'exceptions') {
      return r.late || r.autoClosed || r.status === 'no_show' || r.status === 'rejected';
    }
    return true;
  });

  // Feature 5: 1-Click Export to CSV
  const handleExportCsv = () => {
    if (!data.length) return;
    const headers = [
      'Volunteer Name',
      'Role',
      'Shift Start',
      'Shift End',
      'Check In',
      'Check Out',
      'Status',
      'Minutes Worked',
      'Approved Hours',
      'Adjustment Reason',
      'Late',
      'Auto Closed',
      'Manual Entry',
    ];

    const rows = data.map((r) => [
      `"${r.volunteer || 'Volunteer'}"`,
      `"${r.role || 'Crew'}"`,
      `"${r.shift?.start ? new Date(r.shift.start).toLocaleString('en-IN') : ''}"`,
      `"${r.shift?.end ? new Date(r.shift.end).toLocaleString('en-IN') : ''}"`,
      `"${r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString('en-IN') : ''}"`,
      `"${r.checkOutAt ? new Date(r.checkOutAt).toLocaleTimeString('en-IN') : ''}"`,
      `"${ATT_LABEL[r.status] || r.status}"`,
      r.minutesWorked || 0,
      r.approvedMinutes ? (r.approvedMinutes / 60).toFixed(2) : 0,
      `"${r.adjustReason || ''}"`,
      r.late ? 'Yes' : 'No',
      r.autoClosed ? 'Yes' : 'No',
      r.manual ? 'Yes' : 'No',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `Timesheet_${event.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2500);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualSignupId) return;
    manualOverride.mutate({
      signupId: manualSignupId,
      action: manualAction,
      reason: manualReason,
    });
  };

  const confirmedVolunteersForShift = shiftSignups.filter((s) => s.status === 'confirmed');

  return (
    <div className="hours-manage-wrapper">
      {/* Header with Title & Action Controls */}
      <div className="hours-header-split">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 950, color: '#0f172a', margin: 0 }}>
            Volunteer Attendance & Timesheet Review
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.88rem', color: '#64748b', fontWeight: 650 }}>
            {waiting.length} timesheet{waiting.length === 1 ? '' : 's'} waiting for approval. Approved hours credit certificates and unlock payouts in Funds.
          </p>
        </div>

        <div className="hours-header-actions">
          {/* Feature 5: 1-Click Export to CSV */}
          {data.length > 0 && (
            <button
              type="button"
              className="manage-action-btn manage-btn-white"
              onClick={handleExportCsv}
              title="Download formatted CSV report for college or auditing"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>{copiedCsv ? '✓ Downloaded CSV' : '📥 Export to CSV'}</span>
            </button>
          )}

          {/* Feature 6: Manual Check-In Button */}
          <button
            type="button"
            className="manage-action-btn manage-btn-white"
            onClick={() => setShowManualEntry(!showManualEntry)}
            title="Log manual check-in for volunteers without phone/QR"
          >
            ✍️ {showManualEntry ? 'Close Manual Entry' : 'Manual Check-in Entry'}
          </button>

          {/* Bulk Approve Action */}
          {waiting.length > 1 && (
            <button
              type="button"
              className="manage-action-btn manage-btn-primary"
              onClick={() => {
                if (window.confirm(`Approve all ${waiting.length} waiting timesheets as recorded?`)) {
                  bulk.mutate(waiting.map((r) => r._id));
                }
              }}
              disabled={bulk.isPending}
            >
              ⚡ Approve All ({waiting.length}) as Recorded
            </button>
          )}
        </div>
      </div>

      <Notice>{[approve, reject, bulk, manualOverride].map((m) => m.error && errorMessage(m.error)).filter(Boolean)[0]}</Notice>
      {bulk.data?.skipped?.length > 0 && (
        <Notice tone="info">
          {bulk.data.approved} approved, {bulk.data.skipped.length} skipped.
        </Notice>
      )}

      {/* Feature 6: Manual Check-in / Log Hours Drawer Card */}
      {showManualEntry && (
        <div className="manual-checkin-drawer">
          <div className="manual-checkin-header">
            <div>
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: '#1e3a8a' }}>
                ✍️ Manual Attendance & Check-in Override
              </strong>
              <span style={{ display: 'block', fontSize: '0.8rem', color: '#3b82f6', fontWeight: 600 }}>
                Use this when a volunteer’s phone died at the gate, has no internet, or needs manual sign-in.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
              onClick={() => setShowManualEntry(false)}
            >
              ✕ Close
            </button>
          </div>

          <form onSubmit={handleManualSubmit}>
            <div className="two">
              <Field label="1. Select Volunteer Shift">
                <select
                  value={manualShiftId}
                  onChange={(e) => {
                    setManualShiftId(e.target.value);
                    setManualSignupId('');
                  }}
                  required
                >
                  <option value="">Choose shift...</option>
                  {eventShifts.map((sh) => (
                    <option key={sh._id} value={sh._id}>
                      {formatShift(sh.start, sh.end)} ({sh.confirmed} confirmed)
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="2. Select Confirmed Volunteer">
                <select
                  value={manualSignupId}
                  onChange={(e) => setManualSignupId(e.target.value)}
                  disabled={!manualShiftId}
                  required
                >
                  <option value="">Choose volunteer...</option>
                  {confirmedVolunteersForShift.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.user?.name} ({s.user?.email})
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="two">
              <Field label="3. Attendance Action">
                <select value={manualAction} onChange={(e) => setManualAction(e.target.value)}>
                  <option value="check_in">🟢 Check In (Volunteer on duty)</option>
                  <option value="check_out">🔴 Check Out (Shift completed)</option>
                  <option value="no_show">❌ Mark No-Show (Did not report)</option>
                </select>
              </Field>

              <Field label="4. Override Reason (Audited)">
                <input
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  placeholder="e.g. Phone battery dead at gate, confirmed identity"
                  required
                />
              </Field>
            </div>

            <div style={{ marginTop: '0.85rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={manualOverride.isPending || !manualSignupId}
                style={{ padding: '0.55rem 1.35rem', fontWeight: 900 }}
              >
                {manualOverride.isPending ? 'Recording...' : '✓ Record Manual Attendance'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feature 2: Filter Toolbar */}
      <div className="hours-filter-toolbar">
        <div className="hours-filter-pills">
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginRight: '0.35rem' }}>FILTER:</span>
          {[
            { id: 'all', label: `All Records (${data.length})` },
            { id: 'needs_review', label: `Needs Review (${waiting.length})` },
            { id: 'on_duty', label: `On Duty Now 🟢 (${onDuty.length})` },
            { id: 'approved', label: `Approved (${approved.length})` },
            { id: 'exceptions', label: `Exceptions ⚠️ (${exceptions.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`hours-filter-btn ${filter === tab.id ? 'active' : ''}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span style={{ fontSize: '0.82rem', fontWeight: 750, color: '#64748b' }}>
          Showing {filteredRecords.length} of {data.length} records
        </span>
      </div>

      {/* Feature 3: Interactive Timesheet Bento Cards */}
      {filteredRecords.length > 0 ? (
        <div className="timesheet-bento-grid">
          {filteredRecords.map((r) => {
            const volunteerName = r.volunteer || 'Volunteer';
            const initial = volunteerName.charAt(0).toUpperCase();
            const isEditingAdjust = adjust?.id === r._id;
            const workedMinutes = r.minutesWorked || 0;

            const toneMap = {
              approved: 'good',
              completed: 'warn',
              checked_in: 'neutral',
              no_show: 'bad',
              rejected: 'bad',
            };

            return (
              <div key={r._id} className="timesheet-bento-card">
                {/* Top Row: Volunteer Info & Status Pill */}
                <div className="timesheet-top-row">
                  <div className="timesheet-user-block">
                    <div className="timesheet-avatar">{initial}</div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 className="timesheet-name-title">{volunteerName}</h3>
                        <span className="timesheet-role-badge">
                          {r.role || 'Volunteer'}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                        {r.shift ? formatShift(r.shift.start, r.shift.end) : 'Scheduled shift'}
                      </span>
                    </div>
                  </div>

                  <div className="timesheet-status-pills">
                    <Pill tone={toneMap[r.status] || 'neutral'}>
                      {ATT_LABEL[r.status] || r.status}
                    </Pill>
                  </div>
                </div>

                {/* Scan Timeline Bar */}
                <div className="timesheet-timeline-bar">
                  <div className="timesheet-scan-points">
                    <span className="timesheet-point">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                      {r.checkInAt ? `In: ${formatTime(r.checkInAt)}` : 'Not checked in'}
                    </span>

                    <span style={{ color: '#cbd5e1' }}>➔</span>

                    <span className="timesheet-point">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                      {r.checkOutAt ? `Out: ${formatTime(r.checkOutAt)}` : r.status === 'checked_in' ? 'On Duty Now 🟢' : 'No Checkout'}
                    </span>
                  </div>

                  <div>
                    {r.status === 'approved' ? (
                      <span className="timesheet-duration-badge" style={{ background: '#dcfce7', color: '#166534' }}>
                        ✓ {hoursText(r.approvedMinutes)} Approved
                      </span>
                    ) : r.minutesWorked > 0 ? (
                      <span className="timesheet-duration-badge">
                        ⏱️ {hoursText(r.minutesWorked)} Worked
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Exception Badges (Late, Auto-closed, Manual) */}
                <div className="timesheet-flags-row">
                  {r.late && (
                    <span className="chip-flag chip-flag-late">
                      ⚠️ Late Arrival
                    </span>
                  )}
                  {r.earlyCheckout && (
                    <span className="chip-flag" style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
                      🏃 Left Early (-5 Rel)
                    </span>
                  )}
                  {r.autoClosed && (
                    <span className="chip-flag chip-flag-autoclosed">
                      🤖 Auto-Closed (Never Scanned Out)
                    </span>
                  )}
                  {r.manual && (
                    <span className="chip-flag chip-flag-manual">
                      ✍️ Manual Gate Entry
                    </span>
                  )}
                  {r.adjustReason && (
                    <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 650 }}>
                      📝 Adjustment Reason: <em>"{r.adjustReason}"</em>
                    </span>
                  )}
                </div>

                {/* Inline Hour Adjustment Drawer */}
                {isEditingAdjust && (
                  <div className="timesheet-adjust-box">
                    <strong style={{ display: 'block', fontSize: '0.9rem', color: '#0f172a', marginBottom: '0.5rem' }}>
                      ⚙️ Adjust Timesheet Minutes & Add Note
                    </strong>

                    {/* Quick Adjustment Presets */}
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        style={{ fontSize: '0.76rem', background: '#ffffff', padding: '3px 8px' }}
                        onClick={() => setAdjust({ ...adjust, minutes: workedMinutes + 30, reason: '+30m Overtime help' })}
                      >
                        +30m Overtime
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        style={{ fontSize: '0.76rem', background: '#ffffff', padding: '3px 8px' }}
                        onClick={() => setAdjust({ ...adjust, minutes: workedMinutes + 60, reason: '+1h Extended cleanup shift' })}
                      >
                        +1 hr Extended
                      </button>
                      {r.shift && (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          style={{ fontSize: '0.76rem', background: '#ffffff', padding: '3px 8px' }}
                          onClick={() => {
                            const schedMinutes = Math.round((new Date(r.shift.end) - new Date(r.shift.start)) / 60000);
                            setAdjust({ ...adjust, minutes: schedMinutes, reason: 'Reset to scheduled shift duration' });
                          }}
                        >
                          Reset to Scheduled Duration
                        </button>
                      )}
                    </div>

                    <form
                      className="row adjust"
                      onSubmit={(e) => {
                        e.preventDefault();
                        approve.mutate({
                          id: r._id,
                          minutes: Number(adjust.minutes),
                          reason: adjust.reason,
                        });
                      }}
                    >
                      <label className="field" style={{ minWidth: '110px' }}>
                        <span className="field-label">Total Minutes</span>
                        <input
                          type="number"
                          min="0"
                          max="960"
                          value={adjust.minutes}
                          onChange={(e) => setAdjust({ ...adjust, minutes: e.target.value })}
                          required
                        />
                      </label>

                      <label className="field grow">
                        <span className="field-label">Reason for Change</span>
                        <input
                          value={adjust.reason}
                          onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
                          placeholder="Required when changing hours (e.g. Stayed extra for cleanup)"
                          required
                        />
                      </label>

                      <div style={{ display: 'flex', gap: '0.5rem', alignSelf: 'flex-end', marginBottom: '2px' }}>
                        <button type="submit" className="btn btn-primary" disabled={approve.isPending}>
                          {approve.isPending ? 'Saving...' : '✓ Save & Approve'}
                        </button>
                        <button type="button" className="btn btn-quiet" onClick={() => setAdjust(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Actions Toolbar */}
                <div className="timesheet-actions-row">
                  <div>
                    {r.status === 'completed' && (
                      <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#854d0e' }}>
                        ⏳ Ready for approval: <strong>{hoursText(workedMinutes)}</strong>
                      </span>
                    )}
                    {r.status === 'checked_in' && (
                      <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#16a34a' }}>
                        🟢 Active on duty since {r.checkInAt ? formatTime(r.checkInAt) : ''}
                      </span>
                    )}
                    {r.status === 'approved' && (
                      <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#166534' }}>
                        ✓ Timesheet approved & verified
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                    {r.status === 'completed' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '0.45rem 1.15rem', fontWeight: 900 }}
                          onClick={() => approve.mutate({ id: r._id })}
                          disabled={approve.isPending}
                        >
                          ✓ Approve ({hoursText(workedMinutes)})
                        </button>

                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() =>
                            setAdjust({
                              id: r._id,
                              minutes: workedMinutes,
                              reason: '',
                            })
                          }
                        >
                          ⚙️ Adjust Minutes
                        </button>
                      </>
                    )}

                    {r.status === 'checked_in' && r.signupId && (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        style={{ color: '#0284c7' }}
                        onClick={() => {
                          const reason = window.prompt(
                            'Force manual check-out for volunteer?\nOptional reason:',
                            'Organized early departure'
                          );
                          if (reason !== null) {
                            manualOverride.mutate({
                              signupId: r.signupId,
                              action: 'check_out',
                              reason: reason || 'Manual checkout override',
                            });
                          }
                        }}
                      >
                        🔴 Manual Check-Out
                      </button>
                    )}

                    {['completed', 'no_show'].includes(r.status) && (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        style={{ color: '#dc2626' }}
                        onClick={() => {
                          const reason = window.prompt('Why are these hours rejected?');
                          if (reason) reject.mutate({ id: r._id, reason });
                        }}
                      >
                        ✕ Reject
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No Attendance Records Found">
          {data.length === 0
            ? 'Once volunteers scan their QR passes at the check-in desk, their check-in and check-out timestamps will appear here for review.'
            : 'No timesheet records match your current filter.'}
        </Empty>
      )}
    </div>
  );
}
