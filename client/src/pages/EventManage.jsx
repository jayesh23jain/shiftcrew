import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { CATEGORIES, formatRange, toInputDate, toIso } from '../lib.js';
import { Empty, Field, Notice, Spinner, StatusChip, Tabs } from '../components/ui.jsx';
import ShiftsTab from './manage/ShiftsTab.jsx';
import HoursTab from './manage/HoursTab.jsx';
import FundsTab from './manage/FundsTab.jsx';
import CommsTab from './manage/CommsTab.jsx';
import MissionControlTab from './manage/MissionControlTab.jsx';
import PlanWithAiModal from './manage/PlanWithAiModal.jsx';

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

const ROLE_PRESETS = [
  {
    icon: '🎟️',
    label: 'Registration & QR Desk',
    name: 'Registration & QR Desk',
    description: 'Welcome attendees, verify tickets, hand out badges, and scan digital passes.',
    skills: 'Greeting, Punctuality, Ticket Verification, Fast Typing',
  },
  {
    icon: '🍕',
    label: 'Hospitality & Food Crew',
    name: 'Hospitality & Food Crew',
    description: 'Manage snack counters, water distribution, volunteer meals, and VIP refreshments.',
    skills: 'Hospitality, Cleanliness, Queue Management, Teamwork',
  },
  {
    icon: '🎙️',
    label: 'Stage & AV Coordinator',
    name: 'Stage & AV Coordinator',
    description: 'Assist with mics, stage sound, projector feeds, lighting, and speaker coordination.',
    skills: 'Audio/Video, Stage Handling, Communication, Cable Management',
  },
  {
    icon: '🛡️',
    label: 'Crowd & Safety Marshal',
    name: 'Crowd & Safety Marshal',
    description: 'Direct attendees, guide exits, monitor stage barricades, and assist emergency teams.',
    skills: 'Crowd Control, Vigilance, Calm under pressure',
  },
  {
    icon: '📸',
    label: 'Media & Social Content',
    name: 'Media & Social Content',
    description: 'Capture candid photos, Instagram reels, and document key moments of the event.',
    skills: 'Photography, Video Editing, Social Media, Creativity',
  },
  {
    icon: '💻',
    label: 'Technical / Mentor Helpdesk',
    name: 'Technical / Mentor Helpdesk',
    description: 'Assist participants with Wi-Fi, desk setups, API keys, and technical debugging.',
    skills: 'Problem Solving, Git, Python, Web Development',
  },
];

export default function EventManage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [copiedLink, setCopiedLink] = useState(false);
  const [showAiPlanModal, setShowAiPlanModal] = useState(false);

  const { data: aiStatus } = useQuery({
    queryKey: ['aiStatus'],
    queryFn: async () => (await api.get('/ai/status')).data,
    staleTime: 60000,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', id],
    queryFn: async () => (await api.get(`/events/${id}`)).data,
  });

  const [statusError, setStatusError] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['event', id] });
    qc.invalidateQueries({ queryKey: ['events'] });
  };
  const setStatus = useMutation({
    mutationFn: async (body) => (await api.post(`/events/${id}/status`, body)).data,
    onSuccess: () => {
      setStatusError('');
      refresh();
    },
    onError: (err) => {
      setStatusError(errorMessage(err));
    },
  });
  const remove = useMutation({
    mutationFn: async () => api.delete(`/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      navigate('/dashboard');
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !data?.canManage) {
    return (
      <Empty title="You cannot manage this event">
        Check that you belong to the organization that owns it. <Link to="/dashboard">Back to dashboard</Link>
      </Empty>
    );
  }

  const { event, roles = [] } = data;
  const editable = ['draft', 'published', 'ongoing'].includes(event.status);
  const inviteLink =
    event.visibility === 'invite_only'
      ? `${window.location.origin}/events/${event._id}?code=${event.inviteCode}`
      : `${window.location.origin}/events/${event._id}`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  const cancel = () => {
    const reason = window.prompt('Why is this event being cancelled? Volunteers will be told.');
    if (reason !== null) setStatus.mutate({ status: 'cancelled', reason });
  };
  const go = (t) => setParams(t === 'overview' ? {} : { tab: t });

  const assignedLeadsCount = roles.filter((r) => r.leadId).length;

  return (
    <div className="manage-overview-wrapper">
      {/* Neo-Brutalist Event Operations Hero Card (Hidden on Live Control to eliminate redundant hero box) */}
      {tab !== 'live' && (
        <div className="manage-hero-bento">
        <div className="manage-hero-top">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              <span className="event-cat-chip">{CATEGORIES[event.category] || event.category}</span>
              <StatusChip status={event.status} />
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 850,
                  padding: '3px 10px',
                  borderRadius: '999px',
                  border: '1.5px solid #0f172a',
                  background: event.visibility === 'invite_only' ? '#fed7aa' : '#e0e7ff',
                  color: '#0f172a',
                }}
              >
                {event.visibility === 'invite_only' ? '🔒 Private Invite Only' : '🌐 Publicly Listed'}
              </span>
            </div>

            <h1 className="manage-hero-title">{event.title}</h1>

            <div className="manage-hero-meta">
              <span>📅 {formatRange(event.startDate, event.endDate)}</span>
              <span>📍 {event.venue?.name ? `${event.venue.name}, ` : ''}{event.venue?.city || 'Location TBA'}</span>
            </div>
          </div>

          <button
            type="button"
            className="manage-action-btn manage-btn-white"
            onClick={copyShareLink}
            title="Copy volunteer registration link"
          >
            {copiedLink ? (
              <>✓ Link Copied!</>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Share Registration Link</span>
              </>
            )}
          </button>
        </div>

        {/* Action Controls Bar */}
        <div className="manage-hero-actions-bar">
          <button
            type="button"
            className="manage-action-btn"
            style={{
              background: tab === 'live' ? '#ef4444' : '#fee2e2',
              color: tab === 'live' ? '#ffffff' : '#991b1b',
              border: '2px solid #0f172a',
              boxShadow: '3px 3px 0px #0f172a',
              fontWeight: 950,
            }}
            onClick={() => go('live')}
          >
            🔴 Live Mission Control
          </button>
          {aiStatus?.enabled && editable && (
            <button
              type="button"
              className="manage-action-btn"
              style={{
                background: '#e0e7ff',
                color: '#3730a3',
                border: '2px solid #0f172a',
                boxShadow: '3px 3px 0px #0f172a',
                fontWeight: 950,
              }}
              onClick={() => setShowAiPlanModal(true)}
              title="Use AI to automatically draft crew roles and shifts"
            >
              ⚡ Plan with AI
            </button>
          )}
          {event.status === 'draft' && (
            <button
              className="manage-action-btn manage-btn-primary"
              onClick={() => {
                setStatusError('');
                setStatus.mutate({ status: 'published' });
              }}
              disabled={setStatus.isPending}
            >
              {setStatus.isPending ? 'Publishing...' : '🚀 Publish Event'}
            </button>
          )}
          {event.status === 'published' && (
            <button
              className="manage-action-btn manage-btn-white"
              onClick={() => {
                setStatusError('');
                setStatus.mutate({ status: 'draft' });
              }}
              disabled={setStatus.isPending}
            >
              ↩ Move to Draft
            </button>
          )}
          {event.status === 'completed' && (
            <button
              className="manage-action-btn manage-btn-primary"
              onClick={() => setStatus.mutate({ status: 'settled' })}
            >
              🏁 Settle & Close Event
            </button>
          )}

          {editable && (
            <Link className="manage-action-btn manage-btn-white" to={`/manage/events/${id}/edit`}>
              ✏️ Edit Details
            </Link>
          )}

          <Link className="manage-action-btn manage-btn-white" to={`/events/${id}`} target="_blank" rel="noopener noreferrer">
            👁️ Public Page ↗
          </Link>

          {['draft', 'published', 'ongoing'].includes(event.status) && (
            <button className="manage-action-btn manage-btn-danger" onClick={cancel}>
              🚫 Cancel Event
            </button>
          )}
          {event.status === 'draft' && (
            <button
              className="manage-action-btn manage-btn-danger"
              onClick={() => window.confirm('Delete this draft permanently?') && remove.mutate()}
            >
              🗑️ Delete Draft
            </button>
          )}
        </div>

        {statusError && (
          <div style={{ marginTop: '0.9rem' }}>
            <Notice tone="danger">{statusError}</Notice>
          </div>
        )}
      </div>
      )}

      {/* Mobile Tab Bar */}
      <div className="event-manage-tabs-desktop-hidden">
        <Tabs
          value={tab}
          onChange={go}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'live', label: '🔴 Live Control' },
            { id: 'shifts', label: 'Shifts' },
            { id: 'hours', label: 'Hours' },
            { id: 'funds', label: 'Funds and payouts' },
            { id: 'comms', label: 'Updates and records' },
          ]}
        />
      </div>

      {tab === 'overview' && (
        <>
          <Notice>{setStatus.error && errorMessage(setStatus.error)}{remove.error && errorMessage(remove.error)}</Notice>

          {/* Event KPI Health Row */}
          <div className="manage-kpi-row">
            <div className="manage-kpi-card">
              <div className="manage-kpi-icon" style={{ background: '#fef08a' }}>👥</div>
              <div className="manage-kpi-text">
                <span className="manage-kpi-val">{roles.length}</span>
                <span className="manage-kpi-label">Defined Roles</span>
              </div>
            </div>

            <div className="manage-kpi-card">
              <div className="manage-kpi-icon" style={{ background: '#bbf7d0' }}>🎯</div>
              <div className="manage-kpi-text">
                <span className="manage-kpi-val">{assignedLeadsCount} / {roles.length}</span>
                <span className="manage-kpi-label">Leads Assigned</span>
              </div>
            </div>

            <div className="manage-kpi-card">
              <div className="manage-kpi-icon" style={{ background: '#ddd6fe' }}>🛡️</div>
              <div className="manage-kpi-text">
                <span className="manage-kpi-val" style={{ fontSize: '1.05rem' }}>
                  {event.applicationMode === 'approval' ? 'Requires Approval' : 'Instant Open'}
                </span>
                <span className="manage-kpi-label">Volunteer Intake</span>
              </div>
            </div>

            <div className="manage-kpi-card">
              <div className="manage-kpi-icon" style={{ background: '#fed7aa' }}>📍</div>
              <div className="manage-kpi-text">
                <span className="manage-kpi-val" style={{ fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                  {event.venue?.city || 'Not set'}
                </span>
                <span className="manage-kpi-label">Host City</span>
              </div>
            </div>
          </div>

          {event.status === 'draft' && (
            <Notice tone="info">
              💡 <strong>Draft Checklist:</strong> Add your crew roles below, then jump to the <strong>Shifts</strong> tab to create volunteer time slots before publishing.
            </Notice>
          )}

          {event.status === 'completed' && (
            <Notice tone="info">
              🎉 <strong>Event Finished:</strong> Head to <strong>Hours</strong> to approve volunteer timesheets, release payments in <strong>Funds</strong>, and issue digital certificates!
            </Notice>
          )}

          {/* Role Manager with Bento Cards & 1-Click Presets */}
          <RoleManager
            eventId={id}
            roles={roles}
            editable={editable}
            onChange={refresh}
            event={event}
            onGoToShifts={go}
            onOpenAiPlan={() => setShowAiPlanModal(true)}
            aiEnabled={aiStatus?.enabled}
          />
        </>
      )}

      {tab === 'live' && <MissionControlTab event={event} />}
      {tab === 'shifts' && <ShiftsTab event={event} roles={roles} />}
      {tab === 'hours' && <HoursTab event={event} />}
      {tab === 'funds' && <FundsTab event={event} />}
      {tab === 'comms' && <CommsTab event={event} roles={roles} />}

      {/* Plan with AI Modal */}
      <PlanWithAiModal
        event={event}
        isOpen={showAiPlanModal}
        onClose={() => setShowAiPlanModal(false)}
      />
    </div>
  );
}

function RoleManager({ eventId, roles, editable, onChange, event, onGoToShifts, onOpenAiPlan, aiEnabled }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', skills: '', leadEmail: '' });
  const [shiftModalRole, setShiftModalRole] = useState(null);
  const [shiftSuccessMsg, setShiftSuccessMsg] = useState('');

  const eventDateStr = event?.startDate ? toInputDate(event.startDate) : new Date().toISOString().slice(0, 10);
  const [shiftForm, setShiftForm] = useState({
    start: `${eventDateStr}T09:00`,
    end: `${eventDateStr}T13:00`,
    capacity: 5,
    payType: 'unpaid',
    rateRupees: '',
    notes: '',
  });

  const add = useMutation({
    mutationFn: async () =>
      (await api.post(`/events/${eventId}/roles`, {
        name: form.name,
        description: form.description,
        leadEmail: form.leadEmail || undefined,
        skillsRequired: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      })).data,
    onSuccess: () => {
      setForm({ name: '', description: '', skills: '', leadEmail: '' });
      onChange();
    },
  });
  const del = useMutation({
    mutationFn: async (roleId) => api.delete(`/events/${eventId}/roles/${roleId}`),
    onSuccess: onChange,
  });

  const createShift = useMutation({
    mutationFn: async () =>
      (await api.post(`/events/${eventId}/shifts`, {
        roleId: shiftModalRole._id,
        start: toIso(shiftForm.start),
        end: toIso(shiftForm.end),
        capacity: Number(shiftForm.capacity),
        payType: shiftForm.payType,
        rateRupees: shiftForm.payType === 'unpaid' ? 0 : Number(shiftForm.rateRupees || 0),
        notes: shiftForm.notes,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts', eventId] });
      qc.invalidateQueries({ queryKey: ['event', eventId] });
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['organizer-summary'] });
      const roleName = shiftModalRole.name;
      setShiftModalRole(null);
      setShiftSuccessMsg(`🎉 Successfully created shift for "${roleName}"!`);
      setTimeout(() => setShiftSuccessMsg(''), 4500);
    },
  });

  const errors = add.error ? fieldErrors(add.error) : {};
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const applyPreset = (preset) => {
    setForm({
      name: preset.name,
      description: preset.description,
      skills: preset.skills,
      leadEmail: form.leadEmail,
    });
  };

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.15rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 950, color: '#0f172a', margin: 0 }}>
            Event Crew Roles ({roles.length})
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.86rem', color: '#64748b', fontWeight: 600 }}>
            Roles define specific jobs volunteers apply for, with dedicated team leads to scan QR check-ins.
          </p>
        </div>

        {aiEnabled && editable && (
          <button
            type="button"
            className="manage-action-btn"
            style={{
              background: '#e0e7ff',
              color: '#3730a3',
              border: '2px solid #0f172a',
              boxShadow: '3px 3px 0px #0f172a',
              fontWeight: 950,
            }}
            onClick={onOpenAiPlan}
          >
            ⚡ Plan with AI
          </button>
        )}
      </div>

      {shiftSuccessMsg && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="success">{shiftSuccessMsg}</Notice>
        </div>
      )}

      <Notice>{del.error && errorMessage(del.error)}</Notice>

      {/* Neo-Brutalist Role Bento Cards */}
      {roles.length > 0 ? (
        <div className="role-bento-grid">
          {roles.map((r) => {
            const roleIcon = getRoleIcon(r.name);
            return (
              <div key={r._id} className="role-bento-card">
                <div>
                  <div className="role-bento-header">
                    <h3 className="role-bento-title">
                      <span>{roleIcon}</span>
                      <span>{r.name}</span>
                    </h3>
                  </div>

                  <p className="role-bento-desc">
                    {r.description || 'No description provided.'}
                  </p>

                  <div className="role-lead-status-row">
                    {r.leadId ? (
                      <span className="role-lead-badge assigned" title="Can scan volunteer check-in QR passes">
                        ✓ Lead: <strong>{r.leadId.name}</strong> ({r.leadId.email})
                      </span>
                    ) : (
                      <span className="role-lead-badge missing" title="Assign a lead so they can scan QR passes for this role">
                        ⚠️ No Team Lead Assigned (Add lead email to scan QR)
                      </span>
                    )}
                  </div>

                  {r.skillsRequired?.length > 0 && (
                    <div className="role-skills-container">
                      {r.skillsRequired.map((skill, idx) => (
                        <span key={idx} className="role-skill-chip">
                          #{skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {editable && (
                  <div className="role-bento-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setShiftForm({
                          start: `${eventDateStr}T09:00`,
                          end: `${eventDateStr}T13:00`,
                          capacity: 5,
                          payType: 'unpaid',
                          rateRupees: '',
                          notes: '',
                        });
                        setShiftModalRole(r);
                      }}
                      style={{
                        padding: '0.42rem 0.95rem',
                        fontSize: '0.82rem',
                        fontWeight: 850,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        border: '2px solid #0f172a',
                        boxShadow: '2px 2px 0px #0f172a',
                        borderRadius: '8px',
                      }}
                    >
                      <span>➕</span> Create Shift
                    </button>

                    <button
                      type="button"
                      className="btn-remove-role"
                      onClick={() => {
                        if (window.confirm(`Delete role "${r.name}"? Existing shifts for this role will also be affected.`)) {
                          del.mutate(r._id);
                        }
                      }}
                      disabled={del.isPending}
                    >
                      {del.isPending ? 'Removing...' : '🗑️ Remove Role'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ marginBottom: '2rem' }}>
          <Empty title="No Crew Roles Defined Yet">
            Roles are the volunteer positions for your event (like Registration Desk, Stage AV, or Hospitality). Use the quick templates below to add your first role!
          </Empty>
        </div>
      )}

      {/* Quick Create Shift Modal */}
      {shiftModalRole && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setShiftModalRole(null)}
        >
          <div
            style={{
              background: '#ffffff',
              border: '3px solid #0f172a',
              borderRadius: '20px',
              boxShadow: '8px 8px 0px #0f172a',
              padding: '1.75rem',
              maxWidth: '540px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '2px solid #0f172a', paddingBottom: '0.75rem' }}>
              <div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    background: '#dcfce7',
                    color: '#15803d',
                    border: '1.2px solid #16a34a',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    letterSpacing: '0.4px',
                  }}
                >
                  NEW SHIFT
                </span>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 950, color: '#0f172a', margin: '0.25rem 0 0' }}>
                  Create Shift for {shiftModalRole.name}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setShiftModalRole(null)}
                style={{
                  background: '#f1f5f9',
                  border: '2px solid #0f172a',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  fontSize: '1rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {createShift.error && (
              <div style={{ marginBottom: '1rem' }}>
                <Notice>{errorMessage(createShift.error)}</Notice>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createShift.mutate();
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              {/* Quick Time Presets */}
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 850, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '0.35rem' }}>
                  ⚡ Quick Time Presets:
                </span>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Morning (9am - 1pm)', s: '09:00', e: '13:00' },
                    { label: 'Afternoon (1pm - 5pm)', s: '13:00', e: '17:00' },
                    { label: 'Evening (5pm - 9pm)', s: '17:00', e: '21:00' },
                    { label: 'Full Day (9am - 6pm)', s: '09:00', e: '18:00' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        setShiftForm({
                          ...shiftForm,
                          start: `${eventDateStr}T${preset.s}`,
                          end: `${eventDateStr}T${preset.e}`,
                        })
                      }
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        background: '#f8fafc',
                        border: '1.5px solid #0f172a',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start & End Times */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <Field label="Shift Start Time">
                  <input
                    type="datetime-local"
                    value={shiftForm.start}
                    onChange={(e) => setShiftForm({ ...shiftForm, start: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Shift End Time">
                  <input
                    type="datetime-local"
                    value={shiftForm.end}
                    onChange={(e) => setShiftForm({ ...shiftForm, end: e.target.value })}
                    required
                  />
                </Field>
              </div>

              {/* Capacity & Pay Type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: '0.75rem' }}>
                <Field label="Volunteer Capacity" hint="Headcount needed">
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={shiftForm.capacity}
                    onChange={(e) => setShiftForm({ ...shiftForm, capacity: e.target.value })}
                    required
                  />
                </Field>

                <Field label="Compensation">
                  <select
                    value={shiftForm.payType}
                    onChange={(e) => setShiftForm({ ...shiftForm, payType: e.target.value })}
                  >
                    <option value="unpaid">Volunteer (Unpaid / Certificate)</option>
                    <option value="flat">Flat Stipend (₹ per shift)</option>
                    <option value="hourly">Hourly Rate (₹ per hour)</option>
                  </select>
                </Field>
              </div>

              {shiftForm.payType !== 'unpaid' && (
                <Field label={shiftForm.payType === 'hourly' ? 'Hourly Rate in Rupees (₹)' : 'Flat Stipend in Rupees (₹)'} hint="Enter amount (e.g. 500 or 1000)">
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 500"
                    value={shiftForm.rateRupees}
                    onChange={(e) => setShiftForm({ ...shiftForm, rateRupees: e.target.value })}
                    required
                  />
                </Field>
              )}

              <Field label="Shift Instructions / Notes" optional>
                <input
                  type="text"
                  placeholder="e.g. Report to registration desk, bring college ID"
                  value={shiftForm.notes}
                  onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })}
                />
              </Field>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                {onGoToShifts && (
                  <button
                    type="button"
                    onClick={() => {
                      setShiftModalRole(null);
                      onGoToShifts('shifts');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4338ca',
                      fontSize: '0.82rem',
                      fontWeight: 850,
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    Manage in full Shifts tab →
                  </button>
                )}

                <div style={{ display: 'flex', gap: '0.6rem', marginLeft: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => setShiftModalRole(null)}
                    className="btn btn-white"
                    style={{ border: '2px solid #0f172a', fontWeight: 800, fontSize: '0.86rem' }}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={createShift.isPending}
                    style={{ fontWeight: 850, fontSize: '0.86rem', padding: '0.55rem 1.25rem' }}
                  >
                    {createShift.isPending ? 'Creating Shift...' : '🚀 Create Shift Slot'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Role Section with 1-Click Templates */}
      {editable && (
        <div className="role-add-card">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            Add a New Crew Role
          </h3>

          {/* 1-Click Role Presets */}
          <div className="role-presets-box">
            <div className="role-presets-label">
              ⚡ 1-Click Role Templates (Auto-fills form below):
            </div>
            <div className="role-presets-grid">
              {ROLE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="role-preset-btn"
                  onClick={() => applyPreset(preset)}
                >
                  <span>{preset.icon}</span>
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
            noValidate
          >
            <Notice>{add.error && errorMessage(add.error)}</Notice>

            <div className="two">
              <Field label="Role name" error={errors.name} hint="e.g. Stage AV Coordinator, Registration Desk">
                <input
                  value={form.name}
                  onChange={set('name')}
                  placeholder="e.g. Hospitality & Refreshments"
                  required
                />
              </Field>

              <Field
                label="Team lead email"
                error={errors.leadEmail}
                hint="Optional. They can scan volunteer QR check-in passes for this role."
              >
                <input
                  type="email"
                  value={form.leadEmail}
                  onChange={set('leadEmail')}
                  placeholder="lead@example.com"
                />
              </Field>
            </div>

            <Field
              label="What does this role do?"
              error={errors.description}
              hint="Describe duties, expectations, and where they will report."
            >
              <textarea
                rows={3}
                value={form.description}
                onChange={set('description')}
                placeholder="Describe responsibilities so volunteers know what to expect..."
              />
            </Field>

            <Field
              label="Helpful skills"
              hint="Comma separated (e.g. Communication, First Aid, Soundboard)"
            >
              <input
                value={form.skills}
                onChange={set('skills')}
                placeholder="e.g. Punctual, Good Communication, Friendly"
              />
            </Field>

            <div style={{ marginTop: '1.25rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  padding: '0.65rem 1.65rem',
                  fontSize: '0.95rem',
                  fontWeight: 900,
                  boxShadow: '3.5px 3.5px 0px #0f172a',
                }}
                disabled={add.isPending}
              >
                {add.isPending ? 'Adding Role...' : '+ Add Role to Event'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
