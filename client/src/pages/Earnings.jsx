import { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { downloadFile, errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDateTime, hoursText, rupees } from '../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../components/ui.jsx';

const STATUS_TONE = { paid: 'good', failed: 'bad', processing: 'warn', queued: 'warn', approved: 'warn' };

const MILESTONE_TIERS = [
  { name: '🌱 Starter Crew', target: 1000, color: '#bbf7d0', perk: 'Eligible for instant UPI payouts' },
  { name: '⭐ Bronze Crew', target: 5000, color: '#fef08a', perk: 'Priority shift access & badge' },
  { name: '💎 Silver Crew', target: 15000, color: '#bae6fd', perk: 'Lead volunteer spot eligibility' },
  { name: '👑 Gold Master Crew', target: 30000, color: '#fbcfe8', perk: 'VIP organizer recommendations' },
];

export default function Earnings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const receiptParam = searchParams.get('receipt');

  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'paid' | 'pending'
  const [searchQuery, setSearchQuery] = useState('');
  const [upi, setUpi] = useState('');
  const [holderName, setHolderName] = useState('');
  const [editing, setEditing] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null); // Receipt preview modal

  // 1. Fetch user earnings and payouts
  const { data, isLoading } = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/payouts/mine')).data,
    refetchInterval: 15_000,
  });

  // Auto-open statement slip if opened via notification link ?receipt=ID
  useEffect(() => {
    if (receiptParam && data?.payouts?.length) {
      const match = data.payouts.find((p) => String(p._id) === String(receiptParam));
      if (match) setSelectedReceipt(match);
    }
  }, [receiptParam, data]);

  // 2. Fetch volunteer stats
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: async () => (await api.get('/me/stats')).data,
  });

  // 3. Fetch UPI payout method
  const { data: method } = useQuery({
    queryKey: ['method'],
    queryFn: async () => (await api.get('/payouts/method')).data.method,
  });

  // 4. Save UPI Mutation
  const saveMethod = useMutation({
    mutationFn: async () => (await api.put('/payouts/method', { upi, holderName })).data,
    onSuccess: () => {
      setUpi('');
      setHolderName('');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['method'] });
    },
  });

  const errors = saveMethod.error ? fieldErrors(saveMethod.error) : {};

  // Milestone Progress Calculation
  const totalPaid = data?.totals?.paid || 0;
  const currentTierIndex = MILESTONE_TIERS.findIndex((t) => totalPaid < t.target);
  const activeMilestone = currentTierIndex !== -1 ? MILESTONE_TIERS[currentTierIndex] : MILESTONE_TIERS[MILESTONE_TIERS.length - 1];
  const prevTarget = currentTierIndex > 0 ? MILESTONE_TIERS[currentTierIndex - 1].target : 0;
  const tierProgress = Math.min(
    100,
    Math.round(((totalPaid - prevTarget) / (activeMilestone.target - prevTarget)) * 100)
  );

  // Combined and filtered transaction records
  const allPayouts = data?.payouts || [];
  const pendingPayouts = data?.pending || [];

  const filteredItems = useMemo(() => {
    let list = [];
    if (activeTab === 'paid') {
      list = allPayouts.filter((p) => p.status === 'paid');
    } else if (activeTab === 'pending') {
      list = pendingPayouts;
    } else {
      list = [...allPayouts, ...pendingPayouts];
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (item) =>
        item.eventTitle?.toLowerCase().includes(q) ||
        item.receiptNo?.toLowerCase().includes(q) ||
        item.upiMasked?.toLowerCase().includes(q)
    );
  }, [activeTab, allPayouts, pendingPayouts, searchQuery]);

  if (isLoading) return <Spinner label="Loading your financial vault & stipends..." />;

  return (
    <div className="organizer-dashboard-wrap" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#166534', marginBottom: '0.5rem', display: 'inline-block' }}>
            💳 FINANCIAL VAULT & STIPENDS
          </span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 950, color: '#0f172a', margin: '0.2rem 0 0' }}>
            Crew Earnings & Payouts
          </h1>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.94rem', color: '#64748b', fontWeight: 650 }}>
            Real-time ledger of approved volunteer stipends, instant UPI disbursement status, and verified payment receipts.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to="/my-shifts" className="btn btn-white" style={{ fontWeight: 850, border: '2px solid #0f172a', borderRadius: '999px', padding: '0.55rem 1.15rem' }}>
            ← Back to My Shifts
          </Link>
          <Link to="/events" className="btn btn-primary" style={{ padding: '0.55rem 1.25rem', fontWeight: 900, borderRadius: '999px' }}>
            🔍 Find High-Stipend Shifts →
          </Link>
        </div>
      </div>

      {/* Top 4 Neo-Brutalist Financial Bento Cards */}
      <div className="dash-stats-grid" style={{ marginBottom: '1.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="dash-stat-card stat-mint">
          <span className="dash-stat-label">Total Paid Out</span>
          <span className="dash-stat-val">{rupees(data?.totals?.paid || 0)}</span>
          <span className="dash-stat-hint">Successfully transferred to your bank account</span>
        </div>

        <div className="dash-stat-card stat-yellow">
          <span className="dash-stat-label">Ready to Be Paid</span>
          <span className="dash-stat-val">{rupees(data?.totals?.pending || 0)}</span>
          <span className="dash-stat-hint">Approved hours waiting for organizer batch release</span>
        </div>

        <div className="dash-stat-card stat-lavender">
          <span className="dash-stat-label">Processing in Bank</span>
          <span className="dash-stat-val">{rupees(data?.totals?.processing || 0)}</span>
          <span className="dash-stat-hint">Queued for instant banking settlement</span>
        </div>

        <div className="dash-stat-card stat-peach">
          <span className="dash-stat-label">Volunteer Service</span>
          <span className="dash-stat-val">{hoursText(stats?.minutes || 0)}</span>
          <span className="dash-stat-hint">{stats?.shifts || 0} shifts across {stats?.events || 0} events</span>
        </div>
      </div>

      {/* Split Grid: UPI Method Card + Milestone Reward Tracker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.35rem', marginBottom: '2rem' }}>
        {/* Card 1: Payout Method (UPI) */}
        <div className="dash-card" style={{ background: '#ffffff', border: '2.5px solid #0f172a', borderRadius: '18px', padding: '1.35rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 950, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🏦 Payout Method (UPI)
            </h2>
            {method && !editing && (
              <span style={{ background: '#bbf7d0', color: '#166534', padding: '2px 8px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 850, border: '1.5px solid #0f172a' }}>
                ✓ Bank Ready
              </span>
            )}
          </div>

          {!method && !editing ? (
            <div style={{ background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: '12px', padding: '1rem', marginTop: '0.5rem' }}>
              <p style={{ margin: '0 0 0.85rem', fontSize: '0.88rem', color: '#92400e', fontWeight: 700, lineHeight: 1.45 }}>
                ⚠️ Action Required: Add your UPI ID to receive payments for completed shifts. Without it, organizers cannot disburse your stipends.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditing(true)}
                style={{ fontWeight: 850, width: '100%', justifyContent: 'center' }}
              >
                + Connect Your UPI ID Now
              </button>
            </div>
          ) : editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveMethod.mutate();
              }}
              style={{ marginTop: '0.5rem' }}
            >
              <Notice>{saveMethod.error && errorMessage(saveMethod.error)}</Notice>

              <Field
                label="UPI ID"
                error={errors.upi}
                hint="Format: mobile@bank or name@okhdfcbank. Tip: ID with 'fail' tests failure mode."
              >
                <input
                  value={upi}
                  onChange={(e) => setUpi(e.target.value)}
                  placeholder="e.g. yourname@oksbi"
                  required
                  style={{ fontWeight: 700, fontFamily: 'monospace' }}
                />
              </Field>

              <div style={{ marginTop: '0.75rem' }}>
                <Field label="Account Holder Name (Optional)" hint="For cross-referencing payment slips">
                  <input
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                  />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: '0.65rem', marginTop: '1rem' }}>
                <button type="submit" className="btn btn-primary" disabled={saveMethod.isPending || !upi.trim()} style={{ fontWeight: 850 }}>
                  {saveMethod.isPending ? 'Saving UPI...' : 'Save & Verify UPI →'}
                </button>
                <button type="button" className="btn btn-white" onClick={() => setEditing(false)} style={{ fontWeight: 750 }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div>
              {/* Virtual Bank Pass Card */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                  borderRadius: '14px',
                  padding: '1.25rem',
                  color: '#ffffff',
                  border: '2px solid #0f172a',
                  boxShadow: '3px 3px 0px #0f172a',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <span style={{ fontSize: '0.75rem', letterSpacing: '1px', fontWeight: 800, color: '#94a3b8' }}>
                    SHIFTCREW DISBURSEMENT LINK
                  </span>
                  <span style={{ fontSize: '1.2rem' }}>⚡ UPI</span>
                </div>

                <div style={{ fontSize: '1.15rem', fontWeight: 850, fontFamily: 'monospace', letterSpacing: '1px', marginBottom: '0.75rem' }}>
                  {method.upiMasked}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #334155', paddingTop: '0.65rem' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Account Name</span>
                    <strong style={{ fontSize: '0.88rem' }}>{method.holderName || user?.name || 'Verified Crew Member'}</strong>
                  </div>
                  <span style={{ fontSize: '0.72rem', background: '#22c55e', color: '#000', padding: '2px 7px', borderRadius: '4px', fontWeight: 850 }}>
                    ACTIVE
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.85rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 650 }}>
                  Stipends are deposited instantly to this account upon release.
                </span>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setEditing(true);
                    setUpi('');
                  }}
                  style={{ fontSize: '0.8rem', fontWeight: 800 }}
                >
                  ✏️ Edit UPI
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Crew Financial Milestones ("Something from our side!") */}
        <div className="dash-card" style={{ background: '#ffffff', border: '2.5px solid #0f172a', borderRadius: '18px', padding: '1.35rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 950, color: '#0f172a' }}>
              🎯 Stipend Milestone Tier
            </h2>
            <span style={{ background: activeMilestone.color, color: '#0f172a', padding: '3px 9px', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 850, border: '1.5px solid #0f172a' }}>
              {activeMilestone.name}
            </span>
          </div>

          <p style={{ margin: '0 0 1rem', fontSize: '0.86rem', color: '#64748b', fontWeight: 600 }}>
            Earn stipends and maintain your reliability score to unlock elite platform perks and lead roles.
          </p>

          {/* Progress Bar */}
          <div style={{ marginBottom: '1.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.35rem' }}>
              <span>Earned: {rupees(totalPaid)}</span>
              <span>Target: {rupees(activeMilestone.target)}</span>
            </div>
            <div style={{ height: '12px', background: '#e2e8f0', borderRadius: '999px', border: '2px solid #0f172a', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${tierProgress}%`,
                  height: '100%',
                  background: activeMilestone.color,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.35rem', textAlign: 'right', fontWeight: 700 }}>
              {rupees(Math.max(0, activeMilestone.target - totalPaid))} to next tier ({tierProgress}% completed)
            </div>
          </div>

          {/* Unlocked Perks List */}
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem', border: '1.5px solid #e2e8f0' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.35rem' }}>
              CURRENT TIER BENEFIT:
            </span>
            <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0f172a' }}>
              🎁 {activeMilestone.perk}
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Ledger Section Header & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Transactions', count: allPayouts.length + pendingPayouts.length },
            { id: 'paid', label: 'Paid & Settled', count: allPayouts.filter((p) => p.status === 'paid').length },
            { id: 'pending', label: 'Waiting for Release', count: pendingPayouts.length },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '999px',
                  fontSize: '0.84rem',
                  fontWeight: 850,
                  cursor: 'pointer',
                  border: '2px solid #0f172a',
                  background: active ? '#0f172a' : '#ffffff',
                  color: active ? '#ffffff' : '#0f172a',
                  boxShadow: active ? '2px 2px 0px #0f172a' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label} ({tab.count})
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div style={{ position: 'relative', minWidth: '240px' }}>
          <input
            type="text"
            placeholder="Search by event or receipt..."
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
      </div>

      {/* Transaction List Table / Bento Cards */}
      {filteredItems.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {filteredItems.map((item) => {
            const isSettledPaid = item.status === 'paid';
            return (
              <div
                key={item._id}
                style={{
                  background: '#ffffff',
                  border: '2px solid #0f172a',
                  borderRadius: '14px',
                  padding: '1rem 1.25rem',
                  boxShadow: '3px 3px 0px #0f172a',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.85rem',
                }}
              >
                {/* Left: Amount & Event Info */}
                <div style={{ minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <strong style={{ fontSize: '1.25rem', color: isSettledPaid ? '#166534' : '#0f172a', fontFamily: 'var(--font-display)', fontWeight: 950 }}>
                      {rupees(item.amount)}
                    </strong>
                    <Pill tone={STATUS_TONE[item.status] || 'neutral'}>
                      {item.status === 'paid'
                        ? 'Paid'
                        : item.status === 'processing'
                        ? 'Processing'
                        : item.status === 'approved'
                        ? 'Approved'
                        : item.status}
                    </Pill>
                  </div>

                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>
                    {item.eventTitle || 'Volunteering Event'}
                  </div>

                  <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, marginTop: '0.2rem' }}>
                    {item.paidAt
                      ? `Disbursed on ${formatDateTime(item.paidAt)}`
                      : item.createdAt
                      ? `Logged on ${formatDateTime(item.createdAt)}`
                      : 'Recorded'}
                    {item.receiptNo ? ` • Receipt #${item.receiptNo}` : ''}
                    {item.minutes ? ` • ${hoursText(item.minutes)} approved` : ''}
                  </div>
                </div>

                {/* Right: Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                  {isSettledPaid ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedReceipt(item)}
                        className="btn btn-white"
                        style={{ padding: '0.42rem 0.85rem', fontSize: '0.8rem', fontWeight: 800, border: '1.5px solid #0f172a' }}
                      >
                        👁️ Receipt Voucher
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadFile(`/payouts/${item._id}/receipt`)}
                        className="btn btn-primary"
                        style={{ padding: '0.42rem 0.85rem', fontSize: '0.8rem', fontWeight: 850 }}
                      >
                        📥 PDF Receipt
                      </button>
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        background: '#fef3c7',
                        color: '#854d0e',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1.2px solid #f59e0b',
                      }}
                    >
                      ⏳ Awaiting Organizer Batch Release
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No payment records found">
          {activeTab === 'paid'
            ? 'No settled payments yet. As soon as event organizers release stipends for your approved hours, they will appear here.'
            : activeTab === 'pending'
            ? 'No pending payouts waiting for release.'
            : 'Complete shifts, record gate attendance, and receive stipends directly to your UPI ID.'}
        </Empty>
      )}

      {/* Interactive In-Browser Receipt Slip Modal ("Something from our side!") */}
      {selectedReceipt && (
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
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '18px',
              border: '3.5px solid #0f172a',
              boxShadow: '8px 8px 0px #0f172a',
              maxWidth: '560px',
              width: '100%',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                background: '#bbf7d0',
                borderBottom: '2.5px solid #0f172a',
                padding: '0.75rem 1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong style={{ fontSize: '0.92rem', color: '#166534', textTransform: 'uppercase' }}>
                ✓ Official Stipend Receipt Slip
              </strong>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.2rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  color: '#0f172a',
                }}
              >
                ✕
              </button>
            </div>

            {/* Receipt Voucher Body */}
            <div style={{ padding: '1.5rem', background: '#f8fafc' }}>
              <div style={{ textAlign: 'center', borderBottom: '2px dashed #cbd5e1', paddingBottom: '1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.74rem', letterSpacing: '2px', fontWeight: 900, color: '#64748b', textTransform: 'uppercase' }}>
                  SHIFTCREW DISBURSEMENT VOUCHER
                </div>
                <div style={{ fontSize: '2.2rem', fontWeight: 950, color: '#166534', fontFamily: 'var(--font-display)', margin: '0.35rem 0' }}>
                  {rupees(selectedReceipt.amount)}
                </div>
                <span style={{ background: '#dcfce7', color: '#14532d', padding: '3px 10px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 850, border: '1.2px solid #86efac' }}>
                  SETTLED & DISBURSED VIA UPI
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontWeight: 650 }}>Event Title:</span>
                  <strong style={{ color: '#0f172a' }}>{selectedReceipt.eventTitle}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontWeight: 650 }}>Receipt Number:</span>
                  <code style={{ fontWeight: 900, color: '#0f172a' }}>{selectedReceipt.receiptNo || 'RCP-VERIFIED'}</code>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b', fontWeight: 650 }}>Disbursement Date:</span>
                  <strong style={{ color: '#0f172a' }}>
                    {selectedReceipt.paidAt ? formatDateTime(selectedReceipt.paidAt) : 'Completed'}
                  </strong>
                </div>

                {selectedReceipt.upiMasked && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b', fontWeight: 650 }}>Target Account:</span>
                    <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>{selectedReceipt.upiMasked}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '0.85rem 1.25rem',
                background: '#ffffff',
                borderTop: '2.5px solid #0f172a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.6rem',
              }}
            >
              <button
                type="button"
                className="btn btn-white"
                onClick={() => setSelectedReceipt(null)}
                style={{ fontWeight: 800 }}
              >
                Close
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-white"
                  onClick={() => window.print()}
                  style={{ fontWeight: 850, border: '2px solid #0f172a' }}
                >
                  🖨️ Print Statement
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => downloadFile(`/payouts/${selectedReceipt._id}/receipt`)}
                  style={{ fontWeight: 900 }}
                >
                  📥 Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
