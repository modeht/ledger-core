// The ledger: the log of entries, the holds, and the rules for each event.
// Balances are never stored as running totals. A day's closing balance is
// always worked out again from the entries whose value day is on or before it.

import { EntryLog } from './entries.ts';
import type { Entry } from './entries.ts';
import { Holds } from './holds.ts';
import type { Hold } from './holds.ts';
import { validate } from './events.ts';
import type { AccountId, AccountSpec, Day, LedgerEvent } from './events.ts';
import { formatMinor, minor, splitEqual } from './money.ts';
import type { Minor } from './money.ts';

export type ApplyResult =
  | { ok: true; entries: Entry[]; hold?: Hold; note: string } // a declined authorization is ok, with a DECLINED hold and no entries
  | { ok: false; error: string };

type Event<T extends LedgerEvent['type']> = Extract<LedgerEvent, { type: T }>;

export class Ledger {
  readonly entries = new EntryLog();
  readonly holds = new Holds();
  readonly #accounts: readonly AccountSpec[];
  readonly #closed = new Set<Day>();
  readonly #remembered = new Map<string, Minor>();
  // Which event reversed which: reversed event id -> reversal event id.
  readonly #reversedBy = new Map<string, string>();
  // Ids of events already applied. The same event is never applied twice.
  readonly #applied = new Set<string>();

  constructor(accounts: AccountSpec[]) {
    this.#accounts = Object.freeze(accounts.map((a) => Object.freeze({ ...a })));
  }

  accounts(): readonly AccountSpec[] {
    return this.#accounts;
  }

  account(id: AccountId): AccountSpec {
    const found = this.#accounts.find((a) => a.id === id);
    if (found === undefined) {
      throw new Error(`There is no account ${id}.`);
    }
    return found;
  }

  /** The sum of every entry of the account whose value day is on or before the day. */
  closingBalance(id: AccountId, day: Day): Minor {
    let total = 0;
    for (const e of this.entries.forAccount(id)) {
      if (e.valueDay <= day) total += e.amount;
    }
    return minor(total);
  }

  /**
   * The closing balance without the day's own fee. The fee check uses this,
   * so a day's fee can never be the reason that day gets a fee.
   * Fees for earlier days still count.
   */
  closingBeforeOwnFee(id: AccountId, day: Day): Minor {
    let total: number = this.closingBalance(id, day);
    for (const e of this.entries.forAccount(id)) {
      if (e.kind === 'FEE' && e.valueDay === day) total -= e.amount;
    }
    return minor(total);
  }

  /** What the account may spend today: the balance today minus open holds. */
  available(id: AccountId, today: Day): Minor {
    return minor(this.closingBalance(id, today) - this.holds.activeTotal(id));
  }

  hasFee(id: AccountId, day: Day): boolean {
    return this.entries.forAccount(id).some((e) => e.kind === 'FEE' && e.valueDay === day);
  }

  hasInterest(id: AccountId): boolean {
    return this.entries.forAccount(id).some((e) => e.kind === 'INTEREST');
  }

  closeDay(day: Day): void {
    this.#closed.add(day);
  }

  isClosed(day: Day): boolean {
    return this.#closed.has(day);
  }

  /** The day-end run keeps each day's closing balance here. */
  remember(id: AccountId, day: Day, closing: Minor): void {
    this.#remembered.set(`${id}|${day}`, closing);
  }

  /** What the last day-end run kept, or undefined when it never ran for that day. */
  recall(id: AccountId, day: Day): Minor | undefined {
    return this.#remembered.get(`${id}|${day}`);
  }

  /** Applies one event on the given day. Nothing changes when the result is an error. */
  apply(e: LedgerEvent, today: Day): ApplyResult {
    const problem = validate(e, [...this.#accounts]);
    if (problem !== null) return fail(problem);
    if (e.id.startsWith('EOD-')) {
      return fail(`Event ${e.id} has an id starting with EOD-, which the day-end run keeps for itself.`);
    }
    if (this.#applied.has(e.id)) {
      return fail(`Event ${e.id} is already applied, so it is not applied again.`);
    }
    if (e.bookedDay !== today) {
      return fail(`Event ${e.id} is booked on day ${e.bookedDay} but today is day ${today}.`);
    }
    if (this.isClosed(e.bookedDay)) {
      return fail(`Event ${e.id} is booked on day ${e.bookedDay}, but day ${e.bookedDay} is closed.`);
    }
    const result = this.#run(e, today);
    if (result.ok) this.#applied.add(e.id);
    return result;
  }

  #run(e: LedgerEvent, today: Day): ApplyResult {
    switch (e.type) {
      case 'CREDIT':
        return this.#credit(e, today);
      case 'DEBIT':
        return this.#debit(e, today);
      case 'AUTHORIZATION':
        return this.#authorize(e, today);
      case 'SETTLEMENT':
        return this.#settle(e, today);
      case 'REVERSAL':
        return this.#reverse(e, today);
    }
  }

  // One posting per instalment. The last instalment takes any leftover fils.
  #credit(e: Event<'CREDIT'>, today: Day): ApplyResult {
    const parts = splitEqual(e.amount, e.instalments ?? 1);
    const written = parts.map((amount, i) =>
      this.entries.append({
        account: e.account,
        kind: 'POSTING',
        amount,
        bookedDay: today,
        valueDay: e.valueDay,
        cause: e.id,
        ...(parts.length > 1 ? { note: `instalment ${i + 1} of ${parts.length}` } : {}),
      }),
    );
    const c = this.account(e.account).currency;
    const note =
      parts.length > 1
        ? `credited ${formatMinor(c, e.amount)} in ${parts.length} instalments`
        : `credited ${formatMinor(c, e.amount)}`;
    return { ok: true, entries: written, note };
  }

  // A plain debit may take the balance below zero. That is what the fee is for.
  #debit(e: Event<'DEBIT'>, today: Day): ApplyResult {
    const entry = this.entries.append({
      account: e.account,
      kind: 'POSTING',
      amount: minor(-e.amount),
      bookedDay: today,
      valueDay: e.valueDay,
      cause: e.id,
    });
    const c = this.account(e.account).currency;
    return { ok: true, entries: [entry], note: `debited ${formatMinor(c, e.amount)}` };
  }

  // Checked once, against what is available today. It is never checked again later.
  #authorize(e: Event<'AUTHORIZATION'>, today: Day): ApplyResult {
    if (this.holds.find(e.authId) !== undefined) {
      return fail(`Event ${e.id} uses authorization id ${e.authId}, which is already used.`);
    }
    const spec = { authId: e.authId, account: e.account, amount: e.amount, day: today };
    const available = this.available(e.account, today);
    if (available - e.amount >= 0) {
      return { ok: true, entries: [], hold: this.holds.open(spec), note: 'hold opened' };
    }
    const c = this.account(e.account).currency;
    const hold = this.holds.decline(spec);
    const note = `declined: available ${formatMinor(c, available)}, requested ${formatMinor(c, e.amount)}`;
    return { ok: true, entries: [], hold, note };
  }

  // Accepted only against an open hold on the same account, for no more than the hold.
  #settle(e: Event<'SETTLEMENT'>, today: Day): ApplyResult {
    const hold = this.holds.find(e.authId);
    if (hold === undefined) {
      return fail(`Event ${e.id} settles ${e.authId}, but there is no authorization ${e.authId}.`);
    }
    if (hold.account !== e.account) {
      return fail(`Event ${e.id} settles ${e.authId}, but that authorization is on account ${hold.account}.`);
    }
    if (hold.state !== 'OPEN') {
      return fail(`Event ${e.id} settles ${e.authId}, but that authorization is ${hold.state.toLowerCase()}.`);
    }
    const c = this.account(e.account).currency;
    if (e.amount > hold.amount) {
      return fail(
        `Event ${e.id} settles ${e.authId} for ${formatMinor(c, e.amount)}, which is more than its hold of ${formatMinor(c, hold.amount)}.`,
      );
    }
    const released = minor(hold.amount - e.amount);
    const note =
      released > 0 ? `settles ${e.authId}; ${formatMinor(c, released)} released` : `settles ${e.authId}`;
    const entry = this.entries.append({
      account: e.account,
      kind: 'POSTING',
      amount: minor(-e.amount),
      bookedDay: today,
      valueDay: e.valueDay,
      cause: e.id,
      note,
    });
    const settled = this.holds.settle(e.authId, e.amount, today);
    return { ok: true, entries: [entry], hold: settled, note };
  }

  // One mirror entry per entry of the reversed event. Fees and holds are left alone.
  // Only postings made by an event can be reversed. Fees, interest and other
  // reversals cannot: undoing a fee or interest needs its own approved event.
  #reverse(e: Event<'REVERSAL'>, today: Day): ApplyResult {
    const originals = this.entries.all().filter((x) => x.cause === e.reverses);
    if (originals.length === 0) {
      return fail(`Event ${e.id} reverses ${e.reverses}, but the ledger has no entries from ${e.reverses}.`);
    }
    const other = originals.find((x) => x.kind !== 'POSTING');
    if (other !== undefined) {
      return fail(`Event ${e.id} reverses ${e.reverses}, but ${e.reverses} made a ${other.kind} entry, and only postings can be reversed.`);
    }
    if (originals.some((x) => x.account !== e.account)) {
      return fail(`Event ${e.id} reverses ${e.reverses}, which is on a different account.`);
    }
    const earlier = this.#reversedBy.get(e.reverses);
    if (earlier !== undefined) {
      return fail(`Event ${e.id} reverses ${e.reverses}, but ${e.reverses} is already reversed by ${earlier}.`);
    }
    const written = originals.map((x) =>
      this.entries.append({
        account: x.account,
        kind: 'REVERSAL',
        amount: minor(-x.amount),
        bookedDay: today,
        valueDay: e.valueDay,
        cause: e.id,
        note: `reverses entry ${x.seq} of ${e.reverses}`,
      }),
    );
    this.#reversedBy.set(e.reverses, e.id);
    return { ok: true, entries: written, note: `reversed ${e.reverses} with ${written.length} ${written.length === 1 ? 'entry' : 'entries'}` };
  }
}

function fail(error: string): ApplyResult {
  return { ok: false, error };
}
