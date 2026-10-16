# Increment 9: pilot readiness audit

Audit date: **16 October 2026**, Europe/Lisbon. Scope: the repository and existing
development Supabase project. No production deployment, infrastructure change,
database reset, historical deletion or physical-phone verification was performed.

**Decision:** the application has passed local regression and real hosted
API/WebSocket workflow checks. It is ready for isolated HTTPS staging validation,
with release gates below still open. It is not yet certified for an unrestricted
public restaurant pilot.

## Scope inspected

- Customer menu/product navigation, QR resolution, publication/availability,
  modifier definitions, integer cart calculations, persistence, cross-tab locking,
  review binding, atomic creation, recovery and confirmation authorization.
- Staff/guest cookie namespaces, remotely verified Auth, membership/role guards,
  public/guest/staff clients and privileged media gateway boundaries.
- All migration definitions and local PostgreSQL coverage: RLS, tenant foreign
  keys, snapshot preservation, function privileges/search paths, status concurrency,
  visit closure, historical access and bill request/session signals.
- Realtime invalidation, authorized initial snapshots, reconnect reconciliation,
  duplicate handling, private-view concealment and fallback polling.
- Kitchen/table queues, settings/menu editing, media validation/replacement, model
  readiness, optional AR, error/loading/empty states and deployment configuration.
- Tracked/untracked source, committed Git blobs, built browser scripts and
  installed dependency advisories. This is an engineering audit, not an external
  penetration test or legal/compliance certification.

## Findings by severity

### Critical / P0

No critical authorization bypass or historical-access regression was reproduced
in the reviewed paths and tests. This statement is limited to the checks actually
performed; it does not certify every production/network/browser condition.

### High / P1 — fixed

- **Recovery could replay failed server data.** All route error screens used
  `reset()`. In the installed Next 16.4 API it clears the boundary without fetching
  again. They now use `retry()`, which refetches. Parent customer and standalone
  root-layout recovery boundaries were added. Customer recovery retains the
  restaurant/table rather than navigating another restaurant to Casa Mesa.
- **Hosted configuration could silently become a demo.** Vercel builds now require
  explicit live/demo mode, a public HTTPS origin, and matching expected Supabase
  project/configuration. Missing live media/public keys fail the build. Local auto
  mode and explicit demonstrations remain available.
- **Uploads could remain indefinitely busy.** The browser now has a 50-second
  deadline, Storage/registry transport has 15-second deadlines, and retry preserves
  the existing upload UUID/hash. An uncertain response is never presented as success.
- **Local Auth configuration contradicted first anonymous visits.** The local
  configuration now permits guest user creation while separately disabling email
  self-registration and requiring confirmed staff. The nonexistent auth callback
  URL was replaced with the real staff login path. Hosted configuration was not
  changed; its anonymous signup was actually verified. A complete local GoTrue
  stack was not launched, so local Auth configuration still needs stack-level QA.
- **Development credential exposure follow-up completed.** On restoring native
  browser access, the initial accessibility snapshot opened the user's existing
  Supabase legacy JWT settings page and included the signing secret. The browser
  was moved away immediately. The user replaced the application's legacy server
  API key with a modern secret key in ignored configuration, then confirmed legacy
  revocation. After a server restart, **14 hosted post-revocation checks passed**:
  fresh staff/anonymous Auth, remotely verified identities, refresh with ES256
  tokens, membership and guest historical-access denial, real validated image
  upload/retry/public retrieval/cleanup, live/staff HTTP routes, unauthenticated
  staff denial and actual authorized WebSocket session-open/session-close events.
  The isolated empty QA session was closed and its table restored inactive. No
  order records changed. Dashboard revocation was user-confirmed; this verification
  establishes continued app operation with the replacements. Never put credential
  values in reports, SQL, source or logs. This incident is separate from scanning
  repository/bundle/log locations.

### Medium / P2 — fixed or mitigated

- **Browser hardening headers were missing.** Added anti-framing, no-sniff,
  same-origin referrer policy, limited CSP directives and same-origin camera/XR
  permissions. HSTS applies to configured HTTPS origins. The CSP is deliberately
  not advertised as a complete nonce-based script policy. Actual local HTTP
  response headers were checked.
- **Proxy maintenance could fail outside normal recovery.** Auth refresh failures
  now reach route-level recovery; private data/actions still verify identity and
  membership independently. Explicit demo mode bypasses proxy Auth completely,
  including when local live keys are present.
- **Tablet navigation could crowd branding/table context.** Four-link desktop
  navigation now starts at 1024px; tablets retain bottom navigation. Cart/footer
  clearances follow the same breakpoint, and long labels wrap. Source changes
  passed compilation. Native-browser demo checks covered 320×568 and 390×844;
  the full tablet/landscape/physical-touch matrix remains open.
- **Narrow 3D header wrapped its return control.** At 320px, the long development
  asset label squeezed “Photo” into two lines. The return control now keeps its
  width and the label can wrap. The CSS fix passed validation; a post-fix visual
  recheck remains open after browser control was interrupted.
- **Unnecessary operational prefetch.** The customer footer no longer prefetches
  the private staff workspace. Existing 3D runtime/model loading remains explicit
  and lazy; no additional engine/runtime dependency was introduced.
- **QA credential scope.** A follow-up privileged metadata inspection was rejected
  by automatic approval review as outside the media key's scope. Cleanup was
  inspected successfully using ordinary authenticated staff authorization instead.
  The repeatable pilot harness now requires a separately authorized
  `PILOT_QA_ADMIN_KEY` for setup/cleanup, with no fallback to the application media
  key. The 43-check hosted run preceded this credential-variable separation; the
  provisioning guard was regression-tested to reject the media key in each
  administrative harness; setup was not repeated with another admin credential.

### Open release gates

- **High: anonymous signup abuse and real-network capacity.** Application/DB order
  rate limits do not secure Supabase's direct Auth signup endpoint. CAPTCHA token
  handling is absent. Decide and implement/test appropriate abuse protection before
  unrestricted public access. Simply toggling CAPTCHA would break current sign-in.
  Test Vercel server egress and shared restaurant Wi-Fi limits with expected volume.
  See [Supabase guidance](https://supabase.com/docs/guides/auth/auth-anonymous).
- **High: HTTPS browser/device rehearsal.** Native browser access resumed for
  the demo checks listed below, then became unreliable again: clicks returned
  `noWindowsAvailable`/`elementHasNoFrame` and navigation stopped changing the
  page. The complete live customer/staff UI, tablet/landscape and keyboard matrix
  remains unverified. HTTP, SDK and WebSocket checks do not substitute for it.
- **High: staging operational sign-off.** Separate hosting/database resources,
  project Auth settings/advisors, backup/restore, monitoring, staff rehearsal,
  incident contact and rollback need operator verification. No deployment was
  authorized or performed. MCP catalogue/advisor queries failed OAuth refresh;
  do not infer a clean hosted advisory report from local test success.
- **Medium, optional AR: physical dish validation.** A licensed, faithful measured
  live dish, iPhone Safari and compatible Android tests remain required. Leave AR
  disabled for the ordering pilot until validated. Desktop previews are not AR
  placement certification.
- **Medium: development dependency advisory.** Full `npm audit` reports five high
  package findings in one lint-only `braces` dependency chain
  ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The
  registry's suggested fix downgrades ESLint/Next configuration to 14.2.35; that
  unrelated downgrade was not applied. Latest compatible braces/micromatch versions
  remain affected. Runtime-only audit reports zero known advisories. Keep CI lint
  inputs trusted and recheck when a compatible upstream fix is available.
- **Low / operational limits:** kitchen snapshots show the oldest 300 active and
  latest 100 completed-today orders, with existing count/limit notices. Tables
  provides paginated historical details. Test planned restaurant volume; no new
  pagination/analytics platform was introduced. Staff provisioning, table creation
  and QR printing remain trusted setup steps, not self-service onboarding.

## Automated and hosted evidence

Baseline: **269/269** tests passed before changes. After targeted regressions:
**276/276** tests passed, including **157 PostgreSQL tests**. TypeScript, ESLint,
`npm run test:db` and the production build passed. Final command results are also
reported in the implementation response. The seven new tests cover hosted
configuration, unsafe origins, security headers, refresh outages, QA credential
separation and real fallback retry behaviour, including root-layout rendering
without the normal layout.

The final targeted credential scan covered 258 committed blobs, 62 built browser
chunks, current working source and 13 pilot log files with zero privileged
Supabase credential findings in those locations. `.env.local` is ignored. This
does not negate the separate browser accessibility-output incident above.
Final validation also passed under Node.js 24.22.0, the deployment target; local
HTTP measurements used Node.js 26 servers. The scanner's format coverage is
limited; it does not detect every third-party secret. Do not put real tokens into
test fixtures or log raw Auth/Storage errors.

**43 actual hosted API/database/WebSocket checks** passed using an isolated QA
restaurant (`pilot-qa-988320ee`), two ordering guests, a third unaffiliated guest and
the existing verified staff account. No Casa Mesa menu/occupied table was changed.
Four real QA orders and their historical snapshots remain in PostgreSQL. Both QA
visits were closed, the restaurant unpublished and its table deactivated. No test
history was deleted. The other QA tenant was an unrelated authorization target.

The hosted run verified:

- Anonymous Auth and the actual bucket's public-read/size/MIME configuration.
- Two concurrent guest orders in one session; duplicate concurrent requests reuse
  one order, trusted modifiers and totals, and correct private ownership.
- Actual new-order events delivered to an already-subscribed staff client; status
  events delivered to each guest for accepted/preparing/ready/served transitions.
- A concurrent staff race commits once and returns STATUS_CONFLICT for the loser.
- Itemized shared values separate pending/accepted amounts; both approved guests
  see dishes, quantities and supplements; cancelled orders do not enter the total.
- Invalid QR and cross-restaurant product rejection, unrelated staff workspace
  denial, immutable client totals and no unaffiliated private Realtime delivery.
- Real confirmation HTTP 200 for the owner and HTTP 404 for another guest; a lost
  committed submission response recovers by the original idempotency key.
- Concurrent bill requests deduplicate; staff receives the request event; both
  guests receive acknowledgement. Closure refuses unfulfilled orders.
- Staff disconnect/reconnect plus authoritative refetch, closure-time guest RLS
  revocation, empty current-history API, old receipt HTTP 404, closed idempotency
  rejection, stale-review rejection and staff historical snapshot preservation.
- A second session starts empty and the same anonymous guest sees only its new visit.

The final build additionally passed authenticated HTTP checks for all five staff
pages and eleven explicit demo routes, real HTTP security-header checks, malformed
upload-origin rejection, genuine image validation/upload, same-key upload retry
and authorized cleanup of the unused file. These are server/API checks, not
interactive browser form or visual tests.

The later credential-migration verification report is
`/private/tmp/restaurant-os-key-revocation-verification.json` (14 passed checks,
including actual WebSocket delivery). It is separate from the original 43-check
ordering lifecycle run; no repeat of that full lifecycle is claimed after rotation.

Reports/logs are in `/private/tmp/restaurant-os-pilot-*.json` and `.log`. No refresh
tokens, passwords or QR list were written to the reports. The harness guard now
requires separate explicit development QA administration; ordinary tests require
no hosted keys. That hosted report's browser and physical-device fields are
explicitly false; the later demo browser checks below are recorded separately.

## Completed native-browser checks

These used Brave and local HTTP demo mode, not physical phones or hosted AR:

- Desktop menu and a valid Table 04 link rendered with restaurant/table context.
- At **320×568**, required bread validation blocked an incomplete selection;
  multiple-choice limits disabled a third extra. Two customized dishes calculated
  correctly at €37.00. The real licensed development ingredient study rendered in
  3D, zoom/reset/rotation controls were operated, and the HTTPS/unsupported-AR
  explanation was honest. Returning to the photo preserved choices and quantity.
- Adding to the bag showed the correct counter and itemized supplements. Reload
  preserved the bag and Table 04; reducing quantity updated the total to €18.50.
  Review displayed that same itemized amount, staff-handled payment wording and
  a disabled “Place Order · Demo preview” control, without a fabricated success.
- At **390×844**, the bag's photo, long product name, customization prices,
  quantity controls, summary and four-tab navigation were visually inspected.
  Subsequent item-removal and navigation attempts could not be verified because
  browser input stopped working. The one demo test dish may remain in that
  browser's local bag; no real order was created by these browser checks.

The small “Photo” wrapping defect above was found during these checks. Empty-bag,
tablet/staff-editor, landscape, keyboard, live UI and post-fix visual checks are
still open. Device emulation does not establish real touchscreen or AR support.

## Performance measurements

Five warm-response samples per page against `next start`, same machine/project,
with no mobile CPU/network throttling. Response duration includes full HTML transfer
and live Supabase work; these are **not** Lighthouse, LCP/INP/CLS or capacity tests.
The after sample overlapped hosted QA, so latency differences are noisy.

- Live menu: median **216ms before / 218ms after**; initial script gzip bytes
  **194,063 / 195,804** (+1,741 bytes, about 0.9%). No latency improvement is claimed.
- Demo menu: **5ms / 6ms**; initial script gzip bytes **194,063 / 196,826**.
- Demo product: **4ms / 6ms**; initial script gzip bytes **201,910 / 204,687**.
- The small script increase adds customer/global recovery boundaries. The initial
  route does not need the 3D engine or GLB. Existing optimized product photography,
  explicit viewer import, model limits and unmount cleanup remain unchanged.

Reproduce with `npm run measure:pages`; preserved numeric results are in
`docs/assets/pilot-performance.json`. Preventing staff prefetch and demo Auth work
avoids unnecessary requests; no unsupported numerical speedup is claimed. Do not
relax five-second private-access checks just to improve a network benchmark.

## Remaining browser and restaurant test procedure

Use an authorized HTTPS staging deployment with separate test data. Open staff
Kitchen/Tables in one browser/device, customer A in another, and customer B in a
separate private profile/device. Two tabs sharing cookies are **not** two guests.
Use printed QR codes and complete the onboarding service rehearsal.

Check customer viewport sizes 320×568, 375×667, 390×844, 430×932, 360×800 and
412×915, plus landscape 667×375 and 844×390. Check staff at 768×1024, 1024×768 and
1440×900. Only the explicitly listed demo checks at 320×568 and 390×844 were
completed; the rest of this matrix remains a test procedure.

- [ ] No horizontal overflow; table/restaurant and all four customer tabs remain
      clear. Check long dish/table names, quantity controls, safe-area clearances and
      small-screen forms. Test portrait/landscape and browser text zoom at 200%.
- [ ] Keyboard skip link, visible focus, radio/checkbox limits, editor tabs/dialog
      focus, error announcements, readable contrast and large touch targets work.
- [ ] Browse/customize/add/edit/remove/refresh and two-tab bag synchronization work.
      Required choices block submission clearly; different selections stay distinct.
- [ ] A changed price requires explicit acceptance, unavailable choices cannot be
      ordered, pause-ordering is clear, and failed submissions preserve the bag.
- [ ] Slow/lost submission responses recover the original key. Double clicks and
      reloads never make a second order or display unconfirmed success.
- [ ] Two guests' orders appear on staff without refresh; prepare/ready/serve,
      concurrent staff actions, bill requests/acknowledgement and closure work.
- [ ] Old receipt URLs, back/forward cache, hidden/offline tabs, previously saved
      retries and the same anonymous identity reveal no closed visit. Staff can still
      retrieve it; a new visit has no earlier items or stale cart/review.
- [ ] Disconnect WebSockets/network, background/sleep a tablet, then reconnect.
      Authoritative reconciliation restores correct state without duplicate notices.
- [ ] Owner/manager editing and real uploads work; staff cannot edit; published
      changes appear to customers and old order snapshots remain unchanged.
- [ ] Broken photos/models and slow/interrupted model downloads preserve ordering.
      Explicit demo produces no Auth requests, subscriptions or successful mutations.

For **actual iPhone Safari and Android Chrome**, additionally use the full
[physical AR procedure](3d-assets.md#local-and-physical-phone-testing): launch real
native/WebXR AR over HTTPS, authorize camera manually, place on a real table,
measure against the dish, move around it and return with choices/quantity/cart
intact. Test denied camera, unsupported hardware, low memory, backgrounding and
embedded scanner fallback. None of these phone checks has been performed here.

## Go/no-go checklist

Use [restaurant onboarding](restaurant-onboarding.md) and
[staging deployment](deployment.md). A named operator must sign off the actual
HTTPS/browser/mobile rehearsal, guest Auth abuse/capacity controls, staff training,
monitoring, backup/restore and rollback before the first controlled service.
Optional AR may remain disabled. No online payment provider, customer profile,
customer historical access or automated production deployment is introduced.
