import crypto from 'crypto';
import { env } from '../config/env.js';
import { Payment, Payout } from '../models/Money.js';
import { Event } from '../models/Event.js';
import { Organization } from '../models/Organization.js';
import { credit } from './wallet.service.js';
import { ApiError } from '../utils/ApiError.js';
import { safeEqual } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';

export const providerName = () =>
  env.PAYMENT_PROVIDER === 'razorpay' && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'mock';

// Creates a Razorpay order (or mock order) and the matching Payment record.
export async function createFundingOrder({ orgId, userId, amount, purpose = 'fund', meta = {}, notes = {} }) {
  const provider = providerName();
  let orderId;

  if (provider === 'razorpay') {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new ApiError(400, 'Razorpay keys not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env.');
    }

    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const receipt = `org_${String(orgId).slice(-6)}_${Date.now().toString().slice(-8)}`;

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt,
        notes: {
          purpose,
          orgId: String(orgId),
          userId: String(userId),
          ...notes,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Razorpay order creation error:', res.status, errText);
      throw new ApiError(502, `Razorpay could not create the order (${res.status}). Verify your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env.`);
    }

    const orderData = await res.json();
    orderId = orderData.id;
  } else {
    orderId = `mock_order_${crypto.randomBytes(8).toString('hex')}`;
  }

  const payment = await Payment.create({
    orgId,
    createdBy: userId,
    provider,
    orderId,
    amount,
    purpose,
    meta,
  });

  return { payment, keyId: provider === 'razorpay' ? env.RAZORPAY_KEY_ID : undefined };
}

// Checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret)
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature || '');
}

// Webhook signature: HMAC_SHA256(raw body, webhook_secret)
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqual(expected, signature || '');
}

/*
 * Capture payment and trigger immediate volunteer payout and statement generation.
 */
export async function capturePayment({ orderId, paymentId, amount, actor }) {
  const payment = await Payment.findOne({ orderId });
  if (!payment) throw ApiError.notFound('Unknown payment order');
  if (amount !== undefined && amount !== payment.amount) {
    await Payment.updateOne({ _id: payment._id, status: 'created' }, { $set: { status: 'failed', failureReason: 'amount mismatch' } });
    throw ApiError.badRequest('Payment amount does not match the order');
  }

  const isDirectPayout = payment.purpose === 'direct_payout';
  const note = isDirectPayout
    ? 'Direct Volunteer Payout via Razorpay'
    : 'Wallet Top-Up via Razorpay';

  const result = await credit(payment.orgId, payment.amount, {
    key: `fund:${payment._id}`,
    type: 'fund',
    ref: { paymentId: payment._id },
    note,
  });

  await Payment.updateOne(
    { _id: payment._id, status: 'created' },
    { $set: { status: 'captured', paymentId, capturedAt: new Date() } }
  );

  let directSummary = null;
  let statement = null;

  if (isDirectPayout && payment.meta?.eventId) {
    try {
      const { releasePayouts, processQueuedPayouts } = await import('./payouts.service.js');
      directSummary = await releasePayouts({
        eventId: payment.meta.eventId,
        orgId: payment.orgId,
        actor: actor || { id: payment.createdBy },
        payableIds: payment.meta.payableIds,
      });

      // Synchronously process payouts so the statement has confirmed receipt numbers
      await processQueuedPayouts(50);

      const [event, org, payouts] = await Promise.all([
        Event.findById(payment.meta.eventId).select('title'),
        Organization.findById(payment.orgId).select('name'),
        Payout.find({
          orgId: payment.orgId,
          eventId: payment.meta.eventId,
          createdAt: { $gte: new Date(Date.now() - 120000) },
        }).populate('userId', 'name email'),
      ]);

      const subtotal = payouts.reduce((s, p) => s + p.amount, 0);
      const fee = payouts.reduce((s, p) => s + (p.fee || 0), 0);

      statement = {
        paymentId,
        orderId,
        paidAt: new Date(),
        eventTitle: event?.title || 'Crew Event Operations',
        orgName: org?.name || 'ShiftCrew Organization',
        receiptNo: payouts[0]?.receiptNo || `STMT-${Date.now().toString().slice(-6)}`,
        subtotal: subtotal || payment.amount,
        fee,
        totalAmount: payment.amount,
        volunteers: payouts.map((p) => ({
          name: p.userId?.name || 'Volunteer Crew',
          email: p.userId?.email || '',
          amount: p.amount,
          fee: p.fee || 0,
          upiMasked: p.upiMasked,
          receiptNo: p.receiptNo,
          status: p.status,
          paidAt: p.paidAt,
        })),
      };
    } catch (err) {
      console.error('Direct payout disbursement execution error:', err);
    }
  }

  if (result.applied) {
    await audit(actor || { id: payment.createdBy }, isDirectPayout ? 'payout.direct_paid' : 'wallet.funded', {
      entityType: 'Payment',
      entityId: payment._id,
      orgId: payment.orgId,
      meta: { amount: payment.amount, provider: 'razorpay', directPayout: isDirectPayout, summary: directSummary },
    });
  }

  return {
    applied: result.applied,
    payment: await Payment.findById(payment._id),
    directPayout: isDirectPayout,
    summary: directSummary,
    statement,
  };
}

export async function failPayment(orderId, reason) {
  await Payment.updateOne({ orderId, status: 'created' }, { $set: { status: 'failed', failureReason: reason } });
}
