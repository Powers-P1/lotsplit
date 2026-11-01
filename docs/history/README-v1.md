# LOTSPLIT

LOTSPLIT helps a group buy a whole bundle that a seller offers only together, even when it mixes a bicycle, a guitar, tools, electronics and household goods. An organizer confirms the items and fixed price shares; buyers choose preferred items, acceptable alternatives and a total spending cap. A deterministic solver produces a complete plan, each buyer accepts exact terms, and PayPal Sandbox authorization and capture happen as separate steps.

Six complete rehearsal examples show the same process with a mixed garage-sale bundle, a small company's office assets, workshop equipment, used vinyl, books and collectible illustrations. Each uses 24 items, four buyers and six items each; the examples have their own prices and budgets. Nebius helps read a photo and propose preferences; a person reviews the results. AG Grid supports the organizer's tables. React, Vite and Express run in one Node.js 24 process, with persistent SQLite storage.

## Run locally

Install **Node.js 24** and npm. No separate database is needed.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:4319](http://127.0.0.1:4319). The default mode is rehearsal and works without payment credentials. Choose Kasia for the organizer or a buyer such as Maja. Use independent browser profiles or different browsers when reviewing multiple people; ordinary tabs share one login. The product UI defaults to English, as do the README and submission materials.

For complete Windows/macOS/Linux setup, a short no-key review, the compiled build, and separate live-provider configuration, see [judge setup and access](docs/judge-access.md). The no-key rehearsal is free to run; private live-integration judging access is tracked separately and is not implied by optional own-account instructions.

| Mode | Payments | AI |
| --- | --- | --- |
| `APP_MODE=rehearsal` | Clearly labeled local simulations; no PayPal requests. Scenario controls support reviewing success, an unknown result, recovery and a changed plan. | Real Nebius calls when configured; provider errors stay errors. Without a provider, explicitly labeled sample proposals are used; they do not parse the supplied photo/text. |
| `APP_MODE=sandbox` | Real requests to PayPal's test environment and genuine Sandbox buyer approvals. No live-money endpoint is enabled. | Real Nebius calls when configured; unavailable when no key is supplied. |

A seeded catalog or rehearsal payment is demonstration data. It is not proof of a successful AI request or PayPal transaction.

## Six rehearsal examples

| Example in the English UI | Contents | Fixed item shares + shared cost | Total |
| --- | --- | --- | --- |
| **Garage Sale** | A mixed bundle including a bicycle, guitar, drill, tent, console, furniture, appliances, plant and sports equipment; the fresh-rehearsal default. | PLN 2580 + 240 | PLN 2820 |
| **Small Business Clearance** | A fictional office's computers, furniture, printers, networking and back-room equipment offered together before its lease ends. | PLN 4320 + 480 | PLN 4800 |
| **Workshop Equipment** | Power tools, hand tools, measurement equipment and accessories with individual condition notes. | PLN 1420 + 160 | PLN 1580 |
| **Second-Hand Vinyl** | Used records spanning jazz, soul, rock and electronic music. | PLN 720 + 120 | PLN 840 |
| **Moving-Day Bookshelf** | Novels, illustrated guides, practical books and popular science. | PLN 720 + 120 | PLN 840 |
| **Collectible Illustrations** | The original illustrated collectible cards from Kasia's collection. | PLN 720 + 120 | PLN 840 |

The welcome screen opens the garage-sale, company-asset and workshop examples in one click as Kasia. **Try the demo → Choose a bundle** offers all six. Each example has its own images, item names, descriptions and condition notes. The mixed garage-sale and office bundles show why the seller's whole lot may have several buyers who want different parts. All examples run through catalog review, fixed shares, preferences and alternatives, allocation, exact consent, simulated payments, replacement planning and packing. The 24/4/6 scope stays fixed while contents, prices and buyer budgets vary.

**Small Business Clearance** is the name of an inventory example using the same bundle-purchase flow. LOTSPLIT does not provide billing, invoice processing or a company-liquidation system.

Changing the example starts a fresh **rehearsal** and replaces its saved choices, consents, simulated payment operations and packing state. Prepared scenarios retain the selected example. These controls are unavailable in Sandbox; they never reset or replace a Sandbox collection or its payment history. Existing rehearsal data retains its saved example until it is explicitly changed.

All catalog images and inventory descriptions are fictional demonstration material; see [asset provenance](docs/assets.md). The additional examples do not constitute new live AI or PayPal purchases.

The complete Sandbox UI purchase proof is tied to application `ce58fff` (73-test source): four exact consents, genuine approvals, four authorizations and completed captures of PLN 180/210/220/230, totaling PLN 840. Ola/Bartek/Jan had clean returns; Maja required a guarded same-operation/key recovery after an initial dispatch failure of unknown precise cause. One test payer served four logical buyers. Packing unlocked; no real-purchase package was marked packed or shipped. See [verification](docs/verification.md) for historical boundaries and later isolated void/refund probes.

Live Nebius text preferences and a vision request also passed through the application. Vision processed one uploaded demonstration item image and returned an unconfirmed proposal; the 24-item catalog was reviewed separately and was not generated by that request. Both AI paths require human confirmation. See the [verification record](docs/verification.md) for the exact tested boundaries and response traces.

## Configuration

Use `.env` for your local configuration. An existing `.env.local` takes precedence; `.env` fills values that are not already set. Keep API credentials on the server and out of source control. Do not prefix secrets with `VITE_`.

| Key | Purpose |
| --- | --- |
| `APP_MODE` | `rehearsal` by default; set `sandbox` for the PayPal integration. |
| `HOST`, `PORT` | Local example: `127.0.0.1`, `4319`. Hosted services must bind to `0.0.0.0` and the supplied `PORT`. |
| `NODE_ENV` | Set `production` when running the compiled build. |
| `DATA_DIR` | Writable directory for SQLite; local example `./data`. The application uses distinct database files for rehearsal and Sandbox. |
| `APP_ORIGIN` | Browser-visible origin used in payment return URLs; defaults to `RENDER_EXTERNAL_URL` on Render, otherwise the local port. |
| `ORGANIZER_ACCESS_TOKEN` | Private organizer invitation for Sandbox. When omitted, a random token is saved in `DATA_DIR/organizer-access.json`. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Credentials for a **Sandbox** REST app; needed in Sandbox mode. |
| `PAYPAL_WEBHOOK_ID` | ID of a registered Sandbox webhook; required to verify incoming webhook notifications. |
| `NEBIUS_API_KEY` | Enables server-side AI requests. In Sandbox, missing credentials make AI unavailable; rehearsal fixtures are always labeled. |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1`. |
| `NEBIUS_TEXT_MODEL` | Text preference model; see the current value in `.env.example`. |
| `NEBIUS_VISION_MODEL` | Photo extraction model; see the current value in `.env.example`. |
| `NEBIUS_ENV_FILE` | Optional path to an existing private environment file; imports only `NEBIUS_*` configuration. |
| `AI_DAILY_REQUEST_LIMIT` | Optional global daily AI request cap; defaults to `100`. |

For Sandbox, create or select an app under **Apps & Credentials** in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/). Obtain personal Sandbox buyer account logins under **Testing Tools → Sandbox Accounts**; these are separate from the merchant app credentials. Use only test accounts. [PayPal setup guide](https://developer.paypal.com/api/rest/)

In Sandbox, open `/?invite=<URL-encoded-organizer-token>` with the private organizer token and use `kasia@lotsplit.example`. Kasia creates each buyer invitation; use the matching sample email (`maja@lotsplit.example`, `ola@lotsplit.example`, `bartek@lotsplit.example`, `jan@lotsplit.example` or `ewa@lotsplit.example`). This MVP returns a one-use login link in the current session and sends no email. The sample addresses are access-flow data, not deliverable mailboxes or production email verification.

## Review the purchase flow

1. As Kasia, inspect the chosen bundle and 24 catalog items, then confirm their fixed price shares. The table above gives each example's item and shared costs. Fresh data and an explicit rehearsal scenario reset reserve the bundle for 48 hours from the application's clock. Reads, reloads and restarts keep the saved deadline. For an existing expired collection, set **Reserved until** to a valid future time before opening buyer choices. An expired reservation blocks new authorizations and captures.
2. Open the buyer invitations. Each buyer selects six preferred items, separately confirms acceptable alternatives or none, and saves a total cap.
3. As Kasia, compute the complete allocation and send the plan for consent. The default garage-sale plan gives Maja, Ola, Bartek and Jan totals of PLN 855, 610, 750 and 605. Office totals are PLN 1870, 1270, 820 and 840; workshop totals are PLN 610, 280, 310 and 380; the vinyl/book/illustration plans retain PLN 180, 210, 220 and 230. Budgets constrain feasibility; they do not set prices.
4. Each buyer reviews and accepts their exact allocation and price, then enters their delivery address and authorizes their own amount. In Sandbox this opens PayPal for genuine buyer approval.
5. Once all current consents and authorizations are valid, Kasia requests captures. Packing stays locked until all four captures are confirmed `COMPLETED`.
6. Check the physical items before marking a package packed or shipped. Those are manual actions, separate from payment completion.

The main actions are **Calculate allocation**, **Send plan for approval**, **Approve plan**, **Capture payments**, and **View packing list**.

As Kasia in rehearsal, open **Try the demo** for roles and prepared scenarios: **Ready to capture payments**, **Unknown result**, **Jan withdraws**, and **New plan with Ewa**. These controls replace rehearsal data and are unavailable in Sandbox.

A changed allocation or price requires a new consent. Unknown provider results remain unresolved while the existing operation is reconciled; they are not treated as an automatic retry or success. Separate transactions provide neither escrow nor atomic group settlement.

A failed background state read shows a temporary connection message. A successful later read clears that message while retaining meaningful action/payment errors. The application does not automatically repeat a payment POST after a connection failure; inspect the operation's current state before deciding what to do. In-place client rebuilds retain earlier hashed assets for already-open tabs. A failed page-module load shows a readable **Refresh** screen; it does not automatically navigate or repeat a payment action.

## Build and checks

```sh
npm run typecheck
npm test
npm run build
```

Set `NODE_ENV=production`, then run `npm start`. The server serves `dist/client` and exposes `GET /api/health`. Build and automated checks alone do not verify Sandbox buyer approval or a live Nebius response.

Current public application [`93f8570`](https://github.com/Powers-P1/lotsplit/commit/93f857046d8d762e6ac19849e0802066a830e267) passed **83/83 tests**, full TypeScript/build and scoped desktop/mobile UX/compiled-solver memory checks. Five reviewed UX findings are fixed. Separate app-withdrawal void PLN 180 and provider-adapter-only refund PLN 1 probes have narrower scope than full app compensation/refund UI. Historical purchase/ZIP records remain distinct; no hosted-load/persistence result is claimed. See [verification details](docs/verification.md).

The [Render deployment notes](docs/deployment.md) describe the prepared Blueprint. Hosted/private judge access and final Devpost handoff are planned for **11 November 2026**; no host or Render charges exist now, and private key-sharing consent/access is not implied. The launch check must confirm the intended mixed physical bundle and English entry, chosen mode/payment labels, privacy, reservation through judging and persistence. Fresh Sandbox seed/reset rules differ from rehearsal; preserve historical proof stores. See the [11 November checklist](docs/submission-checklist.md#11-november-execution-checklist).

## Hackathon materials

- [Official requirements and focused award map](docs/hackathon.md)
- [Submission draft and evidence still to collect](docs/submission-draft.md)
- [Public 160-second technical demo V2.1](https://youtu.be/GmxRrGfU5Yo) and [film/evidence brief](docs/demo-script.md); final submission-film visual selection is pending
- [Public 135-second V1 backup](https://youtu.be/_wEAe1O4wjc)
- [Original demo assets and attribution](docs/assets.md)
- [Same-panel internal review and follow-up](docs/internal-review.md)

This repository uses the [MIT license](LICENSE). Public repository publication, video upload, hosted deployment and Devpost submission are separate delivery steps.
