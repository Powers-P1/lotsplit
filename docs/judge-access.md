# Judge setup and access — V2

Use Node.js 24 and npm. Run `npm ci`, `npm run build`, then `npm start` from the folder containing `package.json`. Open http://127.0.0.1:4319. The default rehearsal needs no account, card, API key or remote database.

The entry offers Office clearance, Garage sale and Café closure. Demo controls also contains Workshop clearance. Select Alex for the seller, or a buyer for sequential review. Each example has different goods, prices, item counts and buyer counts. **Create a lot** opens a genuinely empty catalogue supporting your own uploaded photos and manually reviewed items.

## Short review

1. Choose Workshop clearance. Open Demo controls → **Confirmed options · run the assistant**.
2. Open **Ask AI to check a question** and **Check with AI**. With Nebius configured this uses the actual agent/tools; without a key the prepared proposal is labeled. Review the suggested complete alternative and send it inside the workspace.
3. Switch to Jan. Accept or refuse the suggested basket; accepting an option still does not authorise payment. Switch to Alex and check/send a complete plan.
4. Review buyer purchase consent, then Sandbox or simulated authorisation as clearly labeled. For a quick rehearsal, **Ready to collect payments** prepares the saved consents/holds, and **Collect payments** performs only local simulation.
5. **Revised plan · exact holds kept** shows Marta/Oskar unchanged and Jan/Nina needing fresh commitments. **Interrupted hold confirmation**, **Unknown capture result**, **Refund and cancellations pending**, **Refund confirmed**, **Plan check incomplete** and **Reservation ended** demonstrate the distinct recovery states. All such shortcuts are rehearsal-only.
6. Once all captures complete, check the preparation list. No basket is automatically marked prepared.

Ordinary tabs on one origin share one role. Use separate browser profiles for simultaneous independent sessions. The role chooser is intended for sequential rehearsal review, not identity verification.

## Real provider access

Sandbox uses genuine PayPal test API requests and test-payer approval; real-money PayPal endpoints are disabled. Nebius credentials enable real photo, preference and bounded agent requests. Missing credentials never become a Sandbox success. Configure server-only values described in [README](../README.md); do not publish keys or test-payer credentials.

Windows: `./scripts/start-local.ps1 -Mode sandbox` uses http://127.0.0.1:4320 with its own persistent data. The generated `DATA_DIR/organizer-access-v2.json` contains the private organizer token. Open `/?invite=<token>` on that origin and use `alex@lotsplit.example`. After setting buyer identities, issue each buyer's private invitation and use its matching address. The prototype displays a one-use sign-in link in the requesting browser and sends no email. It is a demonstration invitation flow, not verified email ownership for a production marketplace.

Use one configured merchant. Create a separate DATA_DIR for another Sandbox workspace after financial history exists; never erase previous payment evidence. Changing the merchant identity on an existing V2 store is rejected.

Final V2 video: https://youtu.be/gUwv5R6rCww. The current publication pass updates source and private hosted access separately; use only the service/access instructions actually supplied with the final Devpost entry. Do not infer a submitted entry or running host from a draft/checklist. Public credentials and provider keys are never required in the repository.

See [verification](verification.md) for actual tested results, injected failure boundaries and limitations. The no-key local rehearsal is free, while a hosted live-provider route remains a separate handoff.
