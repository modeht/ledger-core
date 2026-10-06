// The web page. It takes the same colored text the terminal shows and turns the
// color codes into HTML spans, so the page and the terminal never drift apart.
// The page is one file with its styles and script inside: it works offline, from disk.

import type { AccountSpec, LedgerEvent } from '../events.ts';
import { CURRENCIES, minor } from '../money.ts';
import type { Currency } from '../money.ts';
import type { ReplayResult } from '../replay.ts';
import { buildSteps, renderStep, runUntil } from '../step.ts';
import type { StageName } from '../step.ts';
import { paint } from './colors.ts';
import { toJson } from './json.ts';
import { amount, renderSummary } from './table.ts';
import { renderDay, renderHeader } from './text.ts';

const COLOR_CODES = new Set([31, 32, 33, 36, 91, 92, 93, 94, 95, 96]);

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * Turns the color codes the program uses into spans and escapes the text around them.
 * Colors and weights are tracked apart, because each has its own closing code
 * (39 ends a color, 22 ends a weight). Anything still open at the end is closed.
 * Codes the program never writes are dropped.
 */
export function ansiToHtml(s: string): string {
  const colors: number[] = [];
  const weights: number[] = [];
  // Which kind each open span is, in the order they were opened, so spans close in the right order.
  const open: ('color' | 'weight')[] = [];
  let out = '';
  let last = 0;

  // Closes spans down to and including the newest one of this kind, then opens again
  // the ones of the other kind that sat above it, so the HTML stays properly nested.
  const close = (kind: 'color' | 'weight'): void => {
    const at = open.lastIndexOf(kind);
    if (at < 0) return;
    const above = open.splice(at);
    above.shift();
    out += '</span>'.repeat(above.length + 1);
    if (kind === 'color') colors.pop();
    else weights.pop();
    // The spans above are of the other kind; reopen them with their saved classes.
    const other = kind === 'color' ? weights : colors;
    const reopened = other.slice(other.length - above.length);
    for (const code of reopened) {
      out += spanFor(code);
      open.push(kind === 'color' ? 'weight' : 'color');
    }
  };

  const re = /\u001b\[(\d+)m/g;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    out += escapeText(s.slice(last, m.index));
    last = m.index + m[0].length;
    const code = Number(m[1]);
    if (COLOR_CODES.has(code)) {
      colors.push(code);
      open.push('color');
      out += spanFor(code);
    } else if (code === 1 || code === 2) {
      weights.push(code);
      open.push('weight');
      out += spanFor(code);
    } else if (code === 39) {
      close('color');
    } else if (code === 22) {
      close('weight');
    }
  }
  out += escapeText(s.slice(last));
  out += '</span>'.repeat(open.length);
  return out;
}

function spanFor(code: number): string {
  if (code === 1) return '<span class="bold">';
  if (code === 2) return '<span class="dim">';
  return `<span class="c${code.toString()}">`;
}

// The key line the terminal step mode prints in each frame's header (from src/step.ts).
// The page has its own keys, shown under the strip, so this line is taken out of each frame.
const TERMINAL_KEYS = '[enter] next   [b] back   [j] json   [d] day   [q] quit';

const STAGE_TITLES: Record<StageName, string> = {
  cutoff: 'cutoff',
  reevaluate: 're-evaluate past days',
  fees: 'fees',
  interest: 'interest recompute',
  capitalize: 'capitalize',
  report: 'report',
};

const STYLE = `
:root{--bg:#f6f7f9;--fg:#1d2127;--muted:#5d6570;--line:#d5d9df;--btn:#ffffff;--btn-fg:#1d2127}
@media (prefers-color-scheme: dark){:root{--bg:#16181c;--fg:#e4e6ea;--muted:#9aa1ab;--line:#2c3038;--btn:#22262c;--btn-fg:#e4e6ea}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
.page{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:15px;margin:28px 0 8px;color:var(--muted);font-weight:600}
.muted{color:var(--muted);margin:0}
.term{background:#0f1114;color:#d8dbe0;border-radius:6px;padding:14px 16px;overflow-x:auto;max-width:100%}
.term pre{margin:0;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;white-space:pre}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:10px}
.bar .where{flex:1 1 auto;min-width:12em}
button{font:inherit;font-size:14px;background:var(--btn);color:var(--btn-fg);border:1px solid var(--line);border-radius:4px;padding:3px 12px;cursor:pointer}
.bar label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.strip{display:flex;flex-wrap:wrap;gap:3px;margin-top:10px;align-items:center}
.strip .gap{width:10px}
.jump{font:12px ui-monospace,Menlo,Consolas,monospace;padding:2px 5px;min-width:2.2em}
.jump.stage{color:var(--muted)}
.jump.now{background:var(--fg);color:var(--bg);border-color:var(--fg)}
details summary{cursor:pointer;color:var(--muted);font-weight:600}
details pre{margin-top:10px}
.legend{margin-top:28px;color:var(--muted);font-size:14px}
.legend span{white-space:nowrap}
.legend .sw{background:#0f1114;border-radius:3px;padding:0 5px;font-family:ui-monospace,Menlo,Consolas,monospace}
.c31,.c91{color:#ff7b72}.c32,.c92{color:#7ee787}.c33,.c93{color:#e3b341}.c36,.c94{color:#79c0ff}.c95{color:#d2a8ff}.c96{color:#56d4dd}
.bold{font-weight:700;color:#fff}
.dim{opacity:.6}
`;

const SCRIPT = `
(function(){
  var pres = Array.prototype.slice.call(document.querySelectorAll('pre.step'));
  var jumps = Array.prototype.slice.call(document.querySelectorAll('button.jump'));
  var only = document.getElementById('events-only');
  var last = pres.length;
  var cur = 1;
  function pre(k){ return pres[k - 1]; }
  function show(k){
    if (k < 1 || k > last) return;
    cur = k;
    pres.forEach(function(p, i){ p.hidden = i !== k - 1; });
    jumps.forEach(function(b){ b.classList.toggle('now', Number(b.dataset.k) === k); });
    var p = pre(k);
    document.getElementById('k').textContent = String(k);
    document.getElementById('where').textContent = 'Day ' + p.dataset.day + (p.dataset.kind === 'stage' ? ' end of day' : '');
  }
  function skip(k){ return only.checked && pre(k).dataset.kind === 'stage'; }
  function next(){ for (var k = cur + 1; k <= last; k++) if (!skip(k)) return show(k); }
  function prev(){ for (var k = cur - 1; k >= 1; k--) if (!skip(k)) return show(k); }
  function firstOfDay(d){
    for (var k = 1; k <= last; k++) if (pre(k).dataset.day === d) return show(k);
  }
  document.getElementById('prev').addEventListener('click', prev);
  document.getElementById('next').addEventListener('click', next);
  jumps.forEach(function(b){ b.addEventListener('click', function(){ show(Number(b.dataset.k)); }); });
  var dayWait = 0;
  document.addEventListener('keydown', function(e){
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    var tag = t && t.tagName;
    var inControl = tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'SUMMARY';
    if (inControl && (e.key === ' ' || e.key === 'Enter')) return;
    if (dayWait && Date.now() - dayWait < 2000 && /^[0-9]$/.test(e.key)) {
      dayWait = 0; firstOfDay(e.key); e.preventDefault(); return;
    }
    dayWait = 0;
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ' || e.key === 'n') { next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'b') { prev(); e.preventDefault(); }
    else if (e.key === 'Home') { show(1); e.preventDefault(); }
    else if (e.key === 'End') { show(last); e.preventDefault(); }
    else if (e.key === 'd') { dayWait = Date.now(); }
  });
  show(1);
})();
`;

/** The whole replay as one web page: the step frame first, then the report, the summary and the JSON. */
export function renderHtml(result: ReplayResult, accounts: readonly AccountSpec[], events: readonly LedgerEvent[]): string {
  const p = paint(true);

  const currencies: Currency[] = [];
  for (const a of accounts) if (!currencies.includes(a.currency)) currencies.push(a.currency);
  const units = currencies.map((c) => `${c} fils (÷${amount(minor(CURRENCIES[c].perMajor))})`).join(', ');
  const count = (n: number, word: string): string => `${n.toString()} ${word}${n === 1 ? '' : 's'}`;
  const intro = `${count(result.days.length, 'day')} · ${count(accounts.length, 'account')} · minor units: ${units}`;

  const steps = buildSteps(events);
  const pres: string[] = [];
  const jumps: string[] = [];
  let lastDay: number | null = null;
  for (const step of steps) {
    const k = step.index;
    const view = runUntil([...accounts], steps, k).view;
    const frame = renderStep(view, p).replace(`  ·  ${p.dim(TERMINAL_KEYS)}`, '');
    const hidden = k === 1 ? '' : ' hidden';
    pres.push(
      `<pre class="step" data-k="${k.toString()}" data-day="${step.day.toString()}" data-kind="${step.kind}"${hidden}>${ansiToHtml(frame)}</pre>`,
    );
    if (lastDay !== null && lastDay !== step.day) jumps.push('<span class="gap"></span>');
    lastDay = step.day;
    const now = k === 1 ? ' now' : '';
    if (step.kind === 'event') {
      jumps.push(`<button class="jump${now}" data-k="${k.toString()}">${escapeText(step.event.id)}</button>`);
    } else {
      const title = `Day ${step.day.toString()} · ${STAGE_TITLES[step.name]}`;
      jumps.push(`<button class="jump stage${now}" data-k="${k.toString()}" title="${escapeAttr(title)}">┃</button>`);
    }
  }
  const firstDay = steps[0]?.day ?? 1;

  const report = [renderHeader(accounts, p), ...result.days.map((d) => renderDay(d, p))].join('\n\n');

  const legend = [
    `<span><span class="sw c32">green</span> money in / accepted</span>`,
    `<span><span class="sw c31">red</span> money out / negative / rejected</span>`,
    `<span><span class="sw c33">yellow</span> fee / declined / back-dated / for review</span>`,
    `<span><span class="sw c36">cyan</span> interest</span>`,
    `<span><span class="sw"><span class="c94">blue</span> to <span class="c91">red</span></span> one color per day</span>`,
    `<span><span class="sw dim">dim</span> history and formatted amounts</span>`,
  ].join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ledger-replay</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<h1>ledger-replay</h1>
<p class="muted">${escapeText(intro)}</p>

<h2>Step through</h2>
<div class="bar">
<span class="where">step <span id="k">1</span> of ${steps.length.toString()} · <span id="where">Day ${firstDay.toString()}</span></span>
<button id="prev" type="button">Previous</button>
<button id="next" type="button">Next</button>
<label><input type="checkbox" id="events-only" checked> events only</label>
</div>
<div class="term">
${pres.join('\n')}
</div>
<div class="strip">${jumps.join('')}</div>
<p class="muted">Keys: → Enter or Space next · ← or b back · Home first · End last · d then a digit jumps to that day.</p>

<h2>Per-day report</h2>
<div class="term"><pre>${ansiToHtml(report)}</pre></div>

<h2>Summary</h2>
<div class="term"><pre>${ansiToHtml(renderSummary(result.summary, p))}</pre></div>

<h2>JSON</h2>
<div class="term"><details><summary>JSON</summary><pre>${escapeText(toJson(result))}</pre></details></div>

<p class="legend">${legend}</p>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
