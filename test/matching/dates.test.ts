import { describe, expect, it } from 'vitest';
import { addBusinessDays, withinMatchWindow } from '../../src/matching/dates';

describe('addBusinessDays', () => {
  it('skips weekends going forward', () => {
    // Friday 2026-06-05 + 1 business day -> Monday 2026-06-08.
    const d = addBusinessDays(new Date('2026-06-05T00:00:00Z'), 1);
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-08');
  });

  it('skips weekends going backward', () => {
    // Monday 2026-06-08 - 1 business day -> Friday 2026-06-05.
    const d = addBusinessDays(new Date('2026-06-08T00:00:00Z'), -1);
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-05');
  });
});

describe('withinMatchWindow', () => {
  it('accepts an Amazon date 1 business day before the bank date', () => {
    // Bank date Monday 2026-06-08 -> lower bound is Friday 2026-06-05.
    expect(withinMatchWindow('2026-06-08', '2026-06-05')).toBe(true);
  });

  it('accepts an Amazon date 4 business days after the bank date', () => {
    // Bank date Monday 2026-06-01 + 4 business days -> Friday 2026-06-05.
    expect(withinMatchWindow('2026-06-01', '2026-06-05')).toBe(true);
  });

  it('rejects an Amazon date outside the window', () => {
    expect(withinMatchWindow('2026-06-01', '2026-06-10')).toBe(false);
    expect(withinMatchWindow('2026-06-08', '2026-06-04')).toBe(false);
  });
});
