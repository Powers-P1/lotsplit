# Judge setup and access

LOTSPLIT runs locally on a desktop with **Node.js 24 and npm**. The source includes the interface, server, SQLite storage and all demonstration assets. A hosted service is not required for this setup.

## Run the free, no-key rehearsal

1. Download this repository using **Code → Download ZIP**, then extract it, or clone the repository. Open a terminal in the extracted folder containing `package.json`.
2. Check `node --version`; use Node.js 24. Install the locked dependencies:

   ```sh
   npm ci
   ```

3. Copy `.env.example` to `.env`. On macOS/Linux use `cp .env.example .env`; in Windows PowerShell use `Copy-Item .env.example .env`. Keep `APP_MODE=rehearsal` and leave the PayPal and Nebius key fields blank. Use a fresh source checkout without a private `.env.local`, which would take precedence over `.env`.
4. Start the application:

   ```sh
   npm run dev
   ```

5. Open [http://127.0.0.1:4319](http://127.0.0.1:4319). Choose **Garage Sale** to enter as Kasia, the organizer. The page and all six examples default to English.

No account, payment card, PayPal login or AI key is needed for rehearsal. Payments are explicitly simulated. With no Nebius key, AI proposals are explicitly labeled samples and do not analyze the supplied input. This path demonstrates the application and its consent, allocation, recovery and packing rules; it does not demonstrate live AI or PayPal integration.

For a short review, open **Try the demo**, select **Ready to capture payments**, inspect the four accepted allocations, and use **Capture payments**. The simulated completed results unlock **View packing list**. **Unknown result**, **Jan withdraws** and **New plan with Ewa** exercise recovery and changed consent. These controls replace only the current rehearsal. The [README purchase walkthrough](../README.md#review-the-purchase-flow) describes the complete manual path.

Use separate browser profiles or different browsers for simultaneous organizer and buyer sessions. Ordinary tabs share one login. The role chooser in **Try the demo** is also suitable for sequential rehearsal review.

Stop the server with **Ctrl+C**. Restarting retains the saved collection in `data/lotsplit-rehearsal.sqlite`. To start another rehearsal, use the example/scenario controls in the application. A new rehearsal reserves the bundle for 48 hours from creation; an existing expired collection needs a future **Reserved until** value before new authorizations or captures.

## Run the compiled build

After `npm ci`, run:

```sh
npm run build
```

Add `NODE_ENV=production` to your local `.env`, then run:

```sh
npm start
```

Open the same URL. [The health endpoint](http://127.0.0.1:4319/api/health) should return `ok: true`, `mode: rehearsal`, and both provider flags `false` for the no-key setup. These flags describe configuration, not successful provider transactions. Remove `NODE_ENV=production` before returning to development mode.

The English v4 source's clean install, production build, production start, development start, HTTP 200 entry page and health response were verified on 30 October 2026 using Node.js 24.19.0 and npm 11.17.0. The check copied no private environment, existing database or installed dependencies. The production output contained all 35 PNG assets. A separate API smoke check loaded **Ready to capture payments**, completed simulated captures, unlocked four packing lists and retained that state after a restart. These checks used a separate loopback port and did not repeat live provider tests or a browser walkthrough. See [the verification record](verification.md) for the separate integration evidence and its boundaries.

## Optional: real AI and PayPal Sandbox on your own local instance

This is a separate integration setup. PayPal Sandbox uses test money. Nebius requires an authorized account/key and may consume that account's credit; the free rehearsal above does not need it.

1. Stop the server. In `.env`, set `APP_MODE=sandbox` and `DATA_DIR=./data/judge-sandbox`. Keep `HOST=127.0.0.1`, `PORT=4319` and `APP_ORIGIN=http://127.0.0.1:4319`. This creates a fresh Sandbox store, separate from rehearsal and any previous provider test.
2. In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), select **Apps & Credentials → Sandbox** and create/select a REST app. Put its client ID and secret in the local `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` fields. Under **Testing Tools → Sandbox Accounts**, obtain a personal Sandbox buyer's login and password. Use that test buyer at checkout; the REST credentials are merchant API credentials, not the buyer login. [PayPal REST setup](https://developer.paypal.com/api/rest/)
3. Put an authorized Nebius key in local `NEBIUS_API_KEY`. Retain the base URL and model fields from `.env.example`, or select models your account supports. An unavailable model or provider returns an error; Sandbox does not replace it with a sample response.
4. Keep all credentials in the ignored local `.env`; never copy them into browser code, the repository, screenshots or a source archive. Start the application with `npm run dev`, or with the compiled-build procedure above.
5. The first Sandbox start creates a private `data/judge-sandbox/organizer-access.json`. Read the token in that file locally, then open `http://127.0.0.1:4319/?invite=` followed by its URL-encoded value. Use `kasia@lotsplit.example`. The app displays a one-use login link in the current session; it sends no email.
6. Kasia creates each buyer invitation. Open each in a separate browser profile and use its matching sample email: `maja@lotsplit.example`, `ola@lotsplit.example`, `bartek@lotsplit.example`, `jan@lotsplit.example`, or `ewa@lotsplit.example`. These fictional addresses are access-flow identifiers.
7. Follow the [purchase walkthrough](../README.md#review-the-purchase-flow): confirm the catalog and fixed shares; save each buyer's six preferences, alternatives and cap; calculate and send the plan; accept the exact terms and enter a fictitious delivery address; approve each authorization through genuine PayPal Sandbox checkout; return to the same buyer session; then capture as Kasia. Packing opens only after all four captures are confirmed `COMPLETED`.

PayPal return URLs must match `APP_ORIGIN`. If port 4319 is occupied, change both `PORT` and `APP_ORIGIN` to the same unused local port and restart. Do not delete or replace a Sandbox store with unresolved payment operations. Rehearsal reset controls are disabled in Sandbox.

Local checkout and synchronous provider readback do not require a webhook. To test webhook delivery, a separately hosted HTTPS endpoint and a matching Sandbox `PAYPAL_WEBHOOK_ID` are required; follow [deployment instructions](deployment.md). Webhook verification is not claimed by the no-key or clean-install checks.

## Private live-integration access status

The public repository contains no shared provider keys, Sandbox buyer passwords or organizer invitation. The optional own-account setup above is not a claim that free live-provider judging access has been provisioned.

Any entrant-provided live judging configuration or hosted invitation must be delivered through the submission's private testing/access instructions, together with how to obtain it and its availability period. Until that access is supplied and tested, private live-integration access remains **pending**. Do not use the author's existing private environment or database as a public demo.

The [official rules](https://paypalaihackathon.devpost.com/rules) accept complete local setup instructions as the functional-build route, and also require free judging access and any necessary special-access details through the judging period ending 15 December 2026. The no-key rehearsal is available from this source; its provider simulations remain visibly labeled.

## Troubleshooting

- **SQLite or engine errors:** check Node.js 24 is the executable used by the terminal, then rerun `npm ci`. No external database server is needed.
- **Blank provider flags in rehearsal:** expected with the no-key configuration. For real integration, use the Sandbox setup above.
- **Unexpected mode or port:** check for an existing `.env.local` or shell environment setting. Use a fresh checkout for an isolated review.
- **Connection error:** keep the Node process running and reopen the matching local URL. The application preserves uncertain payment operations rather than automatically repeating a payment POST.
- **Production page missing:** run `npm run build` before `npm start`, and start in the repository root.
