import { describe, expect, test } from 'bun:test';
import { ACCOUNTS, STREAM } from '../src/stream.ts';
import { buildSteps, renderStep, runUntil, stepMode } from '../src/step.ts';
import type { Step } from '../src/step.ts';
import { paint } from '../src/render/colors.ts';
import { minor } from '../src/money.ts';

const steps = buildSteps(STREAM);

function indexOfEvent(id: string): number {
  const s = steps.find((x) => x.kind === 'event' && x.event.id === id);
  if (s === undefined) throw new Error(`no step for ${id}`);
  return s.index;
}

function indexOfStage(day: number, name: string): number {
  const s = steps.find((x) => x.kind === 'stage' && x.day === day && x.name === name);
  if (s === undefined) throw new Error(`no ${name} stage on day ${day.toString()}`);
  return s.index;
}

function label(s: Step): string {
  return s.kind === 'event' ? s.event.id : s.name;
}

describe('the list of steps', () => {
  test('has ten events and six stages for each of the six days', () => {
    expect(steps).toHaveLength(46);
    expect(steps.map((s) => s.index)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
  });

  test('starts with E1, then E2, then the Day 1 cutoff', () => {
    expect(label(steps[0]!)).toBe('E1');
    expect(label(steps[1]!)).toBe('E2');
    const third = steps[2]!;
    expect(third.kind).toBe('stage');
    expect(third.day).toBe(1);
    expect(third.kind === 'stage' && third.stage).toBe(1);
    expect(label(third)).toBe('cutoff');
  });

  test('puts E7 at step 31: Day 1 has 8 steps, Days 2 and 3 have 7, Day 4 has 8', () => {
    expect(indexOfEvent('E7')).toBe(31);
  });

  test('Day 5 is E7, E8, E10 and then the six stages in order', () => {
    const day5 = steps.filter((s) => s.day === 5).map(label);
    expect(day5).toEqual(['E7', 'E8', 'E10', 'cutoff', 'reevaluate', 'fees', 'interest', 'capitalize', 'report']);
  });
});

describe('running up to one step', () => {
  test('E7 takes ACC-001 from 46,500 to -15,500 and makes Day 2 negative', () => {
    const { view } = runUntil(ACCOUNTS, steps, indexOfEvent('E7'));
    expect(view.before['ACC-001']?.ledger).toBe(minor(46_500));
    expect(view.after['ACC-001']?.ledger).toBe(minor(-15_500));
    expect(view.valueDated).toContainEqual({ account: 'ACC-001', day: 2, before: minor(25_000), after: minor(-37_000), willBeFeeChecked: true });
    expect(view.appended).toHaveLength(1);
    expect(view.appended[0]?.amount).toBe(minor(-62_000));
    expect(view.ok).toBe(true);
  });

  test('the Day 5 fees stage books three fees and lists Days 1 to 5', () => {
    const { view } = runUntil(ACCOUNTS, steps, indexOfStage(5, 'fees'));
    expect(view.appended.map((e) => e.kind)).toEqual(['FEE', 'FEE', 'FEE']);
    expect(view.appended.map((e) => e.valueDay)).toEqual([2, 4, 5]);
    const pass = view.feePass ?? [];
    expect(pass).toHaveLength(5);
    const withFee = pass.filter((l) => l.outcome.includes('fee −2,500')).map((l) => l.day);
    expect(withFee).toEqual([2, 4, 5]);
    expect(pass.find((l) => l.day === 1)?.outcome).toBe('positive');
  });

  test('the Day 6 capitalize stage pays 93 to ACC-001 and 8 to ACC-002', () => {
    const { view } = runUntil(ACCOUNTS, steps, indexOfStage(6, 'capitalize'));
    expect(view.appended.map((e) => [e.kind, e.account, e.amount])).toEqual([
      ['INTEREST', 'ACC-001', minor(93)],
      ['INTEREST', 'ACC-002', minor(8)],
    ]);
  });

  test('the last step leaves ACC-001 at 39,093 and ACC-002 at 10,008', () => {
    const { ledger } = runUntil(ACCOUNTS, steps, 46);
    expect(ledger.closingBalance('ACC-001', 6)).toBe(minor(39_093));
    expect(ledger.closingBalance('ACC-002', 6)).toBe(minor(10_008));
  });

  test('E6 is rejected and its step says so', () => {
    const { view } = runUntil(ACCOUNTS, steps, indexOfEvent('E6'));
    expect(view.ok).toBe(false);
    expect(view.appended).toHaveLength(0);
    expect(view.note).toContain('Auth-Z');
  });

  test('a step number outside the list is an error', () => {
    expect(() => runUntil(ACCOUNTS, steps, 0)).toThrow();
    expect(() => runUntil(ACCOUNTS, steps, 47)).toThrow();
  });
});

describe('one screen of the step mode', () => {
  test('the E7 screen shows it is back-dated and which days will be fee-checked', () => {
    const text = renderStep(runUntil(ACCOUNTS, steps, indexOfEvent('E7')).view, paint(false));
    expect(text).toContain('step 31 of 46');
    expect(text).toContain('← back-dated');
    expect(text).toContain('will be fee-checked');
    expect(text).toContain('entries appended');
    expect(text).toContain('[E7]');
    expect(text).toContain('┃ = end-of-day run (6 stages each)');
  });

  test('the fees screen shows the fee pass and the stage number', () => {
    const text = renderStep(runUntil(ACCOUNTS, steps, indexOfStage(5, 'fees')).view, paint(false));
    expect(text).toContain('stage 3 of 6: fees');
    expect(text).toContain('fee pass');
    expect(text).toContain('[┃ 3/6]');
  });

  test('with colors off there are no escape codes', () => {
    const text = renderStep(runUntil(ACCOUNTS, steps, 1).view, paint(false));
    expect(text).not.toContain('\u001b[');
  });
});

describe('the step mode loop', () => {
  test('outside a terminal it writes all 46 steps and stops', async () => {
    const out: string[] = [];
    await stepMode(ACCOUNTS, STREAM, { write: (s) => out.push(s), readKey: () => Promise.reject(new Error('no keys')), isTTY: false }, paint(false));
    expect(out).toHaveLength(46);
    expect(out[45]).toContain('step 46 of 46');
  });

  test('in a terminal it follows the keys: next, back, a day jump, then quit', async () => {
    const keys = ['\r', 'n', 'b', 'd', '5', 'q'];
    const out: string[] = [];
    const io = { write: (s: string) => out.push(s), readKey: () => Promise.resolve(keys.shift() ?? 'q'), isTTY: true };
    await stepMode(ACCOUNTS, STREAM, io, paint(false));
    const headers = out.filter((s) => s.startsWith('ledger-replay --step')).map((s) => /step (\d+) of/.exec(s)?.[1]);
    expect(headers).toEqual(['1', '2', '3', '2', '31']);
  });

  test('at the last step, next prints done', async () => {
    const keys = ['d', '6', ...Array.from({ length: 7 }, () => 'n')];
    const out: string[] = [];
    const io = { write: (s: string) => out.push(s), readKey: () => Promise.resolve(keys.shift() ?? 'q'), isTTY: true };
    await stepMode(ACCOUNTS, STREAM, io, paint(false));
    expect(out.at(-1)).toBe('done\n');
  });

  test('the j key prints the screen as JSON with every amount as minor and text', async () => {
    const keys = ['d', '5', 'j', 'q'];
    const out: string[] = [];
    const io = { write: (s: string) => out.push(s), readKey: () => Promise.resolve(keys.shift() ?? 'q'), isTTY: true };
    await stepMode(ACCOUNTS, STREAM, io, paint(false));
    const json = out.find((s) => s.startsWith('\n{'));
    expect(json).toBeDefined();
    const doc = JSON.parse(json ?? '{}');
    expect(doc.step.event.id).toBe('E7');
    expect(doc.step.event.amount).toEqual({ minor: 62000, text: 'AED 620.00' });
    expect(doc.after['ACC-001'].ledger).toEqual({ minor: -15500, text: 'AED -155.00' });
    expect(doc.before['ACC-001'].ledger).toEqual({ minor: 46500, text: 'AED 465.00' });
    expect(doc.valueDated[0].after.minor).toBe(-37000);
    expect(doc.appended[0].amount).toEqual({ minor: -62000, text: 'AED -620.00' });
  });
});
