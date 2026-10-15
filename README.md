# Restaurant OS · Mesa

A foundation for a premium, table-based restaurant ordering SaaS. Built with Next.js App Router, TypeScript, Tailwind CSS, Supabase, and Google model-viewer; intended for Vercel deployment.

## What is implemented

- Server-rendered live restaurant menus, categories, and products from Supabase.
- Public visibility filters plus RLS; explicit demo/live modes without fallback on errors.
- Secure QR resolution through a narrow database RPC returning one active table label.
- Server-validated table context across menu, bag, and order navigation; invalid/expired links preserve safe browsing.
- Dedicated product pages with photography, ingredients, allergens, quantities and validated customizations.
- Required/optional single/multiple modifier groups with per-unit price adjustments.
- A restaurant-isolated, persistent shopping bag with live counters, itemized totals, quantity controls, removal and cross-tab updates.
- Invisible guest sessions, fresh order reviews, atomic live order creation and private confirmation pages.
- Persisted idempotency keys, safe retries after uncertain responses, cross-tab submission coordination and purchased-only cart cleanup.
- Staff email/password sign-in, independent secure sessions, sign-out and verified restaurant switching.
- Authorized live kitchen queues, current-day overview, visual arrival notifications and transactional status management.
- RLS-protected Realtime events, reconnect reconciliation, automatic private customer progress and decline reasons.
- **Current orders**: private receipts, statuses and totals for this active dining visit only.
- **Table bill**: authorized current-visit shared dishes, customizations, quantities and prices, live bill requests and staff acknowledgement.
- Atomic table-session lifecycle, one active visit per table, immutable order links, staff session/history views and preserved legacy orders.
- Responsive interface, category filtering, image placeholders, empty/loading/error/404 states.
- Initial schema, staff memberships, composite tenant foreign keys, RLS, seed data, order publication, and database types generated from migrations.

The live staff workspace requires verified employee authentication and restaurant membership. It receives actual orders, manages the kitchen lifecycle and updates each owning customer automatically. Explicit demo mode shows clearly marked sample queues with disabled actions. Owners and managers can now maintain categories, dishes, modifiers, photographs, reviewed 3D assets and restaurant presentation at `/admin/menu` and `/admin/settings`. Table definition editing and employee invitations remain future increments. Optional 3D/AR is integrated into product details; table-session operations are live. Online payment processing is permanently excluded. A table QR identifies a table; it does not authorize customer identity or access to orders.

## Permanent decision: temporary customer access

Restaurant OS is a visit-based ordering platform. Customer order access is temporary and limited to the current active dining session. Historical records belong to the restaurant and are accessible only to authorized staff. Customers have no account/profile, personal archive, previous bills or consumption history. Anonymous Auth exists solely to enforce secure access during a visit; retaining its cookie never restores a closed visit.

When staff close a table session, PostgreSQL immediately revokes customer receipt, tracking, shared bill, session/request and former history access. Old confirmation URLs return 404, and closed-order idempotency retries reveal no receipt or create any new order. Historical orders/items/snapshots remain unchanged for authorized staff. The customer navigation is **Menu · Your bag · Current orders · Table bill**. There is no All visits option, including through the old `history=all` URL or history API.

Closure also rotates an opaque table visit key. Bags, durable submission attempts and server reviews are bound to that generation. Old selections/reviews cannot enter the next visit; scanning the QR again starts fresh. Private pages recheck server access before displaying a cached payload, conceal details offline/background/back-forward-cache, and reconcile on return. The server is authoritative; neither local-storage deletion nor cookie expiry controls revocation. Healthy guest views detect closure within five seconds; delayed/unverified private data is concealed after ten seconds. Already downloaded data or screenshots cannot be remotely erased. Staff must close sessions promptly after service; calendar midnight does not end a legitimate visit.

## Permanent decision: no online payments

Restaurant OS never processes online payments, collects card details, integrates payment gateways, authorizes/captures payments or introduces payment transactions, tracking or dependencies. Restaurant employees handle payment outside this application using their existing procedures. Order totals are informational. Customers review their selection and press **Place Order** without payment details. This decision applies to every future increment, including waiter/bill requests, staff operations and AR. Repository-wide instructions in `AGENTS.md` enforce it.

## Run locally

Use Node.js 24 LTS (see `.nvmrc`) and npm. The installed versions are pinned in `package.json`; commit the lockfile for reproducible installs.

```sh
nvm use
npm ci
# Only create this file if it does not already contain your configuration:
[ -f .env.local ] || cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000) for the demo table menu, or [localhost:3000/admin](http://localhost:3000/admin) for the staff preview. Mode selection is server-side and explicit:

- `APP_DATA_MODE=auto` (default): live when both public Supabase values are present; demo when both are absent.
- `APP_DATA_MODE=demo`: explicit fixture preview, even with public credentials configured.
- `APP_DATA_MODE=live`: require both public Supabase values; missing configuration is an error.

Partial configuration, privileged keys in public variables, and failed live queries never become fixture fallbacks. The customer header says **Demo menu** or **Live menu**. Root `/` opens the demo table in demo mode and `/r/mesa` in live mode.

The public app URL defaults to `http://localhost:3000` in the environment example. Use that origin when creating absolute QR URLs from the table paths below.

```sh
npm run typecheck
npm run lint
npm run test:db
npm run test:menu
npm run test:cart
npm run test:orders
npm run test:kitchen
npm run test:history
npm run test:sessions
npm run build
npm start
```

`typecheck` generates Next.js route types before checking TypeScript. `test:db` applies the actual migration and seed in PGlite (embedded PostgreSQL), with minimal Supabase Auth/role stubs. It verifies public visibility, private QR tokens, guest ownership, staff permissions, cross-tenant foreign keys, monetary constraints, order snapshots, and publication membership. It also verifies QR resolution, token rotation, deactivated tables, and repeatable seeds. `test:menu` exercises the real Supabase SDK with a controlled HTTP transport, checking tenant/visibility filters, RPC requests, errors, empty data, image sources, and mode selection. `test:cart` verifies integer calculations, required/single/multiple selection rules, distinct item merging, limits, current-catalog reconciliation, storage hydration, blocked storage and restaurant/mode/currency isolation. Native Node.js TypeScript execution for these tests requires Node.js 24 LTS or newer. The explicit live integration script verifies hosted anonymous Auth and order RPCs. Kitchen/guest Realtime delivery is checked separately through the hosted integration workflow.

Development and builds use Next.js's supported Webpack bundler because this workspace restricts the internal worker port needed by Turbopack's PostCSS pipeline. The application remains a standard Next.js project with the same Vercel deployment behavior.

Increment 3 validation passed TypeScript, ESLint, all 54 automated tests (27 database, 13 menu, 14 cart), the live public API verification and a production build. Isolated Chromium browser checks exercised live/demo additions, required and maximum selections, distinct customizations, quantity changes, refresh persistence, cross-tab synchronization, invalid QR navigation, removal, empty/corrupt/blocked storage, network failure, keyboard skip navigation and reduced motion. Product and bag pages were checked at widths 320, 375, 390, 430, 768 and 1440 pixels without horizontal overflow. This is browser emulation, not a physical iOS/Android certification. Temporary browser/formatting tools were used outside the project; no runtime dependencies were added.

## Organization

```text
src/
  app/
    (customer)/r/[restaurantSlug]/  Menu, products, bag, and review
    (history)/r/.../orders/        Current-visit orders with a separate loading boundary
    (confirmation)/r/.../          Private confirmations and table bill, outside public menu guard
    (staff)/admin/                 Protected kitchen, tables, menu administration and restaurant settings
    (staff-auth)/admin/login/      Dedicated employee login outside the protected layout
    layout.tsx                    Root metadata, globals, accessibility
  components/                     Shared presentation and navigation
  features/
    menu/                         Domain types, explicit fixtures, query boundary, UI
    products/                     Product details and customization form
    cart/                         Purchase intents, validation, persistence, provider and bag UI
    orders/                       Guest sessions, submission, retries, tracking, history and bill
    staff/                        Verified workspace, kitchen snapshots, transitions and operational UI
    sessions/                     Visit authorization, aggregates, bill requests and table operations
    realtime/                     Ephemeral caller tokens, coalesced snapshot reconciliation and subscriptions
    ar/components/                On-demand model-viewer integration boundary
  lib/
    supabase/                     Browser/server clients and session refresh
    env.ts                        Public configuration validation
    routes.ts                     Customer paths and public demo QR fixture
    format.ts                     Money presentation
  types/database.ts               Generated Supabase schema types
  proxy.ts                        Next.js session-refresh entry point
supabase/
  migrations/                     Versioned SQL schema and RLS
  seed.sql                        Local restaurant/menu/table fixtures
  config.toml                     Local Supabase settings
tests/database.test.mjs            PostgreSQL integrity, RLS, and QR checks
docs/architecture.md              Decisions, access boundaries, next increments
public/images/                    Local, optimized-at-runtime sample photography
AGENTS.md                         Repository-wide contributor guidance
```

See [architecture decisions](docs/architecture.md) for the domain model and security boundaries. Route files compose feature modules; reusable components remain separate from tenant data access. There is no separate backend, ORM, or global state library at this stage.

## Database setup

Before connecting live features, confirm that the development Supabase project
is reachable, its migrations are applied, and the local public credentials point
to that project. An MCP URL in editor configuration alone does not verify a
working authenticated connection. Store credentials only in the ignored
`.env.local`; never send privileged keys through chat or `NEXT_PUBLIC_*` variables.

Run the read-only public API check after configuring both environment variables:

```sh
npm run verify:supabase
# Optionally ensure the URL matches a specific project:
npm run verify:supabase -- --project-ref=YOUR_PROJECT_REF
```

This checks the published `mesa` restaurant, category/product access, hidden menu
visibility, and denied anonymous access to private tables. Use
[`supabase/verification.sql`](supabase/verification.sql) through the authenticated
database connection to inspect actual table columns, relationships, indexes,
RLS policies, grants, and Realtime publication before applying any migrations.
The check does not write data, apply migrations, or claim to verify Auth/Realtime.

The six core entities are `restaurants`, `dining_tables`, `menu_categories`, `products`, `orders`, and `order_items`. `product_modifier_groups` and `modifier_options` configure product choices. `restaurant_members` adds the necessary link to Supabase Auth staff identities. `dining_tables` avoids the ambiguous name `tables` in code and SQL.

For a local Supabase stack, install Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then:

```sh
supabase start
supabase db reset
```

`db reset` resets **the local development database** and reapplies migrations plus seeds; never use a reset against production data. Copy the local project URL and publishable key from the CLI output into `.env.local`. For remote Supabase:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Review the migration against the chosen remote project before pushing. Remote deployment does not automatically load the local seed. For a disposable demo project, the seed may be explicitly applied through its SQL editor. It creates no fake users or memberships. The seed is transactional and repeatable: conflicts are skipped without overwriting existing rows, prices, selections or table tokens. It also fills empty ingredient arrays for the three sample dishes and adds missing sample modifier definitions; populated ingredients remain unchanged. New table QR tokens come from `gen_random_uuid()`; fixed fixture tokens are used only in the browser demo mode.

Regenerate the committed database types from the versioned migrations without network credentials or Docker:

```sh
npm run db:types
```

This replays migrations in isolated PostgreSQL (PGlite) and introspects columns, defaults, generated values, relationships, enums, and RPC signatures. It uses a minimal Auth schema stub and never connects to or changes the development database. The remote schema must stay synchronized with migrations. Supabase CLI can also regenerate directly from the remote schema:

```sh
supabase gen types typescript --project-id YOUR_PROJECT_REF --schema public > src/types/database.ts
```

Published restaurants and their available menu items are publicly readable. Table tokens, memberships, and orders are restricted. Owner/manager memberships permit menu/table management; staff can read their restaurant's queue and update order status. Guests use invisible anonymous Auth identities to read only their own orders. Direct order inserts and price/item edits are denied. Only the narrow atomic order function may create records, deriving ownership and prices from verified identity and trusted menu rows. Anonymous guest identities cannot become staff through a membership alone.

## Testing live menus and QR links

1. Configure the two public Supabase values in the ignored `.env.local`, apply all repository migrations, and load the development seed explicitly. Run `npm run verify:supabase`.
2. Start `npm run dev` and open `/r/mesa`. The header must say **Live menu** and the dishes/prices must come from the database. Published restaurants with no active dishes show an empty state; unknown/unpublished slugs return 404.
3. Retrieve **one intended table link** through the authenticated SQL editor (never expose this table query to anonymous clients):

```sql
select t.label,
  'http://localhost:3000/r/' || r.slug || '?table=' || t.qr_token as qr_url
from public.dining_tables t
join public.restaurants r on r.id = t.restaurant_id
where r.slug = 'mesa' and t.label = 'Table 04';
```

4. Open that URL. The header must show **Table 04**. Bag/order links preserve only the validated token and revalidate it on each request.
5. Test `/r/mesa?table=invalid`, duplicated `table` parameters, and a table token belonging to another restaurant. These must show a rescan notice, no table label, and browsing links without the invalid token.
6. Deactivate a chosen development table or rotate its token through authenticated admin tooling, then reopen its old link. The old token must no longer resolve. A valid link identifies the intended table; it does not grant private order access. Live submission additionally requires a verified anonymous guest and a current accepted review.

The public `resolve_table` RPC is a security-invoker wrapper around a private security-definer function with an empty search path. It checks restaurant publication, the exact token, tenant ownership, and table activity. It returns only `table_label`, never a table row, ID, or collection of tokens. The Next.js server invokes it with a stateless public client; no service-role credential is needed. Query errors show an error state, while a successful lookup with no row shows an invalid-QR state.

Menu images accept local `/images/*` assets, the configured project's public Supabase Storage URLs, and Unsplash HTTPS URLs. Unsupported/missing/failed assets use a visible placeholder. Private storage and arbitrary internal image origins are excluded.

## Verified development setup

Project reference: `ahkleoidhzcsubsdlqbn`. The development database was initially empty. The initial schema and QR resolver migrations were applied through the authenticated Supabase SQL editor, with migration versions recorded in `supabase_migrations.schema_migrations`. The repeatable demo seed was applied without resetting data. Public API checks confirmed the live menu and denied direct anonymous reads of operational tables.

The Supabase MCP connection is now operational. Increment 3 applied `20261014172121_product_modifiers.sql` through MCP, using the exact version recorded remotely, and loaded the repeatable seed. The database has nine public tables with RLS, six sample modifier groups and fourteen options. Increment 3 created no orders; Increment 4 live tests created the real development records described below. Initial setup used the authenticated project dashboard. Credentials remain in ignored local environment files; the environment example contains no keys.

Read-only catalog comparisons matched the repository's columns/defaults/RLS, indexes, policies, foreign keys, unique keys, and checks. The PostgreSQL versions differ in catalog representation of NOT NULL constraints; comparison checks nullability through column metadata and excludes duplicate `contype = 'n'` catalog entries from constraint hashes.

## Testing product details and the shopping bag

With the existing live configuration, run `npm run dev` and open `/r/mesa`, preferably using the validated Table 04 URL described above.

1. Tap any dish card to open its dedicated page. The restaurant and validated table remain in navigation. Missing, unavailable, foreign-restaurant or unpublished products cannot open a purchasable detail page.
2. Expand allergen information. Ingredients and listed allergens come from Supabase; an empty allergen list is not an allergen-free claim. Options may introduce allergens, so ask the restaurant team when needed.
3. Try **Add to your bag** without the required choice. The form explains what is missing. Select the bread/sauce/dressing, choose extras and change quantity. The button updates its price immediately.
4. For eggs, select brioche + avocado and quantity 2: `(1400 + 250) × 2 = 3300`, displayed as €33.00. Add it, then open **View your bag**.
5. Adjust quantity, remove a line, and refresh. The selection persists on this browser/device without signup. Add the same dish with different choices to create a distinct line; identical selections merge up to quantity 99.
6. Navigate back to the menu to see the floating bag link and live navigation counter. Test a second tab: changes synchronize through browser storage events.
7. The bag shows base prices, per-unit modifiers, line totals, subtotal and total. **Review Order** opens the final review. Live mode permits real submission with a validated QR and guest session; demo mode disables submission. Restaurant employees always handle payment.
8. Change availability or modifier definitions through the owner/manager menu editor, then refresh the bag. Invalid lines remain visible with a review/remove notice and are excluded from totals. Current menu prices are re-derived. A live query failure shows an error, never a fixture menu.
9. Restart with `APP_DATA_MODE=demo npm run dev` to test explicit demo mode. Demo/live bags are separate, as are different restaurant IDs. Browser storage disabled/full shows a persistence notice while retaining the in-memory bag on the current page.

Cart storage contains a version, restaurant ID, mode, currency, product IDs, option IDs and quantities. It stores no prices, QR tokens, customer identity or order data. Table context is carried only in server-validated URLs and revalidated on every navigation. Removing/changing the QR never authenticates a customer or grants order access. Clearing browser storage clears the bag; it is not synchronized between devices.

Every addition performs a fresh, read-only server check of the public product and modifier definitions. Changed definitions/prices require review before addition; network errors do not add the item. This is a shopping validation boundary. Browser storage is editable; the order transaction independently validates all product/option IDs, quantities and current prices. The browser never submits authoritative prices, totals, ownership or status.

Configure choices in `/admin/menu` → a dish → **Customizations**. Trusted seed data can also be maintained through versioned migrations:

- `products.ingredients`: ingredient names as a text array; `allergens` already exists.
- `product_modifier_groups`: same `restaurant_id` and `product_id`; `selection_type` is `single` or `multiple`; `min_selections > 0` makes the group required; `max_selections` is 1 for single-choice, up to 20 for multiple-choice. Use `is_active` and `sort_order` for visibility and order.
- `modifier_options`: same restaurant and `group_id`, display name, nonnegative `price_adjustment_minor`, availability and sort order. Zero means included; 250 means +€2.50 per unit. Removal preferences can be zero-price options. Ensure active required groups have enough available options; otherwise additions are blocked.

Composite foreign keys prevent linking a group or option across tenants. Public RLS follows published/available products and active categories/groups; only owners/managers can modify their restaurant's definitions. Product/QR/private-order access policies remain unchanged.

## Secure order review and submission

Live mode now follows **Bag → Review Order → Place Order → Order Confirmed**. The review displays the restaurant, validated table, dishes, quantities, selected options, supplements and current total. Payment is handled directly by restaurant staff; no payment input or gateway exists. Demo mode demonstrates the same review interface with real submission disabled and no fabricated successful orders.

The first live review transparently creates a Supabase anonymous identity if one is missing. No email, phone, password, registration screen or installation is needed. Existing anonymous sessions are verified with `getUser()` and reused. Guest sessions use a separate HttpOnly cookie namespace, SameSite=Lax, Secure in production and a 30-day browser cookie; the SSR proxy refreshes them. Staff/browser Auth uses its existing independent namespace. Public menus remain stateless public reads. A lost/invalid guest cannot read old orders merely by scanning the same table QR. Pending submission/recovery never silently signs in as a replacement guest.

The database review function validates the published restaurant, `is_accepting_orders`, active tenant-bound QR, available products/categories, quantities and active/available modifier membership/cardinality. It stores a random opaque, guest-bound review ID with a ten-minute expiry and a trusted snapshot in `private.order_reviews`. Direct access to this private table is denied. Changed prices/names require explicit review; if prices or availability change again before creation, the transaction rejects the stale review instead of silently confirming a new total.

`create_guest_order` performs all validations again, locks the relevant catalog rows, derives guest ownership from `auth.uid()` and the verified anonymous claim, calculates integer minor-unit prices, compares the accepted review, inserts the pending order and all item snapshots in one transaction, then returns the confirmed server snapshot. Any error rolls back the entire transaction. Items preserve product names, base/unit prices, quantities, generated line totals and selected modifier ID/group/name/price snapshots. Orders preserve restaurant/table labels, currency, totals, guest ownership, status, idempotency key and request fingerprint. Later catalog changes never rewrite those snapshots.

Only minimal purchase intents, the restaurant slug, original table token, review ID and idempotency key reach the submission boundary. Unknown fields—including client prices, totals, customer/table IDs and status—are rejected. Owner-only `get_guest_order` verifies guest identity independently of QR context. Confirmation GETs perform no order mutation and use private/no-store dynamic responses. Confirmations remain readable by their owner if the restaurant later unpublishes its menu.

The browser persists the exact pending request **before** sending it and serializes competing tabs with Web Locks. Unique `(customer_id, restaurant_id, idempotency_key)` and transaction-level guest locks enforce persistent database idempotency. Equivalent retries return the original order only while its visit is active; closed/legacy retries reveal no receipt and create no new order. Different contents/QR with the same key are rejected. Recovery reads the original key before retrying. A lost network response preserves the bag and key; refresh can recover an already committed result. Confirmed cleanup subtracts only purchased quantities from the latest restaurant bag and records a cleanup receipt in the same storage write, preserving later additions and preventing refresh from subtracting twice. Submission storage contains the frozen review and intended QR; neither is a customer authentication credential. Auth tokens are never stored there.

Abuse controls are durable database limits: at most 20 successful reviews/minute/guest, 5 new orders/5 minutes/guest across restaurants, and 40 new orders/5 minutes/table across guests. Safe idempotent replays do not consume a new-order slot. Orders allow 1–50 distinct customized lines, quantity 1–99 per line, at most 500 units and 50 option IDs per line, with a 64 KiB request limit. Next.js and explicit Origin/Host checks protect cookie-backed actions. Direct client writes remain denied; definer functions have empty search paths and only authenticated callers may execute the order RPCs. No service-role application credential is required.

### Development configuration

1. Configure the existing public Supabase URL/key in ignored local environment files.
2. Apply all repository migrations. In the authenticated Supabase dashboard, enable **Authentication → Sign In / Providers → Allow anonymous sign-ins → Save changes**. Local `supabase/config.toml` also enables anonymous sign-ins.
3. Set the intended development restaurant's `is_accepting_orders=true` using trusted administration. This flag defaults to false for safe rollout; seeds enable it only when inserting a new sample restaurant and never overwrite an existing paused restaurant.
4. In project `ahkleoidhzcsubsdlqbn`, anonymous sign-in was enabled with explicit user approval and Casa Mesa was explicitly enabled for ordering. No reset, row deletion or unrelated restaurant modification occurred.

Applied Increment 4 migrations:

- `20261014181241_guest_orders.sql`: ordering flag, order/idempotency/label/base-price fields, private reviews, input normalization, trusted snapshot builder and review/create/get RPCs.
- `20261014182427_order_rate_index.sql`: recent table-order index for bounded throttling reads.
- `20261014182546_order_access_hardening.sql`: anonymous identities cannot acquire staff permissions through memberships; revokes unnecessary public execution of an optional Supabase Studio event-trigger helper.

Types are generated from the versioned migrations: nine public tables and seven application RPCs, including the existing QR resolver and operational functions. Supabase's platform-generated event-trigger helper is outside the app API model. Advisors flag authenticated definer RPCs and policy-free private tables: these are narrow, caller-validated functions and default-deny internal tables. See [Supabase database advisors](https://supabase.com/docs/guides/database/database-advisors). Staff management access is guarded by permanent identity plus membership; guests may read their own order snapshots. Review the production password policy and leaked-password protection before commercial staff rollout.

### Local end-to-end test

Run `npm run dev`, then open:

```text
http://localhost:3000/r/mesa?table=67006a2d-d1c1-4ba2-918f-fb8e4ffb1b5c
```

1. Start with an empty bag. Add smoked salmon eggs, choose brioche + avocado and quantity 2. The expected total is €33.00.
2. Open **Your bag → Review Order**. A guest session is established invisibly; wait for the current menu check. Confirm Casa Mesa and Table 04, then press **Place Order**.
3. The private confirmation URL is `/r/mesa/orders/<confirmed-order-uuid>?table=<validated-token>`. It displays the actual reference, pending restaurant acceptance, confirmed selections and €33.00 total. There is no payment interaction.
4. Refresh the confirmation: it reads the same order and does not create another. The purchased bag quantities stay cleared. Add another dish in a second tab while a request is pending; that later addition must remain after confirmation.
5. Open the confirmation URL in a fresh browser/incognito session with the same QR. It must show the private-order unavailable state; the QR cannot restore ownership. Use the original browser for the confirmed snapshot.
6. `/r/mesa/review?table=invalid` or missing table context permits browsing/bag preservation but blocks new submission. Pausing ordering blocks new orders without removing selections.
7. Try `APP_DATA_MODE=demo npm run dev` after stopping the live server. Demo review is functional, **Place Order · Demo preview** is disabled, and no order is created.

Use localhost for local browser tests. Physical phones and deployed production require HTTPS for Secure cookies and Web Locks. Browsers must support Web Locks and local storage for safe submission; unsupported/blocked environments show an actionable message rather than risking lost retry references.

The explicit live integration check creates **one real order with two customized lines and two anonymous users per run**, so run it only against the intended development project:

```sh
ORDER_TEST_TABLE_TOKEN=67006a2d-d1c1-4ba2-918f-fb8e4ffb1b5c node scripts/verify-orders-live.mjs
```

It exercises genuine concurrent requests, trusted totals/snapshots, original-key recovery, conflict rejection, private ownership and denied direct inserts. It does not delete data or change the catalog/table. `npm run verify:supabase` remains read-only.

### Verified live results and limits

The hosted API concurrency check created reference **45ED6FDE66**, ID `708fddc1-3af4-453f-a8f7-0bd489ef3909`: Table 04, pending, two customized lines/three units, €56.50. Three concurrent identical HTTP submissions returned this one order. A second anonymous guest was denied RPC and RLS access; forged prices/ownership, invalid selections/QRs, direct writes and conflicting keys were rejected.

Production-browser testing created reference **BB909F0A76**, ID `fd7b90e7-45e2-460d-8477-356f92ce231b`: Table 04, pending, two eggs with avocado, €33.00. The test deliberately discarded the response after database commit. The bag and original key remained; refreshing recovered the same order without another submit. A later added unit survived purchased-only cleanup and confirmation refresh. HttpOnly/Secure/SameSite cookie flags and denial from a fresh browser with the same QR were verified. Authenticated server-side SQL independently confirmed both real records, item totals, anonymous guest association and tenant/table relationships. Test orders and test guest identities remain in the development database; none were deleted.

Increment 4 final validation passed `npm run typecheck`, `npm run lint`, `npm run test:db`, `npm run test:menu`, `npm run test:cart`, `npm run test:orders`, `npm run verify:supabase -- --project-ref=ahkleoidhzcsubsdlqbn` and `npm run build`. All **111 automated tests** passed: 56 database, 13 menu, 17 cart and 25 order/server/persistence tests. The database suite covers invalid inputs, tenant/guest isolation, changed prices and modifiers, snapshots, rollback, duplicate/conflicting requests, execution grants and rate limits. PGlite uses one connection, so real concurrency was verified separately against hosted PostgreSQL. Review and confirmation screens were exercised at mobile sizes; confirmation was checked at widths 320, 375, 390, 430, 768 and 1440 pixels without overflow or browser errors. This is browser emulation, not physical-device certification.

Supabase Auth signup limits apply in addition to database order limits. Server-side anonymous sign-in uses the server egress IP with a publishable key; review the configured signup capacity before commercial rollout. See [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits). No privileged IP-forwarding credential or new service-role access was introduced. Expired review rows and inactive anonymous accounts need an explicit future retention policy; no cleanup job deletes them in this increment. Live tracking, staff operations and optional product 3D/AR are described below. Online payment processing is permanently excluded.

## Live kitchen and customer progress

Live `/admin`, `/admin/orders`, `/admin/menu` and `/admin/tables` verify an employee with Supabase `getUser()` and current `restaurant_members` membership before reading operational data. `/admin/login` is a separate public authentication route. Owners, managers and staff all operate the kitchen; users cannot provision their own memberships. A restaurant selector appears for multiple memberships. Its HttpOnly selection cookie is an untrusted preference: membership is verified again on every query, token request and mutation, and stale tabs cannot mutate a different active workspace.

Staff sessions have their own HttpOnly, SameSite=Lax, production-Secure cookie namespace, independent of the guest namespace. All sign-in, refresh and sign-out operations run through SSR. Staff sign-out clears only staff cookies. No application service-role key, invitation system or public signup UI is used. Supabase Auth applies its own login throttles. Expired/revoked access shows a sign-in or access notice rather than operational fixtures.

The kitchen initially fetches an authorized database snapshot. It groups pending, accepted/preparing, ready and today's served/cancelled orders. Active queues sort oldest first; completed sorts most recently changed first. Cards show table/reference, placement time, elapsed waiting time, immutable items/modifiers, existing notes if present, informational total, status and touch-friendly actions. New pending arrivals produce a visible notification and highlight. Overview metrics count pending, accepted/preparing, ready, completed today and received today using the restaurant's IANA timezone and DST-aware calendar-day boundaries. No total is described as payment or verified revenue.

`20261014191742_kitchen_operations.sql` revokes direct status-column updates and removes the direct update policy. `transition_order` verifies a non-anonymous authenticated caller and membership, locks the target tenant/order, checks the expected current state, enforces the transition graph and records timestamps plus an append-only private audit event containing the staff actor. The update and audit are one transaction. Only **pending → accepted → preparing → ready → served** and **pending → cancelled** are allowed. Declining requires a 2–300 character reason shown to the customer; served/cancelled are terminal. Cancellation after acceptance is deliberately unavailable in this increment. Financial, ownership and item fields cannot be edited through the function. Competing actions return a conflict and refetch the correct state. `20261014193453_order_operation_timestamps.sql` uses an order-specific clock-time update trigger and stamps operational timestamps after acquiring the row lock, preventing transaction-start timestamps from regressing under concurrent requests.

`get_kitchen_snapshot` returns bounded safe operational DTOs, tenant-specific metrics and snapshots. `get_guest_order_progress` returns only the authenticated guest's own order status and cancellation reason. These functions have fixed empty search paths, authenticated-only execution and explicit caller checks. `private.order_status_events` is RLS-enabled with no direct caller grants; it is an internal audit table, not a customer API. Existing tenant foreign keys and order ownership RLS remain intact.

Both live interfaces subscribe to INSERT/UPDATE changes on the already-published `orders` table. Staff filters use the verified active restaurant; guests filter one owned order ID. Supabase still applies RLS. A server action verifies identity plus membership/ownership before returning only that caller's short-lived access JWT. The transport copy stays in memory and is never persisted by browser code or logged; the underlying Auth session remains in HttpOnly cookies. The isolated browser SDK has Auth persistence disabled and cannot overwrite staff or guest sessions. Its current `accessToken` callback refreshes the transport token. See [Supabase setAuth](https://supabase.com/docs/reference/javascript/setauth) and [Postgres Changes/RLS](https://supabase.com/docs/guides/realtime/postgres-changes).

Events are invalidation hints: the interface refetches authoritative server snapshots rather than rendering raw events. Bursts coalesce; an event arriving during a fetch schedules another reconciliation. Duplicate records are removed and older snapshots cannot regress newer states. Subscriptions use `postgres_changes_options.wait=true`, so **Live connection** means PostgreSQL change delivery is ready rather than merely a joined WebSocket. SUBSCRIBED/reconnect and browser online/foreground events recover missed changes. Staff have a visible-page 30-second safety check and retain last confirmed data with an interruption notice; authorization loss hides the kitchen data. Guests revalidate every five seconds and conceal unverified private details, including offline/background transitions. Channels, timers and listeners are cleaned up on unmount or restaurant changes. Demo mode creates no Auth/Realtime connection and no successful simulated mutations. Audio/push notifications are not implemented.

Guest confirmation pages now track pending, accepted, preparing, ready, served and cancelled automatically. Refresh remains a private read. Scanning the same table QR still cannot reveal another guest's order. A cancellation changes the screen clearly and displays the persisted reason. The Orders navigation links to the latest local confirmation or unresolved submission; a complete searchable order history is not implemented.

### Provision the first staff account

1. In the intended development Supabase dashboard, choose **Authentication → Users → Add user**. Create an email/password user and confirm its email through trusted administration. Keep its password private; do not commit credentials. The app intentionally offers no employee signup or self-assignment.
2. Copy that user's UUID and run this through authenticated Supabase administration, replacing the placeholder:

```sql
insert into public.restaurant_members(restaurant_id,user_id,role)
select r.id,u.id,'owner'::public.staff_role
from public.restaurants r join auth.users u on u.id='YOUR_CONFIRMED_USER_UUID'
where r.slug='mesa' and u.is_anonymous=false and u.email_confirmed_at is not null
on conflict (restaurant_id,user_id) do nothing;
```

3. Open `http://localhost:3000/admin/login` and sign in. Membership roles are `owner`, `manager` and `staff`; assign additional memberships only through trusted administration.
4. Development account `1c20763c-e2ad-4343-8e59-c54a620ebf83` was verified as confirmed/non-anonymous and assigned Casa Mesa owner access with the user's authorization. Its credentials remain in ignored local configuration, never in the repository.

### Test the complete operation locally

1. Run `npm run dev` in live mode. Open `http://localhost:3000/admin/orders` and sign in before placing an order. Wait for **Live connection**.
2. In a second browser/device, open `http://localhost:3000/r/mesa?table=67006a2d-d1c1-4ba2-918f-fb8e4ffb1b5c`, customize a dish and use **Review Order → Place Order**. This creates a real development order.
3. The pending card and notification should appear automatically. Press **Accept order**, open **In preparation**, then **Start preparation → Mark ready**. Open **Ready → Mark served**. The customer page updates after every change; the final order moves to **Completed**.
4. Refresh both interfaces. The served state must remain. Test disconnect/reconnect: the connection notice appears and the latest state recovers automatically.
5. To test cancellation, place a separate development order, press **Decline**, enter a reason and **Confirm decline**. The customer sees cancellation and that reason.
6. Test a fresh browser with the same QR and copied private confirmation URL: it must be denied. A staff account without membership is denied restaurant access; guests cannot use staff actions.
7. For the fixture preview, stop the live server and run `APP_DATA_MODE=demo npm run dev`. Sample queues are clearly labelled, operational buttons disabled and no live events/orders created. HTTPS is required on physical devices in production.

The explicit hosted verification script reads `STAFF_TEST_EMAIL` and `STAFF_TEST_PASSWORD` from ignored local environment configuration. Apply the optional development-only `supabase/kitchen-verification-seed.sql` through trusted administration, retrieve its one intended QA table token, then run:

```sh
ORDER_TEST_TABLE_TOKEN=YOUR_MESA_TABLE_TOKEN ORDER_ISOLATION_TABLE_TOKEN=YOUR_QA_TABLE_TOKEN node scripts/verify-kitchen-live.mjs
```

This intentionally creates **three real orders**: two Casa Mesa orders (served/cancelled) and one isolated-tenant order. It signs in two staff clients and three anonymous guests, verifies actual WebSocket delivery, concurrent status conflicts, ownership/tenant event isolation and denied direct writes. It edits no pre-existing orders/catalog and deletes no data. QA rows and audit records remain for inspection. Normal automated tests use isolated PostgreSQL and controlled transports instead.

Increment 5 automated validation passed TypeScript, ESLint, all **169 tests** (101 PostgreSQL, 13 menu, 17 cart, 25 submission/server, 13 kitchen/reconciliation), the production build and the read-only hosted public API check. Isolated Chromium checks verified every live admin route redirects unauthenticated users, failed-login feedback, keyboard navigation, demo sections/empty states/disabled actions, no Supabase demo subscriptions and layouts at widths 320, 390, 768, 1024, 1280 and 1440 pixels. All eight migration versions match remote history; server-side catalog checks confirm RLS and denied direct status/total updates.

**Actual hosted Realtime and browser verification passed.** The active development staff account is `1c20763c-e2ad-4343-8e59-c54a620ebf83`; its email was aligned in ignored local configuration and real sign-in verified. The API workflow delivered INSERT and status updates to two staff clients and the owning guest. Concurrent acceptance had one winner and one conflict. Other-restaurant queries/mutations and events were denied even for an intentionally broad staff subscription; a second guest received no private order events. Direct status writes were rejected. Restarting a staff socket and refetching recovered persisted completion.

The production browser workflow created order **45AC694AFB** (`03460fa0-a9a4-453f-9775-f4c51d881f06`), €16.50: it appeared in the open kitchen without a refresh, progressed through acceptance/preparation/ready/served, updated the owning customer automatically, recovered after an offline interruption, moved to Completed and remained served after both pages refreshed. Browser WebSocket frames were observed, layouts checked from 320 to 1440 pixels, and a fresh browser with the same QR was denied the private page. One browser simultaneously held separate guest/staff sessions; staff sign-out preserved guest ownership. A further browser test discarded a successful staff update response after commit, recovered the actual status without repeating the transition, and verified live cancellation, the customer-visible reason, refresh persistence and terminal actions.

Six real Increment 5 test orders remain, with no reset or deletion: diagnostic **A87CEE0112** (served), API **1A3394ABED** (served), API **CBDCD07C32** (cancelled), isolated-tenant **CDC653603E** (pending), browser **45AC694AFB** (served) and browser **237E85BAA4** (cancelled). The diagnostic order originated during the first readiness check and was subsequently completed through the actual staff workflow. Existing customer orders were not changed. Authenticated SQL independently verified guest/table/tenant associations, immutable item totals and staff-attributed audit events. The optional QA tenant fixture and test guest identities also remain. Mobile checks use browser emulation; physical-device certification and deployment remain separate.

The MVP returns the oldest 300 active and latest 100 completed orders today and explicitly reports truncation. Larger queues need pagination before commercial rollout. Historical audit browsing, cancellation after acceptance, employee invitations/password recovery UI, full guest order history, menu/table CRUD, sound/push notifications and physical-device certification remain outside this increment. Existing Auth signup capacity and review/account retention considerations still apply. Online payments are permanently excluded.

## Product 3D and optional AR

Product details now offer **View in 3D** only when that product has a safe configured GLB. The photo switches to an interactive, softly lit viewer with horizontal/vertical rotation, zoom, reset, loading progress, slow/error/retry states and photo return. The runtime and model download start only on that action. Customizations, quantity, restaurant/table context and the bag remain independent. A temporary, visit-scoped product draft also survives a reload after returning from a native viewer; it contains no Auth or private order data.

On a supported **HTTPS** phone, a model whose measured geometry matches its declared dimensions offers **View on my table**. The existing model-viewer runtime selects WebXR, Android Scene Viewer or iOS Quick Look. GLB is required; USDZ is optional because Quick Look can export the static GLB on demand. AR uses fixed scale and horizontal placement, is launched only by a customer click and never submits an order. Unsupported devices, missing/mismatched dimensions and HTTP development origins keep the interactive 3D/photo ordering experience. Native camera/surface-placement behaviour requires physical-device verification; no fake camera is provided.

The explicit demo attaches Microsoft's **CC0 avocado ingredient study** to the salmon-eggs page. It is clearly labelled **not this dish or a portion preview**. The actual model is 6.767 × 4.391 × 10.000 cm (width × height × depth), baked horizontal with its cut side up and bottom at Y=0. It has 682 triangles and 512px embedded textures; optimization reduces the original 8,110,040 bytes to **628,136 bytes**. Attribution, modifications, source/hash and geometry report are in `docs/assets`. No unrelated model is attached to live dishes. A licensed, faithful scan of Casa Mesa's plated salmon eggs (or another selected dish), measured against the physical plate/portion, is still required for its live preview.

See [3D asset configuration and phone testing](docs/3d-assets.md) for the manager upload workflow, GLB/USDZ/poster paths, dimensions, licensing, mobile budgets, HTTPS and validation. `20261015140000_product_visualization.sql` reuses the existing GLB/USDZ columns and adds nullable `model_poster_url` and constrained `[width,height,depth]` metre dimensions. It is applied to development Supabase and its stored hash matches the repository. Existing product/order/session records, Auth and RLS are unchanged; no live sample model was assigned.

To test locally, run `APP_DATA_MODE=demo npm run dev -- --port 3001` and open [the demo dish](http://localhost:3001/r/mesa/products/eggs?table=22222222-2222-4222-8222-222222222222). Select bread, extras and quantity, open 3D, rotate/zoom/reset, return to the photo and add to the bag. Reload to verify draft/bag persistence. Demo order submission remains disabled. The existing live application stays at port 3000, with no 3D button until a real product asset is configured.

Validation: TypeScript, ESLint, production build and **241 automated tests** pass (139 PostgreSQL plus 102 application tests, including 15 new 3D/draft tests). Actual production browser rendering, keyboard rotation/zoom controls, 320px and 390px mobile layouts, lazy GLB download and full-reload selection recovery were verified. A genuine missing-model failure preserved selections; restoring the file and Retry recovered the model after fixing the SDK's rejected-load cache behaviour. The hosted public API verification passes with the new metadata fields. Phone AR and approximate real-world placement/scale have **not** been certified on physical iPhone/Android hardware. Production bundle measurements are recorded in `docs/assets/ar-bundle-report.json`; they are byte estimates, not Lighthouse/field-performance scores. Normal menu browsing downloads no model or 3D runtime.

## Vercel

Import this repository as a Next.js project, select Node.js 24, and use the default `npm run build` configuration. Set the public Supabase variables when connecting live features; set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin. Add the production origin and required Auth callback URL in Supabase when sign-in is implemented. Apply database migrations separately; a Vercel build does not migrate Supabase. No deployment has been created in this increment.

## Dependency audit

The installed production dependency graph reports zero vulnerabilities with `npm audit --omit=dev`. The full audit reports five high findings from one development-only `braces` advisory propagated through `micromatch`, `fast-glob`, and Next.js lint tooling ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The installed latest `braces` is `3.0.3`; no compatible patched release is available at setup time. Do not run `npm audit fix --force`: its suggested Next.js lint downgrade would mismatch the app. Recheck when upgrading lint tooling. TypeScript and ESLint are pinned to versions compatible with the current Next.js lint dependency peers.

## Next customer increments

1. Restaurant-specific licensed dish scans and physical iPhone/Android AR certification.
2. Menu/table definition administration, explicit participant revocation and operational hardening.
3. Future waiter-assistance request types, without online payment processing.

## References and assets

Implementation follows [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Tailwind's Next.js setup](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), and [Supabase RLS guidance](https://supabase.com/docs/guides/database/secure-data).

Sample photography is downloaded from Unsplash for a reproducible local preview; URLs and licensing context are in [image credits](public/images/CREDITS.md). Restaurant identity, dishes, prices, and table identifiers are fictional demo content. The repository's existing MIT license is preserved.

## Current customer orders

Open `/r/mesa/orders?table=<valid-table-token>` using the same guest browser that placed the order. Expand receipts to see saved products, quantities, customizations and prices. Additional orders during this active visit appear automatically. Current totals come from PostgreSQL, with accepted and pending values separated and cancelled orders excluded. The screen never shows a prior visit. Staff closing the visit revokes access even if anonymous cookies, order UUIDs or retry keys are retained.

`npm run test:history` and `npm run test:db` cover current-visit pagination, status totals, stored snapshots, tenant/guest ownership, malformed identity and the previous history endpoint’s active-only compatibility behavior. Historical restaurant records are inspected through `/admin/tables`, not customer routes.

## Increment 6 — Table sessions, shared bills and bill requests

The customer navigation now separates **Current orders** (own receipts for this active visit only) from **Table bill** (this session’s shared dishes, customizations, quantities and recorded prices). Staff use **Tables** to start/inspect visits, receive and acknowledge bill requests, review itemized orders from every diner, close completed visits and browse historical sessions. Notifications also appear in the kitchen and every other authenticated staff workspace.

### Session lifecycle and participation

A new real order joins the active session of its validated restaurant/table or atomically starts one. Staff may also start an empty visit. PostgreSQL enforces one active session per table; composite keys bind every attached order to the same tenant/table. Existing orders remain `session_id=NULL` and are never backfilled or attached to a later visit. Committed requests keep their original order/session permanently. Guests can recover those receipts only while the original visit is active; closure never moves a replay to a new visit.

A successful first order records pending participation. **Staff accepting that guest’s first order authorizes shared bill access for that session.** No extra invitation step is required. Pending/declined guests and authenticated outsiders cannot read shared amounts or request the bill. Shared guest responses contain dish/customization snapshots, quantities, unit/line prices, preparation states, counts, totals and request status. They never contain another guest’s identity, private receipt IDs/references or notes. Identical dishes are combined only when saved customization, price and status match. Different customizations remain separate. Order/item guest RLS requires an active own visit; staff history remains authorized by restaurant membership. Losing the guest session does not recover history or participation through a shared QR.

Staff close only the specific expected session, once every linked order is served/cancelled and any bill request is acknowledged. Closing preserves history, resolves its request, disables current shared totals and does not verify payment. Starting another visit creates a new session with an empty bill and no inherited participants. Reviews capture the active visit and closed-visit generation; stale uncommitted reviews fail with an explicit refresh message instead of moving purchases to a new group. Stale visit selections are discarded; the next visit requires a fresh bag.

### Bill rules and assistance

All values come from PostgreSQL `orders.total_minor`, scoped to the exact session:

- Accepted/preparing/ready/served form the accepted value.
- Pending acceptance is separate.
- Total recorded order value includes accepted plus pending; cancelled orders are excluded.
- Orders and amounts from earlier visits or legacy unassigned records never enter the shared total.
- Session currency is a historical snapshot; integer/safe-range validation prevents corrupted totals.

**Request the Bill** creates one persistent request per visit. Concurrent diners, repeated clicks and retries return the same record. Accepted participants may make up to three new bill requests per ten minutes across sessions; existing-request replays do not consume a slot. Staff acknowledgement is atomic and idempotent, with an attributed private audit event. Both guests see the acknowledgement automatically. The interface always asks staff to confirm the final bill and describes recorded values, never a verified outstanding balance. All payment happens outside Restaurant OS.

### Migrations and security

These session migrations are applied to the development project and match its recorded versions:

- `20261015095930_table_sessions.sql`: session and request tables, private participants/audit events, active-session uniqueness, tenant/table foreign keys, order-link guards, transactional order wrapper, authorization on acceptance, staff/guest RPCs, RLS and Realtime publication.
- `20261015100517_staff_session_reads.sql`: a read-only staff membership guard for stable PostgREST reads. Mutation authorization retains its locking guard.
- `20261015102036_review_session_binding.sql`: private review/visit binding and stale-review rejection.
- `20261015105138_itemized_table_bill.sql`: narrowly authorized shared dish and customization snapshots.
- `20261015113419_visit_only_customer_access.sql`: permanent active-visit RLS/RPC restrictions, private receipt helper, visit-key rotation, generation-bound reviews and active-only legacy API compatibility.

No existing restaurant records were reset or deleted. The original tested pricing/creation and review implementations remain private, non-executable by API roles, behind narrow wrappers. All definer functions use a fixed empty search path; public functions are authenticated-only and independently validate guest identity or staff membership. No service-role credential or payment dependency was introduced. Database types and catalog verification include the new structures.

Realtime subscriptions use the existing verified in-memory caller JWT, scoped filters, row security, initial snapshots, coalesced invalidations and reconnect/foreground reconciliation. Minimal session/request signal rows expose no participant or actor identities. Approved participants receive signals only while the session is active; closed session/request rows are no longer guest-readable. Short authorized rechecks detect closure, conceal old views and discard stale selections. Participants never receive the next visit’s events. Own-order events let a waiting guest discover acceptance. Staff share a single workspace provider for requests/table state; events never become trusted financial UI data. Every authoritative update is refetched from PostgreSQL.

### Test locally

1. Run `npm run dev`, or `npm run build` then `npm start`, with the existing live Supabase configuration. Sign in at [staff login](http://localhost:3000/admin/login). Open [the kitchen](http://localhost:3000/admin/orders) and [Tables](http://localhost:3000/admin/tables) on staff devices.
2. In two separate browsers/private contexts, scan the same QR. The dedicated development test table is [Table 05](http://localhost:3000/r/mesa?table=861485a2-85df-431d-ac25-97550b1e5765); the original [Table 04](http://localhost:3000/r/mesa?table=67006a2d-d1c1-4ba2-918f-fb8e4ffb1b5c) also supports sessions for newly submitted orders. These are real development orders.
3. Each guest places an order. In **Table bill**, pending guests see the acceptance explanation. Staff accept both orders. Each approved guest now sees everyone’s dishes and customizations with the same shared total, without guest identities or private receipts. New orders update the already-open bill automatically. **Current orders** shows only that guest’s active-visit receipts. Closure removes customer access to all of them.
4. One guest presses **Request the Bill**. Staff see “Table 05 has requested the bill” automatically in the workspace header and Tables. Press **Acknowledge request**; both guests see acknowledgement.
5. Serve or cancel remaining orders through the kitchen, then choose **Close dining session → Confirm close session** in Tables. Customers see the visit has ended. No payment status is recorded.
6. Start another dining session. Its bill and order list are empty; old guest participation does not transfer. Inspect **Previous visits → View orders** to see historical snapshots. Refresh both interfaces or disconnect/reconnect to check persistence.
7. A third authenticated guest or fresh browser using the same QR cannot see shared totals or other receipts without staff accepting its own new-session order.
8. Use `APP_DATA_MODE=demo npm run dev` for an explicit empty-session preview. Demo mutations, requests and subscriptions are disabled; no fake successful events occur.

For repeatable hosted API/Realtime verification, set `STAFF_TEST_EMAIL`, `STAFF_TEST_PASSWORD` and `ORDER_SESSION_TEST_TABLE_TOKEN` only in ignored `.env.local`, then run `node scripts/verify-sessions-live.mjs`. The script refuses a table with an active visit and never closes an existing group. It creates three real development orders, completes/cancels only those records, acknowledges the request, closes their session and leaves one fresh empty session. To repeat deliberately, staff must close that empty test visit first. Local automated tests use isolated PostgreSQL and controlled SDK transports.

### Current limits

Participation relies on staff accepting the correct table order; it is not cryptographic proof of physical presence. A leaked QR still permits order attempts under the existing rate limits. There is no manual invitation/revocation UI or automatic visit expiry: staff must close visits promptly, and QR rotation does not revoke an already authorized participant. One bill request/acknowledgement lifecycle is supported per visit; further assistance after acknowledgement is handled directly by staff. There is no waiter-call request type yet. Legacy orders remain in staff-only restaurant records with no inferred visit. Historical sessions and their orders load in pages of 20; aggregates always cover the complete session. Physical-device certification and production deployment remain separate. Online payments are permanently excluded.

### Increment 6 validation record

Prior itemized-bill validation passed TypeScript, ESLint, production build and **217 automated tests** (133 PostgreSQL, 13 menu, 17 cart, 25 order submission/server, 13 kitchen/reconciliation, 7 private history and 9 session/DTO/error tests). PostgreSQL tests include transaction rollback, read-only PostgREST behavior, stale-visit review rejection, tenant/guest privacy, immutable associations, historical currency, lifecycle guards, durable request limits and scoped execution privileges. Existing order pricing and idempotency tests still pass.

**Actual hosted API and Realtime passed**, including concurrent first orders into one visit, two staff receivers, pending versus accepted shared amounts, cancellation exclusion, concurrent request deduplication, response-loss recovery, concurrent acknowledgement, all kitchen states, session closure, concurrent new-session creation, empty new bill, original-key order replay, cross-tenant denial and denied direct writes. An authenticated outsider at the same QR received zero session/request events. Approved participants received no other guest’s private order events and no new-visit events.

**Production browser verification passed** with two separate mobile guests and a staff workspace: €30.50 combined across customized €16.50 and €14.00 orders; staff acceptance enabled access, private histories stayed isolated, bill request reached the open kitchen, a discarded successful response recovered without duplicate requests, acknowledgement updated both guests, offline recovery restored current state, staff inspected itemized customizations, served both orders, closed the visit and started an empty one. That earlier run preserved customer history; the permanent visit-only migration now revokes it on closure. Customer/staff layouts were checked at widths 320–1440, with keyboard disclosure controls and no horizontal overflow. Demo checks verified no real mutations or Supabase subscriptions. The personal-history loading boundary was separated so denied private confirmations return HTTP 404 before streaming.

After the final review-binding migration, an additional browser check rejected a stale quote after a table visit changed, showed the explicit review-again message, preserved the bag and created no order/items in the new visit. A fresh real order then verified successful creation, trusted pricing, association, acceptance and completion through the final schema. Hosted catalog queries independently confirmed function grants/search paths, RLS, correct composite associations, matching stored totals and **all 15 pre-increment orders still unassigned**.

Eight real development orders remain for inspection: three API workflow orders, two diagnostic browser orders completed through staff operations, two full browser-workflow orders, and one final post-hardening creation check. No pre-existing orders or restaurant records were reset or deleted. Test session `f5456c49-bc83-4267-bf3a-579e804e5156` preserves the €42.00 API bill; `dc1a8622-3c02-4671-959c-1e55812b9d55` preserves the €30.50 browser bill. Both requests are closed with staff attribution retained privately. Table 05 was left with a fresh empty active session at the end of that run; later customer orders can occupy it. Temporary guest browser checkpoints were removed. These checks are browser emulation and hosted development verification, not a production deployment or physical-device certification.


## Itemized current table bill

`20261015105138_itemized_table_bill.sql` introduced stored shared dish/customization/quantity/price/status snapshots. `20261015113419_visit_only_customer_access.sql` permanently restricts every customer read path to an active visit, including direct RLS, receipts, tracking, idempotency recovery and former history endpoints. It adds table-generation rotation, a minimal QR context read and a generation-bound review RPC. Existing order records, tenant constraints, staff history and atomic creation remain preserved. The old unbound review RPC has no API execution grant.

Open **Table bill** for every approved diner’s current dishes and prices, and **Current orders** for your own active receipts. Staff inspect prior sessions in `/admin/tables`. Staff always confirm the final bill and handle payment outside Restaurant OS.

## Visit-only privacy validation

The permanent visit-only change passes **223 automated tests**: 136 PostgreSQL authorization/lifecycle tests and 87 menu, cart, order, kitchen, current-visit and session tests. TypeScript, ESLint and the production build pass. Tests cover closure revoking direct RLS reads and every receipt/history/tracking/bill path, staff historical access, closed idempotency recovery, stale reviews, new-visit isolation, generation-scoped persistence and tenant isolation.

Hosted development verification used the dedicated, initially unoccupied **Bill QA** table. Three real API orders from two independent anonymous guests shared one session; an outsider could not read its private records. Actual WebSocket delivery was observed (24 active-visit events), along with staff transitions, bill request and acknowledgement. After closure, the same original guest JWTs retrieved no orders, items, sessions, requests, receipts, progress or historical ledger entries. Closed-key submission failed with `VISIT_ENDED`; stale generation/review attempts failed without creating another order. A fresh empty visit exposed no previous orders to the original identity. Staff retained all original snapshots.

Production-browser checks placed two additional orders (€16.50 customized and €14.00), displayed both during the visit, verified the itemized €30.50 table bill, and completed service. An already-open receipt concealed its contents after closure. Reloading the old confirmation URL in the same guest browser returned **HTTP 404** and the private-order-unavailable screen. Current orders became empty and the old unsubmitted basket was discarded when reopening the QR. Five QA orders totaling €86.50 remain in closed historical sessions, with no deletion or reassignment. Bill QA was restored to inactive and has no active visit; existing customer visits at other tables were not closed by these checks.

The migration was applied through authenticated Supabase Studio because the MCP connection continued to return an OAuth refresh error after reconnection. A separate read-only Studio query verified the stored migration text matches the repository, the active-visit RLS guard is installed, and the unbound review/private historical helper cannot be executed by API roles. SDK/API and WebSocket tests used real hosted development data, not mocks.

To repeat the isolated hosted checks, keep staff credentials only in ignored `.env.local`, then run:

```sh
VISIT_PRIVACY_TABLE_TOKEN=<dedicated-Bill-QA-token> node scripts/verify-visit-privacy-live.mjs
```

The script requires the named Bill QA table to have no active visit, refuses to close an existing group, creates real test orders, closes only its own sessions and restores the QA table to inactive. Do not use a currently occupied customer table.

For a manual access-revocation check:

1. Open a valid restaurant QR URL, place two orders and leave a receipt, **Current orders**, **Table bill** and an unsubmitted bag open in separate tabs in the same guest browser.
2. Staff accept and finish those orders in `/admin/orders`, acknowledge any bill request, then close that exact visit in `/admin/tables`.
3. The open customer views conceal the old visit. Reload the saved receipt URL: it must return 404, even with the original anonymous session. The old `orders?history=all&table=...` URL must not reveal an archive.
4. Scan the same QR again. The basket and current-visit orders are empty; the old review cannot submit into the new visit. A new order creates/joins the new active session without inheriting participation or historical orders.
5. In the staff **Tables → Previous visits → View orders** interface, verify the closed visit still contains its full products, customizations, prices, statuses and timestamps.

Closure is staff-controlled, not a midnight timeout. Already downloaded data or screenshots cannot be remotely erased; PostgreSQL revokes new reads immediately, while healthy open views recheck within five seconds and conceal delayed/unverified details after ten seconds. Physical-device certification and production deployment remain separate. Online payments remain permanently excluded.

## Menu administration & media

Sign in at `http://localhost:3000/admin/login` with an owner/manager membership, then open `/admin/menu`. Ordinary staff retain kitchen/table access; they cannot edit the catalog. Select a restaurant in the existing workspace switcher if you manage several.

- Create categories, set their publication state, and move them up/down.
- Create a dish as a draft. Edit descriptions, exact decimal prices, ingredients, allergens, dietary labels and availability. Publish when ready; archive instead of deleting. Hidden categories hide their dishes.
- Configure required/optional choice groups, limits, per-choice supplements, availability and ordering. Remove obsolete definitions without rewriting historical snapshots.
- Save a new dish before uploading photography or models. Choose Photography & 3D, upload files, preview, then save. Replacements use new immutable paths. The unused-media section offers explicit cleanup; referenced files cannot be deleted.
- For 3D, upload a model of the actual dish, inspect measured bounds, document license/source/physical measurements, confirm review, then optionally enable table placement. An uploaded unreviewed model stays hidden from the customer viewer. Rights/portion accuracy require a responsible human review.
- Open `/admin/settings` to edit restaurant name, description, time zone, branding, menu publication and acceptance of new orders. Slug/currency stay fixed.

Apply `supabase/migrations/20261015190000_menu_administration.sql` and `20261015200000_menu_asset_review_drafts.sql`, regenerate types with `npm run db:types`, and configure the public media bucket once:

```sh
# Keep this value only in ignored .env.local and Vercel server environment.
# SUPABASE_SERVICE_ROLE_KEY=<development project's secret/service-role key>
npm run storage:setup
```

The service key is used only by the server media gateway; catalog RPCs use the verified staff SSR session. Never put it in `NEXT_PUBLIC_*`. Public files are public even while a draft is unpublished: upload only restaurant presentation assets. Direct browser writes to the bucket are denied, including owner tokens; all uploads go through byte validation at `/api/admin/media`. Bucket configuration uses the supported Storage API. No Storage metadata rows are manually modified.

Upload limit: **4,000,000 bytes** per file, below the Vercel function request limit. Images: still JPEG/PNG/WebP, at most 24 MP / 8192 px; decoded, stripped of metadata, resized to 1600 px and stored as WebP. GLB: self-contained static GLB 2.0 with baked transforms, metre units, base within 5 mm of height zero; 150k vertices / 100k triangles, up to eight embedded PNG/JPEG textures at 2048 px. Draco/KTX/animations/skins/unbaked transforms are deliberately rejected by this initial audited pipeline. Dimensions must be 3 mm–1.2 m on every axis. Re-export larger models before upload. Optional USDZ must be a valid aligned, uncompressed package with embedded USD/PNG/JPEG resources; structural checks cannot certify the semantics or scale of a binary USD scene. Review the paired asset and physically test iPhone Quick Look before enabling it. See [3D onboarding](docs/3d-assets.md).

`npm run test:admin` exercises price/modifier validation and actual image/GLB/USDZ bytes. `npm run test:db` also exercises manager RPCs, protected registry/Storage policies, archive visibility, stale writes, tenant isolation and historical preservation. Existing cart/review tests check changed prices/options; the final order transaction independently rejects unpublished/archived/unavailable dishes. Live failures never become demo successes. Set `APP_DATA_MODE=demo` to explore an editor with disabled persistence/uploads.

### Increment 8 validation

The development project has both administration migrations applied, with exact repository/ledger hashes verified. All **269 automated tests** passed, including **157 database tests**, alongside TypeScript, ESLint and the production build. The **34 hosted administration checks** use an isolated unpublished QA restaurant, never Casa Mesa's menu or occupied tables. They covered owner/manager/staff restrictions, real optimized photographs, GLB and USDZ uploads, same-upload recovery, versioned replacement, referenced-file protection, public visibility, model readiness and draft review notes, restaurant settings, a real customized QA order and immutable snapshots after edits. The QA visit was closed through normal staff operations; historical QA records remain stored.

After credential rotation, the restarted application also passed an authenticated image upload/removal, authorized menu/settings rendering, unauthenticated admin redirect, live customer menu and explicit demo checks. An initial desktop inspection was completed, but native screen capture subsequently failed; final mobile/tablet interaction checks remain unverified. Physical-phone AR/portion certification was not performed.

To repeat deliberately (creates a new isolated QA tenant, QA-only confirmed staff identities and retained QA order), with public/server configuration and existing owner credentials in ignored `.env.local`, run against a running local app:

```sh
CONFIRM_MENU_ADMIN_QA=development node --env-file=.env.local scripts/verify-menu-admin.mjs
CONFIRM_MENU_ADMIN_QA=development node --env-file=.env.local scripts/verify-menu-admin-followup.mjs
CONFIRM_MENU_ADMIN_QA=development node --env-file=.env.local scripts/verify-menu-review-drafts.mjs
```

The report is written to `/private/tmp/restaurant-os-menu-admin-verification.json`. These are explicit integration scripts, not part of ordinary unit tests. Local automated coverage uses isolated PostgreSQL and generated media fixtures. Media is limited to 4 MB; compressed/animated models and full binary-USD semantic certification are outside the current gateway. The existing lint dependency chain currently reports a high-severity `braces` pattern-recursion advisory; no forced Next/ESLint downgrade was applied. These packages are development tooling, outside the production runtime dependency tree.
