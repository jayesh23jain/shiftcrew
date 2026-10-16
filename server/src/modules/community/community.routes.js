import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Certificate, Dispute, Announcement } from '../../models/Community.js';
import { Attendance } from '../../models/Attendance.js';
import { Payable } from '../../models/Money.js';
import { Signup } from '../../models/Signup.js';
import { Shift } from '../../models/Shift.js';
import { Event } from '../../models/Event.js';
import { EventRole } from '../../models/EventRole.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { audit } from '../../utils/audit.js';
import { payForMinutes, hoursText } from '../../utils/money.js';
import { certificatePdf } from '../../services/pdf.js';
import { notify } from '../../services/notify.js';
import { approveAttendance } from '../../services/attendance.service.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const DAY = 24 * 60 * 60 * 1000;

/* ---------------- Public: certificate verification ---------------- */
router.get(
  '/certificates/verify/:code',
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findOne({ code: String(req.params.code).toUpperCase().slice(0, 30) });
    if (!cert) return res.json({ valid: false });
    res.json({ valid: true, volunteerName: cert.volunteerName, eventTitle: cert.eventTitle, orgName: cert.orgName, minutes: cert.minutes, issuedAt: cert.createdAt });
  })
);

router.use(requireAuth);

/* ---------------- Certificates ---------------- */
router.post(
  '/events/:eventId/certificates',
  validate({ params: z.object({ eventId: objectId }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    const org = await assertOrgMember(event.orgId, req.user);
    if (!['completed', 'settled'].includes(event.status)) throw ApiError.conflict('Certificates can be issued once the event is completed');

    const records = await Attendance.find({ eventId: event._id, status: 'approved' });
    const minutesBy = {};
    for (const r of records) minutesBy[String(r.userId)] = (minutesBy[String(r.userId)] || 0) + (r.approvedMinutes || 0);
    const users = await User.find({ _id: { $in: Object.keys(minutesBy) } }).select('name');

    let issued = 0;
    for (const u of users) {
      if (!(minutesBy[String(u._id)] > 0)) continue;
      const code = `SC-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      try {
        await Certificate.create({ userId: u._id, eventId: event._id, orgId: org._id, volunteerName: u.name, eventTitle: event.title, orgName: org.name, minutes: minutesBy[String(u._id)], code });
        issued += 1;
        await notify(u._id, { type: 'certificate', title: 'Your certificate is ready', body: `Download your volunteering certificate for ${event.title}.`, link: '/certificates' });
      } catch (err) { if (err.code !== 11000) throw err; }
    }
    await audit(req.user, 'certificates.issued', { entityType: 'Event', entityId: event._id, orgId: org._id, eventId: event._id, meta: { issued } });
    res.status(201).json({ issued, eligible: users.length });
  })
);

router.get('/certificates/mine', asyncHandler(async (req, res) => {
  res.json({ certificates: await Certificate.find({ userId: req.user.id }).sort({ createdAt: -1 }) });
}));

router.get(
  '/certificates/:id/pdf',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) throw ApiError.notFound('Certificate not found');
    if (String(cert.userId) !== req.user.id) await assertOrgMember(cert.orgId, req.user);
    const pdf = await certificatePdf({ cert });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.code}.pdf"`);
    res.send(pdf);
  })
);

/* ---------------- Disputes ---------------- */
router.post(
  '/disputes',
  validate({ body: z.object({ attendanceId: objectId, reason: z.string().trim().min(10, 'Explain what is wrong in a sentence or two').max(1000) }) }),
  asyncHandler(async (req, res) => {
    const att = await Attendance.findById(req.valid.body.attendanceId);
    if (!att || String(att.userId) !== req.user.id) throw ApiError.notFound('Attendance record not found');
    const shift = await Shift.findById(att.shiftId);
    if (Date.now() - shift.end > 7 * DAY) throw ApiError.conflict('Disputes must be raised within 7 days of the shift');
    if (await Dispute.exists({ attendanceId: att._id, status: 'open' })) throw ApiError.conflict('You already have an open dispute for this shift');

    const dispute = await Dispute.create({
      attendanceId: att._id, eventId: att.eventId, orgId: att.orgId, raisedBy: req.user.id, reason: req.valid.body.reason,
      timeline: [{ by: req.user.id, text: `Raised: ${req.valid.body.reason}` }],
    });
    const org = await Organization.findById(att.orgId).select('members');
    await notify((org?.members || []).map((m) => m.userId), { type: 'dispute_opened', title: 'A volunteer raised a dispute', body: req.valid.body.reason.slice(0, 140), link: `/manage/events/${att.eventId}`, email: false });
    res.status(201).json({ dispute });
  })
);

router.get('/disputes/mine', asyncHandler(async (req, res) => {
  res.json({ disputes: await Dispute.find({ raisedBy: req.user.id }).sort({ createdAt: -1 }).limit(100) });
}));

router.get(
  '/events/:eventId/disputes',
  validate({ params: z.object({ eventId: objectId }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    await assertOrgMember(event.orgId, req.user);
    const disputes = await Dispute.find({ eventId: event._id }).sort({ createdAt: -1 });
    const [users, atts] = await Promise.all([
      User.find({ _id: { $in: disputes.map((d) => d.raisedBy) } }).select('name'),
      Attendance.find({ _id: { $in: disputes.map((d) => d.attendanceId) } }).select('status minutesWorked approvedMinutes shiftId'),
    ]);
    const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    const A = Object.fromEntries(atts.map((a) => [String(a._id), a]));
    res.json({ disputes: disputes.map((d) => ({ ...d.toObject(), volunteer: U[String(d.raisedBy)], attendance: A[String(d.attendanceId)] })) });
  })
);

router.post(
  '/disputes/:id/resolve',
  validate({
    params: z.object({ id: objectId }),
    body: z.object({
      action: z.enum(['adjust', 'reject']),
      minutes: z.coerce.number().int().min(0).max(960).optional(),
      note: z.string().trim().min(3, 'Add a short note').max(500),
    }),
  }),
  asyncHandler(async (req, res) => {
    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) throw ApiError.notFound('Dispute not found');
    await assertOrgMember(dispute.orgId, req.user);
    if (dispute.status !== 'open') throw ApiError.conflict('This dispute is already closed');
    const { action, minutes, note } = req.valid.body;

    if (action === 'adjust') {
      if (minutes === undefined) throw ApiError.badRequest('Enter the corrected number of minutes');
      const att = await Attendance.findById(dispute.attendanceId);
      const shift = await Shift.findById(att.shiftId);
      const payable = await Payable.findOne({ attendanceId: att._id });
      if (payable && payable.status !== 'approved') throw ApiError.conflict('This shift has already been paid out, so it cannot be changed. Reject the dispute with a note instead.');

      if (att.status === 'approved') {
        const amount = payForMinutes(shift, minutes);
        await Attendance.updateOne({ _id: att._id }, { $set: { approvedMinutes: minutes, adjustedMinutes: minutes, adjustReason: `Dispute: ${note}` } });
        if (payable) await Payable.updateOne({ _id: payable._id, status: 'approved' }, { $set: { minutes, amount } });
      } else {
        // pending, rejected or no-show: reopen as completed with the corrected minutes, then approve.
        await Attendance.updateOne({ _id: att._id }, { $set: { status: 'completed', minutesWorked: minutes, rejectReason: undefined, manual: true } });
        await approveAttendance(att._id, req.user, { minutes, reason: `Dispute: ${note}` });
      }
    }

    dispute.status = action === 'adjust' ? 'resolved' : 'rejected';
    dispute.resolution = note;
    dispute.resolvedBy = req.user.id;
    dispute.timeline.push({ by: req.user.id, text: `${action === 'adjust' ? `Hours corrected to ${hoursText(minutes)}` : 'Dispute rejected'}: ${note}` });
    await dispute.save();
    await audit(req.user, `dispute.${dispute.status}`, { entityType: 'Dispute', entityId: dispute._id, orgId: dispute.orgId, eventId: dispute.eventId, meta: { action, minutes, note } });
    await notify(dispute.raisedBy, { type: 'dispute_resolved', title: action === 'adjust' ? 'Your dispute was accepted' : 'Your dispute was reviewed', body: note, link: '/my-shifts' });
    res.json({ dispute });
  })
);

/* ---------------- Announcements ---------------- */
const announceSchema = z.object({
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().min(3, 'Write a message').max(2000),
  audience: z.enum(['all', 'role', 'shift']).default('all'),
  roleId: objectId.optional(),
  shiftId: objectId.optional(),
});

router.post(
  '/events/:eventId/announcements',
  validate({ params: z.object({ eventId: objectId }), body: announceSchema }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    await assertOrgMember(event.orgId, req.user);
    const { audience, roleId, shiftId, title, message } = req.valid.body;

    const filter = { eventId: event._id, status: 'confirmed' };
    if (audience === 'role') { if (!roleId) throw ApiError.badRequest('Choose a role'); filter.roleId = roleId; }
    if (audience === 'shift') { if (!shiftId) throw ApiError.badRequest('Choose a shift'); filter.shiftId = shiftId; }
    const recipients = [...new Set((await Signup.find(filter).select('userId')).map((s) => String(s.userId)))];

    const a = await Announcement.create({ eventId: event._id, authorId: req.user.id, title, message, audience, roleId, shiftId, recipients: recipients.length });
    await notify(recipients, { type: 'announcement', title: title || `Update from ${event.title}`, body: message, link: `/events/${event._id}` });
    await audit(req.user, 'announcement.sent', { entityType: 'Announcement', entityId: a._id, orgId: event.orgId, eventId: event._id, meta: { audience, recipients: recipients.length } });
    res.status(201).json({ announcement: a, recipients: recipients.length });
  })
);

router.get(
  '/events/:eventId/announcements',
  validate({ params: z.object({ eventId: objectId }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    const org = await Organization.findById(event.orgId).select('members');
    const manager = req.user.role === 'admin' || org?.members.some((m) => String(m.userId) === req.user.id);
    // Volunteers see the notice board only if they hold a spot in this event.
    if (!manager && !(await Signup.exists({ eventId: event._id, userId: req.user.id, status: { $in: ['confirmed', 'waitlisted', 'pending'] } }))) {
      return res.json({ announcements: [] });
    }
    const q = manager ? { eventId: event._id } : { eventId: event._id, audience: 'all' };
    res.json({ announcements: await Announcement.find(q).sort({ createdAt: -1 }).limit(30) });
  })
);

export default router;
void EventRole;
