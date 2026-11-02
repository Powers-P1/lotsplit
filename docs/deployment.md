# Hosted deployment — 1 November 2026

Two separate Render services are running. The release lead observed the configuration and provider results below; this document does not claim a new deployment or transaction.

| | PayPal Sandbox | Replay demo |
| --- | --- | --- |
| URL | [lotsplit.onrender.com](https://lotsplit.onrender.com) | [lotsplit-demo.onrender.com](https://lotsplit-demo.onrender.com) |
| Render service | `srv-dbjnn7flk1mc739q98qg` | `srv-dbjo9q2jnfac738jnr50` |
| Application mode | `APP_MODE=sandbox` | `APP_MODE=rehearsal` |
| Compute | Paid, 0.5 CPU / 512 MB, USD 7/month | Free, USD 0 |
| Storage | Persistent 1 GB disk, USD 0.25/month | No persistent disk; synthetic state is ephemeral |
| Payments | Actual PayPal Sandbox approvals and provider operations; test funds only | Visibly simulated payments; no PayPal keys configured |
| AI | Real server-side NVIDIA/Nebius inference | Real server-side NVIDIA/Nebius inference |
| Restart behavior | Financial history and photos remain on disk | State may reset; cold wake can take 50+ seconds |

The observed paid configuration totals **USD 7.25/month** for compute and disk, before any additional usage or charges. **USD 50 of Render account credits has already been applied**. Applied credits are distinct from winning a hackathon sponsor prize; they do not establish a permanent free hosting allowance. See [business assumptions](business.md) for costs that have not been measured.

## Runtime and release control

The paid service runs the repository's Docker image in Frankfurt: Node.js 24, Debian Bookworm slim, Express and built-in SQLite. Build steps are `npm ci`, `npm run build`, then pruning development dependencies. The compiled server starts with `node dist/server/index.js`.

The application listens on `HOST=0.0.0.0` and Render's `PORT=10000`; `/api/health` is the health check. Persistent data lives beneath `DATA_DIR=/var/data`. One instance owns the disk. Both services have automatic deployment disabled; publishing source does not deploy it. Releases are deployed manually and must be checked separately.

The [Blueprint](../render.yaml) describes the paid Sandbox service, not the separate free replay service. Its values and the [Dockerfile](../Dockerfile) are configuration evidence; runtime and payment evidence is recorded in [verification](verification.md). Render Workflows are not implemented.

A public landing page and an optional guided walkthrough are pending release verification. Their implementation or local presence must not be treated as proof that they are deployed. These entry changes do not extend the payment or AI protocol.

## Preserved proof and judging workspace

The archived hosted verification ledger retains **four provider-confirmed captures totaling PLN 1,800** and **18 verified PayPal webhook event IDs**. A post-restart inspection confirmed the retained financial results. The active fresh judging workspace is separate: twelve catalogue positions and four confirmed preference baskets, with **zero purchase consents and zero holds pre-created** at handoff. This is not a claim that later reviewers cannot change its state.

One existing test payer represented the fictional buyer sessions. No production money or physical pickup is proved. The earlier actual controlled failure/refund run has its own local scope; the film's failure interlude is explicitly simulated. Keep those evidence scopes separate.

Never reset, replace or reseed a Sandbox ledger with financial history to replay a demonstration. Retain frozen operations, provider identifiers, exact consents and reconciliation state. Use a separate persistent workspace when another actual Sandbox run is needed. The replay server's synthetic state can be reset; it must not share the Sandbox data directory.

## Access and continuity

Private browser login, invitations and test-payer instructions are supplied in the private Devpost judging field. Provider keys stay server-side and are absent from public source, image layers and film. The browser access gate is separate from seller/buyer roles and purchase consent. See [judge access](judge-access.md).

Each hosted server has a configured cap of **20 provider-backed AI requests per day**, plus throttling. The free replay can cold-start slowly. Once a reviewer completes the shared Sandbox purchase, later reviewers inspect that retained history or use the replay service. Actual checkout also has a maximum 24-hour window from the first hold. Manual review and the replay examples remain available, but a simulated result must never be presented as a new provider success.

Approved judging access runs through **15 December 2026, 17:00 Europe/Warsaw** (08:00 PST / 16:00 UTC). A follow-up at **18:00 Europe/Warsaw** is scheduled to end the approved hosting period after checking the current official schedule and retention needs. That follow-up is not a promise to automatically delete the persistent disk or financial evidence. See the [official rules](https://paypalaihackathon.devpost.com/rules) and [publication checklist](submission-checklist.md).

When deploying an approved revision, preserve the disk, check the active mode and clean judging URLs, and confirm that retained financial state remains readable. Do not initiate another financial operation merely to check deployment. The exact deployed revision and checks belong in the current verification record.
