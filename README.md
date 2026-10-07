# ledger-core

An account ledger that lives in memory. It replays a fixed list of ten events over six days for two accounts: ACC-001 in AED (UAE dirham) and ACC-002 in BHD (Bahraini dinar). The events include card authorizations and the holds they place, entries dated back to an earlier day, overdraft fees and daily interest. Money is always a whole number of fils, the smallest unit of each currency. There are no floating-point numbers anywhere.

AED has 100 fils to the dirham, so 39,093 AED fils is AED 390.93. BHD has 1,000 fils to the dinar, so 10,008 BHD fils is BHD 10.008.

## The result

| Account | Final balance | Overdraft fees | Interest paid on Day 6 |
| --- | --- | --- | --- |
| ACC-001 | 39,093 AED fils (AED 390.93) | three fees of 2,500, on Days 2, 4 and 5 | 93 |
| ACC-002 | 10,008 BHD fils (BHD 10.008) | none | 8 |

Four of the expected outcomes in the original task are not met on purpose. AMBIGUITIES.md and REJECTED.md explain why, with the numbers.

## Install

You need Bun 1.4 or later.

```bash
curl -fsSL https://bun.sh/install | bash
bun install
```

## Run

```bash
bun run src/main.ts
```

In a terminal this shows a menu. Press `1` for the full report, `2` to step through the replay, `3` for JSON, `4` for the web page, or `q` to quit. When the output goes to a pipe or a file, there is no menu and you get the full report.

You can skip the menu with a flag:

- `bun run src/main.ts --json` prints the same data as JSON. Every amount is given twice: as whole fils and as text.
- `bun run src/main.ts --step` walks the replay one event or one end-of-day stage at a time. The keys are:
  - Enter or `n`: next step
  - `b`: back one step
  - `j`: show this step as JSON
  - `d` and then a digit: jump to the start of that day
  - `q`: quit
- `bun run src/main.ts --html` writes the replay as a web page, `ledger-replay.html`, in the current folder and opens it in your default browser.
  - `--html=<path>` writes the page to that file instead.
  - `--no-open` writes the page without opening it.
- `--no-color` gives plain text with no colors. Setting `NO_COLOR` does the same.
- `--help` lists the flags.

The web page opens on the step-through. It shows one step at a time, with Previous and Next buttons and a strip of every event that you can click to jump to one. An `events only` switch, on at the start, skips the end-of-day stages. The page takes most of the terminal's keys: Enter or `n` for the next step, `b` to go back, and `d` then a digit to jump to a day, plus the arrow keys, Space, Home and End. It has no `j` or `q` key, since the JSON is further down the page and there is nothing to quit. Below the step-through come the per-day report, the summary table and the JSON, which is folded away until you open it. The page is one file with nothing loaded from the internet, so it opens offline and can be sent as an attachment. It is made from the same text the terminal prints, with the colors turned into HTML, so the two can never disagree.

The report has one block per day. Each block lists the events booked that day and what happened to each one (applied, approved, declined or rejected). Then come the end-of-day lines: the past days whose closing balance changed ("re-evaluated"), the fees charged, the interest worked out so far, and, on Day 6, the interest credited ("capitalized"). Each block ends with one line per account, the state of each authorization, and any errors. After Day 6 comes a summary table. For each day it shows ACC-001's closing balance as it stands at the end ("final") next to the closing balance as it was when that day ended ("as closed"). The two differ wherever a later entry was dated back onto that day.

Here is the end of the real output of `bun run src/main.ts --no-color`:

```text
━━ Day 6 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
events
  E9   REVERSAL       ACC-001   +62,000   value Day 2  ← back-dated  reverses E7
end of day
  re-evaluated   Day 2  −39,500 → 22,500    Day 3  500 → 62,500    Day 4  −20,500 → 41,500    Day 5  −23,000 → 39,000
  fees           none
                 ⚠ fees on Days 2, 4, 5 remain; those days are positive after E9 — for review
  interest       ACC-001  10 + 9 + 25 + 17 + 16 + 16 = 93    ACC-002  4 + 4 = 8
  capitalized    ACC-001 +93   ACC-002 +8   value Day 6
accounts
  ACC-001  AED  closing 39,093  AED 390.93   holds 0   available 39,093   fees total 7,500
  ACC-002  BHD  closing 10,008  BHD 10.008   holds 0   available 10,008   fees total 0
authorizations   Auth-A settled   Auth-B declined
errors           none

summary  closing ledger by value date · final vs as closed that day · minor units

 day │ ACC-001 final │ as closed │   fee │ accrual │ ACC-002 final │ accrual │ authorizations
─────┼───────────────┼───────────┼───────┼─────────┼───────────────┼─────────┼──────────────────────────────────
   1 │        25,000 │    25,000 │     – │      10 │             – │       – │ –
   2 │        22,500 │    25,000 │ 2,500 │       9 │             – │       – │ Auth-A approved
   3 │        62,500 │    65,000 │     – │      25 │             – │       – │ –
   4 │        41,500 │    46,500 │ 2,500 │      17 │             – │       – │ Auth-A settled · Auth-Z rejected
   5 │        39,000 │   −23,000 │ 2,500 │      16 │        10,000 │       4 │ Auth-B declined
   6 │        39,093 │    39,093 │     – │      16 │        10,008 │       4 │ –
─────┼───────────────┼───────────┼───────┼─────────┼───────────────┼─────────┼──────────────────────────────────
 tot │               │           │ 7,500 │      93 │               │       8 │

final   ACC-001  39,093 AED fils  AED 390.93        ACC-002  10,008 BHD fils  BHD 10.008
fees    3 × 2,500 AED fils on Days 2, 4, 5
review  fees on Days 2, 4, 5 were charged before E9 reversed E7; those days ended positive after the reversal; refund is a human decision
```

## Tests

```bash
bun test
```

This runs every test file. It ends with exactly one failure, on purpose. The failing test is in test/failing.test.ts. It expects an overdraft fee on a BHD account, but no BHD fee was ever defined. The comment at the top of that file explains what the failure shows.

```bash
bun run test:green
```

This runs every test file except test/failing.test.ts, so it should end with no failures.

```bash
bun run typecheck
```

This runs the strict TypeScript check.

Some tests are property tests written with fast-check: they try many random inputs and check that a rule always holds, for example that an equal split always adds up to the whole amount.

## Download a ready-made program

The five programs are attached to the release on GitHub: https://github.com/modeht/ledger-core/releases/latest. Pick the one for your computer: macOS on Apple chips (darwin-arm64) or Intel (darwin-x64), Linux arm64 or x64, or Windows x64 (.exe). Each is one file of 60 to 90 MB and needs nothing installed. On macOS and Linux make it runnable first with `chmod +x`, then run it from a terminal or double-click it. macOS may ask you to allow it under System Settings, Privacy and Security, because it is not signed.

## Build an executable

```bash
bun run build
```

This makes dist/ledger-replay for the computer you are on.

```bash
bun run build:all
```

This makes five programs in dist/: macOS on Apple chips (arm64) and on Intel (x64), Linux arm64 and x64, and Windows x64. Each one is self-contained, about 60 MB, and needs no Bun installed. Double-click it or run it from a terminal and it shows the same menu.

## How a day is processed

First, the events booked that day are applied in the order they arrive in the stream. Then the end-of-day run goes through six stages, in this order:

1. **Cutoff.** The day is closed. Nothing more can be booked on it.
2. **Re-evaluate.** The closing balance of every earlier day is worked out again and compared with what it was after the previous run. Entries dated back onto an earlier day show up here.
3. **Fees.** Days 1 to today are checked in order. A day that closed below zero and has no fee yet gets one: 2,500 AED fils. BHD has no fee defined, so a BHD account that closes below zero is reported as an error.
4. **Interest.** Each positive closing balance earns 0.04% for that day. This is kept as a figure and not yet booked.
5. **Capitalize.** On Day 6 only, one credit is booked per account, equal to the sum of the daily interest figures after each was rounded to the nearest fils.
6. **Report.** The day's results are gathered for the report.

Three decisions explain most of the result:

- Fees are worked out by the day an entry counts for (its value date), not the day it was booked. So an entry dated back onto an earlier day can create fees on earlier days.
- A reversal cancels the entries of one event and nothing else. The fees that event caused stay, and they are flagged for a person to review.
- An authorization checks the available balance at the moment it arrives and is never checked again later.

## Project layout

- src/money.ts: money as whole fils, reading and printing amounts, and splitting an amount into equal parts.
- src/constants.ts: every number the ledger uses (the window, the fee, the interest rate) and the daily interest rounding.
- src/events.ts: the event types, days, accounts, and the check of each event's shape.
- src/stream.ts: the two accounts and the ten events, in the order they arrive.
- src/entries.ts: the log of entries, where entries are only ever added.
- src/holds.ts: the holds placed by authorizations and how they settle.
- src/ledger.ts: the ledger itself, balances worked out from the entries, and the rule for each type of event.
- src/eod.ts: the end-of-day run and its six stages, each a function of its own.
- src/replay.ts: plays the events day by day, runs the end of each day, and gathers what the report needs.
- src/render/text.ts: the text report, one block per day.
- src/render/table.ts: the summary table and the small text helpers the report shares.
- src/render/json.ts: the replay result as JSON.
- src/render/colors.ts: terminal colors, and when to turn them off.
- src/render/html.ts: turns the colored terminal text into a web page and builds the page.
- src/step.ts: the step mode, one event or end-of-day stage at a time.
- src/main.ts: the command line, the menu and the flags.
- src/index.ts: an empty module entry point.
- test/money.test.ts: money, amounts, splitting, constants and interest rounding.
- test/events.test.ts: the event list and the event check.
- test/ledger.test.ts: the entry log, holds, balances, each event type, and property tests.
- test/eod.test.ts: the end-of-day run, day by day, and a BHD account that closes below zero.
- test/replay.test.ts: the replay of the ten events and the summary.
- test/render.test.ts: the text report, the summary table, JSON and colors.
- test/html.test.ts: turning colored text into HTML and the web page.
- test/step.test.ts: the step list, each screen and the step mode keys.
- test/main.test.ts: the command line and its flags, including `--html`.
- test/acceptance.test.ts: the agreed figures day by day, one test per expected outcome in the task, and fast-check properties.
- test/failing.test.ts: the one test that fails on purpose, with its explanation.
- test/smoke.test.ts: checks that the test runner works.
- scripts/build-all.ts: builds the five standalone programs.

## Deliverables

- ARCHITECTURE.md: what the design meets in production: growth, value-dated entries, how an authorization can end, and what was cut.
- AMBIGUITIES.md: twelve decisions, each with the reading chosen and why.
- NUMBERS.md: every constant and where it comes from.
- REJECTED.md: the four expected outcomes refused, with the reasoning, and the approaches dropped during the build.
- WORKLOG.md: a log of the work, with times.
- test/failing.test.ts: the failing test, with comments.
