# LOTSPLIT

**Sell the whole lot. Agree who takes what.**

## Inspiration

A seller wants to clear an entire mixed lot. An already interested group wants different parts: the drill, the workbench, the cabinet. A group chat can discuss those wishes, but it does not establish a complete, affordable allocation, exact purchase consent or a reliable payment state when someone leaves.

LOTSPLIT coordinates that purchase for one seller, a small group and one pickup. The prototype does not discover buyers or claim to replace a marketplace.

## What it does

The seller reviews the catalogue and fixes each item's price before buyers enter private spending limits. Each buyer confirms up to two complete baskets they would accept. Items and basket sizes can differ; an option is never broken into unwanted fragments.

AI translates a buyer's description into a reviewable basket and exclusions. A separate exact checker tests full allocations and alternative baskets against confirmed choices and limits. If two buyers want the same cordless set, AI drafts a question about a checked alternative: would Jan accept a corded drill and extension reel for PLN 190? The seller sends it; Jan can accept or refuse. Only after he adds that option can all twelve positions be allocated once. AI cannot approve a purchase, widen a budget or move money.

Each buyer then explicitly approves their own exact basket, amount and pickup terms, and separately authorizes PayPal Sandbox. Saving an option is not purchase consent, and an authorization is not a completed payment.

If a buyer leaves, unchanged exact commitments can be kept. Changed or withdrawn baskets require cancellations and fresh consent/authorization. Unresolved operations block collection. The seller can collect only when all required holds are ready. Captures are separate, non-atomic payments; an uncertain result is reconciled against the saved operation rather than blindly repeated. A partial failure stops later captures and requires confirmed refunds/cancellations. Physical preparation is a separate, manual step after all captures are confirmed.

## How we built it

React, TypeScript and Vite provide the English mobile-first interface. Express and Node.js 24 serve the API and compiled application. SQLite persists versioned baskets and consent, sessions, frozen provider commands and idempotency keys. The accepted V2 interface uses open rows and focused buyer views; the older AG Grid interface is a separate legacy path and is not presented as the current sponsor contribution.

Actual server-side Nebius inference uses NVIDIA Nemotron for preferences and the bounded question agent, and a vision model for unconfirmed catalogue suggestions from uploaded photos. The exact allocation checker is application logic, not an LLM guarantee. PayPal Orders v2 and Payments v2 run only against Sandbox. Provider secrets stay on the server.

The repository contains a Node 24 Docker build and a single-instance Render configuration with persistent storage. A configuration file alone is not a deployment or evidence of using Render Workflows. The publication record will identify the actual deployed service and private testing access when verified. OpenAI Codex assisted development.

## What we verified

The current application passed 123 tests, client/server type checking and a production build. Browser verification covered own uploaded inventory, different catalogue sizes, correction of AI exclusions, exact consent, private limits, selective repair, incomplete checks, expiry and preparation.

Separate real integration runs verified live AI, actual PayPal Sandbox approvals, voids and captures. The final film follows a workshop purchase repaired from Plan 1 to Plan 2: Marta PLN 380 and Oskar PLN 510 keep their unchanged commitments; Jan approves PLN 430 and Nina PLN 480. Four provider-confirmed captures total PLN 1,800. A separate controlled provider-failure test verified reconciliation and compensation; the film's failure section is an explicitly labelled simulation, not footage of those real refunds.

One Sandbox payer represents multiple fictional buyer sessions. Inventory is fictional, test funds are used, and no physical handover or real-customer/ROI validation is claimed. See [verification](verification.md) for exact boundaries.

## Challenges and lessons

The difficult part was preserving the meaning of a commitment while a group plan changes. A buyer's unchanged basket can remain valid, but a changed amount, goods or shared pickup terms cannot inherit consent. Unknown provider responses and pending compensation must remain uncertain until verified. AI interpretations must remain visible and editable instead of silently excluding goods.

## What's next

Validate the workflow with one real seller and an already interested group: measure time to a complete agreement, unsold leftovers and the effect of a buyer withdrawing. Production payments, identity verification and broader marketplace operations are outside this hackathon prototype.

## Try it

- [Final demonstration](https://youtu.be/gUwv5R6rCww) — English; source duration 2:50.
- [Source](https://github.com/Powers-P1/lotsplit) — MIT.
- [Local run and review instructions](judge-access.md) — Node 24, npm ci, npm run build, npm start; no-key rehearsal is clearly simulated.
- Full live-provider testing uses the separately supplied private judge access; provider credentials are not published in this repository.

## Scope

One configured seller/workspace, PLN, 1–24 catalogue positions, 2–6 buyers and at most two complete acceptable options per buyer. Prices precede private budgets. Examples: Office 15/4/3140 PLN; Garage 9/3/1035 PLN; Café 18/5/3550 PLN; Workshop 12/4/1800 PLN. These are sample data, not the only supported assortment.

Separate payments are not escrow or an atomic group charge. No shipping, buyer discovery, production identity verification or automatic spending. Invitations display a private one-use link in the requesting browser and do not send email. Preparation does not prove a completed pickup.
