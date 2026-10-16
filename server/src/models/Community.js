import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (ref) => ({ type: Schema.Types.ObjectId, ref });

const certificateSchema = new Schema(
  {
    userId: { ...oid('User'), required: true, index: true },
    eventId: { ...oid('Event'), required: true },
    orgId: oid('Organization'),
    volunteerName: String,
    eventTitle: String,
    orgName: String,
    minutes: { type: Number, required: true },
    code: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);
certificateSchema.index({ userId: 1, eventId: 1 }, { unique: true });
export const Certificate = mongoose.model('Certificate', certificateSchema);

const disputeSchema = new Schema(
  {
    attendanceId: { ...oid('Attendance'), required: true, index: true },
    eventId: { ...oid('Event'), required: true, index: true },
    orgId: oid('Organization'),
    raisedBy: { ...oid('User'), required: true, index: true },
    reason: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open' },
    resolution: String,
    resolvedBy: oid('User'),
    timeline: [{ _id: false, at: { type: Date, default: Date.now }, by: oid('User'), text: String }],
  },
  { timestamps: true }
);
export const Dispute = mongoose.model('Dispute', disputeSchema);

const announcementSchema = new Schema(
  {
    eventId: { ...oid('Event'), required: true, index: true },
    authorId: oid('User'),
    title: { type: String, maxlength: 120 },
    message: { type: String, required: true, maxlength: 2000 },
    audience: { type: String, enum: ['all', 'role', 'shift'], default: 'all' },
    roleId: oid('EventRole'),
    shiftId: oid('Shift'),
    recipients: Number,
  },
  { timestamps: true }
);
export const Announcement = mongoose.model('Announcement', announcementSchema);
