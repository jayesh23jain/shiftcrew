import mongoose from 'mongoose';
import { SWAP_STATUSES } from '../utils/swapLogic.js';

const { Schema } = mongoose;

const swapRequestSchema = new Schema(
  {
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    fromSignupId: { type: Schema.Types.ObjectId, ref: 'Signup', required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User' }, // optional for direct swaps
    status: {
      type: String,
      enum: SWAP_STATUSES,
      default: 'open',
      required: true,
      index: true,
    },
    note: { type: String, maxlength: 500, default: '' },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    claimedAt: Date,
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    rejectionReason: String,
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// Unique open/claimed request per signup to prevent double-swaps
swapRequestSchema.index(
  { fromSignupId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['open', 'claimed'] } },
  }
);
swapRequestSchema.index({ eventId: 1, status: 1, expiresAt: 1 });
swapRequestSchema.index({ status: 1, expiresAt: 1 });

export const SwapRequest = mongoose.model('SwapRequest', swapRequestSchema);
