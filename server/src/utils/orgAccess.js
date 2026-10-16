import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { ApiError } from './ApiError.js';

// Loads an org and verifies the user belongs to it (optionally with one of the given roles).
// Platform admins bypass membership checks.
export async function assertOrgMember(orgId, user, roles = ['owner', 'organizer']) {
  if (!mongoose.isValidObjectId(orgId)) throw ApiError.badRequest('Invalid organization id');
  const org = await Organization.findById(orgId);
  if (!org) throw ApiError.notFound('Organization not found');
  if (user.role === 'admin') return org;
  const member = org.members.find((m) => String(m.userId) === String(user.id));
  if (!member || !roles.includes(member.role)) {
    throw ApiError.forbidden('You are not part of this organization');
  }
  return org;
}
