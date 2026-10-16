import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entityType: String,
    entityId: Schema.Types.ObjectId,
    orgId: Schema.Types.ObjectId,
    eventId: Schema.Types.ObjectId,
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ eventId: 1, createdAt: -1 });
auditSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
