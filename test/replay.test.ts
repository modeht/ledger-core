import { describe, expect, it } from 'bun:test';
import type { Day, LedgerEvent } from '../src/events.ts';
import { minor } from '../src/money.ts';
import { groupByDay, replay } from '../src/replay.ts';
import type { AccountSnapshot, DayReport, DayRow } from '../src/replay.ts';
import { ACCOUNTS, STREAM } from '../src/stream.ts';

const run = replay(ACCOUNTS, STREAM);

function day(d: Day): DayReport {
  const x = run.days[d - 1];
  if (x === undefined) throw new Error(`no report for day ${d.toString()}`);
  return x;
}

function account(d: Day, id: string): AccountSnapshot {
  const x = day(d).accounts.find((a) => a.id === id);
  if (x === undefined) throw new Error(`no ${id} on day ${d.toString()}`);
  return x;
}

function row(d: Day): DayRow {
  const x = run.summary.days[d - 1];
  if (x === undefined) throw new Error(`no summary row for day ${d.toString()}`);
  return x;
}

describe('groupByDay', () => {
  it('gives every day of the window in order, with events in the order they came', () => {
    const groups = groupByDay(STREAM);
    expect([...groups.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect((groups.get(5) ?? []).map((e) => e.id)).toEqual(['E7', 'E8', 'E10']);
    expect((groups.get(6) ?? []).map((e) => e.id)).toEqual(['E9']);
  });

  it('keeps an empty day', () => {
    const groups = groupByDay([]);
    expect([...groups.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(groups.get(3)).toEqual([]);
  });
});

describe('replay of the ten events', () => {
  it('gives one report per day', () => {
    expect(run.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reports the settlement of a missing authorization as an error on Day 4', () => {
    const errors = day(4).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('E6');
    expect(errors[0]).toContain('Auth-Z');
  });

  it('marks E7 as back-dated and shows the earlier days that moved on Day 5', () => {
    const e7 = day(5).events.find((o) => o.event.id === 'E7');
    expect(e7?.backdated).toBe(true);
    expect(day(5).eod.reevaluated).toEqual([
      { account: 'ACC-001', day: 2, before: minor(25000), after: minor(-37000) },
      { account: 'ACC-001', day: 3, before: minor(65000), after: minor(3000) },
      { account: 'ACC-001', day: 4, before: minor(46500), after: minor(-15500) },
    ]);
  });

  it('charges three fees on Day 5 and closes the accounts at the agreed figures', () => {
    expect(day(5).eod.fees).toHaveLength(3);
    const acc1 = account(5, 'ACC-001');
    expect(acc1.closing).toBe(minor(-23000));
    expect(acc1.feesToDate).toBe(minor(7500));
    expect(acc1.available).toBe(minor(-23000));
    expect(account(5, 'ACC-002').closing).toBe(minor(10000));
  });

  it('holds 20,000 for Auth-A at the end of Day 2', () => {
    const acc1 = account(2, 'ACC-001');
    expect(acc1.openHolds).toBe(minor(20000));
    expect(acc1.available).toBe(minor(5000));
    expect(day(2).holds.map((h) => [h.authId, h.state])).toEqual([['Auth-A', 'OPEN']]);
  });

  it('flags each fee left behind by the E9 reversal for a person to decide on', () => {
    const review = day(6).review;
    expect(review.map((r) => [r.account, r.feeDay, r.fee, r.reverser, r.reversed, r.closingNow])).toEqual([
      ['ACC-001', 2, minor(2500), 'E9', 'E7', minor(22500)],
      ['ACC-001', 4, minor(2500), 'E9', 'E7', minor(41500)],
      ['ACC-001', 5, minor(2500), 'E9', 'E7', minor(39000)],
    ]);
    expect(review.map((r) => r.text)).toEqual([
      'fee for Day 2 (2,500 AED fils) was assessed before E9 reversed E7; Day 2 now closes at 22,500 AED fils; refund is a human decision',
      'fee for Day 4 (2,500 AED fils) was assessed before E9 reversed E7; Day 4 now closes at 41,500 AED fils; refund is a human decision',
      'fee for Day 5 (2,500 AED fils) was assessed before E9 reversed E7; Day 5 now closes at 39,000 AED fils; refund is a human decision',
    ]);
    expect(run.summary.review).toEqual(review);
    expect(day(5).review).toEqual([]);
  });

  it('keeps the available balance each authorization saw before its hold', () => {
    const before = (id: string) => run.days.flatMap((d) => d.events).find((o) => o.event.id === id)?.availableBefore;
    expect(before('E3')).toBe(minor(25000));
    expect(before('E8')).toBe(minor(-15500));
    expect(before('E1')).toBeUndefined();
  });

  it('closes Day 6 with the interest paid', () => {
    const acc1 = account(6, 'ACC-001');
    expect(acc1.closing).toBe(minor(39093));
    // The exact dailies are 10 + 9 + 25 + 16.6 + 15.6 + 15.6 = 91.8.
    // The interest paid is the sum of the ROUNDED dailies, 93, by decision (ambiguity 9).
    expect(acc1.accruedToDate).toBe('91.8');
    expect(account(6, 'ACC-002').closing).toBe(minor(10008));
  });

  it('writes the accrued interest so far without trailing zeros', () => {
    // Days 1 to 3 as closed on Day 3: 10 + 10 + 26 = 46.
    expect(account(3, 'ACC-001').accruedToDate).toBe('46');
    expect(account(1, 'ACC-002').accruedToDate).toBe('0');
  });
});

describe('summary', () => {
  it('shows Day 2 both as it closed and as it ends the window', () => {
    expect(row(2).perAccount['ACC-001']).toEqual({
      final: minor(22500),
      asClosed: minor(25000),
      fee: minor(2500),
      accrual: minor(9),
    });
    expect(row(2).authorizations).toEqual(['Auth-A approved']);
  });

  it('names what happened to each authorization', () => {
    expect(row(1).authorizations).toEqual([]);
    expect(row(4).authorizations).toEqual(['Auth-A settled', 'Auth-Z rejected']);
    expect(row(5).authorizations).toEqual(['Auth-B declined']);
  });

  it('gives the final figures per account', () => {
    const [acc1, acc2] = run.summary.accounts;
    expect(acc1?.id).toBe('ACC-001');
    expect(acc1?.final).toBe(minor(39093));
    expect(acc1?.fees).toHaveLength(3);
    expect(acc1?.interest).toBe(minor(93));
    expect(acc2?.id).toBe('ACC-002');
    expect(acc2?.final).toBe(minor(10008));
    expect(acc2?.interest).toBe(minor(8));
  });

  it('keeps the closings each day had when it closed', () => {
    const asClosed = run.summary.days.map((r) => r.perAccount['ACC-001']?.asClosed);
    expect(asClosed).toEqual([25000, 25000, 65000, 46500, -23000, 39093].map(minor));
    const finals = run.summary.days.map((r) => r.perAccount['ACC-001']?.final);
    expect(finals).toEqual([25000, 22500, 62500, 41500, 39000, 39093].map(minor));
    const accruals = run.summary.days.map((r) => r.perAccount['ACC-001']?.accrual);
    expect(accruals).toEqual([10, 9, 25, 17, 16, 16].map(minor));
  });

  it('gives the second account its own figures day by day', () => {
    const rows = run.summary.days.map((r) => r.perAccount['ACC-002']);
    expect(rows.map((r) => r?.asClosed)).toEqual([0, 0, 0, 0, 10000, 10008].map(minor));
    expect(rows.map((r) => r?.final)).toEqual([0, 0, 0, 0, 10000, 10008].map(minor));
    expect(rows.map((r) => r?.fee)).toEqual([0, 0, 0, 0, 0, 0].map(minor));
    expect(rows.map((r) => r?.accrual)).toEqual([0, 0, 0, 0, 4, 4].map(minor));
  });
});

// Checks that the summary still has six rows and the agreed figures.
function expectAgreedSummary(result: ReturnType<typeof replay>): void {
  expect(result.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.summary.days.map((r) => r.day)).toEqual([1, 2, 3, 4, 5, 6]);
  const acc1 = result.summary.days.map((r) => r.perAccount['ACC-001']);
  expect(acc1.map((r) => r?.final)).toEqual([25000, 22500, 62500, 41500, 39000, 39093].map(minor));
  expect(acc1.map((r) => r?.accrual)).toEqual([10, 9, 25, 17, 16, 16].map(minor));
  const acc2 = result.summary.days.map((r) => r.perAccount['ACC-002']);
  expect(acc2.map((r) => r?.accrual)).toEqual([0, 0, 0, 0, 4, 4].map(minor));
  const [a1, a2] = result.summary.accounts;
  expect(a1?.final).toBe(minor(39093));
  expect(a1?.interest).toBe(minor(93));
  expect(a2?.final).toBe(minor(10008));
  expect(a2?.interest).toBe(minor(8));
}

describe('events that cannot be applied', () => {
  it('rejects an event booked before Day 1 and keeps the six days as they were', () => {
    const early: LedgerEvent = { id: 'EX0', type: 'CREDIT', bookedDay: 0, valueDay: 0, account: 'ACC-001', amount: minor(100) };
    const result = replay(ACCOUNTS, [...STREAM, early]);
    expectAgreedSummary(result);
    const errors = result.days[0]?.errors ?? [];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('EX0');
  });

  it('rejects an event booked after Day 6 and adds no seventh day', () => {
    const late: LedgerEvent = { id: 'EX7', type: 'CREDIT', bookedDay: 7, valueDay: 7, account: 'ACC-001', amount: minor(100) };
    const result = replay(ACCOUNTS, [...STREAM, late]);
    expectAgreedSummary(result);
    const errors = result.days[5]?.errors ?? [];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('EX7');
  });

  it('raises no review flag for a reversal that fails', () => {
    const bad: LedgerEvent = { id: 'EX9', type: 'REVERSAL', bookedDay: 6, valueDay: 5, account: 'ACC-001', reverses: 'E99' };
    const result = replay(ACCOUNTS, [...STREAM, bad]);
    expectAgreedSummary(result);
    const day6 = result.days[5];
    expect(day6?.errors.some((e) => e.includes('EX9'))).toBe(true);
    expect(day6?.review.some((r) => r.reverser === 'EX9')).toBe(false);
    expect(day6?.review).toHaveLength(3);
  });
});
