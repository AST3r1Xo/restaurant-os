# Isolated HTTPS staging and pilot deployment

No deployment or production infrastructure change was performed by Increment 9.
Treat the current development Supabase project as development, never as the pilot
database. Keep online payments permanently outside Restaurant OS.

## 1. Prepare separate resources

1. Create an isolated staging Supabase project and a Vercel project using Node.js
   24 and the Next.js preset. Give staging its own confirmed staff accounts, media
   bucket and QA restaurant. Use test dishes and no real guest information.
2. Give Vercel Preview and Production separate environment scopes. Preview must
   never inherit the development or pilot project's secret. Protect staging
   deployments with Vercel Deployment Protection and give testers normal access.
   Do not embed a protection-bypass token in a QR code, image URL or repository.
3. Use one stable HTTPS staging hostname for printed test QRs. A private Vercel
   deployment does not make published Supabase menus or public Storage private;
   only place public presentation/test content in those resources.

See official [Vercel environments](https://vercel.com/docs/environment-variables)
and [Deployment Protection](https://vercel.com/docs/deployment-protection).

## 2. Configure the environment

Set these in the correct Vercel environment, never in tracked files:

```dotenv
APP_DATA_MODE=live
NEXT_PUBLIC_APP_URL=https://staging.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<staging-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
SUPABASE_EXPECTED_PROJECT_REF=<staging-project-ref>
SUPABASE_SERVICE_ROLE_KEY=<staging server-only media key>
```

The expected project reference is a non-secret safeguard against mixing
environments. Vercel builds require an explicit `live` or `demo` mode, a public
HTTPS origin, and matching live configuration. `auto` remains useful locally and
is rejected on Vercel. An explicitly labelled demonstration deployment can use
`APP_DATA_MODE=demo` without live keys; it cannot create orders or save edits.

Public variables are compiled into browser assets: rebuild after changing them.
Keep the media key server-side in every environment and restart/redeploy after
rotation. It is a broadly privileged project credential, **not** a database-scoped
uploader credential; application code limits its use to validated media operations.
Never give it to staff browsers. Do not add staff test passwords, development
tokens or QA-script configuration to Vercel.

`.env.local`, other `.env*` files except `.env.example`, and `.vercel/` are ignored.
`npm run check:secrets` checks working files, committed blobs and built browser
chunks for privileged Supabase credentials without printing matched values.
For an exact check of the current local secret, use
`node --env-file=.env.local scripts/check-secrets.mjs`. This is a targeted scanner,
not proof that every conceivable credential format is absent.

## 3. Apply and inspect the database

On an explicitly authorized **staging** project, using the supported Supabase CLI:

```sh
npx supabase login
npx supabase link --project-ref <staging-project-ref>
npx supabase db push --dry-run
# Review the target and every pending migration before the next command.
npx supabase db push
npm run db:types
```

Keep CLI access tokens/database passwords in the CLI's protected configuration
or ignored local environment. Never paste them into SQL or chat. Do not run
`db reset` against a hosted project, guess migration history, or use the sample
seed as a real restaurant menu. Vercel builds do not run database migrations.
Provision the restaurant and memberships separately using the onboarding guide.

Review remote migration history against every repository migration; inspect RLS,
SECURITY DEFINER search paths/grants, composite tenant foreign keys, and Realtime
publication membership for `orders`, `table_sessions` and `bill_requests`. Only
staff-authorized functions mutate order status or session state. Private reviews,
participants and audit data must remain inaccessible to API roles.

Increment 9 adds **no database migration**. Its local PostgreSQL suite applies all
existing migrations. The development migration ledger was matched in Increment 8;
fresh hosted catalogue/advisor introspection could not be repeated because the
MCP OAuth connection failed. API denial/ownership and real WebSocket checks were
performed separately. Repeat catalogue/advisor inspection on staging before sign-off.

## 4. Supabase Auth configuration

- Enable anonymous sign-ins and new-user creation needed for guests. Do not disable
  all new users: a first anonymous visit needs an Auth identity. Email-provider
  self-registration can remain disabled while existing provisioned staff sign in.
  The local configuration now expresses that separation.
- Provision confirmed email/password staff through trusted Supabase administration,
  then assign `restaurant_members` through trusted administration. No public
  self-assignment or customer signup screen exists.
- Set Site URL to the staging HTTPS origin. This application uses direct password
  login and anonymous Auth, with **no OAuth, magic-link or password-reset callback**.
  There is no `/auth/callback` route. Do not advertise or allow a fictitious callback.
  If an administrator needs a generic return URL, allow the exact
  `https://staging.example.com/admin/login`. Test staff recovery through trusted
  administration; an in-app email recovery flow is not implemented.
- Keep production redirect lists exact; do not add broad wildcard preview hosts.
  Separate staging has its own exact origin. Local testing can allow
  `http://localhost:3000/admin/login` only in development.
- Confirm Auth rate limits, email confirmation, admin MFA, password policy and
  project access. Do not grant the app new Auth administration privileges.

Supabase recommends CAPTCHA for anonymous signup abuse and documents a default
IP limit of 30 anonymous sign-ins/hour. This app creates guests from the server;
test the actual Vercel egress/restaurant Wi-Fi scenario before sizing limits.
Per-guest/table database order limits do not protect the public Auth signup
endpoint. CAPTCHA integration is **not implemented**; simply enabling CAPTCHA in
Supabase would break existing anonymous/staff sign-in without token handling.
Do not launch an unrestricted public pilot until that abuse-control decision is
implemented and tested. A tightly supervised test is not a public launch.

References: [anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous),
[configuration](https://supabase.com/docs/guides/local-development/cli/config),
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

## 5. Storage and HTTPS

Configure the target bucket using the supported Storage API:

```sh
# Run with only the intended staging project's ignored local configuration.
npm run storage:setup
```

Verify `restaurant-media` is public read, limited to 4,000,000 bytes, and permits
only `image/webp`, `model/gltf-binary` and `model/vnd.usdz+zip`. Confirm migrations
deny direct anonymous/authenticated writes even for owner JWTs. Only the verified
owner/manager media gateway validates, registers and uploads files. Public read
also applies to drafts: never upload confidential content.

Check that every configured photograph/model/poster uses the intended HTTPS
Storage origin and tenant/product folder, with no mixed-content request or signed
credential in the URL. Test native USDZ content type and public fetches. Follow
[3D asset onboarding and physical-phone procedure](3d-assets.md); keep AR disabled
until a real matching dish and physical scale are approved.

Headers prevent framing, sniffing and cross-origin referrer disclosure, including
table-token URLs. They permit same-origin camera/WebXR without requesting camera
permission. HTTPS origins receive HSTS without extending the policy to unrelated
subdomains. CSP currently constrains framing/base/object sources; a strict nonce
`script-src` policy is **not** implemented or claimed.

## 6. Verify and release deliberately

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run test:db
npm run build
npm run check:secrets
npm audit --omit=dev --audit-level=high
```

Then, after an authorized staging deployment, run the browser/device checklist in
[pilot readiness](pilot-readiness.md). Test two independent guest browsers plus a
staff tablet already open, including WebSocket reconnects, uncertain submission
responses, session closure, old receipt URLs and a second visit. Confirm actual
HTTPS certificates and Auth cookie behaviour on real phones. Do not certify
camera placement from HTTP localhost or device emulation.

Before admitting a pilot table, assign a named operator, backup staff device and
manual ordering procedure. The operator must know how to pause new orders in
Settings while completing existing service. Staff accept the correct table's
orders, acknowledge bill requests and close visits promptly. Closing ends guest
access; it never confirms payment. Staff handle all payments outside this app.

Agree on pilot hours, table/guest limits, incident contact, and a rollback build.
Monitor Vercel errors/request duration, Supabase Auth rate errors, database health,
Realtime reconnects and order arrival delays. Do not log QR tokens, request bodies,
cookies or credentials; use safe error codes/order references when investigating.
Configure and test the selected Supabase backup/restore policy with an operator.
No backup, restore, hosting change or automated deployment is performed here.

For rollback, pause new orders, preserve the database and serve existing orders
manually if necessary. Roll back the Vercel build only to a schema-compatible
version; never reverse a migration by dropping historical records. Re-test guest
privacy and staff access before reopening ordering.
