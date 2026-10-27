import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Shift } from '../models/Shift.js';
import { EventRole } from '../models/EventRole.js';
import { Signup } from '../models/Signup.js';
import { Attendance } from '../models/Attendance.js';
import { Organization } from '../models/Organization.js';
import { Incident } from '../models/Incident.js';
import { ApiError } from '../utils/ApiError.js';
import { audit } from '../utils/audit.js';
import { notify } from './notify.js';
import { emitMissionUpdate } from '../socket.js';

const MIN = 60 * 1000;
const LATE_THRESHOLD_MS = 10 * MIN;
const EXPECTED_SOON_WINDOW_MS = 30 * MIN;

/**
 * Pure function to compute the complete Mission Control snapshot.
 *
 * @param {Object} event - Event document or plain object
 * @param {Array} shifts - Array of Shift objects
 * @param {Array} signups - Array of Signup objects (populated with user: name, email, phone)
 * @param {Array} attendance - Array of Attendance objects
 * @param {Date|string|number} [now=new Date()] - Reference timestamp
 * @param {Array} [roles=[]] - Optional array of EventRole objects
 * @returns {Object} Mission Control snapshot with shifts, roles, kpis, and alerts
 */
export function computeMissionSnapshot(event = {}, shifts = [], signups = [], attendance = [], now = new Date(), roles = [], incidents = []) {
  const nowMs = new Date(now).getTime();
  const safeShifts = Array.isArray(shifts) ? shifts : [];
  const safeSignups = Array.isArray(signups) ? signups : [];
  const safeAttendance = Array.isArray(attendance) ? attendance : [];
  const safeRoles = Array.isArray(roles) ? roles : [];

  // Index signups by shiftId
  const signupsByShift = new Map();
  for (const s of safeSignups) {
    const sId = String(s.shiftId?._id || s.shiftId || '');
    if (!signupsByShift.has(sId)) signupsByShift.set(sId, []);
    signupsByShift.get(sId).push(s);
  }

  // Index attendance by signupId and shiftId
  const attBySignup = new Map();
  const attByShift = new Map();
  for (const a of safeAttendance) {
    const sgnId = String(a.signupId?._id || a.signupId || '');
    const sftId = String(a.shiftId?._id || a.shiftId || '');
    if (sgnId) attBySignup.set(sgnId, a);
    if (!attByShift.has(sftId)) attByShift.set(sftId, []);
    attByShift.get(sftId).push(a);
  }

  const shiftSnapshots = [];
  const alerts = [];

  for (const shift of safeShifts) {
    const shiftId = String(shift._id || shift.id || '');
    const roleId = String(shift.roleId?._id || shift.roleId || '');
    const roleName = shift.roleId?.name || shift.roleName || 'Crew';
    const startMs = new Date(shift.start).getTime();
    const endMs = new Date(shift.end).getTime();
    const capacity = Number(shift.capacity || 0);

    const shiftSignups = signupsByShift.get(shiftId) || [];
    const shiftAtt = attByShift.get(shiftId) || [];

    const confirmedSignups = shiftSignups.filter((sg) => sg.status === 'confirmed');
    const waitlistedSignups = shiftSignups.filter((sg) => sg.status === 'waitlisted');

    const confirmed = confirmedSignups.length;
    const waitlisted = waitlistedSignups.length;
    const spotsLeft = Number(shift.spotsLeft ?? Math.max(0, capacity - confirmed));

    // Attendance breakdown
    let present = 0;
    let completed = 0;
    let noShow = 0;
    let checkedInLateCount = 0;

    for (const a of shiftAtt) {
      if (a.status === 'checked_in') present += 1;
      else if (a.status === 'completed' || a.status === 'approved') completed += 1;
      else if (a.status === 'no_show') noShow += 1;

      if (a.late) checkedInLateCount += 1;
    }

    // Identify late volunteers (confirmed volunteers missing 10+ minutes after shift start)
    const isPastGracePeriod = nowMs >= startMs + LATE_THRESHOLD_MS;
    const isShiftActiveOrRecent = nowMs <= endMs + 30 * MIN;
    let overdueMissingCount = 0;

    const volunteers = confirmedSignups.map((sg) => {
      const sgnId = String(sg._id || sg.id || '');
      const attRecord = attBySignup.get(sgnId);
      const isCheckedIn = attRecord?.status === 'checked_in';
      const isCompleted = attRecord?.status === 'completed' || attRecord?.status === 'approved';
      const isNoShow = attRecord?.status === 'no_show';
      const isOverdueMissing = isPastGracePeriod && isShiftActiveOrRecent && !isCheckedIn && !isCompleted && !isNoShow;

      const volunteerName = sg.user?.name || (typeof sg.userId === 'object' ? sg.userId?.name : null) || sg.userName || 'Volunteer';
      const volunteerEmail = sg.user?.email || (typeof sg.userId === 'object' ? sg.userId?.email : null) || sg.userEmail || '';
      const volunteerPhone = sg.user?.phone || (typeof sg.userId === 'object' ? sg.userId?.phone : null) || sg.userPhone || '';

      if (isOverdueMissing) {
        overdueMissingCount += 1;
        const minutesLate = Math.max(10, Math.floor((nowMs - startMs) / MIN));

        alerts.push({
          id: `late:${sgnId}`,
          type: 'late',
          severity: 'warning',
          signupId: sgnId,
          userId: String(sg.userId?._id || sg.userId || ''),
          userName: volunteerName,
          userEmail: volunteerEmail,
          userPhone: volunteerPhone,
          shiftId,
          roleId,
          roleName,
          minutesLate,
          message: `${volunteerName} is ${minutesLate}m late for ${roleName}`,
          timestamp: new Date(now).toISOString(),
        });
      }

      return {
        signupId: sgnId,
        userId: String(sg.userId?._id || sg.userId || ''),
        name: volunteerName,
        email: volunteerEmail,
        phone: volunteerPhone,
        reliabilityScore: sg.user?.reliabilityScore ?? sg.userId?.reliabilityScore ?? sg.reliabilityScore ?? 100,
        status: sg.status,
        attendanceStatus: attRecord?.status || (isOverdueMissing ? 'late' : 'expected'),
        late: Boolean(attRecord?.late || isOverdueMissing),
        checkInAt: attRecord?.checkInAt || null,
        checkOutAt: attRecord?.checkOutAt || null,
      };
    });

    const late = overdueMissingCount + checkedInLateCount;

    // Expected soon: shifts starting within 30m, or shift started < 10m ago and volunteer not yet checked in
    let expectedSoon = 0;
    if (nowMs < startMs && startMs - nowMs <= EXPECTED_SOON_WINDOW_MS) {
      expectedSoon = confirmed - (present + completed);
    } else if (nowMs >= startMs && nowMs < startMs + LATE_THRESHOLD_MS) {
      expectedSoon = Math.max(0, confirmed - (present + completed));
    }

    // Gap: missing confirmed crew
    const gap = Math.max(0, confirmed - present);

    // Alert 1: understaffed (present below confirmed, 10+ minutes after start)
    const isUnderstaffed = isPastGracePeriod && nowMs <= endMs + 30 * MIN && present < confirmed;
    if (isUnderstaffed) {
      alerts.push({
        id: `understaffed:${shiftId}`,
        type: 'understaffed',
        severity: 'critical',
        shiftId,
        roleId,
        roleName,
        present,
        confirmed,
        gap,
        message: `${roleName} is understaffed: ${present}/${confirmed} present (${gap} missing) 10m+ after start`,
        timestamp: new Date(now).toISOString(),
      });
    }

    // Alert 3: spot free with a waitlist waiting
    if (spotsLeft > 0 && waitlisted > 0) {
      alerts.push({
        id: `spot_free_waitlist:${shiftId}`,
        type: 'spot_free_waitlist',
        severity: 'info',
        shiftId,
        roleId,
        roleName,
        spotsLeft,
        waitlistedCount: waitlisted,
        message: `${spotsLeft} spot(s) open in ${roleName} with ${waitlisted} waitlisted volunteer(s)`,
        timestamp: new Date(now).toISOString(),
      });
    }

    // Determine status badge for the shift tile
    let status = 'good';
    if (nowMs < startMs) {
      status = 'pending';
    } else if (isUnderstaffed || gap > 0) {
      status = 'critical';
    } else if (late > 0) {
      status = 'warning';
    }

    shiftSnapshots.push({
      shiftId,
      roleId,
      roleName,
      start: new Date(shift.start).toISOString(),
      end: new Date(shift.end).toISOString(),
      capacity,
      spotsLeft,
      confirmed,
      present,
      completed,
      late,
      noShow,
      expectedSoon: Math.max(0, expectedSoon),
      gap,
      waitlisted,
      status,
      volunteers,
    });
  }

  // Aggregate by Role
  const roleMap = new Map();

  // Seed with all defined roles if provided
  for (const r of safeRoles) {
    const rId = String(r._id || r.id || '');
    roleMap.set(rId, {
      roleId: rId,
      roleName: r.name || 'Crew Role',
      leadId: r.leadId?._id ? String(r.leadId._id) : r.leadId ? String(r.leadId) : null,
      leadName: r.leadId?.name || null,
      shiftsCount: 0,
      capacity: 0,
      confirmed: 0,
      present: 0,
      late: 0,
      noShow: 0,
      expectedSoon: 0,
      gap: 0,
      waitlisted: 0,
      shifts: [],
      status: 'good',
    });
  }

  for (const s of shiftSnapshots) {
    if (!roleMap.has(s.roleId)) {
      roleMap.set(s.roleId, {
        roleId: s.roleId,
        roleName: s.roleName,
        leadId: null,
        leadName: null,
        shiftsCount: 0,
        capacity: 0,
        confirmed: 0,
        present: 0,
        late: 0,
        noShow: 0,
        expectedSoon: 0,
        gap: 0,
        waitlisted: 0,
        shifts: [],
        status: 'good',
      });
    }

    const r = roleMap.get(s.roleId);
    r.shiftsCount += 1;
    r.capacity += s.capacity;
    r.confirmed += s.confirmed;
    r.present += s.present;
    r.late += s.late;
    r.noShow += s.noShow;
    r.expectedSoon += s.expectedSoon;
    r.gap += s.gap;
    r.waitlisted += s.waitlisted;
    r.shifts.push(s);

    if (s.status === 'critical') r.status = 'critical';
    else if (s.status === 'warning' && r.status !== 'critical') r.status = 'warning';
  }

  const roleTotals = Array.from(roleMap.values());

  // Aggregate Event KPIs
  const totalCapacity = shiftSnapshots.reduce((acc, s) => acc + s.capacity, 0);
  const totalConfirmed = shiftSnapshots.reduce((acc, s) => acc + s.confirmed, 0);
  const totalPresent = shiftSnapshots.reduce((acc, s) => acc + s.present, 0);
  const totalCompleted = shiftSnapshots.reduce((acc, s) => acc + s.completed, 0);
  const totalLate = shiftSnapshots.reduce((acc, s) => acc + s.late, 0);
  const totalNoShow = shiftSnapshots.reduce((acc, s) => acc + s.noShow, 0);
  const totalExpectedSoon = shiftSnapshots.reduce((acc, s) => acc + s.expectedSoon, 0);
  const totalWaitlisted = shiftSnapshots.reduce((acc, s) => acc + s.waitlisted, 0);
  const totalGap = shiftSnapshots.reduce((acc, s) => acc + s.gap, 0);

  // Unshift volunteer-reported issues into alerts so organizers see them immediately
  const safeIncidents = Array.isArray(incidents) ? incidents : [];
  for (const inc of safeIncidents) {
    alerts.unshift({
      id: `incident_${inc._id || inc.id}`,
      incidentId: String(inc._id || inc.id),
      type: 'volunteer_issue',
      severity: 'critical',
      category: inc.category || 'other',
      message: `[${(inc.category || 'ISSUE').toUpperCase()}] ${inc.userName || 'Volunteer'}: "${inc.message}"`,
      reporterName: inc.userName || 'Volunteer',
      reporterEmail: inc.userEmail || '',
      reporterPhone: inc.userPhone || '',
      createdAt: inc.createdAt || new Date(),
    });
  }

  const attendanceRate = totalConfirmed > 0 ? Math.round((totalPresent / totalConfirmed) * 100) : 0;
  const criticalAlertsCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningAlertsCount = alerts.filter((a) => a.severity === 'warning').length;
  const infoAlertsCount = alerts.filter((a) => a.severity === 'info').length;

  return {
    eventId: String(event._id || event.id || ''),
    eventTitle: event.title || 'Event Mission Control',
    eventStatus: event.status || 'published',
    now: new Date(now).toISOString(),
    kpis: {
      totalCapacity,
      totalConfirmed,
      totalPresent,
      totalCompleted,
      totalLate,
      totalNoShow,
      totalExpectedSoon,
      totalWaitlisted,
      totalGap,
      attendanceRate,
      activeAlertsCount: alerts.length,
      criticalAlertsCount,
      warningAlertsCount,
      infoAlertsCount,
      shiftsCount: shiftSnapshots.length,
      rolesCount: roleTotals.length,
    },
    roles: roleTotals,
    shifts: shiftSnapshots,
    alerts,
  };
}

/**
 * Checks if a user has permission to access Mission Control for an event.
 * Admins, members of the event organization, and role team leads are authorized.
 */
export async function canAccessMissionControl(user, event) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!event) return false;

  const org = await Organization.findById(event.orgId).select('members');
  if (org?.members?.some((m) => String(m.userId) === String(user.id))) return true;

  const isLead = await EventRole.exists({ eventId: event._id, leadId: user.id });
  return Boolean(isLead);
}

/**
 * Loads DB documents and returns computeMissionSnapshot for an event.
 */
export async function getMissionSnapshot(eventId, now = new Date()) {
  const [event, shifts, roles, signups, attendance, incidents] = await Promise.all([
    Event.findById(eventId),
    Shift.find({ eventId, status: { $ne: 'cancelled' } }).populate('roleId', 'name leadId'),
    EventRole.find({ eventId }).populate('leadId', 'name email phone'),
    Signup.find({ eventId, status: { $in: ['confirmed', 'waitlisted', 'pending', 'confirming'] } })
      .populate('userId', 'name email phone reliabilityScore'),
    Attendance.find({ eventId }),
    Incident.find({ eventId, status: 'open' }).sort({ createdAt: -1 }),
  ]);

  if (!event) throw ApiError.notFound('Event not found');
  return computeMissionSnapshot(event, shifts, signups, attendance, now, roles, incidents);
}

/**
 * Action: Notifies waitlisted volunteers for a shift that backup may be needed.
 */
export async function pingBackups(shiftId, actor) {
  const shift = await Shift.findById(shiftId).populate('roleId', 'name');
  if (!shift) throw ApiError.notFound('Shift not found');

  const event = await Event.findById(shift.eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const isAllowed = await canAccessMissionControl(actor, event);
  if (!isAllowed) throw ApiError.forbidden('You are not authorized to ping backups for this event');

  const waitlisted = await Signup.find({ shiftId: shift._id, status: 'waitlisted' }).select('userId');
  if (!waitlisted.length) {
    return { ok: true, success: true, pinged: 0, notifiedCount: 0, message: 'No waitlisted volunteers for this shift' };
  }

  const userIds = waitlisted.map((s) => s.userId);
  await notify(userIds, {
    type: 'mission_backup_ping',
    title: `Backup needed: ${shift.roleId?.name || 'Volunteer Crew'}`,
    body: `A spot may be opening up immediately for ${shift.roleId?.name || 'your shift'}. Please check your ShiftCrew passes now.`,
    link: `/events/${event._id}`,
  });

  await audit(actor, 'mission.ping_backups', {
    entityType: 'Shift',
    entityId: shift._id,
    eventId: event._id,
    orgId: event.orgId,
    meta: { pingedCount: userIds.length },
  });

  return { ok: true, success: true, pinged: userIds.length, notifiedCount: userIds.length, message: `Pinged ${userIds.length} waitlisted volunteer(s)` };
}

/**
 * Action: Sends a direct check-in nudge notification to a late volunteer.
 */
export async function nudgeVolunteer(signupId, actor) {
  const signup = await Signup.findById(signupId).populate('shiftId').populate('roleId', 'name');
  if (!signup) throw ApiError.notFound('Sign-up record not found');

  const event = await Event.findById(signup.eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const isAllowed = await canAccessMissionControl(actor, event);
  if (!isAllowed) throw ApiError.forbidden('You are not authorized to nudge volunteers for this event');

  await notify(signup.userId, {
    type: 'mission_volunteer_nudge',
    title: `Reporting Reminder: ${signup.roleId?.name || 'Your Shift'}`,
    body: `Your event team is waiting for you at the check-in desk! Please report and scan your pass now.`,
    link: `/pass/${signup.shiftId?._id || signup.shiftId}`,
  });

  await audit(actor, 'mission.nudge', {
    entityType: 'Signup',
    entityId: signup._id,
    eventId: event._id,
    orgId: event.orgId,
    meta: { volunteerId: signup.userId },
  });

  return { ok: true, success: true, message: 'Check-in reminder sent to volunteer' };
}

/**
 * Action: Sends an announcement broadcast to all volunteers who have signed up for this event.
 * Delivered directly into their in-app notification center/bell icon.
 */
export async function broadcastToEventVolunteers(eventId, { title, message, priority = 'normal' }, actor) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const isAllowed = await canAccessMissionControl(actor, event);
  if (!isAllowed) throw ApiError.forbidden('Only organizers and team leads may broadcast announcements');

  const signups = await Signup.find({
    eventId: event._id,
    status: { $in: ['confirmed', 'pending', 'waitlisted'] },
  }).select('userId');

  const userIds = [...new Set(signups.map((s) => String(s.userId)).filter(Boolean))];

  const prefix = priority === 'urgent' ? '🚨 URGENT: ' : '📢 ';
  const notifTitle = title ? `${prefix}${title}` : `${prefix}${event.title} Announcement`;

  await notify(userIds, {
    type: 'event_broadcast',
    title: notifTitle,
    body: message,
    link: `/events/${event._id}`,
  });

  await audit(actor, 'mission.broadcast', {
    entityType: 'Event',
    entityId: event._id,
    meta: { recipientCount: userIds.length, message, priority },
  });

  emitMissionUpdate(event._id, {
    reason: 'broadcast',
    details: { message: `Organizer broadcast sent to ${userIds.length} volunteers: "${message.slice(0, 50)}"`, title },
  });

  return { ok: true, success: true, count: userIds.length, message: `Broadcast sent to ${userIds.length} volunteer(s)` };
}

/**
 * Action: Volunteer reports an on-ground issue from the event page directly to Control Room.
 */
export async function reportVolunteerIncident(eventId, { category = 'other', message }, user) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const incident = await Incident.create({
    eventId: event._id,
    userId: user.id || user._id,
    userName: user.name || 'Volunteer',
    userEmail: user.email || '',
    userPhone: user.phone || '',
    category,
    message,
    status: 'open',
  });

  await audit(user, 'mission.incident_reported', {
    entityType: 'Incident',
    entityId: incident._id,
    eventId: event._id,
    meta: { category, message },
  });

  emitMissionUpdate(event._id, {
    reason: 'incident_report',
    details: {
      message: `[${category.toUpperCase()}] ${user.name || 'Volunteer'}: "${message.slice(0, 50)}"`,
      incidentId: incident._id,
      category,
    },
  });

  return { ok: true, success: true, incident, message: 'Issue reported to Control Room in real-time!' };
}

/**
 * Action: Organizer resolves a volunteer-reported issue.
 */
export async function resolveIncident(incidentId, actor) {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw ApiError.notFound('Incident not found');

  const event = await Event.findById(incident.eventId);
  if (!event) throw ApiError.notFound('Event not found');

  const isAllowed = await canAccessMissionControl(actor, event);
  if (!isAllowed) throw ApiError.forbidden('Only organizers and team leads may resolve incidents');

  incident.status = 'resolved';
  incident.resolvedAt = new Date();
  incident.resolvedBy = actor.id;
  await incident.save();

  await audit(actor, 'mission.incident_resolved', {
    entityType: 'Incident',
    entityId: incident._id,
    eventId: event._id,
  });

  emitMissionUpdate(event._id, {
    reason: 'incident_resolved',
    details: { message: `Incident resolved by organizer`, incidentId: incident._id },
  });

  return { ok: true, success: true, incident, message: 'Incident marked as resolved' };
}
