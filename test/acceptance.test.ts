// The acceptance tests. They replay the ten events once and check the agreed
// figures day by day, then go through the brief's eight criteria one by one,
// then run three property checks on made-up events.
// Every amount is in minor units: fils for AED (100 per dirham), fils for BHD (1,000 per dinar).

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { dailyAccrual } from '../src/constants.ts';
import { assessFees, runEndOfDay } from '../src/eod.ts';
import type { Day, LedgerEvent } from '../src/events.ts';
import { Ledger } from '../src/ledger.ts';
import { minor } from '../src/money.ts';
import { replay } from '../src/replay.ts';
import type { AccountSnapshot, DayReport, DayRow } from '../src/replay.ts';
import { ACCOUNTS, STREAM } from '../src/stream.ts';

const run = replay(ACCOUNTS, STREAM);
const entries = run.ledger.entries.all();
const outcomes = run.days.flatMap((d) => d.events);

function day(d: Day): DayReport {
  const x = run.days[d - 1];
  if (x === undefined) throw new Error(`no report for day ${d.toString()}`);
  return x;
}

function snapshot(d: Day, id: string): AccountSnapshot {
  const x = day(d).accounts.find((a) => a.id === id);
  if (x === undefined) throw new Error(`no ${id} on day ${d.toString()}`);
  return x;
}

function row(d: Day): DayRow {
  const x = run.summary.days[d - 1];
  if (x === undefined) throw new Error(`no summary row for day ${d.toString()}`);
  return x;
}

function outcome(id: string) {
  const x = outcomes.find((o) => o.event.id === id);
  if (x === undefined) throw new Error(`no outcome for ${id}`);
  return x;
}

const fees = entries.filter((e) => e.kind === 'FEE');

// asClosed: the closing as that day's own run left it.
// final: the same day's closing as it stands at the end of the window.
// fee: the fee charged for that day. accrual: that day's rounded interest at the end.
type Expected = { account: string; day: Day; asClosed: number; final: number; fee: number; accrual: number };

const TABLE: Expected[] = [
  { account: 'ACC-001', day: 1, asClosed: 25000, final: 25000, fee: 0, accrual: 10 },
  { account: 'ACC-001', day: 2, asClosed: 25000, final: 22500, fee: 2500, accrual: 9 },
  { account: 'ACC-001', day: 3, asClosed: 65000, final: 62500, fee: 0, accrual: 25 },
  { account: 'ACC-001', day: 4, asClosed: 46500, final: 41500, fee: 2500, accrual: 17 },
  { account: 'ACC-001', day: 5, asClosed: -23000, final: 39000, fee: 2500, accrual: 16 },
  { account: 'ACC-001', day: 6, asClosed: 39093, final: 39093, fee: 0, accrual: 16 },
  { account: 'ACC-002', day: 1, asClosed: 0, final: 0, fee: 0, accrual: 0 },
  { account: 'ACC-002', day: 2, asClosed: 0, final: 0, fee: 0, accrual: 0 },
  { account: 'ACC-002', day: 3, asClosed: 0, final: 0, fee: 0, accrual: 0 },
  { account: 'ACC-002', day: 4, asClosed: 0, final: 0, fee: 0, accrual: 0 },
  { account: 'ACC-002', day: 5, asClosed: 10000, final: 10000, fee: 0, accrual: 4 },
  { account: 'ACC-002', day: 6, asClosed: 10008, final: 10008, fee: 0, accrual: 4 },
];

describe('day by day', () => {
  for (const t of TABLE) {
    it(`${t.account} Day ${t.day.toString()}: closed at ${t.asClosed.toString()}, ends the window at ${t.final.toString()}`, () => {
      expect(row(t.day).perAccount[t.account]).toEqual({
        final: minor(t.final),
        asClosed: minor(t.asClosed),
        fee: minor(t.fee),
        accrual: minor(t.accrual),
      });
      expect(snapshot(t.day, t.account).closing).toBe(minor(t.asClosed));
    });
  }

  it('after Day 4, Auth-A is settled for 18,500', () => {
    expect(day(4).holds.map((h) => [h.authId, h.state, h.settledAmount])).toEqual([['Auth-A', 'SETTLED', minor(18500)]]);
  });

  it('after Day 5, Auth-B is declined as well', () => {
    expect(day(5).holds.map((h) => [h.authId, h.state])).toEqual([
      ['Auth-A', 'SETTLED'],
      ['Auth-B', 'DECLINED'],
    ]);
  });

  it('books all three fees on Day 5', () => {
    expect(fees).toHaveLength(3);
    expect(fees.map((e) => e.bookedDay)).toEqual([5, 5, 5]);
    expect(fees.map((e) => e.amount)).toEqual([minor(-2500), minor(-2500), minor(-2500)]);
  });

  it('pays interest of 93 on ACC-001 and 8 on ACC-002, on Day 6', () => {
    const interest = entries.filter((e) => e.kind === 'INTEREST');
    expect(interest.map((e) => [e.account, e.amount, e.bookedDay, e.valueDay])).toEqual([
      ['ACC-001', minor(93), 6, 6],
      ['ACC-002', minor(8), 6, 6],
    ]);
  });

  it('writes 14 entries in all', () => {
    expect(entries).toHaveLength(14);
  });
});

describe('the criteria in the brief', () => {
  it('criterion 1: Day 2 closing seen by the Day 5 run, before its fee, is -37,000 AED fils', () => {
    // The reevaluate stage runs before the fee stage, so this is the figure before any fee.
    const seen = day(5).eod.reevaluated.find((r) => r.account === 'ACC-001' && r.day === 2);
    expect(seen?.before).toBe(minor(25000));
    expect(seen?.after).toBe(minor(-37000));
  });

  // Criterion 2 is refused, see REJECTED.md.
  // The brief asks for exactly one fee from E7. E7 pushes Days 2, 4 and 5 below zero,
  // and the rule is one fee for each day that closes below zero, so there are three.
  it('criterion 2 is refused: E7 causes three fees (Days 2, 4, 5), not one', () => {
    expect(fees).toHaveLength(3);
    expect(fees.map((e) => e.valueDay)).toEqual([2, 4, 5]);
  });

  it('criterion 3: the Day 4 settlement of Auth-A is accepted', () => {
    const e5 = outcome('E5');
    expect(e5.result.ok).toBe(true);
    const made = entries.filter((e) => e.cause === 'E5');
    expect(made.map((e) => e.amount)).toEqual([minor(-18500)]);
  });

  it('criterion 4: E6 is rejected', () => {
    const e6 = outcome('E6');
    expect(e6.result.ok).toBe(false);
    if (!e6.result.ok) expect(e6.result.error).toContain('Auth-Z');
    expect(entries.filter((e) => e.cause === 'E6')).toHaveLength(0);
  });

  it('criterion 5: never has to act in this stream', () => {
    // The rule "an authorization must not take available below zero" is enforced
    // in Ledger.apply. This stream never tries to approve a hold into a negative
    // available: Auth-A had room (25,000 available for 20,000), and Auth-B was declined.
    const opened = outcomes.filter((o) => o.event.type === 'AUTHORIZATION' && o.result.ok && o.result.hold?.state === 'OPEN');
    expect(opened.length).toBeGreaterThan(0);
    for (const o of opened) {
      if (o.event.type !== 'AUTHORIZATION') throw new Error('not an authorization');
      expect(o.availableBefore).toBeDefined();
      expect(o.availableBefore ?? 0).toBeGreaterThanOrEqual(o.event.amount);
    }
    expect(outcome('E3').availableBefore).toBe(minor(25000));
    const authB = outcome('E8');
    expect(authB.result.ok && authB.result.hold?.state).toBe('DECLINED');
  });

  // Criterion 6 is refused, see REJECTED.md.
  // The brief asks that after E9 all balances and fees go back to how they were before E7.
  // A reversal only mirrors the postings of E7. The three fees stay, and are listed for a
  // person to decide on a refund. So ACC-001 closes Day 6 at 39,000 before interest.
  it('criterion 6 is refused: after E9 the fees stay and ACC-001 closes Day 6 at 39,000 before interest, not 46,500', () => {
    const closing = snapshot(6, 'ACC-001').closing;
    expect(closing).toBe(minor(39093));
    expect(closing - 93).toBe(39000);
    expect(fees).toHaveLength(3);
    const reversed = entries.filter((e) => e.kind === 'REVERSAL');
    expect(reversed.map((e) => e.cause)).toEqual(['E9']);
    expect(reversed.map((e) => e.note)).toEqual(['reverses entry 5 of E7']);
    expect(entries.find((e) => e.seq === 5)?.kind).toBe('POSTING');
  });

  // Criterion 7 is refused, see REJECTED.md.
  // The brief asks for three instalments of BHD 3.334, which add up to 10.002, not 10.000.
  // The ledger splits 10,000 fils so the parts add up exactly: the last one takes the leftover fils.
  it('criterion 7 is refused: E10 splits into 3,333 + 3,333 + 3,334', () => {
    const parts = entries.filter((e) => e.cause === 'E10');
    expect(parts.map((e) => e.amount)).toEqual([minor(3333), minor(3333), minor(3334)]);
  });

  // Criterion 8 is refused, see REJECTED.md.
  // The brief speaks of a remainder thrown away when the rounded dailies do not add up
  // to the capitalized total. By decision the total paid IS the sum of the rounded dailies,
  // so there is never a remainder to throw away.
  it('criterion 8 is refused: the capitalized 93 is the sum of the rounded dailies', () => {
    const rows = day(6).eod.accruals['ACC-001'] ?? [];
    const sum = rows.reduce((s, r) => s + r.rounded, 0);
    expect(sum).toBe(93);
    const interest = entries.find((e) => e.kind === 'INTEREST' && e.account === 'ACC-001');
    expect(interest?.amount).toBe(minor(sum));
  });
});

// Runs every end of day from Day 1 to Day 6, applying each day's events first.
function playAll(ledger: Ledger, events: LedgerEvent[]): void {
  for (let d = 1; d <= 6; d++) {
    for (const e of events.filter((x) => x.bookedDay === d)) {
      const result = ledger.apply(e, d);
      if (!result.ok) throw new Error(result.error);
    }
    runEndOfDay(ledger, d);
  }
}

describe('properties', () => {
  it('one fee per day however many passes run', () => {
    const move = fc
      .record({
        type: fc.constantFrom('CREDIT' as const, 'DEBIT' as const),
        amount: fc.integer({ min: 1, max: 200_000 }),
        bookedDay: fc.integer({ min: 1, max: 6 }),
        back: fc.integer({ min: 0, max: 5 }),
      })
      .map((m) => ({ ...m, valueDay: Math.max(1, m.bookedDay - m.back) }));
    fc.assert(
      fc.property(fc.array(move, { minLength: 0, maxLength: 12 }), (moves) => {
        const events: LedgerEvent[] = moves.map((m, i) => ({
          id: `P${(i + 1).toString()}`,
          type: m.type,
          account: 'ACC-001',
          amount: minor(m.amount),
          bookedDay: m.bookedDay,
          valueDay: m.valueDay,
        }));
        const ledger = new Ledger([ACCOUNTS[0] ?? { id: 'ACC-001', currency: 'AED' }]);
        playAll(ledger, events);
        const countBefore = ledger.entries.all().length;
        assessFees(ledger, 6);
        assessFees(ledger, 6);
        expect(ledger.entries.all().length).toBe(countBefore);
        for (let d = 1; d <= 6; d++) {
          const onDay = ledger.entries.all().filter((e) => e.kind === 'FEE' && e.valueDay === d);
          expect(onDay.length).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('a reversal nets its original to zero', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 12 }), (amount, instalments) => {
        const ledger = new Ledger([ACCOUNTS[1] ?? { id: 'ACC-002', currency: 'BHD' }]);
        const credit = ledger.apply(
          { id: 'C1', type: 'CREDIT', account: 'ACC-002', amount: minor(amount), instalments, bookedDay: 1, valueDay: 1 },
          1,
        );
        expect(credit.ok).toBe(true);
        const reversal = ledger.apply({ id: 'R1', type: 'REVERSAL', account: 'ACC-002', reverses: 'C1', bookedDay: 1, valueDay: 1 }, 1);
        expect(reversal.ok).toBe(true);
        const all = ledger.entries.all();
        expect(all.filter((e) => e.kind === 'REVERSAL')).toHaveLength(instalments);
        expect(all.reduce((s, e) => s + e.amount, 0)).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('the rounded dailies sum to the capitalized credit', () => {
    const closings = fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 6, maxLength: 6 });
    fc.assert(
      fc.property(closings, (target) => {
        const events: LedgerEvent[] = [];
        let current = 0;
        target.forEach((want, i) => {
          const d = i + 1;
          const delta = want - current;
          current = want;
          if (delta === 0) return;
          const id = `M${d.toString()}`;
          const base = { id, account: 'ACC-001', bookedDay: d, valueDay: d };
          events.push(
            delta > 0 ? { ...base, type: 'CREDIT', amount: minor(delta) } : { ...base, type: 'DEBIT', amount: minor(-delta) },
          );
        });
        const ledger = new Ledger([{ id: 'ACC-001', currency: 'AED' }]);
        playAll(ledger, events);
        const expected = target.reduce((s, c) => s + dailyAccrual(minor(c)), 0);
        const interest = ledger.entries.all().filter((e) => e.kind === 'INTEREST');
        if (expected === 0) {
          expect(interest).toHaveLength(0);
        } else {
          expect(interest.map((e) => e.amount)).toEqual([minor(expected)]);
        }
        // Every closing is zero or more, so no day can have a fee.
        expect(ledger.entries.all().filter((e) => e.kind === 'FEE')).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});
