import { describe, it, expect } from 'vitest';
import {
  canOfferSwap,
  checkSwapEligibility,
  canTransitionSwap,
  MIN_LEAD_MS,
} from '../../src/utils/swapLogic.js';

describe('Shift Swap Pure Logic Unit Tests', () => {
  describe('canOfferSwap', () => {
    const baseNow = new Date('2026-10-25T10:00:00.000Z');

    it('allows offering confirmed signup at least 2 hours before start', () => {
      const shift = { status: 'open', start: new Date('2026-10-25T13:00:00.000Z') };
      const signup = { status: 'confirmed' };
      const res = canOfferSwap(shift, signup, baseNow, MIN_LEAD_MS);
      expect(res.canOffer).toBe(true);
    });

    it('rejects offering if shift starts in less than 2 hours', () => {
      const shift = { status: 'open', start: new Date('2026-10-25T11:30:00.000Z') }; // 1.5h away
      const signup = { status: 'confirmed' };
      const res = canOfferSwap(shift, signup, baseNow, MIN_LEAD_MS);
      expect(res.canOffer).toBe(false);
      expect(res.reason).toContain('at least 2 hours');
    });

    it('rejects offering non-confirmed signups (e.g. pending or waitlisted)', () => {
      const shift = { status: 'open', start: new Date('2026-10-25T14:00:00.000Z') };
      expect(canOfferSwap(shift, { status: 'pending' }, baseNow).canOffer).toBe(false);
      expect(canOfferSwap(shift, { status: 'waitlisted' }, baseNow).canOffer).toBe(false);
      expect(canOfferSwap(shift, { status: 'cancelled' }, baseNow).canOffer).toBe(false);
    });

    it('rejects offering a cancelled shift or one that already started', () => {
      const signup = { status: 'confirmed' };
      expect(canOfferSwap({ status: 'cancelled', start: new Date('2026-10-25T14:00:00.000Z') }, signup, baseNow).canOffer).toBe(false);
      expect(canOfferSwap({ status: 'open', start: new Date('2026-10-25T09:00:00.000Z') }, signup, baseNow).canOffer).toBe(false);
    });
  });

  describe('checkSwapEligibility', () => {
    const shift = {
      _id: 'shift-1',
      start: new Date('2026-10-25T14:00:00.000Z'),
      end: new Date('2026-10-25T18:00:00.000Z'),
    };

    it('blocks offering volunteer from claiming their own swap', () => {
      const res = checkSwapEligibility(shift, [], 'user-1', 'user-1');
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('own swap offer');
    });

    it('blocks candidate if swap was targeted directly to someone else', () => {
      const res = checkSwapEligibility(shift, [], 'user-2', 'user-1', 'user-3');
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('directly to another volunteer');
    });

    it('allows targeted candidate for direct swap', () => {
      const res = checkSwapEligibility(shift, [], 'user-3', 'user-1', 'user-3');
      expect(res.eligible).toBe(true);
    });

    it('blocks candidate already registered for the same shift', () => {
      const candidateSignups = [
        { shiftId: 'shift-1', status: 'confirmed', start: shift.start, end: shift.end },
      ];
      const res = checkSwapEligibility(shift, candidateSignups, 'user-2', 'user-1');
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('already registered');
    });

    it('blocks candidate with a clashing schedule on another shift', () => {
      const candidateSignups = [
        {
          shiftId: 'shift-2',
          status: 'confirmed',
          start: new Date('2026-10-25T16:00:00.000Z'), // overlaps 16:00 - 20:00
          end: new Date('2026-10-25T20:00:00.000Z'),
        },
      ];
      const res = checkSwapEligibility(shift, candidateSignups, 'user-2', 'user-1');
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('clashes with another shift');
    });

    it('allows candidate when other shifts do not overlap in time', () => {
      const candidateSignups = [
        {
          shiftId: 'shift-2',
          status: 'confirmed',
          start: new Date('2026-10-25T09:00:00.000Z'), // 09:00 - 13:00 (before 14:00)
          end: new Date('2026-10-25T13:00:00.000Z'),
        },
      ];
      const res = checkSwapEligibility(shift, candidateSignups, 'user-2', 'user-1');
      expect(res.eligible).toBe(true);
    });
  });

  describe('canTransitionSwap State Machine', () => {
    it('allows open -> claimed by eligible taker', () => {
      const res = canTransitionSwap('open', 'claimed', { isTaker: true });
      expect(res.allowed).toBe(true);
    });

    it('allows open -> cancelled by original offerer or organizer', () => {
      expect(canTransitionSwap('open', 'cancelled', { isOfferer: true }).allowed).toBe(true);
      expect(canTransitionSwap('open', 'cancelled', { isOrganizer: true }).allowed).toBe(true);
      expect(canTransitionSwap('open', 'cancelled', { isOfferer: false, isOrganizer: false }).allowed).toBe(false);
    });

    it('allows open -> expired by scheduler only', () => {
      expect(canTransitionSwap('open', 'expired', { isScheduler: true }).allowed).toBe(true);
      expect(canTransitionSwap('open', 'expired', { isScheduler: false }).allowed).toBe(false);
    });

    it('allows claimed -> approved by organizer only', () => {
      expect(canTransitionSwap('claimed', 'approved', { isOrganizer: true }).allowed).toBe(true);
      expect(canTransitionSwap('claimed', 'approved', { isOrganizer: false }).allowed).toBe(false);
    });

    it('allows claimed -> cancelled by original user while claimed', () => {
      expect(canTransitionSwap('claimed', 'cancelled', { isOfferer: true }).allowed).toBe(true);
      expect(canTransitionSwap('claimed', 'cancelled', { isOfferer: false, isOrganizer: false }).allowed).toBe(false);
    });

    it('allows claimed -> open if organizer rejects the claim and reopens', () => {
      expect(canTransitionSwap('claimed', 'open', { isOrganizer: true }).allowed).toBe(true);
    });

    it('prevents any modification once final state (approved/cancelled/expired)', () => {
      expect(canTransitionSwap('approved', 'open', { isOrganizer: true }).allowed).toBe(false);
      expect(canTransitionSwap('cancelled', 'open', { isOfferer: true }).allowed).toBe(false);
      expect(canTransitionSwap('expired', 'open', { isScheduler: true }).allowed).toBe(false);
    });
  });
});
