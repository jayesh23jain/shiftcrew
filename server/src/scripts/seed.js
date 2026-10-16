import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Organization } from '../models/Organization.js';
import { Event } from '../models/Event.js';
import { EventRole } from '../models/EventRole.js';
import { Shift } from '../models/Shift.js';
import { Wallet, LedgerEntry } from '../models/Money.js';

await mongoose.connect(env.MONGO_URI);
await mongoose.connection.dropDatabase();

const passwordHash = await bcrypt.hash('Password123', 10);
const [admin, organizer, volunteer, sara, lead] = await User.create([
  { name: 'Platform Admin', email: 'admin@shiftcrew.test', passwordHash, role: 'admin', emailVerified: true },
  { name: 'Anika Rao', email: 'organizer@shiftcrew.test', passwordHash, role: 'organizer', city: 'Bengaluru', emailVerified: true },
  { name: 'Rahul Menon', email: 'volunteer@shiftcrew.test', passwordHash, role: 'volunteer', city: 'Bengaluru', phone: '9876500001', skills: ['Photography', 'Crowd handling'] },
  { name: 'Sara Khan', email: 'sara@shiftcrew.test', passwordHash, role: 'volunteer', city: 'Bengaluru', phone: '9876500002', skills: ['First aid'] },
  { name: 'Leo Fernandes', email: 'lead@shiftcrew.test', passwordHash, role: 'volunteer', city: 'Bengaluru', phone: '9876500003', skills: ['Stage management'] },
]);

const org = await Organization.create({
  name: 'Tech Fest Committee', type: 'fest_committee', city: 'Bengaluru', verified: true,
  description: 'Student committee running the annual college tech fest.',
  ownerId: organizer._id, members: [{ userId: organizer._id, role: 'owner' }],
});

// A funded wallet so the payout flow can be demonstrated straight away.
await LedgerEntry.create({ orgId: org._id, type: 'fund', delta: 2500000, idempotencyKey: 'seed-fund', note: 'Seed top-up (sandbox)' });
await Wallet.create({ orgId: org._id, available: 2500000, totalFunded: 2500000 });

const DAY = 86400000;
const dayStart = (offset) => { const d = new Date(Date.now() + offset * DAY); d.setHours(0, 0, 0, 0); return d; };
const dayEnd = (offset) => { const d = dayStart(offset); d.setHours(23, 59, 59, 0); return d; };
const at = (offset, hour) => { const d = dayStart(offset); d.setHours(hour, 0, 0, 0); return d; };

const mk = (title, category, offset, span, status, description) => ({
  orgId: org._id, createdBy: organizer._id, title, category, description, status,
  venue: { name: 'Main Campus', address: 'Outer Ring Road', city: 'Bengaluru' },
  startDate: dayStart(offset), endDate: dayEnd(offset + span),
  publishedAt: status === 'published' ? new Date() : undefined,
});

const [fest, drive, draft] = await Event.create([
  mk('Aarambh Tech Fest 2026', 'college_fest', 14, 2, 'published', 'Two days of talks, hackathons and workshops. We need registration, stage and logistics crew.'),
  mk('Community Blood Drive', 'ngo_drive', 7, 0, 'published', 'One day blood donation drive with a partner hospital. Help with donor flow and refreshments.'),
  mk('Hack the Campus (draft)', 'hackathon', 40, 1, 'draft', 'Overnight hackathon, still being planned.'),
]);

const roles = await EventRole.create([
  { eventId: fest._id, name: 'Registration Desk', description: 'Check attendees in and hand out badges.', skillsRequired: ['Communication'] },
  { eventId: fest._id, name: 'Stage Crew', description: 'Help speakers and manage stage transitions.', leadId: lead._id },
  { eventId: fest._id, name: 'Logistics', description: 'Set up halls, move equipment, manage supplies.' },
  { eventId: drive._id, name: 'Donor Flow', description: 'Guide donors between counters.', skillsRequired: ['First aid'], leadId: lead._id },
  { eventId: drive._id, name: 'Refreshments', description: 'Serve snacks and water after donation.' },
]);
const [reg, stage, logi, flow, snacks] = roles;

const shift = (event, role, offset, from, to, capacity, payType = 'unpaid', rupees = 0, notes = '') =>
  ({ eventId: event._id, roleId: role._id, orgId: org._id, start: at(offset, from), end: at(offset, to), capacity, spotsLeft: capacity, payType, rate: rupees * 100, notes });

await Shift.create([
  shift(fest, reg, 14, 9, 13, 4, 'unpaid', 0, 'Report to the main gate desk. Wear the volunteer t-shirt.'),
  shift(fest, stage, 14, 9, 13, 5, 'hourly', 150),
  shift(fest, stage, 14, 13, 17, 5, 'hourly', 150),
  shift(fest, logi, 14, 8, 12, 6, 'flat', 500, 'Heavy lifting involved.'),
  shift(fest, logi, 15, 8, 12, 6, 'flat', 500),
  shift(drive, flow, 7, 10, 14, 6, 'unpaid'),
  shift(drive, snacks, 7, 10, 14, 3, 'flat', 300),
]);

console.log('Seeded. Log in with password Password123:');
console.log(' organizer@shiftcrew.test  (owns the org and events, wallet pre-funded with Rs 25,000 sandbox money)');
console.log(' volunteer@shiftcrew.test, sara@shiftcrew.test  (volunteers)');
console.log(' lead@shiftcrew.test       (team lead for Stage Crew and Donor Flow, sees the Check-in desk)');
console.log(' admin@shiftcrew.test      (platform admin)');
void admin; void volunteer; void sara; void draft;
await mongoose.disconnect();
