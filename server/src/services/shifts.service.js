import { Shift } from '../models/Shift.js';
import { Signup, ACTIVE_SIGNUP } from '../models/Signup.js';
import { Attendance } from '../models/Attendance.js';
import { Event } from '../models/Event.js';
import { ApiError } from '../utils/ApiError.js';
import { estimatePay } from '../utils/money.js';
import { notify } from './notify.js';
import { penalize } from '../utils/reliability.js';

const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/*
 * Concurrency design
 * ------------------
 * - Spots are a counter (shift.spotsLeft) changed only with atomic conditional updates:
 *     findOneAndUpdate({ spotsLeft: { $gt: 0 } }, { $inc: { spotsLeft: -1 } })
 *   so two people can never take the last spot.
 * - A (shift, user) pair is unique. A signup is "claimed" first (status confirming), then a spot is taken,
 *   so a double click cannot take two spots.
 * - After claiming, clashes with the user's other shifts are re-checked, closing the race between two joins.
 */

const takeSpot = (shiftId) =>
  Shift.findOneAndUpdate({ _id: shiftId, status: 'open', spotsLeft: { $gt: 0 } }, { $inc: { spotsLeft: -1 } }, { new: true });

const freeSpot = (shiftId) => Shift.updateOne({ _id: shiftId }, { $inc: { spotsLeft: 1 } });

async function claimSignup(shift, userId) {
  const fields = {
    eventId: shift.eventId, roleId: shift.roleId, orgId: shift.orgId,
    start: shift.start, end: shift.end, estPay: estimatePay(shift), joinedAt: new Date(),
  };
  try {
    return await Signup.create({ shiftId: shift._id, userId, status: 'confirming', ...fields });
  } catch (err) {
    if (err.code !== 11000) throw err;
    // A cancelled signup can be reused. Anything else means an active or declined request already exists.
    const reused = await Signup.findOneAndUpdate(
      { shiftId: shift._id, userId, status: 'cancelled' },
      { $set: { status: 'confirming', ...fields }, $unset: { cancelledAt: 1, cancelReason: 1, lateCancel: 1, promotedAt: 1 } },
      { new: true }
    );
    if (!reused) throw ApiError.conflict('You already have a request for this shift');
    return reused;
  }
}

export async function joinShift(shiftId, user, inviteCode) {
  const shift = await Shift.findById(shiftId);
  if (!shift) throw ApiError.notFound('Shift not found');
  if (shift.status !== 'open') throw ApiError.conflict('This shift was cancelled');
  if (shift.start <= new Date()) throw ApiError.conflict('This shift has already started');

  const event = await Event.findById(shift.eventId);
  if (!event || !['published', 'ongoing'].includes(event.status)) throw ApiError.conflict('This event is not open for sign-up');
  if (event.visibility === 'invite_only' && inviteCode !== event.inviteCode) throw ApiError.notFound('Event not found');

  const signup = await claimSignup(shift, user.id);
  let tookSpot = false;
  try {
    const clash = await Signup.findOne({
      userId: user.id, _id: { $ne: signup._id }, status: { $in: ACTIVE_SIGNUP },
      start: { $lt: shift.end }, end: { $gt: shift.start },
    });
    if (clash) throw ApiError.conflict('This shift clashes with another shift you have joined');

    let status;
    if (event.applicationMode === 'approval') {
      status = 'pending';
    } else {
      tookSpot = !!(await takeSpot(shift._id));
      status = tookSpot ? 'confirmed' : 'waitlisted';
    }
    await Signup.updateOne({ _id: signup._id }, { $set: { status } });
    signup.status = status;
    return signup;
  } catch (err) {
    if (tookSpot) await freeSpot(shift._id);
    await Signup.updateOne({ _id: signup._id, status: 'confirming' }, { $set: { status: 'cancelled', cancelReason: 'join failed' } });
    throw err;
  }
}

// Gives free spots to the oldest waitlisted people. Safe to call any time.
export async function fillFromWaitlist(shiftId) {
  for (;;) {
    const next = await Signup.findOne({ shiftId, status: 'waitlisted' }).sort({ joinedAt: 1 });
    if (!next) return;
    if (!(await takeSpot(shiftId))) return;
    const promoted = await Signup.findOneAndUpdate(
      { _id: next._id, status: 'waitlisted' },
      { $set: { status: 'confirmed', promotedAt: new Date() } },
      { new: true }
    );
    if (!promoted) { await freeSpot(shiftId); continue; }
    const shift = await Shift.findById(shiftId).populate('roleId', 'name');
    await notify(next.userId, {
      type: 'waitlist_promoted',
      title: 'You got a spot',
      body: `A spot opened up and you are now confirmed for ${shift?.roleId?.name || 'your shift'} on ${fmt(shift.start)}.`,
      link: '/my-shifts',
    });
  }
}

// Volunteer leaves (or an organizer removes them). Idempotent: a second call conflicts instead of double-freeing.
export async function leaveSignup(signupId, { byOrganizer = false, reason } = {}) {
  const current = await Signup.findById(signupId);
  if (!current) throw ApiError.notFound('Sign-up not found');
  const shift = await Shift.findById(current.shiftId);
  const now = new Date();

  if (await Attendance.exists({ signupId })) throw ApiError.conflict('Attendance has already been recorded for this shift');
  if (!byOrganizer && shift.start <= now) throw ApiError.conflict('This shift has already started');

  const lateCancel = !byOrganizer && current.status === 'confirmed' && shift.start - now < 24 * 60 * 60 * 1000;
  const flipped = await Signup.findOneAndUpdate(
    { _id: signupId, status: { $in: ['confirmed', 'pending', 'waitlisted'] } },
    { $set: { status: 'cancelled', cancelledAt: now, cancelReason: reason || (byOrganizer ? 'removed by organizer' : 'cancelled by volunteer'), lateCancel } },
    { new: false }
  );
  if (!flipped) throw ApiError.conflict('This sign-up is already cancelled');

  if (flipped.status === 'confirmed') {
    await freeSpot(flipped.shiftId);
    await fillFromWaitlist(flipped.shiftId);
  }
  if (lateCancel) {
    await penalize(flipped.userId, 5);
  }
  if (byOrganizer) {
    await notify(flipped.userId, {
      type: 'signup_removed', title: 'You were removed from a shift',
      body: `An organizer removed you from the shift on ${fmt(shift.start)}.${reason ? ` Reason: ${reason}` : ''}`, link: '/my-shifts',
    });
  }
  return { ...flipped.toObject(), status: 'cancelled', lateCancel };
}

export async function approveSignup(signupId) {
  const claimed = await Signup.findOneAndUpdate({ _id: signupId, status: 'pending' }, { $set: { status: 'confirming' } }, { new: true });
  if (!claimed) throw ApiError.conflict('This request is no longer pending');
  const got = await takeSpot(claimed.shiftId);
  const status = got ? 'confirmed' : 'waitlisted';
  await Signup.updateOne({ _id: signupId }, { $set: { status } });
  await notify(claimed.userId, {
    type: 'signup_approved',
    title: got ? 'Your request was approved' : 'Approved, you are on the waitlist',
    body: got ? 'You are confirmed for the shift.' : 'The shift is full, so you have been placed on the waitlist.',
    link: '/my-shifts',
  });
  return status;
}

export async function rejectSignup(signupId, reason) {
  const rejected = await Signup.findOneAndUpdate(
    { _id: signupId, status: 'pending' },
    { $set: { status: 'rejected', cancelReason: reason || 'declined by organizer' } },
    { new: true }
  );
  if (!rejected) throw ApiError.conflict('This request is no longer pending');
  await notify(rejected.userId, { type: 'signup_rejected', title: 'Your request was declined', body: reason || 'The organizer declined your request.', link: '/my-shifts' });
}

export async function cancelShift(shift, reason) {
  const flipped = await Shift.findOneAndUpdate({ _id: shift._id, status: { $ne: 'cancelled' } }, { $set: { status: 'cancelled' } }, { new: true });
  if (!flipped) return 0;
  const affected = await Signup.find({ shiftId: shift._id, status: { $in: ['confirmed', 'pending', 'waitlisted', 'confirming'] } }).select('userId');
  await Signup.updateMany(
    { shiftId: shift._id, status: { $in: ['confirmed', 'pending', 'waitlisted', 'confirming'] } },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || 'Shift cancelled by organizer', settled: true } }
  );
  if (affected.length > 0) {
    await notify(affected.map((s) => s.userId), {
      type: 'shift_cancelled',
      title: 'Event / Shift Cancelled',
      body: `The event and shift scheduled for ${fmt(shift.start)} was cancelled by the organizer. Reason: ${reason || 'Event cancelled by organizer'}.`,
      link: '/notifications',
    });
  }
  return affected.length;
}

export async function cancelAllShifts(eventId, reason) {
  const shifts = await Shift.find({ eventId, status: { $ne: 'cancelled' } });
  let n = 0;
  for (const s of shifts) n += await cancelShift(s, reason);
  return n;
}

// Applies edits to a shift that has not started. Handles capacity changes atomically.
export async function updateShift(shift, changes) {
  if (shift.status !== 'open') throw ApiError.conflict('A cancelled shift cannot be edited');
  if (shift.start <= new Date()) throw ApiError.conflict('A shift that has started cannot be edited');

  const next = { ...shift.toObject(), ...changes };
  if (next.end <= next.start) throw ApiError.badRequest('Shift end must be after its start');

  const confirmed = shift.capacity - shift.spotsLeft;
  const capacityDelta = (changes.capacity ?? shift.capacity) - shift.capacity;
  if (changes.capacity !== undefined && changes.capacity < confirmed) {
    throw ApiError.conflict(`${confirmed} volunteers are already confirmed. Remove some before lowering capacity below that.`);
  }

  const update = { $set: { ...changes } };
  if (capacityDelta) update.$inc = { spotsLeft: capacityDelta };
  const updated = await Shift.findOneAndUpdate(
    { _id: shift._id, ...(capacityDelta < 0 ? { spotsLeft: { $gte: -capacityDelta } } : {}) },
    update,
    { new: true }
  );
  if (!updated) throw ApiError.conflict('Someone just joined, so capacity cannot be lowered that far');

  const timeChanged = changes.start || changes.end;
  const payChanged = changes.payType !== undefined || changes.rate !== undefined;
  if (timeChanged || payChanged) {
    await Signup.updateMany(
      { shiftId: shift._id, status: { $in: ACTIVE_SIGNUP }, settled: false },
      { $set: { start: updated.start, end: updated.end, estPay: estimatePay(updated) } }
    );
  }
  if (timeChanged) {
    const people = await Signup.find({ shiftId: shift._id, status: { $in: ['confirmed', 'pending', 'waitlisted'] } }).select('userId');
    await notify(people.map((s) => s.userId), {
      type: 'shift_changed', title: 'A shift time changed',
      body: `Your shift is now ${fmt(updated.start)} to ${fmt(updated.end)}. Cancel it from My shifts if the new time does not work.`, link: '/my-shifts',
    });
  }
  if (capacityDelta > 0) await fillFromWaitlist(shift._id);
  return updated;
}
