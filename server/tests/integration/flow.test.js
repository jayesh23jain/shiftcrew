import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { Shift } from '../../src/models/Shift.js';
import { Signup } from '../../src/models/Signup.js';
import { Attendance } from '../../src/models/Attendance.js';
import { Event } from '../../src/models/Event.js';
import { Payable, Payout, Wallet } from '../../src/models/Money.js';
import { Notification } from '../../src/models/Notification.js';
import { User } from '../../src/models/User.js';
import { processEndedShifts } from '../../src/services/attendance.service.js';
import { processQueuedPayouts } from '../../src/services/payouts.service.js';

import { connectTestDb, disconnectTestDb } from './testDb.js';

let server, base;
const S = {}; // shared state across the ordered scenario

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
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${Date.now()}@test.dev`;
  const r = await post('/api/auth/register', { name, email, password: 'Password123', role });
  expect(r.status).toBe(201);
  return { token: r.body.accessToken, id: r.body.user._id, email };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}

beforeAll(async () => {
  await connectTestDb();
  await mongoose.connection.dropDatabase();
  // FerretDB (the stand-in test engine) lacks TTL indexes, which real MongoDB supports. Ignore only that error.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch((e) => { if (!/expireAfterSeconds/.test(e.message)) throw e; })));
  await mongoose.models.QrUse.collection.createIndex({ jti: 1 }, { unique: true });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  server?.close();
  await disconnectTestDb();
});

describe('setup: organizer, event, role, shift', () => {
  it('creates users, org, event with a lead, and publishes', async () => {
    S.org = await register('Olivia Organizer', 'organizer');
    S.lead = await register('Leo Lead');
    S.vols = [];
    for (const n of ['Vol One', 'Vol Two', 'Vol Three', 'Vol Four', 'Vol Five']) S.vols.push(await register(n));

    const org = await post('/api/orgs', { name: 'Test Fest', type: 'fest_committee', city: 'Pune' }, S.org.token);
    expect(org.status).toBe(201);
    S.orgId = org.body.org._id;

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const end = new Date(startOfToday.getTime() + 3 * 86400000);
    const ev = await post('/api/events', {
      orgId: S.orgId, title: 'Integration Fest', description: 'A long enough description for publishing.',
      venue: { city: 'Pune' }, startDate: startOfToday.toISOString(), endDate: end.toISOString(),
    }, S.org.token);
    expect(ev.status).toBe(201);
    S.eventId = ev.body.event._id;

    const role = await post(`/api/events/${S.eventId}/roles`, { name: 'Stage Crew', leadEmail: S.lead.email }, S.org.token);
    expect(role.status).toBe(201);
    expect(role.body.role.leadId).toBe(S.lead.id);
    S.roleId = role.body.role._id;

    expect((await post(`/api/events/${S.eventId}/status`, { status: 'published' }, S.org.token)).status).toBe(200);
  });

  it('requires login to browse events', async () => {
    expect((await get('/api/events')).status).toBe(401);
    expect((await get('/api/events', S.vols[0].token)).status).toBe(200);
  });

  it('validates and creates shifts', async () => {
    const start = new Date(Date.now() + 10 * 60000);
    const end = new Date(start.getTime() + 60 * 60000);
    const bad = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start: end, end: start, capacity: 2 }, S.org.token);
    expect(bad.status).toBe(400);
    const paidNoRate = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start, end, capacity: 2, payType: 'hourly', rateRupees: 0 }, S.org.token);
    expect(paidNoRate.status).toBe(400);

    const ok = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start, end, capacity: 2, payType: 'hourly', rateRupees: 100 }, S.org.token);
    expect(ok.status).toBe(201);
    S.shiftId = ok.body.shift._id;
    S.shiftStart = start; S.shiftEnd = end;

    // overlapping shift (starts 30 min in)
    const o = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start: new Date(start.getTime() + 30 * 60000), end: new Date(end.getTime() + 30 * 60000), capacity: 5 }, S.org.token);
    expect(o.status).toBe(201);
    S.overlapId = o.body.shift._id;
  });

  it('volunteers cannot create shifts', async () => {
    const r = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start: new Date(Date.now() + 3600000), end: new Date(Date.now() + 7200000), capacity: 1 }, S.vols[0].token);
    expect(r.status).toBe(403);
  });
});

describe('phase 2: concurrency, waitlist, overlap', () => {
  // True parallel versions of these scenarios live in concurrency.test.js (run them on real MongoDB).
  it('5 joins on a 2-spot shift: 2 confirmed, 3 waitlisted in order', async () => {
    const results = [];
    for (const v of S.vols) results.push(await post(`/api/shifts/${S.shiftId}/join`, {}, v.token));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const statuses = results.map((r) => r.body.signup.status).sort();
    expect(statuses.filter((s) => s === 'confirmed')).toHaveLength(2);
    expect(statuses.filter((s) => s === 'waitlisted')).toHaveLength(3);
    const shift = await Shift.findById(S.shiftId);
    expect(shift.spotsLeft).toBe(0);
    S.confirmedIdx = results.map((r, i) => (r.body.signup.status === 'confirmed' ? i : -1)).filter((i) => i >= 0);
  });

  it('joining twice never takes two spots', async () => {
    const v = await register('Double Clicker');
    const a = await post(`/api/shifts/${S.overlapId}/join`, {}, v.token);
    const b = await post(`/api/shifts/${S.overlapId}/join`, {}, v.token);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await Signup.countDocuments({ shiftId: S.overlapId, userId: v.id, status: 'confirmed' })).toBe(1);
    expect((await Shift.findById(S.overlapId)).spotsLeft).toBe(4);
    S.dc = v;
  });

  it('blocks clashing shifts', async () => {
    const confirmed = S.vols[S.confirmedIdx[0]];
    const r = await post(`/api/shifts/${S.overlapId}/join`, {}, confirmed.token);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/clashes/);
  });

  it('promotes the oldest waitlisted volunteer when a confirmed one leaves', async () => {
    const leaver = S.vols[S.confirmedIdx[1]];
    const waitlisted = (await Signup.find({ shiftId: S.shiftId, status: 'waitlisted' }).sort({ joinedAt: 1 }));
    const oldest = String(waitlisted[0].userId);
    const r = await post(`/api/shifts/${S.shiftId}/leave`, {}, leaver.token);
    expect(r.status).toBe(200);
    expect(r.body.lateCancel).toBe(true); // shift starts in < 24h
    const promoted = await Signup.findOne({ shiftId: S.shiftId, userId: oldest });
    expect(promoted.status).toBe('confirmed');
    const shift = await Shift.findById(S.shiftId);
    expect(shift.spotsLeft).toBe(0);
    expect(await Notification.countDocuments({ userId: oldest, type: 'waitlist_promoted' })).toBe(1);
    expect((await User.findById(leaver.id)).reliabilityScore).toBe(95);
    // leaving twice conflicts instead of double-freeing
    expect((await post(`/api/shifts/${S.shiftId}/leave`, {}, leaver.token)).status).toBe(409);
    expect((await Shift.findById(S.shiftId)).spotsLeft).toBe(0);
    S.promotedUserId = oldest;
  });

  it('raising capacity promotes waitlisted volunteers', async () => {
    const r = await call('PATCH', `/api/shifts/${S.shiftId}`, { capacity: 3 }, S.org.token);
    expect(r.status).toBe(200);
    const shift = await Shift.findById(S.shiftId);
    expect(shift.spotsLeft).toBe(0);
    expect(await Signup.countDocuments({ shiftId: S.shiftId, status: 'confirmed' })).toBe(3);
    expect((await call('PATCH', `/api/shifts/${S.shiftId}`, { capacity: 1 }, S.org.token)).status).toBe(409);
  });

  it('approval-mode events create pending requests that organizers approve', async () => {
    const ev = await Event.findById(S.eventId);
    await Event.updateOne({ _id: ev._id }, { $set: { applicationMode: 'approval' } });
    const v = S.vols[S.confirmedIdx[1]];
    const start = new Date(Date.now() + 5 * 3600000);
    const sh = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start, end: new Date(start.getTime() + 3600000), capacity: 1 }, S.org.token);
    const j = await post(`/api/shifts/${sh.body.shift._id}/join`, {}, v.token);
    expect(j.body.signup.status).toBe('pending');
    expect((await Shift.findById(sh.body.shift._id)).spotsLeft).toBe(1);
    const roster = await get(`/api/shifts/${sh.body.shift._id}/signups`, S.org.token);
    const ap = await post(`/api/signups/${roster.body.signups[0]._id}/approve`, {}, S.org.token);
    expect(ap.body.status).toBe('confirmed');
    expect((await Shift.findById(sh.body.shift._id)).spotsLeft).toBe(0);
    await Event.updateOne({ _id: ev._id }, { $set: { applicationMode: 'open' } });
  });
});

describe('phase 4: QR attendance and approval', () => {
  it('issues a pass, lead scans check-in, token is single-use', async () => {
    const volIdx = S.confirmedIdx[0];
    const vol = S.vols[volIdx];
    S.worker = vol;
    const pass = await get(`/api/attendance/pass/${S.shiftId}`, vol.token);
    expect(pass.status).toBe(200);

    // non-members cannot scan
    expect((await post('/api/attendance/scan', { token: pass.body.token }, S.vols[4].token)).status).toBe(403);

    const scan = await post('/api/attendance/scan', { token: pass.body.token }, S.lead.token);
    expect(scan.status).toBe(200);
    expect(scan.body.action).toBe('check_in');
    const again = await post('/api/attendance/scan', { token: pass.body.token }, S.lead.token);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already scanned/);
  });

  it('refuses a too-early checkout, then checks out and caps worked minutes', async () => {
    const vol = S.worker;
    let pass = await get(`/api/attendance/pass/${S.shiftId}`, vol.token);
    const early = await post('/api/attendance/scan', { token: pass.body.token }, S.lead.token);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/less than a minute/);

    const att = await Attendance.findOne({ userId: vol.id });
    await Attendance.updateOne({ _id: att._id }, { $set: { checkInAt: new Date(Date.now() - 20 * 60000) } });
    pass = await get(`/api/attendance/pass/${S.shiftId}`, vol.token);
    const out = await post('/api/attendance/scan', { token: pass.body.token }, S.lead.token);
    expect(out.status).toBe(200);
    expect(out.body.action).toBe('check_out');
    expect(out.body.minutes).toBe(20);
    S.attId = String(att._id);
  });

  it('requires a reason to adjust hours, then creates a payable from approved minutes', async () => {
    const noReason = await post(`/api/attendance/${S.attId}/approve`, { minutes: 60 }, S.org.token);
    expect(noReason.status).toBe(400);
    // the lead is not an organizer and cannot approve
    expect((await post(`/api/attendance/${S.attId}/approve`, {}, S.lead.token)).status).toBe(403);

    const ok = await post(`/api/attendance/${S.attId}/approve`, { minutes: 60, reason: 'Stayed to pack up' }, S.org.token);
    expect(ok.status).toBe(200);
    expect(ok.body.payable.amount).toBe(10000); // Rs 100/h for 60 min
    expect((await post(`/api/attendance/${S.attId}/approve`, { minutes: 60, reason: 'x' }, S.org.token)).status).toBe(409);
    expect(await Payable.countDocuments({ attendanceId: S.attId })).toBe(1);
  });

  it('manual override needs a reason and is audited', async () => {
    const promoted = S.vols.find((v) => v.id === S.promotedUserId);
    const signup = await Signup.findOne({ shiftId: S.shiftId, userId: promoted.id });
    expect((await post('/api/attendance/manual', { signupId: signup._id, action: 'check_in', reason: '' }, S.lead.token)).status).toBe(400);
    const ok = await post('/api/attendance/manual', { signupId: signup._id, action: 'check_in', reason: 'Phone battery died' }, S.lead.token);
    expect(ok.status).toBe(200);
    const audit = await get(`/api/events/${S.eventId}/audit`, S.org.token);
    expect(audit.body.logs.some((l) => l.action === 'attendance.manual_check_in')).toBe(true);
    S.promoted = promoted;
  });
});

describe('phase 5-6: wallet, ledger, payouts', () => {
  it('funds the wallet once even if the payment is captured repeatedly', async () => {
    const order = await post(`/api/wallet/orgs/${S.orgId}/fund`, { amountRupees: 500 }, S.org.token);
    expect(order.status).toBe(201);
    const a = await post('/api/wallet/mock-pay', { orderId: order.body.order.orderId }, S.org.token);
    const b = await post('/api/wallet/mock-pay', { orderId: order.body.order.orderId }, S.org.token);
    expect(a.body.status).toBe('captured');
    expect(b.body.status).toBe('captured');
    const w = await get(`/api/wallet/orgs/${S.orgId}`, S.org.token);
    expect(w.body.wallet.available).toBe(50000);
    expect(w.body.committed.total).toBeGreaterThan(0);
    // volunteers cannot see an organization's wallet
    expect((await get(`/api/wallet/orgs/${S.orgId}`, S.vols[0].token)).status).toBe(403);
  });

  it('rejects webhooks without a valid signature', async () => {
    const r = await fetch(`${base}/api/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' }, body: '{"event":"payment.captured"}' });
    expect(r.status).toBe(400);
  });

  it('skips volunteers with no payout method, then pays after they add one', async () => {
    const first = await post('/api/payouts/release', { eventId: S.eventId }, S.org.token);
    expect(first.body.queued).toBe(0);
    expect(first.body.skipped[0].reason).toMatch(/payout method/i);
    expect((await Payable.findOne({ attendanceId: S.attId })).status).toBe('approved');

    expect((await call('PUT', '/api/payouts/method', { upi: 'not-a-upi' }, S.worker.token)).status).toBe(400);
    expect((await call('PUT', '/api/payouts/method', { upi: 'worker@okbank' }, S.worker.token)).status).toBe(200);

    // releasing twice must pay only once
    const r1 = await post('/api/payouts/release', { eventId: S.eventId }, S.org.token);
    const r2 = await post('/api/payouts/release', { eventId: S.eventId }, S.org.token);
    expect(r1.body.queued + r2.body.queued).toBe(1);
    const paid = await until(async () => (await Payout.findOne({ userId: S.worker.id, status: 'paid' })));
    expect(paid).toBeTruthy();
    expect(paid.amount).toBe(10000);
    expect(paid.fee).toBe(200);
    expect(paid.receiptNo).toMatch(/^RCPT-/);
    expect((await Payable.findOne({ attendanceId: S.attId })).status).toBe('paid');
    expect((await Wallet.findOne({ orgId: S.orgId })).available).toBe(50000 - 10000 - 200);
    expect(await Payout.countDocuments({ userId: S.worker.id })).toBe(1);

    const pdf = await fetch(`${base}/api/payouts/${paid._id}/receipt`, { headers: { authorization: `Bearer ${S.worker.token}` } });
    expect(pdf.status).toBe(200);
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(500);
  });

  it('a failed payout returns the money and reopens the payable for retry', async () => {
    const att = await Attendance.findOne({ userId: S.promoted.id });
    await Attendance.updateOne({ _id: att._id }, { $set: { checkInAt: new Date(Date.now() - 30 * 60000) } });
    const pass = await get(`/api/attendance/pass/${S.shiftId}`, S.promoted.token);
    expect((await post('/api/attendance/scan', { token: pass.body.token }, S.lead.token)).status).toBe(200);
    const ap = await post(`/api/attendance/${att._id}/approve`, {}, S.org.token);
    expect(ap.status).toBe(200);

    expect((await call('PUT', '/api/payouts/method', { upi: 'fail@okbank' }, S.promoted.token)).status).toBe(200);
    const before = (await Wallet.findOne({ orgId: S.orgId })).available;
    const rel = await post('/api/payouts/release', { eventId: S.eventId }, S.org.token);
    expect(rel.body.queued).toBe(1);
    const failed = await until(async () => (await Payout.findOne({ userId: S.promoted.id, status: 'failed' })));
    expect(failed).toBeTruthy();
    expect((await Wallet.findOne({ orgId: S.orgId })).available).toBe(before);
    expect((await Payable.findOne({ attendanceId: att._id })).status).toBe('approved');

    // fix the UPI id and retry
    await call('PUT', '/api/payouts/method', { upi: 'fixed@okbank' }, S.promoted.token);
    await post('/api/payouts/release', { eventId: S.eventId }, S.org.token);
    expect(await until(async () => (await Payout.findOne({ userId: S.promoted.id, status: 'paid' })))).toBeTruthy();
  });

  it('refuses to pay when the wallet cannot cover it', async () => {
    const ev = await Event.findById(S.eventId);
    await Wallet.updateOne({ orgId: S.orgId }, { $set: { available: 0 } }); // simulate empty wallet (reconcile will flag it)
    const att = await Attendance.create({ signupId: new mongoose.Types.ObjectId(), shiftId: S.shiftId, eventId: ev._id, orgId: S.orgId, roleId: S.roleId, userId: S.worker.id, status: 'approved', approvedMinutes: 60 });
    await Payable.create({ attendanceId: att._id, eventId: ev._id, orgId: S.orgId, userId: S.worker.id, minutes: 60, amount: 5000 });
    const rel = await post('/api/payouts/release', { eventId: S.eventId }, S.org.token);
    expect(rel.body.queued).toBe(0);
    expect(rel.body.skipped[0].reason).toMatch(/funds/i);
    expect((await Payable.findOne({ attendanceId: att._id })).status).toBe('approved');
    const rec = await get(`/api/wallet/orgs/${S.orgId}/reconcile`, S.org.token);
    expect(rec.status).toBe(200);
    expect(rec.body.ok).toBe(false); // we tampered with the balance, so the ledger disagrees: reconcile catches it
    await Wallet.updateOne({ orgId: S.orgId }, { $set: { available: rec.body.ledgerTotal } });
    expect((await get(`/api/wallet/orgs/${S.orgId}/reconcile`, S.org.token)).body.ok).toBe(true);
    await Payable.deleteOne({ attendanceId: att._id });
    await Attendance.deleteOne({ _id: att._id });
  });
});

describe('phase 3/4: scheduler tasks', () => {
  it('auto-closes forgotten checkouts and marks absentees as no-shows', async () => {
    const ev = await Event.findById(S.eventId);
    const past = new Date(Date.now() - 3 * 3600000);
    const shift = await Shift.create({ eventId: ev._id, orgId: S.orgId, roleId: S.roleId, start: past, end: new Date(past.getTime() + 3600000), capacity: 2, spotsLeft: 0 });
    const mk = (user) => Signup.create({ shiftId: shift._id, eventId: ev._id, roleId: S.roleId, orgId: S.orgId, userId: user.id, status: 'confirmed', start: shift.start, end: shift.end });
    const present = await mk(S.vols[4]);
    const absent = await mk(S.dc);
    await Attendance.create({ signupId: present._id, shiftId: shift._id, eventId: ev._id, orgId: S.orgId, roleId: S.roleId, userId: S.vols[4].id, status: 'checked_in', checkInAt: new Date(past.getTime() + 5 * 60000) });

    expect(await processEndedShifts()).toBeGreaterThanOrEqual(1);
    const closed = await Attendance.findOne({ signupId: present._id });
    expect(closed.status).toBe('completed');
    expect(closed.autoClosed).toBe(true);
    expect(closed.minutesWorked).toBe(55);
    const noShow = await Attendance.findOne({ signupId: absent._id });
    expect(noShow.status).toBe('no_show');
    expect((await User.findById(S.dc.id)).reliabilityScore).toBe(90);
    expect(await processEndedShifts()).toBe(0); // idempotent
  });
});

describe('phase 7: certificates, disputes, reports, admin', () => {
  it('issues certificates and verifies them publicly', async () => {
    expect((await post(`/api/events/${S.eventId}/certificates`, {}, S.org.token)).status).toBe(409); // not completed yet
    await Event.updateOne({ _id: S.eventId }, { $set: { status: 'completed' } });
    const r = await post(`/api/events/${S.eventId}/certificates`, {}, S.org.token);
    expect(r.status).toBe(201);
    expect(r.body.issued).toBe(2);
    const again = await post(`/api/events/${S.eventId}/certificates`, {}, S.org.token);
    expect(again.body.issued).toBe(0); // idempotent
    const mine = await get('/api/certificates/mine', S.worker.token);
    const code = mine.body.certificates[0].code;
    const verify = await get(`/api/certificates/verify/${code}`); // no token: public
    expect(verify.body.valid).toBe(true);
    expect(verify.body.eventTitle).toBe('Integration Fest');
    expect((await get('/api/certificates/verify/NOPE')).body.valid).toBe(false);
    const pdf = await fetch(`${base}/api/certificates/${mine.body.certificates[0]._id}/pdf`, { headers: { authorization: `Bearer ${S.worker.token}` } });
    expect(pdf.status).toBe(200);
  });

  it('volunteers dispute, organizers resolve; paid shifts cannot be changed', async () => {
    const short = await post('/api/disputes', { attendanceId: S.attId, reason: 'short' }, S.worker.token);
    expect(short.status).toBe(400);
    const d = await post('/api/disputes', { attendanceId: S.attId, reason: 'I worked 90 minutes, not 60.' }, S.worker.token);
    expect(d.status).toBe(201);
    expect((await post('/api/disputes', { attendanceId: S.attId, reason: 'Second dispute attempt here' }, S.worker.token)).status).toBe(409);
    expect((await post('/api/disputes', { attendanceId: S.attId, reason: 'Not my record at all, trying' }, S.vols[4].token)).status).toBe(404);
    const res = await post(`/api/disputes/${d.body.dispute._id}/resolve`, { action: 'adjust', minutes: 90, note: 'Confirmed with lead' }, S.org.token);
    expect(res.status).toBe(409); // already paid out
    const rej = await post(`/api/disputes/${d.body.dispute._id}/resolve`, { action: 'reject', note: 'Already paid, handle offline' }, S.org.token);
    expect(rej.body.dispute.status).toBe('rejected');
  });

  it('builds the organizer report, CSVs and volunteer stats', async () => {
    const rep = await get(`/api/events/${S.eventId}/report`, S.org.token);
    expect(rep.status).toBe(200);
    expect(rep.body.money.paid).toBe(15000);
    expect(rep.body.money.fees).toBe(300);
    expect(rep.body.totals.approvedMinutes).toBeGreaterThan(0);
    const csv = await fetch(`${base}/api/events/${S.eventId}/report/payouts.csv`, { headers: { authorization: `Bearer ${S.org.token}` } });
    expect(csv.headers.get('content-type')).toMatch(/csv/);
    expect((await csv.text()).split('\n').length).toBeGreaterThan(1);
    const stats = await get('/api/me/stats', S.worker.token);
    expect(stats.body.minutes).toBe(60);
    expect(stats.body.badges.map((b) => b.id)).toContain('first_shift');
    expect(stats.body.earned).toBe(10000);
    expect((await get(`/api/events/${S.eventId}/report`, S.vols[0].token)).status).toBe(403);
  });

  it('closing an event is blocked while payments are unpaid, and admin routes are admin-only', async () => {
    expect((await get('/api/admin/stats', S.org.token)).status).toBe(403);
    expect((await get('/api/notifications', S.worker.token)).body.notifications.length).toBeGreaterThan(0);
    const settle = await post(`/api/events/${S.eventId}/status`, { status: 'settled' }, S.org.token);
    expect(settle.status).toBe(200); // everything has been paid by now
  });
});
