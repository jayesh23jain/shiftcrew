import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Payable, Payout, PayoutMethod } from '../models/Money.js';

await mongoose.connect(env.MONGO_URI);

const email = 'aman.testvolunteer@shiftcrew.test';
const user = await User.findOne({ email });

if (user) {
  const payablesResult = await Payable.deleteMany({ userId: user._id });
  const payoutsResult = await Payout.deleteMany({ userId: user._id });
  const methodResult = await PayoutMethod.deleteMany({ userId: user._id });
  const userResult = await User.deleteOne({ _id: user._id });

  console.log('SUCCESS_DELETED');
  console.log(JSON.stringify({
    deletedUser: email,
    payablesDeleted: payablesResult.deletedCount,
    payoutsDeleted: payoutsResult.deletedCount,
    payoutMethodsDeleted: methodResult.deletedCount,
    userDeleted: userResult.deletedCount,
  }, null, 2));
} else {
  console.log(`Test volunteer ${email} was not found.`);
}

await mongoose.disconnect();
