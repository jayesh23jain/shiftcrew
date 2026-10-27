import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { swapLimiter } from '../../middleware/limits.js';
import {
  offerSwap,
  listEventSwaps,
  listAllOpenSwaps,
  listOrganizerSwaps,
  claimSwap,
  cancelSwap,
  approveSwap,
  rejectSwap,
} from '../../services/swap.service.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/**
 * POST /api/swaps/offer
 * Volunteer offers a confirmed signup for swap.
 */
router.post(
  '/swaps/offer',
  requireAuth,
  requireRole('volunteer'),
  swapLimiter,
  validate({
    body: z.object({
      signupId: objectId,
      note: z.string().max(500).optional(),
      toUserId: objectId.optional(),
      toUserEmail: z.string().email().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const swap = await offerSwap(req.valid.body.signupId, req.valid.body, req.user);
    res.status(201).json({ success: true, swap });
  })
);

/**
 * GET /api/swaps
 * List all open shift swaps across all events (Global Swap Board).
 */
router.get(
  '/swaps',
  requireAuth,
  requireRole('volunteer'),
  asyncHandler(async (req, res) => {
    const swaps = await listAllOpenSwaps(req.user);
    res.json({ swaps });
  })
);

/**
 * GET /api/events/:id/swaps
 * List open swaps for an event (Swap Board).
 */
router.get(
  '/events/:id/swaps',
  requireAuth,
  requireRole('volunteer'),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const swaps = await listEventSwaps(req.params.id, req.user);
    res.json({ swaps });
  })
);

/**
 * POST /api/swaps/:id/claim
 * Volunteer claims an open swap.
 */
router.post(
  '/swaps/:id/claim',
  requireAuth,
  requireRole('volunteer'),
  swapLimiter,
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const swap = await claimSwap(req.params.id, req.user);
    const requiresApproval = swap.status === 'claimed';
    res.json({ success: true, swap, requiresApproval });
  })
);

/**
 * POST /api/swaps/:id/cancel
 * Offerer cancels their swap offer.
 */
router.post(
  '/swaps/:id/cancel',
  requireAuth,
  swapLimiter,
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const swap = await cancelSwap(req.params.id, req.user);
    res.json({ success: true, swap });
  })
);

/**
 * GET /api/events/:id/swaps/manage
 * Organizer reviews swap requests for the event (approvals queue).
 */
router.get(
  '/events/:id/swaps/manage',
  requireAuth,
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const swaps = await listOrganizerSwaps(req.params.id, req.user);
    res.json({ swaps });
  })
);

/**
 * POST /api/swaps/:id/approve
 * Organizer approves a claimed swap transfer.
 */
router.post(
  '/swaps/:id/approve',
  requireAuth,
  swapLimiter,
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const swap = await approveSwap(req.params.id, req.user);
    res.json({ success: true, swap });
  })
);

/**
 * POST /api/swaps/:id/reject
 * Organizer rejects a claimed swap, reopening it on the board.
 */
router.post(
  '/swaps/:id/reject',
  requireAuth,
  swapLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ reason: z.string().max(300).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const swap = await rejectSwap(req.params.id, req.user, req.valid.body?.reason);
    res.json({ success: true, swap });
  })
);

export default router;
