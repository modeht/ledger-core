// The step mode. It walks the replay one event or one end-of-day stage at a time.
// Each screen is worked out again from a fresh ledger, so going back a step is
// just running one step fewer. The pure parts come first so tests can call them.

import { OVERDRAFT_FEE, WINDOW } from './constants.ts';
import type { Entry } from './entries.ts';
import type { AccountId, AccountSpec, Day, LedgerEvent } from './events.ts';
import { Ledger } from './ledger.ts';
import { accrueInterest, assessFees, capitalize, cutoff, reevaluate, report } from './eod.ts';
import type { EodResult } from './eod.ts';
import { minor } from './money.ts';
import type { Minor } from './money.ts';
import { groupByDay } from './replay.ts';
import type { Paint } from './render/colors.ts';
import { stepToJson } from './render/json.ts';
import { amount } from './render/text.ts';

export type StageName = 'cutoff' | 'reevaluate' | 'fees' | 'interest' | 'capitalize' | 'report';

export type Step =
  | { index: number; day: Day; kind: 'event'; event: LedgerEvent }
  | { index: number; day: Day; kind: 'stage'; stage: 1 | 2 | 3 | 4 | 5 | 6; name: StageName };

const STAGES: readonly { stage: 1 | 2 | 3 | 4 | 5 | 6; name: StageName; label: string }[] = [
  { stage: 1, name: 'cutoff', label: 'cutoff' },
  { stage: 2, name: 'reevaluate', label: 're-evaluate past days' },
  { stage: 3, name: 'fees', label: 'fees' },
  { stage: 4, name: 'interest', label: 'interest recompute' },
  { stage: 5, name: 'capitalize', label: 'capitalize' },
  { stage: 6, name: 'report', label: 'report' },
];

export type Balances = { ledger: Minor; holds: Minor; available: Minor };

export type StepView = {
  step: Step;
  total: number;
  before: Record<AccountId, Balances>;
  after: Record<AccountId, Balances>;
  // Every day from Day 1 to the step's day whose closing changed in this step.
  valueDated: { account: AccountId; day: Day; before: Minor; after: Minor; willBeFeeChecked: boolean }[];
  appended: Entry[];
  // Only for the fees stage: one line per account and day, Day 1 to today.
  // The account is there because more than one account can be looked at.
  feePass?: { account: AccountId; day: Day; closing: Minor; outcome: string }[];
  note: string;
  ok: boolean; // false when the event was rejected
  // The whole run in short, for the strip at the bottom: each day's event ids.
  outline: { day: Day; events: string[] }[];
};

/** Per day: its events in the order they came, then the six end-of-day stages. Numbered from 1. */
export function buildSteps(events: readonly LedgerEvent[]): Step[] {
  const steps: Step[] = [];
  for (const [day, todays] of groupByDay(events)) {
    for (const event of todays) {
      steps.push({ index: steps.length + 1, day, kind: 'event', event });
    }
    for (const s of STAGES) {
      steps.push({ index: steps.length + 1, day, kind: 'stage', stage: s.stage, name: s.name });
    }
  }
  return steps;
}

// What the stages of one day have worked out so far. The report stage needs all of it,
// and capitalize needs the accruals from the interest stage.
type DayParts = Omit<EodResult, 'day'>;

function emptyParts(): DayParts {
  return { reevaluated: [], fees: [], accruals: {}, capitalized: [], errors: [] };
}

// Runs one step on the ledger and gives back the one-line result.
function runStep(ledger: Ledger, step: Step, parts: DayParts): { ok: boolean; note: string } {
  if (step.kind === 'event') {
    const r = ledger.apply(step.event, step.day);
    return r.ok ? { ok: true, note: r.note } : { ok: false, note: r.error };
  }
  return { ok: true, note: runStage(ledger, step, parts) };
}

function runStage(ledger: Ledger, step: Extract<Step, { kind: 'stage' }>, parts: DayParts): string {
  const d = step.day.toString();
  switch (step.name) {
    case 'cutoff':
      cutoff(ledger, step.day);
      return `Day ${d} is closed: no more events for it`;
    case 'reevaluate': {
      parts.reevaluated = reevaluate(ledger, step.day);
      if (parts.reevaluated.length === 0) return 'no earlier day changed since the last run';
      const list = parts.reevaluated.map((r) => `${r.account} Day ${r.day.toString()} ${amount(r.before)} → ${amount(r.after)}`);
      return `${parts.reevaluated.length.toString()} earlier day(s) changed: ${list.join(', ')}`;
    }
    case 'fees': {
      const { fees, errors } = assessFees(ledger, step.day);
      parts.fees = fees;
      parts.errors = errors;
      const head = fees.length === 0 ? 'no fee booked' : `${fees.length.toString()} fee(s) booked`;
      return errors.length === 0 ? head : `${head}; ${errors.join('; ')}`;
    }
    case 'interest': {
      parts.accruals = accrueInterest(ledger, step.day);
      const lines = ledger.accounts().map((a) => {
        const rows = parts.accruals[a.id] ?? [];
        const sum = rows.reduce((s, r) => s + r.rounded, 0);
        return `${a.id} dailies ${rows.map((r) => r.rounded.toString()).join(' + ')} = ${sum.toString()}`;
      });
      return `interest worked out again for days ${WINDOW.first.toString()} to ${d}, not booked: ${lines.join('; ')}`;
    }
    case 'capitalize':
      parts.capitalized = capitalize(ledger, step.day, parts.accruals);
      if (step.day !== WINDOW.last) return `nothing to pay: interest is paid only on Day ${WINDOW.last.toString()}`;
      if (parts.capitalized.length === 0) return 'no interest to pay';
      return parts.capitalized.map((e) => `${e.account} ${e.note ?? ''}`).join('; ');
    case 'report':
      report(ledger, step.day, parts);
      return `closing balances of days ${WINDOW.first.toString()} to ${d} stored for the next run`;
  }
}

function balances(ledger: Ledger, day: Day): Record<AccountId, Balances> {
  const out: Record<AccountId, Balances> = {};
  for (const a of ledger.accounts()) {
    out[a.id] = {
      ledger: ledger.closingBalance(a.id, day),
      holds: ledger.holds.activeTotal(a.id),
      available: ledger.available(a.id, day),
    };
  }
  return out;
}

function closings(ledger: Ledger, upTo: Day): Map<string, Minor> {
  const out = new Map<string, Minor>();
  for (const a of ledger.accounts()) {
    for (let d = WINDOW.first; d <= upTo; d++) {
      out.set(`${a.id}|${d.toString()}`, ledger.closingBalance(a.id, d));
    }
  }
  return out;
}

// One line per day, Day 1 to today, for each account that has a day below zero
// (or the first account when none has). The closing is the one the fee check used:
// the balance without that day's own fee.
function feePassLines(ledger: Ledger, day: Day, appended: Entry[]): NonNullable<StepView['feePass']> {
  const accounts = ledger.accounts();
  const negative = accounts.filter((a) => {
    for (let d = WINDOW.first; d <= day; d++) {
      if (ledger.closingBeforeOwnFee(a.id, d) < 0) return true;
    }
    return false;
  });
  const shown = negative.length > 0 ? negative : accounts.slice(0, 1);
  const out: NonNullable<StepView['feePass']> = [];
  for (const a of shown) {
    for (let d = WINDOW.first; d <= day; d++) {
      const closing = ledger.closingBeforeOwnFee(a.id, d);
      const newFee = appended.find((e) => e.account === a.id && e.kind === 'FEE' && e.valueDay === d);
      const earlierFee = appended.find((e) => e.account === a.id && e.kind === 'FEE' && e.valueDay < d);
      let outcome: string;
      if (closing >= 0) {
        outcome = earlierFee === undefined ? 'positive' : `positive   (includes the Day ${earlierFee.valueDay.toString()} fee)`;
      } else if (newFee !== undefined) {
        outcome = `negative, no fee yet   →   fee ${amount(newFee.amount)}   booked Day ${newFee.bookedDay.toString()}, value Day ${d.toString()}`;
      } else if (ledger.hasFee(a.id, d)) {
        outcome = 'negative, fee already booked';
      } else if (OVERDRAFT_FEE[a.currency] === undefined) {
        outcome = `negative, but ${a.currency} has no overdraft fee defined`;
      } else {
        outcome = 'negative, no fee booked';
      }
      out.push({ account: a.id, day: d, closing, outcome });
    }
  }
  return out;
}

/**
 * Starts a fresh ledger, runs steps 1 to k-1 without looking, then runs step k
 * and records what it changed.
 */
export function runUntil(accounts: AccountSpec[], steps: Step[], k: number): { ledger: Ledger; view: StepView } {
  const target = steps[k - 1];
  if (target === undefined) {
    throw new Error(`There is no step ${k.toString()}; the steps go from 1 to ${steps.length.toString()}.`);
  }
  const ledger = new Ledger(accounts);
  let parts = emptyParts();
  let partsDay: Day | undefined;
  const partsFor = (day: Day): DayParts => {
    if (partsDay !== day) {
      parts = emptyParts();
      partsDay = day;
    }
    return parts;
  };

  for (let i = 0; i < k - 1; i++) {
    const s = steps[i];
    if (s !== undefined) runStep(ledger, s, partsFor(s.day));
  }

  const day = target.day;
  const before = balances(ledger, day);
  const closingsBefore = closings(ledger, day);
  const count = ledger.entries.all().length;

  const { ok, note } = runStep(ledger, target, partsFor(day));

  const appended = ledger.entries.all().slice(count);
  const after = balances(ledger, day);
  const valueDated: StepView['valueDated'] = [];
  for (const a of ledger.accounts()) {
    for (let d = WINDOW.first; d <= day; d++) {
      const was = closingsBefore.get(`${a.id}|${d.toString()}`) ?? minor(0);
      const now = ledger.closingBalance(a.id, d);
      if (was !== now) {
        valueDated.push({ account: a.id, day: d, before: was, after: now, willBeFeeChecked: now < 0 && !ledger.hasFee(a.id, d) });
      }
    }
  }

  const outline: StepView['outline'] = [];
  for (const s of steps) {
    let row = outline.find((o) => o.day === s.day);
    if (row === undefined) {
      row = { day: s.day, events: [] };
      outline.push(row);
    }
    if (s.kind === 'event') row.events.push(s.event.id);
  }

  const view: StepView = { step: target, total: steps.length, before, after, valueDated, appended, note, ok, outline };
  if (target.kind === 'stage' && target.name === 'fees') {
    view.feePass = feePassLines(ledger, day, appended);
  }
  return { ledger, view };
}

// ---------------------------------------------------------------- rendering

const KEYS = '[enter] next   [b] back   [j] json   [d] day   [q] quit';

function stageLabel(name: StageName): string {
  return STAGES.find((s) => s.name === name)?.label ?? name;
}

function signed(a: Minor, p: Paint, text = amount(a)): string {
  return a < 0 ? p.debit(text) : text;
}

function eventLine(e: LedgerEvent, p: Paint): string {
  const parts: string[] = [p.bold(e.id.padEnd(4)), e.type, e.account];
  if (e.type === 'CREDIT') parts.push(p.credit(amount(e.amount)));
  if (e.type === 'DEBIT') parts.push(p.debit(amount(minor(-e.amount))));
  if (e.type === 'AUTHORIZATION' || e.type === 'SETTLEMENT') parts.push(e.authId, amount(e.amount));
  if (e.type === 'CREDIT' && e.instalments !== undefined) parts.push(`in ${e.instalments.toString()} instalments`);
  if (e.type === 'REVERSAL') parts.push(`reverses ${e.reverses}`);
  parts.push(`value Day ${e.valueDay.toString()}`);
  if (e.valueDay < e.bookedDay) parts.push(p.warn('← back-dated'));
  return parts.join('   ');
}

// The accounts worth a before/after block: the event's own account, or for a stage
// every account whose figures moved (none moved means none shown).
function shownAccounts(view: StepView): AccountId[] {
  const s = view.step;
  if (s.kind === 'event') return [s.event.account];
  return Object.keys(view.after).filter((id) => {
    const b = view.before[id];
    const a = view.after[id];
    return b === undefined || a === undefined || b.ledger !== a.ledger || b.holds !== a.holds || b.available !== a.available;
  });
}

function beforeAfter(view: StepView, p: Paint): string[] {
  const out: string[] = [];
  for (const id of shownAccounts(view)) {
    const b = view.before[id];
    const a = view.after[id];
    if (b === undefined || a === undefined) continue;
    out.push(`  ${p.bold(id.padEnd(14))}${'before'.padStart(9)}${''.padStart(4)}${'after'.padStart(10)}`);
    const row = (label: string, x: Minor, y: Minor): string => {
      const arrow = x === y ? '    ' : ' →  ';
      return `  ${label.padEnd(14)}${signed(x, p, amount(x).padStart(9))}${arrow}${signed(y, p, amount(y).padStart(10))}`;
    };
    out.push(row('ledger', b.ledger, a.ledger));
    out.push(row('holds', b.holds, a.holds));
    out.push(row('available', b.available, a.available));
    out.push('');
  }
  return out;
}

function valueDatedBlock(view: StepView, p: Paint): string[] {
  if (view.valueDated.length === 0) return [];
  const many = new Set(view.valueDated.map((v) => v.account)).size > 1;
  const out = ['  value-dated view, what the end of day will see'];
  for (const v of view.valueDated) {
    const who = many ? `${v.account}  ` : '';
    const flag = v.willBeFeeChecked ? `   ${p.warn('will be fee-checked')}` : '';
    out.push(
      `  ${who}Day ${v.day.toString()}  ${signed(v.before, p, amount(v.before).padStart(9))} → ${signed(v.after, p, amount(v.after).padStart(9))}${flag}`,
    );
  }
  out.push('');
  return out;
}

function entryLine(e: Entry, p: Paint): string {
  const paintKind = e.kind === 'FEE' ? p.fee : e.kind === 'INTEREST' ? p.interest : (s: string): string => s;
  return [
    `#${e.seq.toString()}`.padEnd(4),
    paintKind(e.kind.padEnd(8)),
    e.account,
    signed(e.amount, p, amount(e.amount).padStart(8)),
    `booked Day ${e.bookedDay.toString()}`,
    `value Day ${e.valueDay.toString()}`,
    `cause ${e.cause}`,
  ].join('   ');
}

function feePassBlock(view: StepView, p: Paint): string[] {
  const lines = view.feePass;
  if (lines === undefined) return [];
  const many = new Set(lines.map((l) => l.account)).size > 1;
  const out: string[] = [];
  for (const l of lines) {
    const who = many ? `${l.account}  ` : '';
    const outcome = l.outcome.startsWith('negative, no fee yet') ? p.fee(l.outcome) : l.outcome;
    out.push(`  ${who}Day ${l.day.toString()}  ${signed(l.closing, p, amount(l.closing).padStart(9))}   ${outcome}`);
  }
  out.push('');
  return out;
}

// The strip at the bottom: each day's event ids, then ┃ for its end-of-day run.
// The current event is put in brackets; the current stage shows its number next to the ┃.
function progress(view: StepView, p: Paint): string {
  const current = view.step;
  const pieces: string[] = [];
  for (const row of view.outline) {
    for (const id of row.events) {
      const here = current.kind === 'event' && current.event.id === id && current.day === row.day;
      pieces.push(here ? p.bold(`[${id}]`) : id);
    }
    const here = current.kind === 'stage' && current.day === row.day;
    pieces.push(here ? p.bold(`[┃ ${current.stage.toString()}/6]`) : '┃');
  }
  return `  ${pieces.join(' ')}      ┃ = end-of-day run (6 stages each)`;
}

/** One screen of the step mode: what this step did and where it sits in the run. */
export function renderStep(view: StepView, p: Paint): string {
  const s = view.step;
  const where =
    s.kind === 'event'
      ? `Day ${s.day.toString()}`
      : `Day ${s.day.toString()} end of day  ·  stage ${s.stage.toString()} of 6: ${stageLabel(s.name)}`;
  const out: string[] = [];
  out.push(`${p.bold('ledger-replay --step')}   step ${s.index.toString()} of ${view.total.toString()}  ·  ${p.day(s.day)(where)}  ·  ${p.dim(KEYS)}`);
  out.push('');

  if (s.kind === 'event') {
    out.push(`▶ ${eventLine(s.event, p)}`);
  } else if (s.name === 'fees') {
    out.push(`▶ fee pass   days ${WINDOW.first.toString()} to ${s.day.toString()}, in order, closing balance before that day's own fee`);
  } else {
    out.push(`▶ ${stageLabel(s.name)}`);
  }
  out.push(`  ${view.ok ? view.note : p.error(view.note)}`);
  out.push('');

  if (s.kind === 'stage' && s.name === 'fees') {
    out.push(...feePassBlock(view, p));
  } else {
    out.push(...beforeAfter(view, p));
    out.push(...valueDatedBlock(view, p));
  }

  if (view.appended.length > 0) {
    out.push('  entries appended');
    for (const e of view.appended) out.push(`  ${entryLine(e, p)}`);
    out.push('');
  }

  if (s.kind === 'stage') {
    const closingsLine = Object.entries(view.after)
      .map(([id, b]) => `${id} closing as of Day ${s.day.toString()}: ${signed(b.ledger, p)}`)
      .join('   ');
    const next = STAGES.find((x) => x.stage === s.stage + 1);
    out.push(`  ${closingsLine}     ${next === undefined ? 'end of day done' : `next stage: ${next.label}`}`);
    out.push('');
  }

  out.push('─'.repeat(81));
  out.push(progress(view, p));
  return out.join('\n');
}

export type StepIo = { write(s: string): void; readKey(): Promise<string>; isTTY: boolean };

/** Walks the steps. In a terminal it waits for keys; otherwise it writes every step and stops. */
export async function stepMode(accounts: AccountSpec[], events: readonly LedgerEvent[], io: StepIo, p: Paint): Promise<void> {
  const steps = buildSteps(events);
  const screen = (k: number): StepView => runUntil(accounts, steps, k).view;

  if (!io.isTTY) {
    for (let k = 1; k <= steps.length; k++) {
      io.write(`${renderStep(screen(k), p)}\n\n`);
    }
    return;
  }

  let k = 1;
  for (;;) {
    const view = screen(k);
    io.write('\x1b[2J\x1b[H');
    io.write(`${renderStep(view, p)}\n`);
    const key = await io.readKey();
    if (key === 'q' || key === '\u0003') return;
    if (key === '\r' || key === '\n' || key === 'n') {
      if (k >= steps.length) {
        io.write('done\n');
        return;
      }
      k += 1;
    } else if (key === 'b') {
      k = Math.max(1, k - 1);
    } else if (key === 'j') {
      io.write(`\n${stepToJson(view, accounts)}\n`);
      const after = await io.readKey();
      if (after === 'q' || after === '\u0003') return;
    } else if (key === 'd') {
      io.write(`\nwhich day (${WINDOW.first.toString()} to ${WINDOW.last.toString()})? `);
      const digit = await io.readKey();
      if (digit === '\u0003') return;
      const n = Number.parseInt(digit, 10);
      const first = steps.find((x) => x.day === n);
      if (first !== undefined) k = first.index;
    }
  }
}
