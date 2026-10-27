import { Attendance } from '../models/Attendance.js';
import { Signup } from '../models/Signup.js';
import { Shift } from '../models/Shift.js';
import { Organization } from '../models/Organization.js';
import { EventRole } from '../models/EventRole.js';
import { ApiError } from '../utils/ApiError.js';
import { durationMinutes, hoursText, rupees } from '../utils/money.js';
import { createPayableFor, markSettled } from './payouts.service.js';
import { penalize } from '../utils/reliability.js';
import { audit } from '../utils/audit.js';
import { notify } from './notify.js';
import { emitMissionUpdate } from '../socket.js';

const MIN = 60 * 1000;
export const CHECKIN_EARLY_MS = 30 * MIN;
export const CHECKOUT_LATE_MS = 60 * MIN;
const LATE_GRACE_MS = 10 * MIN;

// Who may scan or override attendance: platform admin, anyone in the organization, or the role's team lead.
export async function canScanShift(user, shift) {
  if (user.role === 'admin') return true;
  const org = await Organization.findById(shift.orgId).select('members');
  if (org?.members.some((m) => String(m.userId) === String(user.id))) return true;
  return !!(await EventRole.exists({ _id: shift.roleId, leadId: user.id }));
}

export function assertScanWindow(shift, now = new Date()) {
  if (shift.status !== 'open') throw ApiError.conflict('This shift was cancelled');
  // Relaxed for testing: allow scanning anytime
  // if (now < new Date(shift.start - CHECKIN_EARLY_MS)) throw ApiError.conflict('Check-in opens 30 minutes before the shift starts');
  // if (now > new Date(+shift.end + CHECKOUT_LATE_MS)) throw ApiError.conflict('This shift ended too long ago to scan. Use a manual override with a reason.');
}

export async function checkIn(signup, shift, byUserId, { at = new Date(), manual = false } = {}) {
  try {
    const record = await Attendance.create({
      signupId: signup._id, shiftId: shift._id, eventId: shift.eventId, orgId: shift.orgId, roleId: shift.roleId, userId: signup.userId,
      status: 'checked_in', checkInAt: at, checkInBy: byUserId, late: at > new Date(+shift.start + LATE_GRACE_MS), manual,
    });
    emitMissionUpdate(shift.eventId, { reason: 'check_in', details: { userId: signup.userId, shiftId: shift._id } });
    return record;
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This volunteer is already checked in');
    throw err;
  }
}

export async function checkOut(attendance, shift, byUserId, { at = new Date(), manual = false } = {}) {
  const cap = durationMinutes(shift.start, shift.end);
  const worked = Math.max(0, Math.min(Math.round((at - attendance.checkInAt) / MIN), cap));
  const isEarlyCheckout = at < new Date(+shift.end - 15 * MIN);

  const done = await Attendance.findOneAndUpdate(
    { _id: attendance._id, status: 'checked_in' },
    {
      $set: {
        status: 'completed',
        checkOutAt: at,
        checkOutBy: byUserId,
        minutesWorked: worked,
        earlyCheckout: isEarlyCheckout,
        ...(manual ? { manual: true } : {}),
      },
    },
    { new: true }
  );
  if (!done) throw ApiError.conflict('This volunteer is already checked out');

  if (isEarlyCheckout) {
    await penalize(attendance.userId, 5);
    await notify(attendance.userId, {
      type: 'reliability_penalty',
      title: 'Reliability score dropped (-5)',
      body: 'You checked out earlier than the scheduled shift end. Your reliability score dropped by 5 points.',
      link: '/my-shifts',
    });
  }

  emitMissionUpdate(attendance.eventId || shift.eventId, { reason: 'check_out', details: { userId: attendance.userId, shiftId: shift._id } });
  return done;
}

export async function markNoShow(signup, shift, { notifyUser = true } = {}) {
  try {
    const att = await Attendance.create({
      signupId: signup._id, shiftId: shift._id, eventId: shift.eventId, orgId: shift.orgId, roleId: shift.roleId, userId: signup.userId, status: 'no_show',
    });
    await markSettled(signup._id);
    await penalize(signup.userId, 10);
    if (notifyUser) {
      await notify(signup.userId, {
        type: 'no_show',
        title: 'You were marked absent (-10 Reliability)',
        body: 'You did not check in for your confirmed shift. Your reliability score dropped by 10 points. If this is a mistake, raise a dispute from My shifts.',
        link: '/my-shifts',
      });
    }
    emitMissionUpdate(shift.eventId, { reason: 'no_show', details: { userId: signup.userId, shiftId: shift._id } });
    return att;
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
}

export async function approveAttendance(attendanceId, actor, { minutes, reason } = {}) {
  const att = await Attendance.findById(attendanceId);
  if (!att) throw ApiError.notFound('Attendance record not found');
  if (att.status !== 'completed') {
    throw ApiError.conflict(att.status === 'checked_in' ? 'This volunteer has not checked out yet' : `This record is already ${att.status.replace('_', ' ')}`);
  }
  const shift = await Shift.findById(att.shiftId);
  const finalMinutes = minutes ?? att.minutesWorked;
  if (finalMinutes !== att.minutesWorked && !reason) throw ApiError.badRequest('Give a reason when you change the hours');

  const done = await Attendance.findOneAndUpdate(
    { _id: att._id, status: 'completed' },
    { $set: {
      status: 'approved', approvedMinutes: finalMinutes, approvedBy: actor.id, approvedAt: new Date(),
      ...(finalMinutes !== att.minutesWorked ? { adjustedMinutes: finalMinutes, adjustReason: reason } : {}),
    } },
    { new: true }
  );
  if (!done) throw ApiError.conflict('This record was just approved by someone else');

  const payable = await createPayableFor(done, shift, finalMinutes);
  await markSettled(done.signupId);
  await audit(actor, finalMinutes !== att.minutesWorked ? 'attendance.adjusted' : 'attendance.approved', {
    entityType: 'Attendance', entityId: done._id, orgId: done.orgId, eventId: done.eventId,
    meta: { recorded: att.minutesWorked, approved: finalMinutes, reason, amount: payable?.amount },
  });
  await notify(done.userId, {
    type: 'hours_approved', title: 'Your hours were approved',
    body: `${hoursText(finalMinutes)} approved.${payable ? ` ${rupees(payable.amount)} is ready to be paid out.` : ''}`, link: '/earnings', email: false,
  });
  emitMissionUpdate(done.eventId, { reason: 'attendance_approved' });
  return { attendance: done, payable };
}

export async function rejectAttendance(attendanceId, actor, reason) {
  const done = await Attendance.findOneAndUpdate(
    { _id: attendanceId, status: { $in: ['completed', 'no_show'] } },
    { $set: { status: 'rejected', rejectReason: reason, approvedBy: actor.id, approvedAt: new Date() } },
    { new: true }
  );
  if (!done) throw ApiError.conflict('This record cannot be rejected');
  await markSettled(done.signupId);
  await audit(actor, 'attendance.rejected', { entityType: 'Attendance', entityId: done._id, orgId: done.orgId, eventId: done.eventId, meta: { reason } });
  await notify(done.userId, { type: 'hours_rejected', title: 'Your hours were not approved', body: `Reason: ${reason}. You can raise a dispute from My shifts.`, link: '/my-shifts' });
  emitMissionUpdate(done.eventId, { reason: 'attendance_rejected' });
  return done;
}

// Scheduler task: for shifts that ended, close forgotten check-outs and mark absentees.
export async function processEndedShifts() {
  const cutoff = new Date(Date.now() - 30 * MIN);
  let handled = 0;
  for (;;) {
    const shift = await Shift.findOneAndUpdate(
      { status: 'open', end: { $lt: cutoff }, attendanceProcessedAt: null },
      { $set: { attendanceProcessedAt: new Date() } }, { new: true }
    );
    if (!shift) break;
    handled += 1;
    const open = await Attendance.find({ shiftId: shift._id, status: 'checked_in' });
    for (const a of open) {
      const worked = Math.max(0, Math.min(Math.round((shift.end - a.checkInAt) / MIN), durationMinutes(shift.start, shift.end)));
      await Attendance.updateOne({ _id: a._id, status: 'checked_in' }, { $set: { status: 'completed', checkOutAt: shift.end, minutesWorked: worked, autoClosed: true } });
    }
    const confirmed = await Signup.find({ shiftId: shift._id, status: 'confirmed' });
    const have = new Set((await Attendance.find({ shiftId: shift._id }).select('signupId')).map((a) => String(a.signupId)));
    for (const s of confirmed) if (!have.has(String(s._id))) await markNoShow(s, shift);
  }
  return handled;
}
