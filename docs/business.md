# Business assumptions and pilot plan

Status: **unvalidated hypotheses, 1 November 2026**. This note adds a testable business case; it does not report real-user interviews, willingness to pay, a live sale or proven ROI.

## Intended user and payer

The initial target is a **professional clear-out seller** handling a small office, workshop or café lot, with an already interested group of buyers. The seller wants the whole lot allocated and one pickup arranged; buyers want complete baskets they actually accept. LOTSPLIT coordinates that existing group rather than finding buyers or operating a marketplace.

**Pricing hypothesis:** the seller would pay a per-lot service fee if it saves enough coordination effort, reduces leftovers or makes withdrawal repair easier. The amount, charging trigger and willingness to pay are not established. Buyers' fixed item prices are payment for the goods, not LOTSPLIT revenue. The prototype does not currently charge a service fee.

PayPal supplies individual Sandbox approvals and recorded payment states. AI turns natural-language needs into editable proposals and drafts an alternative question after application checks. People decide which goods to accept and whether to purchase. The exact allocation checker, consent history and payment gates turn those decisions into an inspectable plan. These are demonstrated product capabilities; their commercial value remains to be measured.

## Existing approaches and comparison scope

| Approach | Documented job / current process | LOTSPLIT's proposed contribution |
| --- | --- | --- |
| Group chat + spreadsheet + individual payments | An organizer records wishes, negotiates changes and manually reconciles item assignments, exact terms and payment status. This is the proposed pilot baseline, not an observed customer study. | Keep complete basket options, full catalogue coverage, exact purchase consent and provider operations in one stateful workflow; repair changes without silently altering unchanged commitments. |
| Splitwise | Adds and splits expenses, tracks balances and supports settling up; supported payment methods vary by country. [Official getting-started guide](https://kb.splitwise.com/getting-started/how-do-i-use-splitwise) | Focus on agreeing who takes each physical item before a whole-lot purchase, then preserving the connection between that basket and each payment. |
| PayPal pools | Collects contributions for group purchases or shared activities; the help page states that pooled money belongs to the pool creator. [Official help](https://www.paypal.com/us/cshelp/article/what-are-pools-help1197), [US product page](https://www.paypal.com/us/digital-wallet/send-receive-money/pool-money) | Focus on separate buyer baskets and exact authorizations/captures to the configured seller, with repair and compensation states tied to those baskets. |
| Auction lots, illustrated by HiBid's terminology | Auctions use lots, bids, winning buyers and payment/pickup terms. [Official terminology](https://help.hibid.com/en/articles/11533716-auction-terminology) | The current prototype uses seller-reviewed fixed prices and a known group's acceptable baskets; it does not implement an auction or price discovery. |

This compares the documented core jobs with the scoped prototype. It is not an exhaustive market survey or a claim that no other product supports a similar workflow. US PayPal pages do not establish local availability in every pilot country.

## Costs and dependencies

| Item | Current evidence / uncertainty |
| --- | --- |
| Paid Sandbox hosting | Observed configuration: USD 7/month compute + USD 0.25/month for a 1 GB disk = **USD 7.25/month** before additional charges. The separate free replay service is USD 0. [Deployment](deployment.md) |
| Render account credits | **USD 50 already applied**. This is account credit, not revenue, an approved investment or a won hackathon prize. Remaining balance and final billed totals are not reported here. |
| AI inference | Real NVIDIA/Nebius calls are used, but actual tokens, dollars and latency **per completed lot have not been metered as a business unit**. Each hosted service has a 20-request daily abuse cap; that is not a per-lot cost estimate. |
| Payments | PayPal is Sandbox-only and all demonstrated amounts are test funds. Production transaction fees, refund/dispute costs and payment failure rates have not been measured; Sandbox totals are not sales revenue. |
| Operations | Seller onboarding, catalogue review, buyer support, access, hosting/storage, recovery and reconciliation require time. No support-cost estimate or production service level has been validated. |
| Production readiness | Merchant onboarding and permissions, identity, fraud/dispute handling, privacy and retention, consumer terms and applicable legal requirements need a separate production assessment. Those are outside the hackathon prototype. |

The prototype has one configured seller/workspace, 1–24 positions, 2–6 active buyers and at most two complete options per buyer. Captures are separate, non-atomic operations; LOTSPLIT does not establish escrow, production payment readiness or completed physical handover. Buyer discovery and shipping are outside scope.

## Proposed pilot — not yet run

Recruitment or outreach has not been authorized or performed as part of this work. The next proposed validation is **one actual seller and an already interested group**, with permission to observe their process.

1. Record the lot, participants, starting conditions and a comparable manual baseline. Start payment testing in Sandbox; separately identify any real-world agreement or handover.
2. Measure time from a reviewed catalogue to a complete, explicitly accepted plan, and the organizer's active coordination time. Record incomplete or failed attempts as well as successes.
3. Count unsold/unassigned positions and record why a complete agreement was or was not reached.
4. Observe an authorized withdrawal or a clearly labelled rehearsal. Measure repair time, affected baskets, new approvals required and preserved unchanged commitments.
5. Ask the seller what they would pay, why and under which charging condition. Record objections and a refusal to pay; a stated preference is not a completed purchase.
6. Log actual model usage, elapsed time, hosting allocation and human support per attempt before choosing a price or projecting margins.

One pilot provides descriptive evidence, not a general conversion, revenue or ROI claim. Decide whether to continue or revise the target and per-lot hypothesis from the observed result.

The public landing page and optional reactive guided demonstration are pending release verification. They are intended to explain and introduce the existing workflow; they do not themselves supply customer validation or change the core payment/AI logic.
