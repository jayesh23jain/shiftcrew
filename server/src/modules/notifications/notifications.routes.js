import { Router } from 'express';
import { z } from 'zod';
import { Notification } from '../../models/Notification.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50),
    Notification.countDocuments({ userId: req.user.id, readAt: null }),
  ]);
  res.json({ notifications: items, unread });
}));

router.get('/unread-count', asyncHandler(async (req, res) => {
  res.json({ unread: await Notification.countDocuments({ userId: req.user.id, readAt: null }) });
}));

router.post(
  '/read',
  validate({ body: z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100).optional() }) }),
  asyncHandler(async (req, res) => {
    const filter = { userId: req.user.id, readAt: null };
    if (req.valid.body.ids?.length) filter._id = { $in: req.valid.body.ids };
    await Notification.updateMany(filter, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  })
);

export default router;
