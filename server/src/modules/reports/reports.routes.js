import { Router } from 'express';
import { z } from 'zod';
import { Shift } from '../../models/Shift.js';
import { Signup } from '../../models/Signup.js';
import { Attendance } from '../../models/Attendance.js';
import { Payable, Payout } from '../../models/Money.js';
import { Event } from '../../models/Event.js';
import { EventRole } from '../../models/EventRole.js';
import { User } from '../../models/User.js';
import { AuditLog } from '../../models/AuditLog.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertOrgMember } from '../../utils/orgAccess.js';
import { estimatePay } from '../../utils/money.js';
import { toCsv } from '../../utils/csv.js';

const router = Router();
router.use(['/events/:eventId/report', '/events/:eventId/audit', '/me/stats'], requireAuth);

const eventParam = z.object({ eventId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

async function managedEvent(id, user) {
  const event = await Event.findById(id);
  if (!event) throw ApiError.notFound('Event not found');
  await assertOrgMember(event.orgId, user);
  return event;
}

/* ---------------- Organizer report ---------------- */
router.get(
  '/events/:eventId/report',
  validate({ params: eventParam }),
  asyncHandler(async (req, res) => {
    const event = await managedEvent(req.params.eventId, req.user);
    const [shifts, roles, signups, attendance, payables, payouts] = await Promise.all([
      Shift.find({ eventId: event._id, status: 'open' }).sort({ start: 1 }),
      EventRole.find({ eventId: event._id }).select('name'),
      Signup.find({ eventId: event._id }).select('shiftId roleId userId status'),
      Attendance.find({ eventId: event._id }),
      Payable.find({ eventId: event._id }),
      Payout.find({ eventId: event._id }),
    ]);
    const R = Object.fromEntries(roles.map((r) => [String(r._id), r.name]));

    const perShift = shifts.map((s) => {
      const confirmed = signups.filter((x) => String(x.shiftId) === String(s._id) && x.status === 'confirmed').length;
      const att = attendance.filter((a) => String(a.shiftId) === String(s._id));
      const present = att.filter((a) => ['checked_in', 'completed', 'approved'].includes(a.status)).length;
      const noShow = att.filter((a) => a.status === 'no_show').length;
      return {
        shiftId: s._id, role: R[String(s.roleId)], start: s.start, capacity: s.capacity, confirmed,
        fillRate: pct(confirmed, s.capacity), present, noShow, noShowRate: pct(noShow, present + noShow),
      };
    });

    const perRole = roles.map((r) => {
      const rShifts = shifts.filter((s) => String(s.roleId) === String(r._id));
      const rAtt = attendance.filter((a) => String(a.roleId) === String(r._id) && a.status === 'approved');
      const rPay = payables.filter((p) => rAtt.some((a) => String(a._id) === String(p.attendanceId)));
      return {
        roleId: r._id, name: r.name, shifts: rShifts.length,
        capacity: rShifts.reduce((n, s) => n + s.capacity, 0),
        minutes: rAtt.reduce((n, a) => n + (a.approvedMinutes || 0), 0),
        cost: rPay.reduce((n, p) => n + p.amount, 0),
      };
    });

    const approved = attendance.filter((a) => a.status === 'approved');
    const totalPresent = attendance.filter((a) => ['checked_in', 'completed', 'approved'].includes(a.status)).length;
    const totalNoShow = attendance.filter((a) => a.status === 'no_show').length;
    const budgetAtCapacity = shifts.reduce((n, s) => n + estimatePay(s) * s.capacity, 0);

    const minutesByUser = {};
    for (const a of approved) minutesByUser[String(a.userId)] = (minutesByUser[String(a.userId)] || 0) + (a.approvedMinutes || 0);
    const topIds = Object.entries(minutesByUser).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const users = await User.find({ _id: { $in: topIds.map(([id]) => id) } }).select('name');
    const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));

    res.json({
      totals: {
        shifts: shifts.length,
        capacity: shifts.reduce((n, s) => n + s.capacity, 0),
        confirmed: signups.filter((x) => x.status === 'confirmed').length,
        volunteers: new Set(signups.filter((x) => x.status === 'confirmed').map((x) => String(x.userId))).size,
        fillRate: pct(signups.filter((x) => x.status === 'confirmed').length, shifts.reduce((n, s) => n + s.capacity, 0)),
        noShowRate: pct(totalNoShow, totalPresent + totalNoShow),
        approvedMinutes: approved.reduce((n, a) => n + (a.approvedMinutes || 0), 0),
      },
      money: {
        budgetAtCapacity,
        approved: payables.reduce((n, p) => n + p.amount, 0),
        paid: payables.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amount, 0),
        fees: payouts.filter((p) => p.status === 'paid').reduce((n, p) => n + p.fee, 0),
      },
      perShift, perRole,
      topVolunteers: topIds.map(([id, minutes]) => ({ name: U[id], minutes })),
    });
  })
);

router.get(
  '/events/:eventId/report/attendance.csv',
  validate({ params: eventParam }),
  asyncHandler(async (req, res) => {
    const event = await managedEvent(req.params.eventId, req.user);
    const records = await Attendance.find({ eventId: event._id }).sort({ createdAt: 1 });
    const [users, roles, shifts] = await Promise.all([
      User.find({ _id: { $in: records.map((r) => r.userId) } }).select('name email'),
      EventRole.find({ eventId: event._id }).select('name'),
      Shift.find({ eventId: event._id }).select('start end'),
    ]);
    const U = Object.fromEntries(users.map((u) => [String(u._id), u]));
    const R = Object.fromEntries(roles.map((r) => [String(r._id), r.name]));
    const S = Object.fromEntries(shifts.map((s) => [String(s._id), s]));
    const csv = toCsv(
      ['Volunteer', 'Email', 'Role', 'Shift start', 'Shift end', 'Status', 'Check in', 'Check out', 'Late', 'Minutes worked', 'Approved minutes', 'Adjust reason'],
      records.map((r) => [
        U[String(r.userId)]?.name, U[String(r.userId)]?.email, R[String(r.roleId)], S[String(r.shiftId)]?.start?.toISOString(), S[String(r.shiftId)]?.end?.toISOString(),
        r.status, r.checkInAt?.toISOString(), r.checkOutAt?.toISOString(), r.late ? 'yes' : 'no', r.minutesWorked, r.approvedMinutes, r.adjustReason,
      ])
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
    res.send(csv);
  })
);

router.get(
  '/events/:eventId/report/payouts.csv',
  validate({ params: eventParam }),
  asyncHandler(async (req, res) => {
    const event = await managedEvent(req.params.eventId, req.user);
    const payouts = await Payout.find({ eventId: event._id }).sort({ createdAt: 1 });
    const users = await User.find({ _id: { $in: payouts.map((p) => p.userId) } }).select('name');
    const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    const csv = toCsv(
      ['Volunteer', 'Amount (Rs)', 'Fee (Rs)', 'Status', 'Receipt', 'UPI', 'Paid at', 'Failure reason'],
      payouts.map((p) => [U[String(p.userId)], (p.amount / 100).toFixed(2), (p.fee / 100).toFixed(2), p.status, p.receiptNo, p.upiMasked, p.paidAt?.toISOString(), p.failureReason])
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payouts.csv"');
    res.send(csv);
  })
);

router.get(
  '/events/:eventId/audit',
  validate({ params: eventParam }),
  asyncHandler(async (req, res) => {
    const event = await managedEvent(req.params.eventId, req.user);
    const logs = await AuditLog.find({ eventId: event._id }).sort({ createdAt: -1 }).limit(100);
    const users = await User.find({ _id: { $in: logs.map((l) => l.actorId).filter(Boolean) } }).select('name');
    const U = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    res.json({ logs: logs.map((l) => ({ ...l.toObject(), actor: U[String(l.actorId)] })) });
  })
);

/* ---------------- Volunteer stats and badges ---------------- */
export function badgesFor({ approvedShifts, minutes, noShows, reliability }) {
  const out = [];
  if (approvedShifts >= 1) out.push({ id: 'first_shift', label: 'First shift', detail: 'Completed your first approved shift' });
  if (minutes >= 600) out.push({ id: 'ten_hours', label: '10 hours', detail: 'Ten approved volunteering hours' });
  if (minutes >= 3000) out.push({ id: 'fifty_hours', label: '50 hours', detail: 'Fifty approved volunteering hours' });
  if (approvedShifts >= 5 && noShows === 0) out.push({ id: 'perfect', label: 'Perfect attendance', detail: 'Five or more shifts with no absences' });
  if (approvedShifts >= 3 && reliability >= 95) out.push({ id: 'reliable', label: 'Reliable', detail: 'Reliability score of 95 or higher' });
  return out;
}

router.get(
  '/me/stats',
  asyncHandler(async (req, res) => {
    const [user, attendance, payables] = await Promise.all([
      User.findById(req.user.id).select('reliabilityScore'),
      Attendance.find({ userId: req.user.id }),
      Payable.find({ userId: req.user.id }),
    ]);
    const approved = attendance.filter((a) => a.status === 'approved');
    const noShows = attendance.filter((a) => a.status === 'no_show').length;
    const present = attendance.filter((a) => ['completed', 'approved'].includes(a.status)).length;
    const minutes = approved.reduce((n, a) => n + (a.approvedMinutes || 0), 0);
    const byMonth = {};
    for (const a of approved) {
      const k = (a.approvedAt || a.createdAt).toISOString().slice(0, 7);
      byMonth[k] = (byMonth[k] || 0) + (a.approvedMinutes || 0);
    }
    res.json({
      minutes, shifts: approved.length, events: new Set(approved.map((a) => String(a.eventId))).size,
      attendanceRate: pct(present, present + noShows), reliability: user.reliabilityScore,
      earned: payables.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amount, 0),
      byMonth: Object.entries(byMonth).sort().map(([month, mins]) => ({ month, minutes: mins })),
      badges: badgesFor({ approvedShifts: approved.length, minutes, noShows, reliability: user.reliabilityScore }),
    });
  })
);

export default router;
