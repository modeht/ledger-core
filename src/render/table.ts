// The summary table, and the small text helpers the other renderers share.

import { formatMajor, minor } from '../money.ts';
import type { Currency, Minor } from '../money.ts';
import type { FeeReview, Summary } from '../replay.ts';
import type { Paint } from './colors.ts';

export type Column = { header: string; align: 'left' | 'right' };

const MINUS = '−';
const DASH = '–';

/** '−18,500': a real minus sign and a comma every three digits, with no unit. */
export function amount(a: Minor): string {
  const digits = (a < 0 ? -a : a).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return a < 0 ? `${MINUS}${digits}` : digits;
}

/** '39,093 AED fils'. */
export function fils(c: Currency, a: Minor): string {
  return `${amount(a)} ${c} fils`;
}

/** 'Day 2' or 'Days 2, 4, 5'. */
export function dayList(days: readonly number[]): string {
  return `${days.length === 1 ? 'Day' : 'Days'} ${days.join(', ')}`;
}

// The fees one reversal did not take back, gathered per reversal.
export type FeeReviewGroup = { reverser: string; reversed: string; days: number[]; allPositive: boolean };

/** Groups the review entries per reversal, keeping the order they came in. */
export function groupReview(review: readonly FeeReview[]): FeeReviewGroup[] {
  const groups: FeeReviewGroup[] = [];
  for (const r of review) {
    let group = groups.find((g) => g.reverser === r.reverser && g.reversed === r.reversed);
    if (group === undefined) {
      group = { reverser: r.reverser, reversed: r.reversed, days: [], allPositive: true };
      groups.push(group);
    }
    group.days.push(r.feeDay);
    if (r.closingNow <= 0) group.allPositive = false;
  }
  return groups;
}

/**
 * Lays rows out under their headers. Every cell is measured and padded;
 * a right-aligned column pads on the left. Cells are joined with ' │ ',
 * with a '─┼─' rule under the header and above the footer.
 */
export function table(columns: Column[], rows: string[][], opts?: { footer?: string[] }): string {
  const all = opts?.footer === undefined ? rows : [...rows, opts.footer];
  const widths = columns.map((c, i) => Math.max(c.header.length, ...all.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]): string => {
    const padded = columns.map((c, i) => {
      const cell = cells[i] ?? '';
      const w = widths[i] ?? 0;
      return c.align === 'right' ? cell.padStart(w) : cell.padEnd(w);
    });
    return ` ${padded.join(' │ ')} `.trimEnd();
  };
  const rule = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const out = [line(columns.map((c) => c.header)), rule, ...rows.map(line)];
  if (opts?.footer !== undefined) {
    out.push(rule, line(opts.footer));
  }
  return out.join('\n');
}

type Pick = (v: { final: Minor; asClosed: Minor; fee: Minor; accrual: Minor }) => Minor;

/** The summary: one row per day, then the end-of-window totals and the review line. */
export function renderSummary(summary: Summary, p: Paint): string {
  const columns: Column[] = [{ header: 'day', align: 'right' }];
  // One function per column after 'day', giving that column's cell for a day row.
  const cells: ((row: Summary['days'][number], touched: (id: string) => boolean) => string)[] = [];
  const footer: string[] = ['tot'];

  summary.accounts.forEach((acc, index) => {
    const values = summary.days.map((d) => d.perAccount[acc.id]);
    const get = (row: Summary['days'][number], pick: Pick): Minor | undefined => {
      const v = row.perAccount[acc.id];
      return v === undefined ? undefined : pick(v);
    };
    const add = (header: string, pick: Pick, total: boolean, dashWhenZero: boolean): void => {
      columns.push({ header, align: 'right' });
      cells.push((row, touched) => {
        const v = get(row, pick);
        if (v === undefined || !touched(acc.id) || (dashWhenZero && v === 0)) return DASH;
        return amount(v);
      });
      let sum = 0;
      for (const v of values) if (v !== undefined) sum += pick(v);
      footer.push(total ? amount(minor(sum)) : '');
    };

    add(`${acc.id} final`, (v) => v.final, false, false);
    // The first account always shows how each day closed at the time.
    // Another account shows it only when it differs from the final figure somewhere.
    if (index === 0 || values.some((v) => v !== undefined && v.asClosed !== v.final)) {
      add('as closed', (v) => v.asClosed, false, false);
    }
    if (values.some((v) => v !== undefined && v.fee !== 0)) {
      add('fee', (v) => v.fee, true, true);
    }
    add('accrual', (v) => v.accrual, true, false);
  });
  columns.push({ header: 'authorizations', align: 'left' });
  footer.push('');

  // An account is shown with dashes until the first day it holds anything.
  const touchedSince = new Map<string, number>();
  for (const row of summary.days) {
    for (const acc of summary.accounts) {
      const v = row.perAccount[acc.id];
      if (touchedSince.has(acc.id) || v === undefined) continue;
      if (v.final !== 0 || v.asClosed !== 0 || v.fee !== 0 || v.accrual !== 0) touchedSince.set(acc.id, row.day);
    }
  }

  const rows = summary.days.map((row) => {
    const touched = (id: string): boolean => {
      const since = touchedSince.get(id);
      return since !== undefined && row.day >= since;
    };
    const auth = row.authorizations.length === 0 ? DASH : row.authorizations.join(' · ');
    return [row.day.toString(), ...cells.map((c) => c(row, touched)), auth];
  });

  const finals = summary.accounts
    .map((a) => `${a.id}  ${fils(a.currency, a.final)}  ${formatUnits(a.currency, a.final)}`)
    .join('        ');

  const feeParts = summary.accounts
    .filter((a) => a.fees.length > 0)
    .map((a) => {
      const sizes = a.fees.map((f) => minor(-f.amount));
      const first = sizes[0] ?? minor(0);
      const days = dayList(a.fees.map((f) => f.valueDay));
      const prefix = summary.accounts.length > 1 && summary.accounts.filter((x) => x.fees.length > 0).length > 1 ? `${a.id}  ` : '';
      if (sizes.every((s) => s === first)) {
        return `${prefix}${sizes.length.toString()} × ${fils(a.currency, first)} on ${days}`;
      }
      const total = minor(sizes.reduce((s, x) => s + x, 0));
      return `${prefix}${sizes.length.toString()} fees, ${fils(a.currency, total)} in all, on ${days}`;
    });

  const reviewLines = reviewSentences(summary.review);

  const out = [
    p.bold('summary') + '  closing ledger by value date · final vs as closed that day · minor units',
    '',
    table(columns, rows, { footer }),
    '',
    `final   ${finals}`,
    `fees    ${feeParts.length === 0 ? 'none' : p.fee(feeParts.join('    '))}`,
    ...reviewLines.map((l, i) => `${i === 0 ? 'review  ' : '        '}${p.warn(l)}`),
  ];
  if (reviewLines.length === 0) out.push('review  none');
  return out.join('\n');
}

// One sentence per reversal that left fees behind.
function reviewSentences(review: readonly FeeReview[]): string[] {
  return groupReview(review).map((g) => {
    const state = g.allPositive ? 'those days ended positive' : 'some of those days are still negative';
    return `fees on ${dayList(g.days)} were charged before ${g.reverser} reversed ${g.reversed}; ${state} after the reversal; refund is a human decision`;
  });
}

// 'AED 390.93', and 'AED −230.00' with a real minus sign.
export function formatUnits(c: Currency, a: Minor): string {
  return formatMajor(c, a).replace('-', MINUS);
}
