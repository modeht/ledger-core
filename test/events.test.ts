import { describe, expect, it } from 'bun:test';
import { validate } from '../src/events.ts';
import type { LedgerEvent } from '../src/events.ts';
import { minor } from '../src/money.ts';
import { ACCOUNTS, STREAM } from '../src/stream.ts';

function find(id: string): LedgerEvent {
  const e = STREAM.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no event ${id}`);
  return e;
}

describe('the event list', () => {
  it('has ten events, E1 to E10, in order', () => {
    expect(STREAM.map((e) => e.id)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10']);
  });

  it('has only events that pass the check', () => {
    for (const e of STREAM) {
      expect(validate(e, ACCOUNTS)).toBeNull();
    }
  });

  it('dates E7 and E9 back to day 2', () => {
    const e7 = find('E7');
    const e9 = find('E9');
    expect(e7.valueDay).toBe(2);
    expect(e7.bookedDay).toBe(5);
    expect(e9.valueDay).toBe(2);
    expect(e9.bookedDay).toBe(6);
  });

  it('stores E10 as 10000 fils to be paid in three instalments', () => {
    const e10 = find('E10');
    if (e10.type !== 'CREDIT') throw new Error('E10 should be a credit');
    expect(e10.instalments).toBe(3);
    expect(e10.amount).toBe(minor(10000));
    expect(e10.account).toBe('ACC-002');
  });

  it('stores E1 as 120000 fils', () => {
    const e1 = find('E1');
    if (e1.type !== 'CREDIT') throw new Error('E1 should be a credit');
    expect(e1.amount).toBe(minor(120000));
  });
});

describe('the event check', () => {
  const good: LedgerEvent = { id: 'X1', type: 'DEBIT', bookedDay: 3, valueDay: 2, account: 'ACC-001', amount: minor(100) };

  it('accepts a good event', () => {
    expect(validate(good, ACCOUNTS)).toBeNull();
  });

  it('turns away an unknown account', () => {
    expect(validate({ ...good, account: 'ACC-999' }, ACCOUNTS)).toContain('X1');
  });

  it('turns away a value day after the booked day', () => {
    expect(validate({ ...good, valueDay: 4, bookedDay: 3 }, ACCOUNTS)).toContain('X1');
  });

  it('turns away a booked day after day 6', () => {
    expect(validate({ ...good, bookedDay: 7 }, ACCOUNTS)).toContain('X1');
  });

  it('turns away a value day before day 1', () => {
    expect(validate({ ...good, valueDay: 0 }, ACCOUNTS)).toContain('X1');
  });

  it('turns away a day that is not a whole number', () => {
    expect(validate({ ...good, valueDay: 1.5 }, ACCOUNTS)).toContain('X1');
  });

  it('turns away a zero amount', () => {
    expect(validate({ ...good, amount: minor(0) }, ACCOUNTS)).toContain('X1');
  });

  it('turns away zero instalments', () => {
    const credit: LedgerEvent = { id: 'X2', type: 'CREDIT', bookedDay: 5, valueDay: 5, account: 'ACC-002', amount: minor(10000), instalments: 0 };
    expect(validate(credit, ACCOUNTS)).toContain('X2');
  });

  it('turns away a reversal that names no event', () => {
    const rev: LedgerEvent = { id: 'X3', type: 'REVERSAL', bookedDay: 6, valueDay: 2, account: 'ACC-001', reverses: '' };
    expect(validate(rev, ACCOUNTS)).toContain('X3');
  });

  it('does not check that the reversed event exists', () => {
    const rev: LedgerEvent = { id: 'X4', type: 'REVERSAL', bookedDay: 6, valueDay: 2, account: 'ACC-001', reverses: 'E99' };
    expect(validate(rev, ACCOUNTS)).toBeNull();
  });
});
