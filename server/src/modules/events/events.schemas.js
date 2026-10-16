import { z } from 'zod';
import { EVENT_STATUSES } from '../../utils/eventStatus.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const venue = z.object({
  name: z.string().trim().max(120).optional(),
  address: z.string().trim().max(250).optional(),
  city: z.string().trim().min(1, 'Enter the city').max(60),
});

const eventFields = {
  title: z.string().trim().min(3, 'Give the event a title').max(120),
  description: z.string().trim().max(5000).default(''),
  category: z
    .enum(['college_fest', 'hackathon', 'ngo_drive', 'sports', 'conference', 'community', 'other'])
    .default('other'),
  bannerUrl: z.string().url('Enter a valid image link').optional().or(z.literal('')),
  venue,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  visibility: z.enum(['public', 'invite_only']).default('public'),
  applicationMode: z.enum(['open', 'approval']).default('open'),
};

const endAfterStart = (d) => !d.startDate || !d.endDate || d.endDate >= d.startDate;
const endMsg = { message: 'End date must be on or after the start date', path: ['endDate'] };

export const createEventSchema = z
  .object({ orgId: objectId, ...eventFields })
  .refine(endAfterStart, endMsg);

export const updateEventSchema = z
  .object(eventFields)
  .partial()
  .extend({ venue: venue.partial().optional() })
  .refine(endAfterStart, endMsg);

export const statusSchema = z.object({
  status: z.enum(EVENT_STATUSES),
  reason: z.string().trim().max(300).optional(),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(60).optional(),
  category: z.string().trim().max(30).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  includePast: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const mineQuerySchema = z.object({
  orgId: objectId.optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(60).optional(),
  category: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Name the role').max(60),
  description: z.string().trim().max(500).default(''),
  skillsRequired: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  leadId: objectId.nullish(),
  leadEmail: z.string().trim().toLowerCase().email('Enter a valid email').or(z.literal('')).nullish(),
});

export const idParam = z.object({ id: objectId });
export const roleParams = z.object({ id: objectId, roleId: objectId });
