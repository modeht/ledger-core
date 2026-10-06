import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import {
  CURRENCIES,
  formatMajor,
  formatMinor,
  fromText,
  minor,
  splitEqual,
  type Currency,
} from '../src/money.ts';
import { accrualExact, dailyAccrual, INTEREST, OVERDRAFT_FEE, WINDOW } from '../src/constants.ts';

const currency = fc.constantFrom<Currency>('AED', 'BHD');
const safeInt = fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

describe('minor', () => {
  it('accepts whole numbers', () => {
    expect(minor(120000)).toBe(minor(120000));
    expect(minor(-5) as number).toBe(-5);
  });

  it('refuses fractions and numbers that are too big', () => {
    expect(() => minor(1.5)).toThrow();
    expect(() => minor(Number.NaN)).toThrow();
    expect(() => minor(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe('the currency table', () => {
  it('has two decimals for AED and three for BHD', () => {
    expect(CURRENCIES.AED).toEqual({ decimals: 2, perMajor: 100 });
    expect(CURRENCIES.BHD).toEqual({ decimals: 3, perMajor: 1000 });
  });
});

describe('fromText', () => {
  it('reads AED amounts', () => {
    expect(fromText('AED', '1,200.00') as number).toBe(120000);
    expect(fromText('AED', '950.00') as number).toBe(95000);
    expect(fromText('AED', '620.00') as number).toBe(62000);
    expect(fromText('AED', '25') as number).toBe(2500);
    expect(fromText('AED', '0.5') as number).toBe(50);
  });

  it('reads BHD amounts', () => {
    expect(fromText('BHD', '10.000') as number).toBe(10000);
    expect(fromText('BHD', '10.008') as number).toBe(10008);
    expect(fromText('BHD', '1,234.5') as number).toBe(1234500);
  });

  it('reads a minus sign', () => {
    expect(fromText('AED', '-230.00') as number).toBe(-23000);
    expect(fromText('BHD', '-0.001') as number).toBe(-1);
  });

  it('turns minus zero into zero', () => {
    expect(Object.is(fromText('AED', '-0.00'), 0)).toBe(true);
  });

  it('refuses text that is not an amount', () => {
    for (const bad of ['1.2.3', 'abc', '', '.5', '1.', '+1.00', '1,20.00', '1 200', '1e3', '0x10']) {
      expect(() => fromText('AED', bad)).toThrow();
    }
  });

  it('refuses too many decimals', () => {
    expect(() => fromText('BHD', '10.0000')).toThrow();
    expect(() => fromText('AED', '1.234')).toThrow();
  });

  it('refuses amounts too large to hold exactly', () => {
    expect(() => fromText('AED', '90071992547409.92')).toThrow();
  });
});

describe('formatMinor', () => {
  it('shows fils with commas and the sign in front', () => {
    expect(formatMinor('AED', minor(39093))).toBe('39,093 AED fils');
    expect(formatMinor('AED', minor(-23000))).toBe('-23,000 AED fils');
    expect(formatMinor('BHD', minor(10008))).toBe('10,008 BHD fils');
    expect(formatMinor('AED', minor(0))).toBe('0 AED fils');
    expect(formatMinor('AED', minor(999))).toBe('999 AED fils');
    expect(formatMinor('AED', minor(1234567))).toBe('1,234,567 AED fils');
  });
});

describe('formatMajor', () => {
  it('shows whole units and padded decimals', () => {
    expect(formatMajor('AED', minor(39093))).toBe('AED 390.93');
    expect(formatMajor('AED', minor(-23000))).toBe('AED -230.00');
    expect(formatMajor('BHD', minor(10008))).toBe('BHD 10.008');
    expect(formatMajor('AED', minor(5))).toBe('AED 0.05');
    expect(formatMajor('AED', minor(-5))).toBe('AED -0.05');
    expect(formatMajor('AED', minor(120000))).toBe('AED 1,200.00');
    expect(formatMajor('BHD', minor(1234567890))).toBe('BHD 1,234,567.890');
  });

  it('gives back the same amount when read again', () => {
    fc.assert(
      fc.property(currency, safeInt, (c, n) => {
        const text = formatMajor(c, minor(n)).slice(c.length + 1);
        expect(fromText(c, text) as number).toBe(n === 0 ? 0 : n);
      }),
    );
  });
});

describe('splitEqual', () => {
  it('puts the leftover fils on the last part', () => {
    expect(splitEqual(minor(10000), 3) as number[]).toEqual([3333, 3333, 3334]);
    expect(splitEqual(minor(9), 3) as number[]).toEqual([3, 3, 3]);
    expect(splitEqual(minor(7), 1) as number[]).toEqual([7]);
    expect(splitEqual(minor(2), 3) as number[]).toEqual([0, 0, 2]);
  });

  it('refuses a bad number of parts', () => {
    expect(() => splitEqual(minor(100), 0)).toThrow();
    expect(() => splitEqual(minor(100), -1)).toThrow();
    expect(() => splitEqual(minor(100), 1.5)).toThrow();
  });

  it('parts add up to the total, and only the last part can be larger', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (total, parts) => {
          const out = splitEqual(minor(total), parts) as number[];
          expect(out.length).toBe(parts);
          expect(out.reduce((sum, p) => sum + p, 0)).toBe(total);
          const first = out[0] ?? 0;
          const last = out[out.length - 1] ?? 0;
          for (const p of out.slice(0, -1)) {
            expect(p).toBe(first);
          }
          // The last part holds the leftover, which is always less than the number of parts.
          expect(last - first).toBeGreaterThanOrEqual(0);
          expect(last - first).toBeLessThan(parts);
          expect(last - first).toBe(total % parts);
          // When the leftover is at most 1 fils, all parts differ by at most 1.
          if (total % parts <= 1) {
            expect(last - first).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});

describe('the constants', () => {
  it('match the numbers in the rules', () => {
    expect(WINDOW).toEqual({ first: 1, last: 6 });
    expect(OVERDRAFT_FEE.AED as number | undefined).toBe(2500);
    expect(OVERDRAFT_FEE.BHD).toBeUndefined();
    expect(INTEREST).toEqual({ numerator: 4, denominator: 10_000 });
  });
});

describe('dailyAccrual', () => {
  it('matches each day of the replay for ACC-001', () => {
    const days: Array<[number, number]> = [
      [25000, 10],
      [22500, 9],
      [62500, 25],
      [41500, 17],
      [39000, 16],
      [39000, 16],
    ];
    for (const [closing, interest] of days) {
      expect(dailyAccrual(minor(closing)) as number).toBe(interest);
    }
  });

  it('matches the replay for ACC-002', () => {
    expect(dailyAccrual(minor(10000)) as number).toBe(4);
  });

  it('rounds an exact half up', () => {
    // 12500 times 4 is 50000: exactly 5, no half here.
    expect(dailyAccrual(minor(12500)) as number).toBe(5);
    // 1250 times 4 is 5000: exactly half a fils, which rounds up to 1.
    expect(dailyAccrual(minor(1250)) as number).toBe(1);
    // 3750 times 4 is 15000: one and a half fils, which rounds up to 2.
    expect(dailyAccrual(minor(3750)) as number).toBe(2);
    // Just under a half rounds down.
    expect(dailyAccrual(minor(1249)) as number).toBe(0);
  });

  it('is never negative and is 0 at or below zero', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }), (closing) => {
        const interest = dailyAccrual(minor(closing)) as number;
        expect(interest).toBeGreaterThanOrEqual(0);
        if (closing <= 0) {
          expect(interest).toBe(0);
        }
      }),
    );
  });

  it('never goes down when the balance goes up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (closing, more) => {
          expect(dailyAccrual(minor(closing + more)) as number).toBeGreaterThanOrEqual(
            dailyAccrual(minor(closing)) as number,
          );
        },
      ),
    );
  });
});

describe('accrualExact', () => {
  it('writes the unrounded interest exactly', () => {
    expect(accrualExact(minor(41500))).toBe('16.6');
    expect(accrualExact(minor(39000))).toBe('15.6');
    expect(accrualExact(minor(25000))).toBe('10');
    expect(accrualExact(minor(22500))).toBe('9');
    expect(accrualExact(minor(22625))).toBe('9.05');
    expect(accrualExact(minor(2500))).toBe('1');
    expect(accrualExact(minor(1250))).toBe('0.5');
    expect(accrualExact(minor(1))).toBe('0.0004');
    expect(accrualExact(minor(0))).toBe('0');
    expect(accrualExact(minor(-500))).toBe('0');
  });
});
