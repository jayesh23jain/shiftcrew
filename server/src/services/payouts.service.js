import crypto from 'crypto';
import { Payable, Payout, PayoutMethod } from '../models/Money.js';
import { Signup } from '../models/Signup.js';
import { Organization } from '../models/Organization.js';
import { Event } from '../models/Event.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { credit, debit } from './wallet.service.js';
import { decrypt } from '../utils/crypto.js';
import { feeFor, rupees, payForMinutes } from '../utils/money.js';
import { ApiError } from '../utils/ApiError.js';
import { audit } from '../utils/audit.js';
import { notify } from './notify.js';

/*
 * Payout provider. The sandbox provider below simulates a bank transfer so the whole flow is demonstrable.
 * To go live, implement send() against RazorpayX (or another payout API) and return the same shape.
 * Demo trick: a UPI id that contains "fail" is rejected, so you can show the failure and retry path.
 */
export const payoutProvider = {
  name: 'razorpay',
  async send({ upi, amount }) {
    await new Promise((r) => setTimeout(r, 150));
    if (/fail/i.test(upi)) return { ok: false, error: 'The bank rejected this UPI id' };
    return { ok: true, ref: `rzp_pout_${crypto.randomBytes(6).toString('hex')}`, amount };
  },
};

const receiptNo = () => `RCPT-${new Date().toISOString().slice(0, 7).replace('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Turns approved payables into queued payouts, one per volunteer, and takes the money from the wallet.
 * Safe against double clicks: payables are claimed atomically (approved -> processing) before any money moves.
 */
export async function releasePayouts({ eventId, orgId, actor, payableIds }) {
  const filter = { eventId, orgId, status: 'approved' };
  if (payableIds?.length) filter._id = { $in: payableIds };
  const candidates = await Payable.find(filter);
  const byUser = new Map();
  for (const p of candidates) byUser.set(String(p.userId), [...(byUser.get(String(p.userId)) || []), p]);

  const summary = { queued: 0, totalAmount: 0, totalFee: 0, skipped: [] };

  for (const [userId, items] of byUser) {
    const user = await User.findById(userId).select('name');
    const method = await PayoutMethod.findOne({ userId, verified: true });
    if (!method) { summary.skipped.push({ userId, name: user?.name, reason: 'No payout method added yet' }); continue; }

    const payout = await Payout.create({
      orgId, eventId, userId, amount: 0, fee: 0, status: 'queued', requestedBy: actor.id, upiMasked: method.upiMasked, payableIds: [],
    });
    // Claim each payable with an atomic conditional update (approved -> processing). Only one of two
    // parallel releases can win any given payable, so nothing is ever paid twice.
    const claimed = [];
    for (const item of items) {
      const won = await Payable.findOneAndUpdate({ _id: item._id, status: 'approved' }, { $set: { status: 'processing', payoutId: payout._id } }, { new: true });
      if (won) claimed.push(won);
    }
    if (!claimed.length) { await Payout.deleteOne({ _id: payout._id }); continue; }

    const amount = claimed.reduce((s, p) => s + p.amount, 0);
    const fee = feeFor(amount, env.PLATFORM_FEE_PERCENT);
    const revert = async (reason) => {
      await Payable.updateMany({ payoutId: payout._id }, { $set: { status: 'approved' }, $unset: { payoutId: 1 } });
      await Payout.updateOne({ _id: payout._id }, { $set: { status: 'failed', failureReason: reason } });
    };

    try {
      await debit(orgId, amount, { key: `payout:${payout._id}`, type: 'payout', ref: { eventId, payoutId: payout._id, userId } });
      if (fee > 0) {
        try {
          await debit(orgId, fee, { key: `fee:${payout._id}`, type: 'fee', ref: { eventId, payoutId: payout._id } });
        } catch (err) {
          await credit(orgId, amount, { key: `payout-undo:${payout._id}`, type: 'payout_reversal', ref: { payoutId: payout._id }, note: 'Fee could not be covered' });
          throw err;
        }
      }
    } catch (err) {
      await revert(err.message);
      summary.skipped.push({ userId, name: user?.name, reason: err.status === 402 ? 'Not enough funds in the wallet' : err.message });
      continue;
    }

    await Payout.updateOne({ _id: payout._id }, { $set: { amount, fee, payableIds: claimed.map((c) => c._id) } });
    summary.queued += 1; summary.totalAmount += amount; summary.totalFee += fee;
  }

  await audit(actor, 'payout.released', { entityType: 'Event', entityId: eventId, orgId, eventId, meta: summary });
  setImmediate(() => processQueuedPayouts().catch((e) => console.error('payout worker', e)));
  return summary;
}

// Worker: claims queued payouts one at a time and sends them. Multiple instances are safe.
export async function processQueuedPayouts(limit = 25) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const payout = await Payout.findOneAndUpdate({ status: 'queued', amount: { $gt: 0 } }, { $set: { status: 'processing' } }, { new: true, sort: { createdAt: 1 } });
    if (!payout) break;
    await settlePayout(payout);
    processed += 1;
  }
  return processed;
}

async function settlePayout(payout) {
  const event = await Event.findById(payout.eventId).select('title');
  try {
    const method = await PayoutMethod.findOne({ userId: payout.userId });
    if (!method) throw new Error('Payout method removed');
    const result = await payoutProvider.send({ upi: decrypt(method.upiEnc), amount: payout.amount, reference: String(payout._id) });
    if (!result.ok) throw new Error(result.error);

    const receipt = receiptNo();
    await Payout.updateOne({ _id: payout._id }, { $set: { status: 'paid', providerRef: result.ref, receiptNo: receipt, paidAt: new Date() } });
    await Payable.updateMany({ payoutId: payout._id }, { $set: { status: 'paid' } });
    await notify(payout.userId, {
      type: 'payout_paid',
      title: `🎉 Stipend Paid: ${rupees(payout.amount)}`,
      body: `Your payment statement is ready! An instant stipend of ${rupees(payout.amount)} was transferred to your UPI (${payout.upiMasked}) for ${event?.title || 'an event'}. Statement #${receipt}. Click here to view and print your verified receipt slip.`,
      link: `/earnings?receipt=${payout._id}`,
      email: true,
    });
  } catch (err) {
    // Failure: give the organizer their money back and reopen the payables so the payout can be retried.
    await credit(payout.orgId, payout.amount, { key: `payout-fail:${payout._id}`, type: 'payout_reversal', ref: { payoutId: payout._id }, note: err.message });
    if (payout.fee > 0) await credit(payout.orgId, payout.fee, { key: `fee-fail:${payout._id}`, type: 'fee_reversal', ref: { payoutId: payout._id } });
    await Payout.updateOne({ _id: payout._id }, { $set: { status: 'failed', failureReason: err.message } });
    await Payable.updateMany({ payoutId: payout._id }, { $set: { status: 'approved' }, $unset: { payoutId: 1 } });
    await notify(payout.userId, {
      type: 'payout_failed', title: 'A payout failed',
      body: `We could not send your stipend: ${err.message}. Check your UPI id in Earnings. The organizer can retry.`, link: '/earnings',
    });
    const org = await Organization.findById(payout.orgId).select('members');
    await notify((org?.members || []).map((m) => m.userId), {
      type: 'payout_failed_org', title: 'A volunteer payout failed',
      body: `${rupees(payout.amount)} was returned to your wallet. The volunteer was asked to fix their UPI id.`, link: `/manage/events/${payout.eventId}`, email: false,
    });
  }
}

export async function createPayableFor(attendance, shift, minutes) {
  const amount = payForMinutes(shift, minutes);
  if (amount <= 0) return null;
  try {
    const payable = await Payable.create({
      attendanceId: attendance._id, signupId: attendance.signupId, shiftId: attendance.shiftId, eventId: attendance.eventId,
      orgId: attendance.orgId, userId: attendance.userId, minutes, amount,
    });
    return payable;
  } catch (err) {
    if (err.code === 11000) return Payable.findOne({ attendanceId: attendance._id });
    throw err;
  }
}

export async function markSettled(signupId) {
  await Signup.updateOne({ _id: signupId }, { $set: { settled: true } });
}

export { ApiError };
