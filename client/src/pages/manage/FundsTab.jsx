import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { downloadFile, errorMessage } from '../../api/client.js';
import { formatDateTime, hoursText, rupees } from '../../lib.js';
import { Empty, Field, Notice, Pill, Spinner } from '../../components/ui.jsx';

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(window.Razorpay);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
    document.body.appendChild(s);
  });
}

const TOPUP_PRESETS = [500, 1000, 2500, 5000, 10000];

export default function FundsTab({ event }) {
  const qc = useQueryClient();

  // Top-Up State
  const [amount, setAmount] = useState('1000');
  const [showTopUpDrawer, setShowTopUpDrawer] = useState(false);
  const [order, setOrder] = useState(null);
  const [msg, setMsg] = useState(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState(null);
  const [copiedReminderId, setCopiedReminderId] = useState(null);
  const [copiedCsv, setCopiedCsv] = useState(false);

  // Payables & Payouts Filtering & Selection
  const [payableFilter, setPayableFilter] = useState('all'); // 'all' | 'ready' | 'missing_upi'
  const [selectedPayableIds, setSelectedPayableIds] = useState([]);
  const [payoutFilter, setPayoutFilter] = useState('all'); // 'all' | 'paid' | 'processing' | 'failed'
  const [payoutSearch, setPayoutSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState('all'); // 'all' | 'inflow' | 'outflow'

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet', event.orgId],
    queryFn: async () => (await api.get(`/wallet/orgs/${event.orgId}`)).data,
  });

  const { data: pay, isLoading: payLoading } = useQuery({
    queryKey: ['payables', event._id],
    queryFn: async () => (await api.get(`/payouts/events/${event._id}`)).data,
    refetchInterval: 8000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['wallet', event.orgId] });
    qc.invalidateQueries({ queryKey: ['payables', event._id] });
  };

  // Fund Wallet Mutation
  const fund = useMutation({
    mutationFn: async (customAmount) => {
      const topUpVal = customAmount !== undefined ? customAmount : Number(amount);
      return (await api.post(`/wallet/orgs/${event.orgId}/fund`, { amountRupees: topUpVal })).data.order;
    },
    onSuccess: async (o) => {
      if (o.provider === 'mock') {
        setOrder(o);
        setShowTopUpDrawer(true);
        return;
      }
      try {
        const Razorpay = await loadRazorpay();
        new Razorpay({
          key: o.keyId,
          amount: o.amount,
          currency: 'INR',
          order_id: o.orderId,
          name: 'ShiftCrew Wallet Top-Up',
          description: `Disbursement escrow for ${event.title}`,
          handler: async (r) => {
            await api.post('/wallet/verify', {
              orderId: r.razorpay_order_id,
              paymentId: r.razorpay_payment_id,
              signature: r.razorpay_signature,
            });
            setMsg({ ok: true, text: 'Payment received! Wallet successfully topped up.' });
            setShowTopUpDrawer(false);
            refresh();
          },
        }).open();
      } catch (err) {
        setMsg({ ok: false, text: err.message });
      }
    },
  });

  // Mock Sandbox Payment
  const mock = useMutation({
    mutationFn: async (outcome) => (await api.post('/wallet/mock-pay', { orderId: order.orderId, outcome })).data,
    onSuccess: (d) => {
      setOrder(null);
      setShowTopUpDrawer(false);
      setMsg({
        ok: d.status === 'captured',
        text:
          d.status === 'captured'
            ? '✓ Sandbox payment received! Wallet topped up.'
            : 'Sandbox payment declined.',
      });
      refresh();
    },
  });

  // Release Payouts (Supports selective IDs or all)
  const release = useMutation({
    mutationFn: async (payableIds) =>
      (await api.post('/payouts/release', {
        eventId: event._id,
        payableIds: payableIds?.length ? payableIds : undefined,
      })).data,
    onSuccess: (d) => {
      setSelectedPayableIds([]);
      setMsg({
        ok: d.queued > 0,
        text: `${d.queued} payout(s) queued (${rupees(d.totalAmount)} + ${rupees(d.totalFee)} platform fee).`,
        skipped: d.skipped,
      });
      refresh();
    },
  });

  // Withdraw Funds Mutation
  const withdraw = useMutation({
    mutationFn: async (v) =>
      (await api.post(`/wallet/orgs/${event.orgId}/withdraw`, { amountRupees: Number(v) })).data,
    onSuccess: () => {
      setMsg({ ok: true, text: 'Sandbox refund processed. Funds returned.' });
      refresh();
    },
  });

  // Download Receipt PDF
  const handleDownloadReceipt = async (payout) => {
    try {
      setDownloadingReceiptId(payout._id);
      await downloadFile(`/payouts/${payout._id}/receipt`, `${payout.receiptNo || 'Receipt'}.pdf`);
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  // Download Payouts CSV
  const handleDownloadCsv = async () => {
    try {
      setCopiedCsv(true);
      await downloadFile(`/events/${event._id}/report/payouts.csv`, `Payouts_${event.title.replace(/\s+/g, '_')}.csv`);
      setTimeout(() => setCopiedCsv(false), 3000);
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
      setCopiedCsv(false);
    }
  };

  // Copy WhatsApp/SMS reminder for volunteer missing UPI
  const handleCopyUpiReminder = (payable) => {
    const text = `Hi ${payable.volunteer || 'Crew Member'}, please link your UPI ID on ShiftCrew (${window.location.origin}/profile) so we can disburse your stipend of ${rupees(payable.amount)} for ${event.title}! Thank you.`;
    navigator.clipboard.writeText(text);
    setCopiedReminderId(payable._id);
    setTimeout(() => setCopiedReminderId(null), 2500);
  };

  if (walletLoading || payLoading) return <Spinner />;

  // Financial Calculations
  const approved = (pay?.payables || []).filter((p) => p.status === 'approved');
  const approvedTotal = approved.reduce((s, p) => s + p.amount, 0);
  const fee = Math.round((approvedTotal * (wallet?.feePercent || 0)) / 100);
  const totalRequired = approvedTotal + fee;
  const availableBalance = wallet?.wallet?.available || 0;
  const short = totalRequired - availableBalance;

  const readyPayables = approved.filter((p) => p.hasPayoutMethod);
  const missingUpiPayables = approved.filter((p) => !p.hasPayoutMethod);

  // Filtered Payables
  const filteredPayables = approved.filter((p) => {
    if (payableFilter === 'ready') return p.hasPayoutMethod;
    if (payableFilter === 'missing_upi') return !p.hasPayoutMethod;
    return true;
  });

  // Toggle selection
  const toggleSelectPayable = (id) => {
    setSelectedPayableIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllReady = () => {
    const readyIds = readyPayables.map((p) => p._id);
    if (selectedPayableIds.length === readyIds.length) {
      setSelectedPayableIds([]);
    } else {
      setSelectedPayableIds(readyIds);
    }
  };

  // Selected Payables Totals
  const selectedPayables = approved.filter((p) => selectedPayableIds.includes(p._id));
  const selectedTotalAmount = selectedPayables.reduce((s, p) => s + p.amount, 0);
  const selectedFee = Math.round((selectedTotalAmount * (wallet?.feePercent || 0)) / 100);

  // Filtered Payouts
  const allPayouts = (pay?.payouts || []).filter((p) => p.amount > 0);
  const filteredPayouts = allPayouts.filter((p) => {
    if (payoutFilter === 'paid' && p.status !== 'paid') return false;
    if (payoutFilter === 'processing' && p.status !== 'processing' && p.status !== 'queued') return false;
    if (payoutFilter === 'failed' && p.status !== 'failed') return false;
    if (payoutSearch) {
      const q = payoutSearch.toLowerCase();
      const matchName = (p.volunteer || '').toLowerCase().includes(q);
      const matchUpi = (p.upiMasked || '').toLowerCase().includes(q);
      const matchRcpt = (p.receiptNo || '').toLowerCase().includes(q);
      if (!matchName && !matchUpi && !matchRcpt) return false;
    }
    return true;
  });

  // Filtered Ledger Entries
  const ledgerEntries = wallet?.ledger || [];
  const filteredLedger = ledgerEntries.filter((l) => {
    if (ledgerFilter === 'inflow') return l.delta >= 0;
    if (ledgerFilter === 'outflow') return l.delta < 0;
    return true;
  });

  const toneMap = {
    paid: 'good',
    failed: 'bad',
    processing: 'warn',
    queued: 'warn',
  };

  return (
    <div className="funds-manage-wrapper">
      {/* Operations Header */}
      <div className="funds-header-split">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <h2 className="funds-title">
              💰 Funds, Escrow & Crew Payouts
            </h2>
            <span className="funds-provider-badge">
              {wallet?.provider === 'mock' ? '🧪 Sandbox Simulator' : '🟢 Razorpay Escrow'}
            </span>
          </div>
          <p className="funds-subtitle">
            Organization wallet balance is pooled across events. Review approved volunteer hours and release instant UPI stipends.
          </p>
        </div>

        <div className="funds-header-actions">
          {/* Top-up Button */}
          <button
            type="button"
            className="manage-action-btn manage-btn-primary"
            onClick={() => setShowTopUpDrawer(!showTopUpDrawer)}
          >
            ⚡ {showTopUpDrawer ? 'Close Top-Up' : '+ Add Funds / Top Up'}
          </button>

          {/* Export Payouts CSV */}
          {allPayouts.length > 0 && (
            <button
              type="button"
              className="manage-action-btn manage-btn-white"
              onClick={handleDownloadCsv}
              title="Download official payouts CSV report"
            >
              📥 {copiedCsv ? '✓ Exporting CSV...' : 'Export Payouts CSV'}
            </button>
          )}
        </div>
      </div>

      {/* Global Notices & Alerts */}
      {msg && (
        <Notice tone={msg.ok ? 'success' : 'error'}>
          {msg.text}
          {msg.skipped?.length > 0 && (
            <ul className="plain" style={{ marginTop: '0.4rem' }}>
              {msg.skipped.map((s) => (
                <li key={s.userId || s.name}>
                  ⚠️ <strong>{s.name}</strong>: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <Notice>
        {[fund, mock, release, withdraw].map((m) => m.error && errorMessage(m.error)).filter(Boolean)[0]}
      </Notice>

      {/* Escrow Deficit Alert Banner */}
      {short > 0 && (
        <div className="funds-shortfall-banner">
          <div className="funds-shortfall-icon">⚠️</div>
          <div className="funds-shortfall-content">
            <h4 className="funds-shortfall-title">Wallet Balance Shortfall for Approved Payables</h4>
            <p className="funds-shortfall-desc">
              You have <strong>{rupees(approvedTotal)}</strong> in approved volunteer stipends plus a{' '}
              <strong>{wallet.feePercent}% ({rupees(fee)})</strong> platform fee. Your wallet needs{' '}
              <strong style={{ color: '#b91c1c' }}>{rupees(short)} more</strong> before you can release all payouts.
            </p>
          </div>
          <button
            type="button"
            className="funds-shortfall-btn"
            onClick={() => {
              setAmount(String(short));
              setShowTopUpDrawer(true);
            }}
          >
            ⚡ Top Up Exact Shortfall ({rupees(short)})
          </button>
        </div>
      )}

      {/* Future Shift Budget Alert */}
      {wallet?.committed?.total > availableBalance && short <= 0 && (
        <Notice tone="info">
          💡 <strong>Upcoming Shift Budget:</strong> Confirmed volunteers for future shifts are projected to earn{' '}
          <strong>{rupees(wallet.committed.total)}</strong>. Your wallet is currently{' '}
          {rupees(wallet.committed.total - availableBalance)} lower than this commitment. Consider topping up before shifts end.
        </Notice>
      )}

      {/* Financial Health 4-Tile KPI Bento Row */}
      <div className="funds-kpi-row">
        {/* Available Balance */}
        <div className="funds-kpi-card funds-kpi-balance">
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Available in Wallet</span>
            <span className="funds-kpi-chip chip-balance">Live Escrow</span>
          </div>
          <div className="funds-kpi-val" style={{ color: availableBalance >= totalRequired ? '#15803d' : '#b45309' }}>
            {rupees(availableBalance)}
          </div>
          <span className="funds-kpi-hint">
            Org-wide pool • Available for immediate UPI release
          </span>
        </div>

        {/* Approved, Unpaid */}
        <div className="funds-kpi-card">
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Approved & Ready to Pay</span>
            <span className="funds-kpi-chip chip-pending">{approved.length} Pending</span>
          </div>
          <div className="funds-kpi-val" style={{ color: '#0f172a' }}>
            {rupees(approvedTotal)}
          </div>
          <span className="funds-kpi-hint">
            +{rupees(fee)} ({wallet.feePercent}%) platform processing fee
          </span>
        </div>

        {/* Committed to Future Shifts */}
        <div className="funds-kpi-card">
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Committed Shift Budget</span>
            <span className="funds-kpi-chip chip-committed">Projected</span>
          </div>
          <div className="funds-kpi-val" style={{ color: '#475569' }}>
            {rupees(wallet?.committed?.total || 0)}
          </div>
          <span className="funds-kpi-hint">
            Confirmed crew shifts not yet approved
          </span>
        </div>

        {/* Paid Out */}
        <div className="funds-kpi-card">
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Disbursed to Volunteers</span>
            <span className="funds-kpi-chip chip-disbursed">{allPayouts.filter((p) => p.status === 'paid').length} Paid</span>
          </div>
          <div className="funds-kpi-val" style={{ color: '#0f172a' }}>
            {rupees(wallet?.wallet?.totalPaidOut || 0)}
          </div>
          <span className="funds-kpi-hint">
            Successfully delivered to bank accounts
          </span>
        </div>
      </div>

      {/* Top-Up Drawer Card */}
      {showTopUpDrawer && (
        <div className="funds-topup-drawer">
          <div className="funds-topup-header">
            <div>
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: '#0f172a' }}>
                💳 Add Escrow Funds to Organization Wallet
              </strong>
              <span style={{ display: 'block', fontSize: '0.85rem', color: '#475569', fontWeight: 600, marginTop: '2px' }}>
                {wallet?.provider === 'mock'
                  ? 'Sandbox Simulator Active: Test top-ups without real credit cards or bank accounts.'
                  : 'Secured via Razorpay: Funds deposit into your escrow wallet immediately.'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
              onClick={() => {
                setShowTopUpDrawer(false);
                setOrder(null);
              }}
            >
              ✕ Close
            </button>
          </div>

          {/* Preset Amount Chips */}
          <div style={{ marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '0.45rem' }}>
              QUICK SELECT AMOUNT:
            </span>
            <div className="funds-presets-grid">
              {TOPUP_PRESETS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`funds-preset-btn ${Number(amount) === amt ? 'active' : ''}`}
                  onClick={() => setAmount(String(amt))}
                >
                  +{rupees(amt)}
                </button>
              ))}
              {short > 0 && (
                <button
                  type="button"
                  className={`funds-preset-btn ${Number(amount) === short ? 'active' : ''}`}
                  style={{ background: '#fef3c7', borderColor: '#b45309', color: '#92400e' }}
                  onClick={() => setAmount(String(short))}
                >
                  ⚡ Exact Shortfall: {rupees(short)}
                </button>
              )}
            </div>
          </div>

          {/* Sandbox Mock Checkout Simulator */}
          {order ? (
            <div className="sandbox-terminal-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🧪</span>
                <strong style={{ fontSize: '1rem', color: '#1e3a8a' }}>Sandbox Payment Gateway Simulator</strong>
              </div>
              <p style={{ margin: '0 0 0.85rem', fontSize: '0.88rem', color: '#334155' }}>
                Authorize deposit of <strong>{rupees(order.amount)}</strong> (Order ID: <code style={{ background: '#e0e7ff', padding: '1px 5px', borderRadius: '4px' }}>{order.orderId}</code>)
              </p>
              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => mock.mutate('success')}
                  disabled={mock.isPending}
                  style={{ background: '#16a34a', borderColor: '#0f172a' }}
                >
                  {mock.isPending ? 'Processing...' : `✓ Authorize Payment (${rupees(order.amount)})`}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => mock.mutate('fail')}
                  disabled={mock.isPending}
                  style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#0f172a' }}
                >
                  ✕ Simulate Declined Card
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => setOrder(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form
              className="funds-topup-form"
              onSubmit={(e) => {
                e.preventDefault();
                fund.mutate(Number(amount));
              }}
            >
              <Field label="Custom Amount in Rupees (₹)">
                <input
                  type="number"
                  min="10"
                  max="500000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  required
                />
              </Field>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: '0.65rem 1.65rem', fontWeight: 900, alignSelf: 'flex-end', marginBottom: '2px' }}
                disabled={fund.isPending || !amount || Number(amount) < 10}
              >
                {fund.isPending ? 'Creating Order...' : `⚡ Proceed to Deposit ${rupees(Number(amount) || 0)}`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Section: Release Payments & Approved Payables */}
      <div className="funds-section-box">
        <div className="funds-section-head">
          <div>
            <h3 className="funds-section-title">
              👥 Approved Volunteer Stipends Awaiting Payout
            </h3>
            <p className="funds-section-desc">
              Timesheets approved in the <strong>Hours</strong> tab create payables here. Select individual volunteers or release in batch.
            </p>
          </div>

          {/* Batch Release Actions */}
          {approved.length > 0 && (
            <div className="funds-section-actions">
              {/* Release Selected */}
              {selectedPayableIds.length > 0 && (
                <button
                  type="button"
                  className="manage-action-btn manage-btn-primary"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Release payouts for ${selectedPayables.length} selected volunteer(s)? Total: ${rupees(
                          selectedTotalAmount
                        )} + ${rupees(selectedFee)} fee.`
                      )
                    ) {
                      release.mutate(selectedPayableIds);
                    }
                  }}
                  disabled={release.isPending}
                >
                  ⚡ Release Selected ({selectedPayables.length}) — {rupees(selectedTotalAmount)}
                </button>
              )}

              {/* Release All */}
              <button
                type="button"
                className="manage-action-btn manage-btn-primary"
                onClick={() => {
                  if (
                    window.confirm(
                      `Release all ${approved.length} approved payments? Total: ${rupees(
                        approvedTotal
                      )} + ${rupees(fee)} fee.`
                    )
                  ) {
                    release.mutate();
                  }
                }}
                disabled={release.isPending || short > 0}
                title={short > 0 ? `Please top up ${rupees(short)} first` : 'Release all payments'}
              >
                ⚡ Release All ({approved.length}) Payments
              </button>
            </div>
          )}
        </div>

        {/* Filter Toolbar for Payables */}
        {approved.length > 0 && (
          <div className="funds-filter-toolbar">
            <div className="funds-filter-pills">
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginRight: '0.35rem' }}>
                FILTER:
              </span>
              {[
                { id: 'all', label: `All Approved (${approved.length})` },
                { id: 'ready', label: `Ready for UPI 🟢 (${readyPayables.length})` },
                { id: 'missing_upi', label: `Missing UPI ⚠️ (${missingUpiPayables.length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`funds-filter-btn ${payableFilter === tab.id ? 'active' : ''}`}
                  onClick={() => setPayableFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {readyPayables.length > 0 && (
              <button
                type="button"
                className="funds-select-all-btn"
                onClick={handleSelectAllReady}
              >
                {selectedPayableIds.length === readyPayables.length
                  ? 'Deselect All'
                  : `✓ Select All Ready (${readyPayables.length})`}
              </button>
            )}
          </div>
        )}

        {/* Payables Bento Grid */}
        {filteredPayables.length > 0 ? (
          <div className="payables-grid">
            {filteredPayables.map((p) => {
              const volunteerName = p.volunteer || 'Volunteer';
              const initial = volunteerName.charAt(0).toUpperCase();
              const isSelected = selectedPayableIds.includes(p._id);
              const pFee = Math.round((p.amount * (wallet?.feePercent || 0)) / 100);

              return (
                <div
                  key={p._id}
                  className={`payable-card ${isSelected ? 'selected' : ''}`}
                  onClick={(e) => {
                    // Avoid toggle if clicking button
                    if (e.target.closest('button')) return;
                    if (p.hasPayoutMethod) toggleSelectPayable(p._id);
                  }}
                >
                  <div className="payable-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {p.hasPayoutMethod ? (
                        <input
                          type="checkbox"
                          className="payable-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectPayable(p._id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="payable-checkbox-disabled" title="Cannot select: Missing UPI ID">
                          ⚠️
                        </span>
                      )}

                      <div className="payable-avatar">{initial}</div>
                      <div>
                        <strong className="payable-name">{volunteerName}</strong>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 650 }}>
                          ⏱️ {hoursText(p.minutes)} Approved Hours
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div className="payable-amount">{rupees(p.amount)}</div>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                        +{rupees(pFee)} fee
                      </span>
                    </div>
                  </div>

                  {/* Status Banner */}
                  <div className="payable-status-row">
                    {p.hasPayoutMethod ? (
                      <span className="upi-chip upi-chip-verified">
                        🟢 UPI Verified & Ready
                      </span>
                    ) : (
                      <span className="upi-chip upi-chip-missing">
                        ⚠️ No UPI ID Linked Yet
                      </span>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      {!p.hasPayoutMethod && (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          style={{ fontSize: '0.74rem', padding: '2px 8px' }}
                          onClick={() => handleCopyUpiReminder(p)}
                        >
                          {copiedReminderId === p._id ? '✓ Copied Reminder!' : '📋 Copy UPI Reminder'}
                        </button>
                      )}

                      {p.hasPayoutMethod && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: '0.76rem', padding: '3px 10px', fontWeight: 900 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm(
                                `Release ${rupees(p.amount)} stipend directly to ${p.volunteer}?`
                              )
                            ) {
                              release.mutate([p._id]);
                            }
                          }}
                          disabled={release.isPending || availableBalance < p.amount + pFee}
                        >
                          ⚡ Release {rupees(p.amount)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="No Approved Payables Waiting">
            {approved.length === 0
              ? 'Once volunteer timesheets are approved on the Hours tab, their stipends appear here for payout.'
              : 'No payables match your selected filter.'}
          </Empty>
        )}
      </div>

      {/* Section: Payout History & Live Status */}
      {allPayouts.length > 0 && (
        <div className="funds-section-box">
          <div className="funds-section-head">
            <div>
              <h3 className="funds-section-title">
                📈 Payout History & Tax Invoices
              </h3>
              <p className="funds-section-desc">
                Track real-time disbursement status to volunteer bank accounts and download verified PDF receipts.
              </p>
            </div>

            <div className="funds-search-wrap">
              <input
                type="text"
                className="funds-search-input"
                placeholder="🔍 Search volunteer or receipt..."
                value={payoutSearch}
                onChange={(e) => setPayoutSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Filter Pills for Payouts */}
          <div className="funds-filter-toolbar">
            <div className="funds-filter-pills">
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginRight: '0.35rem' }}>
                STATUS:
              </span>
              {[
                { id: 'all', label: `All (${allPayouts.length})` },
                { id: 'paid', label: `Paid 🟢 (${allPayouts.filter((p) => p.status === 'paid').length})` },
                {
                  id: 'processing',
                  label: `Processing ⏳ (${allPayouts.filter((p) => p.status === 'processing' || p.status === 'queued').length})`,
                },
                {
                  id: 'failed',
                  label: `Failed ⚠️ (${allPayouts.filter((p) => p.status === 'failed').length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`funds-filter-btn ${payoutFilter === tab.id ? 'active' : ''}`}
                  onClick={() => setPayoutFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span style={{ fontSize: '0.8rem', fontWeight: 750, color: '#64748b' }}>
              Showing {filteredPayouts.length} of {allPayouts.length}
            </span>
          </div>

          {/* Payouts Bento Cards */}
          {filteredPayouts.length > 0 ? (
            <div className="payouts-history-grid">
              {filteredPayouts.map((p) => {
                const isPaid = p.status === 'paid';
                const isFailed = p.status === 'failed';

                return (
                  <div key={p._id} className="payout-history-card">
                    <div className="payout-history-main">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                          <strong className="payout-volunteer-title">{p.volunteer}</strong>
                          <Pill tone={toneMap[p.status] || 'neutral'}>{p.status.toUpperCase()}</Pill>
                        </div>

                        <div className="payout-meta-line">
                          <span>📅 {formatDateTime(p.paidAt || p.createdAt)}</span>
                          {p.upiMasked && <span>💳 UPI: <code>{p.upiMasked}</code></span>}
                          {p.receiptNo && <span>🧾 {p.receiptNo}</span>}
                        </div>

                        {/* Error & Retry Details */}
                        {isFailed && (
                          <div className="payout-failed-box">
                            ⚠️ <strong>Payment Failed:</strong> {p.failureReason || 'Bank gateway rejected UPI ID.'}
                            <span style={{ display: 'block', fontSize: '0.78rem', color: '#991b1b', marginTop: '2px' }}>
                              Funds were safely refunded to your wallet balance. Release again once volunteer updates UPI.
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="payout-history-amount-block">
                        <span className="payout-history-amount">{rupees(p.amount)}</span>
                        {p.fee > 0 && (
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                            Fee: {rupees(p.fee)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions Row */}
                    <div className="payout-history-actions">
                      <div>
                        {isPaid && (
                          <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 750 }}>
                            ✓ Disbursed & Settled
                          </span>
                        )}
                        {!isPaid && !isFailed && (
                          <span style={{ fontSize: '0.8rem', color: '#854d0e', fontWeight: 750 }}>
                            ⏳ Queued for bank batch processing
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {isPaid && (
                          <button
                            type="button"
                            className="btn btn-white"
                            style={{ fontSize: '0.78rem', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                            onClick={() => handleDownloadReceipt(p)}
                            disabled={downloadingReceiptId === p._id}
                          >
                            📄 {downloadingReceiptId === p._id ? 'Downloading...' : 'PDF Receipt'}
                          </button>
                        )}

                        {isFailed && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                            onClick={() => release.mutate()}
                          >
                            🔄 Retry Release
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ padding: '1rem', textAlign: 'center' }}>
              No payout records match your search or filter.
            </p>
          )}
        </div>
      )}

      {/* Section: Wallet Audit Activity Ledger */}
      <div className="funds-section-box">
        <div className="funds-section-head">
          <div>
            <h3 className="funds-section-title">
              📜 Organization Wallet Ledger & Audit Trail
            </h3>
            <p className="funds-section-desc">
              Immutable ledger of all wallet inflows, escrow claims, fee charges, and disbursements.
            </p>
          </div>

          {availableBalance > 0 && (
            <button
              type="button"
              className="btn btn-quiet"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.85rem' }}
              onClick={() => {
                const v = window.prompt(
                  `Withdraw how many rupees from wallet back to bank? (Current Available: ${rupees(
                    availableBalance
                  )})\nNote: Organization owners only.`
                );
                if (v && Number(v) > 0) withdraw.mutate(v);
              }}
              disabled={withdraw.isPending}
            >
              💸 Withdraw Unused Funds
            </button>
          )}
        </div>

        {/* Ledger Filter Tabs */}
        {ledgerEntries.length > 0 && (
          <div className="funds-filter-toolbar">
            <div className="funds-filter-pills">
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginRight: '0.35rem' }}>
                SHOW:
              </span>
              {[
                { id: 'all', label: `All Transactions (${ledgerEntries.length})` },
                { id: 'inflow', label: `Inflows / Deposits (+)` },
                { id: 'outflow', label: `Outflows / Payouts (-)` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`funds-filter-btn ${ledgerFilter === tab.id ? 'active' : ''}`}
                  onClick={() => setLedgerFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredLedger.length > 0 ? (
          <div className="funds-ledger-list">
            {filteredLedger.slice(0, 20).map((l) => {
              const isInflow = l.delta >= 0;
              const formattedType = l.type.replace(/_/g, ' ').toUpperCase();

              return (
                <div key={l._id} className="funds-ledger-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div className={`ledger-type-icon ${isInflow ? 'inflow' : 'outflow'}`}>
                      {isInflow ? '↓' : '↑'}
                    </div>
                    <div>
                      <strong style={{ fontSize: '0.92rem', color: '#0f172a' }}>
                        {formattedType}
                      </strong>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                        {formatDateTime(l.createdAt)}
                        {l.note ? ` • ${l.note}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className={`funds-ledger-delta ${isInflow ? 'plus' : 'minus'}`}>
                    {isInflow ? '+' : '-'}{rupees(Math.abs(l.delta))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted" style={{ padding: '1rem', textAlign: 'center' }}>
            No wallet activity recorded yet.
          </p>
        )}
      </div>
    </div>
  );
}
