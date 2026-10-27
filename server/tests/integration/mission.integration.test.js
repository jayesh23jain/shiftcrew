import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import mongoose from 'mongoose';
import { io as Client } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { initSocketServer, closeSocketServer } from '../../src/socket.js';
import { User } from '../../src/models/User.js';
import { Organization } from '../../src/models/Organization.js';
import { Event } from '../../src/models/Event.js';
import { EventRole } from '../../src/models/EventRole.js';
import { Shift } from '../../src/models/Shift.js';
import { Signup } from '../../src/models/Signup.js';
import { Incident } from '../../src/models/Incident.js';
import { Notification } from '../../src/models/Notification.js';
import { checkIn } from '../../src/services/attendance.service.js';
import { connectTestDb, disconnectTestDb } from './testDb.js';

let server, socketUrl, base;
let orgUser, volunteerUser, otherVolunteer;
let testOrg, testEvent, testRole, testShift, testSignup;

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const post = (p, b, t) => call('POST', p, b, t);
const get = (p, t) => call('GET', p, undefined, t);

async function register(name, role = 'volunteer') {
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.dev`;
  const r = await post('/api/auth/register', { name, email, password: 'Password123', role });
  expect(r.status).toBe(201);
  return { token: r.body.accessToken, id: r.body.user._id, email };
}

beforeAll(async () => {
  await connectTestDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

  const app = createApp();
  server = http.createServer(app);
  initSocketServer(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  socketUrl = `http://127.0.0.1:${port}`;

  // Create Users
  orgUser = await register('Mission Organizer', 'organizer');
  volunteerUser = await register('Volunteer Val', 'volunteer');
  otherVolunteer = await register('Sneaky Stan', 'volunteer');

  // Create Org
  const orgRes = await post('/api/orgs', { name: 'Mission Control Org' }, orgUser.token);
  expect(orgRes.status).toBe(201);
  testOrg = orgRes.body.org;

  // Create Event
  const now = new Date();
  const eventStart = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
  const eventEnd = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const futureShiftStart = new Date(now.getTime() + 2 * 60 * 1000); // 2 min in future for creation validation
  const shiftEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const eventRes = await post('/api/events', {
    orgId: testOrg._id,
    title: 'Hackathon Ops',
    category: 'hackathon',
    startDate: eventStart.toISOString(),
    endDate: eventEnd.toISOString(),
    applicationMode: 'open',
    venue: { name: 'Tech Park', address: '123 Tech Way', city: 'Mumbai' },
  }, orgUser.token);
  expect(eventRes.status).toBe(201);
  testEvent = eventRes.body.event;

  // Create Role
  const roleRes = await post(`/api/events/${testEvent._id}/roles`, {
    name: 'Helpdesk Tech',
    description: 'Assist attendees',
  }, orgUser.token);
  expect(roleRes.status).toBe(201);
  testRole = roleRes.body.role;

  // Create Shift
  const shiftRes = await post(`/api/events/${testEvent._id}/shifts`, {
    roleId: testRole._id,
    start: futureShiftStart.toISOString(),
    end: shiftEnd.toISOString(),
    capacity: 2,
    payType: 'unpaid',
  }, orgUser.token);
  expect(shiftRes.status).toBe(201);
  testShift = shiftRes.body.shift;

  // Publish event so it can be joined
  const pubRes = await post(`/api/events/${testEvent._id}/status`, { status: 'published' }, orgUser.token);
  expect(pubRes.status).toBe(200);

  // Volunteer joins shift
  const joinRes = await post(`/api/shifts/${testShift._id}/join`, {}, volunteerUser.token);
  expect(joinRes.status).toBe(201);
  testSignup = joinRes.body.signup;

  // Now set the shift start to 15 minutes ago to simulate an active, ongoing shift
  const ongoingStart = new Date(now.getTime() - 15 * 60 * 1000);
  await Shift.findByIdAndUpdate(testShift._id, { start: ongoingStart });
});

afterAll(async () => {
  closeSocketServer();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectTestDb();
});

describe('Mission Control Real-Time Integration Tests', () => {
  it('rejects unauthenticated socket connections at handshake', async () => {
    const err = await new Promise((resolve) => {
      const socket = Client(socketUrl, {
        path: '/socket.io',
        auth: {}, // no token
        reconnection: false,
      });
      socket.on('connect_error', (e) => {
        socket.disconnect();
        resolve(e);
      });
      socket.on('connect', () => {
        socket.disconnect();
        resolve(new Error('Should not have connected'));
      });
    });

    expect(err).toBeDefined();
    expect(err.message).toMatch(/authentication/i);
  });

  it('rejects socket with invalid token at handshake', async () => {
    const err = await new Promise((resolve) => {
      const socket = Client(socketUrl, {
        path: '/socket.io',
        auth: { token: 'invalid.jwt.token' },
        reconnection: false,
      });
      socket.on('connect_error', (e) => {
        socket.disconnect();
        resolve(e);
      });
    });

    expect(err).toBeDefined();
    expect(err.message).toMatch(/invalid or expired/i);
  });

  it('prevents volunteer from joining room for an event they do not manage', async () => {
    const socket = Client(socketUrl, {
      path: '/socket.io',
      auth: { token: volunteerUser.token },
      reconnection: false,
    });

    await new Promise((resolve) => socket.on('connect', resolve));

    const err = await new Promise((resolve) => {
      socket.on('error', (e) => resolve(typeof e === 'string' ? e : e?.message));
      socket.emit('join', { eventId: testEvent._id }, (res) => {
        if (res?.error) resolve(res.error);
      });
    });

    expect(err).toBeDefined();
    expect(err).toMatch(/unauthorized/i);
    socket.disconnect();
  });

  it('allows org member to connect and receive initial mission snapshot on join', async () => {
    const socket = Client(socketUrl, {
      path: '/socket.io',
      auth: { token: orgUser.token },
      reconnection: false,
    });

    await new Promise((resolve) => socket.on('connect', resolve));

    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for snapshot')), 4000);
      socket.on('snapshot', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      socket.emit('join', { eventId: testEvent._id });
    });

    expect(snapshot).toBeDefined();
    expect(snapshot.kpis).toBeDefined();
    expect(snapshot.kpis.totalCapacity).toBe(2);
    expect(snapshot.kpis.totalConfirmed).toBe(1);
    expect(snapshot.shifts).toHaveLength(1);
    expect(snapshot.shifts[0].shiftId).toBe(testShift._id);

    socket.disconnect();
  });

  it('emits an update to connected control room within 2 seconds after a check-in', async () => {
    const socket = Client(socketUrl, {
      path: '/socket.io',
      auth: { token: orgUser.token },
      reconnection: false,
    });

    await new Promise((resolve) => socket.on('connect', resolve));

    await new Promise((resolve) => {
      socket.once('snapshot', resolve);
      socket.emit('join', { eventId: testEvent._id });
    });

    const updatePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for update emission')), 3000);
      socket.once('update', (diff) => {
        clearTimeout(timeout);
        resolve(diff);
      });
    });

    // Check in the volunteer
    const shift = await Shift.findById(testShift._id);
    const signup = await Signup.findById(testSignup._id);
    await checkIn(signup, shift, orgUser.id, { manual: true });

    const update = await updatePromise;
    expect(update).toBeDefined();
    expect(update.reason).toBe('check_in');
    expect(update.details?.shiftId).toBe(testShift._id.toString());

    socket.disconnect();
  });

  it('serves GET /api/events/:id/mission for fallback polling', async () => {
    // Org member can fetch
    const res = await get(`/api/events/${testEvent._id}/mission`, orgUser.token);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toBeDefined();
    expect(res.body.kpis.totalPresent).toBe(1); // checked in in previous test

    // Non-managing volunteer is rejected with 403
    const badRes = await get(`/api/events/${testEvent._id}/mission`, otherVolunteer.token);
    expect(badRes.status).toBe(403);
  });

  it('handles POST /api/events/:id/mission/ping-backups and /nudge with authorization', async () => {
    // Ping backups
    const pingRes = await post(`/api/events/${testEvent._id}/mission/ping-backups`, { shiftId: testShift._id }, orgUser.token);
    expect(pingRes.status).toBe(200);
    expect(pingRes.body.notifiedCount).toBeDefined();

    // Nudge volunteer
    const nudgeRes = await post(`/api/events/${testEvent._id}/mission/nudge`, { signupId: testSignup._id }, orgUser.token);
    expect(nudgeRes.status).toBe(200);
    expect(nudgeRes.body.success).toBe(true);

    // Non-organizer is forbidden
    const badPing = await post(`/api/events/${testEvent._id}/mission/ping-backups`, { shiftId: testShift._id }, otherVolunteer.token);
    expect(badPing.status).toBe(403);
  });

  it('broadcasts an organizer message to all event volunteers notification bar', async () => {
    // Non-organizer is forbidden
    const forbiddenRes = await post(
      `/api/events/${testEvent._id}/mission/broadcast`,
      { title: 'Test Alert', message: 'Gate 2 opening soon', priority: 'urgent' },
      otherVolunteer.token
    );
    expect(forbiddenRes.status).toBe(403);

    // Organizer sends broadcast
    const broadcastRes = await post(
      `/api/events/${testEvent._id}/mission/broadcast`,
      { title: 'Emergency Briefing', message: 'All volunteers report to main tent', priority: 'urgent' },
      orgUser.token
    );
    expect(broadcastRes.status).toBe(200);
    expect(broadcastRes.body.count).toBeGreaterThanOrEqual(1);

    // Verify volunteer received notification
    const notifications = await Notification.find({ userId: volunteerUser.id }).sort({ createdAt: -1 });
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0].title).toContain('Emergency Briefing');
    expect(notifications[0].body).toBe('All volunteers report to main tent');
  });

  it('allows volunteer to report issue to mission control real-time incident alerts and organizer to resolve it', async () => {
    // Connect organizer socket to observe real-time incident alert
    const socket = Client(socketUrl, {
      path: '/socket.io',
      auth: { token: orgUser.token },
      reconnection: false,
    });

    await new Promise((resolve) => socket.on('connect', resolve));
    await new Promise((resolve) => {
      socket.once('snapshot', resolve);
      socket.emit('join', { eventId: testEvent._id });
    });

    const updatePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for incident alert')), 4000);
      socket.once('update', (diff) => {
        clearTimeout(timeout);
        resolve(diff);
      });
    });

    // Volunteer reports issue
    const reportRes = await post(
      `/api/events/${testEvent._id}/mission/report-issue`,
      { category: 'supplies', message: 'Water bottles ran out at Registration Desk' },
      volunteerUser.token
    );
    expect(reportRes.status).toBe(201);
    expect(reportRes.body.incident).toBeDefined();
    expect(reportRes.body.incident.status).toBe('open');

    // Control room receives update
    const update = await updatePromise;
    expect(update).toBeDefined();
    expect(update.reason).toBe('incident_report');

    // Verify incident appears in snapshot alerts
    const snapRes = await get(`/api/events/${testEvent._id}/mission`, orgUser.token);
    const incidentAlert = snapRes.body.alerts.find((a) => a.incidentId === reportRes.body.incident._id);
    expect(incidentAlert).toBeDefined();
    expect(incidentAlert.message).toContain('Water bottles ran out');

    // Organizer resolves the incident
    const resolveRes = await post(
      `/api/events/${testEvent._id}/mission/resolve-issue`,
      { incidentId: reportRes.body.incident._id },
      orgUser.token
    );
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('resolved');

    // In database, incident is now marked resolved
    const inDb = await Incident.findById(reportRes.body.incident._id);
    expect(inDb.status).toBe('resolved');

    socket.disconnect();
  });
});

