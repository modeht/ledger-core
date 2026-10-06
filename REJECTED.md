# Rejected

Two kinds of entries: acceptance criteria from the brief that I refuse, with the reasoning, and approaches I abandoned during the build.

Amounts are in minor units: AED fils (100 per dirham) and BHD fils (1,000 per dinar). Criteria are numbered in the order the brief lists them. "View A" and "View B" are defined at the top of AMBIGUITIES.md.

## Criteria refused

### Criterion 6: "After E9, all balances and fees return to their pre-E7 values."

**Refused.** Balances do not return, and fees cannot.

E9 reverses E7 (AMBIGUITIES.md, entry 2): it posts a 62,000 AED fils credit value-dated Day 2, the mirror of E7's debit. That cancels E7's amount and nothing else. The three overdraft fees that E7 caused (Days 2, 4 and 5, 2,500 AED fils each, under View B) are entries in their own right. They stay in every closing balance from their value date onward. Nothing in the rules un-assesses a fee, and the stream contains no refund event.

The numbers, ACC-001 before interest:

| | Day 6 closing (AED fils) | Fees booked |
| --- | --- | --- |
| If E7 had never happened | 46,500 | none |
| After E7 and E9 | 39,000 | 3 × 2,500 = 7,500 |

The gap is exactly the fees.

Even if the fees were refunded by new credit entries, the ledger would not "return" to anything: it is append-only (rule 4), so it would hold E7, E9, three fees and three refunds. Balances could match the pre-E7 figures; the record never could. The criterion asks for a reset, and an append-only ledger has no reset.

What does hold after E9: E7's principal is cancelled, and the interest accruals for Days 2 to 5 are recomputed from the restored balances, because accruals are not booked until Day 6.

## Approaches abandoned during the build

None yet.
