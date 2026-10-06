import { describe, expect, test } from 'bun:test';
import { replay } from '../src/replay.ts';
import { ACCOUNTS, STREAM } from '../src/stream.ts';
import { colorsWanted, paint } from '../src/render/colors.ts';
import { renderSummary, table } from '../src/render/table.ts';
import { amount, renderAll, renderDay, renderHeader } from '../src/render/text.ts';
import { toJson } from '../src/render/json.ts';
import { minor } from '../src/money.ts';

const result = replay(ACCOUNTS, STREAM);
const plain = paint(false);

function day(n: number) {
  const d = result.days.find((x) => x.day === n);
  if (d === undefined) throw new Error(`no report for day ${n.toString()}`);
  return d;
}

const EXPECTED_SUMMARY = [
  'summary  closing ledger by value date · final vs as closed that day · minor units',
  '',
  ' day │ ACC-001 final │ as closed │   fee │ accrual │ ACC-002 final │ accrual │ authorizations',
  '─────┼───────────────┼───────────┼───────┼─────────┼───────────────┼─────────┼──────────────────────────────────',
  '   1 │        25,000 │    25,000 │     – │      10 │             – │       – │ –',
  '   2 │        22,500 │    25,000 │ 2,500 │       9 │             – │       – │ Auth-A approved',
  '   3 │        62,500 │    65,000 │     – │      25 │             – │       – │ –',
  '   4 │        41,500 │    46,500 │ 2,500 │      17 │             – │       – │ Auth-A settled · Auth-Z rejected',
  '   5 │        39,000 │   −23,000 │ 2,500 │      16 │        10,000 │       4 │ Auth-B declined',
  '   6 │        39,093 │    39,093 │     – │      16 │        10,008 │       4 │ –',
  '─────┼───────────────┼───────────┼───────┼─────────┼───────────────┼─────────┼──────────────────────────────────',
  ' tot │               │           │ 7,500 │      93 │               │       8 │',
  '',
  'final   ACC-001  39,093 AED fils  AED 390.93        ACC-002  10,008 BHD fils  BHD 10.008',
  'fees    3 × 2,500 AED fils on Days 2, 4, 5',
  'review  fees on Days 2, 4, 5 were charged before E9 reversed E7; those days ended positive after the reversal; refund is a human decision',
].join('\n');

describe('summary table', () => {
  test('matches the agreed figures line for line', () => {
    expect(renderSummary(result.summary, plain)).toBe(EXPECTED_SUMMARY);
  });
});

describe('day blocks', () => {
  test('Day 5 shows the back-dated debit, the declined hold, the fees and the moved Day 4', () => {
    const text = renderDay(day(5), plain);
    expect(text).toContain('━━ Day 5 ━━');
    expect(text).toContain('← back-dated');
    expect(text).toContain('DECLINED  available −15,500 before hold');
    expect(text).toContain('3 × AED 25.00');
    expect(text).toContain('Day 4  46,500 → −15,500');
    expect(text).toContain('+3,333  +3,333  +3,334  = 10,000 in 3 instalments');
  });

  test('the running interest shows the exact dailies, which add up to the accrued figure', () => {
    const four = renderDay(day(4), plain);
    expect(four).toContain('D1 10  D2 10  D3 26  D4 18.6');
    expect(four).toContain('accrued 64.6');
    const five = renderDay(day(5), plain);
    expect(five).toContain('D3 0.2');
    expect(five).toContain('accrued 10.2');
  });

  test('the rule line is 78 characters wide', () => {
    const first = renderDay(day(1), plain).split('\n')[0] ?? '';
    expect(first.length).toBe(78);
  });

  test('Day 4 shows the accepted settlement and the rejected one', () => {
    const text = renderDay(day(4), plain);
    expect(text).toContain('hold 20,000 → 0, 1,500 released   ACCEPTED');
    expect(text).toContain('REJECTED');
    expect(text).toContain('Auth-A settled');
  });

  test('Day 6 shows the interest sum, the credit and the fees left for review', () => {
    const text = renderDay(day(6), plain);
    expect(text).toContain('10 + 9 + 25 + 17 + 16 + 16 = 93');
    expect(text).toContain('ACC-001 +93');
    expect(text).toContain('ACC-002 +8');
    expect(text).toContain('fees on Days 2, 4, 5 remain');
    expect(text).toContain('for review');
    expect(text).toContain('fees total 7,500');
  });

  test('the whole report has every day and the summary', () => {
    const text = renderAll(result, plain);
    for (let d = 1; d <= 6; d++) expect(text).toContain(`Day ${d.toString()}`);
    expect(text).toContain('summary  closing ledger by value date');
    expect(text).not.toContain('\u001b[');
  });

  test('the header names the days, the accounts and the units', () => {
    expect(renderHeader(ACCOUNTS, plain)).toBe(
      'ledger-replay  ·  6 days  ·  2 accounts  ·  minor units: AED fils (÷100), BHD fils (÷1,000)',
    );
  });
});

describe('amounts', () => {
  test('use a real minus sign and commas', () => {
    expect(amount(minor(-18500))).toBe('−18,500');
    expect(amount(minor(1234567))).toBe('1,234,567');
    expect(amount(minor(0))).toBe('0');
  });
});

describe('JSON', () => {
  const doc = JSON.parse(toJson(result));

  test('has six days and the fees of Day 5 in whole fils', () => {
    expect(doc.days.length).toBe(6);
    expect(doc.days[4].eod.fees.length).toBe(3);
    for (const fee of doc.days[4].eod.fees) {
      expect(fee.amount.minor).toBe(-2500);
      expect(fee.amount.text).toBe('AED -25.00');
    }
  });

  test('gives the final balance as fils and as text', () => {
    expect(doc.summary.accounts[0].final.minor).toBe(39093);
    expect(doc.summary.accounts[0].final.text).toBe('AED 390.93');
    expect(doc.summary.accounts[1].final.text).toBe('BHD 10.008');
  });

  test('keeps the event fields in order and has no color codes', () => {
    const text = toJson(result);
    expect(text).not.toContain('\u001b[');
    expect(Object.keys(doc.days[4].events[0])).toEqual([
      'id', 'type', 'account', 'amount', 'valueDay', 'bookedDay', 'backdated', 'ok', 'note', 'entries',
    ]);
    expect(doc.days[3].events[1].ok).toBe(false);
    expect(typeof doc.days[3].events[1].error).toBe('string');
  });

  test('gives the declined hold its available balance before, as fils and as text', () => {
    const e8 = doc.days[4].events.find((e: { id: string }) => e.id === 'E8');
    expect(e8.availableBefore).toEqual({ minor: -15500, text: 'AED -155.00' });
  });

  test('lists each fee left for review with its facts, not only a sentence', () => {
    const review = doc.summary.review;
    expect(review.map((r: { feeDay: number }) => r.feeDay)).toEqual([2, 4, 5]);
    expect(review[0]).toMatchObject({
      account: 'ACC-001',
      fee: { minor: 2500, text: 'AED 25.00' },
      reverser: 'E9',
      reversed: 'E7',
      closingNow: { minor: 22500, text: 'AED 225.00' },
    });
    expect(doc.days[5].review).toEqual(review);
  });
});

describe('table', () => {
  test('pads right-aligned cells on the left and left-aligned cells on the right', () => {
    const out = table(
      [
        { header: 'name', align: 'left' },
        { header: 'count', align: 'right' },
      ],
      [['a', '5']],
      { footer: ['tot', '5'] },
    );
    expect(out.split('\n')).toEqual([' name │ count', '──────┼───────', ' a    │     5', '──────┼───────', ' tot  │     5']);
  });
});

describe('colors', () => {
  test('paint adds escape codes only when it is on', () => {
    expect(paint(true).day(2)('x')).toContain('\u001b[');
    expect(paint(false).day(2)('x')).toBe('x');
    expect(paint(true).day(1)('x')).not.toBe(paint(true).day(2)('x'));
  });

  test('colors are off with --no-color, with NO_COLOR set, and outside a terminal', () => {
    expect(colorsWanted(['--no-color'], {}, true)).toBe(false);
    expect(colorsWanted([], { NO_COLOR: '1' }, true)).toBe(false);
    expect(colorsWanted([], {}, false)).toBe(false);
    expect(colorsWanted([], {}, true)).toBe(true);
  });
});
