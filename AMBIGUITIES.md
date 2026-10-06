# Ambiguities

Every point where the brief leaves more than one valid reading, and how I resolved it. Each entry gives the context, the readings I considered, what the brief's own text supports, what a real bank or transfer app does, and my decision with its consequences for the build.

Amounts are in minor units: AED fils (100 per dirham) and BHD fils (1,000 per dinar).

## Reference: the two fee models

Several entries refer to these two readings of rule 1 (the overdraft fee), so they are defined once here.

**View A — fees are fixed at each day's end.** At the end of day N, the fee for day N is decided from the entries booked by then. A later entry with an earlier value date changes the recomputed balance of past days, but never creates or removes a fee for a day that has already closed.

**View B — fees are recalculated by value date.** The closing balance of day N is always "all entries with value date ≤ N", whenever it is evaluated. When a back-dated entry arrives, every day from its value date onward is re-evaluated, and a fee is assessed for any day that is now negative and was not already charged.

## 1. Do back-dated entries create overdraft fees on past days?

**Context.** E7 is a debit of 62,000 AED fils booked on Day 5 with value date Day 2. When Day 2 ended, ACC-001 closed at 25,000 (positive). After E7 exists, the value-dated closing balance of Day 2 is 25,000 − 62,000 = −37,000. The brief does not say whether a fee is owed for Day 2, which has already ended, or only for days still ahead.

**The two readings.** View A: no fee for Day 2; Day 5 is the first day evaluated with E7 in the balance, so the first fee lands on Day 5. View B: Day 2 is re-evaluated and gets a fee; Days 4 and 5 are also negative under the recomputed balances and get fees too.

**What the brief's own text supports.**

1. *Rule 1 defines the closing balance by value date.* It says the fee is assessed "when that day's closing ledger balance (all entries with value_date ≤ that day) is negative". E7 has value date Day 2, so it is part of Day 2's closing balance by the rule's own definition. The rule does not say "entries booked by that day". This is View B.
2. *Criterion 1 re-evaluates a past day.* It describes "the Day 2 closing ledger balance, evaluated at end of Day 5". A day's balance being evaluated three days after it ended only makes sense if past days are recomputed when back-dated entries arrive. Criterion 1's figure (−37,000 before fees) is the View B figure.

**What a real bank or transfer app does.** The end-of-day batch charges fees from what is posted by that day's cut-off, which is View A. A back-valued entry that lands later triggers an interest recalculation by value date (a standard core-banking feature), but old days' fees are not re-run automatically; operations review them case by case, and a fee caused by the bank's own error is waived. Many wallet apps never charge an overdraft fee at all and simply block the balance from going negative. So production practice is: interest follows View B, fees follow View A plus a human review.

**Decision: View B.** Value date is the driving factor for balances in this brief. Rule 1 defines the fee on the value-dated closing balance, and criterion 1 re-evaluates Day 2 at the end of Day 5, which only works under View B. The brief does not separate interest from fees; it defines both on the same value-dated balance, so reading fees as View B is the consistent choice. View A is a production policy, not what the rules say.

**Consequences for the build.**

- When a back-dated entry arrives, the ledger recomputes the closing balance of every day from the entry's value date to the current day and assesses a fee for each of those days that is now negative.
- A fee is charged at most once per day per account, ever. Re-running the recompute must never charge a second fee for the same day.
- A retroactive fee is itself a back-dated entry: booked on the day the recompute ran (Day 5 for E7), value date equal to the day assessed (Day 2), as rule 1 requires.
- A later back-dated credit (E9 reverses E7) can leave a fee that is no longer deserved. Whether such fees are refunded is a separate ambiguity (see entry 2).
- In production I would pair this with a limit on how far back an entry may be value-dated and an operations review of retroactive fees (Part 2, section 2).

## 2. What does a reversal undo: the entry, or everything it caused?

**Context.** E9 is typed REVERSAL and "reverses E7", with value date Day 2 (the same as E7). Under View B (entry 1), E7 caused three overdraft fees, on Days 2, 4 and 5. After E9 the recomputed balances of those days are positive again, so the fees' trigger no longer holds. The brief does not say whether the reversal also takes the fees back.

**The two readings.**

- *Narrow:* E9 is a credit of 62,000 AED fils value-dated Day 2, the exact mirror of E7. It cancels E7's amount and nothing else. The three fees stay booked. ACC-001 ends Day 6 at 39,000 AED fils before interest.
- *Cascading:* E9 also causes three refund credits of 2,500 AED fils, value-dated Days 2, 4 and 5, to offset the fees. ACC-001 ends Day 6 at 46,500 AED fils, the pre-E7 figure.

Both readings respect append-only: nothing is deleted in either, only new entries are added.

**What the brief's own text supports.** E9 names one entry, E7. Rule 1 describes fee assessment as an event that happens once "when that day's closing ledger balance is negative"; nothing in the rules un-assesses a fee. The stream contains no refund event. Criterion 6 asserts the cascading outcome, but criteria are explicitly allowed to be wrong.

**What a real bank or transfer app does.** A reversal is a contra entry: same amount, opposite direction, usually the same value date so that interest nets out. It targets exactly one original entry. Overdraft fees charged by the end-of-day process are never auto-reversed by a transaction reversal. They are refunded by a separate fee-waiver action, usually with approval, and routinely when the original posting was the bank's own error. Interest, by contrast, is recalculated automatically by value date.

**Decision: narrow.** The ledger core only books entries that the stream caused or that the rules explicitly mandate (fees under rule 1, the Day 6 capitalization under rule 2). A fee refund is neither. If the core invented refund entries, it would be deciding on its own that those fees were unfair; that is a business decision for a human or a separate policy, and in production it is a fee-refund event with maker-checker approval. This gives a clean rule:

- Derived state that has not been booked (closing balances, interest accruals) is recomputed after a back-dated entry. Interest for Days 2 to 5 comes back after E9.
- Booked entries never un-book. Fees stay unless a refund entry is posted, and none was given.

I considered the cascading reading as View B taken to its symmetric conclusion (fees derive from value-dated balances, so they should un-derive too). I rejected it because it makes the ledger refund money silently. The preferred approach is human intervention: a reversal that leaves fees behind is surfaced for review, and a person decides whether to refund them, through a separate fee-refund event with approval. The core reports; it does not decide.

**Consequences for the build.**

- A REVERSAL event posts one contra entry for the referenced entry, same amount, opposite direction, with the value date given by the event.
- A reversal re-triggers the same recompute as any back-dated entry (entry 1). The recompute can assess new fees but never removes or offsets existing ones.
- Interest accruals are recomputed from the new value-dated balances, since they are not booked until Day 6.
- Criterion 6 is rejected as a consequence (see REJECTED.md).

## 3. A settlement whose authorization does not exist (E6, Auth-Z)

**Context.** E6 settles Auth-Z for 18,000 AED fils on Day 4. No authorization event for Auth-Z was ever recorded. Criterion 4 says such a settlement must be rejected and the funds must not leave; that criterion only covers references that are absent from the ledger, not settlements in general.

**The readings.** Reject it and log an error, or post the debit anyway as a force-post.

**What a real bank does.** Card networks do carry settlements with no matching authorization: a force-post (the merchant obtained a voice approval code, or the terminal approved offline) or a late presentment after the issuer dropped the hold. Issuers generally must honour these and post the debit, even into overdraft. A transfer app with no card-acquiring side never sees one.

**Decision: reject.** The core cannot verify that an unreferenced settlement was legitimately approved somewhere else, and paying out on an unverifiable reference is the failure mode this rule exists to prevent. Criterion 4 is correct. Force-post handling is a production feature I cut (Part 2, section 4), and "the authorization never existed" is one of the ways an authorization lifecycle ends (Part 2, section 3).

**What "present in the ledger" means.** The criterion says "present", which is weaker than "active". A declined authorization is in the event log but created no hold; an already-settled or expired one exists but its hold is closed. I read "present" as "exists and is active": a settlement is accepted only against an active hold. That one rule covers criterion 4 and all three of those cases.

**Consequences for the build.** A SETTLEMENT event is accepted only if its authorization ID matches an active hold on the same account. Otherwise no entry is posted, balances are untouched, and the day's output lists the error with the reference.

## 4. A settlement for less than its hold (E5, Auth-A settles 18,500 against 20,000)

**Context.** Auth-A held 20,000 AED fils. E5 settles it for 18,500. The brief does not say what happens to the unused 1,500. Criterion 3 says the settlement must be accepted; that is correct, since the amount is within the hold.

**The readings.** Treat the settlement as final (close the authorization, release the remainder), or keep the 1,500 held for a possible further clearing.

**What a real bank does.** Settling under the hold is routine (fuel, restaurants, hotels). A clearing message is either final, which closes the authorization and releases the rest, or explicitly flagged as partial, which keeps the remainder held for further clearings until the hold expires. Final is the default. Issuers also release leftover holds automatically after a scheme-defined window.

**Decision: final.** Auth-A is closed and the 1,500 is released. The event does not say "partial", and holding 1,500 for the rest of the window with no expiry rule would be invented behaviour that leaves a phantom hold at the end of Day 6. The alternative changes no number in this stream (Auth-B is declined either way), which is exactly why it should be decided on principle rather than on the numbers.

**Consequences for the build.** A settlement posts a debit for the settled amount, marks the authorization settled, and removes the whole hold from available balance. Partial/multi-clearing settlements and over-settlement with a tolerance (tips) are not modelled; both are listed in Part 2 as cuts.
