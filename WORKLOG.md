# Worklog

Times are local (EEST, UTC+3). Entries are written as the work happens.

## 2026-10-06

- **~07:00** Started the assessment and read the brief (Part 1 ledger, Part 2 architecture document).
- **07:05** Scaffolded the TypeScript project: strict `tsc`, Vitest, fast-check. Placeholder smoke test passes.
- **07:13** Added the GitHub remote. First pass over the acceptance criteria and a list of ambiguities to resolve before building (AI-assisted, to be verified).
- **10:46** Walked the replay through Day 2 by hand, in minor units. Decided the fee model (recalculate by value date) and reversal semantics (a reversal cancels one entry; fees stay, refunds are a human decision). Started AMBIGUITIES.md (entries 1–2) and REJECTED.md (criterion 6).
- **17:47** Finished the hand replay through Day 6 (both accounts, minor units). Decided settlement rules, authorization balance check, instalment split, interest basis (recompute by value date), rounding (half-up, total = sum of dailies) and Day 6 ordering. AMBIGUITIES.md now has 10 entries; REJECTED.md refuses criteria 2, 6, 7 and 8. Expected final balances: ACC-001 39,093 AED fils, ACC-002 10,008 BHD fils.
- **18:13** Decided fee per currency (BHD has no fee; a negative BHD close is an error) and grouping of events by booking day. AMBIGUITIES.md complete at 12 entries. Added NUMBERS.md with every constant and why it has that value.
- **18:50** Chose the build: Bun for tests, type check and single-file executables; a per-day text report plus a summary table, a `--json` output, a `--step` mode that walks one event or end-of-day stage at a time, and a start menu when run with no arguments. Wrote the code design for the first three phases (toolchain; money and events; ledger core and the six-stage end-of-day run) before any code.
- **19:16** Built the first two phases with AI agents from that design, each phase reviewed by a separate agent: Bun toolchain, then minor-unit money, constants, event types and the stream as data. 39 tests pass, strict type check clean. Reviewed the code myself; pinned `@types/bun` and renamed one test.
- **19:26** Committed the two phases as two commits so the history follows the design order.
- **19:46** Built the ledger core and the end-of-day run from the design, again with reviewed AI agents: append-only entries, holds as frozen copies, one `apply` rule per event type, and the six end-of-day stages (cutoff, re-evaluate, fees, interest, capitalize, report) as separate functions. Three review findings fixed in two rounds: reversals mirror only the postings of one event, duplicate event ids are refused, and a hold keeps the amount it was opened with. 102 tests pass.
- **22:30** Walked the new code myself: a guided review tour of the changes in execution order, then a throwaway demo script run under the VS Code debugger with breakpoints on `apply` and on the end-of-day run, stepping into the fee pass and the Day 6 capitalization. The demo output matches the hand replay line for line: fees on Days 2, 4 and 5 booked on Day 5, interest 93 and 8, Auth-Z rejected, Auth-B declined at −15,500.
- **22:50** Committed the ledger core and end-of-day run.
- **23:17** Built the replay runner, the per-day text report, the summary table, the JSON output, the step mode and the command line with its start menu. Five review findings fixed in three rounds; the one worth noting: the runner first passed the human-review flags to the renderers as sentences, which the renderers then parsed back with regular expressions; replaced by a structured record per flagged fee. 162 tests pass; `bun run src/main.ts` reproduces the hand replay; the compiled executable shows the menu.
- **23:35** Committed the runner, renderers, step mode and command line.
- **23:48** Added the acceptance suite (the agreed figures day by day, one test per criterion of the brief in its order, three fast-check properties), the one test that fails on purpose (a BHD overdraft fee the brief never defined), a `test:green` script, the README, and the abandoned-approach paragraph in REJECTED.md. `bun test`: 190 pass, 1 fail, as intended.
- **23:54** Built the executable for this machine and tried it in a terminal: 59 MB, one file, same menu.

## 2026-10-07

- **00:07** Added `--html`: the whole replay as one self-contained web page, saved on disk and opened in the default browser. The page opens on a step-by-step view (one step at a time, event by event by default, a strip of every event to jump to, the terminal's keys), then the per-day report, the summary table and the JSON. The page is made from the same colored text the terminal prints, converted to HTML, so the two cannot disagree. 206 tests pass plus the planned failure.
- **00:11** Committed the acceptance tests and docs, then the web page, as two commits.
