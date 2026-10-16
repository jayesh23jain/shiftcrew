import { User } from '../models/User.js';

// Lowers a volunteer's reliability score but never below zero. Two plain updates keep it portable.
export async function penalize(userId, points) {
  const res = await User.updateOne({ _id: userId, reliabilityScore: { $gte: points } }, { $inc: { reliabilityScore: -points } });
  if (!res.modifiedCount) await User.updateOne({ _id: userId, reliabilityScore: { $lt: points } }, { $set: { reliabilityScore: 0 } });
}
