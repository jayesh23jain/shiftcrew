import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Payment, LedgerEntry } from '../../models/Money.js';
import { Signup } from '../../models/Signup.js';
import { Event } from '../../models/Event.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { moneyLimiter } from '../../middleware/limits.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { audit } from '../../utils/audit.js';
import { env } from '../../config/env.js';
import { getWallet, debit, reconcile } from '../../services/wallet.service.js';
import { createFundingOrder, capturePayment, failPayment, verifyCheckoutSignature, verifyWebhookSignature, providerName } from '../../services/payments.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const orgParam = z.object({ orgId: objectId });
const amountSchema = z.object({ amountRupees: z.coerce.number().min(10, 'The minimum is Rs 10').max(500000, 'The maximum is Rs 5,00,000') });

/* ---------------- Razorpay webhook (raw body, signature-verified, idempotent) ---------------- */
export async function razorpayWebhook(req, res) {
  const signature = req.get('x-razorpay-signature');
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json({ error: { message: 'Invalid signature' } });
  }
  try {
    const event = JSON.parse(req.body.toString('utf8'));
    const entity = event?.payload?.payment?.entity;
    if (event.event === 'payment.captured' && entity) {
      await capturePayment({ orderId: entity.order_id, paymentId: entity.id, amount: entity.amount });
    } else if (event.event === 'payment.failed' && entity) {
      await failPayment(entity.order_id, entity.error_description || 'payment failed');
    }
    res.json({ received: true });
  } catch (err) {
    console.error('webhook error', err.message);
    // 500 makes Razorpay retry, which is safe because capture is idempotent.
    res.status(500).json({ error: { message: 'Webhook processing failed' } });
  }
}

router.use(requireAuth);

router.get(
  '/orgs/:orgId',
  validate({ params: orgParam }),
  asyncHandler(async (req, res) => {
    await assertOrgMember(req.params.orgId, req.user);
    const [wallet, ledger, committedSignups] = await Promise.all([
      getWallet(req.params.orgId),
      LedgerEntry.find({ orgId: req.params.orgId }).sort({ createdAt: -1 }).limit(50),
      Signup.find({ orgId: req.params.orgId, status: 'confirmed', settled: false, estPay: { $gt: 0 } }).select('eventId estPay'),
    ]);
    const byEvent = {};
    for (const s of committedSignups) byEvent[String(s.eventId)] = (byEvent[String(s.eventId)] || 0) + s.estPay;
    const events = await Event.find({ _id: { $in: Object.keys(byEvent) } }).select('title');
    const total = Object.values(byEvent).reduce((a, b) => a + b, 0);
    res.json({
      wallet, ledger, provider: providerName(), feePercent: env.PLATFORM_FEE_PERCENT,
      committed: { total, byEvent: events.map((e) => ({ eventId: e._id, title: e.title, amount: byEvent[String(e._id)] })) },
    });
  })
);

router.post(
  '/orgs/:orgId/fund',
  moneyLimiter,
  validate({ params: orgParam, body: amountSchema }),
  asyncHandler(async (req, res) => {
    await assertOrgMember(req.params.orgId, req.user);
    const amount = Math.round(req.valid.body.amountRupees * 100);
    const { payment, keyId } = await createFundingOrder({ orgId: req.params.orgId, userId: req.user.id, amount });
    res.status(201).json({ order: { orderId: payment.orderId, amount: payment.amount, provider: payment.provider, keyId } });
  })
);

// Razorpay checkout callback. The webhook is the source of truth, this just makes the UI update instantly.
router.post(
  '/verify',
  moneyLimiter,
  validate({ body: z.object({ orderId: z.string().max(100), paymentId: z.string().max(100), signature: z.string().max(200) }) }),
  asyncHandler(async (req, res) => {
    const { orderId, paymentId, signature } = req.valid.body;
    const payment = await Payment.findOne({ orderId });
    if (!payment) throw ApiError.notFound('Unknown payment order');
    await assertOrgMember(payment.orgId, req.user);
    if (payment.provider !== 'razorpay' || !verifyCheckoutSignature(orderId, paymentId, signature)) throw ApiError.badRequest('Payment could not be verified');
    const out = await capturePayment({ orderId, paymentId, actor: req.user });
    res.json({ status: out.payment.status, directPayout: out.directPayout, summary: out.summary, statement: out.statement });
  })
);

// Sandbox checkout: runs the same capture logic the real webhook uses.
router.post(
  '/mock-pay',
  moneyLimiter,
  validate({ body: z.object({ orderId: z.string().max(100), outcome: z.enum(['success', 'fail']).default('success') }) }),
  asyncHandler(async (req, res) => {
    if (providerName() !== 'mock') throw ApiError.forbidden('Sandbox checkout is disabled when a real payment provider is configured');
    const payment = await Payment.findOne({ orderId: req.valid.body.orderId, provider: 'mock' });
    if (!payment) throw ApiError.notFound('Unknown payment order');
    await assertOrgMember(payment.orgId, req.user);
    if (req.valid.body.outcome === 'fail') {
      await failPayment(payment.orderId, 'sandbox payment declined');
      return res.json({ status: 'failed' });
    }
    const out = await capturePayment({ orderId: payment.orderId, paymentId: `mock_pay_${crypto.randomBytes(6).toString('hex')}`, actor: req.user });
    res.json({ status: out.payment.status });
  })
);

router.post(
  '/orgs/:orgId/withdraw',
  moneyLimiter,
  validate({ params: orgParam, body: amountSchema }),
  asyncHandler(async (req, res) => {
    await assertOrgMember(req.params.orgId, req.user, ['owner']);
    const amount = Math.round(req.valid.body.amountRupees * 100);
    await debit(req.params.orgId, amount, { key: `withdraw:${crypto.randomUUID()}`, type: 'withdrawal', note: 'Sandbox refund to organizer' });
    await audit(req.user, 'wallet.withdrawn', { entityType: 'Organization', entityId: req.params.orgId, orgId: req.params.orgId, meta: { amount } });
    res.json({ withdrawn: amount, wallet: await getWallet(req.params.orgId) });
  })
);

router.get(
  '/orgs/:orgId/reconcile',
  validate({ params: orgParam }),
  asyncHandler(async (req, res) => {
    await assertOrgMember(req.params.orgId, req.user, ['owner']);
    res.json(await reconcile(req.params.orgId));
  })
);

export default router;
void requireRole;
