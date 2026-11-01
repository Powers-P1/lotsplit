# Publication verification — 1 November 2026

Full typecheck, production build and 123/123 tests passed again before publishing this V2 source. The final [170-second film](https://youtu.be/gUwv5R6rCww) is public on the intended channel with English captions and disclosed AI scenes. These checks do not establish a running host or a submitted Devpost entry; those have separate receipts. The dated sections below preserve their original test scope and historical publication status.

# Verification record — V2, 31 October 2026

## Current delta — jury fixes, 31 October 2026

The three requested corrections are implemented without extending the product scope.

- AI exclusions now carry source wording. Local grounding checks named items, actual refusal clauses and permissions; unsupported wording is omitted with a review warning. The buyer can directly correct the visible exclusion checkboxes before saving. Grounding checks provenance, not perfect understanding of every natural-language category.
- The seller assistant uses an authoritative, read-only complete-option check. A feasible garage/office plan is shown as complete and opens the plan without calling AI. Both accepted options are considered. Missing options, an unfinished check and a genuinely blocked plan have separate copy. The incompatible Workshop repair shortcut is disabled elsewhere and rejected before any state mutation.
- The catalogue opens the first unreviewed item and advances after each explicit confirmation. In the nine-item Garage browser test this removed all nine Review clicks: nine item confirmations plus the final catalogue confirmation, instead of nineteen actions. Zero price and missing condition still blocked confirmation. Human review, fixed-price sums and the final catalogue gate remain required. Expanded desktop/mobile details were inspected; a colspan layout issue found during QA was fixed. The English Replace photo control opened the browser file chooser and handled a draft upload.
- Rehearsal refunds/cancellations identify simulation rather than claiming PayPal/bank activity. Returning after expiry or withdrawal now opens the buyer's financial status. Same-page account navigation closes its menu.

Validation: **123/123 tests passed**, zero failures/skips/cancellations, after the final production build; full client/server TypeScript passed. Current entry: `index-BbqkeLNr.js`; V2 seller: `Seller-CIR66BK9.js`. The unchanged lazy V1 AG Grid chunk retains its size warning.

Actual NVIDIA/Nebius checks: the exact jury input selected Corded drill + Extension reel at 190 PLN without forbidding Hand tools or Box of clamps. A separate explicit refusal retained both 10/11 with source quotes. A buyer correction was checked in persisted preferences. The bounded agent again produced Jan's checked 190 PLN question; accepting it remained distinct from purchase consent, and the seller then saw a complete plan. Early development probes exposed an over-strict quote filter; the final grounding corrected that, with both final regression inputs repeated successfully. These probes do not establish a general parsing accuracy rate.

Fresh actual PayPal Sandbox run: a separate own two-item lot used a 140 PLN AI-reviewed basket and a 50 PLN manually reviewed basket. Exact consents were initially unchecked. Authorisation stayed disabled with one missing consent. A collection attempt with only one of two real holds returned HTTP 409/GATE_CLOSED and created zero capture operations. Two real test-payer approvals returned normally; the seller collected 140 + 50 = **190 PLN**. Independent PayPal GETs confirmed both captures COMPLETED with the exact amounts/currency. Physical preparation unlocked, but both actual-fixture baskets remained not prepared. One existing Sandbox payer served two logical buyer sessions; all amounts are test funds.

UI regression coverage included unknown result → existing-operation check → partial failure → pending compensation → confirmed compensation; selective repair; explicit incomplete recheck; expiry; withdrawal and return home; simulated capture and partial/full physical checklists. Desktop catalogue 1536 px and mobile 390 px were inspected; the actual Sandbox payment view used the existing 1280 px viewport. The exercised layouts had no document overflow or framework overlay, and the app-only rehearsal console had no warnings/errors. Public-provider failure injection/refund was not repeated in this delta; its earlier actual evidence remains in the initial V2 section below. Vision was not rerun. Existing assets, providers, original ledgers and publication plans were retained.

Private screenshots, provider readbacks and regression traces are retained outside public source.

## Initial V2 implementation evidence — preserved historical scope

The accepted V2 concept and views are implemented locally. This report supersedes V1's current-status claims; [the earlier record](history/verification-through-2026-10-30.md) is preserved unchanged as historical evidence. The new working tree has not been pushed or submitted. Hosting/publication remain deferred to the agreed handoff.

## Source and browser checks

| Check | Result and boundary |
| --- | --- |
| TypeScript | Client and server typecheck passed. |
| Production build | Passed. Initial V2 entry `index-HM0xJUQ_.js`; V2 seller `Seller-DUckxoMx.js`. V1's lazy AG Grid chunk retains a size warning; V2 does not request it. |
| Automated tests | 115/115 passed, zero failures/skips/cancellations, after the production build. Provider-transport tests use mocks and are separate from real provider results below. |
| Own inventory | Browser-created empty own lot, protected photo upload, actual vision returned eight unconfirmed suggestions and accepted zero automatically. Human selected two, priced 200/100 PLN, confirmed catalogue, edited buyers to Alice/Robin, saved two separate whole baskets, approved exact terms and completed a 300 PLN simulated purchase. Preparation required a separate item check/action. No actual goods were prepared. |
| Different examples | Office 15/4/3140 PLN, garage 9/3/1035 PLN and café 18/5/3550 PLN each rendered a complete unequal-basket plan in the browser. Full simulated purchases for all three also passed domain tests. Workshop 12/4/1800 PLN is the separate live Sandbox fixture. |
| Recovery UI | Browser reviewed incomplete, expiry, pending compensation, completed compensation, unknown capture and selective repair. Interrupted-hold fixture resumed the existing order; unit test confirms unchanged operation/key and no second order. |
| Production smoke | Compiled build on 4319 completed a simulated purchase; reload and a full server restart preserved paid state and the logged-in session. The canonical SQLite state was byte-identical across that restart. Clean application console had no warnings/errors before deliberate network fault injection. Blocking the state GET retained readable paid/preparation content and showed a friendly connection warning; unblocking recovered and cleared it. No financial POST was retried by that check. |
| Responsive scope | Selected entry/catalogue/basket/consent/repair/payment/refund/pickup surfaces checked at 390 px mobile and 1536 px desktop. No document-level overflow in exercised layouts. Catalogue tables intentionally have their own horizontal continuation. This is not a claim of exhaustive device/browser coverage. |

## Actual Nebius AI

- Vision processed the actual photographic fixture and an authenticated own-upload image through `nvidia/Nemotron-3.5-Super-VL`. The source photo hash was retained, proposals remained unconfirmed and catalogue prices were set by a person. The prepared canonical 12-item catalogue was not generated by one vision call.
- Text preferences processed Nina's workbench-plus-clamps request with the existing NVIDIA text model, yielding a 480 PLN proposal that she separately saved.
- The actual bounded agent used `nvidia/nemotron-3-super-120b-a12b`, reading catalogue/conditions and calling plan, candidate and comparison checks before proposing Jan's 190 PLN alternative. Six rounds completed. The seller sent the question; Jan explicitly accepted the option. This did not create purchase consent or payment authority.
- Initial live model attempts exposed premature tool selection and reasoning-token truncation. Allowed-action gates and the model's thinking setting were corrected before the successful run. Provider errors do not become sample successes. No new API account or provider was introduced.

## Actual PayPal Sandbox — purchase and selective repair

A new isolated V2 ledger was used; historical V1 ledgers were not migrated or reused.

1. Four logical buyers gave exact unchecked purchase consent through the app and genuinely approved PayPal Sandbox holds of 380/190/720/510 PLN in the browser. All normal callbacks completed cleanly. With only three holds, collection returned `GATE_CLOSED`, with zero captures and preparation blocked.
2. Lena explicitly withdrew. Her 720 PLN hold and Jan's changed 190 PLN hold were voided; independent PayPal reads confirmed `VOIDED`. Nina joined through her own invitation, confirmed a 480 PLN basket, and Jan confirmed the 430 PLN complete option.
3. Plan 2 kept Marta's 380 PLN and Oskar's 510 PLN exact V2 consent, original authorization operation and provider IDs. Changed/new buyers gave new exact consent and authorizations. The comparison was checked against stored operation IDs, digests and independent provider reads.
4. One seller collection action produced four actual Sandbox captures of **380 + 430 + 480 + 510 = 1800 PLN**. Independent PayPal GETs returned `COMPLETED` for all four. The app showed all payments confirmed; preparation unlocked but all actual-fixture baskets remained not prepared.

The initial fixture's fictional pickup time was entered overnight. New/default fixtures use the displayed daytime 10:00–12:00 CET slot. Financial terms of the completed fixture were not rewritten to improve screenshots.

## Actual controlled failure, unknown result and compensation

A different isolated Sandbox ledger tested a deliberate failure; the successful purchase above was untouched.

- Four real test holds were approved. The test deliberately voided Jan's 190 PLN authorization outside the app, creating a genuine subsequent PayPal capture failure.
- The first 380 PLN capture genuinely completed at PayPal. A private QA transport wrapper deliberately discarded its response after provider success. The app stored `UNKNOWN`, started no later capture, and blocked preparation.
- **Check existing payment** found the same provider capture through reads. The local operation, saved key and provider capture ID matched the original receipt; the persisted capture command had **one dispatch attempt**. No capture POST replay occurred.
- Continuing then encountered Jan's actual `AUTHORIZATION_VOIDED` failure. Later captures never started. The app refunded the confirmed 380 PLN capture and canceled remaining holds.
- PayPal's `PREVIOUSLY_VOIDED` corner initially remained an honest failed cancellation. The adapter was corrected to read the exact authorization and accept only `VOIDED`, with tests for contradictory and failed reads. One explicit guarded UI retry after this fix settled Jan's already-voided hold. This branch is not described as a clean zero-retry initial run.
- Final independent reads confirmed the **380 PLN refund COMPLETED** and **1420 PLN of holds VOIDED**. Pickup stayed blocked. The buyer's Refund confirmed view was verified in the browser. Real bank-pending timing was not reproduced; pending refund/cancellation views were tested in rehearsal/domain fixtures.

## Design fidelity and user stories

Reference: accepted `outputs/LOTSPLIT/14-design-v2/manifest-final.json`, 28 chosen PNGs / 18 stories. The story map is `docs/design-v2.md`.

| Comparison | Verified treatment |
| --- | --- |
| Copy and numbers | Accepted task headings/actions and canonical 1800 PLN plan data retained. Runtime dates/names/counts come from state. Simulated and Sandbox states have distinct visible labels. |
| Composition | Open rows/tables, thin dividers, one dominant action, buyer-focused narrow views and wider seller workspace. Changed Jan/Nina rows highlighted; unchanged Marta/Oskar commitments shown separately. |
| Typography | Inter with explicit heading/body/control sizes and consistent hierarchy; responsive CSS normalizes the reference bitmap's sizing to usable browser text. |
| Palette | White, ink #1D2823, forest #244B3B, muted #727A75 and divider #E4E9E5. Semantic amber/green states use icon plus text. |
| Imagery | Photographic workshop/office/garage/café media and separate item assets. No reference screenshot is used as interactive UI. Own uploads and bounded photo regions are supported; image aspect ratios are preserved. |
| Spacing and controls | 24 px side gutters, restrained radii, separated sections and main buttons at least 48 px high. Purchase consent is initially unchecked and tied to exact current terms. |
| Live behavior | Options, exact consent, hold, capture, compensation and preparation remain distinct. Unknown/pending does not show success. Extra mode labels and Demo controls explain actual runtime behavior. |

Selected renders were inspected against accepted entry and repair references. Stable DevTools screenshots supersede earlier transient capture artifacts produced while viewport emulation changed. The actual DOM bounds and stable frames agreed; no application layout workaround was added for the capture artifact.

## Limits and handoff

These are test funds and fictional goods. One existing Sandbox payer account served multiple logical buyer sessions; this is not proof of four independent payer identities. No Live payment, real customer, ROI, escrow, atomic settlement or physical handover is claimed. Signed webhook handling is unit-tested; live public webhook delivery was not verified on localhost.

The prototype has one configured seller/workspace, 2–6 buyers, up to 24 catalogue positions and two complete basket options each. Invitations display a one-use link locally and do not send or verify email. A Sandbox workspace with financial history cannot be erased/recycled from the UI; use separate persistent workspaces for separate demonstration purchases. Local fresh ledgers are not the archived financial-proof ledgers.

QA processes on 4322–4324 and old task-local helpers are stopped. Compiled user-facing runtimes remain on 4319 (rehearsal) and 4320 (fresh Sandbox). Secret files, session/invitation values and provider receipts remain private. Selected non-secret screenshots and summary evidence are saved under `outputs/LOTSPLIT/15-implementation-v2`.

The public repository/video still represent V1. Refresh source, film, judge access, rules check and final submission at the agreed publication stage; none were published or charged for by this work. No new jury score is claimed.

Current [mobile entry](screenshots/entry-mobile.png), [repair](screenshots/repair-desktop.png) and [Sandbox result](screenshots/sandbox-paid-desktop.png). Private provider receipts are not committed.
