import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Payable, PayoutMethod } from '../models/Money.js';
import { encrypt, maskUpi } from '../utils/crypto.js';

await mongoose.connect(env.MONGO_URI);

const email = 'aman.testvolunteer@shiftcrew.test';
const existing = await User.findOne({ email });
if (existing) {
  await Payable.deleteMany({ userId: existing._id });
  await PayoutMethod.deleteMany({ userId: existing._id });
  await User.deleteOne({ _id: existing._id });
}

const passwordHash = await bcrypt.hash('Password123', 10);
const user = await User.create({
  name: 'Aman Sharma (Test Volunteer)',
  email,
  passwordHash,
  role: 'volunteer',
  phone: '9876543210',
  city: 'Bengaluru',
  skills: ['Event Operations', 'Registration Desk'],
  emailVerified: true,
});

const upiId = 'amansharma@okaxis';
await PayoutMethod.create({
  userId: user._id,
  type: 'upi',
  holderName: 'Aman Sharma',
  upiEnc: encrypt(upiId),
  upiMasked: maskUpi(upiId),
  verified: true,
});

const events = await Event.find();
const createdPayables = [];

for (const event of events) {
  const dummyAttId = new mongoose.Types.ObjectId();
  const dummyShiftId = new mongoose.Types.ObjectId();
  const dummySignupId = new mongoose.Types.ObjectId();

  const payable = await Payable.create({
    attendanceId: dummyAttId,
    shiftId: dummyShiftId,
    signupId: dummySignupId,
    eventId: event._id,
    orgId: event.orgId,
    userId: user._id,
    minutes: 240, // 4 hours
    amount: 50000, // ₹500 in paise
    status: 'approved',
  });
  createdPayables.push({ eventTitle: event.title, amount: '₹500', eventId: event._id });
}

console.log('SUCCESS_CREATED');
console.log(JSON.stringify({
  volunteer: {
    id: user._id,
    name: user.name,
    email: user.email,
    upi: upiId,
  },
  createdPayables,
}, null, 2));

await mongoose.disconnect();
