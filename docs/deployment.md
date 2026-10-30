# Prepared Render deployment

The repository contains a Dockerfile and `render.yaml`; no hosted service has been created. The Blueprint specifies a **paid** `0.5c-512mb` web service in Frankfurt and a 1 GB persistent disk. Creating or syncing it can incur service, storage and usage charges. Review the selected account and current [Render pricing](https://render.com/pricing) before deployment. The plan ID is documented in [Render's compute plans](https://render.com/docs/compute-plans).

The Blueprint assumes this LOTSPLIT directory is the repository root. For a larger repository, configure its root/context paths to point at this directory before creating a service.

The original integration snapshot's local Docker build passed on 30 October 2026. Its one-shot container package check confirmed Node.js 24, built-in SQLite, the compiled server, the original 25 illustration PNGs and the absence of local environment files in the runtime image. That check predates the added rehearsal examples; a current Docker result requires a new build. It did not start a web service or test hosted persistence. See the [verification record](verification.md).

| Setting | Prepared value |
| --- | --- |
| Runtime | Node.js 24, Debian Bookworm slim, multi-stage Docker build |
| Build | `npm ci`, `npm run build`, then prune development dependencies |
| Start | `node dist/server/index.js` |
| Network | `HOST=0.0.0.0`, `PORT=10000` |
| Health check | `/api/health` |
| Storage | `DATA_DIR=/var/data`, disk mounted at `/var/data` |
| Application mode | `sandbox` |
| Scaling | One instance |
| Automatic deploys | Disabled; initial service creation still deploys |

These fields follow the [Blueprint reference](https://render.com/docs/blueprint-spec). Render requires public web services to listen on `0.0.0.0` and the configured port. [Web service networking](https://render.com/docs/web-services)

## Storage constraints

SQLite payment operations, consents and sessions must survive restarts. Render's filesystem is ephemeral outside the attached disk. Persistent disks require a paid service; the free web service cannot preserve this application's SQLite history. Only files beneath `/var/data` persist. A disk belongs to one running instance, prevents horizontal scaling and introduces a short interruption during deploys. It is unavailable during Docker builds and pre-deploy commands, so initialization belongs in application startup. [Persistent disk documentation](https://render.com/docs/disks)

Keep database backups and recovery procedures consistent with the application's SQLite journal state. Do not replace the database with a fresh seed while provider operations remain unresolved. Do not share one data directory between rehearsal and Sandbox deployments.

## Configuration and verification

When the owner authorizes deployment:

1. Publish the reviewed source and select the target Render account. Choose a unique service name if `lotsplit` is unavailable.
2. Supply `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `NEBIUS_API_KEY` through Render's environment settings. They are prompted with `sync: false` and have no value in the Blueprint.
3. The application defaults its public origin to Render's `RENDER_EXTERNAL_URL`. Set `APP_ORIGIN` explicitly when using a different public origin or custom domain. The Blueprint generates a private `ORGANIZER_ACCESS_TOKEN`; use its value to open the organizer invitation described in the README. Do not publish that token.
4. Create the reviewed service with its paid disk. Check `/api/health`, sign in through the intended invitation flow and verify actual Nebius responses. Health/configuration flags alone do not establish successful provider calls.
5. Complete all four Sandbox buyer approvals and verify their exact plan amounts, authorization IDs and captures. Do not report a hosted rehearsal as completed Sandbox payments.
6. Restart the service and confirm that the same collection, consents and operation IDs remain. Check that packing still follows the actual capture states.
7. For incoming events, register `https://<public-host>/api/payments/webhook` on the same PayPal Sandbox REST app and set its `PAYPAL_WEBHOOK_ID` in Render. Verify event handling before claiming webhook delivery has been tested.

Do not put credentials in Docker build arguments or image layers. `.dockerignore` excludes local environment and database files. Render makes service environment variables available at runtime; see [Docker on Render](https://render.com/docs/docker).

Public deployment and Render award claims remain pending until a deployed build and persistence test provide evidence. Distributed Render Workflows are outside this focused MVP.
