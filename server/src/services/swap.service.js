import { SwapRequest } from '../models/SwapRequest.js';
import { Signup, ACTIVE_SIGNUP } from '../models/Signup.js';
import { Shift } from '../models/Shift.js';
import { Event } from '../models/Event.js';
import { User } from '../models/User.js';
import { Organization } from '../models/Organization.js';
import { EventRole } from '../models/EventRole.js';
import { ApiError } from '../utils/ApiError.js';
import { audit } from '../utils/audit.js';
import { notify } from './notify.js';
import { emitMissionUpdate } from '../socket.js';
import { canOfferSwap, checkSwapEligibility, MIN_LEAD_MS } from '../utils/swapLogic.js';
import { claimSignup } from './shifts.service.js';

const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Checks if user is authorized to manage swaps for an event (admin, org member, or role team lead).
 */
export async function canManageEventSwaps(actor, event) {
  if (actor.role === 'admin') return true;
  const org = await Organization.findById(event.orgId).select('members');
  if (org?.members.some((m) => String(m.userId) === String(actor.id))) return true;
  return false;
}

/**
 * Volunteer offers a confirmed signup for swap.
 */
export async function offerSwap(signupId, { note = '', toUserId, toUserEmail, minLeadMs = MIN_LEAD_MS } = {}, user) {
  if (user.role && user.role !== 'volunteer') {
    throw ApiError.forbidden('Only crew volunteers can offer shift swaps');
  }

  const signup = await Signup.findOne({ _id: signupId, userId: user.id });
  if (!signup) throw ApiError.notFound('Sign-up not found or does not belong to you');

  const shift = await Shift.findById(signup.shiftId);
  if (!shift) throw ApiError.notFound('Shift not found');

  const event = await Event.findById(shift.eventId);
  if (!event || event.status === 'cancelled') throw ApiError.conflict('This event is cancelled');

  const offerCheck = canOfferSwap(shift, signup, new Date(), minLeadMs);
  if (!offerCheck.canOffer) {
    throw ApiError.badRequest(offerCheck.reason);
  }

  // Check if an active swap already exists for this signup
  const existingActive = await SwapRequest.findOne({
    fromSignupId: signup._id,
    status: { $in: ['open', 'claimed'] },
  });
  if (existingActive) {
    throw ApiError.conflict('An active swap request already exists for this shift');
  }

  let resolvedToUserId = toUserId || null;
  if (toUserEmail && !resolvedToUserId) {
    const targetUser = await User.findOne({ email: toUserEmail.trim().toLowerCase() });
    if (!targetUser) throw ApiError.notFound(`No volunteer found with email ${toUserEmail}`);
    if (String(targetUser._id) === String(user.id)) throw ApiError.badRequest('You cannot offer a swap to yourself');
    resolvedToUserId = targetUser._id;
  }

  // Expires 1 hour before shift start
  const expiresAt = new Date(+shift.start - 1 * 60 * 60 * 1000);
  if (expiresAt <= new Date()) {
    throw ApiError.badRequest('Cutoff time for shift swap has already passed');
  }

  const swap = await SwapRequest.create({
    shiftId: shift._id,
    eventId: event._id,
    orgId: shift.orgId,
    fromSignupId: signup._id,
    fromUserId: user.id,
    toUserId: resolvedToUserId,
    status: 'open',
    note: note.slice(0, 500),
    expiresAt,
  });

  await audit(user, 'swap.offered', {
    entityType: 'SwapRequest',
    entityId: swap._id,
    eventId: event._id,
    meta: { shiftId: shift._id, toUserId: resolvedToUserId, note },
  });

  if (resolvedToUserId) {
    await notify(resolvedToUserId, {
      type: 'swap_direct_offer',
      title: 'Shift Swap Offered Directly to You',
      body: `${user.name || 'A volunteer'} offered to swap their shift on ${fmt(shift.start)} with you.`,
      link: `/events/${event._id}`,
    });
  }

  emitMissionUpdate(event._id, {
    reason: 'swap_offered',
    details: { shiftId: shift._id, fromUserId: user.id },
  });

  return swap;
}

/**
 * Returns all open swaps across published events, evaluated for candidate eligibility,
 * with complete event and shift details.
 */
export async function listAllOpenSwaps(user = null) {
  const now = new Date();
  const swaps = await SwapRequest.find({
    status: 'open',
    expiresAt: { $gt: now },
  })
    .populate('eventId', 'title slug bannerUrl startDate endDate venue category status')
    .populate('fromUserId', 'name reliabilityScore')
    .populate('shiftId', 'start end capacity spotsLeft payType rate notes roleId')
    .populate('toUserId', 'name')
    .sort({ createdAt: -1 });

  // Filter out any swap where event is missing or unpublished or cancelled
  const activeSwaps = swaps.filter(
    (s) => s.eventId && s.eventId.status !== 'cancelled' && s.eventId.status !== 'draft'
  );

  // Populate roles for shiftId
  const roleIds = [...new Set(activeSwaps.map((s) => s.shiftId?.roleId).filter(Boolean))];
  const roles = await EventRole.find({ _id: { $in: roleIds } }).select('name description skills');
  const roleMap = new Map(roles.map((r) => [String(r._id), r]));

  let candidateSignups = [];
  if (user) {
    candidateSignups = await Signup.find({
      userId: user.id,
      status: { $in: ACTIVE_SIGNUP },
    }).select('shiftId start end status');
  }

  return activeSwaps.map((s) => {
    const shiftObj = s.shiftId ? s.shiftId.toObject() : {};
    if (shiftObj.roleId && roleMap.has(String(shiftObj.roleId))) {
      shiftObj.role = roleMap.get(String(shiftObj.roleId));
    }

    const eventObj = s.eventId ? (s.eventId.toObject ? s.eventId.toObject() : { ...s.eventId }) : {};
    eventObj.start = eventObj.startDate || eventObj.start;
    eventObj.end = eventObj.endDate || eventObj.end;
    eventObj.banner = eventObj.bannerUrl || eventObj.banner;
    eventObj.city = eventObj.venue?.city || eventObj.city;

    let eligibility = { eligible: true };
    if (user) {
      eligibility = checkSwapEligibility(
        shiftObj,
        candidateSignups,
        user.id,
        s.fromUserId?._id || s.fromUserId,
        s.toUserId?._id || s.toUserId
      );
    }

    return {
      _id: s._id,
      event: eventObj,
      shiftId: shiftObj,
      fromUser: s.fromUserId,
      toUser: s.toUserId,
      note: s.note,
      status: s.status,
      expiresAt: s.expiresAt,
      isDirectSwap: !!s.toUserId,
      isOfferer: user ? String(s.fromUserId?._id || s.fromUserId) === String(user.id) : false,
      isEligible: eligibility.eligible,
      ineligibilityReason: eligibility.reason,
      createdAt: s.createdAt,
    };
  });
}

/**
 * Returns open swaps on the event Swap Board, evaluated for candidate eligibility.
 */
export async function listEventSwaps(eventId, user = null) {
  const now = new Date();
  const swaps = await SwapRequest.find({
    eventId,
    status: 'open',
    expiresAt: { $gt: now },
  })
    .populate('fromUserId', 'name reliabilityScore')
    .populate('shiftId', 'start end capacity spotsLeft payType rate notes roleId')
    .populate('toUserId', 'name')
    .sort({ createdAt: -1 });

  // Populate roles for shiftId
  const roleIds = [...new Set(swaps.map((s) => s.shiftId?.roleId).filter(Boolean))];
  const roles = await EventRole.find({ _id: { $in: roleIds } }).select('name description skills');
  const roleMap = new Map(roles.map((r) => [String(r._id), r]));

  let candidateSignups = [];
  if (user) {
    candidateSignups = await Signup.find({
      userId: user.id,
      status: { $in: ACTIVE_SIGNUP },
    }).select('shiftId start end status');
  }

  return swaps.map((s) => {
    const shiftObj = s.shiftId ? s.shiftId.toObject() : {};
    if (shiftObj.roleId && roleMap.has(String(shiftObj.roleId))) {
      shiftObj.role = roleMap.get(String(shiftObj.roleId));
    }

    let eligibility = { eligible: true };
    if (user) {
      eligibility = checkSwapEligibility(
        shiftObj,
        candidateSignups,
        user.id,
        s.fromUserId?._id || s.fromUserId,
        s.toUserId?._id || s.toUserId
      );
    }

    return {
      _id: s._id,
      shiftId: shiftObj,
      fromUser: s.fromUserId,
      toUser: s.toUserId,
      note: s.note,
      status: s.status,
      expiresAt: s.expiresAt,
      isDirectSwap: !!s.toUserId,
      isOfferer: user ? String(s.fromUserId?._id || s.fromUserId) === String(user.id) : false,
      isEligible: eligibility.eligible,
      ineligibilityReason: eligibility.reason,
    };
  });
}

/**
 * Organizer / Admin reviews all swap requests for the event (approvals queue).
 */
export async function listOrganizerSwaps(eventId, actor) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const isAllowed = await canManageEventSwaps(actor, event);
  if (!isAllowed) throw ApiError.forbidden('Only organizers and admins can access swap approvals');

  const swaps = await SwapRequest.find({ eventId })
    .populate('fromUserId', 'name email phone reliabilityScore')
    .populate('claimedBy', 'name email phone reliabilityScore')
    .populate('decidedBy', 'name')
    .populate('shiftId', 'start end roleId')
    .sort({ createdAt: -1 });

  const roleIds = [...new Set(swaps.map((s) => s.shiftId?.roleId).filter(Boolean))];
  const roles = await EventRole.find({ _id: { $in: roleIds } }).select('name');
  const roleMap = new Map(roles.map((r) => [String(r._id), r.name]));

  return swaps.map((s) => {
    const obj = s.toObject();
    if (obj.shiftId?.roleId) {
      obj.shiftRoleName = roleMap.get(String(obj.shiftId.roleId)) || 'Crew Member';
    }
    return obj;
  });
}

/**
 * Volunteer claims an open swap.
 * Concurrency: atomic findOneAndUpdate ensures only one claimer wins.
 */
export async function claimSwap(swapId, user) {
  if (user.role && user.role !== 'volunteer') {
    throw ApiError.forbidden('Only crew volunteers can claim shift swaps');
  }

  const swap = await SwapRequest.findById(swapId);
  if (!swap) throw ApiError.notFound('Swap request not found');

  const shift = await Shift.findById(swap.shiftId);
  if (!shift || shift.status !== 'open') throw ApiError.conflict('Shift is no longer active');
  if (shift.start <= new Date()) throw ApiError.conflict('Shift has already started');

  if (String(swap.fromUserId) === String(user.id)) {
    throw ApiError.badRequest('You cannot claim your own swap offer');
  }

  if (swap.toUserId && String(swap.toUserId) !== String(user.id)) {
    throw ApiError.forbidden('This swap was offered directly to another volunteer');
  }

  // Pre-claim clash check against candidate's active schedule
  const candidateSignups = await Signup.find({
    userId: user.id,
    status: { $in: ACTIVE_SIGNUP },
  }).select('shiftId start end status');

  const eligibility = checkSwapEligibility(
    shift,
    candidateSignups,
    user.id,
    swap.fromUserId,
    swap.toUserId
  );
  if (!eligibility.eligible) {
    throw ApiError.conflict(eligibility.reason);
  }

  // Atomic claim: only one wins
  const claimed = await SwapRequest.findOneAndUpdate(
    { _id: swapId, status: 'open', expiresAt: { $gt: new Date() } },
    { $set: { status: 'claimed', claimedBy: user.id, claimedAt: new Date() } },
    { new: true }
  );

  if (!claimed) {
    throw ApiError.conflict('This swap request is no longer available or was already claimed by another volunteer');
  }

  await audit(user, 'swap.claimed', {
    entityType: 'SwapRequest',
    entityId: claimed._id,
    eventId: shift.eventId,
    meta: { shiftId: shift._id, fromUserId: swap.fromUserId, claimedBy: user.id },
  });

  const event = await Event.findById(shift.eventId);

  // If event has autoApproveSwaps enabled, immediately transfer atomically
  if (event?.autoApproveSwaps) {
    return await approveSwap(claimed._id, { id: user.id, role: 'auto', name: 'System Auto-Approval' });
  }

  // Notify original volunteer
  await notify(swap.fromUserId, {
    type: 'swap_claimed',
    title: 'Your Shift Swap Was Claimed',
    body: `${user.name || 'A volunteer'} has claimed your shift. It is now awaiting organizer approval.`,
    link: '/my-shifts',
  });

  // Notify event organizer so they get an alert in their notification bell
  if (event?.createdBy) {
    await notify(event.createdBy, {
      type: 'swap_claimed_organizer',
      title: 'Shift Swap Awaiting Approval',
      body: `${user.name || 'A volunteer'} has claimed a shift swap for "${event.title}". Please review and approve the transfer.`,
      link: `/manage/events/${event._id}?tab=shifts`,
    });
  }

  // Emit mission update for real-time mission control
  emitMissionUpdate(shift.eventId, {
    reason: 'swap_claimed',
    details: { shiftId: shift._id, claimedBy: user.id, fromUserId: swap.fromUserId },
  });

  return claimed;
}

/**
 * Offerer cancels their swap offer (allowed in 'open' or 'claimed' state).
 */
export async function cancelSwap(swapId, user) {
  const swap = await SwapRequest.findById(swapId);
  if (!swap) throw ApiError.notFound('Swap request not found');

  if (String(swap.fromUserId) !== String(user.id)) {
    throw ApiError.forbidden('You can only cancel your own swap requests');
  }

  const cancelled = await SwapRequest.findOneAndUpdate(
    { _id: swapId, fromUserId: user.id, status: { $in: ['open', 'claimed'] } },
    { $set: { status: 'cancelled' } },
    { new: true }
  );

  if (!cancelled) {
    throw ApiError.conflict(`Cannot cancel swap in status ${swap.status}`);
  }

  // If a taker had claimed it, notify them it was cancelled
  if (swap.claimedBy) {
    await notify(swap.claimedBy, {
      type: 'swap_cancelled_by_offerer',
      title: 'Shift Swap Cancelled',
      body: 'The volunteer who offered this shift has cancelled their swap request.',
      link: `/events/${swap.eventId}`,
    });
  }

  await audit(user, 'swap.cancelled', {
    entityType: 'SwapRequest',
    entityId: cancelled._id,
    eventId: swap.eventId,
  });

  emitMissionUpdate(swap.eventId, { reason: 'swap_cancelled' });
  return cancelled;
}

/**
 * Organizer approves a claimed swap transfer.
 * Atomically transfers spot:
 * - Re-runs clash check for taker
 * - Cancels original signup WITHOUT freeing spot or waitlist promotion (NO late penalty)
 * - Claims new signup for taker with existing estPay
 * - Old QR pass becomes immediately invalid
 * - spotsLeft remains 100% constant!
 */
export async function approveSwap(swapId, actor) {
  const swap = await SwapRequest.findById(swapId);
  if (!swap) throw ApiError.notFound('Swap request not found');

  const event = await Event.findById(swap.eventId);
  if (!event) throw ApiError.notFound('Event not found');

  if (actor.role !== 'auto') {
    const isAllowed = await canManageEventSwaps(actor, event);
    if (!isAllowed) throw ApiError.forbidden('Only organizers and admins can approve shift swaps');
  }

  // Lock status to approved
  const approvedSwap = await SwapRequest.findOneAndUpdate(
    { _id: swapId, status: 'claimed' },
    { $set: { status: 'approved', decidedBy: actor.id, decidedAt: new Date() } },
    { new: true }
  );
  if (!approvedSwap) {
    throw ApiError.conflict('This swap is no longer in claimed status');
  }

  const shift = await Shift.findById(swap.shiftId);
  if (!shift || shift.status !== 'open') {
    await SwapRequest.updateOne({ _id: swap._id }, { $set: { status: 'claimed', decidedBy: null, decidedAt: null } });
    throw ApiError.conflict('The shift has been cancelled');
  }

  // Re-run clash check for taker at approval time
  const clash = await Signup.findOne({
    userId: swap.claimedBy,
    status: { $in: ACTIVE_SIGNUP },
    start: { $lt: shift.end },
    end: { $gt: shift.start },
  });

  if (clash) {
    // Revert swap back to claimed to block swap
    await SwapRequest.updateOne(
      { _id: swap._id },
      { $set: { status: 'claimed', decidedBy: null, decidedAt: null } }
    );
    throw ApiError.conflict('The claiming volunteer now has a schedule clash with another shift');
  }

  // 1. Cancel original signup WITHOUT freeing spot or waitlist promotion
  const oldSignup = await Signup.findOneAndUpdate(
    { _id: swap.fromSignupId, status: 'confirmed' },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'swapped with another volunteer',
        lateCancel: false, // NO reliability penalty
      },
    },
    { new: true }
  );

  if (!oldSignup) {
    await SwapRequest.updateOne({ _id: swap._id }, { $set: { status: 'claimed', decidedBy: null, decidedAt: null } });
    throw ApiError.conflict('The original volunteer sign-up is no longer confirmed');
  }

  // 2. Claim new signup for taker using existing pattern
  const newSignup = await claimSignup(shift, swap.claimedBy);

  // 3. Confirm taker signup directly and move estPay (WITHOUT touching spotsLeft)
  await Signup.updateOne(
    { _id: newSignup._id },
    { $set: { status: 'confirmed', estPay: oldSignup.estPay } }
  );

  // 4. Fetch details for notification
  const [oldUser, newUser] = await Promise.all([
    User.findById(swap.fromUserId).select('name email'),
    User.findById(swap.claimedBy).select('name email'),
  ]);

  // Notify original volunteer
  await notify(swap.fromUserId, {
    type: 'swap_approved_donor',
    title: 'Shift Swap Complete',
    body: `Your shift on ${fmt(shift.start)} was handed over to ${newUser?.name || 'another volunteer'}. You have been removed from the roster with zero penalty.`,
    link: '/my-shifts',
  });

  // Notify new volunteer
  await notify(swap.claimedBy, {
    type: 'swap_approved_taker',
    title: 'Shift Swap Approved! You Are Confirmed',
    body: `Your shift claim on ${fmt(shift.start)} was approved! Open your QR pass from My shifts when you arrive.`,
    link: '/my-shifts',
  });

  await audit(actor, 'swap.approved', {
    entityType: 'SwapRequest',
    entityId: swap._id,
    eventId: shift.eventId,
    meta: {
      shiftId: shift._id,
      fromUserId: swap.fromUserId,
      toUserId: swap.claimedBy,
      fromSignupId: swap.fromSignupId,
      newSignupId: newSignup._id,
    },
  });

  emitMissionUpdate(shift.eventId, {
    reason: 'swap_approved',
    details: {
      shiftId: shift._id,
      fromUserId: swap.fromUserId,
      fromUserName: oldUser?.name,
      toUserId: swap.claimedBy,
      toUserName: newUser?.name,
    },
  });

  return approvedSwap;
}

/**
 * Organizer rejects a claimed swap, reopening it to other volunteers.
 */
export async function rejectSwap(swapId, actor, reason = 'Claim declined by organizer') {
  const swap = await SwapRequest.findById(swapId);
  if (!swap) throw ApiError.notFound('Swap request not found');

  const event = await Event.findById(swap.eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const isAllowed = await canManageEventSwaps(actor, event);
  if (!isAllowed) throw ApiError.forbidden('Only organizers and admins can reject shift swaps');

  const rejected = await SwapRequest.findOneAndUpdate(
    { _id: swapId, status: 'claimed' },
    {
      $set: {
        status: 'open',
        claimedBy: null,
        claimedAt: null,
        rejectionReason: reason,
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
    },
    { new: true }
  );

  if (!rejected) {
    throw ApiError.conflict('Swap request is no longer in claimed status');
  }

  if (swap.claimedBy) {
    await notify(swap.claimedBy, {
      type: 'swap_claim_rejected',
      title: 'Shift Swap Claim Declined',
      body: `Your claim for the shift on ${fmt(swap.createdAt)} was declined by the organizer.${reason ? ` Reason: ${reason}` : ''}`,
      link: `/events/${swap.eventId}`,
    });
  }

  await notify(swap.fromUserId, {
    type: 'swap_claim_declined_reopened',
    title: 'Swap Reopened',
    body: 'A volunteer claimed your shift, but the organizer declined the match. Your shift remains open on the Swap Board.',
    link: '/my-shifts',
  });

  await audit(actor, 'swap.rejected', {
    entityType: 'SwapRequest',
    entityId: swap._id,
    eventId: swap.eventId,
    meta: { reason },
  });

  emitMissionUpdate(swap.eventId, { reason: 'swap_rejected' });
  return rejected;
}

/**
 * Scheduler task: expires open/claimed swaps 1 hour before shift start.
 * Original volunteer keeps their shift (no auto-cancel).
 */
export async function expirePendingSwaps() {
  const now = new Date();
  const expired = await SwapRequest.find({
    status: { $in: ['open', 'claimed'] },
    expiresAt: { $lte: now },
  });

  let count = 0;
  for (const s of expired) {
    const updated = await SwapRequest.findOneAndUpdate(
      { _id: s._id, status: s.status, expiresAt: { $lte: now } },
      { $set: { status: 'expired' } },
      { new: true }
    );
    if (!updated) continue;
    count += 1;

    // Notify original volunteer that swap expired, but shift remains confirmed
    await notify(s.fromUserId, {
      type: 'swap_expired',
      title: 'Shift Swap Window Closed',
      body: 'Your shift swap offer was not completed before the 1-hour cutoff. You remain confirmed for your scheduled shift.',
      link: '/my-shifts',
    });

    if (s.claimedBy) {
      await notify(s.claimedBy, {
        type: 'swap_expired_claim',
        title: 'Shift Swap Expired',
        body: 'The shift swap was not finalized before the start cutoff.',
        link: '/my-shifts',
      });
    }

    await audit(null, 'swap.expired', {
      entityType: 'SwapRequest',
      entityId: s._id,
      eventId: s.eventId,
      meta: { system: true },
    });
  }

  return count;
}
