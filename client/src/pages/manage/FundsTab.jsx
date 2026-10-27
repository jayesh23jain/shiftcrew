import { useState } from 'react';
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
    s.onerror = () => reject(new Error('Could not load Razorpay payment gateway script'));
    document.body.appendChild(s);
  });
}

const TOPUP_PRESETS = [500, 1000, 2500, 5000, 10000];

export default function FundsTab({ event }) {
  const qc = useQueryClient();

  // Top-Up & Wallet State
  const [amount, setAmount] = useState('1000');
  const [showTopUpDrawer, setShowTopUpDrawer] = useState(false);
  const [directPayModal, setDirectPayModal] = useState(null); // Confirmation dialog before opening Razorpay
  const [activeStatement, setActiveStatement] = useState(null); // Statement modal shown after successful payout
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

  // 1. DIRECT PAY VIA RAZORPAY (Primary method: pays volunteer directly from bank/card/UPI)
  const directPay = useMutation({
    mutationFn: async (payableIds) =>
      (await api.post('/payouts/direct-order', {
        eventId: event._id,
        payableIds: Array.isArray(payableIds) ? payableIds : [payableIds],
      })).data.order,
    onSuccess: async (o) => {
      setDirectPayModal(null);
      try {
        const Razorpay = await loadRazorpay();
        const rzp = new Razorpay({
          key: o.keyId,
          amount: o.amount,
          currency: 'INR',
          order_id: o.orderId,
          name: 'ShiftCrew Payout Disbursement',
          description: `Direct stipend disbursement for ${o.count} volunteer(s) • ${event.title}`,
          theme: { color: '#0f172a' },
          modal: {
            ondismiss: () => {
              setMsg({ ok: false, text: 'Payment window was closed before completion.' });
            },
          },
          handler: async (r) => {
            try {
              const res = await api.post('/wallet/verify', {
                orderId: r.razorpay_order_id,
                paymentId: r.razorpay_payment_id,
                signature: r.razorpay_signature,
              });

              // Open payment statement page/modal immediately
              if (res.data.statement) {
                setActiveStatement(res.data.statement);
              }

              setMsg({
                ok: true,
                text: `✓ Payment verified via Razorpay! Disbursed ${rupees(o.subtotal)} (+ ${rupees(o.fee)} fee) directly to volunteer account(s). Statement sent to volunteer notification.`,
              });

              setSelectedPayableIds([]);
              refresh();
            } catch (err) {
              setMsg({ ok: false, text: errorMessage(err) });
            }
          },
        });
        rzp.open();
      } catch (err) {
        setMsg({ ok: false, text: err.message });
      }
    },
    onError: (err) => {
      setDirectPayModal(null);
      setMsg({ ok: false, text: errorMessage(err) });
    },
  });

  // 2. FUND WALLET VIA RAZORPAY (Optional escrow top-up)
  const fund = useMutation({
    mutationFn: async (customAmount) => {
      const topUpVal = customAmount !== undefined ? customAmount : Number(amount);
      return (await api.post(`/wallet/orgs/${event.orgId}/fund`, { amountRupees: topUpVal })).data.order;
    },
    onSuccess: async (o) => {
      try {
        const Razorpay = await loadRazorpay();
        const rzp = new Razorpay({
          key: o.keyId,
          amount: o.amount,
          currency: 'INR',
          order_id: o.orderId,
          name: 'ShiftCrew Wallet Top-Up',
          description: `Disbursement escrow deposit for ${event.title}`,
          theme: { color: '#0f172a' },
          modal: {
            ondismiss: () => {
              setMsg({ ok: false, text: 'Top-up checkout was cancelled.' });
            },
          },
          handler: async (r) => {
            await api.post('/wallet/verify', {
              orderId: r.razorpay_order_id,
              paymentId: r.razorpay_payment_id,
              signature: r.razorpay_signature,
            });
            setMsg({ ok: true, text: '✓ Razorpay payment received! Wallet successfully funded.' });
            setShowTopUpDrawer(false);
            refresh();
          },
        });
        rzp.open();
      } catch (err) {
        setMsg({ ok: false, text: err.message });
      }
    },
    onError: (err) => setMsg({ ok: false, text: errorMessage(err) }),
  });

  // 3. RELEASE PAYOUTS FROM WALLET (If organizer has wallet balance)
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
        text: `${d.queued} payout(s) released from wallet (${rupees(d.totalAmount)} + ${rupees(d.totalFee)} platform fee).`,
        skipped: d.skipped,
      });
      refresh();
    },
    onError: (err) => setMsg({ ok: false, text: errorMessage(err) }),
  });

  // 4. WITHDRAW FUNDS (Back to bank)
  const withdraw = useMutation({
    mutationFn: async (v) =>
      (await api.post(`/wallet/orgs/${event.orgId}/withdraw`, { amountRupees: Number(v) })).data,
    onSuccess: () => {
      setMsg({ ok: true, text: 'Withdrawal processed. Funds returned to your bank account.' });
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
    const text = `Hi ${payable.volunteer || 'Crew Member'}, please link your UPI ID on ShiftCrew (${window.location.origin}/earnings) so we can disburse your stipend of ${rupees(payable.amount)} for ${event.title}! Thank you.`;
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
  const selectedTotalRequired = selectedTotalAmount + selectedFee;

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

  // Helper to open confirmation for direct pay
  const initiateDirectPayConfirmation = (items, label) => {
    const validItems = items.filter((p) => p.hasPayoutMethod);
    if (!validItems.length) {
      setMsg({ ok: false, text: 'Selected volunteer(s) have not linked their UPI ID yet.' });
      return;
    }
    const sub = validItems.reduce((s, p) => s + p.amount, 0);
    const f = Math.round((sub * (wallet?.feePercent || 0)) / 100);
    setDirectPayModal({
      title: label,
      items: validItems,
      subtotal: sub,
      fee: f,
      total: sub + f,
      payableIds: validItems.map((p) => p._id),
    });
  };

  return (
    <div className="funds-manage-wrapper">
      {/* Operations Header */}
      <div className="funds-header-split">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <h2 className="funds-title">
              💰 Direct Crew Payouts & Funds
            </h2>
            <span
              className="funds-provider-badge"
              style={{
                background: '#dcfce7',
                borderColor: '#166534',
                color: '#166534',
              }}
            >
              🟢 Razorpay Direct Gateway
            </span>
          </div>
          <p className="funds-subtitle">
            Pay volunteers directly from your account using <strong>UPI, Debit/Credit Card, or Net Banking</strong> via Razorpay. Statements and print receipts are instantly dispatched to volunteers.
          </p>
        </div>

        <div className="funds-header-actions">
          {/* Top-up Button */}
          <button
            type="button"
            className="manage-action-btn manage-btn-white"
            onClick={() => setShowTopUpDrawer(!showTopUpDrawer)}
          >
            ⚡ {showTopUpDrawer ? 'Close Wallet Deposit' : '+ Fund Wallet via Razorpay'}
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
        {[fund, directPay, release, withdraw].map((m) => m.error && errorMessage(m.error)).filter(Boolean)[0]}
      </Notice>

      {/* Financial Health 4-Tile KPI Bento Row */}
      <div className="funds-kpi-row">
        {/* Approved, Unpaid */}
        <div className="funds-kpi-card" style={{ background: '#eff6ff', borderColor: '#2563eb' }}>
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Ready for Direct Payout</span>
            <span className="funds-kpi-chip" style={{ background: '#2563eb', color: '#ffffff', borderColor: '#1e40af' }}>
              {readyPayables.length} Ready
            </span>
          </div>
          <div className="funds-kpi-val" style={{ color: '#1e3a8a' }}>
            {rupees(approvedTotal)}
          </div>
          <span className="funds-kpi-hint">
            +{rupees(fee)} ({wallet?.feePercent || 0}%) platform processing fee
          </span>
        </div>

        {/* Available Balance */}
        <div className="funds-kpi-card funds-kpi-balance">
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Wallet Balance</span>
            <span className="funds-kpi-chip chip-balance">Pre-Funded</span>
          </div>
          <div className="funds-kpi-val" style={{ color: '#15803d' }}>
            {rupees(availableBalance)}
          </div>
          <span className="funds-kpi-hint">
            Optional escrow balance pool
          </span>
        </div>

        {/* Committed to Future Shifts */}
        <div className="funds-kpi-card">
          <div className="funds-kpi-top">
            <span className="funds-kpi-label">Upcoming Shift Budget</span>
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
            <span className="funds-kpi-label">Total Disbursed</span>
            <span className="funds-kpi-chip chip-disbursed">{allPayouts.filter((p) => p.status === 'paid').length} Paid</span>
          </div>
          <div className="funds-kpi-val" style={{ color: '#0f172a' }}>
            {rupees(wallet?.wallet?.totalPaidOut || 0)}
          </div>
          <span className="funds-kpi-hint">
            Successfully delivered to bank accounts via UPI
          </span>
        </div>
      </div>

      {/* Official Payment Statement & Settlement Modal */}
      {activeStatement && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
          }}
          onClick={() => setActiveStatement(null)}
        >
          <div
            className="printable-statement"
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '3.5px solid #0f172a',
              boxShadow: '8px 8px 0px #0f172a',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '2rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Statement Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2.5px solid #0f172a', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.74rem', letterSpacing: '1.5px', fontWeight: 900, color: '#16a34a', textTransform: 'uppercase' }}>
                  ✓ DISBURSEMENT SETTLED VIA RAZORPAY
                </span>
                <h2 style={{ margin: '0.25rem 0', fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: '#0f172a', fontWeight: 950 }}>
                  Official Payout Statement
                </h2>
                <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 650 }}>
                  Event: <strong>{activeStatement.eventTitle}</strong> • Org: <strong>{activeStatement.orgName}</strong>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-quiet no-print"
                onClick={() => setActiveStatement(null)}
                style={{ fontSize: '1.2rem', padding: '0 0.5rem' }}
              >
                ✕
              </button>
            </div>

            {/* Key Meta Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', background: '#f8fafc', border: '1.8px solid #cbd5e1', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Payment Reference</span>
                <code style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a' }}>{activeStatement.paymentId}</code>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Order ID</span>
                <code style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a' }}>{activeStatement.orderId}</code>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Settled Timestamp</span>
                <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{formatDateTime(activeStatement.paidAt)}</strong>
              </div>
            </div>

            {/* Itemized Volunteers Table */}
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 900, color: '#0f172a' }}>
              Volunteer Stipend Recipients ({activeStatement.volunteers?.length || 0})
            </h4>
            <div style={{ border: '2px solid #0f172a', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1.5px solid #0f172a', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 900 }}>Volunteer</th>
                    <th style={{ padding: '8px 12px', fontWeight: 900 }}>UPI Destination</th>
                    <th style={{ padding: '8px 12px', fontWeight: 900 }}>Receipt #</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 900 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeStatement.volunteers || []).map((v, idx) => (
                    <tr key={idx} style={{ borderBottom: idx !== activeStatement.volunteers.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 800, color: '#0f172a' }}>
                        {v.name}
                        {v.email && <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>{v.email}</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{v.upiMasked}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>{v.receiptNo || 'RCPT-SETTLED'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: '#16a34a' }}>
                        {rupees(v.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary Box */}
            <div style={{ background: '#f8fafc', border: '2px solid #0f172a', borderRadius: '12px', padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.45rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Subtotal (Stipends Disbursed):</span>
                <strong style={{ color: '#0f172a' }}>{rupees(activeStatement.subtotal)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
                <span style={{ color: '#64748b', fontWeight: 700 }}>Platform Processing Fee:</span>
                <strong style={{ color: '#0f172a' }}>+{rupees(activeStatement.fee)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.65rem', fontSize: '1.2rem', fontWeight: 950 }}>
                <span style={{ color: '#0f172a' }}>Total Debited from Account:</span>
                <span style={{ color: '#16a34a' }}>{rupees(activeStatement.totalAmount)}</span>
              </div>
            </div>

            {/* Notification Dispatch Banner */}
            <div style={{ background: '#ecfdf5', border: '1.5px solid #10b981', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📨</span>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#065f46', fontWeight: 700 }}>
                Volunteers have been automatically notified with their individualized payment voucher and statement download links.
              </p>
            </div>

            {/* Actions Toolbar */}
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-white"
                onClick={() => setActiveStatement(null)}
                style={{ fontWeight: 800 }}
              >
                ✓ Done / Close
              </button>

              <div style={{ display: 'flex', gap: '0.65rem' }}>
                <button
                  type="button"
                  className="btn btn-white"
                  onClick={() => window.print()}
                  style={{ fontWeight: 900, border: '2px solid #0f172a' }}
                >
                  🖨️ Print Statement
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    window.print();
                  }}
                  style={{ fontWeight: 900 }}
                >
                  📄 Save / Print PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Direct Pay Confirmation Modal */}
      {directPayModal && (
        <div className="funds-direct-drawer">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: '#0f172a', fontWeight: 950 }}>
                💳 {directPayModal.title} via Razorpay
              </h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                Razorpay Checkout will open allowing you to choose <strong>UPI, Debit/Credit Card, or Net Banking</strong>. Upon payment, stipends disburse instantly to crew members.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setDirectPayModal(null)}
              style={{ fontSize: '0.85rem' }}
            >
              ✕ Cancel
            </button>
          </div>

          <div style={{ background: '#ffffff', border: '2px solid #0f172a', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.45rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
              <span style={{ color: '#64748b', fontWeight: 700 }}>Recipient Volunteers ({directPayModal.items.length}):</span>
              <strong style={{ color: '#0f172a' }}>{directPayModal.items.map((i) => i.volunteer).join(', ')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
              <span style={{ color: '#64748b', fontWeight: 700 }}>Volunteer Stipends:</span>
              <strong style={{ color: '#0f172a' }}>{rupees(directPayModal.subtotal)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
              <span style={{ color: '#64748b', fontWeight: 700 }}>Platform Fee ({wallet?.feePercent || 0}%):</span>
              <strong style={{ color: '#0f172a' }}>+{rupees(directPayModal.fee)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.65rem', fontSize: '1.15rem', fontWeight: 950 }}>
              <span style={{ color: '#0f172a' }}>Total to Pay via Razorpay:</span>
              <span style={{ color: '#16a34a' }}>{rupees(directPayModal.total)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-white"
              onClick={() => setDirectPayModal(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: '#0f172a', color: '#ffffff', fontWeight: 900, padding: '0.65rem 1.45rem' }}
              onClick={() => directPay.mutate(directPayModal.payableIds)}
              disabled={directPay.isPending}
            >
              {directPay.isPending ? 'Connecting Razorpay...' : `💳 Pay ${rupees(directPayModal.total)} (UPI/Card/Bank) →`}
            </button>
          </div>
        </div>
      )}

      {/* Top-Up Drawer Card (Wallet Deposit via Razorpay) */}
      {showTopUpDrawer && (
        <div className="funds-topup-drawer">
          <div className="funds-topup-header">
            <div>
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: '#0f172a' }}>
                💳 Add Escrow Funds to Organization Wallet
              </strong>
              <span style={{ display: 'block', fontSize: '0.85rem', color: '#475569', fontWeight: 600, marginTop: '2px' }}>
                Secured via Razorpay: Funds deposit into your escrow wallet immediately.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
              onClick={() => setShowTopUpDrawer(false)}
            >
              ✕ Close
            </button>
          </div>

          {/* Preset Amount Chips */}
          <div style={{ marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '0.45rem' }}>
              SELECT PRESET AMOUNT:
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
              {fund.isPending ? 'Connecting Razorpay...' : `⚡ Top Up ${rupees(Number(amount) || 0)} via Razorpay`}
            </button>
          </form>
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
              Approved hours create payables here. Pay directly via <strong>Razorpay (Bank Transfer, UPI, or Card)</strong>, or disburse from existing wallet funds.
            </p>
          </div>

          {/* Batch Actions */}
          {approved.length > 0 && (
            <div className="funds-section-actions">
              {/* If items selected */}
              {selectedPayableIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="manage-action-btn manage-btn-direct"
                    onClick={() => initiateDirectPayConfirmation(selectedPayables, `Direct Pay Selected (${selectedPayables.length})`)}
                  >
                    💳 Pay Selected via Razorpay ({rupees(selectedTotalRequired)})
                  </button>

                  {availableBalance >= selectedTotalRequired && (
                    <button
                      type="button"
                      className="manage-action-btn manage-btn-white"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Release payouts for ${selectedPayables.length} selected volunteer(s) from wallet? Total: ${rupees(
                              selectedTotalAmount
                            )} + ${rupees(selectedFee)} fee.`
                          )
                        ) {
                          release.mutate(selectedPayableIds);
                        }
                      }}
                      disabled={release.isPending}
                    >
                      ⚡ Release from Wallet
                    </button>
                  )}
                </>
              ) : (
                <>
                  {/* Direct Pay All via Razorpay (Primary) */}
                  {readyPayables.length > 0 && (
                    <button
                      type="button"
                      className="manage-action-btn manage-btn-direct"
                      onClick={() => initiateDirectPayConfirmation(readyPayables, `Direct Pay All Ready (${readyPayables.length})`)}
                    >
                      💳 Pay All Ready via Razorpay ({readyPayables.length})
                    </button>
                  )}

                  {/* Release All from Wallet (If funds exist) */}
                  {availableBalance >= totalRequired && (
                    <button
                      type="button"
                      className="manage-action-btn manage-btn-white"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Release all ${approved.length} approved payments from wallet? Total: ${rupees(
                              approvedTotal
                            )} + ${rupees(fee)} fee.`
                          )
                        ) {
                          release.mutate();
                        }
                      }}
                      disabled={release.isPending}
                    >
                      ⚡ Release All from Wallet
                    </button>
                  )}
                </>
              )}
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
              const pTotal = p.amount + pFee;
              const canPayFromWallet = availableBalance >= pTotal;

              return (
                <div
                  key={p._id}
                  className={`payable-card ${isSelected ? 'selected' : ''}`}
                  onClick={(e) => {
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
                        +{rupees(pFee)} fee ({rupees(pTotal)})
                      </span>
                    </div>
                  </div>

                  {/* Status & Actions Banner */}
                  <div className="payable-status-row">
                    {p.hasPayoutMethod ? (
                      <span className="upi-chip upi-chip-verified">
                        🟢 UPI Linked & Ready
                      </span>
                    ) : (
                      <span className="upi-chip upi-chip-missing">
                        ⚠️ No UPI ID Linked Yet
                      </span>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
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
                        <>
                          {/* Option 1: Direct Pay from Account via Razorpay (Primary) */}
                          <button
                            type="button"
                            className="btn btn-direct-pay"
                            style={{ fontSize: '0.75rem', padding: '3px 10px', fontWeight: 900 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              initiateDirectPayConfirmation([p], `Direct Pay ${volunteerName}`);
                            }}
                            disabled={directPay.isPending}
                            title="Pay directly from bank account / card / UPI via Razorpay"
                          >
                            💳 Pay via Razorpay ({rupees(pTotal)})
                          </button>

                          {/* Option 2: Wallet Release (if funds available) */}
                          {canPayFromWallet && (
                            <button
                              type="button"
                              className="btn btn-white"
                              style={{
                                fontSize: '0.74rem',
                                padding: '3px 8px',
                                fontWeight: 800,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Release ${rupees(p.amount)} stipend from wallet to ${p.volunteer}?`)) {
                                  release.mutate([p._id]);
                                }
                              }}
                              disabled={release.isPending}
                              title="Pay using available wallet funds"
                            >
                              ⚡ Wallet
                            </button>
                          )}
                        </>
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
                📈 Payout History & Statements
              </h3>
              <p className="funds-section-desc">
                Track real-time disbursement status to volunteer bank accounts and view official statements and PDF receipts.
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

                        {/* Error Details */}
                        {isFailed && (
                          <div className="payout-failed-box">
                            ⚠️ <strong>Payment Failed:</strong> {p.failureReason || 'Bank gateway rejected UPI ID.'}
                            <span style={{ display: 'block', fontSize: '0.78rem', color: '#991b1b', marginTop: '2px' }}>
                              Funds were refunded to your wallet balance. Release again once volunteer updates UPI.
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
                          <>
                            <button
                              type="button"
                              className="btn btn-white"
                              style={{ fontSize: '0.78rem', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              onClick={() => {
                                setActiveStatement({
                                  paymentId: p.providerRef || 'RZP-DISBURSE',
                                  orderId: p.receiptNo || 'STMT-SETTLED',
                                  paidAt: p.paidAt || p.createdAt,
                                  eventTitle: event.title,
                                  orgName: wallet?.orgName || 'ShiftCrew Organization',
                                  receiptNo: p.receiptNo,
                                  subtotal: p.amount,
                                  fee: p.fee || 0,
                                  totalAmount: p.amount + (p.fee || 0),
                                  volunteers: [
                                    {
                                      name: p.volunteer,
                                      amount: p.amount,
                                      fee: p.fee || 0,
                                      upiMasked: p.upiMasked,
                                      receiptNo: p.receiptNo,
                                      status: p.status,
                                    },
                                  ],
                                });
                              }}
                            >
                              🖨️ View Statement
                            </button>
                            <button
                              type="button"
                              className="btn btn-white"
                              style={{ fontSize: '0.78rem', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              onClick={() => handleDownloadReceipt(p)}
                              disabled={downloadingReceiptId === p._id}
                            >
                              📄 {downloadingReceiptId === p._id ? 'Downloading...' : 'PDF Receipt'}
                            </button>
                          </>
                        )}

                        {isFailed && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                            onClick={() => directPay.mutate([p.payableIds?.[0] || p._id])}
                          >
                            🔄 Retry Pay via Razorpay
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
              📜 Ledger & Audit Trail
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
