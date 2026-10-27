import { describe, it, expect } from 'vitest';
import { computeMissionSnapshot } from '../../src/services/mission.service.js';

describe('computeMissionSnapshot (pure logic)', () => {
  const baseEvent = {
    _id: '65a000000000000000000001',
    title: 'Hackathon 2026',
    status: 'ongoing',
  };

  it('handles edge case: empty shifts array', () => {
    const snapshot = computeMissionSnapshot(baseEvent, [], [], [], new Date());
    expect(snapshot.shifts).toEqual([]);
    expect(snapshot.roles).toEqual([]);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.kpis.totalCapacity).toBe(0);
    expect(snapshot.kpis.totalConfirmed).toBe(0);
    expect(snapshot.kpis.totalPresent).toBe(0);
    expect(snapshot.kpis.totalGap).toBe(0);
    expect(snapshot.kpis.attendanceRate).toBe(0);
    expect(snapshot.kpis.activeAlertsCount).toBe(0);
  });

  it('handles edge case: shift has not started yet', () => {
    const now = new Date('2026-10-25T10:00:00.000Z');
    const futureShift = {
      _id: '65a000000000000000000010',
      roleId: { _id: '65a000000000000000000020', name: 'Registration Desk' },
      start: new Date('2026-10-25T12:00:00.000Z'), // starts in 2 hours
      end: new Date('2026-10-25T16:00:00.000Z'),
      capacity: 5,
      spotsLeft: 2,
    };

    const signups = [
      {
        _id: '65a000000000000000000031',
        shiftId: futureShift._id,
        userId: { _id: 'u1', name: 'Alice', email: 'alice@test.dev' },
        status: 'confirmed',
      },
      {
        _id: '65a000000000000000000032',
        shiftId: futureShift._id,
        userId: { _id: 'u2', name: 'Bob', email: 'bob@test.dev' },
        status: 'confirmed',
      },
      {
        _id: '65a000000000000000000033',
        shiftId: futureShift._id,
        userId: { _id: 'u3', name: 'Charlie', email: 'charlie@test.dev' },
        status: 'confirmed',
      },
    ];

    const snapshot = computeMissionSnapshot(baseEvent, [futureShift], signups, [], now);

    expect(snapshot.shifts).toHaveLength(1);
    const s = snapshot.shifts[0];
    expect(s.confirmed).toBe(3);
    expect(s.present).toBe(0);
    expect(s.gap).toBe(3);
    expect(s.status).toBe('pending');

    // No late or understaffed alerts before shift start
    expect(snapshot.alerts.filter((a) => a.type === 'understaffed')).toHaveLength(0);
    expect(snapshot.alerts.filter((a) => a.type === 'late')).toHaveLength(0);
    expect(snapshot.kpis.activeAlertsCount).toBe(0);
  });

  it('handles edge case: all absent 10+ minutes after shift start', () => {
    const now = new Date('2026-10-25T10:15:00.000Z');
    const startedShift = {
      _id: '65a000000000000000000011',
      roleId: { _id: '65a000000000000000000021', name: 'Crowd Control' },
      start: new Date('2026-10-25T10:00:00.000Z'), // started 15 min ago
      end: new Date('2026-10-25T14:00:00.000Z'),
      capacity: 3,
      spotsLeft: 1,
    };

    const signups = [
      {
        _id: '65a000000000000000000041',
        shiftId: startedShift._id,
        userId: { _id: 'u1', name: 'Dev', email: 'dev@test.dev', phone: '9876543210' },
        status: 'confirmed',
      },
      {
        _id: '65a000000000000000000042',
        shiftId: startedShift._id,
        userId: { _id: 'u2', name: 'Elena', email: 'elena@test.dev', phone: '9876543211' },
        status: 'confirmed',
      },
    ];

    // No attendance records at all -> all absent
    const snapshot = computeMissionSnapshot(baseEvent, [startedShift], signups, [], now);

    const s = snapshot.shifts[0];
    expect(s.present).toBe(0);
    expect(s.confirmed).toBe(2);
    expect(s.gap).toBe(2);
    expect(s.late).toBe(2);
    expect(s.status).toBe('critical');

    // Understaffed alert triggered
    const understaffed = snapshot.alerts.find((a) => a.type === 'understaffed');
    expect(understaffed).toBeDefined();
    expect(understaffed.severity).toBe('critical');
    expect(understaffed.gap).toBe(2);

    // Late alerts for both missing volunteers
    const lateAlerts = snapshot.alerts.filter((a) => a.type === 'late');
    expect(lateAlerts).toHaveLength(2);
    expect(lateAlerts[0].minutesLate).toBe(15);
    expect(lateAlerts.map((l) => l.userName).sort()).toEqual(['Dev', 'Elena']);
  });

  it('triggers spot_free_waitlist alert when open spots exist with waitlist', () => {
    const now = new Date('2026-10-25T09:00:00.000Z');
    const shift = {
      _id: '65a000000000000000000012',
      roleId: { _id: '65a000000000000000000022', name: 'Stage AV' },
      start: new Date('2026-10-25T11:00:00.000Z'),
      end: new Date('2026-10-25T15:00:00.000Z'),
      capacity: 4,
      spotsLeft: 2, // 2 open spots
    };

    const signups = [
      { _id: 's1', shiftId: shift._id, userId: 'u1', status: 'confirmed' },
      { _id: 's2', shiftId: shift._id, userId: 'u2', status: 'confirmed' },
      { _id: 'w1', shiftId: shift._id, userId: 'u3', status: 'waitlisted' },
      { _id: 'w2', shiftId: shift._id, userId: 'u4', status: 'waitlisted' },
      { _id: 'w3', shiftId: shift._id, userId: 'u5', status: 'waitlisted' },
    ];

    const snapshot = computeMissionSnapshot(baseEvent, [shift], signups, [], now);

    const alert = snapshot.alerts.find((a) => a.type === 'spot_free_waitlist');
    expect(alert).toBeDefined();
    expect(alert.severity).toBe('info');
    expect(alert.spotsLeft).toBe(2);
    expect(alert.waitlistedCount).toBe(3);
  });

  it('computes on-time attendance and KPI rates accurately', () => {
    const now = new Date('2026-10-25T10:30:00.000Z');
    const shift = {
      _id: '65a000000000000000000013',
      roleId: { _id: '65a000000000000000000023', name: 'Helpdesk' },
      start: new Date('2026-10-25T10:00:00.000Z'),
      end: new Date('2026-10-25T14:00:00.000Z'),
      capacity: 2,
      spotsLeft: 0,
    };

    const signups = [
      { _id: 's1', shiftId: shift._id, userId: { _id: 'u1', name: 'Farhan' }, status: 'confirmed' },
      { _id: 's2', shiftId: shift._id, userId: { _id: 'u2', name: 'Gita' }, status: 'confirmed' },
    ];

    const attendance = [
      { _id: 'a1', signupId: 's1', shiftId: shift._id, userId: 'u1', status: 'checked_in', late: false, checkInAt: new Date('2026-10-25T09:55:00.000Z') },
      { _id: 'a2', signupId: 's2', shiftId: shift._id, userId: 'u2', status: 'checked_in', late: false, checkInAt: new Date('2026-10-25T10:02:00.000Z') },
    ];

    const snapshot = computeMissionSnapshot(baseEvent, [shift], signups, attendance, now);

    expect(snapshot.kpis.totalConfirmed).toBe(2);
    expect(snapshot.kpis.totalPresent).toBe(2);
    expect(snapshot.kpis.totalGap).toBe(0);
    expect(snapshot.kpis.attendanceRate).toBe(100);
    expect(snapshot.kpis.activeAlertsCount).toBe(0);
    expect(snapshot.shifts[0].status).toBe('good');
  });

  it('does not double count missing volunteer if marked no-show', () => {
    const now = new Date('2026-10-25T11:00:00.000Z');
    const shift = {
      _id: '65a000000000000000000014',
      roleId: { _id: '65a000000000000000000024', name: 'Logistics' },
      start: new Date('2026-10-25T10:00:00.000Z'),
      end: new Date('2026-10-25T14:00:00.000Z'),
      capacity: 2,
      spotsLeft: 0,
    };

    const signups = [
      { _id: 's1', shiftId: shift._id, userId: { _id: 'u1', name: 'Harry' }, status: 'confirmed' },
      { _id: 's2', shiftId: shift._id, userId: { _id: 'u2', name: 'Isha' }, status: 'confirmed' },
    ];

    const attendance = [
      { _id: 'a1', signupId: 's1', shiftId: shift._id, userId: 'u1', status: 'checked_in', late: false },
      { _id: 'a2', signupId: 's2', shiftId: shift._id, userId: 'u2', status: 'no_show' },
    ];

    const snapshot = computeMissionSnapshot(baseEvent, [shift], signups, attendance, now);

    expect(snapshot.shifts[0].present).toBe(1);
    expect(snapshot.shifts[0].noShow).toBe(1);
    // Isha is marked no_show, so she should not produce a missing late alert
    const ishaAlert = snapshot.alerts.find((a) => a.type === 'late' && a.signupId === 's2');
    expect(ishaAlert).toBeUndefined();
  });
});
