# Verification record — 30 October 2026

> Historical snapshot, superseded by the [current README](../../README.md) and [current verification](../verification.md). Behavior and test counts below belong to the original snapshot. Documentation links have been rebased for this archive location; unavailable internal artifacts are marked as such.

Final public application [`93f8570`](https://github.com/Powers-P1/lotsplit/commit/93f857046d8d762e6ac19849e0802066a830e267) passed **83/83 tests, full TypeScript and production build**, plus scoped desktop/mobile UX and solver checks. A **160-second V2.1 technical cut is public**; final submission-film visual approval is pending, with V1 also available as backup. The full PLN 840 purchase proof remains `ce58fff` / 73 tests, with separate later application-void and adapter-refund probes. Three delivery gates remain: final film visual approval/selection, hosted/private judge access and final Devpost submission. The last two remain planned for **11 November 2026**. No host or Render charges exist; no private key-sharing consent or access handoff is implied.

## Current source and scoped final quality evidence

Tested application: [`93f857046d8d762e6ac19849e0802066a830e267`](https://github.com/Powers-P1/lotsplit/commit/93f857046d8d762e6ac19849e0802066a830e267). Later documentation-only commits may differ. Earlier `72e9150`/76 checks and `ce58fff`/73 financial proof remain historical records.

| Check | Actual scope and result |
| --- | --- |
| Automated checks | 83/83 passed, zero failed/skipped/cancelled; full typecheck/build passed. Technical validation made zero external provider calls. |
| Browser UX | Isolated Garage Sale rehearsal passed the organizer/buyer flow through simulated capture/packing, prior-plan resolution and all five reviewed organizer UX fixes on desktop/mobile. Office/workshop received inventory/layout checks, not complete purchases of every set. Owned helpers/fixtures were closed. |
| Overlap memory fixture | Compiled Node with a 256 MiB heap limit: all four buyers shared six preferences and accepted the other 18. Result: 24 unique items, six each, minimum 18 alternatives overall, PLN 840; 66.66 ms, 121.43 MiB peak RSS. This is one fixture, not a hosted load benchmark. `SOLVER_LIMIT`/409 preserves saved state when work is exhausted. |
| Application void | An isolated Sandbox app withdrawal invalidated the plan and voided PLN 180. Independent GET confirmed `VOIDED`. Corrected buyer UI showed released status, no stale authorized/pay action and packing blocked. UI regression preserved byte-equivalent app state with no additional provider call. |
| Adapter-only refund | A separate genuine Sandbox approval and provider-adapter authorize/capture/refund of PLN 1 produced refund GET `COMPLETED` and raw capture GET `REFUNDED`. This does not prove application automatic partial-failure compensation or refund-result UI; the raw provider status, not its generic normalized status, establishes this readback. |
| Main runtime refresh | Graceful refresh preserved canonical app state, sessions and login links; original Sandbox instances were untouched. Rehearsal payments remain simulated. The refresh made no provider request. |

Additional provider probes used test funds and the existing test payer. They are not another complete four-buyer purchase on the final revision. The complete purchase below retains three clean returns and Maja's manual recovery. No real customers, ROI, escrow or atomic settlement are claimed. End-to-end app refund compensation/UI and live webhook delivery/signature verification remain outside the live proof.

## Current public technical film and publication coverage

Available [**V2.1 technical demo on YouTube**](https://youtu.be/GmxRrGfU5Yo): **160.000 seconds**, **25,204,499 bytes**, SHA-256 `27063c5434a5fcb7a9a19efc74eb871edd09f988a9b160ffef88cdbf449bea3d`. Studio showed publication with Public selected; anonymous official oEmbed confirmed title/channel. Receipt observed **2026-10-30T19:45:17.934Z**. Public [135-second V1](https://youtu.be/_wEAe1O4wjc) remains backup.

Independent V2.1 review passed restored narration lead-ins, ASR/waveform/level checks, delivery metadata and unchanged-picture hashing. It did not claim subjective listening or continuous audiovisual playback. Generated Veo scenes stay visibly illustrative/AI, separate from actual UI/PayPal footage. The Garage Sale AI suggestion remains unapplied and the separate illustration/PLN 840 payment example is introduced explicitly.

The lead verified the existing active Epidemic Pro trial through **8 November**, exact channel safelist `UCpJTOM_Aiaysdgqpl6N8yyA`, and publication during that active period. Coverage is based on those channel-level facts and the publication receipt; no separate per-video certificate is invented or required. No further account operation/new subscription is needed for this handoff. Voice/scene permissions remain separately retained. Official [trial](https://www.epidemicsoundhelp.com/hc/en-us/articles/26246804344978-How-does-the-free-trial-work) and [cancellation](https://www.epidemicsoundhelp.com/hc/en-us/articles/26254650213266-What-happens-to-content-when-a-subscription-is-canceled) guidance was checked **30 October 2026**. The pre-8-November film-publication gate is closed for this video.

## Three remaining material delivery gates

1. **Final submission-film visual approval/selection.** The current public V2.1 is a factual technical cut, not a user-approved final artistic selection. Any replacement needs visual approval and its own rights/publication check within applicable permissions; no new subscription is authorized. This does not block current technical source/documentation publication.
2. **11 November hosted/private judge handoff.** No host or charges; intended provider/judge credentials and private sharing consent are not supplied. Verify hosted mode, intended mixed physical bundle and English copy, exact Sandbox/simulation labels, privacy and saved reservation through judging. Fresh Sandbox seed/reset behavior differs from six rehearsal examples. Preserve all historical PLN 840 proof stores; test return origin, persistence and free private judge access.
3. **Final PayPal contest submission.** Portfolio saved; draft **1273698** remains **4/5**, not submitted. Complete fields/access instructions and submit with a receipt on the agreed 11 November handoff, before the deadline.

Official PayPal rules checked **30 October 2026**: deadline **12 November 2026, 12:00 PST / 20:00 UTC / 21:00 Europe/Warsaw**; judging ends **15 December 2026, 08:00 PST / 16:00 UTC / 17:00 Europe/Warsaw**. Recheck on 11 November. The working build, truthful PayPal+AI evidence, public MIT source, English public YouTube film under three minutes and free judge access must match the entry. Keep secrets out of public source/footage. [Official rules](https://paypalaihackathon.devpost.com/rules)

Current source and technical/audio/publication checks passed; final artistic selection remains open. This is not a universal bug-free claim. No feature expansion is planned. See the [11 November checklist](submission-checklist-v1.md).

## Financial UI proof at ce58fff — unchanged

Public source: [Powers-P1/lotsplit](https://github.com/Powers-P1/lotsplit). The application revision used for this financial UI proof is [`ce58fffab1cac39f8012d34bb4cba7f3e0b60430`](https://github.com/Powers-P1/lotsplit/commit/ce58fffab1cac39f8012d34bb4cba7f3e0b60430). The 73-test source checks and provider evidence in this section are tied to that revision, not the newer 76-test access-gate change. Later documentation commits may differ. No existing source ZIP was replaced by this documentation update.

| Check | Actual result |
| --- | --- |
| Source checks | 73 tests passed, TypeScript passed, production build passed. Automated provider transport remains mocked; these checks are separate from the real Sandbox results below. |
| Buyer interface | Four exact-term consents and four fictitious delivery addresses were entered through the application UI. All four logical buyers genuinely approved PayPal Sandbox checkout. |
| Clean buyer returns | Ola, Bartek and Jan returned through the normal UI and completed authorization. This does not establish four independent payer identities: one Sandbox payer account was used across four sequential application buyer sessions. |
| Maja's initial return | PayPal approval returned to Maja and the same plan, but the first authorization dispatch was stored as failed. Its original provider error details were not retained, so the precise cause is unknown. |
| Maja's guarded recovery | After the fix, one explicit UI **Check and retry existing authorization** action reused the original operation, frozen command and saved key. The saved command has two attempts in total, with one order and one authorization operation; recovery confirmed authorization of PLN 180 without a duplicate operation. Maja's clean first-attempt callback after the patch was not separately repeated. |
| Completed purchase | Four authorizations followed by one organizer capture-button action produced four captures: PLN 180, 210, 220 and 230. Independent provider GET readbacks returned HTTP 200 and `COMPLETED` for all four by **2026-10-30T18:24:11.557Z**, totaling PLN 840. The verifier used OAuth and read-only provider GETs, not financial POSTs. |
| Packing | Plan status `paid`; packing unlocked for four packages. Zero packages were marked packed or shipped. |
| Original Sandbox preservation | The earlier instance remained byte-identical at revision 97, with its original four completed captures totaling PLN 840. The new run used an isolated Sandbox store. |
| Public setup | The public [judge setup guide](judge-access-v1.md) provides a verified clean no-key rehearsal path. Its simulated payments/sample AI remain visibly labeled. Entrant-provided free private live-provider judge access is still pending; optional own-account setup does not complete that obligation. |
| Film and submission | The 160-second [V2.1 technical cut](https://youtu.be/GmxRrGfU5Yo) is public; final film visual approval is pending, with V1 also available. Portfolio saved, draft 1273698 is 4/5 and not submitted. Hosted/private access and final handoff remain 11 November. |

The first failed Maja return is excluded from clean-success footage. Clean-return scenes must use the recorded Ola/Bartek/Jan path; a Maja recovery scene must retain its manual-recovery label. This is test money, prepared fictional inventory and one test payer, not evidence of real customers or returns on investment. Separate payments provide neither escrow nor atomic group settlement. No live refund, void or webhook result was added by this run.

## Historical English-default v4 snapshot

The interface, default example names/descriptions, exercised organizer/buyer copy and errors are English. The main entry shows **Garage Sale**, **Small Business Clearance** and **Workshop Equipment**; the drawer retains all six examples. Pricing and the allocation/payment rules are unchanged.

| Check | Actual final result |
| --- | --- |
| `npm test` | 66/66 passed, 0 failed, exit 0: 42 domain, 20 mocked-provider and four route tests. |
| `npm run typecheck` | Passed, exit 0. |
| `npm run build` | Passed, exit 0; entry `/assets/index-Nvft9VE8.js`, organizer `/assets/OrganizerFlow-C-Tjk6SE.js`. The existing organizer-chunk size warning remains. |
| English UI | CUA Edge review passed at 1440×900 and 430×930: main entry, selected organizer/buyer screens, office allocation at PLN 4800, English item names/condition display and three-column mobile layout. Final clean pages had no overlay, console errors/warnings or horizontal overflow. |
| Delivery gate | English address guidance led to the local simulated authorization screen for PLN 1870. Approval was not clicked; no real PayPal action occurred. |
| Read/action recovery | A blocked `GET /api/state` retained content and its warning cleared after HTTP 200. One blocked logout POST was not retried; its uncertainty message survived background failures and successful reads. |
| Lazy module failure | An intentionally blocked organizer chunk showed the readable English **Refresh** fallback. There were zero automatic reloads/requests; manual refresh recovered. This reproduces the failure class, not a confirmed cause of the user's earlier incident. |
| Cross-build retention | An already-open older main bundle fetched its older lazy organizer chunk after the final in-place rebuild: HTTP 200, JavaScript MIME, cache disabled, not served from disk cache, clean console. Earlier hashed files remained unchanged; current HTML uses `no-store`. This covers the same output directory, not a clean hosted deployment. |
| English live AI | One UI preferences POST returned HTTP 200, `source: nebius`, model `nvidia/nemotron-3-super-120b-a12b`, six Garage Sale IDs and a PLN 950 cap, with explicit no-alternatives and human confirmation. Zero automatic retries; the proposal was neither applied nor saved. |
| Source package | ZIP v4: 78 exact-allowlisted files including 35 PNGs; blank-credential `.env.example`, source, assets, docs and MIT only. Versioned report/manifest record scan, CRC and hashes. V2 is unchanged; ZIP v3 was not created. |

The English AI trace completed `2026-10-30T16:31:43.247Z`; request ID `cbb57fe19738d999c20e9bc866b40bc6`, response ID `chatcmpl-96042c58f89d325b`, latency 3975 ms and 2349 total tokens. Preferred IDs were 01/04/07/09/12/18. This proves one English input, not general parsing accuracy; warnings/ambiguities were not exercised, and vision was not retested.

The review exercised selected surfaces, not every browser scenario for all six sets. Historical garage/workshop/recovery and office-delta evidence below remain distinct. Stored Sandbox data was read-only and byte-identical: revision 97, paid, four completed captures totaling PLN 840. No new real checkout, capture, refund, void or webhook verification occurred. Old stored Sandbox names/conditions were not migrated; an English display helper handled the exercised condition label.

QA used authorized own Edge tabs because IAB was unavailable to the subagent. Its inline screenshots had no persisted paths. The root agent separately refreshed the final IAB preview and saved the entry screenshot as `outputs/LOTSPLIT/06-mvp-review/english-entry-v4.png`; this working artifact is excluded from the source archive. Both QA tabs were closed, metrics/network/cache overrides removed, unrelated tabs/cookies unchanged. Runtime servers remain deliverables outside the source ZIP.

## Pre-English six-example snapshot

The main entry now shows **Wyprzedaż garażowa** (default), **Likwidacja małej firmy** and **Wyposażenie warsztatu**. The drawer offers those plus **Winyle z drugiej ręki**, **Biblioteczka z przeprowadzki** and **Grafiki kolekcjonerskie**. All use the same 24-item/four-buyer/six-items-each workflow. The five earlier catalogs and prices are unchanged.

The new `office` example is a fictional 24-item bundle of computers, furniture, printers, network and back-room equipment offered together before a lease ends. It illustrates buyers wanting different parts of one seller's lot. It does not implement billing, invoice processing or a company-liquidation system, and it adds no live provider proof.

| Office pricing | PLN |
| --- | --- |
| Fixed item shares + shared costs | 4320 + 480 = 4800 |
| V1 totals: Maja / Ola / Bartek / Jan | 1870 / 1270 / 820 / 840 |
| V2 totals: Maja / Ola / Bartek / Ewa | 1830 / 1270 / 820 / 880 |
| Spending caps: Maja / Ola / Bartek / Jan / Ewa | 2200 / 1500 / 1000 / 1000 / 1000 |
| Budget shortfall without Jan | 100 |

| Check | Actual result for the six-example source |
| --- | --- |
| `npm test` | Final rerun after the office description correction passed 66/66, exit code 0: 42 domain tests, 20 provider tests and four route tests. The earlier six-set backend run also passed 66/66 in 929.1696 ms. Provider transport is mocked. The matrix covers 12 scenarios × six sets with zero provider-spy calls. |
| Server TypeScript | `npx tsc -p tsconfig.server.json --noEmit` passed, exit 0. A strict check of both changed test files also passed, exit 0. |
| Final typecheck/build | `npm run typecheck` and `npm run build` passed, exit 0; final entry bundle `/assets/index-DQTV_21S.js`, organizer bundle `OrganizerFlow-B5_JH-dc.js`. The existing large organizer-chunk warning remains. |
| Office/main-entry browser delta | Passed through CUA's Edge extension at 1440×900 and 430×930 CSS viewports. The in-app browser was unavailable; the root explicitly authorized this own-tab fallback. Main entry images/copy, office allocation, 24 office thumbnails and selected buyer details passed, with no console errors/warnings, overlay or horizontal overflow. |
| Source ZIP v3 | Not created: superseded by the English-default v4 work before package freeze. V2 and its hash/report/manifest are preserved without overwriting. |
| Docker/container check | Not repeated; the original 25-illustration-PNG result remains historical. |

The office delta verified entry → setup → prepared choices → draft allocation at PLN 4800, with buyer totals PLN 1870/1270/820/840. Buyer mobile showed all 24 office thumbnails in three columns, matching names, a complete conference table (#08), the correct conference camera (#24), condition/description and back navigation. Office capture was not executed. The office atlas PNGs remained unedited; rendering uses one source-rectangle adjustment. A misleading word in the table description was corrected before the final typecheck/test/build rerun.

This was a targeted office/main-entry delta, not another complete browser purchase for all six sets. The garage/workshop/draft/recovery evidence below remains from v2 and was not repeated. Screenshots were displayed inline without persisted files; a full-page zoom-capture artifact was checked against regular viewport screenshots and DOM bounds. The own Edge QA tab was closed and its metrics reset; browser zoom, unrelated tabs and cookies were unchanged. Read-only verification confirmed the stored Sandbox state was byte-identical, still revision 97, `paid`, with four completed captures totaling PLN 840 and zero new orders/captures.

## Retained v2 five-example snapshot

The retained v2 demonstrated buying a whole lot that a seller offers only together, including unrelated kinds of objects. Its main entry showed **Wyprzedaż garażowa** (default), **Wyposażenie warsztatu** and **Winyle z drugiej ręki**. Its drawer also offered **Biblioteczka z przeprowadzki** and **Grafiki kolekcjonerskie**. Each had 24 catalog entries, four buyers and six items per buyer, while contents, condition notes, fixed shares, shared costs and budgets varied.

| Example | Item shares + shared costs | V1 totals: Maja / Ola / Bartek / Jan | Their spending caps |
| --- | --- | --- | --- |
| Mixed garage sale | PLN 2580 + 240 = 2820 | PLN 855 / 610 / 750 / 605 | PLN 950 / 700 / 850 / 700 |
| Workshop | PLN 1420 + 160 = 1580 | PLN 610 / 280 / 310 / 380 | PLN 650 / 330 / 360 / 430 |
| Vinyl, books or illustrations | PLN 720 + 120 = 840 | PLN 180 / 210 / 220 / 230 | PLN 200 / 230 / 250 / 260 |

The garage-sale lot includes a bicycle, guitar, drill, tent, console, keyboard, camera, furniture, appliances, a plant and sports goods. The workshop has power tools, hand tools and accessories. These are prepared fictional inventories, not inspected seller offers or market valuations. The `home` identifier refers to the mixed garage-sale example; an earlier furniture-only generation is unused.

Example selection resets only rehearsal choices, consents, simulated operations and packing. It retains the selected example across prepared scenario resets and restarts. Sandbox rejects these reset endpoints without rewriting its saved collection or payment history. Background connection recovery clears its temporary read-error message after a successful refresh, preserves meaningful action/payment errors and does not automatically repeat payment POSTs.

| Check | Actual result for the five-example source |
| --- | --- |
| `npm test` | Passed 64/64, exit code 0: 40 domain tests, 20 provider tests and four route tests. Provider transport is mocked. Recorded Node output: 64 passed, 0 failed, cancelled, skipped or todo; duration 836.3773 ms. |
| Server TypeScript | `npx tsc -p tsconfig.server.json --noEmit` passed, exit code 0. A separate strict check of both changed test files also passed. |
| Client/shared TypeScript | Final `npm run typecheck` passed after the connection recovery and image-rendering changes. |
| Production build | Final `npm run build` passed; entry bundle `/assets/index-y6XqE7g0.js`, organizer bundle `OrganizerFlow-4HSF_8CZ.js`. Vite retains its existing organizer-chunk size warning. |
| Browser review | Passed in the CUA in-app browser at 1440×900 and 430×930, then reset to 1280×720. The final entry shows garage sale/workshop/vinyl with all three images loaded; there were no console errors/warnings, framework overlay or horizontal overflow in the final clean page. |
| Docker build/container package | Not repeated for the expanded source. The original checks below covered 25 illustration PNGs. |

The suite exercises all five catalogs through all 12 prepared scenarios, complete 24-item allocations, the six-item buyer limit, category-specific totals and caps, replacement planning and simulated packing. It also checks organizer-only selection, rejection of invalid examples, invalidation of old commitments, retention across restart, absence of external payment calls in rehearsal and preservation of existing Sandbox data when reset endpoints are rejected. These checks do not establish real buyer approval, live compensation or deployed persistence.

The final browser review solved the garage-sale plan at PLN 2820 (PLN 855/610/750/605), switched to a fresh workshop set at PLN 1580, and completed four visibly simulated workshop captures before packing unlocked (PLN 610/280/310/380). It checked buyer item details, three-column mobile layout, complete item crops, static organizer photos, unsaved-draft restoration and isolation when switching/resetting examples. These were rehearsal transactions. Vinyl/books/illustrations were not each taken through another complete final browser purchase; all five are covered by the automated scenario suite.

For connection recovery, blocking `GET /api/state` retained the page and showed the connection warning; restoring HTTP 200 cleared it automatically. A separate blocked `POST /api/auth/logout` produced one request and an uncertainty message that survived failed and successful background reads, with zero automatic POST retries. This exercises the request-recovery boundary without creating another payment. The stored Sandbox plan remained at revision 97, `paid`, with the original four completed captures totaling PLN 840; read-only QA created no new Sandbox order or capture.

Screenshots were displayed inline by CUA without saved image-file paths. No saved screenshot artifacts are claimed. The review used the in-app browser only; other engines and untested viewports were not exercised. Its QA tab was closed, viewport/network overrides were reset, and no temporary server or script was left behind. The application servers are runtime deliverables managed separately from the source archive.

The additional examples are prepared rehearsal content, not new live PayPal purchases or full-catalog AI extraction. The real provider results below remain tied to the original illustration collection. The same-panel internal review (historical internal artifact, not distributed) describes the existing jurors' conditional GO and requirements; it predates the added examples and does not supply a fresh score.

## Previous three-example snapshot

The preceding vinyl/book/illustration snapshot passed 59/59 tests (36 domain, 20 mocked-provider and three route tests; exit 0; 593.1955 ms), client/shared and server TypeScript, plus a strict check of both changed test files. It was superseded before its final build, browser review or ZIP freeze. Its results are historical and do not verify the five-example source or connection recovery.

## Original integration evidence

| Check | Actual result |
| --- | --- |
| `npm test` | Original illustration snapshot passed 48/48: 28 domain tests and 20 provider tests. Provider transport is mocked in these tests. |
| `npm run typecheck` | Original snapshot passed client/shared and server TypeScript checks. |
| `npm run build` | Original snapshot passed Vite client build and server compilation. |
| `docker build --progress=plain --tag lotsplit:release-check-20261030 .` | Original snapshot passed the multi-stage Node.js 24 build and production dependency pruning. |
| Container package check | Original snapshot passed with networking disabled: compiled server, built-in SQLite, writable data path, 24 item PNGs and the collection PNG are present; local environment files are absent from the runtime image. No web server was started for this check. |
| Live Nebius text preferences | The application's preference endpoint returned HTTP 200, `source: nebius`, a `mode: live` trace and `requiresHumanConfirmation: true`. Actual response model: `nvidia/nemotron-3-super-120b-a12b`; request ID `f24dceeebae3dae87d5defdbec531af6`; response ID `chatcmpl-bd10c27dfa0b44ca`; completed `2026-10-30T13:52:47.606Z`. |
| Live Nebius vision | The application's `/api/ai/catalog` endpoint processed one uploaded demonstration item image (`public/assets/items/01.png`), with matching local/source SHA256, and returned an unconfirmed proposal with `requiresHumanConfirmation: true`. Actual response model: `nvidia/Nemotron-3.5-Super-VL`; request ID `9e2b27a11daa57bc755ba45e27d16e32`; response ID `chatcmpl-85048b1e81d3ff4a`; completed `2026-10-30T15:02:33.033Z`. The catalog remained draft during inference. This request did not generate the full 24-item catalog. |
| PayPal Sandbox provider probe | OAuth, creation of one PLN 180 `AUTHORIZE` order (`2VR75269GK8074031`), same-key retry with the same order, and readback passed. Provider status was `PAYER_ACTION_REQUIRED`. No authorization or capture was called. |
| PayPal Sandbox application purchase | Normal application API calls saved four buyers' preferences, explicit alternatives, exact-term consents and fictitious delivery addresses. Genuine browser checkout approvals preceded four real authorizations. Independent `GET` reads confirmed captures of PLN 180, 210, 220 and 230 as `COMPLETED`, totaling PLN 840; the final read completed `2026-10-30T15:12:34.971Z`. Plan `f28835c4-d4a3-473b-8717-fdfb8788095b` became `paid`, with four authorizations, four captures and packing allowed for four packages. No package was marked packed or shipped. |
| Prior browser review | Local browser artifacts cover organizer/buyer flows, capture gates, packing, changed plans, payment return/cancel and recovery using visibly labeled rehearsal payments. They also retain the live Nebius preference response. These screenshots are not proof of real Sandbox payments. |
| Packaging hygiene | `.gitignore` excludes local environments, `data`, logs and organizer access files; `.dockerignore` also excludes SQLite/database files and test output. A source-only credential-pattern scan found no private-key blocks or long credential-shaped literals. Environment values were not read. |

Historical local toolchain: Node.js `v24.19.0`, npm `11.17.0`, Docker Engine `29.7.2`; the built container used Node.js `v24.22.2`. The original workspace snapshot had no Git metadata. The later tested application source is now recorded by the public commit above.

The original production build reported a size warning for the organizer bundle (about 1.19 MB minified / 332 kB gzip). That build passed; performance on a hosted connection has not been measured.

The domain tests cover exact consent and buyer privacy, fixed-price allocation, individual budgets, the saved reservation deadline, per-capture expiry gates, concurrency, durable operation commands and reconciliation after lost responses. Fresh data and explicit rehearsal scenario resets reserve for 48 hours from the engine clock. Reloads and restarts keep the stored deadline. Tests validate the exercised cases; they do not substitute for real provider approvals.

The original 15:12 UTC Sandbox purchase used four separate application sessions and one PayPal Sandbox personal payer account for the four logical buyers. That historical evidence covers the application's API purchase flow and real browser checkout approvals; it does not establish four independent PayPal payer identities or a complete buyer UI walkthrough with real return callbacks. The one-image vision proposal remained unconfirmed and was not automatically applied; the seeded 24-item catalog was confirmed separately.

## Remaining verification and delivery

- Complete final visual film approval/selection and the two 11 November delivery gates. Preserve current technical-cut evidence boundaries and the public backups.
- Do not broaden isolated app-void/adapter-refund probes into end-to-end app compensation/refund UI or live webhook proof; those wider live paths remain unverified.
- Hosting/private judge access is deferred to 11 November: no Render service or charges now. Deployed persistence, return origin and free access through judging remain pending.
- Complete private live-provider judge access and finish contest draft 1273698 (currently 4/5), then submit and retain its receipt. Source, clean-install guide and public V1 are available; the saved portfolio is not a completed contest submission.

Internal workspace evidence is retained in `outputs/LOTSPLIT/04-implementation/release-checks.json`, `paypal-provider-proof.json` and `sandbox-app-proof.json` beside this source directory. The retained v2 uses `outputs/LOTSPLIT/06-mvp-review/release-check-evidence-v2.json` and `examples-runtime-qa.json`; the pre-English stage adds `release-check-evidence-v3.json` and `examples-runtime-qa-v3.json`; v4 adds `release-check-evidence-v4.json`, `examples-runtime-qa-v4.json` and `english-ai-smoke-v4.json`. The standalone provider probe is historical; the application proof records the later completed purchase and live vision trace. Earlier browser traces and check logs are in the task's temporary `lotsplit-qa` directory. These private working paths are not public submission links and are excluded from the source archive.

The later UI and recovery evidence is retained internally in `outputs/LOTSPLIT/09-publication/sandbox-full-ui-proof-20261030.json` and `sandbox-ui-recovery-proof-20261030.json`. The 135-second film working files are in `outputs/LOTSPLIT/10-film`. These private working paths are not public demo/video links.

Final working evidence: `outputs/LOTSPLIT/12-final-quality/technical-fixes-validation.json`, `overlap-solver-memory-after-fix.json`, `ux-qa.md`, `ux-final-build.json`, `sandbox-refund-void/qa-report.json`; video `outputs/LOTSPLIT/10-film/v2/export/PUBLICATION-RECEIPT-V2.1.json` and `edit/review/final-review-v2.1.md`; runtime `outputs/LOTSPLIT/09-publication/runtime-refresh-proof-20261030-final.json`. Private working evidence is not a public judge invitation.
