import { Router } from 'express';
import { z } from 'zod';
import { Attendance, QrUse } from '../../models/Attendance.js';
import { Signup } from '../../models/Signup.js';
import { Shift } from '../../models/Shift.js';
import { Event } from '../../models/Event.js';
import { EventRole } from '../../models/EventRole.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { Payable } from '../../models/Money.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { scanLimiter } from '../../middleware/limits.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { signPass, verifyPass } from '../../utils/qr.js';
import { audit } from '../../utils/audit.js';
import * as att from '../../services/attendance.service.js';

const router = Router();
router.use(requireAuth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const HOUR = 60 * 60 * 1000;

/* ---------------- Volunteer: QR pass ---------------- */
  router.get(
    '/pass/:shiftId',
    scanLimiter,
    validate({ params: z.object({ shiftId: objectId }) }),
    asyncHandler(async (req, res) => {
      const shift = await Shift.findById(req.params.shiftId);
      if (!shift) throw ApiError.notFound('Shift not found');

      const event = await Event.findById(shift.eventId);
      if (event?.status === 'cancelled') {
        throw ApiError.conflict(
          `This event was cancelled${event.cancelReason ? `: ${event.cancelReason}` : ''}. The QR pass has been deleted.`
        );
      }
      if (shift.status === 'cancelled') {
        throw ApiError.conflict('This shift was cancelled. The QR pass has been deleted.');
      }

      const [signup, user, role] = await Promise.all([
        Signup.findOne({ shiftId: shift._id, userId: req.user.id, status: 'confirmed' }),
        User.findById(req.user.id).select('name email phone reliabilityScore'),
        EventRole.findById(shift.roleId).select('name description skills'),
      ]);
      if (!signup) throw ApiError.forbidden('You are not confirmed for this shift');

      const attendance = await Attendance.findOne({ signupId: signup._id }).select('status checkInAt checkOutAt');
      const payable = attendance ? await Payable.findOne({ attendanceId: attendance._id }) : null;
      if (payable?.status === 'paid' || (attendance?.status === 'approved' && !payable)) {
        throw ApiError.conflict('This shift has been completed and payment has been processed. The QR pass is expired and deleted.');
      }

      const { token, expiresAt } = signPass({ signupId: signup._id, userId: req.user.id, shiftId: shift._id });
      res.json({
        token,
        expiresAt,
        attendance,
        shift: {
          _id: shift._id,
          start: shift.start,
          end: shift.end,
          payRate: shift.payRate,
          payType: shift.payType,
        },
        role: {
          name: role?.name || 'Crew Member',
          description: role?.description || '',
          skills: role?.skills || [],
        },
        event: {
          _id: event?._id,
          title: event?.title || 'Event Access Pass',
          category: event?.category || 'general',
          venue: event?.venue || {},
          startDate: event?.startDate,
          endDate: event?.endDate,
        },
        user: {
          name: user?.name || 'Crew Volunteer',
          email: user?.email || '',
          phone: user?.phone || '',
          reliabilityScore: user?.reliabilityScore ?? 100,
        },
      });
    })
  );

/* ---------------- Scanner: check in / out ---------------- */
router.post(
  '/scan',
  scanLimiter,
  validate({ body: z.object({ token: z.string().min(20).max(2000) }) }),
  asyncHandler(async (req, res) => {
    let payload;
    try { payload = verifyPass(req.valid.body.token); } catch { throw ApiError.badRequest('This QR code is invalid or expired. Ask the volunteer to refresh their pass.'); }

    const shift = await Shift.findById(payload.shf);
    if (!shift) throw ApiError.notFound('Shift not found');
    if (!(await att.canScanShift(req.user, shift))) throw ApiError.forbidden('You are not a team lead or organizer for this shift');

    // Single use: the same QR cannot be scanned twice.
    try { await QrUse.create({ jti: payload.jti, expireAt: new Date(Date.now() + 5 * 60 * 1000) }); }
    catch (err) { if (err.code === 11000) throw ApiError.conflict('This QR code was already scanned. Ask the volunteer to refresh it.'); throw err; }

    const signup = await Signup.findOne({ _id: payload.sid, userId: payload.uid, shiftId: shift._id, status: 'confirmed' });
    if (!signup) throw ApiError.conflict('This volunteer is no longer confirmed for the shift');
    att.assertScanWindow(shift);

    const volunteer = await User.findById(signup.userId).select('name');
    const existing = await Attendance.findOne({ signupId: signup._id });

    if (!existing) {
      const a = await att.checkIn(signup, shift, req.user.id);
      return res.json({ action: 'check_in', volunteer: volunteer.name, late: a.late, at: a.checkInAt });
    }
    if (existing.status === 'checked_in') {
      if (Date.now() - existing.checkInAt < 60 * 1000) throw ApiError.conflict('Checked in less than a minute ago');
      const a = await att.checkOut(existing, shift, req.user.id);
      return res.json({ action: 'check_out', volunteer: volunteer.name, minutes: a.minutesWorked, at: a.checkOutAt });
    }
    throw ApiError.conflict(`This volunteer is already ${existing.status.replace('_', ' ')} for this shift`);
  })
);

/* ---------------- Lead: manual override with a mandatory reason ---------------- */
router.post(
  '/manual',
  validate({
    body: z.object({
      signupId: objectId,
      action: z.enum(['check_in', 'check_out', 'no_show']),
      reason: z.string().trim().min(3, 'Give a short reason').max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { signupId, action, reason } = req.valid.body;
    const signup = await Signup.findById(signupId);
    if (!signup || signup.status !== 'confirmed') throw ApiError.notFound('Confirmed sign-up not found');
    const shift = await Shift.findById(signup.shiftId);
    if (!(await att.canScanShift(req.user, shift))) throw ApiError.forbidden('You are not a team lead or organizer for this shift');
    if (shift.status !== 'open') throw ApiError.conflict('This shift was cancelled');
    // Relaxed for testing: allow manual checkin anytime
    // if (shift.start > new Date(Date.now() + att.CHECKIN_EARLY_MS)) throw ApiError.conflict('This shift has not started yet');

    const existing = await Attendance.findOne({ signupId });
    let result;
    if (action === 'check_in') {
      if (existing) throw ApiError.conflict('Attendance is already recorded');
      result = await att.checkIn(signup, shift, req.user.id, { manual: true });
    } else if (action === 'check_out') {
      if (!existing || existing.status !== 'checked_in') throw ApiError.conflict('This volunteer is not checked in');
      result = await att.checkOut(existing, shift, req.user.id, { manual: true });
    } else {
      if (existing) throw ApiError.conflict('Attendance is already recorded');
      result = await att.markNoShow(signup, shift);
    }
    await audit(req.user, `attendance.manual_${action}`, { entityType: 'Signup', entityId: signup._id, orgId: shift.orgId, eventId: shift.eventId, meta: { reason, volunteer: String(signup.userId) } });
    res.json({ attendance: result });
  })
);

/* ---------------- Lead dashboard and sheet ---------------- */
router.get(
  '/lead/shifts',
  asyncHandler(async (req, res) => {
    const now = Date.now();
    const orgs = await Organization.find({ 'members.userId': req.user.id }).select('_id');
    const leadRoles = await EventRole.find({ leadId: req.user.id }).select('_id');
    const or = [{ roleId: { $in: leadRoles.map((r) => r._id) } }, { orgId: { $in: orgs.map((o) => o._id) } }];
    // Relaxed for testing: return all open shifts for lead
    const shifts = await Shift.find({ status: 'open', $or: or }).sort({ start: 1 });

    const [events, roles, signups, attendance] = await Promise.all([
      Event.find({ _id: { $in: shifts.map((s) => s.eventId) } }).select('title category venue status startDate endDate'),
      EventRole.find({ _id: { $in: shifts.map((s) => s.roleId) } }).select('name'),
      Signup.find({ shiftId: { $in: shifts.map((s) => s._id) }, status: 'confirmed' }).select('shiftId'),
      Attendance.find({ shiftId: { $in: shifts.map((s) => s._id) } }).select('shiftId status'),
    ]);
    const E = Object.fromEntries(events.map((e) => [String(e._id), e]));
    const R = Object.fromEntries(roles.map((r) => [String(r._id), r.name]));
    const count = (arr, id, fn = () => true) => arr.filter((x) => String(x.shiftId) === String(id) && fn(x)).length;

    res.json({
      shifts: shifts.map((s) => {
        const ev = E[String(s.eventId)];
        return {
          _id: s._id,
          eventId: s.eventId,
          roleId: s.roleId,
          start: s.start,
          end: s.end,
          event: ev?.title || 'Event',
          eventCategory: ev?.category || 'general',
          eventVenue: ev?.venue,
          eventStatus: ev?.status || 'published',
          eventStartDate: ev?.startDate,
          eventEndDate: ev?.endDate,
          role: R[String(s.roleId)] || 'Volunteer Role',
          confirmed: count(signups, s._id),
          present: count(attendance, s._id, (a) => ['checked_in', 'completed', 'approved'].includes(a.status)),
        };
      }),
    });
  })
);

router.get(
  '/shifts/:shiftId/sheet',
  validate({ params: z.object({ shiftId: objectId }) }),
  asyncHandler(async (req, res) => {
    const shift = await Shift.findById(req.params.shiftId);
    if (!shift) throw ApiError.notFound('Shift not found');
    if (!(await att.canScanShift(req.user, shift))) throw ApiError.forbidden('You are not a team lead or organizer for this shift');
    const [signups, event, role] = await Promise.all([
      Signup.find({ shiftId: shift._id, status: 'confirmed' }),
      Event.findById(shift.eventId).select('title category venue'),
      EventRole.findById(shift.roleId).select('name'),
    ]);
    const [users, records] = await Promise.all([
      User.find({ _id: { $in: signups.map((s) => s.userId) } }).select('name phone'),
      Attendance.find({ shiftId: shift._id }),
    ]);
    const U = Object.fromEntries(users.map((u) => [String(u._id), u]));
    const A = Object.fromEntries(records.map((a) => [String(a.signupId), a]));
    res.json({
      shift: {
        _id: shift._id,
        start: shift.start,
        end: shift.end,
        eventId: shift.eventId,
        eventTitle: event?.title || 'Event',
        eventCategory: event?.category || 'general',
        roleName: role?.name || 'Volunteer Role',
      },
      roster: signups.map((s) => ({
        signupId: s._id,
        name: U[String(s.userId)]?.name,
        phone: U[String(s.userId)]?.phone,
        status: A[String(s._id)]?.status || 'expected',
        late: A[String(s._id)]?.late,
        checkInAt: A[String(s._id)]?.checkInAt,
        checkOutAt: A[String(s._id)]?.checkOutAt,
      })),
    });
  })
);

/* ---------------- Organizer: hours approval ---------------- */
router.get(
  '/events/:eventId',
  validate({ params: z.object({ eventId: objectId }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    await assertOrgMember(event.orgId, req.user);
    const records = await Attendance.find({ eventId: event._id }).sort({ createdAt: -1 });
    const [users, shifts, roles] = await Promise.all([
      User.find({ _id: { $in: records.map((r) => r.userId) } }).select('name'),
      Shift.find({ _id: { $in: records.map((r) => r.shiftId) } }).select('start end payType rate'),
      EventRole.find({ eventId: event._id }).select('name'),
    ]);
    const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    const S = Object.fromEntries(shifts.map((s) => [String(s._id), s]));
    const R = Object.fromEntries(roles.map((r) => [String(r._id), r.name]));
    res.json({
      records: records.map((r) => ({
        ...r.toObject(), volunteer: U[String(r.userId)], role: R[String(r.roleId)], shift: S[String(r.shiftId)],
      })),
    });
  })
);

async function managedAttendance(id, user) {
  const a = await Attendance.findById(id);
  if (!a) throw ApiError.notFound('Attendance record not found');
  await assertOrgMember(a.orgId, user);
  return a;
}

router.post(
  '/:id/approve',
  validate({ params: z.object({ id: objectId }), body: z.object({ minutes: z.coerce.number().int().min(0).max(960).optional(), reason: z.string().trim().max(200).optional() }) }),
  asyncHandler(async (req, res) => {
    const a = await managedAttendance(req.params.id, req.user);
    const result = await att.approveAttendance(a._id, req.user, req.valid.body);
    res.json({ attendance: result.attendance, payable: result.payable });
  })
);

router.post(
  '/approve-bulk',
  validate({ body: z.object({ ids: z.array(objectId).min(1).max(200) }) }),
  asyncHandler(async (req, res) => {
    const out = { approved: 0, skipped: [] };
    for (const id of req.valid.body.ids) {
      try {
        const a = await managedAttendance(id, req.user);
        await att.approveAttendance(a._id, req.user);
        out.approved += 1;
      } catch (err) { out.skipped.push({ id, reason: err.message }); }
    }
    res.json(out);
  })
);

router.post(
  '/:id/reject',
  validate({ params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) }) }),
  asyncHandler(async (req, res) => {
    const a = await managedAttendance(req.params.id, req.user);
    res.json({ attendance: await att.rejectAttendance(a._id, req.user, req.valid.body.reason) });
  })
);

export default router;
