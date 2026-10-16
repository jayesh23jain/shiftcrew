import mongoose from 'mongoose';
import crypto from 'crypto';
import { EVENT_STATUSES } from '../utils/eventStatus.js';

const { Schema } = mongoose;

const eventSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 5000, default: '' },
    category: {
      type: String,
      enum: ['college_fest', 'hackathon', 'ngo_drive', 'sports', 'conference', 'community', 'other'],
      default: 'other',
    },
    bannerUrl: String,
    venue: {
      name: { type: String, trim: true },
      address: { type: String, trim: true },
      city: { type: String, trim: true, index: true },
      geo: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number] }, // [lng, lat]
      },
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    visibility: { type: String, enum: ['public', 'invite_only'], default: 'public' },
    inviteCode: { type: String },
    applicationMode: { type: String, enum: ['open', 'approval'], default: 'open' },
    status: { type: String, enum: EVENT_STATUSES, default: 'draft' },
    // Stored in paise (integers). Calculated from shifts in a later phase.
    budgetEstimate: { type: Number, default: 0, min: 0 },
    publishedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true }
);

eventSchema.index({ status: 1, visibility: 1, startDate: 1 });

eventSchema.pre('save', function (next) {
  if (this.visibility === 'invite_only' && !this.inviteCode) {
    this.inviteCode = crypto.randomBytes(5).toString('hex');
  }
  next();
});

export const Event = mongoose.model('Event', eventSchema);
