// Every number the ledger uses. Each one is explained in NUMBERS.md.
import { minor, type Minor } from './money.ts';
import type { Currency } from './money.ts';

// The replay covers Day 1 to Day 6. Interest is paid on the last day.
export const WINDOW = { first: 1, last: 6 } as const;

// The fee for a day that closes below zero, at most once per day per account.
// BHD has no fee on purpose; a negative BHD close is an error elsewhere.
export const OVERDRAFT_FEE: Partial<Record<Currency, Minor>> = { AED: minor(2500) };

// 0.04% per day, kept as a pair of whole numbers: balance times 4, divided by 10,000.
export const INTEREST = { numerator: 4, denominator: 10_000 } as const;

// One day's interest on a closing balance, rounded to the nearest fils.
// Adding half the divisor before dividing makes an exact half round up.
// Balances at or below zero earn nothing.
export function dailyAccrual(closing: Minor): Minor {
  if (closing <= 0) {
    return minor(0);
  }
  const half = INTEREST.denominator / 2;
  return minor(Math.floor((closing * INTEREST.numerator + half) / INTEREST.denominator));
}

// One day's interest before rounding, written out exactly for reports.
// 41500 gives "16.6", 25000 gives "10", 22625 gives "9.05".
export function accrualExact(closing: Minor): string {
  if (closing <= 0) {
    return '0';
  }
  const scaled = closing * INTEREST.numerator;
  const whole = Math.floor(scaled / INTEREST.denominator);
  const rest = scaled % INTEREST.denominator;
  if (rest === 0) {
    return whole.toString();
  }
  // The divisor is 10,000, so the rest is up to four digits after the point.
  const places = INTEREST.denominator.toString().length - 1;
  const fraction = rest.toString().padStart(places, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fraction}`;
}
