# Worklog

Times are local (EEST, UTC+3). Entries are written as the work happens.

## 2026-10-06

- **~07:00** Started the assessment and read the brief (Part 1 ledger, Part 2 architecture document).
- **07:05** Scaffolded the TypeScript project: strict `tsc`, Vitest, fast-check. Placeholder smoke test passes.
- **07:13** Added the GitHub remote. First pass over the acceptance criteria and a list of ambiguities to resolve before building (AI-assisted, to be verified).
- **10:46** Walked the replay through Day 2 by hand, in minor units. Decided the fee model (recalculate by value date) and reversal semantics (a reversal cancels one entry; fees stay, refunds are a human decision). Started AMBIGUITIES.md (entries 1–2) and REJECTED.md (criterion 6).
- **17:47** Finished the hand replay through Day 6 (both accounts, minor units). Decided settlement rules, authorization balance check, instalment split, interest basis (recompute by value date), rounding (half-up, total = sum of dailies) and Day 6 ordering. AMBIGUITIES.md now has 10 entries; REJECTED.md refuses criteria 2, 6, 7 and 8. Expected final balances: ACC-001 39,093 AED fils, ACC-002 10,008 BHD fils.
