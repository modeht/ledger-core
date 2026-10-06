// Holds made by authorizations. A hold is not an entry in the log.
// It is the state of an authorization right now, so it may change in place:
// an open hold becomes settled, and then it no longer holds any money.
// Only this file changes a hold. Everyone else gets a frozen copy.

import { minor } from './money.ts';
import type { Minor } from './money.ts';
import type { AccountId, Day } from './events.ts';

export type HoldState = 'OPEN' | 'SETTLED' | 'DECLINED';

// What callers see: a frozen copy. Only this file may change a hold.
export type Hold = Readonly<HoldRecord>;

type HoldRecord = {
  authId: string;
  account: AccountId;
  amount: Minor;
  day: Day;
  state: HoldState;
  settledAmount?: Minor;
  settledDay?: Day;
};

type NewHold = { authId: string; account: AccountId; amount: Minor; day: Day };

export class Holds {
  readonly #byId = new Map<string, HoldRecord>();

  /** Opens a hold. The same authorization id may only be used once. */
  open(h: NewHold): Hold {
    return this.#add(h, 'OPEN');
  }

  /** Keeps a declined authorization for the record. It holds no money. */
  decline(h: NewHold): Hold {
    return this.#add(h, 'DECLINED');
  }

  find(authId: string): Hold | undefined {
    const hold = this.#byId.get(authId);
    return hold === undefined ? undefined : snapshot(hold);
  }

  /**
   * Settles an open hold. The settlement is final: the whole hold is
   * released, even when the settled amount is less than the hold.
   */
  settle(authId: string, amount: Minor, day: Day): Hold {
    const hold = this.#byId.get(authId);
    if (hold === undefined) {
      throw new Error(`There is no hold for ${authId}.`);
    }
    if (hold.state !== 'OPEN') {
      throw new Error(`The hold for ${authId} is ${hold.state.toLowerCase()}, not open.`);
    }
    if (amount > hold.amount) {
      throw new Error(`The settlement for ${authId} is more than its hold.`);
    }
    hold.state = 'SETTLED';
    hold.settledAmount = amount;
    hold.settledDay = day;
    return snapshot(hold);
  }

  /** The money held by open holds on one account. */
  activeTotal(account: AccountId): Minor {
    let total = 0;
    for (const h of this.#byId.values()) {
      if (h.account === account && h.state === 'OPEN') total += h.amount;
    }
    return minor(total);
  }

  /** Every hold, in the order it was made. */
  all(): readonly Hold[] {
    return Object.freeze([...this.#byId.values()].map(snapshot));
  }

  #add(h: NewHold, state: HoldState): Hold {
    if (this.#byId.has(h.authId)) {
      throw new Error(`The authorization id ${h.authId} is already used.`);
    }
    const hold: HoldRecord = { authId: h.authId, account: h.account, amount: h.amount, day: h.day, state };
    this.#byId.set(h.authId, hold);
    return snapshot(hold);
  }
}

// A frozen copy, so a caller can never change the ledger's own hold.
function snapshot(hold: HoldRecord): Hold {
  return Object.freeze({ ...hold });
}
