# Rejected

Two kinds of entries: acceptance criteria from the brief that I refuse, with the reasoning, and approaches I abandoned during the build.

Amounts are in minor units: AED fils (100 per dirham) and BHD fils (1,000 per dinar). Criteria are numbered in the order the brief lists them. "View B" means fees are recalculated by value date: when a back-dated entry arrives, every day from its value date onward is re-evaluated, and a fee is assessed for any day that is now negative and was not already charged.

## Criteria refused

### Criterion 6: "After E9, all balances and fees return to their pre-E7 values."

**Refused.** Balances do not return, and fees cannot.

E9 reverses E7: it posts a 62,000 AED fils credit value-dated Day 2, the mirror of E7's debit. That cancels E7's amount and nothing else. The three overdraft fees that E7 caused (Days 2, 4 and 5, 2,500 AED fils each, under View B) are entries in their own right. They stay in every closing balance from their value date onward. Nothing in the rules un-assesses a fee, and the stream contains no refund event.

The numbers, ACC-001 before interest:

| | Day 6 closing (AED fils) | Fees booked |
| --- | --- | --- |
| If E7 had never happened | 46,500 | none |
| After E7 and E9 | 39,000 | 3 × 2,500 = 7,500 |

The gap is exactly the fees.

Even if the fees were refunded by new credit entries, the ledger would not "return" to anything: it is append-only (rule 4), so it would hold E7, E9, three fees and three refunds. Balances could match the pre-E7 figures; the record never could. The criterion asks for a reset, and an append-only ledger has no reset.

What does hold after E9: E7's principal is cancelled, and the interest accruals for Days 2 to 5 are recomputed from the restored balances, because accruals are not booked until Day 6.

### Criterion 7: "The three BHD instalments in E10 must each be BHD 3.334."

**Refused.** 3 × 3,334 = 10,002 BHD fils, but E10 is a credit of 10,000. The criterion would credit 2 fils that were never paid in, and the ledger would no longer balance against the source of the money.

10,000 is not divisible by three in fils (BHD has three decimals, so 1 fils is the smallest unit). The split is 3,333 + 3,333 + 3,334 = 10,000, with the 1 fils remainder on the last instalment. "Equal instalments" means as equal as the currency's precision allows, never more than the whole.

## Approaches abandoned during the build

None yet.
