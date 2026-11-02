# Asset provenance — current V2 and archived V1

The current V2 interface uses original AI-generated photographic illustrations of **fictional inventory**. They do not document real goods, inspected condition, ownership, compatibility or market value. Seller review and fixed item prices are separate application steps.

## Current V2 examples

An own lot starts empty and supports **1–24 catalogue positions, 2–6 active buyers and up to two complete acceptable basket options per buyer**. The built-in examples demonstrate different sizes; they are not a requirement to use a fixed assortment.

| Example | Positions | Buyers | Fixed lot total | Overview |
| --- | --- | --- | --- | --- |
| Office clearance | 15 | 4 | PLN 3,140 | `public/assets/v2/office.png` |
| Garage sale | 9 | 3 | PLN 1,035 | `public/assets/v2/garage.png` |
| Café closure | 18 | 5 | PLN 3,550 | `public/assets/v2/cafe.png` |
| Workshop clearance | 12 | 4 | PLN 1,800 | `public/assets/v2/hero.png` |

The example definitions are in [shared/v2-examples.ts](../shared/v2-examples.ts); item prices and image assignments are in [server/v2-catalog.ts](../server/v2-catalog.ts). These totals are prepared demonstration prices, not AI valuations or measured sale proceeds.

The [V2 asset manifest](v2-assets.json), dated 31 October 2026, records the generation provider, prompt, source output name and SHA-256 for seven assets:

- Four overview/hero images: `hero.png`, `office.png`, `garage.png` and `cafe.png`.
- Three four-cell workshop sheets: `items-01-04.png`, `items-05-08.png` and `items-09-12.png`. Each cell represents one of the twelve workshop catalogue positions; the UI uses the sheet's cell reference.

The provider recorded in the manifest is built-in ImageGen. The images were created as standalone assets; accepted interface reference screenshots are not the interactive UI.

Some V2 image reuse is deliberate. Office and Garage keep item thumbnails from the retained generated atlases while using their new V2 overviews and smaller catalogues. Café positions currently reuse the café overview rather than claiming eighteen distinct item photographs. None of these prepared assets proves a new vision inference.

## Rights and evidence boundaries

Bundled original demonstration assets accompany the project under its [MIT license](../LICENSE). Installed libraries, fonts and icons retain their upstream licenses. The generated catalogues do not use external seller photographs, commercial album/book cover images or card-franchise artwork. Uploaded seller photos are a separate input; the bundled asset manifest does not establish rights to a user's upload.

Current [verification](verification.md) distinguishes actual inference from prepared inventory. Hosted V2 vision returned six unconfirmed suggestions from a supplied photo; it did not produce the complete prepared twelve-item catalogue. People reviewed names, conditions, compatibility and fixed prices. Actual preference inference and the checked alternative question have their own evidence. No complete catalogue extraction or general accuracy rate is claimed.

The [final film](https://youtu.be/gUwv5R6rCww) combines actual application recordings with labelled AI illustration scenes. Music/voice publication coverage for the safelisted channel was rechecked on 1 November during the active Epidemic Pro trial, as recorded in [hackathon notes](hackathon.md). That record is distinct from this image manifest and does not automatically cover a later new upload.

## Public product page assets

The public landing uses the existing generated workshop photo, encoded as responsive 1280/640-pixel WebP files. It is the same fictional source documented in the V2 manifest, not a new photograph of actual goods. `public/site/repair.webp` is a lossless encoding of the actual V2 application screenshot in `docs/screenshots/repair-desktop.png`; it is not generated interface artwork. The native SVG favicon is a simple original letter mark.

Inter 400/600/700 WOFF2 files come from the installed `@fontsource/inter` package. Their SIL Open Font License is included as `public/site/FONT-LICENSE.txt`. [Landing asset hashes](landing-assets.json) identify the derived files and source paths. No copyrighted music, film source or private provider receipt is bundled into the public page.

## Archived V1 assets

The older six examples — Garage Sale, Small Business Clearance, Workshop Equipment, Second-Hand Vinyl, Moving-Day Bookshelf and Collectible Illustrations — belong to the retained V1 material. Their six 24-item catalogues are **not the current V2 example specification**.

Legacy assets remain under `public/assets/examples/`, `public/assets/collection.png` and `public/assets/items/`. The original illustration set has twenty-four item PNGs; the other older sets use generated atlases. Some Office/Garage thumbnails are reused as described above. Retaining a legacy image or AG Grid dependency does not establish use of the old V1 interface in the current V2 flow.

Earlier vision/payment results keep their original scope in [historical verification](history/verification-through-2026-10-30.md). Current evidence and limits are in [verification](verification.md).
