import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';

// Never lets an audit failure break the request, but logs it loudly.
export async function audit(actor, action, { entityType, entityId, orgId, eventId, meta } = {}) {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const actorId = actor && typeof actor === 'object' ? actor.id || actor._id : actor;
    await AuditLog.create({ actorId, action, entityType, entityId, orgId, eventId, meta });
  } catch (err) {
    console.error('audit log failed', action, err.message);
  }
}
