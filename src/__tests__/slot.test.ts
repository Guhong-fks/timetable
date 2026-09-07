import { slot } from '@/lib/importers/parsers';
import { TimeSlot } from '@/types/timetable';

describe('slot', () => {
  it('maps 1-2 -> ONE_TWO', () => {
    expect(slot(1, 2)).toBe(TimeSlot.ONE_TWO);
  });

  it('maps 3-4 -> THREE_FOUR', () => {
    expect(slot(3, 4)).toBe(TimeSlot.THREE_FOUR);
  });

  it('maps 5-6 -> FIVE_SIX', () => {
    expect(slot(5, 6)).toBe(TimeSlot.FIVE_SIX);
  });

  it('maps 7-8 -> SEVEN_EIGHT', () => {
    expect(slot(7, 8)).toBe(TimeSlot.SEVEN_EIGHT);
  });

  it('maps single period 8 -> EIGHT', () => {
    expect(slot(8, 8)).toBe(TimeSlot.EIGHT);
  });

  it('maps single period 9 -> NINE', () => {
    expect(slot(9, 9)).toBe(TimeSlot.NINE);
  });

  it('maps single period 10 -> TEN', () => {
    expect(slot(10, 10)).toBe(TimeSlot.TEN);
  });

  it('maps single period 11 -> ELEVEN', () => {
    expect(slot(11, 11)).toBe(TimeSlot.ELEVEN);
  });

  it('maps single period 12 -> TWELVE (not collapsed into ELEVEN)', () => {
    expect(slot(12, 12)).toBe(TimeSlot.TWELVE);
  });

  it('maps single period 13 -> THIRTEEN (not collapsed into ELEVEN)', () => {
    expect(slot(13, 13)).toBe(TimeSlot.THIRTEEN);
  });

  it('falls back to the anchor slot for non-standard spans (5-7 -> FIVE_SIX)', () => {
    expect(slot(5, 7)).toBe(TimeSlot.FIVE_SIX);
  });

  it('falls back to the anchor slot for non-standard spans (7-9 -> SEVEN_EIGHT)', () => {
    expect(slot(7, 9)).toBe(TimeSlot.SEVEN_EIGHT);
  });

  it('falls back to the anchor slot for non-standard spans (1-3 -> ONE_TWO)', () => {
    expect(slot(1, 3)).toBe(TimeSlot.ONE_TWO);
  });

  it('falls back to the anchor slot for non-standard spans (3-5 -> THREE_FOUR)', () => {
    expect(slot(3, 5)).toBe(TimeSlot.THREE_FOUR);
  });

  it('still accepts a single-argument call (start only) for backward compat', () => {
    expect(slot(1)).toBe(TimeSlot.ONE_TWO);
    expect(slot(5)).toBe(TimeSlot.FIVE_SIX);
    expect(slot(8)).toBe(TimeSlot.EIGHT);
  });

  it('falls back to TEN for unknown start values', () => {
    expect(slot(0, 0)).toBe(TimeSlot.TEN);
    expect(slot(2, 2)).toBe(TimeSlot.TEN);
    expect(slot(14, 14)).toBe(TimeSlot.TEN);
  });

  it('falls back to TEN when start/end are not finite', () => {
    expect(slot(Number.NaN, 5)).toBe(TimeSlot.TEN);
    expect(slot(5, Number.NaN)).toBe(TimeSlot.TEN);
  });

  it('falls back to TEN when end < start', () => {
    expect(slot(5, 4)).toBe(TimeSlot.TEN);
  });
});
