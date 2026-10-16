import mongoose from 'mongoose';

const { Schema } = mongoose;

const shiftSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'EventRole', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    capacity: { type: Number, required: true, min: 1, max: 500 },
    // Open spots. All capacity changes are atomic $inc on this field, which is what prevents overbooking.
    spotsLeft: { type: Number, required: true, min: 0 },
    payType: { type: String, enum: ['unpaid', 'hourly', 'flat'], default: 'unpaid' },
    rate: { type: Number, default: 0, min: 0 }, // paise
    notes: { type: String, maxlength: 500, default: '' },
    status: { type: String, enum: ['open', 'cancelled'], default: 'open' },
    reminders: { h24At: Date, h2At: Date },
    attendanceProcessedAt: Date,
  },
  { timestamps: true }
);

shiftSchema.index({ eventId: 1, start: 1 });
shiftSchema.index({ status: 1, start: 1 });

export const Shift = mongoose.model('Shift', shiftSchema);
