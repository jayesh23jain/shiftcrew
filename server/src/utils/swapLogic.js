/**
 * Pure business logic for shift swaps.
 * Free of database dependencies for unit testing.
 */

export const MIN_LEAD_HOURS = 2;
export const MIN_LEAD_MS = MIN_LEAD_HOURS * 60 * 60 * 1000;

export const SWAP_STATUSES = ['open', 'claimed', 'approved', 'rejected', 'cancelled', 'expired'];

/**
 * Checks whether a volunteer can offer a signup for swap.
 */
export function canOfferSwap(shift, signup, now = new Date(), minLeadMs = MIN_LEAD_MS) {
  if (!signup || signup.status !== 'confirmed') {
    return { canOffer: false, reason: 'Only confirmed signups can be offered for swap' };
  }
  if (!shift || shift.status !== 'open') {
    return { canOffer: false, reason: 'This shift is not open or was cancelled' };
  }

  const shiftStart = new Date(shift.start).getTime();
  const currentTime = new Date(now).getTime();

  if (shiftStart <= currentTime) {
    return { canOffer: false, reason: 'Shift has already started' };
  }

  if (shiftStart - currentTime < minLeadMs) {
    return {
      canOffer: false,
      reason: `Swaps must be offered at least ${Math.round(minLeadMs / 3600000)} hours before shift start`,
    };
  }

  return { canOffer: true };
}

/**
 * Checks whether a candidate volunteer is eligible to claim an open swap.
 */
export function checkSwapEligibility(shift, candidateSignups = [], candidateUserId, offeringUserId, toUserId = null) {
  const candidateIdStr = String(candidateUserId);
  const offeringIdStr = String(offeringUserId);

  if (candidateIdStr === offeringIdStr) {
    return { eligible: false, reason: 'You cannot claim your own swap offer' };
  }

  if (toUserId && String(toUserId) !== candidateIdStr) {
    return { eligible: false, reason: 'This swap was offered directly to another volunteer' };
  }

  const shiftStart = new Date(shift.start).getTime();
  const shiftEnd = new Date(shift.end).getTime();

  for (const s of candidateSignups) {
    const sShiftIdStr = String(s.shiftId);
    const activeStatuses = ['confirming', 'confirmed', 'pending', 'waitlisted'];

    if (activeStatuses.includes(s.status)) {
      if (sShiftIdStr === String(shift._id)) {
        return { eligible: false, reason: 'You are already registered for this shift' };
      }

      const sStart = new Date(s.start).getTime();
      const sEnd = new Date(s.end).getTime();

      // Overlap condition: start < other.end && end > other.start
      if (sStart < shiftEnd && sEnd > shiftStart) {
        return { eligible: false, reason: 'This shift clashes with another shift on your schedule' };
      }
    }
  }

  return { eligible: true };
}

/**
 * Validates state machine transitions for SwapRequest.
 */
export function canTransitionSwap(currentStatus, nextStatus, { isOrganizer = false, isOfferer = false, isTaker = false, isScheduler = false } = {}) {
  if (!SWAP_STATUSES.includes(currentStatus) || !SWAP_STATUSES.includes(nextStatus)) {
    return { allowed: false, reason: 'Invalid status' };
  }

  if (currentStatus === nextStatus) {
    return { allowed: false, reason: 'Status is already ' + currentStatus };
  }

  switch (currentStatus) {
    case 'open':
      if (nextStatus === 'claimed') {
        return { allowed: true };
      }
      if (nextStatus === 'cancelled') {
        if (!isOfferer && !isOrganizer) return { allowed: false, reason: 'Only the offerer or organizer can cancel this swap' };
        return { allowed: true };
      }
      if (nextStatus === 'expired') {
        if (!isScheduler) return { allowed: false, reason: 'Only scheduler can expire open swaps' };
        return { allowed: true };
      }
      return { allowed: false, reason: `Cannot transition from open to ${nextStatus}` };

    case 'claimed':
      if (nextStatus === 'approved') {
        if (!isOrganizer) return { allowed: false, reason: 'Only organizers can approve claimed swaps' };
        return { allowed: true };
      }
      if (nextStatus === 'rejected') {
        if (!isOrganizer) return { allowed: false, reason: 'Only organizers can reject claimed swaps' };
        return { allowed: true };
      }
      if (nextStatus === 'open') {
        // Organizer rejected the claim, reopening swap to other volunteers
        if (!isOrganizer) return { allowed: false, reason: 'Only organizers can reopen a claimed swap' };
        return { allowed: true };
      }
      if (nextStatus === 'cancelled') {
        if (!isOfferer && !isOrganizer) return { allowed: false, reason: 'Only the offerer or organizer can cancel this swap' };
        return { allowed: true };
      }
      if (nextStatus === 'expired') {
        if (!isScheduler) return { allowed: false, reason: 'Only scheduler can expire claimed swaps' };
        return { allowed: true };
      }
      return { allowed: false, reason: `Cannot transition from claimed to ${nextStatus}` };

    case 'approved':
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return { allowed: false, reason: `Final status ${currentStatus} cannot be changed` };

    default:
      return { allowed: false, reason: 'Unknown transition' };
  }
}
