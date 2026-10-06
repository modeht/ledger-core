import { describe, expect, test } from 'bun:test';

const MAIN = new URL('../src/main.ts', import.meta.url).pathname;

// Runs the command line with the given flags, no keyboard, and returns what it printed.
async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const child = Bun.spawn([process.execPath, 'run', MAIN, ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out, err };
}

describe('the command line', () => {
  test('an unknown flag prints the usage and exits with 2', async () => {
    const r = await run('--bogus');
    expect(r.code).toBe(2);
    expect(r.err).toContain('unknown option: --bogus');
    expect(r.err).toContain('usage: ledger-replay');
  });

  test('--json together with --step exits with 2', async () => {
    const r = await run('--json', '--step');
    expect(r.code).toBe(2);
    expect(r.err).toContain('cannot be used together');
  });

  test('-h prints the usage and exits with 0', async () => {
    const r = await run('-h');
    expect(r.code).toBe(0);
    expect(r.out).toContain('usage: ledger-replay');
  });

  test('--no-color prints the plain report with six days and the final balances', async () => {
    const r = await run('--no-color');
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('\x1b[');
    expect(r.out.match(/━━ Day \d/g)).toHaveLength(6);
    expect(r.out).toContain('39,093');
    expect(r.out).toContain('10,008');
  });

  test('--json prints JSON that parses, with the final balance in fils', async () => {
    const r = await run('--json');
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.out);
    expect(doc.days).toHaveLength(6);
    expect(doc.summary.accounts[0].final).toEqual({ minor: 39093, text: 'AED 390.93' });
  });

  test('--step outside a terminal writes all 46 steps', async () => {
    const r = await run('--step', '--no-color');
    expect(r.code).toBe(0);
    expect(r.out).toContain('step 46 of 46');
  });

  test('stops quietly when the reader of the output goes away early', async () => {
    const child = Bun.spawn([process.execPath, 'run', MAIN, '--no-color'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    // Close the pipe before anything is read, so the report is written into a closed pipe.
    await child.stdout.cancel();
    const code = await child.exited;
    const err = await new Response(child.stderr).text();
    expect(code).toBe(0);
    expect(err).not.toContain('error');
  });
});
