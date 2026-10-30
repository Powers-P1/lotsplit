# PayPal AI Hackathon delivery

Official sources checked on 30 October 2026. This is a preparation checklist; it does not record a submission or prize approval.

Submit by **12 November 2026, 12:00 PST / 20:00 UTC / 21:00 Europe/Warsaw**. The rules require a working PayPal Sandbox and AI project, an English description and testing materials, a public source repository with an open-source license, and a public YouTube demonstration shorter than three minutes. A hosted URL is optional when complete local setup instructions provide a functional build. Keep judging access available free of charge through 15 December 2026. Check entrant eligibility and nominate the team representative before submission. [Official rules](https://paypalaihackathon.devpost.com/rules)

| Priority | Award | LOTSPLIT evidence to present | Remaining evidence |
| --- | --- | --- | --- |
| Primary | Best Use of PayPal + AI | Human-reviewed AI catalog and preference suggestions support a complete allocation; buyers approve exact terms before separate PayPal authorizations and captures. | Live Nebius text preferences, one-image vision and the application API purchase with real browser checkout approvals passed. Four authorizations and independently confirmed `COMPLETED` captures total PLN 840 and unlock packing. Present these results in the public demo with their scope below. |
| Primary | Best Demo Delivery | One whole bundle, one clear obstacle, an observable end-to-end outcome, and a short explanation of the consent/payment gates. | An English recording of the working build; use the [90-second script](demo-script.md). |
| Secondary | Best Use of Agentic Commerce | AI helps turn unstructured inputs into a purchase that the application coordinates under explicit buyer consent. | Present the actual automation boundary. Do not describe a deterministic solver as an LLM or claim autonomous AI spending. |
| Sponsor | Best Use of AG Grid | Actual AG Grid Community tables make item review, complete allocation, payment status and packing inspectable. | Show the actual grid interactions and explain the organizer decision they support. |
| Prepared only | Best Use of Render | The Docker Blueprint prepares a single disk-backed service. | A working Render deployment and public URL, plus persistence verification, are still required before claiming Render usage. |

The named honorable mentions have no separate technology conditions in the prize table. Sponsor eligibility is based on using the relevant sponsor's tools. A project may win one grand prize **or** one honorable mention, plus one sponsor prize. These are categories to support with evidence, not cumulative prize promises. [Official rules, prize section](https://paypalaihackathon.devpost.com/rules)

The original local release passed 48 automated tests, TypeScript checks, a production build and a Docker build on 30 October 2026. A later real Sandbox purchase passed through the application API and genuine browser checkout approvals, using one Sandbox payer account for four logical buyers. This is not evidence of four independent payer identities or a complete browser UI walkthrough. Vision processed one demonstration item image; the seeded 24-item catalog was reviewed separately. Packing unlocked without marking physical packing or shipment. The current build offers six rehearsal examples: mixed garage-sale lot, fictional small-company office assets, workshop equipment, vinyl, books and illustrations. Contents, item shares, shared costs and buyer budgets vary; these examples do not add live provider evidence. The office example uses the existing bundle process, without billing, invoice or liquidation-management features. The [verification record](verification.md) records expanded-build checks separately from the original integration result and remaining publication, submission and integration work.

The same three Codex jurors gave an internal conditional GO before those extra examples were added. Their [review follow-up](internal-review.md) is internal tuning by the same panel, not a fresh blind evaluation, a new numerical score or an official competition result.

The English-default v4 source passed 66/66 tests, TypeScript and the production build. Selected English UI, office allocation, delivery gate, cross-build retained chunks, readable lazy-load recovery and GET/POST recovery passed in authorized CUA Edge tabs. One live English Nebius preferences proposal passed and remained unapplied. No new real PayPal action or fresh vision request occurred. V2 and earlier QA remain separate; ZIP v3 was not created, and the Docker result remains historical.

The AG Grid sponsor brief places extra emphasis on AG Studio, custom widgets, theming, layout tools and its agent framework. Useful AG Grid tables satisfy the rules' broad tool condition, but a table alone is a lighter fit for that brief. LOTSPLIT should show its actual tables and avoid an AG Studio claim. [AG Grid sponsor brief](https://paypalaihackathon.devpost.com/details/aggrid)

The Render sponsor page encourages deployment and Render Workflows. A prepared Blueprint is not a deployment. This MVP does not need distributed workflows to coordinate four buyers, so no Workflows claim is planned. [Render sponsor brief](https://paypalaihackathon.devpost.com/details/render)

No Zapier, Channel3, Bryntum, marketplace, unrelated analytics or extra dashboard is needed for the accepted purchase flow. Sponsor tools are optional. [Hackathon overview](https://paypalaihackathon.devpost.com/)

Before submitting:

- Confirm the implemented behavior against the README and submission draft; remove any unverified claim.
- Run the functional build with Nebius and PayPal Sandbox credentials. Offline rehearsal is useful for local review but is not evidence of a real AI request or payment.
- Publish the reviewed source, original assets, setup instructions and MIT license to the chosen public repository.
- Arrange judge access to the working integration without committing API secrets or personal accounts to the repository. Record the access method in the submission's testing instructions.
- Upload the English demo to public YouTube, add the source and demo links, and submit the Devpost entry before the deadline.

The [official resources page](https://paypalaihackathon.devpost.com/resources) links PayPal Sandbox documentation, AI/agent resources and sponsor materials. No PayPal Agent Toolkit or MCP integration should be claimed unless it is actually implemented.
