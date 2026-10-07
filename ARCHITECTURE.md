# Architecture and trade-offs

What the ledger as built would meet in production: what grows without bound, what value-dated entries do to a bank's operations, every way an authorization can end, and what was left out to stay in scope. The rules and the events are not repeated here. README.md explains how a day is processed; AMBIGUITIES.md gives each reading of the rules; REJECTED.md gives the refused outcomes.

Terms used below:

- **Entry**: one line in the ledger's log. It has a booking day (when it was written) and a value day (the day it counts for).
- **Closing balance** of a day: the sum of an account's entries whose value day is on or before that day.
- **Back-dated entry**: an entry whose value day is earlier than its booking day.
- **Hold**: the money reserved by an approved authorization. It reduces what the account may spend, not the closing balance.
- **Maker-checker**: one person prepares a change and a different person approves it before it takes effect.

## 1. Append-only at scale

**What breaks first at 100× volume is the end-of-day run, not memory.** A closing balance is never stored. Every time one is needed, the ledger scans the account's entries and sums those with a value day up to the day asked. Each end-of-day run asks for the closing balance of every past day of every account, and four of the six stages ask on their own: re-evaluate compares each past day with the remembered figure, fees looks at each past day before its own fee, interest works out each day's accrual, and report stores each day's closing for the next run. Nothing is cached between stages. One run therefore costs about accounts × days so far × entries per account, four times over, and across a window the total grows with the square of the number of days. At 100× entries and a year of days, the nightly run is the first thing that stops fitting in its window. The entries themselves are small; memory runs out long after time does.

**Where state grows without bound.** Four structures only ever grow:

- the entry log, never pruned, by design;
- the holds map, which keeps declined and settled holds forever;
- the set of applied event ids and the map of which event reversed which, one item per event ever seen, needed to refuse a duplicate or a second reversal;
- the remembered closings, one per account per day, needed to report what a back-dated entry changed.

**The smaller step first: a cache of closings, valid until the next append.** The only thing that changes a closing balance is a new entry, so a per-account, per-day cache of closings is correct until the next append and can be cleared then. Inside one run only the fee stage appends, because it books each fee as it walks the days. So re-evaluate can read from one scan, fees must refresh after each fee it books, and interest and report can share one scan taken after fees. That cuts four scans per day to about two with no change to any rule.

**The cheapest structural change: a running closing per account per value day, plus a limit on how far back an entry may be value-dated.** The cache taken to its end: instead of clearing it on append, update it, by adding the new amount to the closings from the entry's value day onward. A day's closing is then a lookup, and the entry log becomes something that is appended to and read rarely. With a back-dating limit of N days, an append can only touch the last N closings, so re-evaluation touches a fixed number of days instead of all of history. This is cheaper than a database or sharding because it changes no rule and no interface, only where a number is kept. The log stays the source of truth; the closings table can be rebuilt from it at any time, which is the difference between this and a mutable running balance. What it does not fix: the holds map still needs an expiry (section 3), and the id sets still need an archive once events are old enough that a duplicate cannot arrive.

## 2. Value-dated entries in production

**The surface is a figure the bank has already shown that can still change.** The bank has told the customer, its own books and the regulator what a day's balance was. Then a back-dated entry changes that day. It bites in three places.

- **The customer.** Statements already issued, fees already charged, interest already credited. This ledger recomputes fees and interest freely because nothing is credited inside the window. Once interest has been credited, a back-dated entry needs an adjustment entry, a credit or a debit for the difference. For a large balance or a long back-dating the adjustment is not small, and a debit adjustment can overdraw an account whose customer already moved the money.
- **The books.** A closed accounting period is not rewritten. A correction is a new entry in the open period that says what it corrects. The ledger's "as closed" and "final" figures are the in-memory version of that: both are kept, neither is overwritten, and the re-evaluate stage prints what moved.
- **The regulator.** The Central Bank of the UAE's Consumer Protection Regulation (Circular No. 8/2020) and its Consumer Protection Standards (Notice No. 1158/2021) require fees to be disclosed and agreed in advance, give customers at least 60 calendar days' notice before a fee changes (clause 2.1.1.47), and, where a deduction is caused by the bank's own error, require the error to be corrected and the amount refunded at once, with the customer told within ten business days (clauses 5.1.1.38 to 5.1.1.40). A fee that appears on a day three days after it ended, caused by someone else's late posting, is exactly the case that produces complaints and refunds under those clauses. That is why the ledger surfaces retroactive fees that a later reversal left behind for a person to review, rather than refunding them or charging them silently. Source: the Central Bank's rulebook, https://rulebook.centralbank.ae/en/rulebook/consumer-protection-standards (read 7 October 2026).

**The one control before going live: a back-dating limit with maker-checker beyond it.** An entry may be value-dated at most N days back, with N set by policy (30 is a common choice, and the design works for any N). Anything older is refused by the core and must come in as an adjustment entry in the current period, prepared by one person and approved by another, with the reason recorded. This control rather than another because it bounds every problem in this section at once: the size of any interest adjustment, the number of days to re-evaluate, and how old a statement can be invalidated. It is also the same limit that the scale fix in section 1 needs.

## 3. Authorization lifecycle

In the model as built, an authorization is checked once, when it arrives, against the available balance at that moment, and never again. Its states are open, settled and declined. Other than a full matching settlement, it can end in four ways.

| How it ends in the model | Real-world scenario | Behaviour to mandate |
| --- | --- | --- |
| Declined on arrival: available balance would go below zero | The card is used with no funds behind it | Record the decline with the balance seen; never touch available; tell the processor at once; keep the record for disputes and fraud scoring |
| Settled for less than the hold; the remainder is released | The final amount is below the pre-authorization: fuel pump, restaurant without the tip, partial shipment | Release the difference the moment the settlement posts and close the hold; never leave a sliver held |
| Settlement refused: unknown authorization, wrong account, already settled, or more than the hold | A clearing message with a bad reference, a duplicate clearing file, an over-clearing | Refuse, book nothing, raise an exception for operations; the authorization keeps its state. Production gap: schemes allow clearing with no matching authorization (force-post) and over-clearing within a tolerance; both are cut (section 4) |
| Never settled: the window ends with the hold open | The merchant never clears (cancelled order, failed shipment), or clears after the scheme deadline | Not handled: the hold stays open and reduces available forever. Mandate expiry by scheme rules (days for most merchants, longer for hotels and car rental) that releases the funds, and a merchant-initiated reversal that releases early |

Two ends have no event in the model at all: an incremental authorization, where the merchant raises the hold, and a merchant reversal, where the merchant cancels it. Each is a state transition on the same hold record, not a new concept.

## 4. What you cut and why

Every simplification, with the production risk it defers, in the order a reader meets them.

| Cut | Why it was cut | Risk deferred |
| --- | --- | --- |
| A fee refund after a reversal is a human action, not a core rule | The core books only what the stream or a rule caused; a refund is a policy decision | Fees a customer sees as unfair sit until someone acts; needs a review queue with a deadline |
| No force-posted settlements | The core cannot verify that an unreferenced clearing was approved elsewhere | Real clearings refused; needs a force-post path with its own limits and reporting |
| One settlement per authorization, never more than the hold | The stream has one clearing per authorization | Multiple clearings and over-clearing within tolerance are rejected; needs a partial-clearing state and a tolerance rule |
| No hold expiry | No event in the stream expires a hold | Funds held forever on abandoned authorizations (section 3) |
| No back-dating limit | The window is six days | Unbounded re-evaluation and unbounded interest adjustments (sections 1 and 2) |
| Fee defined per currency, no conversion, no rate source | Only AED has a fee; converting would invent a number | A negative BHD close is an error, not a fee; the deliberate failing test shows it; needs a fee schedule per currency |
| Interest recomputed freely, no adjustment entries | Nothing is credited before the last day | After capitalization, a back-dated entry needs an adjustment entry with its own value date and approval |
| Balances scanned from the log, no snapshots | Correct and simple at ten events | The nightly run's cost grows with history (section 1) |
| Duplicate event id is the only idempotency | Enough for a replay from one stream | Re-delivery with a changed id double-posts; needs a content hash or an upstream sequence number |
| Single process, no persistence, no concurrency | Out of scope by the task's own terms | Nothing survives a restart; two writers on one account would race; needs a durable log and one writer per account at a time |
| Single-entry log, no counterparty accounts | One account per event is all the stream needs | No trial balance that must sum to zero, so a wrong sign only shows when a test asks; production would make each entry one side of a double-entry posting |

The cuts are not independent. Hold expiry, the back-dating limit and the per-day closings are one control seen from three sides: a bound on how far back a change may reach and how long state may live. That is the one to build first.
