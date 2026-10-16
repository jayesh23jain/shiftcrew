import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../../api/client.js';
import { SHIFT_STATE, SIGNUP_LABEL, formatShift, payLabel, toIso } from '../../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../../components/ui.jsx';

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

function getShiftDateStr(dateVal) {
  try {
    const d = new Date(dateVal);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

export default function ShiftsTab({ event, roles }) {
  const qc = useQueryClient();
  const [openRosterId, setOpenRosterId] = useState(null);
  const [adjustCapacityId, setAdjustCapacityId] = useState(null);
  const [newCapacityVal, setNewCapacityVal] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');

  const eventDateStr = getShiftDateStr(event.startDate || new Date());

  const blank = {
    roleId: roles[0]?._id || '',
    start: `${eventDateStr}T09:00`,
    end: `${eventDateStr}T13:00`,
    capacity: 5,
    payType: 'unpaid',
    rateRupees: '',
    notes: '',
  };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', event._id],
    queryFn: async () => (await api.get(`/events/${event._id}/shifts`)).data.shifts,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['shifts', event._id] });
    qc.invalidateQueries({ queryKey: ['roster'] });
    qc.invalidateQueries({ queryKey: ['organizer-summary'] });
  };

  const create = useMutation({
    mutationFn: async () =>
      (await api.post(`/events/${event._id}/shifts`, {
        roleId: form.roleId,
        start: toIso(form.start),
        end: toIso(form.end),
        capacity: Number(form.capacity),
        payType: form.payType,
        rateRupees: form.payType === 'unpaid' ? 0 : Number(form.rateRupees || 0),
        notes: form.notes,
      })).data,
    onSuccess: () => {
      setForm({ ...blank, roleId: form.roleId });
      refresh();
    },
  });

  const edit = useMutation({
    mutationFn: async ({ id, body }) => (await api.patch(`/shifts/${id}`, body)).data,
    onSuccess: () => {
      setAdjustCapacityId(null);
      refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: async ({ id, reason }) =>
      (await api.delete(`/shifts/${id}`, { data: { reason } })).data,
    onSuccess: refresh,
  });

  if (!roles.length) {
    return (
      <Empty title="Add a Crew Role First">
        Shifts must be assigned to a volunteer role (e.g. Registration Desk or Stage AV). Go to the <strong>Overview</strong> tab to define your first role!
      </Empty>
    );
  }

  if (isLoading) return <Spinner />;

  const roleName = Object.fromEntries(roles.map((r) => [r._id, r.name]));
  const live = (data || []).filter((s) => s.state !== 'cancelled');

  // Overall Shift Metrics
  const totalCapacity = live.reduce((acc, s) => acc + (s.capacity || 0), 0);
  const totalConfirmed = live.reduce((acc, s) => acc + (s.confirmed || 0), 0);
  const totalWaitlisted = live.reduce((acc, s) => acc + (s.waitlistCount || 0), 0);
  const overallFillPercent = totalCapacity > 0 ? Math.round((totalConfirmed / totalCapacity) * 100) : 0;

  // Filtered shifts
  const filteredShifts = live.filter((s) => {
    if (statusFilter !== 'all' && s.state !== statusFilter) return false;
    if (roleFilter !== 'all' && String(s.roleId) !== String(roleFilter)) return false;
    return true;
  });

  const applyTimePreset = (startHour, endHour) => {
    setForm({
      ...form,
      start: `${eventDateStr}T${startHour}`,
      end: `${eventDateStr}T${endHour}`,
    });
  };

  const handleSaveCapacity = (shiftId) => {
    const val = Number(newCapacityVal);
    if (val >= 1) {
      edit.mutate({ id: shiftId, body: { capacity: val } });
    }
  };

  return (
    <div className="shifts-manage-wrapper">
      {/* Shifts KPI Metrics Bar */}
      <div className="shifts-kpi-bar">
        <div className="shift-kpi-tile">
          <div className="shift-kpi-icon" style={{ background: '#fef08a' }}>🕒</div>
          <div className="shift-kpi-text">
            <span className="shift-kpi-val">{live.length}</span>
            <span className="shift-kpi-label">Active Shifts</span>
          </div>
        </div>

        <div className="shift-kpi-tile">
          <div className="shift-kpi-icon" style={{ background: '#bbf7d0' }}>👥</div>
          <div className="shift-kpi-text">
            <span className="shift-kpi-val">{totalConfirmed} / {totalCapacity}</span>
            <span className="shift-kpi-label">Crew Confirmed ({overallFillPercent}%)</span>
          </div>
        </div>

        <div className="shift-kpi-tile">
          <div className="shift-kpi-icon" style={{ background: '#ddd6fe' }}>📋</div>
          <div className="shift-kpi-text">
            <span className="shift-kpi-val">{totalWaitlisted}</span>
            <span className="shift-kpi-label">On Waitlist</span>
          </div>
        </div>

        <div className="shift-kpi-tile">
          <div className="shift-kpi-icon" style={{ background: '#fed7aa' }}>⚡</div>
          <div className="shift-kpi-text">
            <span className="shift-kpi-val">{Math.max(0, totalCapacity - totalConfirmed)}</span>
            <span className="shift-kpi-label">Remaining Spots</span>
          </div>
        </div>
      </div>

      <Notice>{[create, edit, cancel].map((m) => m.error && errorMessage(m.error)).filter(Boolean)[0]}</Notice>

      {/* Shifts Filter & Search Toolbar */}
      <div className="shifts-filter-toolbar">
        <div className="shifts-filter-pills">
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginRight: '0.35rem' }}>STATUS:</span>
          {['all', 'open', 'full', 'in_progress', 'completed'].map((st) => (
            <button
              key={st}
              type="button"
              className={`shift-filter-btn ${statusFilter === st ? 'active' : ''}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'all' ? 'All Shifts' : SHIFT_STATE[st] || st}
            </button>
          ))}
        </div>

        {roles.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b' }}>ROLE:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '10px',
                border: '1.5px solid #0f172a',
                fontSize: '0.82rem',
                fontWeight: 750,
                background: '#ffffff',
              }}
            >
              <option value="all">All Roles ({roles.length})</option>
              {roles.map((r) => (
                <option key={r._id} value={r._id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Shifts List / Cards */}
      {filteredShifts.length > 0 ? (
        <div>
          {filteredShifts.map((s) => {
            const rName = roleName[s.roleId] || 'Crew Shift';
            const icon = getRoleIcon(rName);
            const fillPercent = Math.min(100, Math.round(((s.confirmed || 0) / s.capacity) * 100));
            const isFull = s.state === 'full' || s.spotsLeft === 0;
            const isAlmostFull = s.spotsLeft <= 2 && s.spotsLeft > 0;
            const isRosterOpen = openRosterId === s._id;
            const isAdjustingCapacity = adjustCapacityId === s._id;

            return (
              <div key={s._id} className="shift-manage-card">
                <div className="shift-manage-top">
                  <div>
                    <span className="shift-manage-role-tag">
                      {icon} {rName}
                    </span>
                    <div className="shift-manage-time">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                      {formatShift(s.start, s.end)}
                    </div>
                  </div>

                  <div className="shift-manage-badges">
                    <span className="shift-pay-pill">
                      {payLabel(s)}
                    </span>
                    <Pill tone={s.state === 'open' ? 'good' : s.state === 'full' ? 'warn' : 'neutral'}>
                      {SHIFT_STATE[s.state]}
                    </Pill>
                  </div>
                </div>

                {/* Animated Fill Rate Meter */}
                <div className="shift-fill-wrapper" style={{ margin: '0.75rem 0' }}>
                  <div className="shift-fill-label-row">
                    <span>
                      👥 Volunteer Fill Rate: <strong>{s.confirmed} / {s.capacity} Confirmed</strong>
                      {s.waitlistCount ? ` • ${s.waitlistCount} waiting` : ''}
                    </span>
                    <span style={{ color: isFull ? '#64748b' : isAlmostFull ? '#b45309' : '#047857' }}>
                      {s.spotsLeft > 0 ? `${s.spotsLeft} spot${s.spotsLeft > 1 ? 's' : ''} left` : 'Fully Staffed'}
                    </span>
                  </div>
                  <div className="shift-fill-bar-track">
                    <div
                      className={`shift-fill-bar-progress ${isFull ? 'full' : isAlmostFull ? 'almost-full' : ''}`}
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                </div>

                {s.notes && (
                  <p style={{ margin: '0.4rem 0 0.65rem', fontSize: '0.84rem', color: '#475569', fontWeight: 650 }}>
                    📝 <em>Notes: {s.notes}</em>
                  </p>
                )}

                {/* Inline Capacity Adjuster */}
                {isAdjustingCapacity && (
                  <div style={{ background: '#fef9c3', border: '1.5px solid #0f172a', borderRadius: '12px', padding: '0.75rem 1rem', margin: '0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: 850, color: '#0f172a' }}>
                      Change Volunteer Capacity:
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={newCapacityVal}
                      onChange={(e) => setNewCapacityVal(e.target.value)}
                      style={{ width: '85px', padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1.5px solid #0f172a', fontWeight: 800 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
                      onClick={() => handleSaveCapacity(s._id)}
                      disabled={edit.isPending}
                    >
                      {edit.isPending ? 'Saving...' : 'Save Capacity'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                      onClick={() => setAdjustCapacityId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Shift Action Toolbar */}
                <div className="shift-manage-actions-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`shift-btn-tool shift-btn-roster ${isRosterOpen ? 'open' : ''}`}
                      onClick={() => setOpenRosterId(isRosterOpen ? null : s._id)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                      <span>{isRosterOpen ? 'Hide Roster ▲' : `Manage Roster (${s.confirmed}) ▼`}</span>
                    </button>

                    {['open', 'full'].includes(s.state) && (
                      <button
                        type="button"
                        className="shift-btn-tool shift-btn-adjust"
                        onClick={() => {
                          setAdjustCapacityId(isAdjustingCapacity ? null : s._id);
                          setNewCapacityVal(s.capacity);
                        }}
                      >
                        ⚙️ Adjust Capacity ({s.capacity})
                      </button>
                    )}
                  </div>

                  {['open', 'full'].includes(s.state) && (
                    <button
                      type="button"
                      className="shift-btn-tool shift-btn-cancel"
                      onClick={() => {
                        const r = window.prompt('Cancel this shift? Enrolled volunteers will be notified.\nOptional reason:');
                        if (r !== null) cancel.mutate({ id: s._id, reason: r });
                      }}
                      disabled={cancel.isPending}
                    >
                      🚫 Cancel Shift
                    </button>
                  )}
                </div>

                {/* Accordion Volunteer Roster Drawer */}
                {isRosterOpen && (
                  <Roster shiftId={s._id} shift={s} onChange={refresh} />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No Shifts Found">
          {live.length === 0
            ? 'No shifts have been created yet. Use the quick form below to add volunteer slots!'
            : 'No shifts match the selected filters.'}
        </Empty>
      )}

      {/* Add New Shift Section with 1-Click Timing Presets */}
      <div className="role-add-card">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          Create a New Volunteer Shift
        </h3>

        {/* 1-Click Shift Timing Presets */}
        <div className="shift-presets-box">
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.84rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase' }}>
            ⚡ 1-Click Timing Presets (For {eventDateStr}):
          </span>
          <div className="shift-presets-grid">
            <button
              type="button"
              className="shift-preset-btn"
              onClick={() => applyTimePreset('09:00', '13:00')}
            >
              🌅 Morning Shift (09:00 – 13:00)
            </button>
            <button
              type="button"
              className="shift-preset-btn"
              onClick={() => applyTimePreset('13:00', '17:00')}
            >
              ☀️ Afternoon Shift (13:00 – 17:00)
            </button>
            <button
              type="button"
              className="shift-preset-btn"
              onClick={() => applyTimePreset('17:00', '21:00')}
            >
              🌆 Evening Shift (17:00 – 21:00)
            </button>
            <button
              type="button"
              className="shift-preset-btn"
              onClick={() => applyTimePreset('09:00', '18:00')}
            >
              🌙 Full Day Shift (09:00 – 18:00)
            </button>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          noValidate
        >
          <div className="two">
            <Field label="Volunteer Role" hint="Select the job this shift is for">
              <select value={form.roleId} onChange={set('roleId')} required>
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {getRoleIcon(r.name)} {r.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Volunteers needed (Capacity)" hint="Max headcount for this slot">
              <input
                type="number"
                min="1"
                max="500"
                value={form.capacity}
                onChange={set('capacity')}
                required
              />
            </Field>
          </div>

          <div className="two">
            <Field label="Shift Starts (Date & Time)">
              <input
                type="datetime-local"
                value={form.start}
                onChange={set('start')}
                required
              />
            </Field>
            <Field label="Shift Ends (Date & Time)">
              <input
                type="datetime-local"
                value={form.end}
                onChange={set('end')}
                required
              />
            </Field>
          </div>

          <div className="two">
            <Field label="Stipend / Compensation">
              <select value={form.payType} onChange={set('payType')}>
                <option value="unpaid">Unpaid / Certificate & Experience</option>
                <option value="hourly">Hourly Stipend (₹ / hour)</option>
                <option value="flat">Flat Stipend (₹ / shift)</option>
              </select>
            </Field>

            {form.payType !== 'unpaid' && (
              <Field label="Amount in Rupees (₹)">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 500"
                  value={form.rateRupees}
                  onChange={set('rateRupees')}
                  required
                />
              </Field>
            )}
          </div>

          <Field
            label="Notes for crew volunteers"
            hint="Optional. Specify dress code, reporting desk, or materials to bring."
          >
            <input
              value={form.notes}
              onChange={set('notes')}
              placeholder="e.g. Report to Audi-2 entrance in black crew t-shirt"
            />
          </Field>

          <div style={{ marginTop: '1.25rem' }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: '0.65rem 1.65rem', fontSize: '0.95rem', fontWeight: 900, boxShadow: '3.5px 3.5px 0px #0f172a' }}
              disabled={create.isPending}
            >
              {create.isPending ? 'Creating Shift...' : '+ Publish New Shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Roster({ shiftId, shift, onChange }) {
  const qc = useQueryClient();
  const [copiedEmails, setCopiedEmails] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['roster', shiftId],
    queryFn: async () => (await api.get(`/shifts/${shiftId}/signups`)).data.signups,
  });

  const act = useMutation({
    mutationFn: async ({ id, action, reason }) =>
      (await api.post(`/signups/${id}/${action}`, reason ? { reason } : {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster', shiftId] });
      onChange();
    },
  });

  if (isLoading) return <Spinner />;

  const signups = data || [];
  const confirmedSignups = signups.filter((s) => s.status === 'confirmed');

  const copyCrewEmails = () => {
    const emails = signups.map((s) => s.user?.email).filter(Boolean).join(', ');
    if (emails) {
      navigator.clipboard.writeText(emails);
      setCopiedEmails(true);
      setTimeout(() => setCopiedEmails(false), 2200);
    }
  };

  return (
    <div className="roster-drawer-box">
      <div className="roster-drawer-header">
        <div>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: '#0f172a' }}>
            Enrolled Crew Roster ({signups.length} Total, {confirmedSignups.length} Confirmed)
          </strong>
          <span style={{ display: 'block', fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
            Approve applicants, verify volunteer reliability scores, or remove no-shows.
          </span>
        </div>

        {signups.length > 0 && (
          <button
            type="button"
            className="manage-action-btn manage-btn-white"
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem' }}
            onClick={copyCrewEmails}
            title="Copy email addresses of all volunteers for this shift"
          >
            {copiedEmails ? (
              '✓ Emails Copied!'
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy Crew Emails</span>
              </>
            )}
          </button>
        )}
      </div>

      <Notice>{act.error && errorMessage(act.error)}</Notice>

      {signups.length > 0 ? (
        signups.map((s) => {
          const userName = s.user?.name || 'Volunteer';
          const userInitial = userName.charAt(0).toUpperCase();

          return (
            <div key={s._id} className="roster-card-item">
              <div className="roster-user-info">
                <div className="roster-user-avatar">
                  {userInitial}
                </div>
                <div className="roster-user-text">
                  <span className="roster-user-name">
                    {userName}
                    {s.user?.email && (
                      <span style={{ fontWeight: 500, color: '#64748b', marginLeft: '0.45rem', fontSize: '0.84rem' }}>
                        ({s.user.email})
                      </span>
                    )}
                  </span>
                  <div className="roster-user-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        border: '1.5px solid #0f172a',
                        background: (s.user?.reliabilityScore ?? 100) >= 90 ? '#bbf7d0' : (s.user?.reliabilityScore ?? 100) >= 75 ? '#fef08a' : '#fecdd3',
                        color: (s.user?.reliabilityScore ?? 100) >= 90 ? '#166534' : (s.user?.reliabilityScore ?? 100) >= 75 ? '#854d0e' : '#991b1b',
                      }}
                    >
                      {(s.user?.reliabilityScore ?? 100) >= 90 ? '⭐' : (s.user?.reliabilityScore ?? 100) >= 75 ? '⚡' : '⚠️'}
                      Reliability: {s.user?.reliabilityScore ?? 100}%
                      {(s.user?.reliabilityScore ?? 100) < 75 ? ' (High Risk: Prior No-Shows/Early Leaves)' : (s.user?.reliabilityScore ?? 100) < 90 ? ' (Moderate)' : ' (Top Crew)'}
                    </span>
                    {s.user?.phone && (
                      <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>📞 {s.user.phone}</span>
                    )}
                    {s.user?.skills?.length > 0 && (
                      <span style={{ fontSize: '0.8rem', color: '#6366f1', fontWeight: 650 }}>Skills: {s.user.skills.slice(0, 3).join(', ')}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="roster-user-actions">
                <Pill tone={s.status === 'confirmed' ? 'good' : s.status === 'pending' ? 'warn' : 'neutral'}>
                  {SIGNUP_LABEL[s.status]}
                </Pill>

                {s.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="btn-roster-approve"
                      onClick={() => act.mutate({ id: s._id, action: 'approve' })}
                      disabled={act.isPending}
                    >
                      ✓ Approve Spot
                    </button>
                    <button
                      type="button"
                      className="btn-roster-decline"
                      onClick={() => act.mutate({ id: s._id, action: 'reject' })}
                      disabled={act.isPending}
                    >
                      ✕ Decline
                    </button>
                  </>
                )}

                {s.status !== 'pending' && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    style={{ fontSize: '0.78rem', color: '#ef4444' }}
                    onClick={() => {
                      const r = window.prompt(`Remove ${userName} from this shift?\nOptional reason:`);
                      if (r !== null) act.mutate({ id: s._id, action: 'remove', reason: r });
                    }}
                    disabled={act.isPending}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <p style={{ margin: 0, padding: '1rem', textAlign: 'center', color: '#64748b', fontWeight: 650, fontSize: '0.88rem' }}>
          No volunteers have registered for this shift yet. Share your event link to recruit crew!
        </p>
      )}
    </div>
  );
}
