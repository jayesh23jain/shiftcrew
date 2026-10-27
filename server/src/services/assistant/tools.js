import { Shift } from '../../models/Shift.js';
import { Signup } from '../../models/Signup.js';
import { Event } from '../../models/Event.js';
import { EventRole } from '../../models/EventRole.js';
import { Attendance } from '../../models/Attendance.js';
import { Payable, Payout, PayoutMethod } from '../../models/Money.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { Dispute } from '../../models/Community.js';

export const ASSISTANT_TOOLS_DECLARATIONS = [
  {
    type: 'function',
    function: {
      name: 'getMyUpcomingShifts',
      description:
        "Retrieves the authenticated volunteer's upcoming future scheduled shifts (confirmed or pending), including event title, venue, role, date/time, and pay rate. Use ONLY for future/upcoming shifts, NOT for completed shifts or earnings/payments.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMyShiftDetails',
      description:
        'Retrieves full details for a specific shift that belongs to the authenticated user. If the shift does not belong to the user, returns not found.',
      parameters: {
        type: 'object',
        properties: {
          shiftId: {
            type: 'string',
            description: 'The MongoDB ObjectId of the shift to look up.',
          },
        },
        required: ['shiftId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMyAttendanceStatus',
      description:
        "Checks the authenticated volunteer's attendance record, check-in/out times, hours worked, late flag, and dispute status for a specific shift.",
      parameters: {
        type: 'object',
        properties: {
          shiftId: {
            type: 'string',
            description: 'The MongoDB ObjectId of the shift.',
          },
        },
        required: ['shiftId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMyEarningsSummary',
      description:
        "Retrieves the authenticated volunteer's earnings, stipends, and payments for completed shifts. Includes total paid out, approved pending payments awaiting organizer payout release, processing payments, recent payouts, and payout method status. Call this whenever the user asks about payments, stipends, money owed, or being paid for completed shifts.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPolicyInfo',
      description:
        'Returns authoritative ShiftCrew policy rules regarding check-in window, late-cancel penalty, dispute window, or payouts.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['check-in window', 'late-cancel penalty', 'dispute window', 'payouts'],
            description:
              'The policy topic to query: "check-in window", "late-cancel penalty", "dispute window", or "payouts".',
          },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getOrganizerPendingPayouts',
      description:
        "Retrieves approved volunteer stipends and payables awaiting payout release by the authenticated organizer across their events and organizations. Call this when an organizer asks if there are shifts/stipends they need to pay for, pending volunteer payouts, or unpaid completed shifts for their events.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getOrganizerEventsSummary',
      description:
        "Retrieves a summary of events organized by the authenticated organizer, including event titles, status, dates, venue, total shifts, volunteer capacity, spots left, and confirmed volunteer signups.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

const POLICIES = {
  'check-in window':
    'Check-in Window Policy: Check-in opens 30 minutes before the scheduled shift start. Volunteers check in by showing their digital QR pass to their team lead or organizer. If a volunteer checks in more than 10 minutes past shift start, they are flagged as Late. Check-out closes 60 minutes after the shift end time. Checking out more than 15 minutes prior to shift end is recorded as Early Checkout.',
  'late-cancel penalty':
    'Late Cancellation Penalty Policy: Volunteers may cancel a confirmed shift freely up to 24 hours prior to the shift start without any penalty. Cancelling a confirmed shift less than 24 hours before start triggers a Late Cancellation flag, deducting 5 points from your reliability score. To avoid late-cancel penalties, volunteers can offer their shift on the Swap Board for another volunteer to claim.',
  'dispute window':
    'Attendance Dispute Window Policy: If you notice a discrepancy with your logged hours or attendance status, you can file a dispute directly from your My Shifts page. Disputes must be submitted before payouts are processed. Once an organizer has released and processed payouts for a shift, attendance records are finalized and cannot be modified.',
  'payouts':
    'Payouts Policy: Stipends and shift earnings are paid out via direct UPI transfer to your verified UPI ID. After a shift completes, organizers review and approve attendance hours, then batch-release payouts. Once released, payouts process through the banking network within 24 to 48 hours. Ensure your UPI ID is saved and verified in the Earnings section.',
};

/**
 * Tool 1: getMyUpcomingShifts
 */
export async function getMyUpcomingShifts({ userId }) {
  const signups = await Signup.find({
    userId,
    status: { $in: ['confirmed', 'pending', 'waitlisted'] },
    start: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
  })
    .sort({ start: 1 })
    .limit(10);

  if (!signups.length) {
    return { shifts: [], message: 'No upcoming shifts found for your account.' };
  }

  const shiftIds = signups.map((s) => s.shiftId);
  const shifts = await Shift.find({ _id: { $in: shiftIds } });
  const eventIds = shifts.map((s) => s.eventId);
  const roleIds = shifts.map((s) => s.roleId);

  const [events, roles] = await Promise.all([
    Event.find({ _id: { $in: eventIds } }).select('title venue status'),
    EventRole.find({ _id: { $in: roleIds } }).select('name'),
  ]);

  const eventMap = new Map(events.map((e) => [String(e._id), e]));
  const roleMap = new Map(roles.map((r) => [String(r._id), r]));
  const shiftMap = new Map(shifts.map((s) => [String(s._id), s]));

  const sanitized = signups.map((s) => {
    const sh = shiftMap.get(String(s.shiftId));
    const ev = sh ? eventMap.get(String(sh.eventId)) : null;
    const ro = sh ? roleMap.get(String(sh.roleId)) : null;

    return {
      shiftId: String(s.shiftId),
      signupStatus: s.status,
      roleName: ro?.name || 'Crew Member',
      eventTitle: ev?.title || 'Shift Event',
      venueName: ev?.venue?.name || '',
      start: sh?.start ? sh.start.toISOString() : s.start.toISOString(),
      end: sh?.end ? sh.end.toISOString() : s.end.toISOString(),
      payType: sh?.payType || 'unpaid',
      rateRupees: (sh?.rate || 0) / 100,
      notes: sh?.notes || '',
    };
  });

  return { shifts: sanitized };
}

/**
 * Tool 2: getMyShiftDetails
 */
export async function getMyShiftDetails({ userId, shiftId }) {
  if (!shiftId || !/^[a-f\d]{24}$/i.test(shiftId)) {
    return { error: 'Shift not found or access denied.' };
  }

  const signup = await Signup.findOne({
    userId,
    shiftId,
    status: { $nin: ['cancelled'] },
  });

  if (!signup) {
    return { error: 'Shift not found or access denied. This shift does not belong to your account.' };
  }

  const shift = await Shift.findById(shiftId);
  if (!shift) {
    return { error: 'Shift not found.' };
  }

  const [event, role] = await Promise.all([
    Event.findById(shift.eventId).select('title venue status description'),
    EventRole.findById(shift.roleId).select('name description skills'),
  ]);

  return {
    shiftId: String(shift._id),
    status: shift.status,
    signupStatus: signup.status,
    start: shift.start.toISOString(),
    end: shift.end.toISOString(),
    payType: shift.payType,
    rateRupees: (shift.rate || 0) / 100,
    notes: shift.notes || '',
    roleName: role?.name || 'Crew Member',
    roleDescription: role?.description || '',
    skillsRequired: role?.skills || [],
    eventTitle: event?.title || 'Shift Event',
    venue: event?.venue || {},
  };
}

/**
 * Tool 3: getMyAttendanceStatus
 */
export async function getMyAttendanceStatus({ userId, shiftId }) {
  if (!shiftId || !/^[a-f\d]{24}$/i.test(shiftId)) {
    return { error: 'Shift not found or access denied.' };
  }

  const signup = await Signup.findOne({ userId, shiftId });
  if (!signup) {
    return { error: 'Shift not found or access denied. This shift does not belong to your account.' };
  }

  const attendance = await Attendance.findOne({ userId, shiftId });
  if (!attendance) {
    return {
      status: 'not_recorded',
      message: 'Attendance has not been recorded yet for this shift. Check-in opens 30 minutes before shift start.',
    };
  }

  const dispute = await Dispute.findOne({ attendanceId: attendance._id });

  return {
    shiftId,
    status: attendance.status,
    checkInAt: attendance.checkInAt ? attendance.checkInAt.toISOString() : null,
    checkOutAt: attendance.checkOutAt ? attendance.checkOutAt.toISOString() : null,
    minutesWorked: attendance.minutesWorked || 0,
    approvedMinutes: attendance.approvedMinutes || attendance.minutesWorked || 0,
    late: Boolean(attendance.late),
    earlyCheckout: Boolean(attendance.earlyCheckout),
    disputeStatus: dispute ? dispute.status : null,
  };
}

/**
 * Tool 4: getMyEarningsSummary
 */
export async function getMyEarningsSummary({ userId }) {
  const [payables, payouts, method] = await Promise.all([
    Payable.find({ userId }),
    Payout.find({ userId }).sort({ createdAt: -1 }).limit(5),
    PayoutMethod.findOne({ userId }).select('upiMasked verified'),
  ]);

  const eventIds = [...payables.map((p) => p.eventId), ...payouts.map((p) => p.eventId)];
  const events = await Event.find({ _id: { $in: eventIds } }).select('title orgId createdBy');
  const eventMap = new Map(events.map((e) => [String(e._id), e]));

  const orgIds = events.map((e) => e.orgId).filter(Boolean);
  const orgs = await Organization.find({ _id: { $in: orgIds } }).select('name ownerId');
  const orgMap = new Map(orgs.map((o) => [String(o._id), o]));

  const organizerUserIds = [
    ...events.map((e) => e.createdBy).filter(Boolean),
    ...orgs.map((o) => o.ownerId).filter(Boolean),
  ];
  const organizerUsers =
    organizerUserIds.length > 0 ? await User.find({ _id: { $in: organizerUserIds } }).select('name') : [];
  const organizerUserMap = new Map((organizerUsers || []).map((u) => [String(u._id), u.name]));

  const sumBy = (st) =>
    payables.filter((p) => p.status === st).reduce((acc, p) => acc + (p.amount || 0), 0) / 100;

  const totalPaidRupees = sumBy('paid');
  const pendingApprovalRupees = sumBy('approved');
  const processingRupees = sumBy('processing');

  const pendingPayments = payables
    .filter((p) => p.status !== 'paid')
    .map((p) => {
      const ev = eventMap.get(String(p.eventId));
      const org = ev?.orgId ? orgMap.get(String(ev.orgId)) : null;
      const organizerPersonName =
        (ev?.createdBy ? organizerUserMap.get(String(ev.createdBy)) : null) ||
        (org?.ownerId ? organizerUserMap.get(String(org.ownerId)) : null) ||
        org?.name ||
        'Event Organizer';

      const orgDisplayName = org?.name ? org.name : '';
      const combinedOrganizerName =
        organizerPersonName && orgDisplayName && organizerPersonName.toLowerCase() !== orgDisplayName.toLowerCase()
          ? `${organizerPersonName} (${orgDisplayName})`
          : organizerPersonName;

      return {
        payableId: String(p._id),
        eventId: String(p.eventId),
        eventTitle: ev?.title || 'Shift Event',
        organizerName: combinedOrganizerName,
        organizerPersonName,
        orgName: orgDisplayName,
        orgId: ev?.orgId ? String(ev.orgId) : null,
        amountRupees: (p.amount || 0) / 100,
        status: p.status === 'approved' ? 'Approved (Pending Organizer Payout Release)' : 'Processing Payout',
      };
    });

  const recentPayouts = payouts.map((p) => {
    const ev = eventMap.get(String(p.eventId));
    return {
      payoutId: String(p._id),
      amountRupees: (p.amount || 0) / 100,
      status: p.status,
      eventTitle: ev?.title || 'Shift Payout',
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      receiptNo: p.receiptNo || null,
    };
  });

  return {
    totalPaidRupees,
    pendingApprovalRupees,
    processingRupees,
    pendingPayments,
    recentPayouts,
    payoutMethod: {
      isConfigured: Boolean(method?.verified),
      maskedUpi: method?.upiMasked || null,
    },
  };
}

/**
 * Tool 5: getPolicyInfo
 */
export function getPolicyInfo({ topic }) {
  const normalized = (topic || '').toLowerCase().trim();
  for (const [key, text] of Object.entries(POLICIES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { topic: key, policy: text };
    }
  }
  return {
    availableTopics: Object.keys(POLICIES),
    message: 'Topic not found. Please choose from: check-in window, late-cancel penalty, dispute window, payouts.',
  };
}

/**
 * Tool 6: getOrganizerPendingPayouts
 */
export async function getOrganizerPendingPayouts({ userId }) {
  const orgs = await Organization.find({ ownerId: userId }).select('_id name');
  const orgIds = orgs.map((o) => o._id);

  const events = await Event.find({
    $or: [{ createdBy: userId }, { orgId: { $in: orgIds } }],
  }).select('_id title orgId');
  const eventIds = events.map((e) => e._id);
  const eventMap = new Map(events.map((e) => [String(e._id), e]));

  const payables = await Payable.find({
    $or: [
      { eventId: { $in: eventIds } },
      { orgId: { $in: orgIds } },
    ],
    status: 'approved',
  });

  const volunteerIds = [...new Set(payables.map((p) => p.userId).filter(Boolean))];
  const volunteers =
    volunteerIds.length > 0 ? await User.find({ _id: { $in: volunteerIds } }).select('name email') : [];
  const volunteerMap = new Map(volunteers.map((v) => [String(v._id), v.name]));

  const items = payables.map((p) => {
    const ev = eventMap.get(String(p.eventId));
    const volName = volunteerMap.get(String(p.userId)) || 'Volunteer';
    return {
      payableId: String(p._id),
      eventId: String(p.eventId),
      eventTitle: ev?.title || 'Event',
      volunteerName: volName,
      amountRupees: (p.amount || 0) / 100,
      manageFundsUrl: `/manage/events/${p.eventId}?tab=funds`,
    };
  });

  const totalAmountRupees = items.reduce((acc, it) => acc + it.amountRupees, 0);

  return {
    totalPendingCount: items.length,
    totalAmountRupees,
    items,
  };
}

/**
 * Tool 7: getOrganizerEventsSummary
 */
export async function getOrganizerEventsSummary({ userId }) {
  const orgs = await Organization.find({ ownerId: userId }).select('_id name');
  const orgIds = orgs.map((o) => o._id);

  const events = await Event.find({
    $or: [{ createdBy: userId }, { orgId: { $in: orgIds } }],
  }).sort({ createdAt: -1 });

  const eventIds = events.map((e) => e._id);
  const shifts = await Shift.find({ eventId: { $in: eventIds } });
  const signups = await Signup.find({ eventId: { $in: eventIds }, status: { $in: ['confirmed', 'completed'] } });

  const shiftsByEvent = new Map();
  for (const s of shifts) {
    const eid = String(s.eventId);
    if (!shiftsByEvent.has(eid)) shiftsByEvent.set(eid, []);
    shiftsByEvent.get(eid).push(s);
  }

  const signupsByEvent = new Map();
  for (const sn of signups) {
    const eid = String(sn.eventId);
    if (!signupsByEvent.has(eid)) signupsByEvent.set(eid, []);
    signupsByEvent.get(eid).push(sn);
  }

  const items = events.map((ev) => {
    const eid = String(ev._id);
    const evShifts = shiftsByEvent.get(eid) || [];
    const evSignups = signupsByEvent.get(eid) || [];
    const totalCapacity = evShifts.reduce((acc, s) => acc + (s.capacity || 0), 0);
    const totalSpotsLeft = evShifts.reduce((acc, s) => acc + (s.spotsLeft || 0), 0);

    return {
      eventId: eid,
      title: ev.title,
      status: ev.status,
      start: ev.start ? ev.start.toISOString() : null,
      end: ev.end ? ev.end.toISOString() : null,
      venue: ev.venue?.name || 'TBD',
      totalShifts: evShifts.length,
      totalCapacity,
      spotsLeft: totalSpotsLeft,
      confirmedSignups: evSignups.length,
      manageUrl: `/manage/events/${eid}`,
      liveControlUrl: `/manage/events/${eid}?tab=live`,
      fundsUrl: `/manage/events/${eid}?tab=funds`,
    };
  });

  return {
    totalEvents: items.length,
    events: items,
  };
}

export const TOOL_EXECUTORS = {
  getMyUpcomingShifts,
  getMyShiftDetails,
  getMyAttendanceStatus,
  getMyEarningsSummary,
  getPolicyInfo,
  getOrganizerPendingPayouts,
  getOrganizerEventsSummary,
};
