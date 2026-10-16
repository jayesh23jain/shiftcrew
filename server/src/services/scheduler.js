import { Shift } from '../models/Shift.js';
import { Signup } from '../models/Signup.js';
import { Event } from '../models/Event.js';
import { notify } from './notify.js';
import { processEndedShifts } from './attendance.service.js';
import { processQueuedPayouts } from './payouts.service.js';

/*
 * In-process scheduler. Every task "claims" its work with an atomic update first, so running several
 * server instances is safe. For heavier load, move these tasks to BullMQ workers (the task functions
 * are already isolated and can be reused as-is).
 */
const HOUR = 60 * 60 * 1000;
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

async function sendReminders(kind, windowMs, field, label) {
  const now = new Date();
  for (;;) {
    const shift = await Shift.findOneAndUpdate(
      { status: 'open', start: { $gt: now, $lte: new Date(+now + windowMs) }, [`reminders.${field}`]: null },
      { $set: { [`reminders.${field}`]: now } }, { new: true }
    ).populate('roleId', 'name');
    if (!shift) return;
    const people = await Signup.find({ shiftId: shift._id, status: 'confirmed' }).select('userId');
    await notify(people.map((p) => p.userId), {
      type: `reminder_${kind}`, title: `Shift ${label}`,
      body: `${shift.roleId?.name || 'Your shift'} starts ${when(shift.start)}. Open your QR pass from My shifts when you arrive.`, link: '/my-shifts',
    });
  }
}

async function advanceEvents() {
  const now = new Date();
  await Event.updateMany({ status: 'published', startDate: { $lte: now }, endDate: { $gte: now } }, { $set: { status: 'ongoing' } });
  await Event.updateMany({ status: { $in: ['published', 'ongoing'] }, endDate: { $lt: now } }, { $set: { status: 'completed' } });
}

export async function runSchedulerOnce() {
  const tasks = [
    ['reminders-24h', () => sendReminders('24h', 24 * HOUR, 'h24At', 'tomorrow')],
    ['reminders-2h', () => sendReminders('2h', 2 * HOUR, 'h2At', 'in 2 hours')],
    ['events', advanceEvents],
    ['attendance', processEndedShifts],
    ['payouts', processQueuedPayouts],
  ];
  for (const [name, fn] of tasks) {
    try { await fn(); } catch (err) { console.error(`scheduler task failed: ${name}`, err); }
  }
}

export function startScheduler(intervalMs = 60_000) {
  runSchedulerOnce();
  const timer = setInterval(runSchedulerOnce, intervalMs);
  timer.unref?.();
  return timer;
}
