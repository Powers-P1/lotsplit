# LOTSPLIT

Sell the whole lot. Agree who takes what. Get paid by each buyer.

LOTSPLIT helps one seller sell a mixed lot to a small group. Buyers confirm complete baskets they would actually accept. An AI agent checks conflicts and proposes a specific, feasible question; it cannot accept goods, raise a budget or make a payment. An exact solver assigns every item once. Each buyer separately approves their exact purchase, authorises PayPal Sandbox and pays their own fixed amount. The seller prepares one pickup only after all captures are confirmed.

This is the accepted V2 concept and interface: English, mobile first, open rows, restrained typography and photographic goods. It supports an own empty catalogue of 1–24 priced positions, 2–6 active buyers and up to two complete acceptable options per buyer. Item counts can differ. Prices are fixed before private spending limits are entered. This is one configured seller/workspace, without a marketplace, shipping service, AI valuation or production escrow.

## Run

Use Node.js 24 and npm:

```sh
npm ci
npm run build
npm start
```

The default is a no-key rehearsal at http://127.0.0.1:4319. Copy `.env.example` to `.env` only if configuration is needed (`Copy-Item .env.example .env` in PowerShell). A private `.env.local` takes precedence. Set `NODE_ENV=production` for the compiled server; `npm run dev` is available for development.

Windows can run the compiled application in explicitly separate local modes:

```powershell
./scripts/start-local.ps1 -Mode rehearsal
./scripts/start-local.ps1 -Mode sandbox
```

These use ports 4319 / 4320 and separate `data/v2-local-rehearsal` / `data/v2-local-sandbox` directories. Each instance has a distinct cookie. Ordinary tabs on the same instance still share a login; use separate browser profiles for simultaneous buyers. Rehearsal's Demo controls let reviewers switch roles sequentially.

## Review the purchase flow

1. Open an example as Alex, or choose **Create a lot**. An own lot starts with zero catalogue items. Upload a PNG/JPEG/WebP up to 8 MB; AI item suggestions remain unconfirmed. Add only real catalogue positions, inspect names/condition and set positive fixed prices whose sum equals the lot price. Confirm the catalogue.
2. Set buyer names/emails before issuing invitations or receiving options. Each buyer describes their needs or chooses items manually, reviews the proposal and explicitly saves one or two complete baskets. Their maximum spend and original private description are not shown to other buyers or the seller.
3. Check the complete plan. In the workshop example, Marta and Jan initially want the same cordless kit. **Ask AI to check a question** can propose Jan's corded drill and extension reel after using the catalogue, conditions, candidate-check and comparison tools. The seller sends the checked question inside the workspace; the buyer may accept or refuse. No email is sent.
4. Send a complete plan for approval. All buyers must separately approve unchecked exact-purchase terms before any authorisation. A saved option is not purchase consent.
5. Each buyer follows **Continue with PayPal**. In rehearsal this opens a clearly labeled simulation; Sandbox uses actual PayPal test checkout. Only all valid exact holds allow the seller to collect payments. The deadline is at most 24 hours from the first authorisation, capped by the seller's deadline.
6. A withdrawing buyer requires repair. Exact unchanged V2 baskets/terms may retain the same consent and authorization; changed or withdrawn baskets require cancellation and fresh approval/authorization. Unresolved previous financial operations block collection.
7. Captures are separate, non-atomic operations. An unknown response pauses progress and checks the same saved operation. A failure stops later captures, refunds confirmed captures and cancels remaining holds. Pending never means confirmed. Physical preparation remains blocked.
8. After all captures are confirmed, inspect each physical basket and mark it prepared. Payment confirmation does not mark goods prepared or prove handover.

## Different examples

| Example | Positions | Buyers | Whole lot |
| --- | ---: | ---: | ---: |
| Office clearance | 15 | 4 | 3,140 PLN |
| Garage sale | 9 | 3 | 1,035 PLN |
| Café closure | 18 | 5 | 3,550 PLN |
| Workshop clearance | 12 | 4 | 1,800 PLN |

Inventories and photos are fictional demonstrations. Prepared scenarios replace only rehearsal data. Sandbox has no scenario/reset shortcuts. The examples are not the only supported inventory.

## Configuration and access

All credentials remain server-side. Never use a `VITE_` prefix for secrets or commit `.env*`, `data`, payer credentials or sign-in links.

| Variable | Purpose |
| --- | --- |
| `APP_MODE` | `rehearsal` (default) or `sandbox`; no Live PayPal mode. |
| `HOST`, `PORT`, `APP_ORIGIN` | Bind address, port and exact browser-visible return origin. |
| `NODE_ENV` | `production` for the compiled server. |
| `DATA_DIR` | Persistent SQLite and uploaded-photo directory; separate each workspace. |
| `SESSION_COOKIE_NAME` | Optional instance override; V2 defaults are mode-specific. |
| `ORGANIZER_ACCESS_TOKEN` | Sandbox seller access; otherwise privately generated in `DATA_DIR/organizer-access-v2.json`. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Existing Sandbox REST application credentials. |
| `PAYPAL_WEBHOOK_ID` | Registered Sandbox webhook used for signature verification. |
| `NEBIUS_API_KEY`, `NEBIUS_BASE_URL` | Token Factory access; default API base is in `.env.example`. |
| `NEBIUS_TEXT_MODEL`, `NEBIUS_VISION_MODEL` | Verified models: `nvidia/nemotron-3-super-120b-a12b` and `nvidia/Nemotron-3.5-Super-VL`. |
| `NEBIUS_ENV_FILE` | Optional private file importing only `NEBIUS_*` variables. |
| `AI_DAILY_REQUEST_LIMIT` | Global configured-provider daily cap; default 100, plus minute throttling. |
| `JUDGE_ACCESS_USERNAME`, `JUDGE_ACCESS_PASSWORD` | Optional private hosted-review gate; configure both together. |

Without Nebius, rehearsal explicitly identifies prepared sample AI; it does not claim to interpret the supplied input. Sandbox returns unavailable instead. With a configured provider, errors remain errors. Uploaded photos are stored once behind authenticated server URLs; their binary content is not copied into every state response.

V2 uses `lotsplit-v2-rehearsal.sqlite` / `lotsplit-v2-sandbox.sqlite`. Historical V1 stores are not migrated or overwritten. Use a new DATA_DIR for another Sandbox lot once financial history exists; never reset a real Sandbox ledger to replay the demo.

See [judge access](docs/judge-access.md), [accepted design and stories](docs/design-v2.md), [current verification](docs/verification.md) and [historical verification](docs/history/verification-through-2026-10-30.md). The [final English film](https://youtu.be/gUwv5R6rCww) shows this V2 flow. See [publication checklist](docs/submission-checklist.md) for the release and judging-access status; a video publication alone is not contest submission.

## Verification

```sh
npm run typecheck
npm run build
npm test
```

The V2 build passed 123 tests after the jury corrections, repeated with full typecheck and production build on 1 November 2026. Source-grounded exclusions remain editable before saving; the catalogue advances through individual confirmations, and the assistant avoids inventing a conflict when a complete plan exists. Separately, actual Nebius requests, genuine browser Sandbox approvals, preserved holds, four captures totaling 1,800 PLN and an isolated 380 PLN refund / 1,420 PLN hold cancellation flow were verified. Transport loss was deliberately injected into the isolated failure test; real PayPal GETs confirmed the resulting resources. One test payer served multiple logical buyers. These are test funds, fictional inventory and local integration evidence, not real buyers, production readiness or completed physical pickup.

React 19, Vite 8, TypeScript, Express 5 and Node 24 SQLite run in one process. The older V1 UI remains an isolated legacy path; its AG Grid chunk is lazy and is not requested by V2. Generated media provenance is recorded in `docs/v2-assets.json`; assets are distinct from the accepted design reference images.
