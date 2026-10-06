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
