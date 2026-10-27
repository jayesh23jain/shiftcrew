import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { assistantService, DAILY_MESSAGE_LIMIT } from '../../services/assistant/assistant.service.js';
import { env } from '../../config/env.js';

const router = Router();

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(500, 'Message cannot exceed 500 characters'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(1000),
      })
    )
    .max(6)
    .optional()
    .default([]),
});

/**
 * GET /status - Returns assistant availability and user daily limit status
 */
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const remaining = assistantService.getRemainingMessagesToday(req.user.id);
    res.json({
      enabled: Boolean(env.LLM_ENABLED),
      canUseUserData: Boolean(env.LLM_ALLOW_USER_DATA),
      provider: env.LLM_PROVIDER,
      remainingToday: remaining,
      dailyLimit: DAILY_MESSAGE_LIMIT,
    });
  })
);

/**
 * POST /chat - Chat with volunteer assistant
 */
router.post(
  '/chat',
  requireAuth,
  validate({ body: chatSchema }),
  asyncHandler(async (req, res) => {
    const result = await assistantService.chat({
      user: req.user,
      message: req.valid.body.message,
      history: req.valid.body.history,
    });
    res.json(result);
  })
);

import { Event } from '../../models/Event.js';
import { Organization } from '../../models/Organization.js';
import { Payable } from '../../models/Money.js';
import { Signup } from '../../models/Signup.js';
import { notify } from '../../services/notify.js';
import { ApiError } from '../../utils/ApiError.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/**
 * POST /remind-organizer - Send a payment reminder notification to the organizer
 */
router.post(
  '/remind-organizer',
  requireAuth,
  validate({
    body: z.object({
      eventId: objectId,
      payableId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { eventId, payableId } = req.valid.body;
    const event = await Event.findById(eventId);
    if (!event) throw ApiError.notFound('Event not found');

    const org = await Organization.findById(event.orgId);
    if (!org) throw ApiError.notFound('Organization not found');

    // Verify volunteer belongs to event
    const [payable, signup] = await Promise.all([
      payableId
        ? Payable.findOne({ _id: payableId, userId: req.user.id })
        : Payable.findOne({ eventId, userId: req.user.id }),
      Signup.findOne({ eventId, userId: req.user.id }),
    ]);

    if (!payable && !signup) {
      throw ApiError.forbidden('You do not have a shift or pending payment for this event');
    }

    const amountText = payable ? ` of ₹${(payable.amount / 100).toLocaleString('en-IN')}` : '';
    const organizerUserIds = (org.members || []).map((m) => m.userId);
    if (org.ownerId) organizerUserIds.push(org.ownerId);

    await notify(
      [...new Set(organizerUserIds.map(String))],
      {
        type: 'payout_reminder',
        title: 'Volunteer Payment Reminder',
        body: `${req.user.name || 'A volunteer'} sent a reminder regarding pending stipend${amountText} for ${event.title}.`,
        link: `/manage/events/${event._id}?tab=funds`,
      }
    );

    const organizerUser = await User.findById(event.createdBy || org.ownerId).select('name');
    const targetName = organizerUser?.name || org.name || 'the organizer';

    res.json({
      ok: true,
      message: `Payment reminder sent to ${targetName}!`,
      organizerName: targetName,
    });
  })
);

export default router;
