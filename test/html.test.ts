import { describe, expect, test } from 'bun:test';
import { ansiToHtml, renderHtml } from '../src/render/html.ts';
import { replay } from '../src/replay.ts';
import { ACCOUNTS, STREAM } from '../src/stream.ts';

describe('turning terminal colors into HTML', () => {
  test('escapes the characters HTML gives a meaning to', () => {
    expect(ansiToHtml('<b>&')).toBe('&lt;b&gt;&amp;');
  });

  test('a color inside bold text closes in the right order', () => {
    expect(ansiToHtml('\u001b[1mA \u001b[32mB\u001b[39m C\u001b[22m')).toBe('<span class="bold">A <span class="c32">B</span> C</span>');
  });

  test('text without color codes comes back the same', () => {
    expect(ansiToHtml('Day 1  ACC-001  39,093')).toBe('Day 1  ACC-001  39,093');
  });

  test('a code the program never writes is dropped', () => {
    expect(ansiToHtml('a\u001b[7mb')).toBe('ab');
  });

  test('a color left open is closed at the end', () => {
    expect(ansiToHtml('\u001b[94mDay 1')).toBe('<span class="c94">Day 1</span>');
  });
});

describe('the web page', () => {
  const page = renderHtml(replay(ACCOUNTS, STREAM), ACCOUNTS, STREAM);

  test('is a whole page with its title and the step counter', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>ledger-replay</title>');
    expect(page).toContain('step <span id="k">1</span> of 46');
  });

  test('holds one frame per step, only the first one showing', () => {
    expect(page.match(/class="step"/g)).toHaveLength(46);
    const pres = page.match(/<pre class="step"[^>]*>/g) ?? [];
    expect(pres[0]).not.toContain('hidden');
    expect(pres[1]).toContain('hidden');
  });

  test('shows the final balances and the JSON', () => {
    expect(page).toContain('39,093');
    expect(page).toContain('10,008');
    expect(page).toContain('"minor": 39093');
  });

  test('has no raw color codes and loads nothing from the internet', () => {
    expect(page).not.toContain('\u001b');
    expect(page).not.toContain('https://');
    expect(page).not.toContain('http://');
  });
});

// A small stand-in for the browser's page, just enough for the page's own script to run.
// It is built from the real page's markup, so the test drives the script the page ships with.
type FakeEl = {
  hidden: boolean;
  checked: boolean;
  textContent: string;
  dataset: Record<string, string>;
  classes: Set<string>;
  classList: { toggle: (c: string, on: boolean) => void };
  listeners: Record<string, (() => void)[]>;
  addEventListener: (type: string, fn: () => void) => void;
  click: () => void;
};

function fakeEl(dataset: Record<string, string> = {}, classes: string[] = []): FakeEl {
  const el: FakeEl = {
    hidden: false,
    checked: false,
    textContent: '',
    dataset,
    classes: new Set(classes),
    classList: { toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)) },
    listeners: {},
    addEventListener: (type, fn) => (el.listeners[type] ??= []).push(fn),
    click: () => (el.listeners['click'] ?? []).forEach((fn) => fn()),
  };
  return el;
}

function attr(tag: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
}

function runPage(page: string) {
  const pres = (page.match(/<pre class="step"[^>]*>/g) ?? []).map((t) => {
    const el = fakeEl({ k: attr(t, 'data-k'), day: attr(t, 'data-day'), kind: attr(t, 'data-kind') });
    el.hidden = t.includes(' hidden');
    return el;
  });
  const jumps = (page.match(/<button class="jump[^"]*"[^>]*>/g) ?? []).map((t) => fakeEl({ k: attr(t, 'data-k') }, attr(t, 'class').split(' ')));
  const byId: Record<string, FakeEl> = { 'events-only': fakeEl(), k: fakeEl(), where: fakeEl(), prev: fakeEl(), next: fakeEl() };
  byId['events-only']!.checked = page.includes('id="events-only" checked');
  const keyListeners: ((e: unknown) => void)[] = [];
  const document = {
    querySelectorAll: (sel: string) => (sel === 'pre.step' ? pres : sel === 'button.jump' ? jumps : []),
    getElementById: (id: string) => byId[id],
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'keydown') keyListeners.push(fn);
    },
  };
  const script = /<script>([\s\S]*)<\/script>/.exec(page)?.[1] ?? '';
  new Function('document', script)(document);
  const press = (key: string): void => {
    for (const fn of keyListeners) fn({ key, target: null, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => {} });
  };
  const step = (): number => Number(byId['k']!.textContent);
  const visible = (): string[] => pres.filter((p) => !p.hidden).map((p) => p.dataset['k'] ?? '');
  const marked = (): string[] => jumps.filter((b) => b.classes.has('now')).map((b) => b.dataset['k'] ?? '');
  return { press, step, visible, marked, byId, jumps };
}

describe('moving through the steps on the page', () => {
  const page = renderHtml(replay(ACCOUNTS, STREAM), ACCOUNTS, STREAM);

  test('a step frame does not list the terminal keys the page lacks', () => {
    expect(page).not.toContain('[q] quit');
    expect(page).not.toContain('[j] json');
  });

  test('the keys move one event at a time, skipping end-of-day stages while events only is on', () => {
    const pg = runPage(page);
    expect(pg.step()).toBe(1);
    pg.press('ArrowRight');
    expect(pg.step()).toBe(2);
    pg.press('ArrowRight');
    expect(pg.step()).toBe(9);
    expect(pg.byId['where']!.textContent).toBe('Day 2');
    pg.press('n');
    expect(pg.step()).toBe(16);
    pg.press('ArrowLeft');
    expect(pg.step()).toBe(9);
  });

  test('with events only off, back steps into the end-of-day stages', () => {
    const pg = runPage(page);
    pg.byId['events-only']!.checked = false;
    pg.press('ArrowRight');
    pg.press('ArrowRight');
    expect(pg.step()).toBe(3);
    pg.press('End');
    expect(pg.step()).toBe(46);
    pg.press('b');
    expect(pg.step()).toBe(45);
    expect(pg.byId['where']!.textContent).toContain('end of day');
  });

  test('d then a digit, Home and End jump, and exactly one frame shows with its strip button marked', () => {
    const pg = runPage(page);
    pg.press('d');
    pg.press('3');
    expect(pg.step()).toBe(16);
    expect(pg.byId['where']!.textContent).toBe('Day 3');
    pg.press('End');
    expect(pg.step()).toBe(46);
    pg.press('Home');
    expect(pg.step()).toBe(1);
    const event = pg.jumps.filter((b) => !b.classes.has('stage'))[4]!;
    const k = event.dataset['k'] ?? '';
    event.click();
    expect(pg.step()).toBe(Number(k));
    expect(pg.visible()).toEqual([k]);
    expect(pg.marked()).toEqual([k]);
    pg.byId['next']!.click();
    expect(pg.step()).toBeGreaterThan(Number(k));
    expect(pg.visible()).toHaveLength(1);
    expect(pg.marked()).toEqual(pg.visible());
    pg.byId['prev']!.click();
    expect(pg.step()).toBe(Number(k));
  });
});
