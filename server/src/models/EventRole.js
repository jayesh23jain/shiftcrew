import mongoose from 'mongoose';

const { Schema } = mongoose;

const eventRoleSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, maxlength: 500, default: '' },
    leadId: { type: Schema.Types.ObjectId, ref: 'User' },
    skillsRequired: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

eventRoleSchema.index({ eventId: 1, name: 1 }, { unique: true });

export const EventRole = mongoose.model('EventRole', eventRoleSchema);
