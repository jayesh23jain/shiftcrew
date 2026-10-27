import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatShift, formatRange, payLabel, CATEGORIES } from '../lib.js';

const CARD_HEADER_PALETTE = [
  '#bbf7d0', // Mint
  '#fed7aa', // Peach
  '#ddd6fe', // Lavender
  '#fef08a', // Yellow
  '#bae6fd', // Sky Blue
  '#fecdd3', // Rose
];

export default function SwapBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOrganizer = user?.role === 'organizer' || user?.role === 'admin';

  // Organizers manage events; the swap board is for crew volunteers
  if (isOrganizer) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [sortBy, setSortBy] = useState('upcoming'); // 'upcoming', 'highest_pay', 'newest'

  const [claimingSwap, setClaimingSwap] = useState(null);
  const [claimFeedback, setClaimFeedback] = useState(null);

  // Fetch all open swaps
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['swaps', 'all'],
    queryFn: async () => {
      const res = await api.get('/swaps');
      return res.data;
    },
    refetchInterval: 20_000,
  });

  const swaps = data?.swaps || [];

  // Claim swap mutation
  const claimMutation = useMutation({
    mutationFn: async (swapId) => {
      const res = await api.post(`/swaps/${swapId}/claim`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['swaps'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['signups'] });
      queryClient.invalidateQueries({ queryKey: ['my-shifts'] });
      setClaimFeedback({
        type: 'success',
        title: data.requiresApproval ? 'Claim Submitted for Approval ⏳' : 'Shift Claimed Successfully! 🎉',
        message: data.requiresApproval
          ? 'The event organizer requires approval for shift handovers. Your claim has been sent to their approval queue, and you will receive a notification as soon as it is confirmed.'
          : 'You are now confirmed for this shift! Your new QR check-in pass has been issued in My Shifts.',
        signupId: data.signup?._id,
      });
      setClaimingSwap(null);
    },
    onError: (err) => {
      const message = err.response?.data?.error?.message || err.message || 'Failed to claim shift swap.';
      setClaimFeedback({
        type: 'error',
        title: 'Could Not Claim Shift',
        message,
      });
      setClaimingSwap(null);
    },
  });

  // Filter and sort swaps
  const filteredSwaps = useMemo(() => {
    return swaps
      .filter((s) => {
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const eventTitle = s.event?.title?.toLowerCase() || '';
          const roleName = s.shiftId?.role?.name?.toLowerCase() || '';
          const city = (s.event?.city || s.event?.venue?.city || '').toLowerCase();
          const venue = (s.event?.venue?.name || '').toLowerCase();
          const note = s.note?.toLowerCase() || '';
          if (!eventTitle.includes(q) && !roleName.includes(q) && !city.includes(q) && !venue.includes(q) && !note.includes(q)) {
            return false;
          }
        }

        if (selectedCategory !== 'all' && s.event?.category !== selectedCategory) {
          return false;
        }

        if (onlyEligible && !s.isEligible) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'upcoming') {
          return new Date(a.shiftId?.start || 0) - new Date(b.shiftId?.start || 0);
        }
        if (sortBy === 'highest_pay') {
          const rateA = a.shiftId?.rate || 0;
          const rateB = b.shiftId?.rate || 0;
          return rateB - rateA;
        }
        if (sortBy === 'newest') {
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        }
        return 0;
      });
  }, [swaps, searchTerm, selectedCategory, onlyEligible, sortBy]);

  const eligibleCount = useMemo(() => swaps.filter((s) => s.isEligible && !s.isOfferer).length, [swaps]);

  return (
    <div className="swap-board-page page-container" style={{ maxWidth: '1220px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Neo-Brutalist Theme Hero */}
      <div
        style={{
          background: '#fef08a', // Neo-brutalist yellow
          borderRadius: '22px',
          padding: '2rem 2.25rem',
          border: '2.5px solid #0f172a',
          boxShadow: '6px 6px 0px #0f172a',
          marginBottom: '2rem',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ flex: '1 1 500px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: '#ffffff',
                border: '1.5px solid #0f172a',
                padding: '0.3rem 0.85rem',
                borderRadius: '999px',
                fontSize: '0.76rem',
                fontWeight: 900,
                color: '#0f172a',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                boxShadow: '2px 2px 0px #0f172a',
                marginBottom: '0.85rem',
              }}
            >
              <span>🔄 CREW SHIFT EXCHANGE</span>
            </div>
            <h1
              style={{
                margin: '0 0 0.5rem 0',
                fontSize: 'clamp(2rem, 3.5vw, 2.7rem)',
                fontWeight: 950,
                color: '#0f172a',
                letterSpacing: '-0.02em',
                fontFamily: 'var(--font-display)',
              }}
            >
              Shift Swap Board
            </h1>
            <p style={{ margin: 0, maxWidth: '640px', color: '#334155', fontSize: '1rem', fontWeight: 600, lineHeight: 1.55 }}>
              Hand over shifts to fellow crew members with zero penalty, or pick up open shifts to earn stipends and volunteer hours without waiting for organizer spots to open.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div
              style={{
                background: '#ffffff',
                border: '2px solid #0f172a',
                boxShadow: '3px 3px 0px #0f172a',
                padding: '0.85rem 1.25rem',
                borderRadius: '16px',
                textAlign: 'center',
                minWidth: '110px',
              }}
            >
              <div style={{ fontSize: '1.85rem', fontWeight: 950, color: '#0f172a', lineHeight: 1.1 }}>{swaps.length}</div>
              <div style={{ fontSize: '0.74rem', fontWeight: 900, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.2rem' }}>
                Open Swaps
              </div>
            </div>

            <div
              style={{
                background: '#bbf7d0', // Mint
                border: '2px solid #0f172a',
                boxShadow: '3px 3px 0px #0f172a',
                padding: '0.85rem 1.25rem',
                borderRadius: '16px',
                textAlign: 'center',
                minWidth: '110px',
              }}
            >
              <div style={{ fontSize: '1.85rem', fontWeight: 950, color: '#065f46', lineHeight: 1.1 }}>{eligibleCount}</div>
              <div style={{ fontSize: '0.74rem', fontWeight: 900, color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.2rem' }}>
                Eligible For You
              </div>
            </div>

            <Link
              to="/my-shifts"
              className="btn btn-primary"
              style={{
                background: '#0f172a',
                color: '#ffffff',
                border: '2.5px solid #0f172a',
                padding: '0.85rem 1.35rem',
                borderRadius: '14px',
                fontWeight: 900,
                fontSize: '0.92rem',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '4px 4px 0px #0f172a',
              }}
            >
              <span>Offer One of My Shifts</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Claim Feedback Banner */}
      {claimFeedback && (
        <div
          style={{
            background: claimFeedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
            border: `2.5px solid ${claimFeedback.type === 'success' ? '#047857' : '#dc2626'}`,
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.75rem',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            boxShadow: `4px 4px 0px ${claimFeedback.type === 'success' ? '#047857' : '#dc2626'}`,
          }}
        >
          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>
              {claimFeedback.type === 'success' ? '✅' : '❌'}
            </span>
            <div>
              <strong style={{ display: 'block', fontSize: '1.1rem', fontWeight: 900, color: claimFeedback.type === 'success' ? '#065f46' : '#991b1b', marginBottom: '0.25rem' }}>
                {claimFeedback.title}
              </strong>
              <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: claimFeedback.type === 'success' ? '#047857' : '#b91c1c', lineHeight: 1.5 }}>
                {claimFeedback.message}
              </p>
              {claimFeedback.type === 'success' && (
                <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.75rem' }}>
                  <Link
                    to="/my-shifts"
                    style={{
                      background: '#047857',
                      color: '#ffffff',
                      border: '1.5px solid #0f172a',
                      padding: '0.45rem 0.95rem',
                      fontSize: '0.84rem',
                      borderRadius: '8px',
                      textDecoration: 'none',
                      fontWeight: 800,
                      boxShadow: '2px 2px 0px #0f172a',
                    }}
                  >
                    View in My Shifts →
                  </Link>
                  <button
                    onClick={() => setClaimFeedback(null)}
                    style={{
                      background: '#ffffff',
                      border: '1.5px solid #0f172a',
                      color: '#065f46',
                      padding: '0.45rem 0.95rem',
                      fontSize: '0.84rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 800,
                      boxShadow: '2px 2px 0px #0f172a',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setClaimFeedback(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#475569', fontWeight: 900 }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}

      {/* Neo-Brutalist Filter and Search Bar */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '18px',
          border: '2.5px solid #0f172a',
          padding: '1.15rem 1.35rem',
          marginBottom: '2rem',
          boxShadow: '5px 5px 0px #0f172a',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Search input */}
        <div style={{ position: 'relative', flex: '1 1 280px', minWidth: '240px' }}>
          <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '1rem' }}>
            🔍
          </span>
          <input
            type="text"
            placeholder="Search by event, role name, or city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem 0.65rem 2.6rem',
              borderRadius: '12px',
              border: '2px solid #0f172a',
              fontSize: '0.92rem',
              fontWeight: 700,
              background: '#f8fafc',
              boxShadow: '2px 2px 0px #0f172a',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontWeight: 900 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase' }}>
            Category:
          </label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '12px',
              border: '2px solid #0f172a',
              fontSize: '0.9rem',
              background: '#f8fafc',
              cursor: 'pointer',
              fontWeight: 800,
              boxShadow: '2px 2px 0px #0f172a',
            }}
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORIES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase' }}>
            Sort:
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '12px',
              border: '2px solid #0f172a',
              fontSize: '0.9rem',
              background: '#f8fafc',
              cursor: 'pointer',
              fontWeight: 800,
              boxShadow: '2px 2px 0px #0f172a',
            }}
          >
            <option value="upcoming">Shift Date (Earliest First)</option>
            <option value="highest_pay">Stipend (Highest First)</option>
            <option value="newest">Recently Posted</option>
          </select>
        </div>

        {/* Eligible only toggle */}
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.55rem',
            cursor: 'pointer',
            padding: '0.55rem 0.95rem',
            borderRadius: '999px',
            background: onlyEligible ? '#bbf7d0' : '#ffffff',
            border: '2px solid #0f172a',
            boxShadow: '2px 2px 0px #0f172a',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={onlyEligible}
            onChange={(e) => setOnlyEligible(e.target.checked)}
            style={{ cursor: 'pointer', accentColor: '#0f172a', width: '16px', height: '16px' }}
          />
          <span style={{ fontSize: '0.85rem', fontWeight: 900, color: '#0f172a' }}>
            Eligible for Me Only
          </span>
        </label>
      </div>

      {/* Main Content Grid */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem' }} />
          <p style={{ color: '#0f172a', fontWeight: 800 }}>Loading available shift swaps...</p>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: '#fee2e2', border: '2.5px solid #0f172a', borderRadius: '18px', boxShadow: '4px 4px 0px #0f172a' }}>
          <p style={{ color: '#991b1b', fontWeight: 800, fontSize: '1.1rem', margin: '0 0 1rem' }}>Error loading swap board</p>
          <button onClick={() => refetch()} className="btn btn-primary" style={{ background: '#0f172a', color: '#fff', padding: '0.5rem 1rem', borderRadius: '10px' }}>
            Try Again
          </button>
        </div>
      ) : filteredSwaps.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            background: '#ffffff',
            borderRadius: '20px',
            border: '2.5px dashed #0f172a',
            boxShadow: '4px 4px 0px #0f172a',
          }}
        >
          <span style={{ fontSize: '3.5rem', display: 'block', marginBottom: '1rem' }}>🔄</span>
          <h3 style={{ margin: '0 0 0.5rem', color: '#0f172a', fontSize: '1.4rem', fontWeight: 950 }}>
            {swaps.length === 0 ? 'No shift swaps currently posted' : 'No shift swaps match your filters'}
          </h3>
          <p style={{ margin: '0 0 1.5rem', color: '#475569', maxWidth: '520px', marginInline: 'auto', fontWeight: 600 }}>
            {swaps.length === 0
              ? 'When volunteers are unable to attend their shifts, they post them here on the swap board. Check back soon or offer one of your own shifts!'
              : 'Try clearing your search query or switching off "Eligible for Me Only" to view all available swaps.'}
          </p>
          <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {searchTerm || selectedCategory !== 'all' || onlyEligible ? (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedCategory('all');
                  setOnlyEligible(false);
                }}
                className="btn btn-primary"
                style={{ background: '#0f172a', color: '#fff', border: '2px solid #0f172a', padding: '0.65rem 1.35rem', borderRadius: '12px', fontWeight: 900, boxShadow: '3px 3px 0px #0f172a' }}
              >
                Reset All Filters
              </button>
            ) : null}
            <Link
              to="/events"
              style={{ background: '#fef08a', color: '#0f172a', border: '2px solid #0f172a', padding: '0.65rem 1.35rem', borderRadius: '12px', textDecoration: 'none', fontWeight: 900, boxShadow: '3px 3px 0px #0f172a' }}
            >
              Browse Upcoming Events
            </Link>
          </div>
        </div>
      ) : (
        <div
          className="swaps-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: '1.75rem',
          }}
        >
          {filteredSwaps.map((swap, idx) => {
            const shift = swap.shiftId || {};
            const role = shift.role;
            const event = swap.event || {};
            const isOfferer = swap.isOfferer;
            const isDirectSwap = swap.isDirectSwap;
            const isEligible = swap.isEligible;
            const ineligibilityReason = swap.ineligibilityReason;

            const headerColor = CARD_HEADER_PALETTE[idx % CARD_HEADER_PALETTE.length];

            return (
              <div
                key={swap._id}
                className="swap-card"
                style={{
                  background: '#ffffff',
                  borderRadius: '20px',
                  border: isEligible && !isOfferer ? '2.5px solid #0f172a' : '2px solid #0f172a',
                  boxShadow: isEligible && !isOfferer ? '5px 5px 0px #0f172a' : '3px 3px 0px #0f172a',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                {/* Event Header Banner (ShiftCrew Signature Pastel Stripe) */}
                <div
                  style={{
                    background: headerColor,
                    borderBottom: '2px solid #0f172a',
                    padding: '1.15rem 1.25rem',
                    color: '#0f172a',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', gap: '0.5rem' }}>
                    <span
                      style={{
                        background: '#ffffff',
                        border: '1.5px solid #0f172a',
                        padding: '0.2rem 0.65rem',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: '#0f172a',
                        boxShadow: '1.5px 1.5px 0px #0f172a',
                      }}
                    >
                      {CATEGORIES[event.category] || event.category || 'EVENT'}
                    </span>

                    {(event.city || event.venue?.city) && (
                      <span
                        style={{
                          background: '#ffffff',
                          border: '1.5px solid #0f172a',
                          padding: '0.15rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          color: '#0f172a',
                        }}
                      >
                        📍 {event.city || event.venue?.city}
                      </span>
                    )}
                  </div>

                  <Link
                    to={`/events/${event._id}`}
                    style={{
                      fontSize: '1.2rem',
                      fontWeight: 950,
                      color: '#0f172a',
                      textDecoration: 'none',
                      display: 'block',
                      lineHeight: 1.3,
                      marginBottom: '0.35rem',
                      fontFamily: 'var(--font-display)',
                    }}
                    title="Click to view event details"
                  >
                    {event.title || 'Event Shift'} ↗
                  </Link>

                  <div style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155' }}>
                    📅 {formatRange(event.start || event.startDate, event.end || event.endDate)}
                    {event.venue?.name ? ` • ${event.venue.name}` : ''}
                  </div>
                </div>

                {/* Shift Details Body */}
                <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Role Title & Pay Tag */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.85rem' }}>
                    <div>
                      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 900, color: '#64748b', letterSpacing: '0.05em' }}>
                        ROLE & SHIFT
                      </span>
                      <h4 style={{ margin: '0.15rem 0 0', fontSize: '1.15rem', fontWeight: 950, color: '#0f172a' }}>
                        {role?.name || 'Volunteer Crew'}
                      </h4>
                    </div>

                    <div
                      style={{
                        background: shift.payType && shift.payType !== 'unpaid' ? '#fef08a' : '#f1f5f9',
                        border: '1.5px solid #0f172a',
                        boxShadow: '2px 2px 0px #0f172a',
                        color: '#0f172a',
                        padding: '0.3rem 0.65rem',
                        borderRadius: '8px',
                        fontSize: '0.82rem',
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {payLabel(shift)}
                    </div>
                  </div>

                  {/* Timing Pill Box */}
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1.5px solid #0f172a',
                      borderRadius: '12px',
                      padding: '0.75rem 0.9rem',
                      marginBottom: '1rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                    }}
                  >
                    <span style={{ fontSize: '1.2rem' }}>🕒</span>
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                        {formatShift(shift.start, shift.end)}
                      </div>
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b' }}>
                        Reporting Desk Check-in Required
                      </div>
                    </div>
                  </div>

                  {/* Handover Note & Volunteer Info */}
                  <div
                    style={{
                      background: '#fef9c3', // Soft yellow
                      border: '1.5px solid #0f172a',
                      borderRadius: '12px',
                      padding: '0.75rem 0.9rem',
                      marginBottom: '1.25rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 850, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>👤 Offered by {swap.fromUser?.name || 'A volunteer'}</span>
                        {swap.fromUser?.reliabilityScore !== undefined && (
                          <span style={{ background: '#ffffff', border: '1px solid #0f172a', padding: '0.05rem 0.35rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 900 }}>
                            ⭐ {swap.fromUser.reliabilityScore}
                          </span>
                        )}
                      </span>

                      {isDirectSwap && (
                        <span style={{ background: '#ddd6fe', border: '1px solid #0f172a', color: '#0f172a', fontSize: '0.7rem', fontWeight: 900, padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                          🔒 DIRECT
                        </span>
                      )}
                    </div>

                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#78350f', fontStyle: 'italic', fontWeight: 600, lineHeight: 1.45 }}>
                      "{swap.note || 'Unable to make this shift, offering to any eligible volunteer.'}"
                    </p>
                  </div>

                  {/* Action Area */}
                  <div style={{ marginTop: 'auto' }}>
                    {isOfferer ? (
                      <div style={{ textAlign: 'center', padding: '0.55rem', background: '#f1f5f9', border: '1.5px solid #0f172a', borderRadius: '10px', fontSize: '0.84rem', fontWeight: 800, color: '#475569' }}>
                        <span>This is your offered shift. </span>
                        <Link to="/my-shifts" style={{ color: '#ea580c', fontWeight: 900, textDecoration: 'underline' }}>
                          Manage in My Shifts
                        </Link>
                      </div>
                    ) : isEligible ? (
                      <button
                        onClick={() => setClaimingSwap(swap)}
                        className="btn btn-primary"
                        style={{
                          width: '100%',
                          background: '#bbf7d0', // Mint green action button
                          color: '#0f172a',
                          border: '2px solid #0f172a',
                          padding: '0.75rem',
                          borderRadius: '12px',
                          fontWeight: 950,
                          fontSize: '0.95rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.5rem',
                          boxShadow: '3px 3px 0px #0f172a',
                        }}
                      >
                        <span>Claim Shift Handover</span>
                        <span>🤝</span>
                      </button>
                    ) : (
                      <div
                        style={{
                          background: '#fee2e2',
                          border: '1.5px solid #0f172a',
                          borderRadius: '10px',
                          padding: '0.65rem 0.85rem',
                          fontSize: '0.82rem',
                          color: '#991b1b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                        <span>
                          <strong>Not eligible:</strong> {ineligibilityReason || 'Conflict or direct invitation requirement.'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      {claimingSwap && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '22px',
              border: '3px solid #0f172a',
              boxShadow: '8px 8px 0px #0f172a',
              maxWidth: '520px',
              width: '100%',
              padding: '1.75rem',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 950, color: '#0f172a', fontFamily: 'var(--font-display)' }}>
                🤝 Claim This Shift?
              </h3>
              <button
                onClick={() => setClaimingSwap(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.35rem', color: '#0f172a', fontWeight: 900 }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#fef08a', border: '2px solid #0f172a', borderRadius: '14px', padding: '1rem', marginBottom: '1.25rem', boxShadow: '2px 2px 0px #0f172a' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                {CATEGORIES[claimingSwap.event?.category] || claimingSwap.event?.category || 'EVENT'}
              </div>
              <strong style={{ fontSize: '1.15rem', fontWeight: 950, color: '#0f172a', display: 'block', marginBottom: '0.4rem' }}>
                {claimingSwap.event?.title}
              </strong>
              <div style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 800, marginBottom: '0.2rem' }}>
                Role: {claimingSwap.shiftId?.role?.name || 'Volunteer Crew'}
              </div>
              <div style={{ fontSize: '0.86rem', color: '#334155', fontWeight: 700 }}>
                🕒 {formatShift(claimingSwap.shiftId?.start, claimingSwap.shiftId?.end)}
              </div>
              <div style={{ fontSize: '0.86rem', color: '#065f46', fontWeight: 900, marginTop: '0.35rem' }}>
                Stipend: {payLabel(claimingSwap.shiftId)}
              </div>
            </div>

            <div style={{ background: '#ecfdf5', border: '1.5px solid #0f172a', borderRadius: '12px', padding: '0.85rem', marginBottom: '1.5rem', fontSize: '0.86rem', color: '#065f46', fontWeight: 700, lineHeight: 1.5 }}>
              💡 <strong>Handover Guarantee:</strong> By claiming this shift, you take over the confirmed spot directly from <strong>{claimingSwap.fromUser?.name || 'the volunteer'}</strong> with zero penalty.
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setClaimingSwap(null)}
                disabled={claimMutation.isPending}
                style={{
                  background: '#ffffff',
                  border: '2px solid #0f172a',
                  color: '#0f172a',
                  padding: '0.65rem 1.25rem',
                  borderRadius: '12px',
                  fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '2px 2px 0px #0f172a',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => claimMutation.mutate(claimingSwap._id)}
                disabled={claimMutation.isPending}
                style={{
                  background: '#0f172a',
                  border: '2px solid #0f172a',
                  color: '#ffffff',
                  padding: '0.65rem 1.5rem',
                  borderRadius: '12px',
                  fontWeight: 950,
                  cursor: 'pointer',
                  boxShadow: '3px 3px 0px #0f172a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {claimMutation.isPending ? 'Confirming...' : 'Yes, Claim Shift 🤝'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
