import { Router } from 'express';
import { z } from 'zod';
import { Shift } from '../../models/Shift.js';
import { Signup, ACTIVE_SIGNUP } from '../../models/Signup.js';
import { Event } from '../../models/Event.js';
import { EventRole } from '../../models/EventRole.js';
import { Attendance } from '../../models/Attendance.js';
import { Dispute } from '../../models/Community.js';
import { User } from '../../models/User.js';
import { Organization } from '../../models/Organization.js';
import { Payable } from '../../models/Money.js';
import { SwapRequest } from '../../models/SwapRequest.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { joinLimiter } from '../../middleware/limits.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { isPubliclyListed } from '../../utils/eventStatus.js';
import { audit } from '../../utils/audit.js';
import { estimatePay } from '../../utils/money.js';
import * as svc from '../../services/shifts.service.js';

const router = Router();
// Scoped, because this router is mounted at /api alongside others that include public routes.
router.use(['/events/:eventId/shifts', '/shifts', '/signups', '/me/shifts'], requireAuth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;

const shiftFields = {
  roleId: objectId,
  start: z.coerce.date(),
  end: z.coerce.date(),
  capacity: z.coerce.number().int().min(1, 'At least 1 volunteer').max(500),
  payType: z.enum(['unpaid', 'hourly', 'flat']).default('unpaid'),
  rateRupees: z.coerce.number().min(0).max(100000).default(0),
  notes: z.string().trim().max(500).default(''),
};
const createSchema = z.object(shiftFields);
const updateSchema = z.object(shiftFields).omit({ roleId: true }).partial();
const idParam = z.object({ id: objectId });
const eventParam = z.object({ eventId: objectId });

const toPaise = (rupees) => Math.round(rupees * 100);

function checkShape({ start, end, payType, rate }) {
  if (end <= start) throw ApiError.badRequest('Shift end must be after its start');
  if (end - start > MAX_SHIFT_MS) throw ApiError.badRequest('A shift can be at most 16 hours long');
  if (payType !== 'unpaid' && !(rate > 0)) throw ApiError.badRequest('Enter the pay amount for a paid shift');
}

async function managedEvent(eventId, user) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');
  const org = await assertOrgMember(event.orgId, user);
  return { event, org };
}

async function managedShift(shiftId, user) {
  const shift = await Shift.findById(shiftId);
  if (!shift) throw ApiError.notFound('Shift not found');
  await assertOrgMember(shift.orgId, user);
  return shift;
}

export function shiftState(shift, now = new Date()) {
  if (shift.status === 'cancelled') return 'cancelled';
  if (shift.end < now) return 'completed';
  if (shift.start <= now) return 'in_progress';
  return shift.spotsLeft === 0 ? 'full' : 'open';
}

/* ---------------- List shifts for an event ---------------- */
router.get(
  '/events/:eventId/shifts',
  validate({ params: eventParam }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    const org = await Organization.findById(event.orgId).select('members');
    const manager = req.user.role === 'admin' || !!org?.members.some((m) => String(m.userId) === req.user.id);
    if (!manager) {
      const codeOk = event.visibility !== 'invite_only' || (req.query.code && req.query.code === event.inviteCode);
      if (!isPubliclyListed(event.status) || !codeOk) throw ApiError.notFound('Event not found');
    }

    const shifts = await Shift.find({ eventId: event._id }).sort({ start: 1 });
    const ids = shifts.map((s) => s._id);
    const [mine, waitlisted] = await Promise.all([
      Signup.find({ shiftId: { $in: ids }, userId: req.user.id, status: { $in: [...ACTIVE_SIGNUP, 'rejected'] } }),
      Signup.find({ shiftId: { $in: ids }, status: 'waitlisted' }).select('shiftId'),
    ]);
    const mineBy = Object.fromEntries(mine.map((m) => [String(m.shiftId), { _id: m._id, status: m.status }]));
    const waitBy = waitlisted.reduce((a, w) => ({ ...a, [String(w.shiftId)]: (a[String(w.shiftId)] || 0) + 1 }), {});

    res.json({
      shifts: shifts.map((s) => ({
        ...s.toObject(),
        state: shiftState(s),
        confirmed: s.capacity - s.spotsLeft,
        waitlistCount: waitBy[String(s._id)] || 0,
        estPay: estimatePay(s),
        mySignup: mineBy[String(s._id)] || null,
      })),
    });
  })
);

/* ---------------- Create / edit / cancel ---------------- */
router.post(
  '/events/:eventId/shifts',
  validate({ params: eventParam, body: createSchema }),
  asyncHandler(async (req, res) => {
    const { event } = await managedEvent(req.params.eventId, req.user);
    if (!['draft', 'published', 'ongoing'].includes(event.status)) throw ApiError.conflict(`You cannot add shifts to a ${event.status} event`);
    const { roleId, start, end, capacity, payType, rateRupees, notes } = req.valid.body;
    const role = await EventRole.findOne({ _id: roleId, eventId: event._id });
    if (!role) throw ApiError.badRequest('Choose a role from this event');
    const rate = payType === 'unpaid' ? 0 : toPaise(rateRupees);
    checkShape({ start, end, payType, rate });
    if (start <= new Date()) throw ApiError.badRequest('A shift must start in the future');
    if (start < event.startDate || start > event.endDate) throw ApiError.badRequest('A shift must start within the event dates');

    const shift = await Shift.create({ eventId: event._id, roleId, orgId: event.orgId, start, end, capacity, spotsLeft: capacity, payType, rate, notes });
    await audit(req.user, 'shift.created', { entityType: 'Shift', entityId: shift._id, orgId: event.orgId, eventId: event._id });
    res.status(201).json({ shift });
  })
);

router.patch(
  '/shifts/:id',
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req, res) => {
    const shift = await managedShift(req.params.id, req.user);
    const { rateRupees, ...rest } = req.valid.body;
    const changes = { ...rest };
    if (rateRupees !== undefined) changes.rate = toPaise(rateRupees);
    if (changes.payType === 'unpaid') changes.rate = 0;
    const merged = { ...shift.toObject(), ...changes };
    checkShape(merged);
    if (changes.start && changes.start <= new Date()) throw ApiError.badRequest('A shift must start in the future');
    const updated = await svc.updateShift(shift, changes);
    await audit(req.user, 'shift.updated', { entityType: 'Shift', entityId: shift._id, orgId: shift.orgId, eventId: shift.eventId, meta: Object.keys(changes) });
    res.json({ shift: updated });
  })
);

router.delete(
  '/shifts/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const shift = await managedShift(req.params.id, req.user);
    if (await Attendance.exists({ shiftId: shift._id })) throw ApiError.conflict('Attendance exists for this shift, so it cannot be cancelled');
    const affected = await svc.cancelShift(shift, req.body?.reason);
    await audit(req.user, 'shift.cancelled', { entityType: 'Shift', entityId: shift._id, orgId: shift.orgId, eventId: shift.eventId, meta: { affected } });
    res.json({ cancelled: true, notified: affected });
  })
);

/* ---------------- Volunteer actions ---------------- */
router.post(
  '/shifts/:id/join',
  joinLimiter,
  validate({ params: idParam, body: z.object({ inviteCode: z.string().max(40).optional() }) }),
  asyncHandler(async (req, res) => {
    const signup = await svc.joinShift(req.params.id, req.user, req.valid.body.inviteCode);
    res.status(201).json({ signup: { _id: signup._id, status: signup.status } });
  })
);

router.post(
  '/shifts/:id/leave',
  joinLimiter,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const signup = await Signup.findOne({ shiftId: req.params.id, userId: req.user.id });
    if (!signup) throw ApiError.notFound('You have not joined this shift');
    const result = await svc.leaveSignup(signup._id);
    res.json({ left: true, lateCancel: !!result.lateCancel });
  })
);

router.get(
  '/me/shifts',
  asyncHandler(async (req, res) => {
    const signups = await Signup.find({ userId: req.user.id, status: { $nin: ['confirming'] } }).sort({ start: -1 }).limit(200);
    const [shifts, attendance, disputes, payables, swaps] = await Promise.all([
      Shift.find({ _id: { $in: signups.map((s) => s.shiftId) } }),
      Attendance.find({ signupId: { $in: signups.map((s) => s._id) } }),
      Dispute.find({ raisedBy: req.user.id }).select('attendanceId status'),
      Payable.find({ userId: req.user.id }),
      SwapRequest.find({ fromSignupId: { $in: signups.map((s) => s._id) }, status: { $in: ['open', 'claimed'] } }),
    ]);
    const [events, roles] = await Promise.all([
      Event.find({ _id: { $in: shifts.map((s) => s.eventId) } }).select('title venue status cancelReason'),
      EventRole.find({ _id: { $in: shifts.map((s) => s.roleId) } }).select('name'),
    ]);
    const by = (arr) => Object.fromEntries(arr.map((x) => [String(x._id), x]));
    const S = by(shifts), E = by(events), R = by(roles);
    const A = Object.fromEntries(attendance.map((a) => [String(a.signupId), a]));
    const D = Object.fromEntries(disputes.map((d) => [String(d.attendanceId), d.status]));
    const P = Object.fromEntries(payables.map((p) => [String(p.attendanceId), p]));
    const SW = Object.fromEntries(swaps.map((sw) => [String(sw.fromSignupId), sw]));

    const mapped = signups
      .map((s) => {
        const sh = S[String(s.shiftId)];
        const a = A[String(s._id)];
        const ev = E[String(s.eventId)];
        const sw = SW[String(s._id)];
        const payable = a ? P[String(a._id)] : null;
        const isPaid = payable?.status === 'paid';
        const isEventCancelled = ev?.status === 'cancelled';
        const isShiftCancelled = s.status === 'cancelled' || sh?.status === 'cancelled' || s.status === 'rejected';

        const isCancelled = isEventCancelled || isShiftCancelled;

        return {
          _id: s._id,
          status: s.status,
          lateCancel: s.lateCancel,
          estPay: s.estPay,
          shift: sh && { _id: sh._id, start: sh.start, end: sh.end, payType: sh.payType, rate: sh.rate, state: shiftState(sh), notes: sh.notes },
          event: ev && { _id: s.eventId, title: ev.title, venue: ev.venue, status: ev.status, cancelReason: ev.cancelReason },
          role: R[String(s.roleId)]?.name,
          attendance: a && { _id: a._id, status: a.status, minutesWorked: a.minutesWorked, approvedMinutes: a.approvedMinutes, late: a.late, earlyCheckout: a.earlyCheckout, dispute: D[String(a._id)] || null },
          payable: payable && { status: payable.status, amount: payable.amount },
          swap: sw ? { _id: sw._id, status: sw.status, note: sw.note, claimedBy: sw.claimedBy, expiresAt: sw.expiresAt } : null,
          isPaid,
          isCancelled,
          isEventCancelled,
          isShiftCancelled,
        };
      });

    res.json({ signups: mapped });
  })
);

/* ---------------- Organizer: roster and decisions ---------------- */
router.get(
  '/shifts/:id/signups',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const shift = await managedShift(req.params.id, req.user);
    const signups = await Signup.find({ shiftId: shift._id, status: { $in: ['confirmed', 'pending', 'waitlisted'] } }).sort({ joinedAt: 1 });
    const users = await User.find({ _id: { $in: signups.map((s) => s.userId) } }).select('name email phone skills reliabilityScore');
    const U = Object.fromEntries(users.map((u) => [String(u._id), u]));
    res.json({ signups: signups.map((s) => ({ _id: s._id, status: s.status, joinedAt: s.joinedAt, user: U[String(s.userId)] })) });
  })
);

async function managedSignup(id, user) {
  const signup = await Signup.findById(id);
  if (!signup) throw ApiError.notFound('Sign-up not found');
  await assertOrgMember(signup.orgId, user);
  return signup;
}

router.post('/signups/:id/approve', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const signup = await managedSignup(req.params.id, req.user);
  const status = await svc.approveSignup(signup._id);
  await audit(req.user, 'signup.approved', { entityType: 'Signup', entityId: signup._id, orgId: signup.orgId, eventId: signup.eventId });
  res.json({ status });
}));

router.post('/signups/:id/reject', validate({ params: idParam, body: z.object({ reason: z.string().trim().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const signup = await managedSignup(req.params.id, req.user);
  await svc.rejectSignup(signup._id, req.valid.body.reason);
  await audit(req.user, 'signup.rejected', { entityType: 'Signup', entityId: signup._id, orgId: signup.orgId, eventId: signup.eventId });
  res.json({ rejected: true });
}));

router.post('/signups/:id/remove', validate({ params: idParam, body: z.object({ reason: z.string().trim().max(200).optional() }) }), asyncHandler(async (req, res) => {
  const signup = await managedSignup(req.params.id, req.user);
  await svc.leaveSignup(signup._id, { byOrganizer: true, reason: req.valid.body.reason });
  await audit(req.user, 'signup.removed', { entityType: 'Signup', entityId: signup._id, orgId: signup.orgId, eventId: signup.eventId, meta: { reason: req.valid.body.reason } });
  res.json({ removed: true });
}));

export default router;
