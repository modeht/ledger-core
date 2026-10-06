// The replay result as JSON. Every money figure is { minor, text }, where
// minor is the whole number of fils and text is the amount in whole units.

import type { Entry } from '../entries.ts';
import type { AccountId, AccountSpec } from '../events.ts';
import type { Hold } from '../holds.ts';
import { CURRENCIES, formatMajor } from '../money.ts';
import type { Currency, Minor } from '../money.ts';
import type { DayReport, EventOutcome, FeeReview, ReplayResult, Summary } from '../replay.ts';
import type { Balances, StepView } from '../step.ts';

type Money = { minor: number; text: string };

// Turns an amount on an account into { minor, text }, using that account's currency.
function moneyOf(currencies: ReadonlyMap<AccountId, Currency>): (account: AccountId, a: Minor) => Money {
  return (account, a) => ({ minor: a, text: formatMajor(currencies.get(account) ?? 'AED', a) });
}

// One ledger entry, with its amount as { minor, text }.
function entryOf(money: (account: AccountId, a: Minor) => Money): (e: Entry) => object {
  return (e) => ({
    seq: e.seq,
    account: e.account,
    kind: e.kind,
    amount: money(e.account, e.amount),
    bookedDay: e.bookedDay,
    valueDay: e.valueDay,
    cause: e.cause,
    ...(e.note === undefined ? {} : { note: e.note }),
  });
}

/** One step-mode screen as indented JSON. Every amount is { minor, text }, as in toJson. */
export function stepToJson(view: StepView, accounts: readonly AccountSpec[]): string {
  const money = moneyOf(new Map(accounts.map((a) => [a.id, a.currency])));
  const entry = entryOf(money);
  const balances = (all: Record<AccountId, Balances>): object =>
    Object.fromEntries(
      Object.entries(all).map(([id, b]) => [
        id,
        { ledger: money(id, b.ledger), holds: money(id, b.holds), available: money(id, b.available) },
      ]),
    );
  const s = view.step;
  const step =
    s.kind === 'event'
      ? (() => {
          const e = s.event;
          const extra =
            e.type === 'AUTHORIZATION' || e.type === 'SETTLEMENT'
              ? { authId: e.authId }
              : e.type === 'REVERSAL'
                ? { reverses: e.reverses }
                : e.type === 'CREDIT' && e.instalments !== undefined
                  ? { instalments: e.instalments }
                  : {};
          return {
            index: s.index,
            day: s.day,
            kind: s.kind,
            event: {
              id: e.id,
              type: e.type,
              account: e.account,
              ...extra,
              ...(e.type === 'REVERSAL' ? {} : { amount: money(e.account, e.amount) }),
              bookedDay: e.bookedDay,
              valueDay: e.valueDay,
            },
          };
        })()
      : { index: s.index, day: s.day, kind: s.kind, stage: s.stage, name: s.name };
  const doc = {
    step,
    total: view.total,
    ok: view.ok,
    note: view.note,
    before: balances(view.before),
    after: balances(view.after),
    valueDated: view.valueDated.map((v) => ({
      account: v.account,
      day: v.day,
      before: money(v.account, v.before),
      after: money(v.account, v.after),
      willBeFeeChecked: v.willBeFeeChecked,
    })),
    appended: view.appended.map(entry),
    ...(view.feePass === undefined
      ? {}
      : {
          feePass: view.feePass.map((f) => ({ account: f.account, day: f.day, closing: money(f.account, f.closing), outcome: f.outcome })),
        }),
    outline: view.outline,
  };
  return JSON.stringify(doc, null, 2);
}

/** The whole result as indented JSON, with keys always in the same order. */
export function toJson(result: ReplayResult): string {
  const currencies = new Map<AccountId, Currency>(result.ledger.accounts().map((a) => [a.id, a.currency]));
  const money = moneyOf(currencies);
  const entry = entryOf(money);
  const hold = (h: Hold): object => ({
    authId: h.authId,
    account: h.account,
    amount: money(h.account, h.amount),
    day: h.day,
    state: h.state,
    ...(h.settledAmount === undefined ? {} : { settledAmount: money(h.account, h.settledAmount) }),
    ...(h.settledDay === undefined ? {} : { settledDay: h.settledDay }),
  });

  const event = (o: EventOutcome): object => {
    const e = o.event;
    const extra =
      e.type === 'AUTHORIZATION' || e.type === 'SETTLEMENT'
        ? { authId: e.authId }
        : e.type === 'REVERSAL'
          ? { reverses: e.reverses }
          : e.type === 'CREDIT' && e.instalments !== undefined
            ? { instalments: e.instalments }
            : {};
    const r = o.result;
    return {
      id: e.id,
      type: e.type,
      account: e.account,
      ...extra,
      ...(e.type === 'REVERSAL' ? {} : { amount: money(e.account, e.amount) }),
      valueDay: e.valueDay,
      bookedDay: e.bookedDay,
      backdated: o.backdated,
      ...(o.availableBefore === undefined ? {} : { availableBefore: money(e.account, o.availableBefore) }),
      ok: r.ok,
      ...(r.ok ? { note: r.note } : { error: r.error }),
      entries: r.ok ? r.entries.map(entry) : [],
      ...(r.ok && r.hold !== undefined ? { hold: hold(r.hold) } : {}),
    };
  };

  const review = (x: FeeReview): object => ({
    account: x.account,
    feeDay: x.feeDay,
    fee: money(x.account, x.fee),
    reverser: x.reverser,
    reversed: x.reversed,
    closingNow: money(x.account, x.closingNow),
    text: x.text,
  });

  const day = (d: DayReport): object => ({
    day: d.day,
    events: d.events.map(event),
    eod: {
      reevaluated: d.eod.reevaluated.map((r) => ({
        account: r.account,
        day: r.day,
        before: money(r.account, r.before),
        after: money(r.account, r.after),
      })),
      fees: d.eod.fees.map(entry),
      accruals: Object.fromEntries(
        Object.entries(d.eod.accruals).map(([id, rows]) => [
          id,
          rows.map((x) => ({ day: x.day, closing: money(id, x.closing), exact: x.exact, rounded: money(id, x.rounded) })),
        ]),
      ),
      capitalized: d.eod.capitalized.map(entry),
      errors: d.eod.errors,
    },
    accounts: d.accounts.map((a) => ({
      id: a.id,
      currency: a.currency,
      closing: money(a.id, a.closing),
      openHolds: money(a.id, a.openHolds),
      available: money(a.id, a.available),
      feesToDate: money(a.id, a.feesToDate),
      accruedToDate: a.accruedToDate,
    })),
    holds: d.holds.map(hold),
    errors: d.errors,
    review: d.review.map(review),
  });

  const summary = (s: Summary): object => ({
    days: s.days.map((row) => ({
      day: row.day,
      accounts: Object.fromEntries(
        Object.entries(row.perAccount).map(([id, v]) => [
          id,
          { final: money(id, v.final), asClosed: money(id, v.asClosed), fee: money(id, v.fee), accrual: money(id, v.accrual) },
        ]),
      ),
      authorizations: row.authorizations,
    })),
    accounts: s.accounts.map((a) => ({
      id: a.id,
      currency: a.currency,
      final: money(a.id, a.final),
      fees: a.fees.map(entry),
      interest: money(a.id, a.interest),
    })),
    review: s.review.map(review),
  });

  const used = [...new Set(currencies.values())];
  const doc = {
    title: 'ledger-replay',
    units: Object.fromEntries(used.map((c) => [c, { minorUnit: 'fils', perMajor: CURRENCIES[c].perMajor }])),
    days: result.days.map(day),
    summary: summary(result.summary),
    entries: result.ledger.entries.all().map(entry),
    holds: result.ledger.holds.all().map(hold),
  };
  return JSON.stringify(doc, null, 2);
}
