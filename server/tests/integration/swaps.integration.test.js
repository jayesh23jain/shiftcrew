import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Organization } from '../../src/models/Organization.js';
import { Event } from '../../src/models/Event.js';
import { EventRole } from '../../src/models/EventRole.js';
import { Shift } from '../../src/models/Shift.js';
import { Signup } from '../../src/models/Signup.js';
import { SwapRequest } from '../../src/models/SwapRequest.js';
import { Notification } from '../../src/models/Notification.js';
import { expirePendingSwaps } from '../../src/services/swap.service.js';
import { connectTestDb, disconnectTestDb } from './testDb.js';

let server, base;
let orgUser, volunteerA, volunteerB, volunteerC;
let testOrg, testEvent, testRole, testShift, signupA;

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
  return { token: r.body.accessToken, id: r.body.user._id, email, name };
}

beforeAll(async () => {
  await connectTestDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  // Register users
  orgUser = await register('Swap Organizer', 'organizer');
  volunteerA = await register('Volunteer Alice', 'volunteer');
  volunteerB = await register('Volunteer Bob', 'volunteer');
  volunteerC = await register('Volunteer Charlie', 'volunteer');

  // Setup Org
  testOrg = await Organization.create({
    name: 'Shift Swap Organization',
    ownerId: orgUser.id,
    createdBy: orgUser.id,
    members: [{ userId: orgUser.id, role: 'owner' }],
  });

  // Setup Event (tomorrow)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000);

  testEvent = await Event.create({
    orgId: testOrg._id,
    createdBy: orgUser.id,
    title: 'Swap Fest 2026',
    startDate: tomorrow,
    endDate: dayAfter,
    status: 'published',
  });

  testRole = await EventRole.create({
    eventId: testEvent._id,
    orgId: testOrg._id,
    name: 'Hospitality Crew',
  });

  // Shift: starts in 10 hours, capacity 2, 1 spot left
  const shiftStart = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const shiftEnd = new Date(Date.now() + 14 * 60 * 60 * 1000);

  testShift = await Shift.create({
    eventId: testEvent._id,
    roleId: testRole._id,
    orgId: testOrg._id,
    start: shiftStart,
    end: shiftEnd,
    capacity: 2,
    spotsLeft: 0, // 2 confirmed spots taken
    payType: 'flat',
    rate: 150000, // 1500 Rs
    status: 'open',
  });

  // Volunteer A confirmed signup
  signupA = await Signup.create({
    shiftId: testShift._id,
    eventId: testEvent._id,
    roleId: testRole._id,
    orgId: testOrg._id,
    userId: volunteerA.id,
    status: 'confirmed',
    start: shiftStart,
    end: shiftEnd,
    estPay: 150000,
  });

  // Waitlisted volunteer on the same shift
  await Signup.create({
    shiftId: testShift._id,
    eventId: testEvent._id,
    roleId: testRole._id,
    orgId: testOrg._id,
    userId: volunteerC.id,
    status: 'waitlisted',
    start: shiftStart,
    end: shiftEnd,
    estPay: 150000,
  });
});

afterAll(async () => {
  if (server) await new Promise((res) => server.close(res));
  await disconnectTestDb();
});

describe('Shift Swap Board Integration Tests', () => {
  let createdSwapId;

  it('allows volunteer A to offer shift for swap and list on event swap board', async () => {
    const offerRes = await post(
      '/api/swaps/offer',
      { signupId: signupA._id, note: 'Have a college exam' },
      volunteerA.token
    );
    expect(offerRes.status).toBe(201);
    expect(offerRes.body.swap).toBeDefined();
    expect(offerRes.body.swap.status).toBe('open');
    createdSwapId = offerRes.body.swap._id;

    // Verify swap board view for volunteer B (eligible)
    const boardResB = await get(`/api/events/${testEvent._id}/swaps`, volunteerB.token);
    expect(boardResB.status).toBe(200);
    expect(boardResB.body.swaps.length).toBe(1);
    const item = boardResB.body.swaps[0];
    expect(item._id).toBe(createdSwapId);
    expect(item.isEligible).toBe(true);

    // Verify volunteer C who is already waitlisted on this shift is NOT eligible
    const boardResC = await get(`/api/events/${testEvent._id}/swaps`, volunteerC.token);
    expect(boardResC.status).toBe(200);
    const itemC = boardResC.body.swaps[0];
    expect(itemC.isEligible).toBe(false);
    expect(itemC.ineligibilityReason).toContain('already registered');
  });

  it('allows volunteer B to claim the swap', async () => {
    const claimRes = await post(`/api/swaps/${createdSwapId}/claim`, {}, volunteerB.token);
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.swap.status).toBe('claimed');
    expect(claimRes.body.swap.claimedBy).toBe(volunteerB.id);

    // Second claim fails (concurrency: only one claimer wins)
    const secondClaim = await post(`/api/swaps/${createdSwapId}/claim`, {}, volunteerC.token);
    expect(secondClaim.status).toBe(409);
  });

  it('allows original user A to cancel the swap while in claimed state', async () => {
    const cancelRes = await post(`/api/swaps/${createdSwapId}/cancel`, {}, volunteerA.token);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.swap.status).toBe('cancelled');

    // Verify volunteer B received notification of cancellation
    const notif = await Notification.findOne({ userId: volunteerB.id, type: 'swap_cancelled_by_offerer' });
    expect(notif).toBeDefined();

    // Re-offer for subsequent approval tests
    const reOffer = await post(
      '/api/swaps/offer',
      { signupId: signupA._id, note: 'Re-offering for exam' },
      volunteerA.token
    );
    expect(reOffer.status).toBe(201);
    createdSwapId = reOffer.body.swap._id;

    // Volunteer B claims again
    const claim2 = await post(`/api/swaps/${createdSwapId}/claim`, {}, volunteerB.token);
    expect(claim2.status).toBe(200);
    expect(claim2.body.swap.status).toBe('claimed');
  });

  it('blocks swap approval if taker has a schedule clash at approval time', async () => {
    // Create a conflicting shift and signup for Volunteer B
    const clashShift = await Shift.create({
      eventId: testEvent._id,
      roleId: testRole._id,
      orgId: testOrg._id,
      start: testShift.start,
      end: testShift.end,
      capacity: 5,
      spotsLeft: 4,
      status: 'open',
    });

    const clashingSignup = await Signup.create({
      shiftId: clashShift._id,
      eventId: testEvent._id,
      roleId: testRole._id,
      orgId: testOrg._id,
      userId: volunteerB.id,
      status: 'confirmed',
      start: testShift.start,
      end: testShift.end,
      estPay: 100000,
    });

    // Organizer attempts to approve -> blocked due to clash
    const approveClash = await post(`/api/swaps/${createdSwapId}/approve`, {}, orgUser.token);
    expect(approveClash.status).toBe(409);
    expect(approveClash.body.error.message).toContain('clash');

    // Remove the clashing signup so subsequent test can proceed
    await Signup.deleteOne({ _id: clashingSignup._id });
  });

  it('approves swap: atomically transfers spot, keeps spotsLeft unchanged, waitlist untouched, and invalidates old QR pass', async () => {
    // Check initial conditions
    const shiftBefore = await Shift.findById(testShift._id);
    const initialSpotsLeft = shiftBefore.spotsLeft;

    const waitlistBefore = await Signup.find({ shiftId: testShift._id, status: 'waitlisted' });
    expect(waitlistBefore.length).toBe(1);

    // Organizer approves swap
    const approveRes = await post(`/api/swaps/${createdSwapId}/approve`, {}, orgUser.token);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.swap.status).toBe('approved');

    // 1. Capacity & spotsLeft unchanged
    const shiftAfter = await Shift.findById(testShift._id);
    expect(shiftAfter.spotsLeft).toBe(initialSpotsLeft);

    // 2. Waitlist untouched (no promotion occurred)
    const waitlistAfter = await Signup.find({ shiftId: testShift._id, status: 'waitlisted' });
    expect(waitlistAfter.length).toBe(1);
    expect(waitlistAfter[0].userId.toString()).toBe(volunteerC.id);

    // 3. Old signup cancelled WITHOUT late penalty
    const oldSignup = await Signup.findById(signupA._id);
    expect(oldSignup.status).toBe('cancelled');
    expect(oldSignup.lateCancel).toBe(false);

    // 4. New signup created for taker (Volunteer B) with confirmed status and estPay transferred
    const newSignup = await Signup.findOne({ shiftId: testShift._id, userId: volunteerB.id, status: 'confirmed' });
    expect(newSignup).toBeDefined();
    expect(newSignup.estPay).toBe(150000);

    // 5. Old volunteer's QR pass is immediately dead (throws 403 Forbidden)
    const oldQrRes = await get(`/api/attendance/pass/${testShift._id}`, volunteerA.token);
    expect(oldQrRes.status).toBe(403);

    // 6. New volunteer's QR pass works immediately
    const newQrRes = await get(`/api/attendance/pass/${testShift._id}`, volunteerB.token);
    expect(newQrRes.status).toBe(200);
    expect(newQrRes.body.user.name).toBe(volunteerB.name);
  });

  it('expires open swaps 1 hour before start via scheduler, original volunteer keeps shift', async () => {
    // Create a new shift starting in 3 hours
    const nearShift = await Shift.create({
      eventId: testEvent._id,
      roleId: testRole._id,
      orgId: testOrg._id,
      start: new Date(Date.now() + 3 * 60 * 60 * 1000),
      end: new Date(Date.now() + 7 * 60 * 60 * 1000),
      capacity: 2,
      spotsLeft: 1,
      status: 'open',
    });

    const nearSignup = await Signup.create({
      shiftId: nearShift._id,
      eventId: testEvent._id,
      roleId: testRole._id,
      orgId: testOrg._id,
      userId: volunteerA.id,
      status: 'confirmed',
      start: nearShift.start,
      end: nearShift.end,
      estPay: 100000,
    });

    // Create a swap with past expiration (simulating 1 hour before start reached)
    const expiredSwap = await SwapRequest.create({
      shiftId: nearShift._id,
      eventId: testEvent._id,
      orgId: testOrg._id,
      fromSignupId: nearSignup._id,
      fromUserId: volunteerA.id,
      status: 'open',
      expiresAt: new Date(Date.now() - 1000), // already reached cutoff
    });

    // Run scheduler task
    const expiredCount = await expirePendingSwaps();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    // Verify swap marked as expired
    const inDb = await SwapRequest.findById(expiredSwap._id);
    expect(inDb.status).toBe('expired');

    // Original volunteer keeps their shift: signup is NOT cancelled
    const signupInDb = await Signup.findById(nearSignup._id);
    expect(signupInDb.status).toBe('confirmed');

    // Original volunteer received notification
    const expiredNotif = await Notification.findOne({ userId: volunteerA.id, type: 'swap_expired' });
    expect(expiredNotif).toBeDefined();
  });
});
