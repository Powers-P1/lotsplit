# LOTSPLIT

**Sell the whole lot. Agree who takes what.**

## Inspiration

One seller. One mixed lot. Four people who want different things.

A workshop owner wants everything collected together. Marta needs the cordless set; Jan wants a drill; two other buyers want the furniture and storage. A group chat can collect their wishes. It cannot reliably establish that every item has a buyer, everyone accepts their exact basket, and every payment has actually completed — especially when someone leaves.

LOTSPLIT turns that fragile conversation into one reviewable group purchase. It serves a seller and an already interested group, rather than trying to build another marketplace.

## What it does

The seller reviews the catalogue and fixes each item's price before buyers enter private spending limits. Buyers can describe what they need and confirm up to two complete baskets they would accept. Baskets can have different sizes; an acceptable option is never split into unwanted fragments.

When two buyers want the same cordless set, the exact allocation checker tests their confirmed alternatives and limits. AI turns a checked alternative into a useful question: would Jan accept a corded drill and extension reel for PLN 190? The seller sends it. Jan can accept or refuse. Only after he adds that option can all twelve positions be assigned exactly once.

Each buyer then explicitly approves their exact basket, amount and pickup terms, and separately authorizes PayPal Sandbox. Saving a preference is not purchase consent. An authorization is not a completed payment.

If someone leaves, unchanged exact commitments can be kept. Changed baskets need fresh consent and authorization; withdrawn or obsolete holds must be cancelled. The seller can collect only when all required holds are ready. Preparation opens only after every capture is confirmed.

This is useful beyond collections: office clear-outs, workshop equipment, café assets and mixed garage-sale lots. The prototype accepts a seller's own catalogue, with 1–24 positions, 2–6 buyers and up to two acceptable complete baskets per buyer. Its examples are starting points, not a fixed assortment.

## Why AI and PayPal belong here

AI translates natural-language needs into a visible, editable basket proposal and exclusions. It also drafts a bounded question about an alternative checked by application logic. A vision model suggests unconfirmed catalogue entries from a supplied photo. People review the results, set prices, choose baskets and decide whether to buy. AI cannot increase a budget, consent to a purchase or move money.

PayPal is the commitment and payment layer: individual Sandbox approvals, authorizations, captures, cancellations and refunds. The application preserves the connection between exact basket terms and each provider operation.

Captures are separate, non-atomic payments. An uncertain response is reconciled against the saved operation rather than blindly repeated. A partial failure stops later captures and requires confirmed refunds or cancellations. These are not escrow or an atomic group charge.

## How we built it

React, TypeScript and Vite provide the English mobile-first interface. Express and Node.js 24 serve the application. SQLite persists versioned basket terms, consent, sessions, frozen payment commands and idempotency keys. Server-side Nebius inference runs NVIDIA Nemotron text and vision models. PayPal Orders v2 and Payments v2 run only against Sandbox; provider credentials stay on the server. The complete source is available under the MIT license. OpenAI Codex assisted development.

## What we verified

The current source passes 125 automated tests, client/server type checks and a production build, including a clean installation. Browser checks covered uploaded inventory, different catalogue sizes, correction of AI exclusions, private limits, exact consent, selective plan repair, incomplete allocations, expiry and preparation.

The final film follows a real Sandbox run repaired from Plan 1 to Plan 2. Marta keeps her PLN 380 basket and Oskar keeps PLN 510. Jan approves PLN 430 and Nina PLN 480. Four provider-confirmed captures total PLN 1,800 for twelve positions.

On 1 November, the deployed Render service repeated the selective repair and four captures totalling PLN 1,800. It accepted 18 verified PayPal webhook events and retained the completed financial ledger across restart. A fresh judging workspace is kept separately from that evidence.

A separate controlled provider-failure test verified reconciliation and compensation. The film's failure section is explicitly labelled as a simulation; it is not footage of those real refunds. One Sandbox payer represents the fictional buyers. Inventory and roles are fictional, funds are test funds, and no physical pickup is claimed. Photorealistic introductory scenes are AI-generated illustrations; application footage shows the working prototype.

## The difficult part

A group agreement changes. A commitment cannot quietly change with it.

We learned to preserve unchanged exact commitments while cancelling obsolete ones, to keep uncertain provider states uncertain until verified, and to expose AI interpretations for correction. The challenge was coordinating those boundaries without making buyers manage payment infrastructure.

## What's next

Test the workflow with one real seller and an already interested group. Measure time to a complete agreement, unsold leftovers and the effect of a buyer withdrawing. Real-customer validation, production payments, identity verification, shipping and buyer discovery remain outside this hackathon prototype. Preparation is a manual step and does not prove a completed handover.

## Hosted judging access

The application is deployed on Render. [The replayable demo](https://lotsplit-demo.onrender.com) uses real server-side AI and explicitly simulated payments; its free instance may take 50+ seconds to wake. [The separate PayPal Sandbox workspace](https://lotsplit.onrender.com) uses genuine test checkouts and persistent SQLite storage. Login and test-payer instructions are provided only in the private judging field. No provider API key is published.

## Try it

- [Watch the final English demonstration](https://youtu.be/gUwv5R6rCww) — 2:50 source duration.
- [Source and setup](https://github.com/Powers-P1/lotsplit) — MIT, Node.js 24.
- [Step-by-step review instructions](https://github.com/Powers-P1/lotsplit/blob/main/docs/judge-access.md) — includes a free, no-key rehearsal with clearly labelled simulations.
