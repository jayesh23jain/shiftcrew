import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: 'Volunteer' },
    userEmail: { type: String, default: '' },
    userPhone: { type: String, default: '' },
    category: {
      type: String,
      enum: ['crowd', 'supplies', 'tech', 'checkin', 'safety', 'other'],
      default: 'other',
    },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      index: true,
    },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

incidentSchema.index({ eventId: 1, status: 1, createdAt: -1 });

export const Incident = mongoose.model('Incident', incidentSchema);
