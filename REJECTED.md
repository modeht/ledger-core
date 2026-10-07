# Rejected

Two kinds of entries: acceptance criteria from the brief that I refuse, with the reasoning, and approaches I abandoned during the build.

Amounts are in minor units: AED fils (100 per dirham) and BHD fils (1,000 per dinar). Criteria are numbered in the order the brief lists them. "View B" means fees are recalculated by value date: when a back-dated entry arrives, every day from its value date onward is re-evaluated, and a fee is assessed for any day that is now negative and was not already charged.

## Criteria refused

### Criterion 2: "E7 causes exactly one overdraft fee to be assessed, on Day 2."

**Refused.** E7 causes three fees, on Days 2, 4 and 5.

E7 is a 62,000 AED fils debit with value date Day 2. With it in place, the closing balances are: Day 2, 25,000 − 62,000 = −37,000; Day 3, −37,000 + 40,000 = 3,000 before the Day 2 fee (500 after it); Day 4, 500 − 18,500 = −18,000; Day 5, unchanged, still negative. Three days close negative, and rule 1 (the overdraft fee of AED 25.00 per account) charges once per negative day. The Day 4 and Day 5 fees are not a side effect of the Day 2 fee: even with no fee on Day 2, Day 4 would close at −15,500.

Under the other reading of rule 1, View A, where fees are fixed when each day ends and never revisited (see [Reference: the two fee models](AMBIGUITIES.md#reference-the-two-fee-models)), E7 would cause one fee, but on Day 5, not Day 2. The criterion is wrong under both readings: wrong count under one, wrong day under the other.

### Criterion 6: "After E9, all balances and fees return to their pre-E7 values."

**Refused.** Balances do not return, and fees cannot.

E9 reverses E7: it posts a 62,000 AED fils credit value-dated Day 2, the mirror of E7's debit. That cancels E7's amount and nothing else. The three overdraft fees that E7 caused (Days 2, 4 and 5, 2,500 AED fils each, under View B: fees recalculated by value date, so a back-dated entry can create a fee on a past day; see [Reference: the two fee models](AMBIGUITIES.md#reference-the-two-fee-models)) are entries in their own right. They stay in every closing balance from their value date onward. Nothing in the rules un-assesses a fee, and the stream contains no refund event.

The numbers, ACC-001 before interest:

| | Day 6 closing (AED fils) | Fees booked |
| --- | --- | --- |
| If E7 had never happened | 46,500 | none |
| After E7 and E9 | 39,000 | 3 × 2,500 = 7,500 |

The gap is exactly the fees.

Even if the fees were refunded by new credit entries, the ledger would not "return" to anything: it is append-only (rule 4: no event record is ever changed or deleted), so it would hold E7, E9, three fees and three refunds. Balances could match the pre-E7 figures; the record never could. The criterion asks for a reset, and an append-only ledger has no reset.

What does hold after E9: E7's principal is cancelled, and the interest accruals for Days 2 to 5 are recomputed from the restored balances, because accruals are not booked until Day 6.

### Criterion 7: "The three BHD instalments in E10 must each be BHD 3.334."

**Refused.** 3 × 3,334 = 10,002 BHD fils, but E10 is a credit of 10,000. The criterion would credit 2 fils that were never paid in, and the ledger would no longer balance against the source of the money.

10,000 is not divisible by three in fils (BHD has three decimals, so 1 fils is the smallest unit). The split is 3,333 + 3,333 + 3,334 = 10,000, with the 1 fils remainder on the last instalment. "Equal instalments" means as equal as the currency's precision allows, never more than the whole.

### Criterion 8: "If the rounded daily interest accruals do not sum to the capitalized total, the remainder is discarded."

**Refused.** Rule 2 (the daily-interest rule, 0.04% per day on positive balances) says the rounded dailies must sum exactly to the capitalized total. A rule that says "they must match" and a criterion that says "when they don't, drop the difference" cannot both hold.

The mismatch the criterion describes only appears if the total is computed on its own (exact 91.8 AED fils, rounded to 92) while the dailies are rounded separately (10 + 9 + 25 + 17 + 16 + 16 = 93). The ledger instead defines the capitalized total as the sum of the rounded dailies, so the two are equal by construction and there is never a remainder. Discarding a remainder would also mean the customer is credited less than the ledger says they earned.

## Approaches abandoned during the build

Passing review facts as sentences. The replay runner first handed the renderers the human-review flags as finished sentences ("fee for Day 2 was assessed before E9 reversed E7 ..."), and the text and table renderers took those sentences apart again with regular expressions to group them by reversal. Dropped during review: text is not an interface between two parts of the same program, and a change of wording would have broken the grouping silently. Replaced by a structured record per flagged fee (account, fee day, fee amount, reversing event, reversed event, closing balance now) that the renderers turn into text themselves.
