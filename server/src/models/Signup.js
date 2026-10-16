import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ACTIVE_SIGNUP = ['confirming', 'confirmed', 'pending', 'waitlisted'];

const signupSchema = new Schema(
  {
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'EventRole', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // confirming is a short-lived claim state while a spot is being taken
    status: {
      type: String,
      enum: ['confirming', 'confirmed', 'pending', 'waitlisted', 'cancelled', 'rejected'],
      required: true,
    },
    // Copied from the shift so clash checks are a single indexed query
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    estPay: { type: Number, default: 0 }, // paise
    settled: { type: Boolean, default: false }, // payable created, or no-show / rejected
    joinedAt: { type: Date, default: Date.now },
    promotedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    lateCancel: Boolean,
  },
  { timestamps: true }
);

signupSchema.index({ shiftId: 1, userId: 1 }, { unique: true });
signupSchema.index({ userId: 1, status: 1, start: 1 });
signupSchema.index({ shiftId: 1, status: 1, joinedAt: 1 });

export const Signup = mongoose.model('Signup', signupSchema);
