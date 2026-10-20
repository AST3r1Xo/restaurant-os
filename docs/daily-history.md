# Daily restaurant history

Owners and managers open **Daily history** in the staff navigation, or visit
`http://localhost:3000/admin/history` after signing in at `/admin/login`.
Select the restaurant using the existing workspace switcher when applicable.
Ordinary staff retain Orders and Tables access; the history navigation is hidden
and its reporting RPC rejects them.

## Using the dashboard

1. Choose a date and press **View day**. Previous/next arrows and **Today** provide
   quick navigation. Dates follow the restaurant's configured IANA timezone.
2. See confirmed order value, orders received, confirmed dish quantities and
   average confirmed order value. Pending and cancelled counts/amounts appear
   separately. The latter are excluded from the confirmed figure and ranking.
3. Compare **Most ordered dishes** and **Less ordered**. The bar lengths count
   dish units, not distinct tickets or money. Prices beside them include stored
   customization supplements. Expand the full ranking when there are more than
   eight dishes.
4. Open an order for the original products, quantities, customizations, private
   special requests, prices and latest status. Use **Older orders from this day**
   for more receipts. The daily totals/chart always include the entire day,
   including receipts on other pages.
5. Press **Refresh day** to retrieve the latest authoritative records. This
   historical screen does not add a Realtime subscription; the existing kitchen
   and assistance workflow remains live.

These figures are recorded order value, not verified takings, outstanding
balances or tax invoices. Restaurant OS never processes or verifies payments.
Restaurant staff handle payment independently.

## Calculation rules

- A day runs from local midnight up to, but excluding, the next local midnight.
  It can be 23 or 25 hours across daylight-saving changes.
- Orders are attributed by `orders.created_at`, using the latest stored status.
  Serving after midnight does not move the original order to the next day.
- Confirmed means accepted, preparing, ready or served; pending and cancelled
  are separate. The four internal states do not imply verified payment.
- Totals sum stored PostgreSQL order amounts in integer minor units using
  bigint aggregates. Per-order details use immutable item snapshots.
- The average is confirmed total divided by confirmed order count, rounded to
  the nearest minor unit for display only.
- Product rankings sum quantities across customization variants, grouped by
  product ID. Their name is the latest ordered snapshot name within the chosen
  day, not today's menu name. Every receipt retains its own original name.
- The lowest-demand list includes only dishes that were actually ordered in
  confirmed orders. Historical product availability is not recorded, so no
  assumption is made about whether a zero-order dish was available that day.
- Historical currencies are kept separate. A currency selector appears if a
  day contains more than one; no conversion or mixed-currency addition occurs.
- Historical closed-session and legacy orders without a session remain visible
  to authorized managers. Guest access to historical visits remains revoked.

## Database and authorization

Migration `20261020144202_daily_restaurant_history.sql` adds only:

- `orders_restaurant_history_idx(restaurant_id, created_at desc, id desc)`.
- `get_daily_restaurant_report(uuid,date,text,uuid)`, a stable, read-only,
  SECURITY DEFINER RPC with an empty fixed search_path.

The function validates the verified non-anonymous JWT subject and current
restaurant membership/owner-manager role. Execution is denied to public/anon.
Ordinary staff, guests (even if incorrectly assigned a membership), outsiders
and cross-tenant/day/currency cursors are rejected. API inputs cannot choose
unrestricted ownership or bypass these checks.

Each response contains complete selected-day/currency aggregates and up to 40
receipts, with a `(created_at,id)` cursor. It includes no customer identifiers,
Auth credentials or QR tokens. Existing order/item RLS and guest visit access
rules are unchanged. No historical data is edited or deleted.

The public database types were regenerated from versioned migrations. The type
generator maps PostgreSQL `date` to a TypeScript string. No new runtime
dependency is needed; the quantity chart is server-rendered HTML/CSS.

## Verification and local development

Use the existing ignored `.env.local` live Supabase configuration, then run:

```sh
npm run test:reports
npm run typecheck
npm run lint
npm run test:db
npm test
npm run build
npm run dev
```

Open `/admin/history` as an owner/manager. Try a populated day, an empty day,
different dates, expanded receipts and Refresh day. An ordinary staff account
must not receive report data. The normal customer screens remain visit-scoped.

For an explicit disconnected sample preview, run the application with
`APP_DATA_MODE=demo`; its 24 sample receipts and metrics are labelled Sample data.
The demo creates no real records and never runs if a live query fails.

Read-only hosted verification uses ordinary staff credentials from ignored local
configuration:

```sh
node --env-file=.env.local scripts/verify-daily-reports-live.mjs
```

The verifier is guarded to development project `ahkleoidhzcsubsdlqbn`, checks
existing Casa Mesa history and retained QA fixtures, and writes a credential-free
summary to `/private/tmp/restaurant-os-daily-report-verification.json`. It creates
one internal anonymous Auth session solely to prove guest denial; it does not
modify restaurant, menu, session or order records or use a service-role key.

The development migration was applied and inspected. Nine hosted checks passed:
all three existing Casa Mesa calendar days matched authorized PostgreSQL order
and item rows, all 35 historical receipts were accounted for, empty days were
real zeros, anon/guest/cross-restaurant access and foreign cursors were denied,
and the closed unpublished QA restaurant retained its six historical receipts.

Automated database tests also cover manager restrictions, role revocation,
all statuses, tenant/date/currency cursor isolation, 85 tied-timestamp receipts
across three pages, 23/25-hour DST days, historical menu edits/archival, variants,
bigint sums and read-only PostgREST execution. Rendering tests cover labels,
quantities, escaped notes, empty states, pagination and explicit sample data.
Interactive browser and physical-device checks must be reported separately;
the computer-use surface was unavailable during this implementation.

Validation passed **26 report-specific tests** (18 PostgreSQL and 8 model/render
tests), **385 total automated tests** including **208 PostgreSQL tests**,
TypeScript, ESLint and the production build. Five additional authenticated
production HTTP/SSR checks passed: the owner dashboard/navigation, genuine empty
day, real historical receipts, invalid-date recovery and unauthenticated
redirection before exposing report contents. No restaurant records were changed.

To repeat the HTTP checks with the local production server already running:

```sh
REPORT_TEST_ORIGIN=http://127.0.0.1:3400 node --env-file=.env.local scripts/verify-daily-reports-http.mjs
```

This script sends in-memory staff cookies only to localhost, never saves them
and is guarded to the development Supabase project. HTTP/SSR evidence does not
verify interactive disclosures, date input on real devices or visual layout.
An additional HTTP check passed in explicit demo mode: the selected date, sample
receipt list and quantity chart rendered without staff sign-in.
