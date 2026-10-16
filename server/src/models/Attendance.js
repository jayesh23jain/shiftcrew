import mongoose from 'mongoose';

const { Schema } = mongoose;

const attendanceSchema = new Schema(
  {
    signupId: { type: Schema.Types.ObjectId, ref: 'Signup', required: true, unique: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'EventRole', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['checked_in', 'completed', 'no_show', 'approved', 'rejected'], required: true },
    checkInAt: Date,
    checkOutAt: Date,
    checkInBy: { type: Schema.Types.ObjectId, ref: 'User' },
    checkOutBy: { type: Schema.Types.ObjectId, ref: 'User' },
    late: { type: Boolean, default: false },
    autoClosed: { type: Boolean, default: false },
    minutesWorked: { type: Number, default: 0 },
    adjustedMinutes: Number,
    adjustReason: String,
    approvedMinutes: Number,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectReason: String,
    manual: { type: Boolean, default: false },
    earlyCheckout: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Attendance = mongoose.model('Attendance', attendanceSchema);

// Single-use QR tokens. The TTL index cleans up entries automatically.
const qrUseSchema = new Schema({
  jti: { type: String, required: true, unique: true },
  expireAt: { type: Date, required: true, expires: 0 },
});
export const QrUse = mongoose.model('QrUse', qrUseSchema);
