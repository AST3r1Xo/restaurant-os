# Owner-supplied Yakitori model: local preparation

The supplied `yakitori_free_momo.blend` and `textures.zip` represent **Yakitori
Momo**, five chicken skewers and a rectangular plate, by **Oshinchan**.
[Original listing](https://www.cgtrader.com/free-3d-models/food/miscellaneous/yakitori-free),
model ID 5890465. The owner confirmed permission for web/AR model delivery on
**16 October 2026**. It is attached to **Yakitori Momo (€15)** in development
Casa Mesa, using the authorized manager/media workflow. The owner subsequently
published the dish and requested a customer-facing **3D demonstration**. That
separate approval is now enabled, with a visible sample/portion disclaimer and
AR disabled. It is not a verified representation of an actual restaurant portion
and is not associated with an unrelated existing dish.

## Prepared files

Outputs are in ignored `.local-assets/yakitori/`, outside `public/`:

- `yakitori-momo-optimized.glb`: final embedded GLB, **1,499,996 bytes**, 6,784
  triangles, two materials, six embedded textures and no external resources.
- `yakitori-poster.webp`: locally rendered review image, 54,786 bytes.
- `source-report.json`: input hashes, author/source and preparation changes.
- `validation-report.json`: actual upload-gateway validation and measured bounds.
- `khronos-validation.json`: independent Khronos validator result, zero errors
  and zero warnings.

Blender 4.5.14 LTS relinks only the six required source textures, applies the
evaluated geometry/transforms, triangulates with explicit normal-map tangents,
centres the plate and places its underside at Y=0 in glTF. Its original metric
scale is retained: **0.16785085 × 0.02208473 × 0.16057506 metres** (width × height ×
depth). This is authored geometry, **not a real portion measurement**.

The 5,224,952-byte unoptimized export exceeds the application's 4 MB upload limit.
Offline texture optimization reduces it by **71.3%** without changing geometry:
1024px JPEG base colours, 512px PNG normal/roughness maps. It requires no Draco,
KTX or additional runtime decoder. Original Blender/ZIP files remain unchanged.

## Local preview

From the repository, with Node.js 24+:

```sh
npm run preview:model -- .local-assets/yakitori/yakitori-momo-optimized.glb
```

Open **http://localhost:3015**, then **Explorar em 3D**. Drag to rotate, use the
zoom/reset controls and return to the image. The existing installed Google
model-viewer runtime is loaded only after clicking. AR is deliberately disabled.

This is a standalone local review tool, not a customer menu, uploaded product or
new production route. It binds only to 127.0.0.1, reads no environment credentials,
validates the GLB through the existing media gateway before starting and serves
only its HTML, model, poster and installed viewer runtime. It rejects other Host
headers, cross-site requests, directory/file enumeration and writes. CSP limits
network requests to the local origin; responses are no-store. Stop with Ctrl+C.
`LOCAL_MODEL_PORT` may select a different unoccupied local port.

## Reproduce preparation

Use an official Blender 4.5+ binary; leave source script execution disabled:

```sh
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python scripts/prepare-yakitori.py -- \
  ~/Downloads/yakitori_free_momo.blend ~/Downloads/textures.zip
node scripts/optimize-local-model.mjs .local-assets/yakitori/yakitori-momo.glb
```

The recipe refuses unexpected objects/units, unsafe archives and overwriting a
previous review. Move an existing `.local-assets/yakitori` aside before rerunning.
It never writes into the original downloads, `public/`, Supabase or a product row.
The original personal files and generated derivatives are excluded from Git.
Do not force-add them or copy them into public deployment folders.

## Publication requirements

The listing permits personal/commercial use but explicitly prohibits
redistribution/resale of model data. Its current license is **Royalty Free
(no AI)**. The [CGTrader license terms](https://www.cgtrader.com/pages/terms-and-conditions)
also constrain access to distributed model data. The owner explicitly confirmed
permission for delivering this model through the web/AR viewer in this conversation
on **16 October 2026**. That confirmation, source and preparation details are
recorded in the private manager review notes; no independent review of a written
license grant is claimed. Conversion alone does not grant rights. Keep raw
Blender/texture sources out of Git and public asset folders.

The import created a new **draft** dish through `save_menu_product` using the
existing verified owner session. Product ID: `21f4a725-2ff9-4a41-b353-9ce307685872`.
The optimized GLB, rendered product image and poster were uploaded through
`/api/admin/media`; each ready asset belongs to that exact tenant/product and its
stored bytes were fetched and verified by hash. No application service key was
used for menu metadata or authorization. No unrelated products were changed.

Open `/admin/menu`, select Casa Mesa, find **Yakitori Momo**, edit **Photography
& 3D** and press **Preview in 3D**. The saved source/rights/measurement notes are
visible only to authorized managers. The owner confirmed a **€15.00** selling
price on 16 October 2026, stored as **1500 integer minor units**. The dish is now
published and available, as independently enabled by the owner. Its description
also identifies it as a demonstration. Confirm recipe, ingredients and allergens
before using it to sell a real dish.

Storage files are public even while a product is a draft; this upload was made
only after the owner's explicit web-delivery permission confirmation. Customer
demonstration is enabled through `set_model_demonstration`; `model_verified` and
`model_ar_enabled` remain false because actual dish/scale review is incomplete.
Managers can disable the demonstration in the same section, or save rights/source
notes and explicitly enable it for another suitable product. Replacing its model
or removing rights/source information revokes approval. Ordinary real-dish 3D
still requires the existing human review. Enable AR only after real-phone
size/orientation/placement checks. Never assign this stock model to an unrelated
existing item.

With the updated application running in live mode, open
`http://localhost:3000/r/mesa/products/21f4a725-2ff9-4a41-b353-9ce307685872`
and select **View 3D demo**. Existing QR/table context is retained when navigating
from the menu. An older Vercel build needs the updated code deployed separately;
changing the database flag alone cannot add a button to older application code.
No deployment was performed for this change.

## Evidence and remaining checks

The actual optimized GLB passed the application's complete byte/image/geometry
validation and the independent Khronos glTF Validator with zero errors/warnings.
The model was rendered locally in Blender and the poster visually inspected.
The local viewer's HTTP delivery, inline module syntax and access restrictions
were checked. The subsequent demonstration implementation passed **301 automated
tests**, including **173 database tests**, TypeScript, ESLint and the production
build. Tests cover explicit consent, owner/manager permissions, tenant isolation,
stale versions, approval invalidation, visible disclaimers and forced AR denial.

The actual development workflow also passed verified owner authentication,
draft creation, three validated gateway uploads, public stored-byte hash checks,
persisted product/media/review associations, staff-page HTTP rendering and
anonymous denial while the product was a draft. Migration
`20261016204244_model_demonstrations.sql` was then applied to development and
database types regenerated. The authenticated owner enabled the demonstration;
anonymous catalogue queries mapped the actual product/model, and the public GLB
returned HTTP 200. Its €15 price and publication/availability were preserved.

No automated browser surface was available to confirm interactive rotation/zoom;
HTTP and rendering checks do not certify WebGL viewer execution. Physical-phone
AR, real dish measurements and completed selling/recipe configuration remain
pending. Customer demonstration is enabled locally; hosted code still requires
an explicitly authorized deployment. There is no supplied USDZ; the normal optional
Quick Look conversion architecture is unchanged.
