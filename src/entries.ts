// The ledger's log of entries. Entries only ever get added.
// There is no way to delete an entry or change one after it is written.

import type { Minor } from './money.ts';
import type { AccountId, Day } from './events.ts';

/** What kind of money movement an entry is. */
export type EntryKind = 'POSTING' | 'FEE' | 'INTEREST' | 'REVERSAL';

export type Entry = {
  readonly seq: number; // position in the log, starting at 1
  readonly account: AccountId;
  readonly kind: EntryKind;
  readonly amount: Minor; // a credit is positive, a debit is negative
  readonly bookedDay: Day; // the day the ledger wrote it
  readonly valueDay: Day; // the day it counts for
  readonly cause: string; // the event id ('E7'), or 'EOD-5' for something the day-end run booked
  readonly note?: string; // one line a person can read
};

export class EntryLog {
  readonly #list: Entry[] = [];

  /** Adds one entry at the end of the log. This is the only way in. */
  append(e: Omit<Entry, 'seq'>): Entry {
    const entry: Entry = Object.freeze({ ...e, seq: this.#list.length + 1 });
    this.#list.push(entry);
    return entry;
  }

  /** Every entry, oldest first. The list you get back cannot be changed. */
  all(): readonly Entry[] {
    return Object.freeze([...this.#list]);
  }

  /** The entries of one account, oldest first. */
  forAccount(id: AccountId): readonly Entry[] {
    return Object.freeze(this.#list.filter((e) => e.account === id));
  }
}
