# Restaurant scenario campaign — 20 October 2026

The campaign exercised the current application and added 24 regression/scenario
tests. The initial 335-test baseline passed. After the correction below, all
359 tests passed, including 190 PostgreSQL tests. Iterations, visits and HTTP
requests are reported separately; they are not additional independent test cases.

## Defect reproduced and fixed

**High severity: a full or blocked browser store could restore stale cart data.**
When `getItem` still worked but `setItem` failed, the next cart edit or visibility
reload replaced newer in-memory state with the old persisted bag. It could lose
recent additions or resurrect purchased quantities. Re-enabling previously
blocked empty storage could also discard the in-memory bag.

The cart now distinguishes the last observed durable value from unsaved state.
Unchanged old data cannot replace pending edits/cleanup receipts. A successful
write saves both together. An actual change from another tab still takes
precedence. Regression tests first failed on the original code, then passed
after the correction, including 2,000 intermittent read/write failures.

Limit: if the browser refuses all writes and the page is fully reloaded, memory
cannot survive. The storage warning remains. Real submission still requires a
persisted idempotency reference; this correction does not weaken that protection.

## Local stress coverage

`tests/restaurant-stress.test.mjs` contains 14 tests:

- Five seeded runs of 2,000 cart operations each, compared after every step with
  an independent reference map and integer-price oracle: additions, removals,
  purchase subtraction, reloads, cross-tab replacement and visit isolation.
- Storage quota failures, duplicate purchase cleanup, genuine cross-tab changes
  and enabling storage after it was blocked.
- 2,000 intermittent storage-fault/recovery iterations.
- 2,000 intent permutations, with injected price/ownership/status fields rejected.
- 2,000 malformed or cross-visit persisted bags, all rejected.
- A timed-out response that later resolves without inventing a replacement order.
- 300 note-identity/whitespace cases.

That is **16,300 deterministic loop iterations**, plus named fault regressions
and timeout testing. Seeds and step numbers are included in failures.

`tests/restaurant-stress-database.test.mjs` contains 10 tests using every real
repository migration and the seed in isolated PostgreSQL:

- Eight seeded stories, each with ten consecutive visits and three guests:
  **80 visits and 240 orders**. Each story rolls back after verification.
- Private per-guest receipts; no shared access until staff confirmation;
  pending/confirmed/cancelled arithmetic; private-note and identity redaction.
- Catalog edits preserve committed prices and notes. Requests deduplicate.
  Closure requires fulfilled orders and acknowledged requests.
- Closure revokes direct RLS reads, receipts, progress, recovery and current-order
  history. The following visit has a new generation and no previous bill.
  Staff retain all historical snapshots.
- 600 differential Unicode/whitespace normalization inputs agree between the
  JavaScript boundary and PostgreSQL.
- 500 malformed, manipulated or unavailable-product order intents leave no
  orders, items or sessions behind.

PGlite serializes access. These local stories validate SQL behavior and state
combinations; they are not evidence of parallel PostgreSQL transactions.

## Actual development Supabase verification

The complete run passed **21 scenarios / 126 RPC requests** against project
`ahkleoidhzcsubsdlqbn`, using six independent anonymous guests, three unused
tables, two authenticated staff connections and actual WebSocket subscriptions.

- Six concurrent duplicate submissions produced exactly two orders.
- Conflicting contents raced under the same key: one committed, one was rejected.
- A successful creation response was deliberately discarded after commit; the
  original receipt was recovered without another order.
- Concurrent first orders produced exactly one session per table.
- Both staff WebSockets received every new order. The guest received only its
  own order events.
- Same-table guests could not read one another's private receipts. Guests could
  not impersonate staff; staff could not access an unrelated restaurant.
- Competing Ready/Decline staff actions produced one transition and one
  expected-status conflict.
- All three itemized bills matched stored amounts and excluded cancelled value;
  identities, receipt IDs/references and private notes were absent.
- Three concurrent bill requests created one request and delivered a real staff
  event. Concurrent acknowledgement was safe and reached the guest WebSocket.
- Disconnecting a guest, changing the order and reconnecting restored the
  authoritative current status through a fresh snapshot.
- Price edits and unavailability blocked stale submissions without rewriting
  committed amounts.
- Closing the restaurant blocked new orders while existing receipts and staff
  service remained usable. Reopening succeeded.
- Closing visits revoked all six guests' direct RLS reads, receipts, recovery,
  history and old-key submissions.
- Concurrent opening of the next visit returned one empty session, rotated the
  generation and inherited no guest participation.
- Staff retained all six orders and their three itemized historical visits.

The observed RPC median was **97 ms**, p95 **160 ms**, maximum **403 ms** from
this machine. Sixteen rejected requests were deliberate negative/concurrency
cases. Total campaign time was 16.9 seconds. This small bounded correctness run
is not a throughput limit, production SLA or capacity certification.

The successful fixture was `stress-qa-b90c965f`. An earlier fixture
`stress-qa-fc6e19c0` stopped at a wrong expected error label in the new harness
(`ORDER_CONFLICT` versus the existing `STATUS_CONFLICT`); the product correctly
rejected the conflicting action. Its six QA orders were completed/cancelled and
sessions closed through normal staff authorization. No orders were deleted.

After both runs, all 12 QA orders remain historical, with zero active QA
sessions/tables. Both QA restaurants and their separate isolation-control
restaurants are closed and unpublished. Casa Mesa's 35 orders and 36 items kept
their exact pre-test hashes; its five customer tables were not used.

No migration or schema change was required. QA bootstrap/retirement used the
separately authorized project administration connection. All menu, order, bill
and session workflow operations used ordinary staff/guest permissions. The
application media service credential was never used for provisioning or orders.

## HTTP and performance checks

`scripts/verify-http-smoke.mjs` passed **21 HTTP/SSR scenarios / 41 requests**
against the local production build:

- iPhone, Android and desktop User-Agent headers: menu/product links, category
  navigation metadata, optional special requests, search-empty recovery, escaped
  search input, bag/review/current orders/bill responses.
- Missing restaurants/products and private receipt URLs; no-store headers.
- All five private staff routes redirect to the same-origin staff login.
- Anonymous QR downloads, media uploads and deletion requests are denied.

Public missing products may return HTTP 200 after their loading boundary starts
streaming; the response still carries unavailable/noindex markers. This is the
installed Next.js documented behavior. Private receipt denial is tested as a
real HTTP 404 before private content streams.

Local production menu measurement: five warm samples, median response **248 ms**,
HTML gzip **20,221 bytes**, initial JavaScript gzip **198,530 bytes** across 12
scripts. This measures HTTP and resources, not phone rendering, LCP, INP or mobile
network/CPU performance. No performance optimization claim is made from it.

## Repeat locally

Use the repository's Node 24 environment:

```sh
npm run test:stress
npm test
npm run typecheck
npm run lint
npm run test:db
npm run build
node --env-file=.env.local scripts/check-secrets.mjs
```

The stress suite is included in `npm test`; its database portion is also included
in `npm run test:db`. Do not add those subset counts to the full-suite count.
All commands above passed. Secret scanning found no privileged credential in
the working tree, committed blobs or generated browser JavaScript.

For HTTP checks, start the build in a separate terminal:

```sh
npm start -- --hostname 127.0.0.1 --port 3400
HTTP_SMOKE_ORIGIN=http://127.0.0.1:3400 node scripts/verify-http-smoke.mjs
MEASURE_ORIGIN=http://127.0.0.1:3400 npm run measure:pages
```

HTTP smoke requires live mode with the published Casa Mesa menu. It makes public
reads and deliberately unauthorized media requests; it creates no orders/files.

## Repeat hosted concurrency safely

Use only the guarded development project and ignored local staff credentials.
Never use a real restaurant's occupied tables, remove limits, reset the database
or substitute the media service key for an administrative provisioning context.

1. With `STAFF_TEST_EMAIL` and `STAFF_TEST_PASSWORD` stored only in ignored
   `.env.local`, prepare unique identifiers:

   ```sh
   CONFIRM_RESTAURANT_STRESS_QA=development node --env-file=.env.local scripts/verify-restaurant-stress-live.mjs --prepare
   ```

2. Verify the intended development project through the separately authorized
   Supabase administration connection. Apply the generated
   `/private/tmp/restaurant-os-stress-provision.sql` there. It creates two clearly
   labelled fresh QA restaurants, three primary tables, one isolation-control
   table and the existing verified staff user's primary QA owner membership.
   The script never provisions these through the application's media key.

3. Run the workflow:

   ```sh
   CONFIRM_RESTAURANT_STRESS_QA=development node --env-file=.env.local scripts/verify-restaurant-stress-live.mjs
   ```

4. Read `/private/tmp/restaurant-os-stress-verification.json` for checks, request
   timings and limitations. It contains no passwords, Auth tokens or QR tokens.
   The ignored temporary plan contains generated fixture identifiers only.

5. Retire only the generated QA fixtures through trusted administration: close
   and unpublish their restaurants and deactivate tables after verifying no
   active sessions remain. Retain historical records. If a run stops partway,
   inspect its own tickets through staff access, fulfil/decline them, acknowledge
   any request and close those exact sessions. Never blanket-close other tables.

Each run requires a fresh plan/fixture. The verifier refuses an occupied table
or a restaurant with previous orders. Concurrency is deliberately bounded to
small groups (maximum six simultaneous RPC calls), with existing abuse controls
enabled. Repeated Auth provisioning also consumes development Auth rate limits.

## Remaining verification

The computer-use surface failed to initialize (`native pipe startup failed`),
so this campaign did not verify interactive browser clicks, hydrated UI,
responsive layouts, touch, keyboard focus or visual appearance. User-Agent
headers are not viewport emulation. No physical iPhone/Android was available.

Before a live restaurant pilot, use actual phones and tablets to test:

1. Two separate guests scan one QR, customize different dishes and submit while
   the kitchen is already open. Confirm both itemized orders appear once.
2. Staff mark Ready, then Served together when appropriate. Customers receive
   no cooking countdown or readiness promise. Both approved guests see the same
   itemized bill and only their own private receipts/notes.
3. Disable/re-enable Wi-Fi during submission and tracking. Recover using the
   original order reference; verify no extra ticket.
4. Request/acknowledge the bill, fulfil tickets and close the visit. Old open
   receipt tabs and refreshes must no longer reveal its contents. A new visit
   starts empty; staff historical records remain.
5. Check smallest-phone portrait, landscape and tablet layouts, screen reader
   labels, keyboard focus and large touch targets.
6. On HTTPS, verify the licensed dish's actual 3D/AR loading, placement and real
   physical scale in Safari/Chrome. Return with quantity/customizations intact.

These conditions remain unverified by this campaign. The automated/API results
do not certify physical AR or a restaurant operating under peak-service load.
Online payments remain permanently excluded.
