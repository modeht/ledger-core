// The end-of-day run. It has six stages, run in this order:
// cutoff, reevaluate, fees, interest, capitalize, report.
// Each stage is its own function so a step mode can run them one at a time.
import { WINDOW, OVERDRAFT_FEE, accrualExact, dailyAccrual } from './constants.ts';
import type { Entry } from './entries.ts';
import type { AccountId, Day } from './events.ts';
import type { Ledger } from './ledger.ts';
import { formatMinor, minor } from './money.ts';
import type { Minor } from './money.ts';

export type EodResult = {
  day: Day;
  // Earlier days whose closing balance changed since the previous run.
  reevaluated: { account: AccountId; day: Day; before: Minor; after: Minor }[];
  // FEE entries added by this run.
  fees: Entry[];
  // Interest for days 1 to today, worked out again on every run.
  accruals: Record<AccountId, { day: Day; closing: Minor; exact: string; rounded: Minor }[]>;
  // INTEREST entries added. Only on the last day of the window.
  capitalized: Entry[];
  // Problems found, such as a negative close in a currency with no fee.
  errors: string[];
};

// Stage 1. No more events for this day.
export function cutoff(ledger: Ledger, day: Day): void {
  ledger.closeDay(day);
}

// Stage 2. Find earlier days whose closing balance moved since the last run.
// It only compares. The report stage stores the new balances.
export function reevaluate(ledger: Ledger, day: Day): EodResult['reevaluated'] {
  const out: EodResult['reevaluated'] = [];
  for (const acc of ledger.accounts()) {
    for (let d = WINDOW.first; d < day; d++) {
      const before = ledger.recall(acc.id, d);
      const after = ledger.closingBalance(acc.id, d);
      if (before !== undefined && before !== after) {
        out.push({ account: acc.id, day: d, before, after });
      }
    }
  }
  return out;
}

// Stage 3. Charge one fee for each day that closed below zero.
// Days are checked in order, because a fee on one day lowers every later day.
// A day that already has a fee is never charged again.
export function assessFees(ledger: Ledger, day: Day): { fees: Entry[]; errors: string[] } {
  const fees: Entry[] = [];
  const errors: string[] = [];
  for (const acc of ledger.accounts()) {
    for (let d = WINDOW.first; d <= day; d++) {
      const closing = ledger.closingBeforeOwnFee(acc.id, d);
      if (closing >= 0 || ledger.hasFee(acc.id, d)) {
        continue;
      }
      const fee = OVERDRAFT_FEE[acc.currency];
      if (fee === undefined) {
        errors.push(
          `${acc.id} closed day ${d.toString()} at ${formatMinor(acc.currency, closing)} but ${acc.currency} has no overdraft fee defined`,
        );
        continue;
      }
      fees.push(
        ledger.entries.append({
          account: acc.id,
          kind: 'FEE',
          amount: minor(-fee),
          bookedDay: day,
          valueDay: d,
          cause: `EOD-${day.toString()}`,
          note: `overdraft fee for day ${d.toString()}`,
        }),
      );
    }
  }
  return { fees, errors };
}

// Stage 4. Work out each day's interest from its closing balance.
// This is kept in the result only. Nothing is added to the log here.
export function accrueInterest(ledger: Ledger, day: Day): EodResult['accruals'] {
  const out: EodResult['accruals'] = {};
  for (const acc of ledger.accounts()) {
    const rows: EodResult['accruals'][AccountId] = [];
    for (let d = WINDOW.first; d <= day; d++) {
      const closing = ledger.closingBalance(acc.id, d);
      rows.push({ day: d, closing, exact: accrualExact(closing), rounded: dailyAccrual(closing) });
    }
    out[acc.id] = rows;
  }
  return out;
}

// Stage 5. On the last day, pay the interest: the sum of the rounded daily amounts.
// An account is paid once. A total of zero adds no entry.
export function capitalize(ledger: Ledger, day: Day, accruals: EodResult['accruals']): Entry[] {
  const out: Entry[] = [];
  if (day !== WINDOW.last) {
    return out;
  }
  for (const acc of ledger.accounts()) {
    if (ledger.hasInterest(acc.id)) {
      continue;
    }
    const rows = accruals[acc.id] ?? [];
    let sum = 0;
    for (const r of rows) {
      sum += r.rounded;
    }
    if (sum === 0) {
      continue;
    }
    const dailies = rows.map((r) => r.rounded.toString()).join(' + ');
    out.push(
      ledger.entries.append({
        account: acc.id,
        kind: 'INTEREST',
        amount: minor(sum),
        bookedDay: day,
        valueDay: day,
        cause: `EOD-${day.toString()}`,
        note: `interest for days ${WINDOW.first.toString()} to ${day.toString()}: ${dailies} = ${sum.toString()}`,
      }),
    );
  }
  return out;
}

// Stage 6. Store every day's closing balance, so the next run can spot changes.
export function report(ledger: Ledger, day: Day, parts: Omit<EodResult, 'day'>): EodResult {
  for (const acc of ledger.accounts()) {
    for (let d = WINDOW.first; d <= day; d++) {
      ledger.remember(acc.id, d, ledger.closingBalance(acc.id, d));
    }
  }
  return { day, ...parts };
}

// The whole run, all six stages in order.
export function runEndOfDay(ledger: Ledger, day: Day): EodResult {
  cutoff(ledger, day);
  const reevaluated = reevaluate(ledger, day);
  const { fees, errors } = assessFees(ledger, day);
  const accruals = accrueInterest(ledger, day);
  const capitalized = capitalize(ledger, day, accruals);
  return report(ledger, day, { reevaluated, fees, accruals, capitalized, errors });
}
