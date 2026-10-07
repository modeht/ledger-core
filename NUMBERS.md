# Numbers

Every constant in the ledger, where it comes from, and why that value rather than another. Amounts are in minor units: AED fils (100 per dirham) and BHD fils (1,000 per dinar).

| Constant | Value | Source | Why this value and not half it |
| --- | --- | --- | --- |
| Overdraft fee, AED | 2,500 fils | Rule 1 (the overdraft fee): AED 25.00 | Given. Half (1,250) would not be the rule. The fee is defined per currency; no other currency has a value, and an account in such a currency closing negative is an error, not a converted fee. |
| Overdraft fee, BHD | none | Not given | Same as the row above: the fee is defined per currency, and no BHD value was given, so a BHD account that closes negative is reported as an error. |
| Daily interest rate | 4 per 10,000 (0.04%) | Rule 2 (daily interest) | Given. Stored as the pair (4, 10,000) so the accrual is integer arithmetic: balance × 4 ÷ 10,000. Never stored as the float 0.0004. |
| Interest rounding | nearest fils, ties up | Chosen | Rounding down every day always favours the bank; nearest is fair on average and is what a statement shows. Ties-to-even gives the same result on this stream (no accrual lands on .5). |
| Rounding offset | +5,000 before ÷ 10,000 | Derived | Half of the divisor; implements "nearest, ties up" in integers: (balance × 4 + 5,000) ÷ 10,000, rounded down. |
| Capitalized interest | sum of the rounded daily accruals | Rule 2 (daily interest) | The rule requires the dailies to sum exactly to the total; defining the total as that sum makes it true by construction. For this stream: ACC-001 93 fils, ACC-002 8 fils. |
| Interest on negative balances | 0 | Rule 2 (daily interest): positive balances only | Given. No debit interest exists in this ledger. |
| AED precision | 2 decimals, 100 fils per dirham | Rule 3 (precision) | Given. |
| BHD precision | 3 decimals, 1,000 fils per dinar | Rule 3 (precision) | Given. |
| Overdraft limit | 0 | Rule 5 (authorization approval) | An authorization needs available balance ≥ 0 after the hold; that is an overdraft limit of zero. Any other value would let the account go negative by authorization, which the rule forbids. |
| Fees per day per account | at most 1 | Rule 1 (the overdraft fee): "once per day per account" | Given. |
| Window | Day 1 to Day 6 | Brief | Given. Capitalization happens on the last day of the window. |
| Instalment count for E10 | 3 | Event stream | Given. 10,000 ÷ 3 = 3,333 remainder 1; the remainder goes to the last instalment, so the parts sum to the whole. |
| Back-dating limit | none | Chosen | The brief back-dates three days (E7, E9 to Day 2) and sets no limit. A production ledger would cap this; here any value date ≥ Day 1 and ≤ the current day is accepted. |
| Hold expiry | none | Chosen | Not in the brief. Auth-B would stay active until explicitly settled or reversed if it had been approved; it was declined. |
