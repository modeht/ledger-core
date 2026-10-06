// The replay runner. It plays the events day by day, runs the end-of-day
// stages after each day, and gathers what the reports need.
// It prints nothing and reads nothing. The renderers turn its result into text.

import { INTEREST, WINDOW } from './constants.ts';
import type { Entry } from './entries.ts';
import type { AccountId, AccountSpec, Day, LedgerEvent } from './events.ts';
import type { Hold } from './holds.ts';
import { Ledger, type ApplyResult } from './ledger.ts';
import { runEndOfDay, type EodResult } from './eod.ts';
import { formatMinor, minor } from './money.ts';
import type { Currency, Minor } from './money.ts';

export type EventOutcome = {
  event: LedgerEvent;
  result: ApplyResult;
  backdated: boolean; // valueDay < bookedDay
  availableBefore?: Minor; // authorizations only: the account's available balance just before the hold was tried
};

/** A fee that a later reversal did not take back, left for a person to decide on (ambiguity 2). */
export type FeeReview = {
  account: AccountId;
  feeDay: Day; // the value day of the fee
  fee: Minor; // the fee, as a positive number
  reverser: string; // the id of the reversal event
  reversed: string; // the id of the event it reversed
  closingNow: Minor; // the fee day's closing after the reversal
  text: string; // the same facts as one sentence
};

export type AccountSnapshot = {
  id: AccountId;
  currency: Currency;
  closing: Minor; // closingBalance(id, day) after the end-of-day run
  openHolds: Minor; // holds.activeTotal(id)
  available: Minor; // closing - openHolds
  feesToDate: Minor; // sum of FEE entries so far, as a positive number
  accruedToDate: string; // sum of the exact dailies 1..day as text, e.g. '64.6'
};

export type DayReport = {
  day: Day;
  events: EventOutcome[];
  eod: EodResult;
  accounts: AccountSnapshot[];
  holds: readonly Hold[]; // every hold known so far, with its state
  errors: string[]; // apply errors (each names its event id) followed by eod.errors
  review: FeeReview[]; // fees a person should look at
};

export type DayRow = {
  day: Day;
  perAccount: Record<AccountId, { final: Minor; asClosed: Minor; fee: Minor; accrual: Minor }>;
  authorizations: string[];
};

export type Summary = {
  days: DayRow[];
  accounts: { id: AccountId; currency: Currency; final: Minor; fees: Entry[]; interest: Minor }[];
  review: FeeReview[];
};

export type ReplayResult = { days: DayReport[]; summary: Summary; ledger: Ledger };

/**
 * Puts the events under the day they are booked on.
 * Every day of the window is there, in order, even when it has no events.
 * Inside a day the events keep the order they arrived in.
 * An event booked outside the window goes under the nearest day of the window.
 * There apply rejects it and its error shows in that day's report.
 * No day outside the window is ever added, so there is no extra end-of-day run.
 */
export function groupByDay(events: readonly LedgerEvent[]): Map<Day, LedgerEvent[]> {
  const out = new Map<Day, LedgerEvent[]>();
  for (let d = WINDOW.first; d <= WINDOW.last; d++) {
    out.set(d, []);
  }
  for (const e of events) {
    out.get(nearestWindowDay(e.bookedDay))?.push(e);
  }
  return out;
}

// The day itself when it is a day of the window, otherwise the closest one.
function nearestWindowDay(d: Day): Day {
  if (Number.isNaN(d)) return WINDOW.first;
  return Math.min(WINDOW.last, Math.max(WINDOW.first, Math.round(d)));
}

/** Plays every event and every end-of-day run, and gathers the report data. */
export function replay(accounts: AccountSpec[], events: readonly LedgerEvent[]): ReplayResult {
  const ledger = new Ledger(accounts);
  const days: DayReport[] = [];
  // The closing of each account and day, as the run of that same day left it.
  const asClosed = new Map<string, Minor>();

  for (const [day, todays] of groupByDay(events)) {
    const outcomes: EventOutcome[] = todays.map((event) => {
      const availableBefore = event.type === 'AUTHORIZATION' ? ledger.available(event.account, day) : undefined;
      const result = ledger.apply(event, day);
      return {
        event,
        result,
        backdated: event.valueDay < event.bookedDay,
        ...(availableBefore === undefined ? {} : { availableBefore }),
      };
    });
    const eod = runEndOfDay(ledger, day);

    const snapshots = ledger.accounts().map((a) => snapshot(ledger, a, day, eod));
    for (const s of snapshots) {
      asClosed.set(key(s.id, day), s.closing);
    }

    const errors: string[] = [];
    for (const o of outcomes) {
      if (!o.result.ok) errors.push(o.result.error);
    }
    errors.push(...eod.errors);

    days.push({
      day,
      events: outcomes,
      eod,
      accounts: snapshots,
      holds: ledger.holds.all(),
      errors,
      review: reviewFlags(ledger, day, outcomes),
    });
  }

  return { days, summary: summarize(ledger, days, asClosed), ledger };
}

function key(id: AccountId, day: Day): string {
  return `${id}|${day.toString()}`;
}

function snapshot(ledger: Ledger, a: AccountSpec, day: Day, eod: EodResult): AccountSnapshot {
  const closing = ledger.closingBalance(a.id, day);
  const openHolds = ledger.holds.activeTotal(a.id);
  let fees = 0;
  for (const e of ledger.entries.forAccount(a.id)) {
    if (e.kind === 'FEE') fees -= e.amount;
  }
  return {
    id: a.id,
    currency: a.currency,
    closing,
    openHolds,
    available: minor(closing - openHolds),
    feesToDate: minor(fees),
    accruedToDate: accruedText(eod.accruals[a.id] ?? []),
  };
}

// The exact interest for days 1 to today, added up in whole numbers and only
// then written as a decimal, so no float ever touches the money.
function accruedText(rows: EodResult['accruals'][AccountId]): string {
  let scaled = 0;
  for (const r of rows) {
    if (r.closing > 0) scaled += r.closing * INTEREST.numerator;
  }
  const whole = Math.floor(scaled / INTEREST.denominator);
  const rest = scaled % INTEREST.denominator;
  if (rest === 0) {
    return whole.toString();
  }
  const places = INTEREST.denominator.toString().length - 1;
  return `${whole.toString()}.${rest.toString().padStart(places, '0').replace(/0+$/, '')}`;
}

// A reversal does not take back the fees its original caused (ambiguity 2).
// Each such fee is listed so a person can decide on a refund.
function reviewFlags(ledger: Ledger, day: Day, outcomes: EventOutcome[]): FeeReview[] {
  const out: FeeReview[] = [];
  for (const o of outcomes) {
    const e = o.event;
    if (e.type !== 'REVERSAL' || !o.result.ok) continue;
    const currency = ledger.account(e.account).currency;
    for (const entry of ledger.entries.forAccount(e.account)) {
      if (entry.kind !== 'FEE' || entry.valueDay < e.valueDay) continue;
      const fee = minor(-entry.amount);
      const closingNow = ledger.closingBalance(e.account, entry.valueDay);
      const d = entry.valueDay.toString();
      out.push({
        account: e.account,
        feeDay: entry.valueDay,
        fee,
        reverser: e.id,
        reversed: e.reverses,
        closingNow,
        text: `fee for Day ${d} (${formatMinor(currency, fee)}) was assessed before ${e.id} reversed ${e.reverses}; Day ${d} now closes at ${formatMinor(currency, closingNow)}; refund is a human decision`,
      });
    }
  }
  return out;
}

// A short phrase per authorization or settlement, in the order the events came.
function authorizationPhrases(outcomes: EventOutcome[]): string[] {
  const out: string[] = [];
  for (const o of outcomes) {
    const e = o.event;
    if (e.type === 'AUTHORIZATION') {
      if (!o.result.ok) out.push(`${e.authId} rejected`);
      else if (o.result.hold?.state === 'DECLINED') out.push(`${e.authId} declined`);
      else out.push(`${e.authId} approved`);
    } else if (e.type === 'SETTLEMENT') {
      out.push(o.result.ok ? `${e.authId} settled` : `${e.authId} rejected`);
    }
  }
  return out;
}

function summarize(ledger: Ledger, days: DayReport[], asClosed: Map<string, Minor>): Summary {
  // Every report is a day of the window, so the last one is the end of the window.
  const last = days.find((d) => d.day === WINDOW.last);
  const accounts = ledger.accounts();

  const rows: DayRow[] = days.map((report) => {
    const perAccount: DayRow['perAccount'] = {};
    for (const a of accounts) {
      const fee = ledger.entries.forAccount(a.id).find((e) => e.kind === 'FEE' && e.valueDay === report.day);
      const accrual = last?.eod.accruals[a.id]?.find((r) => r.day === report.day)?.rounded ?? minor(0);
      perAccount[a.id] = {
        final: ledger.closingBalance(a.id, report.day),
        asClosed: asClosed.get(key(a.id, report.day)) ?? minor(0),
        fee: fee === undefined ? minor(0) : minor(-fee.amount),
        accrual,
      };
    }
    return { day: report.day, perAccount, authorizations: authorizationPhrases(report.events) };
  });

  const finalDay = WINDOW.last;
  const totals = accounts.map((a) => {
    const own = ledger.entries.forAccount(a.id);
    const interest = own.find((e) => e.kind === 'INTEREST');
    return {
      id: a.id,
      currency: a.currency,
      final: ledger.closingBalance(a.id, finalDay),
      fees: own.filter((e) => e.kind === 'FEE'),
      interest: interest === undefined ? minor(0) : interest.amount,
    };
  });

  return { days: rows, accounts: totals, review: days.flatMap((d) => d.review) };
}
