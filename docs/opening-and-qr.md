# Manual service control and table QR cards

Restaurant OS has one manual operational state: the existing
`restaurants.is_accepting_orders` flag. **OPEN** accepts new visits and orders;
**CLOSED** pauses both. Menu publication is separate. Closing service never closes
a dining session, changes an order, confirms payment or revokes an existing
current-visit guest's tracking/bill access. Staff finish service normally and close
visits independently. Online payments remain permanently excluded.

## Owner workflow

Sign in at `/admin/login` and select the correct restaurant. Every administration
page shows OPEN or CLOSED. Owners/managers can choose **Close restaurant** or
**Open restaurant**, review the explanation and confirm. Ordinary staff see the
state but cannot change it. A conflicting update requires a refresh.

In **Settings**, configure branding, restaurant-local time zone and optional
**Opening hours** text. Save it before testing the closed screen. An empty hours
field is simply omitted; the app never invents operating hours. Keep the menu
published if QR visitors should see the branded closed screen rather than an
unpublished restaurant response.

A new QR visitor to a closed restaurant sees its photograph/name/logo, closed
message and configured hours, with HTTP 200. Use **Check opening status** to
request the latest service state while preserving the table link. Current-visit guests with orders also
receive links to Current orders and Table bill. Protected receipts, tracking,
bill requests, acknowledgement and kitchen transitions retain their existing
ownership/session authorization. Closed service refuses new order reviews and
creations in PostgreSQL; recovery of an already committed current-visit order is
still safe and idempotent. Reopening restores normal ordering. Previously ended
visits never become accessible again.

Opening hours are display text, not a scheduler. The stored IANA timezone remains
the basis for operating dates. A future scheduling increment should introduce
local weekday intervals (including overnight intervals), dated exceptions and an
explicit manual override with precedence. Do not infer automated opening from this
text or use the server timezone. No automatic schedule is implemented here.

## Casa Mesa's five tables

Customer-facing active tables are Table 01, Table 02, Table 03, Table 04 and
Table 05. Existing labels, IDs and QR tokens are reused. Missing tables receive
PostgreSQL-generated UUIDs/tokens. Historical orders and sessions remain attached
to their original tables; unrelated old test tables are retained inactive.

The versioned five-table migration targets Casa Mesa's stable development seed
identity and slug; an unrelated restaurant named Mesa is not reconfigured.
It refuses to displace an occupied extra table. Seeds create the same five labels
without replacing existing data or tokens. An inactive legacy test table may still
appear in the staff operations list; it has no customer-facing exported QR card.

## Configure, download and print

1. Configure `NEXT_PUBLIC_APP_URL` with the stable public **HTTPS origin** that
   will serve this restaurant, for example your actual staging domain. Restart
   locally and rebuild on deployment when public environment values change.
   An address with credentials, a path, query, fragment, IP or local hostname is
   rejected. The app never invents a deployment address or prints localhost codes.
2. In **Tables → Table QR codes**, choose **View table codes**. Each authorized
   preview is generated from the current token and verified restaurant slug.
3. Download one high-resolution PNG, **all active QR codes (.zip)**, or the
   **print-ready cards (.pdf)**. Casa Mesa's five active tables fit on one A4 sheet.
   PDFs support up to six cards per page, with additional pages when required.
4. Print at **100% / actual size** on white paper or card. Keep the four-module
   quiet zone around each black/white code; avoid cropping, logos over the code,
   reflective lamination and print scaling that makes codes too small. Each QR
   image is 1024 square pixels; PDF placement is approximately 51 mm square.
5. Cut on the light card borders and test every printed card with a physical
   phone. Confirm the actual HTTPS host, restaurant and table label before service.
   Generated-image/PDF decoding is automated QA, not physical print certification.

The name, table and “Scan to explore & order” instruction appear on every card.
PDF typography currently supports Latin-script names supported by standard PDF
fonts; overly long or unsupported names require a shorter compatible display name.
The on-screen application retains Unicode names normally.

Without a stable origin, management shows an explicit configuration warning and
disables previews/download links. The endpoint independently rejects the export.
Do not distribute the synthetic `layout-qa.example.com` visual-QA sheet: it is a
temporary test artifact and never represents a working restaurant URL.

## Rotation and security

Only authenticated, confirmed owners/managers in the selected restaurant can
access QR exports, list tokens through the manager RPC, or replace a code. Staff
can read operational table labels but cannot directly select QR tokens. Guests
cannot enumerate table records. Each export is authenticated again and marked
private/no-store; QR/PDF/ZIP generation runs only on the server. Tokens are not
included in the staff page's React props, menu queries or logs.

Choose **Replace code**, review the warning and confirm. Replacement generates a
fresh token in PostgreSQL and invalidates old printed links. Reprint that card.
Rotation is blocked during an active visit; finish service and close the visit
first. Tenant checks, row/advisory locks and expected-version checks protect
concurrent updates. Direct API writes to tokens are denied, including for owners.
Rotation never edits historical orders or grants guest order ownership. A QR is a
table identifier, never customer authentication.

## Database and local validation

Both new migrations are applied to the authorized development project and their
versions match the repository. Apply them to a separate environment before
running the updated live app there:

- `20261016100007_opening_control_and_table_qr.sql`: display hours, manager-only
  opening/QR functions, narrower table grants and the session-insertion guard.
- `20261016100017_five_casa_mesa_tables.sql`: non-destructive demonstration setup.

The existing trusted price builder already locks and checks the restaurant flag.
The new insertion trigger also takes a restaurant share lock, serializing new
sessions with closing. All definer functions have fixed empty search paths and
narrow authenticated grants. Existing guest RLS, historical access revocation,
order snapshots, tenant foreign keys and persistent idempotency remain intact.
No privileged application media key is used for metadata or migration access.

Run:

```sh
npm test
npm run typecheck
npm run lint
npm run test:db
npm run build
npm run check:secrets
```

`npm run test:opening` targets opening/session authorization and independent QR
image decoding, ZIP contents, A4 pagination and invalid-origin rejection. The full
database suite now includes these opening tests.

The optional hosted workflow uses ordinary owner/guest authorization and an
**existing isolated, unpublished `pilot-qa-*` restaurant**. It never performs
lifecycle tests on Casa Mesa or uses a privileged setup credential:

```sh
CONFIRM_OPENING_QA=development \
OPENING_QA_PROJECT_REF=<development-project-ref> \
OPENING_QA_RESTAURANT_ID=<existing-isolated-pilot-qa-id> \
node --env-file=.env.local scripts/verify-opening-control.mjs
```

It deliberately retains one real verification order/session, restores the QA
restaurant's presentation/status and table activity, and reports safe results to
`/private/tmp/restaurant-os-opening-live.json`. It checks actual branded closed
HTTP responses, rejected orders, continuing kitchen/bill operations, reopening,
rotation, historical privacy and the five real Casa Mesa token resolutions.
No browser/device verification is implied by this script.

## Current verification record

- **292/292 automated tests passed**, including **167 PostgreSQL tests**.
  TypeScript, ESLint and the production build passed under Node.js 24.22.0.
  The runtime dependency audit reports zero known vulnerabilities; the existing
  lint-only advisory remains documented in the pilot audit.
- Casa Mesa's three missing tables were created through the verified owner account;
  there are exactly five active tables, with all existing table IDs/tokens and
  historical orders/sessions preserved.
- All five actual development QR tokens were individually resolved through the
  public table-visit resolver and rejected under another restaurant slug. Their
  values were kept out of tool output.
- A synthetic five-card A4 PDF was rendered and visually inspected. Independent
  barcode decoding recovered all five exact test URLs from its rendered page.
- The demo dashboard passed HTTP checks for the five table labels, opening badge,
  missing-HTTPS warning and disabled real exports. React server-rendering tests
  cover the branded closed message, optional hours and authorized service links.
  Native browser input was unavailable; no complete new interactive browser or
  physical print/phone verification is claimed.
- Both migrations were applied through the reconnected Supabase MCP on
  **16 October 2026**. **19 hosted API/HTTP checks passed** using ordinary owner
  and anonymous guest sessions in the isolated pilot QA restaurant. They created
  a real customized order, verified branded closed responses, denied new orders
  and sessions while closed, recovered the original committed order, completed
  kitchen/bill operations, revoked access after visit closure and restored the
  open menu. QR replacement invalidated the old unused QA token; all five Casa
  Mesa codes resolved correctly and unauthenticated exports were denied.
- Independent database inspection confirmed the safe function search paths and
  grants, enabled session guard, blocked direct token reads and exactly five
  active Casa Mesa tables. The isolated QA restaurant was restored to unpublished
  and closed with its table inactive; its verification order and closed session
  remain in restaurant history. No production resources or Vercel deployment
  were changed. This is API/HTTP evidence, not interactive browser/device testing.
- The owner confirmed the application is not hosted yet. A stable public origin
  is not configured, so working permanent QR files have not been issued and
  printing remains disabled. Configure the actual HTTPS host before printing
  real table cards; no deployment was authorized or performed.
