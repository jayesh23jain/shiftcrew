import { Router } from 'express';
import { z } from 'zod';
import { Payable, Payout, PayoutMethod } from '../../models/Money.js';
import { User } from '../../models/User.js';
import { Event } from '../../models/Event.js';
import { Organization } from '../../models/Organization.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { moneyLimiter } from '../../middleware/limits.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { encrypt, maskUpi } from '../../utils/crypto.js';
import { receiptPdf } from '../../services/pdf.js';
import { releasePayouts } from '../../services/payouts.service.js';

const router = Router();
router.use(requireAuth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const UPI = /^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$/i;

/* ---------------- Volunteer: payout method (UPI) ---------------- */
router.get('/method', asyncHandler(async (req, res) => {
  const m = await PayoutMethod.findOne({ userId: req.user.id }).select('upiMasked holderName verified type');
  res.json({ method: m });
}));

router.put(
  '/method',
  validate({ body: z.object({ upi: z.string().trim().regex(UPI, 'Enter a valid UPI id like name@bank'), holderName: z.string().trim().max(80).optional() }) }),
  asyncHandler(async (req, res) => {
    const { upi, holderName } = req.valid.body;
    // Sandbox "verification" is a format check. A live setup would validate with a bank penny-drop.
    const m = await PayoutMethod.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { upiEnc: encrypt(upi.toLowerCase()), upiMasked: maskUpi(upi.toLowerCase()), holderName, verified: true } },
      { upsert: true, new: true }
    );
    res.json({ method: { upiMasked: m.upiMasked, holderName: m.holderName, verified: m.verified, type: m.type } });
  })
);

router.delete('/method', asyncHandler(async (req, res) => {
  await PayoutMethod.deleteOne({ userId: req.user.id });
  res.status(204).end();
}));

/* ---------------- Volunteer: earnings ---------------- */
router.get('/mine', asyncHandler(async (req, res) => {
  const [payouts, payables] = await Promise.all([
    Payout.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100),
    Payable.find({ userId: req.user.id }),
  ]);
  const events = await Event.find({ _id: { $in: [...payouts.map((p) => p.eventId), ...payables.map((p) => p.eventId)] } }).select('title');
  const E = Object.fromEntries(events.map((e) => [String(e._id), e.title]));
  const sum = (arr, st) => arr.filter((p) => p.status === st).reduce((s, p) => s + p.amount, 0);
  res.json({
    totals: { paid: sum(payables, 'paid'), pending: sum(payables, 'approved'), processing: sum(payables, 'processing') },
    payouts: payouts.map((p) => ({ ...p.toObject(), eventTitle: E[String(p.eventId)] })),
    pending: payables.filter((p) => p.status !== 'paid').map((p) => ({ ...p.toObject(), eventTitle: E[String(p.eventId)] })),
  });
}));

/* ---------------- Organizer: release and track ---------------- */
router.post(
  '/release',
  moneyLimiter,
  validate({ body: z.object({ eventId: objectId, payableIds: z.array(objectId).max(500).optional() }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.valid.body.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    await assertOrgMember(event.orgId, req.user);
    res.json(await releasePayouts({ eventId: event._id, orgId: event.orgId, actor: req.user, payableIds: req.valid.body.payableIds }));
  })
);

router.get(
  '/events/:eventId',
  validate({ params: z.object({ eventId: objectId }) }),
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw ApiError.notFound('Event not found');
    await assertOrgMember(event.orgId, req.user);
    const [payables, payouts] = await Promise.all([Payable.find({ eventId: event._id }), Payout.find({ eventId: event._id }).sort({ createdAt: -1 })]);
    const ids = [...new Set([...payables, ...payouts].map((x) => String(x.userId)))];
    const [users, methods] = await Promise.all([User.find({ _id: { $in: ids } }).select('name'), PayoutMethod.find({ userId: { $in: ids }, verified: true }).select('userId')]);
    const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    const hasMethod = new Set(methods.map((m) => String(m.userId)));
    res.json({
      payables: payables.map((p) => ({ ...p.toObject(), volunteer: U[String(p.userId)], hasPayoutMethod: hasMethod.has(String(p.userId)) })),
      payouts: payouts.map((p) => ({ ...p.toObject(), volunteer: U[String(p.userId)] })),
    });
  })
);

router.get(
  '/:id/receipt',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const payout = await Payout.findById(req.params.id);
    if (!payout) throw ApiError.notFound('Payout not found');
    if (String(payout.userId) !== req.user.id) await assertOrgMember(payout.orgId, req.user);
    if (payout.status !== 'paid') throw ApiError.conflict('A receipt is available once the payout is paid');
    const [user, org, event] = await Promise.all([User.findById(payout.userId).select('name'), Organization.findById(payout.orgId).select('name'), Event.findById(payout.eventId).select('title')]);
    const pdf = await receiptPdf({ payout, volunteerName: user.name, orgName: org.name, eventTitle: event.title });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payout.receiptNo}.pdf"`);
    res.send(pdf);
  })
);

export default router;
