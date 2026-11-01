# Accepted LOTSPLIT V2 implementation contract

Source: accepted `outputs/LOTSPLIT/14-design-v2` (28 screens, 18 stories), 31 October 2026.

The application sells one mixed lot from one configured seller. Two to six active buyers confirm at most two complete acceptable baskets each. Up to 24 individually identified items have fixed prices before buyer budgets are entered. An exact bounded search assigns every item once; incomplete search never means infeasible. No marketplace, AI valuation, buyer discovery or delivery service is included.

## Design system

- White `#FFFFFF`; ink `#1D2823`; forest `#244B3B`; muted `#727A75`; dividers `#E4E9E5`.
- Inter, headings 30–36 px on desktop / 28–32 px mobile, body 16 px, labels 13–14 px. Wordmark spaced uppercase. Control typography explicit.
- Mobile content width 400 px, 24 px side gutters, open rows and thin separators. Desktop working area up to 1120 px; tables remain tables with a readable mobile continuation. One primary action per step, 48 px minimum button height, 6–8 px radii, no decorative dashboard cards.
- Photographic lot/item media, natural colour, no overlays. Outline icons at 18–22 px, 1.6–1.8 px stroke; meaningful semantic status symbols.
- Exact accepted headings and actions include “Sell the whole lot.” / “Create a lot”, “Check your catalogue”, “What do you need?”, “Check your basket”, “One answer could unblock this lot”, “Review the complete plan”, “Approve your purchase”, “Authorise your basket”, “Prepare one pickup”.
- Sandbox/rehearsal identification remains visible and truthful. Loading, validation, connection uncertainty, expired invitation and saved-state feedback use shared primitives.

## Implementation boundaries

- The V2 protocol is explicit. Historical V1 data and financial proof stay in their original stores. New runtimes use separate V2 stores; old plan consents cannot be promoted into V2 consents.
- Acceptable options, exact purchase consent, PayPal authorisation, capture and physical preparation are distinct transitions. No prechecked consent. An AI proposal never becomes an accepted option automatically.
- AI may read the confirmed catalogue/options and run bounded allocation/candidate/comparison tools. Its tool surface has no consent, payment, invitation delivery or budget-changing operation. Checked questions are invalidated when their context changes.
- Exact unchanged commitments may survive a new plan only with the V2 contract and identical own item details, amount, currency, payer role, configured merchant, group price/deadline/pickup. Changed/withdrawn holds are cancelled; unresolved old financial operations block new capture. First authorisation starts a maximum 24-hour completion window, bounded by seller deadline.
- Operations persist a frozen request and idempotency key before dispatch. Unknown results reconcile existing operations. Partial failure stops later captures and physical preparation, refunds confirmed captures and voids remaining holds. Pending remains pending.
- One pickup is prepared manually only after every active capture is confirmed. Paid, prepared and collected are separate facts. MVP does not claim physical delivery verification.

## Story ownership

US-01/02 seller setup and editable catalogue; US-03 invitation privacy; US-04 complete basket options; US-05 checked agent questions; US-06 exact plan; US-07/08 explicit purchase consent and progress; US-09 exact PayPal hold; US-10/11/12 withdrawal and selective repair; US-13 capture gates; US-14 reconciliation; US-15 compensation; US-16 pickup; US-17 infeasible versus incomplete; US-18 expiry and hold cancellation.
