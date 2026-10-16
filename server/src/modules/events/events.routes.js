import { Router } from 'express';
import { Event } from '../../models/Event.js';
import { EventRole } from '../../models/EventRole.js';
import { Organization } from '../../models/Organization.js';
import { Shift } from '../../models/Shift.js';
import { Signup } from '../../models/Signup.js';
import { Attendance } from '../../models/Attendance.js';
import { Payable } from '../../models/Money.js';
import { audit } from '../../utils/audit.js';
import { cancelAllShifts } from '../../services/shifts.service.js';
import { User } from '../../models/User.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import { canTransition, isEditable, isPubliclyListed } from '../../utils/eventStatus.js';
import {
  createEventSchema,
  updateEventSchema,
  statusSchema,
  listQuerySchema,
  mineQuerySchema,
  roleSchema,
  idParam,
  roleParams,
} from './events.schemas.js';

const router = Router();

// Loads an event and confirms the requester belongs to its organization.
async function loadManagedEvent(eventId, user) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');
  const org = await assertOrgMember(event.orgId, user);
  return { event, org };
}

const publicShape = (event, org) => {
  const obj = event.toObject();
  delete obj.inviteCode;
  delete obj.budgetEstimate;
  return { ...obj, organization: org ? { _id: org._id, name: org.name, verified: org.verified, city: org.city } : undefined };
};

/* ---------------- Event listing (logged-in users only) ---------------- */
router.get(
  '/',
  requireAuth,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { q, city, category, from, to, includePast, page, limit } = req.valid.query;
    const filter = { visibility: 'public', status: { $in: ['published', 'ongoing'] } };

    if (includePast !== 'true') filter.endDate = { $gte: new Date() };
    if (q) {
      const qRegex = { $regex: escapeRegex(q), $options: 'i' };
      filter.$or = [
        { title: qRegex },
        { description: qRegex },
        { 'venue.name': qRegex },
        { 'venue.city': qRegex },
      ];
    }
    if (city) filter['venue.city'] = { $regex: escapeRegex(city), $options: 'i' };
    if (category) filter.category = category;
    if (from || to) {
      filter.startDate = {};
      if (from) filter.startDate.$gte = from;
      if (to) filter.startDate.$lte = to;
    }

    const [events, total] = await Promise.all([
      Event.find(filter)
        .select('-inviteCode -budgetEstimate')
        .sort({ startDate: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('orgId', 'name verified'),
      Event.countDocuments(filter),
    ]);

    res.json({
      events: events.map((e) => {
        const obj = e.toObject();
        obj.organization = obj.orgId;
        obj.orgId = obj.orgId?._id;
        return obj;
      }),
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      total,
    });
  })
);

/* ---------------- Organizer: my events ---------------- */
router.get(
  '/mine',
  requireAuth,
  requireRole('organizer', 'admin'),
  validate({ query: mineQuerySchema }),
  asyncHandler(async (req, res) => {
    const { orgId, status, q, city, category, page = 1, limit = 50 } = req.valid.query;
    let orgIds;
    if (orgId) {
      await assertOrgMember(orgId, req.user);
      orgIds = [orgId];
    } else {
      const orgs = await Organization.find({ 'members.userId': req.user.id }).select('_id');
      orgIds = orgs.map((o) => o._id);
    }
    const filter = { orgId: { $in: orgIds } };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $nin: ['cancelled', 'settled'] };
    }
    if (category) filter.category = category;
    if (city) filter['venue.city'] = { $regex: escapeRegex(city), $options: 'i' };
    if (q) {
      const regex = { $regex: escapeRegex(q), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }, { 'venue.name': regex }];
    }

    const [events, total] = await Promise.all([
      Event.find(filter)
        .populate('orgId', 'name city verified')
        .sort({ startDate: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Event.countDocuments(filter),
    ]);

    const eventIds = events.map((e) => e._id);
    const [unpaidPayables, unapprovedAttendance] = await Promise.all([
      Payable.find({ eventId: { $in: eventIds }, status: { $in: ['approved', 'processing'] } }).select('eventId'),
      Attendance.find({ eventId: { $in: eventIds }, status: 'completed' }).select('eventId'),
    ]);

    const unpaidCountMap = {};
    for (const p of unpaidPayables) {
      unpaidCountMap[String(p.eventId)] = (unpaidCountMap[String(p.eventId)] || 0) + 1;
    }
    for (const a of unapprovedAttendance) {
      unpaidCountMap[String(a.eventId)] = (unpaidCountMap[String(a.eventId)] || 0) + 1;
    }

    // Completed events only stay on the organizer page if volunteers still need to be paid
    const filteredEvents = events.filter((e) => {
      if (e.status === 'cancelled') return false;
      const count = unpaidCountMap[String(e._id)] || 0;
      if (e.status === 'completed' && count === 0) return false;
      return true;
    });

    res.json({
      events: filteredEvents.map((e) => {
        const obj = e.toObject();
        obj.organization = obj.orgId;
        obj.orgId = obj.orgId?._id;
        const unpaidCrewCount = unpaidCountMap[String(e._id)] || 0;
        obj.unpaidCrewCount = unpaidCrewCount;
        obj.needsVolunteerPayout = e.status === 'completed' && unpaidCrewCount > 0;
        return obj;
      }),
      page,
      pages: Math.max(1, Math.ceil(filteredEvents.length / limit)),
      total: filteredEvents.length,
    });
  })
);

/* ---------------- Organizer: dashboard summary ---------------- */
router.get(
  '/mine/summary',
  requireAuth,
  requireRole('organizer', 'admin'),
  asyncHandler(async (req, res) => {
    const orgs = await Organization.find({ 'members.userId': req.user.id }).select('_id name');
    const orgIds = orgs.map((o) => o._id);

    const now = new Date();
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const [
      allEvents,
      activeEventsCount,
      totalVolunteersCount,
      upcomingShifts,
      unfilledSoonShifts,
      pendingAttendanceCount,
      pendingSignups,
    ] = await Promise.all([
      Event.find({ orgId: { $in: orgIds } })
        .select('title category startDate endDate status venue')
        .sort({ startDate: 1 }),
      Event.countDocuments({ orgId: { $in: orgIds }, status: { $in: ['published', 'ongoing'] } }),
      Signup.distinct('userId', { orgId: { $in: orgIds }, status: 'confirmed' }).then((u) => u.length),
      Shift.find({ orgId: { $in: orgIds }, end: { $gte: now }, status: { $ne: 'cancelled' } })
        .sort({ start: 1 })
        .limit(6)
        .populate('eventId', 'title')
        .populate('roleId', 'name'),
      Shift.find({
        orgId: { $in: orgIds },
        start: { $gte: now, $lte: in48h },
        spotsLeft: { $gt: 0 },
        status: { $ne: 'cancelled' },
      })
        .limit(5)
        .populate('eventId', 'title')
        .populate('roleId', 'name'),
      Attendance.countDocuments({ orgId: { $in: orgIds }, status: 'completed' }),
      Signup.find({ orgId: { $in: orgIds }, status: 'pending' })
        .sort({ joinedAt: 1 })
        .limit(15)
        .populate('userId', 'name email phone skills reliabilityScore')
        .populate('eventId', 'title')
        .populate('shiftId', 'start end capacity spotsLeft')
        .populate('roleId', 'name'),
    ]);

    const summaryEventIds = allEvents.map((e) => e._id);
    const [summaryUnpaidPayables, summaryUnapprovedAtt] = await Promise.all([
      Payable.find({ eventId: { $in: summaryEventIds }, status: { $in: ['approved', 'processing'] } }).select('eventId'),
      Attendance.find({ eventId: { $in: summaryEventIds }, status: 'completed' }).select('eventId'),
    ]);

    const summaryUnpaidMap = {};
    for (const p of summaryUnpaidPayables) {
      summaryUnpaidMap[String(p.eventId)] = (summaryUnpaidMap[String(p.eventId)] || 0) + 1;
    }
    for (const a of summaryUnapprovedAtt) {
      summaryUnpaidMap[String(a.eventId)] = (summaryUnpaidMap[String(a.eventId)] || 0) + 1;
    }

    const filteredSummaryEvents = allEvents
      .filter((e) => {
        if (e.status === 'cancelled') return false;
        const count = summaryUnpaidMap[String(e._id)] || 0;
        if (e.status === 'completed' && count === 0) return false;
        return true;
      })
      .map((e) => {
        const obj = e.toObject();
        const unpaidCrewCount = summaryUnpaidMap[String(e._id)] || 0;
        obj.unpaidCrewCount = unpaidCrewCount;
        obj.needsVolunteerPayout = e.status === 'completed' && unpaidCrewCount > 0;
        return obj;
      });

    res.json({
      totalEvents: filteredSummaryEvents.length,
      activeEvents: activeEventsCount,
      totalVolunteersHired: totalVolunteersCount,
      events: filteredSummaryEvents,
      upcomingShifts: upcomingShifts.map((s) => ({
        _id: s._id,
        eventId: s.eventId?._id,
        eventTitle: s.eventId?.title || 'Event',
        roleName: s.roleId?.name || 'Volunteer Role',
        start: s.start,
        end: s.end,
        capacity: s.capacity,
        spotsLeft: s.spotsLeft,
        confirmed: s.capacity - s.spotsLeft,
      })),
      pendingApprovals: pendingSignups.map((p) => ({
        _id: p._id,
        volunteerName: p.userId?.name || 'Volunteer',
        volunteerEmail: p.userId?.email || '',
        volunteerPhone: p.userId?.phone || '',
        volunteerSkills: p.userId?.skills || [],
        reliabilityScore: p.userId?.reliabilityScore,
        eventTitle: p.eventId?.title || 'Event',
        eventId: p.eventId?._id,
        shiftId: p.shiftId?._id,
        roleName: p.roleId?.name || 'Volunteer Role',
        start: p.shiftId?.start || p.start,
        end: p.shiftId?.end || p.end,
        spotsLeft: p.shiftId?.spotsLeft ?? 0,
        joinedAt: p.joinedAt,
      })),
      needsAttention: {
        unfilledShifts: unfilledSoonShifts.map((s) => ({
          _id: s._id,
          eventId: s.eventId?._id,
          eventTitle: s.eventId?.title || 'Event',
          roleName: s.roleId?.name || 'Volunteer Role',
          start: s.start,
          spotsLeft: s.spotsLeft,
          capacity: s.capacity,
        })),
        pendingAttendance: pendingAttendanceCount,
        draftEventsCount: allEvents.filter((e) => e.status === 'draft').length,
      },
    });
  })
);

/* ---------------- Create ---------------- */
router.post(
  '/',
  requireAuth,
  requireRole('organizer', 'admin'),
  validate({ body: createEventSchema }),
  asyncHandler(async (req, res) => {
    const { orgId, ...fields } = req.valid.body;
    await assertOrgMember(orgId, req.user);
    if (fields.bannerUrl === '') delete fields.bannerUrl;
    const event = await Event.create({ ...fields, orgId, createdBy: req.user.id });
    res.status(201).json({ event });
  })
);

/* ---------------- Read one ---------------- */
router.get(
  '/:id',
  requireAuth,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) throw ApiError.notFound('Event not found');
    const org = await Organization.findById(event.orgId);

    let isManager = false;
    if (req.user) {
      isManager =
        req.user.role === 'admin' || !!org?.members.some((m) => String(m.userId) === String(req.user.id));
    }

    if (isManager) {
      const roles = await EventRole.find({ eventId: event._id }).populate('leadId', 'name email');
      return res.json({ event, organization: org, roles, canManage: true });
    }

    const listed = isPubliclyListed(event.status);
    const codeOk = event.visibility === 'invite_only' && req.query.code && req.query.code === event.inviteCode;
    if (!listed || (event.visibility === 'invite_only' && !codeOk)) {
      throw ApiError.notFound('Event not found');
    }
    const roles = await EventRole.find({ eventId: event._id }).select('-leadId');
    res.json({ event: publicShape(event, org), roles, canManage: false });
  })
);

/* ---------------- Update ---------------- */
router.patch(
  '/:id',
  requireAuth,
  validate({ params: idParam, body: updateEventSchema }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    if (!['draft', 'published', 'ongoing'].includes(event.status)) {
      throw ApiError.conflict(`A ${event.status} event can no longer be edited`);
    }
    const { venue, ...rest } = req.valid.body;
    if (rest.bannerUrl === '') rest.bannerUrl = undefined;
    Object.assign(event, rest);
    if (venue) event.venue = { ...event.venue.toObject(), ...venue };
    if (event.endDate < event.startDate) throw ApiError.badRequest('End date must be on or after the start date');
    await event.save();
    res.json({ event });
  })
);

/* ---------------- Status transitions ---------------- */
router.post(
  '/:id/status',
  requireAuth,
  validate({ params: idParam, body: statusSchema }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    const { status: next, reason } = req.valid.body;

    if (!canTransition(event.status, next)) {
      throw ApiError.conflict(`Cannot change a ${event.status} event to ${next}`);
    }

    if (next === 'published') {
      if (!event.description || event.description.length < 20) {
        throw ApiError.badRequest('Add a description of at least 20 characters before publishing');
      }
      if (event.endDate < new Date()) throw ApiError.badRequest('The event end date is in the past');
      const roleCount = await EventRole.countDocuments({ eventId: event._id });
      if (roleCount === 0) throw ApiError.badRequest('Add at least one role before publishing');
      event.publishedAt = new Date();
    }
    if (next === 'settled') {
      const open = await Payable.countDocuments({ eventId: event._id, status: { $in: ['approved', 'processing'] } });
      if (open > 0) throw ApiError.conflict(`${open} approved payment(s) are still unpaid. Release them before closing the event.`);
    }
    if (next === 'cancelled') {
      event.cancelledAt = new Date();
      event.cancelReason = reason;
    }
    const before = event.status;
    event.status = next;
    await event.save();
    if (next === 'cancelled') await cancelAllShifts(event._id, reason || 'The event was cancelled');
    await audit(req.user, `event.${next}`, { entityType: 'Event', entityId: event._id, orgId: event.orgId, eventId: event._id, meta: { from: before, reason } });
    res.json({ event });
  })
);

/* ---------------- Delete (drafts only) ---------------- */
router.delete(
  '/:id',
  requireAuth,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    if (event.status !== 'draft') throw ApiError.conflict('Only draft events can be deleted. Cancel it instead.');
    await EventRole.deleteMany({ eventId: event._id });
    await Shift.deleteMany({ eventId: event._id });
    await event.deleteOne();
    res.status(204).end();
  })
);

/* ---------------- Event roles ---------------- */
router.get(
  '/:id/roles',
  requireAuth,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    const roles = await EventRole.find({ eventId: event._id }).populate('leadId', 'name email');
    res.json({ roles });
  })
);

// A lead can be given by id or by email. Returns the lead's user id (or undefined to clear).
async function resolveLead({ leadId, leadEmail }) {
  if (leadEmail) {
    const lead = await User.findOne({ email: leadEmail, status: 'active' }).select('_id');
    if (!lead) throw ApiError.badRequest('No ShiftCrew user has that email. Ask them to sign up first.');
    return lead._id;
  }
  if (leadId) {
    if (!(await User.exists({ _id: leadId, status: 'active' }))) throw ApiError.badRequest('Team lead not found');
    return leadId;
  }
  return undefined;
}

router.post(
  '/:id/roles',
  requireAuth,
  validate({ params: idParam, body: roleSchema }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    if (!['draft', 'published', 'ongoing'].includes(event.status)) throw ApiError.conflict('Roles can only be changed before the event is completed or cancelled');
    const { leadEmail, leadId, ...fields } = req.valid.body;
    const resolved = await resolveLead({ leadId, leadEmail });
    const role = await EventRole.create({ ...fields, leadId: resolved, eventId: event._id });
    await audit(req.user, 'role.created', { entityType: 'EventRole', entityId: role._id, orgId: event.orgId, eventId: event._id });
    res.status(201).json({ role });
  })
);

router.patch(
  '/:id/roles/:roleId',
  requireAuth,
  validate({ params: roleParams, body: roleSchema.partial() }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    if (!['draft', 'published', 'ongoing'].includes(event.status)) throw ApiError.conflict('Roles can only be changed before the event is completed or cancelled');
    const role = await EventRole.findOne({ _id: req.params.roleId, eventId: event._id });
    if (!role) throw ApiError.notFound('Role not found');
    const { leadEmail, leadId, ...fields } = req.valid.body;
    Object.assign(role, fields);
    if (leadEmail !== undefined || leadId !== undefined) role.leadId = await resolveLead({ leadId, leadEmail });
    await role.save();
    await audit(req.user, 'role.updated', { entityType: 'EventRole', entityId: role._id, orgId: event.orgId, eventId: event._id });
    res.json({ role });
  })
);

router.delete(
  '/:id/roles/:roleId',
  requireAuth,
  validate({ params: roleParams }),
  asyncHandler(async (req, res) => {
    const { event } = await loadManagedEvent(req.params.id, req.user);
    if (!['draft', 'published', 'ongoing'].includes(event.status)) throw ApiError.conflict('Roles can only be changed before the event is completed or cancelled');
    if (await Shift.exists({ roleId: req.params.roleId, status: 'open' })) {
      throw ApiError.conflict('This role still has shifts. Cancel or delete its shifts first.');
    }
    const removed = await EventRole.findOneAndDelete({ _id: req.params.roleId, eventId: event._id });
    if (!removed) throw ApiError.notFound('Role not found');
    res.status(204).end();
  })
);

export default router;
