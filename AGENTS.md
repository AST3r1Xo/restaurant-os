# Restaurant OS contributor guidance

These instructions apply to the entire repository.

- Permanent product decision: Restaurant OS never processes online payments, collects card details, integrates gateways, or adds payment infrastructure/dependencies. Restaurant employees handle payment outside the app. Use Review Order, Place Order and Order Confirmed; totals are informational.
- Permanent privacy decision: Restaurant OS is a visit-based ordering platform, never a customer account/profile or consumption-history platform. Customer order access is temporary and limited to an active dining session. On closure, revoke receipts (including old URLs and idempotency recovery), tracking, bills, session/request rows and all history APIs in PostgreSQL/RLS. Historical records remain in place for authorized restaurant staff only. Anonymous Auth persistence never grants historical access.
- Build incrementally; prioritize the mobile customer experience. Do not add features outside the current task.
- Use Next.js App Router, strict TypeScript, and Tailwind CSS. Prefer Server Components; use small Client Components for interactions.
- Keep route files thin. Put domain-specific code in `src/features`, reusable UI in `src/components`, and infrastructure in `src/lib`.
- Keep demo fixtures explicit and separate from production queries. Never silently replace a failed database request with demo data.
- Scope every tenant-owned row and query to a restaurant. Preserve composite foreign keys and RLS policies in migrations.
- Never expose table QR tokens through public menu queries. Validate them on the server before establishing table context or submitting orders.
- Keep credentials out of Git and browser bundles. Public Supabase keys require RLS; privileged keys belong only in server-only modules.
- Verify staff identity and restaurant membership on the server before serving private data or performing mutations. Demo dashboard routes are fixtures, not authorization.
- Staff and guest Auth use separate HttpOnly cookie namespaces. Never persist Realtime access tokens or expose refresh/privileged tokens to browser code. Verify identity and ownership/membership before issuing a caller's short-lived in-memory Realtime token.
- Change order status only through the authorized transactional workflow with an expected-current status. Pending orders may be accepted or declined with a reason; served/cancelled orders are terminal. Preserve immutable order snapshots and audit records.
- Treat Realtime events as snapshot invalidations, never as trusted order contents. Scope subscriptions, preserve RLS, reconcile after reconnect, clean up channels, and keep explicit demo mode disconnected.
- Current orders contains only the verified guest’s active visit. Never add an All visits/customer archive or historical bill endpoint. Shared bills require staff acceptance of that guest’s first order in the active session. Share only that visit’s dish/customization/price/status snapshots and totals, never guest identities, private receipt IDs/references, notes, previous visits or broader order RLS. QR possession never grants participation.
- Attach new orders atomically to the active tenant/table session; preserve persistent idempotency uniqueness and legacy NULL session links. Return committed retries only while the original visit is active; closed/legacy replays reveal no receipt and never start another order. Bind reviews to the visit generation so stale uncommitted quotes cannot enter a new visit. Membership never transfers to the next session.
- Rotate the opaque table visit key atomically on session closure. Bind carts, persisted retries and server reviews to that generation; discard stale selections instead of carrying them into another visit. Recheck private screens before revealing cached payloads; hide them offline/on background and reconcile promptly. Server-side revocation is authoritative, independent of cookies/storage.
- Staff close only fulfilled sessions (served/cancelled orders) after acknowledging any bill request. Closure ends service; it never verifies payment. Bill requests deduplicate per session and use durable guest rate limits. Sum stored PostgreSQL order amounts across every page; separate pending/accepted values and exclude cancelled orders. Never label values paid, unpaid, amount due or revenue.
- Menu writes belong only to verified owners/managers and transactional manager RPCs; ordinary staff cannot edit. Keep IDs and historical order snapshots immutable, archive products, enforce draft/public/archived visibility again in trusted order pricing, and reject stale editor versions.
- Media must pass the server byte-validation gateway before entering public Storage. Keep the media service key server-only and limited in application code to media operations; never use it to bypass order/guest authorization. Deny direct API-role bucket writes, use immutable tenant/product/UUID paths, retain pending upload records for recovery, and block deletion while any product/branding reference remains. Configure buckets via supported Storage APIs.
- Keep pilot environments isolated and deployment mode explicit. Never deploy or alter production without authorization. QA provisioning requires a separately authorized administrative context and a project guard; never repurpose the media-only app key for restaurant/Auth/order metadata. Use ordinary staff/guest authorization for workflow checks, retain historical QA records and never reuse occupied tables. Report browser, API/WebSocket and physical-device evidence separately.
- Require documented model rights/provenance and human physical-scale review before customer 3D; AR also requires explicit opt-in and existing runtime checks. Keep private reviews outside public product data. Never treat uploaded or fixed-scale assets as automatically accurate.
- Calculate order prices and totals on the server, in one database transaction. Preserve order item snapshots. Never trust client-supplied prices.
- Use integer minor units for EUR/USD money; format only at presentation boundaries.
- Keep SQL changes in timestamped `supabase/migrations`. Regenerate database types after applying migrations; never alter deployed history.
- Load model-viewer only when needed. Use true-scale, optimized dish assets; never present unrelated models as dishes.
- 3D is optional: preserve ordering, visit context and product drafts independently. Load the viewer/runtime/models only on an explicit preview action. Use tenant/product-scoped public asset paths, self-contained licensed GLB, optional matching USDZ and measured metre dimensions. AR requires HTTPS, capability and matching geometry; fixed scaling alone never certifies portion size. Keep development ingredient studies explicitly labelled and out of live products. Never claim physical-phone AR verification from emulation.
- Preserve semantic HTML, keyboard navigation, visible focus, reduced motion, readable contrast, and 44px touch targets.
- Do not fetch fonts during builds. Keep image dimensions explicit and optimize local images with `next/image`.
- Run `npm run typecheck`, `npm run lint`, `npm run test:db`, and `npm run build` for foundation/schema changes. Add tests for meaningful behavior or security boundaries, not markup snapshots.
- Update README and architecture notes when behavior, configuration, or boundaries change.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
