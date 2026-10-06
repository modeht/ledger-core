// Colors for the text report. With colors off every function hands the text
// back unchanged, so the same rendering code serves a terminal, a pipe and a test.

export type Paint = {
  day(n: number): (s: string) => string;
  credit(s: string): string;
  debit(s: string): string;
  fee(s: string): string;
  interest(s: string): string;
  ok(s: string): string;
  error(s: string): string;
  warn(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
};

const ESC = '\u001b[';

// Each color ends with the code that resets only the color (39) or only the
// weight (22), so a painted piece inside another painted piece stays right.
function color(code: number): (s: string) => string {
  return (s) => `${ESC}${code.toString()}m${s}${ESC}39m`;
}

function weight(code: number): (s: string) => string {
  return (s) => `${ESC}${code.toString()}m${s}${ESC}22m`;
}

// One fixed color per day, Day 1 to Day 6: bright blue, green, yellow, magenta, cyan, red.
// A day past six starts the list again.
const DAY_COLORS = [94, 92, 93, 95, 96, 91] as const;

function dayColor(n: number): (s: string) => string {
  const size = DAY_COLORS.length;
  const index = (((Math.trunc(n) - 1) % size) + size) % size;
  return color(DAY_COLORS[index] ?? 39);
}

const same = (s: string): string => s;

/** ANSI colors when enabled, plain text when not. */
export function paint(enabled: boolean): Paint {
  if (!enabled) {
    return {
      day: () => same,
      credit: same,
      debit: same,
      fee: same,
      interest: same,
      ok: same,
      error: same,
      warn: same,
      dim: same,
      bold: same,
    };
  }
  return {
    day: dayColor,
    credit: color(32),
    debit: color(31),
    fee: color(33),
    interest: color(36),
    ok: color(32),
    error: color(91),
    warn: color(33),
    dim: weight(2),
    bold: weight(1),
  };
}

/** Colors are used only in a terminal, and never with --no-color or NO_COLOR set. */
export function colorsWanted(argv: string[], env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (argv.includes('--no-color')) return false;
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return false;
  return isTTY;
}
