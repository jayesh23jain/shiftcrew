import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../../api/client.js';
import { Notice, Spinner } from '../../components/ui.jsx';

const EXAMPLE_CHIPS = [
  {
    label: '💻 2-Day Hackathon',
    text: 'A 48-hour student hackathon with 400 participants. We need registration volunteers on day 1 morning, technical lab mentors throughout the night, stage AV crew for kickoff and demos, and judging coordinators on day 2 afternoon.',
    headcount: 25,
    budgetRupees: 15000,
  },
  {
    label: '🏃 City Marathon 10K',
    text: 'Annual city marathon with 1200 runners. Need dawn registration team from 5am, route safety marshals at every km mark, hydration station attendants distributing water and electrolytes, and medal presentation crew at the finish line.',
    headcount: 40,
    budgetRupees: 20000,
  },
  {
    label: '🎭 Cultural Music Fest',
    text: 'An evening college music and cultural fest from 4 PM to 11 PM. Staff needed: backstage crew and artist hospitality, crowd safety marshals near barricades, main gate ticketing/wristband team, and media content videographers.',
    headcount: 30,
    budgetRupees: 12000,
  },
  {
    label: '🌱 Tree Plantation Drive',
    text: 'A community environment drive from 7 AM to 12 PM in a city park. Volunteers to distribute saplings and tools, water station coordinators, registration table, and photo documentation.',
    headcount: 15,
    budgetRupees: 0,
  },
];

export default function PlanWithAiModal({ event, isOpen, onClose }) {
  const qc = useQueryClient();

  const [description, setDescription] = useState('');
  const [city, setCity] = useState(event.venue?.city || '');
  const [headcount, setHeadcount] = useState('');
  const [budgetRupees, setBudgetRupees] = useState('');

  // Draft state after generation
  const [draft, setDraft] = useState(null);
  const [selectedRoleIndices, setSelectedRoleIndices] = useState(new Set());
  const [selectedShiftIndices, setSelectedShiftIndices] = useState(new Set());
  const [editedRoles, setEditedRoles] = useState([]);
  const [editedShifts, setEditedShifts] = useState([]);
  const [applyProgress, setApplyProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Generate Draft Mutation
  const generateDraft = useMutation({
    mutationFn: async () => {
      setErrorMsg('');
      const payload = {
        description: description.trim(),
        city: city.trim() || undefined,
        headcount: headcount ? Number(headcount) : undefined,
        budgetRupees: budgetRupees !== '' ? Number(budgetRupees) : undefined,
        startDate: event.startDate,
      };
      const res = await api.post(`/events/${event._id}/plan-draft`, payload);
      return res.data.draft;
    },
    onSuccess: (data) => {
      setDraft(data);
      const roles = data.roles || [];
      const shifts = data.shifts || [];
      setEditedRoles([...roles]);
      setEditedShifts([...shifts]);
      setSelectedRoleIndices(new Set(roles.map((_, idx) => idx)));
      setSelectedShiftIndices(new Set(shifts.map((_, idx) => idx)));
    },
    onError: (err) => {
      setErrorMsg(errorMessage(err));
    },
  });

  // Apply Draft Mutation (creates roles, then shifts)
  const applyDraft = useMutation({
    mutationFn: async () => {
      setErrorMsg('');
      setApplyProgress('Saving roles...');

      // 1. Filter selected roles
      const rolesToCreate = editedRoles.filter((_, idx) => selectedRoleIndices.has(idx));
      const roleMap = new Map(); // roleName (lowercase) -> roleId

      for (let i = 0; i < rolesToCreate.length; i++) {
        const r = rolesToCreate[i];
        setApplyProgress(`Saving role ${i + 1} of ${rolesToCreate.length}: ${r.name}...`);
        const res = await api.post(`/events/${event._id}/roles`, {
          name: r.name.trim(),
          description: r.description.trim(),
          skills: Array.isArray(r.skills) ? r.skills : [],
        });
        roleMap.set(r.name.trim().toLowerCase(), res.data.role._id);
      }

      // Also fetch any existing roles if needed
      const existingRolesRes = await api.get(`/events/${event._id}/roles`);
      for (const ex of existingRolesRes.data.roles || []) {
        if (!roleMap.has(ex.name.toLowerCase())) {
          roleMap.set(ex.name.toLowerCase(), ex._id);
        }
      }

      // 2. Filter selected shifts
      const shiftsToCreate = editedShifts.filter((_, idx) => selectedShiftIndices.has(idx));
      const baseDate = event.startDate ? new Date(event.startDate) : new Date();

      for (let i = 0; i < shiftsToCreate.length; i++) {
        const s = shiftsToCreate[i];
        setApplyProgress(`Saving shift ${i + 1} of ${shiftsToCreate.length}...`);

        const roleId = roleMap.get(s.roleName.trim().toLowerCase());
        if (!roleId) {
          console.warn(`Skipping shift: role "${s.roleName}" not found`);
          continue;
        }

        // Calculate start and end ISO dates
        const shiftDate = new Date(baseDate.getTime() + (s.dayIndex || 0) * 24 * 60 * 60 * 1000);
        const [hours, mins] = (s.startTime || '09:00').split(':').map(Number);
        shiftDate.setHours(hours || 9, mins || 0, 0, 0);

        const duration = Number(s.durationMinutes) || 240;
        const endDate = new Date(shiftDate.getTime() + duration * 60 * 1000);

        await api.post(`/events/${event._id}/shifts`, {
          roleId,
          start: shiftDate.toISOString(),
          end: endDate.toISOString(),
          capacity: Number(s.capacity) || 1,
          payType: s.payType || 'unpaid',
          rateRupees: Number(s.rateRupees) || 0,
          notes: s.notes || '',
        });
      }

      return { rolesCount: rolesToCreate.length, shiftsCount: shiftsToCreate.length };
    },
    onSuccess: (result) => {
      setApplyProgress(null);
      setSuccessMsg(`Successfully applied ${result.rolesCount} roles and ${result.shiftsCount} shifts!`);
      qc.invalidateQueries({ queryKey: ['event', event._id] });
      qc.invalidateQueries({ queryKey: ['shifts', event._id] });
      setTimeout(() => {
        onClose();
      }, 1500);
    },
    onError: (err) => {
      setApplyProgress(null);
      setErrorMsg(errorMessage(err));
    },
  });

  if (!isOpen) return null;

  const toggleAllRoles = () => {
    if (selectedRoleIndices.size === editedRoles.length) {
      setSelectedRoleIndices(new Set());
    } else {
      setSelectedRoleIndices(new Set(editedRoles.map((_, i) => i)));
    }
  };

  const toggleAllShifts = () => {
    if (selectedShiftIndices.size === editedShifts.length) {
      setSelectedShiftIndices(new Set());
    } else {
      setSelectedShiftIndices(new Set(editedShifts.map((_, i) => i)));
    }
  };

  const toggleRole = (idx) => {
    const next = new Set(selectedRoleIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedRoleIndices(next);
  };

  const toggleShift = (idx) => {
    const next = new Set(selectedShiftIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedShiftIndices(next);
  };

  const updateRole = (idx, field, val) => {
    const next = [...editedRoles];
    next[idx] = { ...next[idx], [field]: val };
    setEditedRoles(next);
  };

  const updateShift = (idx, field, val) => {
    const next = [...editedShifts];
    next[idx] = { ...next[idx], [field]: val };
    setEditedShifts(next);
  };

  // Recompute selected budget estimate in UI
  const selectedShifts = editedShifts.filter((_, idx) => selectedShiftIndices.has(idx));
  let calculatedSelectedPaise = 0;
  for (const s of selectedShifts) {
    const cap = Number(s.capacity) || 0;
    const rate = Number(s.rateRupees) || 0;
    if (s.payType === 'flat') {
      calculatedSelectedPaise += Math.round(rate * 100) * cap;
    } else if (s.payType === 'hourly') {
      const dur = Number(s.durationMinutes) || 0;
      calculatedSelectedPaise += Math.round((dur / 60) * rate * 100) * cap;
    }
  }
  const calculatedSelectedRupees = Math.round(calculatedSelectedPaise / 100);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          border: '3.5px solid #0f172a',
          boxShadow: '8px 8px 0px #0f172a',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '2.5px solid #0f172a',
            background: '#e0e7ff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '1.4rem' }}>⚡</span>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.35rem', color: '#0f172a', fontWeight: 950 }}>
                Plan My Event with AI
              </h2>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: '#fef08a',
                  border: '1.5px solid #0f172a',
                  color: '#0f172a',
                }}
              >
                AI Draft: Review Before Saving
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.84rem', color: '#475569', fontWeight: 650 }}>
              Describe your event in plain language. AI will draft crew roles and time shifts for your review.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={onClose}
            style={{ fontSize: '1.2rem', padding: '0.2rem 0.5rem', fontWeight: 900 }}
          >
            ✕
          </button>
        </div>

        {/* Body content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {errorMsg && <Notice tone="error">{errorMsg}</Notice>}
          {successMsg && <Notice tone="good">{successMsg}</Notice>}

          {!draft ? (
            /* STEP 1: PROMPT INPUT FORM */
            <div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontWeight: 850, fontSize: '0.9rem', marginBottom: '0.4rem', color: '#0f172a' }}>
                  What kind of event are you organizing? (Event Description)
                </label>
                <textarea
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 1500))}
                  placeholder="e.g. A 2-day outdoor music festival with 2 main stages, 15 food stalls, VIP check-in, and emergency crowd control..."
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '10px',
                    border: '2px solid #0f172a',
                    fontFamily: 'inherit',
                    fontSize: '0.92rem',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                  <span>Be descriptive about schedule, participant count, and special teams needed.</span>
                  <span>{description.length}/1500</span>
                </div>
              </div>

              {/* Example Chips */}
              <div style={{ marginBottom: '1.5rem' }}>
                <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  💡 Or start with a template:
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {EXAMPLE_CHIPS.map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="manage-action-btn manage-btn-white"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                      onClick={() => {
                        setDescription(chip.text);
                        if (chip.headcount) setHeadcount(chip.headcount);
                        if (chip.budgetRupees != null) setBudgetRupees(chip.budgetRupees);
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Constraints Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.85rem',
                  background: '#f8fafc',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569' }}>
                    CITY / LOCATION
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Bangalore"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1.5px solid #0f172a', fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569' }}>
                    TARGET CREW HEADCOUNT
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={headcount}
                    onChange={(e) => setHeadcount(e.target.value)}
                    placeholder="e.g. 25"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1.5px solid #0f172a', fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569' }}>
                    TARGET STIPEND BUDGET (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={budgetRupees}
                    onChange={(e) => setBudgetRupees(e.target.value)}
                    placeholder="e.g. 15000"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1.5px solid #0f172a', fontWeight: 700 }}
                  />
                </div>
              </div>

              {/* Notice */}
              <div
                style={{
                  background: '#fef3c7',
                  border: '1.5px solid #f59e0b',
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  fontSize: '0.82rem',
                  color: '#92400e',
                  fontWeight: 650,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                }}
              >
                <span>🛡️</span>
                <span>
                  <strong>Safety guarantee:</strong> AI generates a preview draft only. No roles, shifts, or stipends are created until you review and click Apply.
                </span>
              </div>
            </div>
          ) : (
            /* STEP 2: EDITABLE DRAFT REVIEW & SELECTION */
            <div>
              {/* Review Callout */}
              <div
                style={{
                  background: '#eff6ff',
                  border: '2px solid #2563eb',
                  borderRadius: '12px',
                  padding: '0.85rem 1.25rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div>
                  <strong style={{ color: '#1e40af', fontSize: '0.92rem' }}>
                    🔍 AI Draft Ready for Review
                  </strong>
                  <div style={{ fontSize: '0.8rem', color: '#3b82f6', fontWeight: 650 }}>
                    Select the roles and shifts you want to apply to this event. You can edit any field before saving.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-white"
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                  onClick={() => setDraft(null)}
                >
                  ← Refine Prompt
                </button>
              </div>

              {/* Warnings and Assumptions Banner */}
              {(draft.warnings?.length > 0 || draft.assumptions?.length > 0) && (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1.5px solid #fde68a',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                    marginBottom: '1.25rem',
                    fontSize: '0.82rem',
                  }}
                >
                  {draft.warnings?.length > 0 && (
                    <div style={{ marginBottom: draft.assumptions?.length > 0 ? '0.5rem' : 0 }}>
                      <strong style={{ color: '#b45309' }}>⚠️ Operational Alerts / Clamping:</strong>
                      <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem', color: '#92400e' }}>
                        {draft.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {draft.assumptions?.length > 0 && (
                    <div>
                      <strong style={{ color: '#475569' }}>📌 Planning Assumptions:</strong>
                      <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem', color: '#64748b' }}>
                        {draft.assumptions.map((a, idx) => (
                          <li key={idx}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Budget Estimate Card */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '2px solid #0f172a',
                  borderRadius: '12px',
                  padding: '1rem',
                  marginBottom: '1.5rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                    Selected Shifts Budget
                  </span>
                  <div style={{ fontSize: '1.3rem', fontWeight: 950, color: '#0f172a' }}>
                    ₹{calculatedSelectedRupees.toLocaleString('en-IN')}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                    Target Budget
                  </span>
                  <div style={{ fontSize: '1.3rem', fontWeight: 950, color: '#475569' }}>
                    {draft.budgetEstimate?.requestedBudgetRupees
                      ? `₹${draft.budgetEstimate.requestedBudgetRupees.toLocaleString('en-IN')}`
                      : 'None set'}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                    Org Wallet Balance
                  </span>
                  <div style={{ fontSize: '1.3rem', fontWeight: 950, color: '#16a34a' }}>
                    ₹{(draft.budgetEstimate?.walletBalanceRupees || 0).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              {/* 1. ROLES SECTION */}
              <div style={{ marginBottom: '1.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                    1. Proposed Crew Roles ({selectedRoleIndices.size}/{editedRoles.length} Selected)
                  </h3>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    style={{ fontSize: '0.78rem' }}
                    onClick={toggleAllRoles}
                  >
                    {selectedRoleIndices.size === editedRoles.length ? 'Deselect All Roles' : 'Select All Roles'}
                  </button>
                </div>

                <div style={{ display: 'grid', gap: '0.65rem' }}>
                  {editedRoles.map((r, idx) => {
                    const isChecked = selectedRoleIndices.has(idx);
                    return (
                      <div
                        key={idx}
                        style={{
                          background: isChecked ? '#ffffff' : '#f8fafc',
                          border: isChecked ? '2px solid #0f172a' : '1.5px solid #cbd5e1',
                          borderRadius: '10px',
                          padding: '0.85rem',
                          display: 'flex',
                          gap: '0.75rem',
                          alignItems: 'flex-start',
                          opacity: isChecked ? 1 : 0.65,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRole(idx)}
                          style={{
                            width: '18px',
                            height: '18px',
                            minWidth: '18px',
                            maxWidth: '18px',
                            margin: '0.25rem 0 0 0',
                            padding: 0,
                            flexShrink: 0,
                            cursor: 'pointer',
                            accentColor: '#4f46e5',
                          }}
                        />
                        <div style={{ flex: '1 1 auto', minWidth: 0, width: '100%' }}>
                          <input
                            type="text"
                            value={r.name}
                            onChange={(e) => updateRole(idx, 'name', e.target.value)}
                            style={{
                              fontWeight: 900,
                              fontSize: '0.95rem',
                              width: '100%',
                              padding: '0.25rem 0.45rem',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              marginBottom: '0.35rem',
                            }}
                          />
                          <input
                            type="text"
                            value={r.description}
                            onChange={(e) => updateRole(idx, 'description', e.target.value)}
                            placeholder="Role description"
                            style={{
                              fontSize: '0.82rem',
                              width: '100%',
                              padding: '0.25rem 0.45rem',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              marginBottom: '0.35rem',
                              color: '#475569',
                            }}
                          />
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {(r.skills || []).map((sk, sIdx) => (
                              <span
                                key={sIdx}
                                style={{
                                  fontSize: '0.72rem',
                                  background: '#e0e7ff',
                                  color: '#3730a3',
                                  fontWeight: 800,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {sk}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. SHIFTS SECTION */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                    2. Proposed Shifts ({selectedShiftIndices.size}/{editedShifts.length} Selected)
                  </h3>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    style={{ fontSize: '0.78rem' }}
                    onClick={toggleAllShifts}
                  >
                    {selectedShiftIndices.size === editedShifts.length ? 'Deselect All Shifts' : 'Select All Shifts'}
                  </button>
                </div>

                <div style={{ display: 'grid', gap: '0.65rem' }}>
                  {editedShifts.map((s, idx) => {
                    const isChecked = selectedShiftIndices.has(idx);
                    return (
                      <div
                        key={idx}
                        style={{
                          background: isChecked ? '#ffffff' : '#f8fafc',
                          border: isChecked ? '2px solid #0f172a' : '1.5px solid #cbd5e1',
                          borderRadius: '10px',
                          padding: '0.85rem',
                          display: 'flex',
                          gap: '0.75rem',
                          alignItems: 'flex-start',
                          opacity: isChecked ? 1 : 0.65,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleShift(idx)}
                          style={{
                            width: '18px',
                            height: '18px',
                            minWidth: '18px',
                            maxWidth: '18px',
                            margin: '0.25rem 0 0 0',
                            padding: 0,
                            flexShrink: 0,
                            cursor: 'pointer',
                            accentColor: '#4f46e5',
                          }}
                        />
                        <div style={{ flex: '1 1 auto', minWidth: 0, width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
                            <span
                              style={{
                                fontSize: '0.82rem',
                                fontWeight: 900,
                                background: '#fef08a',
                                border: '1px solid #0f172a',
                                padding: '2px 8px',
                                borderRadius: '6px',
                              }}
                            >
                              Role: {s.roleName}
                            </span>
                            <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>
                              Day Index: {s.dayIndex} (e.g. Day {s.dayIndex + 1})
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', fontSize: '0.82rem' }}>
                            <div>
                              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800 }}>START TIME</span>
                              <input
                                type="text"
                                value={s.startTime}
                                onChange={(e) => updateShift(idx, 'startTime', e.target.value)}
                                style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 800 }}
                              />
                            </div>
                            <div>
                              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800 }}>DURATION (MIN)</span>
                              <input
                                type="number"
                                min="30"
                                max="960"
                                value={s.durationMinutes}
                                onChange={(e) => updateShift(idx, 'durationMinutes', e.target.value)}
                                style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 800 }}
                              />
                            </div>
                            <div>
                              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800 }}>CAPACITY</span>
                              <input
                                type="number"
                                min="1"
                                max="200"
                                value={s.capacity}
                                onChange={(e) => updateShift(idx, 'capacity', e.target.value)}
                                style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 800 }}
                              />
                            </div>
                            <div>
                              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800 }}>PAY TYPE</span>
                              <select
                                value={s.payType}
                                onChange={(e) => updateShift(idx, 'payType', e.target.value)}
                                style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 800 }}
                              >
                                <option value="unpaid">Unpaid</option>
                                <option value="hourly">Hourly</option>
                                <option value="flat">Flat</option>
                              </select>
                            </div>
                            {s.payType !== 'unpaid' && (
                              <div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800 }}>
                                  RATE (₹{s.payType === 'hourly' ? '/hr' : ''})
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  value={s.rateRupees}
                                  onChange={(e) => updateShift(idx, 'rateRupees', e.target.value)}
                                  style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 800 }}
                                />
                              </div>
                            )}
                          </div>

                          {s.notes && (
                            <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic' }}>
                              Note: {s.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '2.5px solid #0f172a',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            className="btn btn-white"
            onClick={onClose}
            disabled={generateDraft.isPending || applyDraft.isPending}
          >
            Cancel
          </button>

          {!draft ? (
            <button
              type="button"
              className="manage-action-btn manage-btn-primary"
              onClick={() => generateDraft.mutate()}
              disabled={!description.trim() || generateDraft.isPending}
            >
              {generateDraft.isPending ? '⚡ Generating AI Draft...' : '⚡ Generate Operational Draft'}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {applyProgress && (
                <span style={{ fontSize: '0.82rem', color: '#2563eb', fontWeight: 800 }}>
                  {applyProgress}
                </span>
              )}
              <button
                type="button"
                className="manage-action-btn manage-btn-primary"
                onClick={() => applyDraft.mutate()}
                disabled={
                  applyDraft.isPending ||
                  (selectedRoleIndices.size === 0 && selectedShiftIndices.size === 0)
                }
              >
                {applyDraft.isPending
                  ? 'Saving to Event...'
                  : `✓ Apply Selected (${selectedRoleIndices.size} roles, ${selectedShiftIndices.size} shifts)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
