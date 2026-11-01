# Judge setup and access — V2

## Hosted review

- [Replayable demo](https://lotsplit-demo.onrender.com): real NVIDIA/Nebius AI, explicitly simulated payments and repeatable examples/recovery states. The free instance may take 50+ seconds to wake and its synthetic state can reset on restart.
- [PayPal Sandbox](https://lotsplit.onrender.com): actual test-payer approvals and provider operations, with persistent SQLite and photos. One shared configured workspace; completed financial history is retained.

Both use the private browser login supplied in the Devpost testing field. That field also contains seller/buyer invitations and the Sandbox test payer. Use the clean URLs and browser login prompt. Provider API keys are never supplied publicly. Judging access remains free through the official period ending 15 December 2026, 17:00 Europe/Warsaw.

## Short hosted review

1. In the replay demo choose Office, Garage or Café to see different goods and group sizes. Create a lot starts an empty catalogue for your own reviewed inventory.
2. For Workshop, open Demo controls → Workshop clearance → Confirmed options · run the assistant. Ask AI to check a question → Check with AI uses the actual model/tools and proposes Jan's checked PLN 190 alternative. The seller sends it; Jan accepts or refuses it as a complete option. Saving it does not approve a purchase.
3. Ready to collect payments and Revised plan · exact holds kept provide short simulated collection and selective-repair runs. Interrupted hold confirmation, Unknown capture result, Refund and cancellations pending, Refund confirmed, Plan check incomplete and Reservation ended show separate recovery states. These shortcuts are rehearsal-only.
4. For actual Sandbox follow the private invitations. The prepared fictional Workshop has confirmed catalogue/preferences, no purchase consent or PayPal hold pre-created. Every buyer separately approves exact basket terms and then PayPal. The seller collects only after all required current holds are ready. Each capture is separate; preparation unlocks after all are confirmed.
5. Ordinary tabs share a role. Sign out before changing identities, or use separate browser profiles. The app displays a one-use sign-in link locally and sends no email; it does not verify real email ownership. If another reviewer has already completed the shared Sandbox workspace, inspect the retained state and use the replay demo for repeat runs. Do not erase financial history.

## Free local build

Use Node.js 24 and npm. Run npm ci, npm run build, then npm start from the folder containing package.json. Open http://127.0.0.1:4319. No account, card, API key or remote database is needed for the default local rehearsal. Without a key, AI proposals are labelled prepared samples; payments are simulations. Each hosted server has a 20-request daily AI abuse limit; manual review remains available.

## Own Sandbox configuration

Configure only server-side values from [README](../README.md). Windows: ./scripts/start-local.ps1 -Mode sandbox runs http://127.0.0.1:4320 with a separate persistent directory. Its organizer-access-v2.json contains the private organizer invitation. Use alex@lotsplit.example and matching buyer invitations. Use a new retained DATA_DIR for another Sandbox workspace after financial history exists. Changing the merchant on an existing V2 store is rejected. Real-money endpoints are disabled.

The [final English video](https://youtu.be/gUwv5R6rCww) shows V2, fictional goods and test funds; its separate failure interlude is explicitly simulated. See [verification](verification.md) for tested results and boundaries. A saved Devpost draft is not proof of final submission.
