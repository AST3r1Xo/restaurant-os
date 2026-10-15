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

Only trusted restaurant owners/administrators configure assets in this increment.
There is no customer upload, arbitrary model proxy or new storage administration UI.
Existing product RLS still requires ownership/management for modifications and a
published restaurant, active category and available product for public reads.

Create a public Supabase Storage bucket named `dish-models` through trusted
administration, then upload into:

```text
dish-models/<restaurant-uuid>/<product-uuid>/dish.glb
dish-models/<restaurant-uuid>/<product-uuid>/dish.usdz
dish-models/<restaurant-uuid>/<product-uuid>/poster.webp
```

Public read is appropriate for published food models, never orders or identities.
Restrict writes to trusted administration; do not add anonymous upload policies.
Serve correct content types (`model/gltf-binary`, `model/vnd.usdz+zip`, `image/webp`),
HTTPS, CORS permitting the application and native viewers, and sensible versioned
file caching. Use names such as `dish-v2.glb` when replacing an asset. Keep GLB/USDZ
publicly retrievable without cookies, signed URLs or authentication prompts.

An alternative is checked-in public files under
`public/models/<restaurant-uuid>/<product-uuid>/`. Their URL begins `/models/…`.
The same exact restaurant/product scope is enforced. Local files deploy with Vercel.

After verifying licensing, dimensions and content, configure only the intended row:

```sql
update public.products
set model_glb_url = 'https://PROJECT.supabase.co/storage/v1/object/public/dish-models/RESTAURANT/PRODUCT/dish-v1.glb',
    model_usdz_url = null, -- or the corresponding tested dish-v1.usdz URL
    model_poster_url = 'https://PROJECT.supabase.co/storage/v1/object/public/dish-models/RESTAURANT/PRODUCT/poster-v1.webp',
    model_dimensions_m = array[0.24, 0.05, 0.24]::double precision[]
where restaurant_id = 'RESTAURANT-UUID' and id = 'PRODUCT-UUID';
```

Replace all placeholders and dimensions with the **actual** identifiers and model
measurements. Use a new versioned migration for repeatable deployed catalogue
configuration. Never edit an applied migration, assign sample assets to unrelated
live food, or paste privileged credentials into public URLs.

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
   The URL guard does not inspect arbitrary binary contents at runtime; onboarding
   remains trusted. Validate with Khronos glTF Validator and a visual inspection.
3. Export glTF metres, apply transforms, orient the plate horizontally, and place
   its underside at Y=0. Measure the final world-space geometry, including plate.
   Avoid an oversized invisible mesh, below-floor pivot or arbitrary viewer scale.
4. Check the matching USDZ uses the same physical dimensions, origin, orientation
   and materials. The browser compares GLB geometry only; it cannot certify an
   independently supplied USDZ or the actual restaurant portion.
5. Store the measured bounding box in `model_dimensions_m`. On load, the viewer
   compares `getDimensions()` against that declaration (5% or 2mm tolerance).
   Missing/mismatched/implausible geometry disables AR while retaining 3D. Fixed
   AR scaling preserves baked geometry; neither setting proves portion accuracy.
6. Compare the model to the actual dish on physical phones before enabling it
   commercially. Models represent the base presentation; selected extras/removals
   are explained in the regular order form and do not alter the model.

Target 1–3MB GLB (prefer under 5MB), roughly 10–50k triangles or fewer, and 512–1024px
textures where sufficient; inspect on ordinary phones. Use modest materials,
embedded compressed textures and mesh compression only after testing decoding and
Quick Look conversion. The SDK may fetch its standard decoder files on demand for
Draco/KTX2 assets; self-host approved decoders if deployment policy requires it.
The sample uses ordinary embedded PNGs and needs no external decoder downloads.
Avoid large environment maps, animations and high texture counts. Use a small
poster and versioned immutable asset names.

## Genuine development sample

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
zoom with gestures, Page Up/Down or labelled buttons, reset and return to Photo.
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
3. Find a real flat table using the native/on-screen guide. Place the dish, walk
   around it and compare it to a real measured plate/portion. Check fixed scale,
   horizontal orientation, contact shadow and no floating/embedded geometry.
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

Official references: [model-viewer AR examples](https://modelviewer.dev/examples/augmentedreality/),
[public API documentation](https://modelviewer.dev/docs/),
[Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator).
