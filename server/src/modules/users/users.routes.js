import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';

const router = Router();

const tagList = z.array(z.string().trim().min(1).max(30)).max(15);

export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(20),
    city: z.string().trim().max(60),
    bio: z.string().trim().max(500),
    skills: tagList,
    languages: tagList,
    emailNotifications: z.boolean(),
    emergencyContact: z.object({
      name: z.string().trim().max(80).optional(),
      phone: z.string().trim().max(20).optional(),
    }),
  })
  .partial();

router.use(requireAuth);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) throw ApiError.unauthorized();
    res.json({ user });
  })
);

router.patch(
  '/me',
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(req.user.id, { $set: req.valid.body }, { new: true, runValidators: true });
    res.json({ user });
  })
);

export default router;
