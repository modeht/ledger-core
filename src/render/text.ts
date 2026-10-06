// The text report: a header line, one block per day, then the summary table.
// Every figure comes from the replay result; this file only lays it out.

import { WINDOW } from '../constants.ts';
import type { AccountSpec } from '../events.ts';
import { CURRENCIES, minor } from '../money.ts';
import type { Currency, Minor } from '../money.ts';
import type { AccountSnapshot, DayReport, EventOutcome, FeeReview, ReplayResult } from '../replay.ts';
import type { Paint } from './colors.ts';
import { amount, dayList, formatUnits, groupReview, renderSummary } from './table.ts';

export { amount } from './table.ts';

const RULE_WIDTH = 78;
const EVENT_LABEL = 15; // 'end of day' labels such as 're-evaluated'
const FOOT_LABEL = 17; // 'authorizations' and 'errors'

/** 'ledger-replay  ·  6 days  ·  2 accounts  ·  minor units: AED fils (÷100), BHD fils (÷1,000)'. */
export function renderHeader(accounts: readonly AccountSpec[], p: Paint): string {
  const days = WINDOW.last - WINDOW.first + 1;
  const currencies: Currency[] = [];
  for (const a of accounts) if (!currencies.includes(a.currency)) currencies.push(a.currency);
  const units = currencies.map((c) => `${c} fils (÷${amount(minor(CURRENCIES[c].perMajor))})`).join(', ');
  const count = (n: number, word: string): string => `${n.toString()} ${word}${n === 1 ? '' : 's'}`;
  return [p.bold('ledger-replay'), count(days, 'day'), count(accounts.length, 'account'), `minor units: ${units}`].join('  ·  ');
}

/** One day block: the events, the end-of-day run, the accounts, authorizations and errors. */
export function renderDay(report: DayReport, p: Paint): string {
  const day = report.day;
  const head = `━━ Day ${day.toString()} `;
  const out: string[] = [p.day(day)(head + '━'.repeat(Math.max(0, RULE_WIDTH - head.length)))];
  const currencyOf = (id: string): Currency => report.accounts.find((a) => a.id === id)?.currency ?? 'AED';

  out.push(p.bold('events'));
  if (report.events.length === 0) out.push('  none');
  for (const o of report.events) out.push(eventLine(o, p));

  out.push(p.bold('end of day'));
  const label = (name: string): string => `  ${name.padEnd(EVENT_LABEL)}`;

  // Re-evaluated: earlier days whose closing moved since the last run.
  const re = report.eod.reevaluated;
  if (re.length > 0) {
    const many = new Set(re.map((r) => r.account)).size > 1;
    const parts = re.map(
      (r) => (many ? `${r.account} ` : '') + p.day(r.day)(`Day ${r.day.toString()}  ${amount(r.before)} → ${amount(r.after)}`),
    );
    out.push(label('re-evaluated') + parts.join('    '));
  }

  // Fees booked by this run, per account.
  const fees = report.eod.fees;
  if (fees.length === 0) {
    out.push(label('fees') + 'none');
  } else {
    const accounts = [...new Set(fees.map((f) => f.account))];
    const parts = accounts.map((id) => {
      const own = fees.filter((f) => f.account === id);
      const days = own.map((f) => `Day ${f.valueDay.toString()}  ${amount(f.amount)}`).join('    ');
      const sizes = own.map((f) => minor(-f.amount));
      const first = sizes[0] ?? minor(0);
      const c = currencyOf(id);
      const what = sizes.every((s) => s === first)
        ? `${sizes.length.toString()} × ${formatUnits(c, first)}`
        : formatUnits(c, minor(sizes.reduce((s, x) => s + x, 0)));
      return `${accounts.length > 1 ? `${id}  ` : ''}${days}    ${what}, booked today`;
    });
    out.push(label('fees') + p.fee(parts.join('    ')));
  }
  for (const line of reviewLines(report.review)) out.push(' '.repeat(EVENT_LABEL + 2) + p.warn(line));

  // Interest: the running dailies (exact), or on the last day the rounded sum that was credited.
  const last = day === WINDOW.last;
  const interest: string[] = [];
  for (const [id, rows] of Object.entries(report.eod.accruals)) {
    // An account is left out until the first day it closes with anything in it.
    const start = rows.findIndex((r) => r.closing !== 0);
    if (start < 0) continue;
    const shown = rows.slice(start);
    if (last) {
      const total = shown.reduce((s, r) => s + r.rounded, 0);
      interest.push(`${id}  ${shown.map((r) => amount(r.rounded)).join(' + ')} = ${amount(minor(total))}`);
    } else {
      // The running dailies are the exact figures, so they add up to the 'accrued' shown below.
      interest.push(`${id}  ${shown.map((r) => `D${r.day.toString()} ${r.exact}`).join('  ')}`);
    }
  }
  out.push(label('interest') + (interest.length === 0 ? 'none' : p.interest(interest.join('    '))));

  const cap = report.eod.capitalized;
  if (cap.length > 0) {
    const parts = cap.map((e) => `${e.account} +${amount(e.amount)}`).join('   ');
    const value = cap[0]?.valueDay ?? day;
    out.push(label('capitalized') + p.interest(`${parts}   value Day ${value.toString()}`));
  }

  out.push(p.bold('accounts'));
  out.push(...accountLines(report.accounts, last));

  const holds = report.holds.map((h) => `${h.authId} ${h.state.toLowerCase()}`);
  out.push(`${'authorizations'.padEnd(FOOT_LABEL)}${holds.length === 0 ? 'none' : holds.join('   ')}`);

  if (report.errors.length === 0) {
    out.push(`${'errors'.padEnd(FOOT_LABEL)}none`);
  } else {
    report.errors.forEach((err, i) => {
      out.push(`${(i === 0 ? 'errors' : '').padEnd(FOOT_LABEL)}${p.error(err)}`);
    });
  }
  return out.join('\n');
}

/** The header, every day block and the summary table, with a blank line between each. */
export function renderAll(result: ReplayResult, p: Paint): string {
  return [renderHeader(result.ledger.accounts(), p), ...result.days.map((d) => renderDay(d, p)), renderSummary(result.summary, p)].join(
    '\n\n',
  );
}

// One line per event: id, type, account, then what happened to it.
function eventLine(o: EventOutcome, p: Paint): string {
  const e = o.event;
  const start = `  ${e.id.padEnd(4)} ${e.type.padEnd(13)}  ${e.account}   `;
  const paintAmount = o.backdated ? p.day(e.valueDay) : null;
  const money = (text: string, base: (s: string) => string): string => (paintAmount ?? base)(text);
  const backdated = o.backdated ? `   value Day ${e.valueDay.toString()}  ← back-dated` : '';
  const rejected = (body: string): string => {
    const error = o.result.ok ? '' : o.result.error;
    return `${start}${body}   ${p.error(`REJECTED  ${error}`)}`;
  };

  switch (e.type) {
    case 'CREDIT': {
      if (!o.result.ok) return rejected(`+${amount(e.amount)}`);
      const parts = o.result.entries.map((x) => x.amount);
      const body =
        parts.length > 1
          ? `${parts.map((x) => `+${amount(x)}`).join('  ')}  = ${amount(e.amount)} in ${parts.length.toString()} instalments`
          : `+${amount(e.amount)}`;
      return `${start}${money(body, p.credit)}${backdated}`;
    }
    case 'DEBIT': {
      const body = money(amount(minor(-e.amount)), p.debit);
      return o.result.ok ? `${start}${body}${backdated}` : rejected(body);
    }
    case 'AUTHORIZATION': {
      const body = `hold ${amount(e.amount)}`;
      if (!o.result.ok) return rejected(body);
      if (o.result.hold?.state === 'DECLINED') {
        const why = o.availableBefore === undefined ? '' : `  available ${amount(o.availableBefore)} before hold`;
        return `${start}${body}   ${p.warn(`DECLINED${why}`)}${backdated}`;
      }
      return `${start}${body}   ${p.ok('APPROVED')}${backdated}`;
    }
    case 'SETTLEMENT': {
      if (!o.result.ok) return rejected(`${e.authId}   ${amount(e.amount)}`);
      const h = o.result.hold;
      let hold = '';
      if (h !== undefined) {
        const released = minor(h.amount - (h.settledAmount ?? e.amount));
        hold = `   hold ${amount(h.amount)} → 0${released > 0 ? `, ${amount(released)} released` : ''}`;
      }
      return `${start}${e.authId}   ${money(amount(minor(-e.amount)), p.debit)}${hold}   ${p.ok('ACCEPTED')}${backdated}`;
    }
    case 'REVERSAL': {
      if (!o.result.ok) return rejected(`reverses ${e.reverses}`);
      const total = minor(o.result.entries.reduce((s, x) => s + x.amount, 0));
      const sign = total >= 0 ? '+' : '';
      const body = money(`${sign}${amount(total)}`, total >= 0 ? p.credit : p.debit);
      return `${start}${body}${backdated}  reverses ${e.reverses}`;
    }
  }
}

// The fee review, one short line per reversal, under the fees line.
function reviewLines(review: readonly FeeReview[]): string[] {
  return groupReview(review).map((g) => {
    const now = g.allPositive ? 'those days are positive' : 'some of those days are still negative';
    return `⚠ fees on ${dayList(g.days)} remain; ${now} after ${g.reverser} — for review`;
  });
}

// One line per account, with the columns lined up. An account that has held
// nothing yet is left out, except on the last day, which shows every account.
function accountLines(accounts: readonly AccountSnapshot[], last: boolean): string[] {
  const shown = accounts.filter(
    (a) => last || a.closing !== 0 || a.openHolds !== 0 || a.feesToDate !== 0 || a.accruedToDate !== '0',
  );
  const closing = shown.map((a) => amount(a.closing));
  const units = shown.map((a) => formatUnits(a.currency, a.closing));
  const holds = shown.map((a) => amount(a.openHolds));
  const available = shown.map((a) => amount(a.available));
  const width = (xs: string[]): number => Math.max(0, ...xs.map((x) => x.length));
  const [wc, wu, wh, wa] = [width(closing), width(units), width(holds), width(available)];
  return shown.map((a, i) => {
    const tail = last ? `fees total ${amount(a.feesToDate)}` : `accrued ${a.accruedToDate}`;
    return (
      `  ${a.id}  ${a.currency}  closing ${(closing[i] ?? '').padEnd(wc)}  ${(units[i] ?? '').padEnd(wu)}   ` +
      `holds ${(holds[i] ?? '').padEnd(wh)}   available ${(available[i] ?? '').padEnd(wa)}   ${tail}`
    );
  });
}
