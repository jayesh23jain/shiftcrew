/*
 * Parallel-request tests. They prove the "no overbooking / no double payment" guarantees, which depend on
 * MongoDB's single-document atomicity (findOneAndUpdate with a filter and $inc). Run against real MongoDB:
 *
 *   docker compose up -d && npm run test:concurrency
 *
 * They are skipped unless REAL_MONGO=1, because MongoDB-compatible emulators do not all make concurrent
 * conditional updates atomic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { Shift } from '../../src/models/Shift.js';
import { Signup } from '../../src/models/Signup.js';
import { Payable, Payout, Wallet } from '../../src/models/Money.js';
import { Attendance } from '../../src/models/Attendance.js';

const run = process.env.REAL_MONGO === '1' ? describe : describe.skip;
let server, base;
const S = {};

async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}
const post = (p, b, t) => call('POST', p, b, t);
const reg = async (name, role = 'volunteer') => {
  const r = await post('/api/auth/register', { name, email: `${name.replace(/\W/g, '').toLowerCase()}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.dev`, password: 'Password123', role });
  return { token: r.body.accessToken, id: r.body.user._id };
};
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

run('concurrency on real MongoDB', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;

    S.org = await reg('Conc Organizer', 'organizer');
    const org = await post('/api/orgs', { name: 'Conc Org' }, S.org.token);
    S.orgId = org.body.org._id;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const ev = await post('/api/events', { orgId: S.orgId, title: 'Concurrency Fest', description: 'Long enough description here.', venue: { city: 'Pune' }, startDate: t0.toISOString(), endDate: new Date(t0.getTime() + 3 * 86400000).toISOString() }, S.org.token);
    S.eventId = ev.body.event._id;
    S.roleId = (await post(`/api/events/${S.eventId}/roles`, { name: 'Crew' }, S.org.token)).body.role._id;
    await post(`/api/events/${S.eventId}/status`, { status: 'published' }, S.org.token);
  });
  afterAll(async () => { server?.close(); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  const newShift = async (capacity, extra = {}) => {
    const start = new Date(Date.now() + 3600000 + Math.floor(Math.random() * 1e6));
    const r = await post(`/api/events/${S.eventId}/shifts`, { roleId: S.roleId, start, end: new Date(+start + 3600000), capacity, ...extra }, S.org.token);
    expect(r.status).toBe(201);
    return r.body.shift._id;
  };

  it('20 simultaneous joins on a 5-spot shift: exactly 5 confirmed', async () => {
    const shiftId = await newShift(5);
    const vols = await Promise.all(Array.from({ length: 20 }, (_, i) => reg(`Racer ${i}`)));
    const results = await Promise.all(vols.map((v) => post(`/api/shifts/${shiftId}/join`, {}, v.token)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await Signup.countDocuments({ shiftId, status: 'confirmed' })).toBe(5);
    expect(await Signup.countDocuments({ shiftId, status: 'waitlisted' })).toBe(15);
    expect((await Shift.findById(shiftId)).spotsLeft).toBe(0);
    S.racers = { shiftId, vols };
  });

  it('simultaneous cancellations promote exactly as many people as spots freed', async () => {
    const { shiftId, vols } = S.racers;
    const confirmed = await Signup.find({ shiftId, status: 'confirmed' });
    const leavers = vols.filter((v) => confirmed.slice(0, 3).some((c) => String(c.userId) === v.id));
    await Promise.all(leavers.map((v) => post(`/api/shifts/${shiftId}/leave`, {}, v.token)));
    expect(await Signup.countDocuments({ shiftId, status: 'confirmed' })).toBe(5);
    expect(await Signup.countDocuments({ shiftId, status: 'waitlisted' })).toBe(12);
    expect((await Shift.findById(shiftId)).spotsLeft).toBe(0);
  });

  it('one user clicking join five times at once gets one spot', async () => {
    const shiftId = await newShift(3);
    const v = await reg('Clicker');
    const results = await Promise.all(Array.from({ length: 5 }, () => post(`/api/shifts/${shiftId}/join`, {}, v.token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await Shift.findById(shiftId)).spotsLeft).toBe(2);
  });

  it('five parallel captures of one payment credit the wallet once', async () => {
    const order = await post(`/api/wallet/orgs/${S.orgId}/fund`, { amountRupees: 500 }, S.org.token);
    await Promise.all(Array.from({ length: 5 }, () => post('/api/wallet/mock-pay', { orderId: order.body.order.orderId }, S.org.token)));
    expect((await Wallet.findOne({ orgId: S.orgId })).available).toBe(50000);
  });

  it('two simultaneous "release payments" clicks pay a volunteer once', async () => {
    const worker = await reg('Paid Worker');
    await post('/api/payouts/method'.replace('/method', '/method'), {}, worker.token).catch(() => {});
    await call('PUT', '/api/payouts/method', { upi: 'worker@okbank' }, worker.token);
    const shiftId = await newShift(1, { payType: 'flat', rateRupees: 100 });
    const signup = await Signup.create({ shiftId, eventId: S.eventId, roleId: S.roleId, orgId: S.orgId, userId: worker.id, status: 'confirmed', start: new Date(), end: new Date() });
    const att = await Attendance.create({ signupId: signup._id, shiftId, eventId: S.eventId, orgId: S.orgId, roleId: S.roleId, userId: worker.id, status: 'completed', minutesWorked: 60 });
    expect((await post(`/api/attendance/${att._id}/approve`, {}, S.org.token)).status).toBe(200);

    const [a, b] = await Promise.all([post('/api/payouts/release', { eventId: S.eventId }, S.org.token), post('/api/payouts/release', { eventId: S.eventId }, S.org.token)]);
    expect(a.body.queued + b.body.queued).toBe(1);
    expect(await until(() => Payout.findOne({ userId: worker.id, status: 'paid' }))).toBeTruthy();
    expect(await Payout.countDocuments({ userId: worker.id, amount: { $gt: 0 } })).toBe(1);
    expect((await Payable.findOne({ userId: worker.id })).status).toBe('paid');
    expect((await Wallet.findOne({ orgId: S.orgId })).available).toBe(50000 - 10000 - 200);
  });
});
