import { describe, it, expect } from 'vitest';
import { registerSchema } from '../src/modules/auth/auth.schemas.js';
import { createEventSchema, updateEventSchema } from '../src/modules/events/events.schemas.js';
import { canTransition, isEditable } from '../src/utils/eventStatus.js';
import { escapeRegex } from '../src/utils/escapeRegex.js';

const oid = '64b7f0c2a1b2c3d4e5f60718';

describe('registerSchema', () => {
  it('accepts a valid volunteer and defaults the role', () => {
    const r = registerSchema.parse({ name: 'Asha', email: 'ASHA@Mail.com', password: 'abcd1234' });
    expect(r.role).toBe('volunteer');
    expect(r.email).toBe('asha@mail.com');
  });
  it('rejects weak passwords', () => {
    expect(registerSchema.safeParse({ name: 'Asha', email: 'a@b.co', password: 'short1' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'Asha', email: 'a@b.co', password: 'onlyletters' }).success).toBe(false);
  });
  it('never allows admin signup', () => {
    expect(registerSchema.safeParse({ name: 'Eve', email: 'e@b.co', password: 'abcd1234', role: 'admin' }).success).toBe(false);
  });
});

describe('event schemas', () => {
  const base = {
    orgId: oid,
    title: 'Fest',
    venue: { city: 'Pune' },
    startDate: '2030-01-02',
    endDate: '2030-01-03',
  };
  it('accepts a valid event', () => {
    expect(createEventSchema.safeParse(base).success).toBe(true);
  });
  it('rejects an end date before the start date', () => {
    const r = createEventSchema.safeParse({ ...base, endDate: '2030-01-01' });
    expect(r.success).toBe(false);
  });
  it('allows partial updates', () => {
    expect(updateEventSchema.safeParse({ title: 'New title' }).success).toBe(true);
  });
});

describe('event lifecycle', () => {
  it('follows the allowed transitions', () => {
    expect(canTransition('draft', 'published')).toBe(true);
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(canTransition('cancelled', 'published')).toBe(false);
    expect(canTransition('completed', 'settled')).toBe(true);
  });
  it('locks editing after the event starts', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('ongoing')).toBe(false);
  });
});

describe('escapeRegex', () => {
  it('neutralises regex characters in search input', () => {
    expect(new RegExp(escapeRegex('a.b*(c)')).test('a.b*(c)')).toBe(true);
    expect(new RegExp(escapeRegex('a.b')).test('axb')).toBe(false);
  });
});
