import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { EntryLog } from '../src/entries.ts';
import { Holds } from '../src/holds.ts';
import { Ledger } from '../src/ledger.ts';
import type { Day, LedgerEvent } from '../src/events.ts';
import { minor } from '../src/money.ts';
import { ACCOUNTS } from '../src/stream.ts';

const AED = 'ACC-001';
const BHD = 'ACC-002';

function ok(l: Ledger, e: LedgerEvent, today: Day = e.bookedDay) {
  const r = l.apply(e, today);
  if (!r.ok) throw new Error(r.error);
  return r;
}

function err(l: Ledger, e: LedgerEvent, today: Day = e.bookedDay): string {
  const r = l.apply(e, today);
  if (r.ok) throw new Error(`expected ${e.id} to fail`);
  return r.error;
}

function credit(id: string, day: Day, amount: number, account = AED, valueDay = day): LedgerEvent {
  return { id, type: 'CREDIT', bookedDay: day, valueDay, account, amount: minor(amount) };
}
function debit(id: string, day: Day, amount: number, valueDay = day): LedgerEvent {
  return { id, type: 'DEBIT', bookedDay: day, valueDay, account: AED, amount: minor(amount) };
}
function auth(id: string, day: Day, authId: string, amount: number): LedgerEvent {
  return { id, type: 'AUTHORIZATION', bookedDay: day, valueDay: day, account: AED, authId, amount: minor(amount) };
}
function settle(id: string, day: Day, authId: string, amount: number): LedgerEvent {
  return { id, type: 'SETTLEMENT', bookedDay: day, valueDay: day, account: AED, authId, amount: minor(amount) };
}
function reverse(id: string, day: Day, reverses: string, valueDay = day, account = AED): LedgerEvent {
  return { id, type: 'REVERSAL', bookedDay: day, valueDay, account, reverses };
}

describe('the entry log', () => {
  const base = { account: AED, kind: 'POSTING' as const, amount: minor(100), bookedDay: 1, valueDay: 1, cause: 'E1' };

  it('numbers entries 1, 2, 3 in the order they are added', () => {
    const log = new EntryLog();
    expect([log.append(base).seq, log.append(base).seq, log.append(base).seq]).toEqual([1, 2, 3]);
  });

  it('gives back lists and entries that cannot be changed', () => {
    const log = new EntryLog();
    const e = log.append(base);
    const list = log.all();
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => (list as unknown as unknown[]).push(e)).toThrow();
    expect(() => {
      (e as { amount: number }).amount = 5;
    }).toThrow();
    expect(log.all()).toHaveLength(1);
    expect(log.all()[0]?.amount).toBe(minor(100));
  });

  it('lists the entries of one account only', () => {
    const log = new EntryLog();
    log.append(base);
    log.append({ ...base, account: BHD });
    expect(log.forAccount(BHD).map((e) => e.seq)).toEqual([2]);
  });

  it('leaves out the note when there is none', () => {
    const log = new EntryLog();
    expect('note' in log.append(base)).toBe(false);
  });
});

describe('holds', () => {
  const h = { authId: 'A', account: AED, amount: minor(2000), day: 2 };

  it('opens, then settles, and the settled hold holds nothing', () => {
    const holds = new Holds();
    expect(holds.open(h).state).toBe('OPEN');
    expect(holds.activeTotal(AED)).toBe(minor(2000));
    const s = holds.settle('A', minor(1500), 4);
    expect(s.state).toBe('SETTLED');
    expect(s.settledAmount).toBe(minor(1500));
    expect(s.settledDay).toBe(4);
    expect(holds.activeTotal(AED)).toBe(minor(0));
  });

  it('keeps a declined hold for the record, holding nothing', () => {
    const holds = new Holds();
    expect(holds.decline(h).state).toBe('DECLINED');
    expect(holds.find('A')?.state).toBe('DECLINED');
    expect(holds.activeTotal(AED)).toBe(minor(0));
  });

  it('refuses a used id, an unknown id, a closed hold and too much money', () => {
    const holds = new Holds();
    holds.open(h);
    expect(() => holds.open(h)).toThrow();
    expect(() => holds.decline(h)).toThrow();
    expect(() => holds.settle('nope', minor(1), 3)).toThrow();
    expect(() => holds.settle('A', minor(2001), 3)).toThrow();
    holds.settle('A', minor(2000), 3);
    expect(() => holds.settle('A', minor(1), 3)).toThrow();
  });
});

describe('balances', () => {
  it('adds up entries by value day, not by booked day', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    ok(l, debit('D1', 3, 300, 2));
    expect(l.closingBalance(AED, 1)).toBe(minor(1000));
    expect(l.closingBalance(AED, 2)).toBe(minor(700));
    expect(l.closingBalance(AED, 3)).toBe(minor(700));
  });

  it('leaves out only the day\'s own fee before the fee check', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, debit('D1', 1, 100));
    l.entries.append({ account: AED, kind: 'FEE', amount: minor(-2500), bookedDay: 2, valueDay: 1, cause: 'EOD-2' });
    l.entries.append({ account: AED, kind: 'FEE', amount: minor(-2500), bookedDay: 2, valueDay: 2, cause: 'EOD-2' });
    expect(l.closingBalance(AED, 2)).toBe(minor(-5100));
    expect(l.closingBeforeOwnFee(AED, 2)).toBe(minor(-2600));
    expect(l.closingBeforeOwnFee(AED, 1)).toBe(minor(-100));
    expect(l.hasFee(AED, 2)).toBe(true);
    expect(l.hasFee(AED, 3)).toBe(false);
  });

  it('takes open holds off the available balance', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    ok(l, auth('A1', 1, 'X', 400));
    expect(l.available(AED, 1)).toBe(minor(600));
    expect(l.closingBalance(AED, 1)).toBe(minor(1000));
  });

  it('remembers closings and knows closed days and interest', () => {
    const l = new Ledger(ACCOUNTS);
    expect(l.recall(AED, 1)).toBeUndefined();
    l.remember(AED, 1, minor(42));
    expect(l.recall(AED, 1)).toBe(minor(42));
    expect(l.recall(BHD, 1)).toBeUndefined();
    expect(l.isClosed(1)).toBe(false);
    l.closeDay(1);
    expect(l.isClosed(1)).toBe(true);
    expect(l.hasInterest(AED)).toBe(false);
    l.entries.append({ account: AED, kind: 'INTEREST', amount: minor(9), bookedDay: 6, valueDay: 6, cause: 'EOD-6' });
    expect(l.hasInterest(AED)).toBe(true);
  });

  it('throws for an account it does not know', () => {
    const l = new Ledger(ACCOUNTS);
    expect(l.account(BHD).currency).toBe('BHD');
    expect(() => l.account('ACC-999')).toThrow();
  });
});

describe('applying events', () => {
  it('splits a credit of 10,000 BHD fils into 3,333, 3,333 and 3,334', () => {
    const l = new Ledger(ACCOUNTS);
    const r = ok(l, { ...credit('E10', 5, 10000, BHD), instalments: 3 } as LedgerEvent);
    expect(r.entries.map((e) => e.amount)).toEqual([minor(3333), minor(3333), minor(3334)]);
    expect(r.entries.map((e) => e.note)).toEqual(['instalment 1 of 3', 'instalment 2 of 3', 'instalment 3 of 3']);
    expect(r.entries.every((e) => e.valueDay === 5 && e.bookedDay === 5 && e.cause === 'E10')).toBe(true);
  });

  it('refuses the same event a second time, and writes nothing', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 100));
    const before = l.entries.all().length;
    expect(err(l, credit('C1', 1, 100))).toContain('already applied');
    expect(l.entries.all()).toHaveLength(before);
    expect(l.closingBalance(AED, 1)).toBe(minor(100));
  });

  it('lets an event id be used again after it was refused', () => {
    const l = new Ledger(ACCOUNTS);
    err(l, credit('C1', 2, 100), 1);
    ok(l, credit('C1', 1, 100));
    expect(l.closingBalance(AED, 1)).toBe(minor(100));
  });

  it('refuses an event id that starts with EOD-', () => {
    const l = new Ledger(ACCOUNTS);
    expect(err(l, credit('EOD-1', 1, 100))).toContain('EOD-');
    expect(l.entries.all()).toHaveLength(0);
  });

  it('lets a plain debit take the balance below zero', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 100));
    const r = ok(l, debit('D1', 1, 500));
    expect(r.entries[0]?.amount).toBe(minor(-500));
    expect(l.closingBalance(AED, 1)).toBe(minor(-400));
  });

  it('declines an authorization when too little is available, and writes nothing', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 100));
    const before = l.entries.all().length;
    const r = ok(l, auth('A1', 1, 'B', 9000));
    expect(r.hold?.state).toBe('DECLINED');
    expect(r.entries).toEqual([]);
    expect(r.note).toBe('declined: available 100 AED fils, requested 9,000 AED fils');
    expect(l.entries.all()).toHaveLength(before);
    expect(l.holds.activeTotal(AED)).toBe(minor(0));
  });

  it('approves an authorization that leaves exactly zero available', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 100));
    expect(ok(l, auth('A1', 1, 'B', 100)).hold?.state).toBe('OPEN');
  });

  it('refuses an authorization id that is already used', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 100));
    ok(l, auth('A1', 1, 'B', 10));
    expect(err(l, auth('A2', 1, 'B', 10))).toContain('A2');
  });

  it('refuses a settlement for an unknown authorization, and changes nothing', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    const msg = err(l, settle('S1', 1, 'Auth-Z', 100));
    expect(msg).toContain('Auth-Z');
    expect(msg).toContain('S1');
    expect(l.entries.all()).toHaveLength(1);
  });

  it('refuses a settlement above the hold, and changes nothing', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    ok(l, auth('A1', 1, 'X', 200));
    expect(err(l, settle('S1', 1, 'X', 201))).toContain('X');
    expect(l.entries.all()).toHaveLength(1);
    expect(l.holds.find('X')?.state).toBe('OPEN');
  });

  it('refuses a settlement against a declined or settled authorization', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    ok(l, auth('A1', 1, 'D', 5000));
    expect(err(l, settle('S1', 1, 'D', 10))).toContain('declined');
    ok(l, auth('A2', 1, 'X', 200));
    ok(l, settle('S2', 1, 'X', 200));
    expect(err(l, settle('S3', 1, 'X', 10))).toContain('settled');
  });

  it('settles below the hold and releases the whole hold', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 100000));
    ok(l, auth('E3', 2, 'Auth-A', 20000));
    const r = ok(l, settle('E5', 4, 'Auth-A', 18500));
    expect(r.entries[0]?.amount).toBe(minor(-18500));
    expect(r.entries[0]?.note).toBe('settles Auth-A; 1,500 AED fils released');
    expect(r.hold?.state).toBe('SETTLED');
    expect(r.hold?.settledDay).toBe(4);
    expect(l.holds.activeTotal(AED)).toBe(minor(0));
    expect(l.available(AED, 4)).toBe(minor(81500));
  });

  it('refuses a settlement on another account, and changes nothing', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    ok(l, auth('A1', 1, 'X', 200));
    const msg = err(l, { ...settle('S1', 1, 'X', 100), account: BHD });
    expect(msg).toContain('S1');
    expect(l.entries.all()).toHaveLength(1);
    expect(l.holds.find('X')?.state).toBe('OPEN');
  });

  it('refuses a reversal on another account, and changes nothing', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, debit('D1', 1, 300));
    expect(err(l, reverse('R1', 1, 'D1', 1, BHD))).toContain('R1');
    expect(l.entries.all()).toHaveLength(1);
  });

  it('refuses to reverse fees made by the day-end run', () => {
    const l = new Ledger(ACCOUNTS);
    l.entries.append({ account: AED, kind: 'FEE', amount: minor(-2500), bookedDay: 5, valueDay: 2, cause: 'EOD-5' });
    l.entries.append({ account: AED, kind: 'FEE', amount: minor(-2500), bookedDay: 5, valueDay: 4, cause: 'EOD-5' });
    const msg = err(l, reverse('R1', 6, 'EOD-5'));
    expect(msg).toContain('R1');
    expect(msg).toContain('only postings');
    expect(l.entries.all()).toHaveLength(2);
    expect(l.closingBalance(AED, 6)).toBe(minor(-5000));
  });

  it('refuses to reverse interest, or another reversal', () => {
    const l = new Ledger(ACCOUNTS);
    l.entries.append({ account: AED, kind: 'INTEREST', amount: minor(93), bookedDay: 6, valueDay: 6, cause: 'EOD-6' });
    expect(err(l, reverse('R1', 6, 'EOD-6'))).toContain('only postings');
    ok(l, debit('D1', 6, 300));
    ok(l, reverse('R2', 6, 'D1'));
    expect(err(l, reverse('R3', 6, 'R2'))).toContain('only postings');
    expect(l.entries.all()).toHaveLength(3);
  });

  it('gives out holds that cannot be changed from outside', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, credit('C1', 1, 1000));
    const opened = ok(l, auth('A1', 1, 'X', 200)).hold;
    expect(() => {
      (opened as { state: string }).state = 'SETTLED';
    }).toThrow();
    const found = l.holds.find('X');
    expect(() => {
      (found as { amount: number }).amount = 0;
    }).toThrow();
    expect(() => {
      (l.holds.all()[0] as { state: string }).state = 'DECLINED';
    }).toThrow();
    expect(l.holds.activeTotal(AED)).toBe(minor(200));
    ok(l, settle('S1', 1, 'X', 200));
    expect(opened?.state).toBe('OPEN');
    expect(l.holds.find('X')?.state).toBe('SETTLED');
  });

  it('refuses a reversal of an event with no entries', () => {
    const l = new Ledger(ACCOUNTS);
    expect(err(l, reverse('R1', 1, 'E99'))).toContain('E99');
  });

  it('refuses to reverse the same event twice', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, debit('D1', 1, 300));
    ok(l, reverse('R1', 1, 'D1'));
    expect(err(l, reverse('R2', 1, 'D1'))).toContain('already reversed');
    expect(l.entries.all()).toHaveLength(2);
  });

  it('mirrors each entry of the reversed event, and leaves the rest alone', () => {
    const l = new Ledger(ACCOUNTS);
    ok(l, { ...credit('C3', 2, 10000, BHD), instalments: 3 } as LedgerEvent);
    l.entries.append({ account: BHD, kind: 'FEE', amount: minor(-50), bookedDay: 2, valueDay: 2, cause: 'EOD-2' });
    const r = ok(l, reverse('R1', 3, 'C3', 2, BHD));
    expect(r.entries).toHaveLength(3);
    expect(r.entries.every((e) => e.kind === 'REVERSAL' && e.valueDay === 2 && e.bookedDay === 3)).toBe(true);
    expect(r.entries.reduce((s, e) => s + e.amount, 0)).toBe(-10000);
    expect(r.entries[0]?.note).toBe('reverses entry 1 of C3');
    expect(l.closingBalance(BHD, 3)).toBe(minor(-50));
    expect(l.hasFee(BHD, 2)).toBe(true);
  });

  it('refuses an event booked on a closed day', () => {
    const l = new Ledger(ACCOUNTS);
    l.closeDay(1);
    expect(err(l, credit('C1', 1, 100))).toContain('closed');
    expect(l.entries.all()).toHaveLength(0);
  });

  it('refuses an event whose booked day is not today', () => {
    const l = new Ledger(ACCOUNTS);
    expect(err(l, credit('C1', 2, 100), 3)).toBe('Event C1 is booked on day 2 but today is day 3.');
  });

  it('refuses an event that fails the shape check', () => {
    const l = new Ledger(ACCOUNTS);
    expect(err(l, credit('C1', 1, 100, 'ACC-999'))).toContain('ACC-999');
  });
});

describe('properties', () => {
  it('reversing any split credit brings the balance back to where it was', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), fc.integer({ min: 1, max: 12 }), (amount, n) => {
        const l = new Ledger(ACCOUNTS);
        const r = ok(l, { ...credit('C1', 1, amount), instalments: n } as LedgerEvent);
        expect(r.entries.reduce((s, e) => s + e.amount, 0)).toBe(amount);
        ok(l, reverse('R1', 2, 'C1', 1));
        expect(l.closingBalance(AED, 6)).toBe(minor(0));
      }),
    );
  });

  it('never lets an approved authorization push available below zero', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), fc.array(fc.integer({ min: 1, max: 50_000 }), { maxLength: 8 }), (start, asks) => {
        const l = new Ledger(ACCOUNTS);
        ok(l, credit('C1', 1, start));
        asks.forEach((a, i) => ok(l, auth(`A${i}`, 1, `H${i}`, a)));
        expect(l.available(AED, 1)).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
