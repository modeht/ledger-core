import type { Currency, Minor } from './money.ts';
import { WINDOW } from './constants.ts';

/** A day in the window, from WINDOW.first to WINDOW.last. */
export type Day = number;

/** An account name, such as 'ACC-001'. */
export type AccountId = string;

/** An account and the one currency it holds. */
export type AccountSpec = { id: AccountId; currency: Currency };

/** Fields every event has. */
type Base = { id: string; bookedDay: Day; valueDay: Day; account: AccountId };

export type LedgerEvent =
  | (Base & { type: 'CREDIT'; amount: Minor; instalments?: number })
  | (Base & { type: 'DEBIT'; amount: Minor })
  | (Base & { type: 'AUTHORIZATION'; authId: string; amount: Minor })
  | (Base & { type: 'SETTLEMENT'; authId: string; amount: Minor })
  | (Base & { type: 'REVERSAL'; reverses: string }); // the id of the event being reversed

/**
 * Checks the shape of one event.
 * Returns a sentence that says what is wrong, or null when the event is fine.
 * It does not check that a reversed event exists. The ledger does that later.
 */
export function validate(e: LedgerEvent, accounts: AccountSpec[]): string | null {
  if (!accounts.some((a) => a.id === e.account)) {
    return `Event ${e.id} uses account ${e.account}, which is not a known account.`;
  }
  if (!Number.isInteger(e.valueDay) || !Number.isInteger(e.bookedDay)) {
    return `Event ${e.id} has a day that is not a whole number.`;
  }
  if (e.valueDay < WINDOW.first) {
    return `Event ${e.id} has value day ${e.valueDay}, which is before day ${WINDOW.first}.`;
  }
  if (e.valueDay > e.bookedDay) {
    return `Event ${e.id} has value day ${e.valueDay}, which is after its booked day ${e.bookedDay}.`;
  }
  if (e.bookedDay > WINDOW.last) {
    return `Event ${e.id} has booked day ${e.bookedDay}, which is after day ${WINDOW.last}.`;
  }
  if (e.type !== 'REVERSAL' && !(e.amount > 0)) {
    return `Event ${e.id} has amount ${e.amount}, but the amount must be more than zero.`;
  }
  if (e.type === 'CREDIT' && e.instalments !== undefined) {
    if (!Number.isInteger(e.instalments) || e.instalments < 1) {
      return `Event ${e.id} has ${e.instalments} instalments, but it needs a whole number of at least 1.`;
    }
  }
  if (e.type === 'REVERSAL' && (typeof e.reverses !== 'string' || e.reverses.length === 0)) {
    return `Event ${e.id} is a reversal but does not say which event it reverses.`;
  }
  return null;
}
