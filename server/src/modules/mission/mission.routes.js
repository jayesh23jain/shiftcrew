import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { missionLimiter } from '../../middleware/limits.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { Event } from '../../models/Event.js';
import {
  canAccessMissionControl,
  getMissionSnapshot,
  pingBackups,
  nudgeVolunteer,
  broadcastToEventVolunteers,
  reportVolunteerIncident,
  resolveIncident,
} from '../../services/mission.service.js';

const router = Router();
router.use(requireAuth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/* ---------------- GET /events/:id/mission ---------------- */
router.get(
  '/:id/mission',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) throw ApiError.notFound('Event not found');

    const isAllowed = await canAccessMissionControl(req.user, event);
    if (!isAllowed) {
      throw ApiError.forbidden('You are not authorized to access Mission Control for this event');
    }

    const snapshot = await getMissionSnapshot(event._id);
    res.json(snapshot);
  })
);

/* ---------------- POST /events/:id/mission/ping-backups ---------------- */
router.post(
  '/:id/mission/ping-backups',
  missionLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ shiftId: objectId }),
  }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) throw ApiError.notFound('Event not found');

    const isAllowed = await canAccessMissionControl(req.user, event);
    if (!isAllowed) {
      throw ApiError.forbidden('You are not authorized to ping backups for this event');
    }

    const result = await pingBackups(req.valid.body.shiftId, req.user);
    res.json(result);
  })
);

/* ---------------- POST /events/:id/mission/nudge ---------------- */
router.post(
  '/:id/mission/nudge',
  missionLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ signupId: objectId }),
  }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id);
    if (!event) throw ApiError.notFound('Event not found');

    const isAllowed = await canAccessMissionControl(req.user, event);
    if (!isAllowed) {
      throw ApiError.forbidden('You are not authorized to nudge volunteers for this event');
    }

    const result = await nudgeVolunteer(req.valid.body.signupId, req.user);
    res.json(result);
  })
);

/* ---------------- POST /events/:id/mission/broadcast ---------------- */
router.post(
  '/:id/mission/broadcast',
  missionLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({
      title: z.string().trim().max(120).optional(),
      message: z.string().trim().min(2, 'Enter an announcement message').max(1000),
      priority: z.enum(['normal', 'urgent']).default('normal'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { title, message, priority } = req.valid.body;
    const result = await broadcastToEventVolunteers(req.params.id, { title, message, priority }, req.user);
    res.json(result);
  })
);

/* ---------------- POST /events/:id/mission/report-issue ---------------- */
router.post(
  '/:id/mission/report-issue',
  missionLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({
      category: z.enum(['crowd', 'supplies', 'tech', 'checkin', 'safety', 'other']).default('other'),
      message: z.string().trim().min(3, 'Please describe the issue').max(1000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { category, message } = req.valid.body;
    const result = await reportVolunteerIncident(req.params.id, { category, message }, req.user);
    res.status(201).json(result);
  })
);

/* ---------------- POST /events/:id/mission/resolve-issue ---------------- */
router.post(
  '/:id/mission/resolve-issue',
  missionLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ incidentId: objectId }),
  }),
  asyncHandler(async (req, res) => {
    const result = await resolveIncident(req.valid.body.incidentId, req.user);
    res.json(result);
  })
);

export default router;
