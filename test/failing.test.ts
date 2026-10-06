// This test fails on purpose.
// It is written the way a reader of the brief would write it: a BHD account
// that closes a day below zero should be charged the overdraft fee, 25.000 BHD.
// The ledger does not do that. The brief defines the fee for AED only (AED 25.00);
// NUMBERS.md records that BHD has no fee value. The ledger refuses to guess a
// BHD value or convert the AED one, so the end-of-day run reports an error and
// books nothing.
// What this reveals: the fee table is per currency and incomplete. A real system
// needs either a fee per currency or an explicit rule for a currency with no row.
// The test stays red so the gap is visible in `bun test`.
// `bun run test:green` runs every other file.

import { describe, expect, it } from 'bun:test';
import { runEndOfDay } from '../src/eod.ts';
import { Ledger } from '../src/ledger.ts';
import { minor } from '../src/money.ts';

describe('overdraft fee in BHD', () => {
  it('charges a BHD account that closes a day below zero', () => {
    const ledger = new Ledger([{ id: 'ACC-002', currency: 'BHD' }]);
    const debit = ledger.apply(
      { id: 'D1', type: 'DEBIT', account: 'ACC-002', amount: minor(1000), bookedDay: 1, valueDay: 1 },
      1,
    );
    expect(debit.ok).toBe(true);
    const result = runEndOfDay(ledger, 1);
    // This is the line that fails: the run reports "no overdraft fee defined".
    expect(result.errors.join(' ')).toBe('');
    expect(ledger.entries.all().filter((e) => e.kind === 'FEE')).toHaveLength(1);
  });
});
