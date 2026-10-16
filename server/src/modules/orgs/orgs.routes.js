import { Router } from 'express';
import { z } from 'zod';
import { Organization } from '../../models/Organization.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { assertOrgMember } from '../../utils/orgAccess.js';

const router = Router();

export const orgSchema = z.object({
  name: z.string().trim().min(2, 'Enter the organization name').max(100),
  type: z.enum(['college_club', 'ngo', 'fest_committee', 'company', 'other']).default('other'),
  description: z.string().trim().max(1000).optional(),
  city: z.string().trim().max(60).optional(),
});

router.use(requireAuth);

router.post(
  '/',
  requireRole('organizer', 'admin'),
  validate({ body: orgSchema }),
  asyncHandler(async (req, res) => {
    const org = await Organization.create({
      ...req.valid.body,
      ownerId: req.user.id,
      members: [{ userId: req.user.id, role: 'owner' }],
    });
    res.status(201).json({ org });
  })
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const orgs = await Organization.find({ 'members.userId': req.user.id }).sort({ createdAt: -1 });
    res.json({ orgs });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const org = await assertOrgMember(req.params.id, req.user);
    res.json({ org });
  })
);

router.patch(
  '/:id',
  validate({ body: orgSchema.partial() }),
  asyncHandler(async (req, res) => {
    const org = await assertOrgMember(req.params.id, req.user, ['owner']);
    Object.assign(org, req.valid.body);
    await org.save();
    res.json({ org });
  })
);

export default router;
