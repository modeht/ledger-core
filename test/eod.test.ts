import { describe, expect, it } from 'bun:test';
import { accrueInterest, assessFees, runEndOfDay } from '../src/eod.ts';
import type { EodResult } from '../src/eod.ts';
import type { Entry } from '../src/entries.ts';
import type { Day } from '../src/events.ts';
import { Ledger } from '../src/ledger.ts';
import type { ApplyResult } from '../src/ledger.ts';
import { minor } from '../src/money.ts';
import type { Minor } from '../src/money.ts';
import { ACCOUNTS, STREAM } from '../src/stream.ts';

type Replay = {
  ledger: Ledger;
  // What each event gave back, by event id.
  results: Map<string, ApplyResult>;
  // The available balance just before each event was applied, by event id.
  availableBefore: Map<string, Minor>;
  // One end-of-day result per day, in order.
  eods: EodResult[];
};

// Plays the ten events day by day, with an end-of-day run after each day.
function replayThrough(lastDay: Day): Replay {
  const ledger = new Ledger(ACCOUNTS);
  const results = new Map<string, ApplyResult>();
  const availableBefore = new Map<string, Minor>();
  const eods: EodResult[] = [];
  for (let day = 1; day <= lastDay; day++) {
    for (const e of STREAM) {
      if (e.bookedDay !== day) continue;
      availableBefore.set(e.id, ledger.available(e.account, day));
      results.set(e.id, ledger.apply(e, day));
    }
    eods.push(runEndOfDay(ledger, day));
  }
  return { ledger, results, availableBefore, eods };
}

function result(r: Replay, id: string): ApplyResult {
  const x = r.results.get(id);
  if (x === undefined) throw new Error(`no result for ${id}`);
  return x;
}

function entriesOf(r: Replay, id: string): Entry[] {
  const x = result(r, id);
  if (!x.ok) throw new Error(`${id} failed: ${x.error}`);
  return x.entries;
}

function eod(r: Replay, day: Day): EodResult {
  const x = r.eods[day - 1];
  if (x === undefined) throw new Error(`no end-of-day result for day ${day.toString()}`);
  return x;
}

function m(n: number): Minor {
  return minor(n);
}

describe('end of day 1', () => {
  const r = replayThrough(1);

  it('closes ACC-001 at 25,000 with no fee', () => {
    expect(r.ledger.closingBalance('ACC-001', 1)).toBe(m(25_000));
    expect(eod(r, 1).fees).toEqual([]);
    expect(eod(r, 1).errors).toEqual([]);
  });

  it('earns 10 fils of interest for day 1', () => {
    expect(eod(r, 1).accruals['ACC-001']?.[0]?.rounded).toBe(m(10));
    expect(eod(r, 1).capitalized).toEqual([]);
  });
});

describe('end of day 2', () => {
  const r = replayThrough(2);

  it('opens Auth-A and holds 20,000, leaving 5,000 available', () => {
    expect(result(r, 'E3').ok).toBe(true);
    expect(r.ledger.holds.activeTotal('ACC-001')).toBe(m(20_000));
    expect(r.ledger.available('ACC-001', 2)).toBe(m(5_000));
  });

  it('keeps the ledger balance at 25,000 and charges no fee', () => {
    expect(r.ledger.closingBalance('ACC-001', 2)).toBe(m(25_000));
    expect(eod(r, 2).fees).toEqual([]);
  });
});

describe('end of day 4', () => {
  const r = replayThrough(4);

  it('settles Auth-A for 18,500 and lets go of the whole hold', () => {
    const posted = entriesOf(r, 'E5');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.kind).toBe('POSTING');
    expect(posted[0]?.amount).toBe(m(-18_500));
    expect(r.ledger.holds.activeTotal('ACC-001')).toBe(m(0));
    expect(r.ledger.holds.find('Auth-A')?.state).toBe('SETTLED');
    expect(r.ledger.holds.find('Auth-A')?.day).toBe(2);
  });

  it('refuses the settlement for Auth-Z, which was never opened', () => {
    const x = result(r, 'E6');
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.error).toContain('Auth-Z');
  });

  it('closes day 4 at 46,500', () => {
    expect(r.ledger.closingBalance('ACC-001', 4)).toBe(m(46_500));
  });
});

describe('end of day 5', () => {
  const r = replayThrough(5);
  const day5 = eod(r, 5);

  it('books E7 as one debit of 62,000 dated back to day 2', () => {
    const posted = entriesOf(r, 'E7');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.kind).toBe('POSTING');
    expect(posted[0]?.amount).toBe(m(-62_000));
    expect(posted[0]?.valueDay).toBe(2);
  });

  it('declines Auth-B, because only -15,500 was available', () => {
    expect(r.availableBefore.get('E8')).toBe(m(-15_500));
    expect(r.ledger.holds.find('Auth-B')?.state).toBe('DECLINED');
  });

  it('lists the earlier days that E7 changed', () => {
    const acc1 = day5.reevaluated.filter((x) => x.account === 'ACC-001');
    expect(acc1).toEqual([
      { account: 'ACC-001', day: 2, before: m(25_000), after: m(-37_000) },
      { account: 'ACC-001', day: 3, before: m(65_000), after: m(3_000) },
      { account: 'ACC-001', day: 4, before: m(46_500), after: m(-15_500) },
    ]);
  });

  it('charges three fees of 2,500, for days 2, 4 and 5', () => {
    expect(day5.fees).toHaveLength(3);
    for (const f of day5.fees) {
      expect(f.kind).toBe('FEE');
      expect(f.account).toBe('ACC-001');
      expect(f.amount).toBe(m(-2_500));
      expect(f.bookedDay).toBe(5);
    }
    expect(day5.fees.map((f) => f.valueDay)).toEqual([2, 4, 5]);
  });

  it('closes days 2 to 5 with the fees counted', () => {
    expect(r.ledger.closingBalance('ACC-001', 2)).toBe(m(-39_500));
    expect(r.ledger.closingBalance('ACC-001', 3)).toBe(m(500));
    expect(r.ledger.closingBalance('ACC-001', 4)).toBe(m(-20_500));
    expect(r.ledger.closingBalance('ACC-001', 5)).toBe(m(-23_000));
  });

  it('splits the BHD credit into 3,333 + 3,333 + 3,334 with no fee', () => {
    const posted = entriesOf(r, 'E10');
    expect(posted.map((e) => e.amount)).toEqual([m(3_333), m(3_333), m(3_334)]);
    expect(posted.every((e) => e.kind === 'POSTING')).toBe(true);
    expect(r.ledger.closingBalance('ACC-002', 5)).toBe(m(10_000));
    expect(day5.accruals['ACC-002']?.[4]?.rounded).toBe(m(4));
    expect(day5.fees.some((f) => f.account === 'ACC-002')).toBe(false);
    expect(day5.errors).toEqual([]);
  });

  it('charges nothing more when the fees are checked again', () => {
    const count = r.ledger.entries.all().length;
    const again = assessFees(r.ledger, 5);
    expect(again.fees).toEqual([]);
    expect(again.errors).toEqual([]);
    expect(r.ledger.entries.all()).toHaveLength(count);
  });
});

describe('end of day 6', () => {
  const r = replayThrough(6);
  const day6 = eod(r, 6);

  it('books E9 as one credit of 62,000 dated back to day 2', () => {
    const posted = entriesOf(r, 'E9');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.kind).toBe('REVERSAL');
    expect(posted[0]?.amount).toBe(m(62_000));
    expect(posted[0]?.valueDay).toBe(2);
  });

  it('lists days 2 to 5 as changed by the reversal', () => {
    const acc1 = day6.reevaluated.filter((x) => x.account === 'ACC-001');
    expect(acc1).toEqual([
      { account: 'ACC-001', day: 2, before: m(-39_500), after: m(22_500) },
      { account: 'ACC-001', day: 3, before: m(500), after: m(62_500) },
      { account: 'ACC-001', day: 4, before: m(-20_500), after: m(41_500) },
      { account: 'ACC-001', day: 5, before: m(-23_000), after: m(39_000) },
    ]);
  });

  it('charges no new fee and keeps the three old ones', () => {
    expect(day6.fees).toEqual([]);
    const fees = r.ledger.entries.all().filter((e) => e.kind === 'FEE');
    expect(fees).toHaveLength(3);
  });

  it('works out the daily interest again from the corrected balances', () => {
    const rows = day6.accruals['ACC-001'] ?? [];
    expect(rows.map((x) => x.rounded)).toEqual([10, 9, 25, 17, 16, 16].map(m));
    expect(rows.map((x) => x.exact)).toEqual(['10', '9', '25', '16.6', '15.6', '15.6']);
    const bhd = day6.accruals['ACC-002'] ?? [];
    expect(bhd.map((x) => x.rounded)).toEqual([0, 0, 0, 0, 4, 4].map(m));
  });

  it('pays 93 fils to ACC-001 and 8 fils to ACC-002 on day 6', () => {
    expect(day6.capitalized).toHaveLength(2);
    const aed = day6.capitalized.find((e) => e.account === 'ACC-001');
    const bhd = day6.capitalized.find((e) => e.account === 'ACC-002');
    expect(aed?.kind).toBe('INTEREST');
    expect(aed?.amount).toBe(m(93));
    expect(aed?.bookedDay).toBe(6);
    expect(aed?.valueDay).toBe(6);
    expect(aed?.note).toContain('10 + 9 + 25 + 17 + 16 + 16 = 93');
    expect(bhd?.kind).toBe('INTEREST');
    expect(bhd?.amount).toBe(m(8));
  });

  it('closes ACC-001 at 39,093 and ACC-002 at 10,008', () => {
    expect(r.ledger.closingBalance('ACC-001', 6)).toBe(m(39_093));
    expect(r.ledger.closingBalance('ACC-002', 6)).toBe(m(10_008));
  });

  it('pays the interest that the daily amounts add up to', () => {
    for (const acc of ACCOUNTS) {
      const sum = (day6.accruals[acc.id] ?? []).reduce((s, x) => s + x.rounded, 0);
      const paid = day6.capitalized.find((e) => e.account === acc.id)?.amount;
      expect(paid).toBe(m(sum));
    }
  });

  it('finds no problem on any day', () => {
    for (const x of r.eods) expect(x.errors).toEqual([]);
  });

  it('keeps interest out of the log until day 6', () => {
    const interest = r.ledger.entries.all().filter((e) => e.kind === 'INTEREST');
    expect(interest.every((e) => e.bookedDay === 6)).toBe(true);
    expect(interest).toHaveLength(2);
  });

  it('pays interest only once when the last day is run again', () => {
    const count = r.ledger.entries.all().length;
    const again = runEndOfDay(r.ledger, 6);
    expect(again.capitalized).toEqual([]);
    expect(again.fees).toEqual([]);
    expect(r.ledger.entries.all()).toHaveLength(count);
  });
});

describe('a BHD account that closes below zero', () => {
  it('reports an error and charges no fee, since BHD has none', () => {
    const ledger = new Ledger([{ id: 'ACC-002', currency: 'BHD' }]);
    const applied = ledger.apply(
      { id: 'X1', type: 'DEBIT', bookedDay: 1, valueDay: 1, account: 'ACC-002', amount: m(1_000) },
      1,
    );
    expect(applied.ok).toBe(true);
    const out = runEndOfDay(ledger, 1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('BHD');
    expect(out.errors[0]).toContain('no overdraft fee');
    expect(out.fees).toEqual([]);
    expect(ledger.entries.all().filter((e) => e.kind === 'FEE')).toEqual([]);
  });

  it('gives no interest on a balance below zero', () => {
    const ledger = new Ledger([{ id: 'ACC-002', currency: 'BHD' }]);
    ledger.apply({ id: 'X1', type: 'DEBIT', bookedDay: 1, valueDay: 1, account: 'ACC-002', amount: m(1_000) }, 1);
    expect(accrueInterest(ledger, 1)['ACC-002']?.[0]?.rounded).toBe(m(0));
  });
});
