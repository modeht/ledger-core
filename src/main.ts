// The command line. It replays the ten events and prints the report, the JSON,
// or the step-by-step view. Everything it needs is built in: it reads no files.

import { ACCOUNTS, STREAM } from './stream.ts';
import { replay } from './replay.ts';
import { stepMode } from './step.ts';
import type { StepIo } from './step.ts';
import { colorsWanted, paint } from './render/colors.ts';
import { renderAll } from './render/text.ts';
import { toJson } from './render/json.ts';

const USAGE = `usage: ledger-replay [--json | --step] [--no-color]

  (no flags)   in a terminal, a menu; otherwise the full report and summary table
  --json       the same data as JSON, every amount as {minor, text}
  --step       walk the replay one event or end-of-day stage at a time
  --no-color   plain text, no colors (NO_COLOR does the same)
  -h, --help   show this help
`;

type Mode = 'report' | 'json' | 'step';

// Puts the terminal into raw mode for the time it waits, so one key press is enough.
// Raw mode is always undone, also when Ctrl-C arrives as a signal.
function realReadKey(): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve) => {
    const restore = (): void => {
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.off('SIGINT', onSignal);
    };
    const onSignal = (): void => {
      restore();
      resolve('\u0003');
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    process.once('SIGINT', onSignal);
    stdin.once('data', (chunk: Buffer | string) => {
      restore();
      resolve(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let json = false;
  let step = false;
  for (const a of args) {
    if (a === '--json') json = true;
    else if (a === '--step') step = true;
    else if (a === '--no-color') continue;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      return 0;
    } else {
      process.stderr.write(`unknown option: ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (json && step) {
    process.stderr.write(`--json and --step cannot be used together\n${USAGE}`);
    return 2;
  }

  const p = paint(colorsWanted(args, process.env, process.stdout.isTTY === true));

  let mode: Mode = json ? 'json' : step ? 'step' : 'report';
  if (!json && !step && process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write('ledger-replay\n  1  full report\n  2  step through, one event or stage at a time\n  3  JSON\n  q  quit\n> ');
    const key = await realReadKey();
    process.stdout.write('\n');
    if (key === '1') mode = 'report';
    else if (key === '2') mode = 'step';
    else if (key === '3') mode = 'json';
    else return 0;
  }

  if (mode === 'json') {
    process.stdout.write(`${toJson(replay(ACCOUNTS, STREAM))}\n`);
  } else if (mode === 'step') {
    const io: StepIo = {
      write: (s) => {
        process.stdout.write(s);
      },
      readKey: realReadKey,
      isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    };
    await stepMode(ACCOUNTS, STREAM, io, p);
  } else {
    process.stdout.write(`${renderAll(replay(ACCOUNTS, STREAM), p)}\n`);
  }
  return 0;
}

// When the reader of the output goes away early (for example `| head`), stop quietly.
function isBrokenPipe(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EPIPE';
}
process.stdout.on('error', (err) => {
  if (isBrokenPipe(err)) process.exit(0);
  throw err;
});

try {
  process.exitCode = await main(process.argv);
} catch (err) {
  if (isBrokenPipe(err)) process.exit(0);
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}
