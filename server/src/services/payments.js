import crypto from 'crypto';
import { env } from '../config/env.js';
import { Payment } from '../models/Money.js';
import { credit } from './wallet.service.js';
import { ApiError } from '../utils/ApiError.js';
import { safeEqual } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';

export const providerName = () =>
  env.PAYMENT_PROVIDER === 'razorpay' && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'mock';

// Creates a provider order and the matching Payment record.
export async function createFundingOrder({ orgId, userId, amount }) {
  const provider = providerName();
  let orderId;
  if (provider === 'razorpay') {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', receipt: `org_${String(orgId).slice(-8)}_${Date.now()}` }),
    });
    if (!res.ok) throw new ApiError(502, 'Could not start the payment. Please try again.');
    orderId = (await res.json()).id;
  } else {
    orderId = `mock_order_${crypto.randomBytes(8).toString('hex')}`;
  }
  const payment = await Payment.create({ orgId, createdBy: userId, provider, orderId, amount });
  return { payment, keyId: provider === 'razorpay' ? env.RAZORPAY_KEY_ID : undefined };
}

// Checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret)
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature || '');
}

// Webhook signature: HMAC_SHA256(raw body, webhook_secret)
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqual(expected, signature || '');
}

/*
 * The one place a payment becomes money. Called by the webhook, by checkout verification and by the mock
 * checkout. It is idempotent: the ledger key is derived from the payment, so any number of calls credit once.
 */
export async function capturePayment({ orderId, paymentId, amount, actor }) {
  const payment = await Payment.findOne({ orderId });
  if (!payment) throw ApiError.notFound('Unknown payment order');
  if (amount !== undefined && amount !== payment.amount) {
    await Payment.updateOne({ _id: payment._id, status: 'created' }, { $set: { status: 'failed', failureReason: 'amount mismatch' } });
    throw ApiError.badRequest('Payment amount does not match the order');
  }
  const result = await credit(payment.orgId, payment.amount, {
    key: `fund:${payment._id}`, type: 'fund', ref: { paymentId: payment._id }, note: `Wallet top-up (${payment.provider})`,
  });
  await Payment.updateOne({ _id: payment._id, status: 'created' }, { $set: { status: 'captured', paymentId, capturedAt: new Date() } });
  if (result.applied) await audit(actor, 'wallet.funded', { entityType: 'Payment', entityId: payment._id, orgId: payment.orgId, meta: { amount: payment.amount, provider: payment.provider } });
  return { applied: result.applied, payment: await Payment.findById(payment._id) };
}

export async function failPayment(orderId, reason) {
  await Payment.updateOne({ orderId, status: 'created' }, { $set: { status: 'failed', failureReason: reason } });
}
