# Product 3D assets and phone validation

3D/AR is optional presentation. It never changes customizations, trusted pricing,
orders, Auth, table sessions or visit-only privacy. Online payments are permanently
excluded. The public catalogue is the only source of live product assets.

## Supported formats and configuration

- Self-contained GLB 2.0 with embedded geometry and textures is required.
- A matching USDZ is optional for iOS Quick Look. Without it, model-viewer exports
  the static GLB to USDZ on demand; this consumes phone time/memory. Supply a
  tested USDZ when the automatic conversion is inadequate. Animations and advanced
  materials do not necessarily survive conversion.
- Optional optimized WebP, JPEG, PNG or AVIF poster.
- `model_dimensions_m` is `[width, height, depth]` in **metres**, including the plate
  and every baked root transform. For a 24cm plate 5cm high: `[0.24,0.05,0.24]`.
  Each dimension must be finite and between 0.003 and 1.2m. Missing dimensions allow
  3D but disable AR. USDZ alone does not create an entry point.

Owners and managers configure assets in `/admin/menu` → **Photos & 3D** → **3D preview & AR**. Save a new dish as a draft first. Upload a GLB, optional matching USDZ and poster, inspect the preview and measured bounds, then save the dish. Record rights, source and physical measurement notes; drafts persist before final review. These notes are private to managers. If a license requires public attribution, include that credit in the public dish description before publishing. Confirm the model matches the actual dish at real scale before enabling customer 3D. Table placement is a separate opt-in. Ordinary staff and customers cannot upload or edit.

For an explicitly requested demonstration, save the source/licence information,
confirm permission for public sample presentation and select **Enable 3D
demonstration**. This separate manager action exposes **View 3D demo**, a visible
sample/portion disclaimer and reference dimensions. It keeps `model_verified`
false and forces AR off; it never certifies an actual dish. Save pending editor
changes first. Replacing the model, removing rights/source information or
completing ordinary physical review revokes this demonstration approval.
Live mode only uses that product's approved asset; it never substitutes fixtures.

Run `npm run storage:setup` once with the server-only media key in ignored `.env.local`, after applying the administration migrations. The public `restaurant-media` bucket uses immutable paths:

```text
restaurants/<restaurant-uuid>/products/<product-uuid>/images/<asset-uuid>.webp
restaurants/<restaurant-uuid>/products/<product-uuid>/models/<asset-uuid>.glb
restaurants/<restaurant-uuid>/products/<product-uuid>/models/<asset-uuid>.usdz
```

Only the server gateway can write to this bucket, after validating bytes. New menu saves reference validated asset IDs; the server derives URLs and measured dimensions. Do not set arbitrary URLs or dimension declarations through browser forms or direct product updates. Images/posters accept JPEG/PNG/WebP input and are stored as optimized WebP. Legacy `dish-models/<restaurant>/<product>/` and checked-in `/models/<restaurant>/<product>/` URL guards remain for compatible assets and the explicitly labelled demo; legacy live assets require the new review/onboarding workflow. No unrelated sample is substituted into live dishes.

All bucket objects, including unreviewed draft assets, are public presentation material. Never store orders, identities or confidential media here. Referenced assets cannot be deleted. Replacements get a new UUID path; remove unused files explicitly through the menu workspace. Serve HTTPS and the correct GLB/USDZ content types. The original geometry is never arbitrarily resized by the viewer.

The mapper allows only the configured Supabase HTTPS origin's exact public
tenant/product folder, or its exact local public folder. Only the formats above
are allowed. Other hosts, signed/query/hash URLs, credentials, traversal, encoded
paths and another product/restaurant folder are rejected. Unconfigured or rejected
GLB means ordinary photography without a broken 3D/AR button. No demo fallback is
inserted into live data. On explicit retry only, the application adds its own numeric
`preview_attempt` query parameter to the same validated GLB resource to avoid the
SDK's rejected-load cache. No Auth, QR or visit information enters that URL.

## Asset acceptance and scale

1. Obtain a legitimate licence permitting commercial display and redistribution.
   Keep provenance and required attribution. A scan must faithfully match the
   restaurant's actual plated dish; generic stock food is not portion evidence.
2. Inspect GLB resources before uploading. Require embedded buffers/textures and
   no remote URI references, scripts, tracking URLs or unnecessary extensions.
   The upload gateway checks embedded resources and vertex buffers; rights, actual dish fidelity and physical-device checks remain a human responsibility. Also validate with Khronos glTF Validator and a visual inspection.
3. Export glTF metres, apply transforms, orient the plate horizontally, and place
   its underside at Y=0. Measure the final world-space geometry, including plate.
   Avoid an oversized invisible mesh, below-floor pivot or arbitrary viewer scale.
4. Check the matching USDZ uses the same physical dimensions, origin, orientation
   and materials. The browser compares GLB geometry only; it cannot certify an
   independently supplied USDZ or the actual restaurant portion.
5. Confirm the measured bounding box recorded by the upload gateway. On load, the viewer
   compares `getDimensions()` against that declaration (5% or 2mm tolerance).
   Missing/mismatched/implausible geometry disables AR while retaining 3D. Fixed
   AR scaling preserves baked geometry; neither setting proves portion accuracy.
6. Compare the model to the actual dish on physical phones before enabling it
   commercially. Models represent the base presentation; selected extras/removals
   are explained in the regular order form and do not alter the model.

Target 1–3MB GLB (hard upload limit 4,000,000 bytes), roughly 10–50k triangles or fewer, and 512–1024px
textures where sufficient; inspect on ordinary phones. Use modest materials,
embedded PNG/JPEG textures. The initial gateway deliberately rejects Draco/KTX extensions, skins, animation and unbaked transforms; re-export to the documented static format. The sample uses ordinary embedded PNGs and needs no external decoder downloads.
Avoid large environment maps, animations and high texture counts. Use a small
poster and versioned immutable asset names.

## Genuine development sample

The owner-supplied Yakitori scene has also been converted and validated. See
[Yakitori preparation and preview](assets/yakitori.md). After owner confirmation
of web-delivery rights, the media gateway stored its GLB/images for the
Yakitori Momo dish in development Casa Mesa. It was initially published as a
**€15, explicitly labelled 3D demonstration**. A later manager change enabled
reviewed 3D/AR flags; the geometry still measures 16.8 × 2.2 × 16.1 cm. No
physical-phone placement/scale certification is claimed here. Local source and
working files remain ignored; no unrelated live dish receives this model.

Microsoft's [Avocado](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado)
model/associated imagery is CC0. Repository metadata has its separately documented
CC-BY-4.0 terms; [source licence](assets/avocado-LICENSE.md) is retained.
This is a textured ingredient study, **not the salmon-eggs dish or its portion**.
Both entry and viewer carry that explanation. Only explicit demo mode references it.

The source GLB is 8,110,040 bytes. Offline preparation reduces embedded textures to
512px, rebuilds buffer views without unused source images, bakes a horizontal
cut-side-up pose, sets the underside to Y=0 and a declared 10cm reference length.
The result is 628,136 bytes (92.3% smaller), 682 triangles, with no external
resources and dimensions **0.067670 × 0.043911 × 0.100000m**. This reference size is
an authored development size, not a measurement of a restaurant ingredient.

`scripts/prepare-avocado-demo.mjs` reproduces the output from the official source
file using the existing Next installation's `sharp` tooling. It adds no runtime
dependency. `docs/assets/avocado-report.json` records hashes, measured bounds and
changes. Tests independently read actual vertex positions from the final GLB.

```sh
node scripts/prepare-avocado-demo.mjs /path/to/official/Avocado.glb
npm run test:ar
```

A faithful, licensed, measured scan of Casa Mesa's plated salmon eggs (or another
selected dish), a matching poster and optionally a matched USDZ remain required
before that **live** product can be advertised as a realistic dish/portion preview.

## Local and physical-phone testing

```sh
APP_DATA_MODE=demo npm run dev -- --port 3001
```

Open `http://localhost:3001/r/mesa/products/eggs?table=22222222-2222-4222-8222-222222222222`.
Select bread, extras and a quantity; open 3D, rotate with touch/mouse/arrow keys,
zoom with gestures, Page Up/Down or labelled buttons, use Centre dish and return
with Back to dish or Escape. The phone viewer fills the viewport so the product's
sticky ordering bar cannot cover its controls. Focus returns to the preview entry.
Selections stay intact; add to the bag and verify its saved customizations. Reload
the product and verify the in-progress draft. Change to pasta: no 3D entry. Demo
order submission stays disabled. Live mode never substitutes the sample.

The default HTTP localhost policy offers 3D and an explanatory AR fallback. It is
not a physical-phone AR test. `canActivateAR` is the SDK's capability signal, not
proof that camera permission, ARCore/ARKit and surface placement will succeed.
Capability can vary by hardware, OS, browser, embedded QR-scanner browser and
installed platform services. Open the HTTPS site in Safari on iPhone/iPad or
Chrome on a supported Android phone. Desktop provides interactive 3D when WebGL
works; no fake AR or camera appears.

Use a normal HTTPS Vercel preview/deployment accessible to the devices, with only
the existing public Supabase variables and the intended mode. Apply the migration
separately. Do not publish credentials, make an insecure public tunnel or grant
camera permission automatically. The customer explicitly presses **View on my
table**. WebXR must be allowed by any embedding/Permissions Policy configuration.

On **physical Safari/iPhone** and **compatible Chrome/Android**:

1. Load the GLB, rotate/zoom, inspect lighting/textures and verify the dish match.
2. Press View on my table. Grant camera access yourself if requested. Confirm an
   actual WebXR, Scene Viewer or Quick Look session opens; a rotating 3D model is
   not AR. Quick Look/Scene Viewer supply their own UI, without app overlays.
3. Find a real flat table using the native/on-screen guide. Scene Viewer and
   Quick Look are preferred when supported; WebXR remains a fallback. In WebXR,
   Find your table changes only after the SDK reports placement. Losing tracking
   asks the customer to point back at the table and move slowly in good light.
   The browser guide is not injected into native viewers. Place the dish, walk
   around it and compare it to a real measured plate/portion. Check fixed scale,
   horizontal orientation, contact shadow and no floating/embedded geometry.
   Compare width/depth with a ruler or a physical plate. A larger 3D camera view
   does not enlarge the AR asset. If the mesh is too small, rescale/re-export it
   against those measurements, replace it through the validated media workflow
   and repeat manager review; never just change dimension metadata or mark it
   verified to hide a mismatch. A world-anchored dish should stay on the table
   when the phone moves, rather than follow the screen.
4. Exit with the viewer's native/browser control. Confirm restaurant/table,
   selected options, quantity and bag are intact. Repeat after backgrounding the
   app and after a page reload. Drafts require sessionStorage for reload recovery;
   blocked storage gives an explicit notice. They never grant order access.
5. Deny camera permission, interrupt the connection, test a missing/bad asset and
   retry. Photo/customization/ordering must remain usable. Test a low-memory phone.
6. In live mode, run the usual order/table-close/privacy scenario. A closed visit
   discards stale product drafts just as it discards stale bags/reviews. Public
   food models are catalogue information, not private historical order access.

No physical-phone AR launch, surface placement or real portion-size verification
has been completed in the available environment. Desktop/device emulation cannot
certify those outcomes. They remain explicit release requirements.

### Camera-framing and phone usability fixes · 18 October 2026

Validation passed 316 automated tests (including 177 PostgreSQL checks),
TypeScript, ESLint and the production build. Added controller tests cover
centering/reset, unchanged physical geometry, native-first AR selection,
synchronous explicit launch, actual placement/tracking events, retry after a
failed session and listener cleanup. Existing cart/visit-isolation tests still
pass. No schema, asset bytes, private reviews or product approvals were changed.

The actual development Yakitori GLB loaded in Chrome. The focused preview was
checked at 390 × 844, 375 × 667, 667 × 375 and 412 × 924 viewport sizes; the
320px-wide preview was also inspected. The ordering bar no longer covers viewer
controls. Keyboard opening/Escape restored focus, and a quantity of two survived
reopening/closing before being restored to one. These are desktop browser and
device-emulation checks over local HTTP, not iPhone Safari/Android camera tests.

The live configuration still uses the original 16.8 × 2.2 × 16.1 cm geometry.
The owner confirmed on 18 October that the approximate 17 × 16 cm footprint is
the real measurement, and reported testing on Android. Keep the geometry and
fixed scale unchanged; investigate placement distance and tracking on Android
rather than enlarging the physical portion. This confirmation does not establish
iPhone behavior or independently verify camera anchoring. A larger preview camera
and native launcher still require testing on the affected phone after deployment.

A pre-publication asset inspection of `restaurant-os-gamma-nine.vercel.app` found
the old inline viewer and WebXR-first launcher, without the new modal/centring
implementation. The fixes were still local at that check; publishing the new
commit is required before phone retesting can exercise the changed viewer.

Official references: [model-viewer AR examples](https://modelviewer.dev/examples/augmentedreality/),
[public API documentation](https://modelviewer.dev/docs/),
[Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator).

## Manager upload workflow (Increment 8)

Use `/admin/menu` → a saved dish → **Photos & 3D** → **3D preview & AR**. Upload a GLB and optional matching USDZ/poster; inspect the preview and measured geometry. Record the license, source and physical measurement procedure, confirm review, then opt into AR. Uploaded/unverified, reviewed 3D-only and reviewed AR-enabled states are separate. Do not set public model URLs directly for new assets: manager saves use ready registry asset IDs and derive tenant/product URLs on the server. Existing legacy model URLs remain unreviewed until onboarded through this workflow. No generic demo asset is assigned to live dishes.

The initial validation gateway requires a static, uncompressed GLB 2.0 with transforms baked, embedded PNG/JPEG textures, metre geometry and its base at height zero. No animations, skins, Draco or KTX extensions. Geometry is measured from actual vertex buffers; accessor-declared bounds are not trusted. Every dimension must be between 3 mm and 1.2 m. Up to 100k triangles / 150k vertices, eight textures at 2048 px, and 4 MB per file. Photos/posters are re-encoded to WebP and stripped of EXIF. USDZ receives ZIP/scene/CRC/path/resource checks; binary USD semantics and real physical dimensions still require authoring-tool and physical-iPhone verification. A checkbox and fixed scaling never certify a real portion.

Use an HTTPS deployment for physical-phone AR testing. Local HTTP checks and desktop 3D previews do not establish iOS/Android AR compatibility. Files in the public bucket, including draft assets, are publicly readable. Store only presentation material. Replacements create new paths; explicit unused-file removal cannot delete any file still referenced by a product or branding settings.
