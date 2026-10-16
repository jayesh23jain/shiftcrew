import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Organization } from '../../models/Organization.js';
import { Event } from '../../models/Event.js';
import { Payout, Wallet } from '../../models/Money.js';
import { Dispute } from '../../models/Community.js';
import { AuditLog } from '../../models/AuditLog.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import { audit } from '../../utils/audit.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

router.get('/stats', asyncHandler(async (_req, res) => {
  const [users, orgs, events, payouts, wallets, openDisputes] = await Promise.all([
    User.countDocuments(), Organization.countDocuments(), Event.countDocuments(), Payout.find(), Wallet.find(), Dispute.countDocuments({ status: 'open' }),
  ]);
  const paid = payouts.filter((p) => p.status === 'paid');
  const failed = payouts.filter((p) => p.status === 'failed').length;
  res.json({
    users, orgs, events, openDisputes,
    payouts: { count: payouts.length, paidAmount: paid.reduce((n, p) => n + p.amount, 0), fees: paid.reduce((n, p) => n + p.fee, 0), failureRate: payouts.length ? Math.round((failed / payouts.length) * 100) : 0 },
    walletBalance: wallets.reduce((n, w) => n + w.available, 0),
  });
}));

router.get(
  '/users',
  validate({ query: z.object({ q: z.string().trim().max(80).optional(), role: z.enum(['volunteer', 'organizer', 'admin']).optional(), page: z.coerce.number().int().min(1).default(1) }) }),
  asyncHandler(async (req, res) => {
    const { q, role, page } = req.valid.query;
    const filter = {};
    if (role) filter.role = role;
    if (q) filter.$or = [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { email: { $regex: escapeRegex(q), $options: 'i' } }];
    const [users, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25), User.countDocuments(filter)]);
    res.json({ users, total, pages: Math.max(1, Math.ceil(total / 25)) });
  })
);

router.patch(
  '/users/:id',
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['active', 'suspended']) }) }),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw ApiError.notFound('User not found');
    if (target.role === 'admin') throw ApiError.forbidden('Admin accounts cannot be suspended here');
    target.status = req.valid.body.status;
    if (target.status === 'suspended') target.refreshTokens = [];
    await target.save();
    await audit(req.user, `user.${target.status}`, { entityType: 'User', entityId: target._id });
    res.json({ user: target });
  })
);

router.get('/orgs', asyncHandler(async (_req, res) => {
  res.json({ orgs: await Organization.find().sort({ createdAt: -1 }).limit(100) });
}));

router.patch(
  '/orgs/:id',
  validate({ params: z.object({ id: objectId }), body: z.object({ verified: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    const org = await Organization.findByIdAndUpdate(req.params.id, { $set: { verified: req.valid.body.verified } }, { new: true });
    if (!org) throw ApiError.notFound('Organization not found');
    await audit(req.user, org.verified ? 'org.verified' : 'org.unverified', { entityType: 'Organization', entityId: org._id, orgId: org._id });
    res.json({ org });
  })
);

router.get('/disputes', asyncHandler(async (_req, res) => {
  res.json({ disputes: await Dispute.find().sort({ createdAt: -1 }).limit(100) });
}));

router.get('/audit', asyncHandler(async (_req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(150);
  const users = await User.find({ _id: { $in: logs.map((l) => l.actorId).filter(Boolean) } }).select('name');
  const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
  res.json({ logs: logs.map((l) => ({ ...l.toObject(), actor: U[String(l.actorId)] })) });
}));

export default router;
