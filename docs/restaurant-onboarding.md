# First restaurant pilot checklist

Use this with the restaurant owner and a technical operator. Tick items only after
checking the actual pilot environment. Restaurant OS records orders and service;
employees handle every payment independently. No customer accounts or prior-visit
history are available.

## Technical operator: prepare the restaurant

- [ ] Follow [the staging/deployment guide](deployment.md), select the intended
      isolated project and HTTPS hostname, and verify database/security configuration.
- [ ] Create a confirmed owner email/password identity using trusted Supabase
      administration. Give the owner their credentials privately; never store a
      password in SQL, a QR or documentation. Verify the UUID belongs to a confirmed,
      non-anonymous staff identity.
- [ ] Create the restaurant and owner membership using trusted administration.
      Set its currency and IANA time zone correctly before orders exist. Start with
      publication and ordering disabled. The template below refuses an existing slug.
- [ ] Create real physical tables with unique labels. Let PostgreSQL generate
      cryptographically random QR tokens. Do not copy demo fixture tokens.
- [ ] Provision each employee separately, then assign only the required role:
      owner/manager edits menus/settings; staff operates kitchen/tables. Test a staff
      login and confirm it cannot edit the menu or another restaurant.

Example **trusted administrator SQL**, after replacing the two placeholders and
reviewing the project. It is setup data, not a schema migration, and is never run
automatically by a Vercel build:

```sql
begin;
do $$
declare
  owner_uid uuid := '00000000-0000-0000-0000-000000000000'; -- REPLACE
  restaurant_slug text := 'replace-with-restaurant-slug'; -- REPLACE
  restaurant_id uuid;
begin
  if owner_uid = '00000000-0000-0000-0000-000000000000'
     or restaurant_slug = 'replace-with-restaurant-slug' then
    raise exception 'Replace the setup placeholders before running';
  end if;
  if not exists (select 1 from auth.users where id=owner_uid
    and not is_anonymous and email_confirmed_at is not null) then
    raise exception 'A confirmed, non-anonymous owner is required';
  end if;
  if exists(select 1 from public.restaurants where slug=restaurant_slug) then
    raise exception 'Restaurant already exists; inspect it instead of overwriting';
  end if;
  insert into public.restaurants(slug,name,currency,timezone,is_published,is_accepting_orders)
    values(restaurant_slug,'Replace with restaurant name','EUR','Europe/Lisbon',false,false)
    returning id into restaurant_id;
  insert into public.restaurant_members(restaurant_id,user_id,role)
    values(restaurant_id,owner_uid,'owner');
  insert into public.dining_tables(restaurant_id,label)
    select restaurant_id,'Table '||lpad(n::text,2,'0') from generate_series(1,4) n;
end $$;
commit;
```

Adjust the name, currency, zone and table count before execution. Do not use
service credentials in SQL. For additional staff, the trusted administrator adds
a membership using the verified restaurant/user UUID and explicit role. There is
no self-service invitation, table-creation or QR-printing UI in this increment.

## Owner or manager: prepare the menu

- [ ] Sign in at `/admin/login` and confirm the correct restaurant in the switcher.
- [ ] Open **Settings**. Check display name, description, branding and time zone.
      Publication and accepting orders are separate controls.
- [ ] Open **Menu**. Create/publish categories and put them in service order.
- [ ] Add dishes as drafts. Check the displayed price, description, ingredients,
      availability and allergens with the kitchen. Do not assume missing allergen
      information means a dish is safe for every customer.
- [ ] Configure required choices and optional extras. Check minimum/maximum counts,
      supplements and availability. Make sure every required group has enough choices.
- [ ] Upload real photographs and inspect their crop on a phone. Save after upload.
- [ ] If using 3D, obtain a licensed scan of the actual plated dish; upload, preview,
      record provenance/measurements and perform the physical-phone checks before
      enabling AR. Ordering must work without 3D. Leave AR off if validation is pending.
- [ ] Publish dishes and categories, then publish the restaurant. Check the public
      menu before enabling orders. Archive old dishes instead of deleting history.

## Prepare and print table QR codes

- [ ] The technical operator privately retrieves only the intended restaurant's
      table labels/tokens using trusted administration. Construct each URL as
      `https://<pilot-host>/r/<restaurant-slug>?table=<that-table-qr-token>`.
- [ ] Generate QR graphics locally with a trusted offline tool. Do not upload
      table tokens to a public QR-generator website or URL shortener.
- [ ] Print the restaurant name, physical table label and a readable menu URL below
      each QR. Use a matte, high-contrast print with the generator's quiet margin.
- [ ] Scan the **printed** code from iPhone Safari and Android Chrome at the table.
      Confirm restaurant/table, correct HTTPS hostname and no expired preview URL.
      Open in the full browser if an embedded scanner browser cannot order safely.
- [ ] Keep table labels physically matched to their codes. Replace a damaged code
      deliberately; staff should not reuse one table's code on another table.

## Practice one complete service before opening

- [ ] Enable ordering for the supervised test; have a logged-in staff tablet open
      on **Kitchen**. Two people scan the same QR in independent browser sessions.
- [ ] Each customizes and submits an order. Check quantity, supplements, confirmed
      total and table. A repeated submission must produce one order.
- [ ] Confirm both new orders arrive on the tablet without refreshing. Accept each
      guest's first order after verifying the physical table.
- [ ] Both guests can now see the same itemized **Table bill**; each person's
      **Current orders** remains private. Pending and accepted values are distinct;
      cancelled items are excluded from recorded order value.
- [ ] Move both orders through preparing → ready → served; confirm guest status
      updates automatically. Test another staff device acting on the same order.
- [ ] Request the bill. Confirm a staff notification, acknowledge it, and verify
      the guests see acknowledgement. Handle the actual bill/payment outside the app.
- [ ] Close the visit in **Tables**. The guests must lose their old bill, Current
      orders and direct receipt URLs. An unsubmitted bag must not enter the next visit.
- [ ] Start a second visit at the same table. It must begin empty. Staff can still
      inspect the first visit and its immutable dishes/customizations/prices.
- [ ] Disconnect/reconnect the tablet and a phone. Verify recovery without duplicate
      orders. Practice pausing new ordering in Settings and manually taking an order.

## Service-day sign-off

- [ ] A named supervisor accepts responsibility for starting/closing visits and
      monitoring the kitchen. Keep a backup charged tablet and an agreed manual flow.
- [ ] Complete the browser/phone checklist in [pilot readiness](pilot-readiness.md).
      Check restaurant Wi-Fi, mobile data, brightness, touch controls and printer output.
- [ ] Resolve anonymous Auth abuse/rate-limit controls for the actual guest volume.
- [ ] Record pilot hours/table limits, support contact, rollback plan and a tested
      backup/restore procedure. Confirm staff understand recorded value is not payment.
- [ ] Admit the first pilot tables only after remaining release blockers are signed
      off. No automated deployment or production change is authorized by this checklist.
