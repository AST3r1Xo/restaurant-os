import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const r = "11111111-1111-4111-8111-111111111111",
  c = "33333333-3333-4333-8333-333333333331",
  p = "44444444-4444-4444-8444-444444444441";
const owner = randomUUID(),
  manager = randomUUID(),
  staff = randomUUID(),
  outsider = randomUUID(),
  guest = randomUUID(),
  other = randomUUID();
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema public,auth to anon,authenticated,service_role;create publication supabase_realtime;
 create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant all on storage.objects to anon,authenticated;create policy broad_existing_upload on storage.objects for all to authenticated using(true) with check(true);`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  for (const id of [owner, manager, staff, outsider, guest])
    await db.query("insert into auth.users values($1)", [id]);
  for (const [id, role] of [
    [owner, "owner"],
    [manager, "manager"],
    [staff, "staff"],
    [guest, "owner"],
  ])
    await db.query(
      "insert into public.restaurant_members(restaurant_id,user_id,role) values($1,$2,$3)",
      [r, id, role],
    );
  await db.query(
    "insert into public.restaurants(id,slug,name)values($1,'other-admin','Other')",
    [other],
  );
});
after(() => db.close());
async function as(id, fn, anonymous = false, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [id, JSON.stringify({ sub: id, is_anonymous: anonymous })],
    );
    await db.exec(`set local role ${role}`);
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function workspace(id = owner, restaurant = r) {
  return as(
    id,
    async () =>
      (await db.query("select public.menu_workspace($1) w", [restaurant]))
        .rows[0].w,
  );
}
function definition(product) {
  return {
    name: product.name,
    description: product.description,
    category_id: product.category_id,
    price_minor: product.price_minor,
    ingredients: product.ingredients,
    allergens: product.allergens,
    dietary_tags: product.dietary_tags,
    is_available: product.is_available,
    status: product.archived_at
      ? "archived"
      : product.is_published
        ? "published"
        : "draft",
    keep_legacy_image: true,
    image_asset_id: product.image_asset_id,
    model_asset_id: product.model_asset_id,
    model_usdz_asset_id: product.model_usdz_asset_id,
    model_poster_asset_id: product.model_poster_asset_id,
    model_verified: product.model_verified,
    model_ar_enabled: product.model_ar_enabled,
    review: product.review,
    groups: product.groups,
  };
}
async function save(id, product, changes = {}) {
  return as(id, () =>
    db.query("select public.save_menu_product($1,$2,$3,$4)", [
      r,
      product.id,
      product.created_at ? product.updated_at : null,
      JSON.stringify({ ...definition(product), ...changes }),
    ]),
  );
}
const product = async () =>
  (await workspace()).products.find((x) => x.id === p);
test("owners and managers read the editor; staff, guests and outsiders cannot", async () => {
  assert.equal((await workspace()).restaurant.id, r);
  assert.equal((await workspace(manager)).restaurant.id, r);
  for (const id of [staff, outsider])
    await assert.rejects(workspace(id), /MANAGER_REQUIRED|STAFF_FORBIDDEN/);
  await assert.rejects(
    as(guest, () => db.query("select public.menu_workspace($1)", [r]), true),
    /STAFF_REQUIRED/,
  );
  await assert.rejects(workspace(owner, other), /STAFF_FORBIDDEN/);
});
test("direct catalog writes and forged model registry writes are denied even to managers", async () => {
  for (const id of [owner, manager, staff, guest])
    await assert.rejects(
      as(id, () =>
        db.query("update public.products set price_minor=1 where id=$1", [p]),
      ),
      /permission denied/,
    );
  await assert.rejects(
    as(owner, () =>
      db.query(
        "insert into public.menu_media_assets(id)values(gen_random_uuid())",
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    as(owner, () =>
      db.query("select public.register_menu_media($1,$2,null,$3,'logo','{}')", [
        owner,
        r,
        randomUUID(),
      ]),
    ),
    /permission denied/,
  );
});
test("category create, edit, unpublish and concurrency checks", async () => {
  const id = randomUUID();
  await as(manager, () =>
    db.query("select public.save_menu_category($1,$2,null,$3)", [
      r,
      id,
      JSON.stringify({
        name: "Admin category",
        description: "A thoughtful selection",
        is_active: true,
      }),
    ]),
  );
  const category = (await workspace()).categories.find((x) => x.id === id);
  await as(owner, () =>
    db.query("select public.save_menu_category($1,$2,$3,$4)", [
      r,
      id,
      category.updated_at,
      JSON.stringify({
        name: "Admin category",
        description: "Updated",
        is_active: false,
      }),
    ]),
  );
  await assert.rejects(
    as(owner, () =>
      db.query("select public.save_menu_category($1,$2,$3,$4)", [
        r,
        id,
        category.updated_at,
        JSON.stringify({ name: "Stale", description: "", is_active: true }),
      ]),
    ),
    /MENU_CONFLICT/,
  );
  assert.equal(
    (await workspace()).categories.find((x) => x.id === id).is_active,
    false,
  );
});
test("create a draft product and publish/edit its existing identifier", async () => {
  const existing = await product(),
    id = randomUUID();
  await save(
    owner,
    { ...existing, id, created_at: "", groups: [] },
    { name: "Independent dish", status: "draft" },
  );
  const draft = (await workspace()).products.find((x) => x.id === id);
  assert.equal(draft.is_published, false);
  await save(manager, draft, {
    name: "Independent dish edited",
    price_minor: 1299,
    status: "published",
    ingredients: ["Tomato"],
    allergens: ["Milk"],
  });
  const updated = (await workspace()).products.find((x) => x.id === id);
  assert.equal(updated.price_minor, 1299);
  assert.equal(updated.is_published, true);
  assert.deepEqual(updated.ingredients, ["Tomato"]);
});
test("price changes preserve historical order snapshots", async () => {
  const order = randomUUID(),
    user = guest;
  await db.query(
    "insert into public.orders(id,restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor)values($1,$2,$3,$4,'EUR',1400,1400)",
    [order, r, "22222222-2222-4222-8222-222222222221", user],
  );
  await db.query(
    "insert into public.order_items(restaurant_id,order_id,product_id,product_name,unit_price_minor,quantity)values($1,$2,$3,'Original dish',1400,1)",
    [r, order, p],
  );
  await save(owner, await product(), { price_minor: 1500 });
  const snapshot = (
    await db.query(
      "select product_name,unit_price_minor from public.order_items where order_id=$1",
      [order],
    )
  ).rows[0];
  assert.deepEqual(snapshot, {
    product_name: "Original dish",
    unit_price_minor: 1400,
  });
});
test("optimistic locking rejects stale changes without losing current data", async () => {
  const old = await product();
  await save(owner, old, { price_minor: 1600 });
  await assert.rejects(save(manager, old, { price_minor: 1 }), /MENU_CONFLICT/);
  assert.equal((await product()).price_minor, 1600);
});
test("atomic modifier updates support stable IDs, required choices and price supplements", async () => {
  const g = randomUUID(),
    o = randomUUID();
  await save(owner, await product(), {
    groups: [
      {
        id: g,
        name: "Bread QA",
        description: "",
        selection_type: "single",
        min_selections: 1,
        max_selections: 1,
        is_active: true,
        options: [
          {
            id: o,
            name: "Brioche QA",
            price_adjustment_minor: 50,
            is_available: true,
          },
        ],
      },
    ],
  });
  const current = await product(),
    group = current.groups.find((x) => x.id === g);
  assert.equal(group.options[0].id, o);
  assert.equal(group.options[0].price_adjustment_minor, 50);
  const groups = current.groups.map((x) => ({
    ...x,
    options: x.options.map((y) => ({
      ...y,
      price_adjustment_minor: y.id === o ? 100 : y.price_adjustment_minor,
    })),
  }));
  await save(owner, current, { groups });
  assert.equal(
    (await product()).groups.find((x) => x.id === g).options[0]
      .price_adjustment_minor,
    100,
  );
});
test("invalid modifier changes roll back the entire product update", async () => {
  const current = await product();
  for (const changes of [
    { min_selections: 2, max_selections: 1 },
    { selection_type: "single", max_selections: 2 },
    { min_selections: 1, options: [] },
  ]) {
    const group = { ...current.groups.find((x) => x.is_active), ...changes };
    await assert.rejects(
      save(owner, current, { name: "Must roll back", groups: [group] }),
      /MODIFIERS_INVALID/,
    );
    assert.equal((await product()).name, current.name);
  }
});
test("cross-product and cross-restaurant modifier IDs cannot be reassigned", async () => {
  const current = await product(),
    otherProduct = (await workspace()).products.find((x) => x.id !== p),
    foreignGroup = otherProduct.groups[0];
  if (foreignGroup)
    await assert.rejects(
      save(owner, current, { groups: [foreignGroup] }),
      /MODIFIERS_INVALID/,
    );
  const badCategory = randomUUID();
  await db.query(
    "insert into public.menu_categories(id,restaurant_id,name)values($1,$2,'Other category')",
    [badCategory, other],
  );
  await assert.rejects(
    save(owner, current, { category_id: badCategory }),
    /CATEGORY_INVALID/,
  );
});
test("product archiving keeps IDs, hides public menu and rejects order review", async () => {
  await save(owner, await product(), { status: "archived" });
  assert.ok((await product()).archived_at);
  assert.equal(
    (
      await as(
        guest,
        () => db.query("select id from public.products where id=$1", [p]),
        true,
      )
    ).rows.length,
    0,
  );
  const token = (
    await db.query("select qr_token from public.dining_tables where id=$1", [
      "22222222-2222-4222-8222-222222222221",
    ])
  ).rows[0].qr_token;
  await assert.rejects(
    as(
      guest,
      () =>
        db.query(
          "select public.review_visit_order($1,$2,$3,(select visit_key from public.resolve_table_visit($1,$2)))",
          [
            "mesa",
            token,
            JSON.stringify([{ productId: p, quantity: 1, optionIds: [] }]),
          ],
        ),
      true,
    ),
    /PRODUCT_UNAVAILABLE/,
  );
  await save(owner, await product(), { status: "draft" });
  assert.equal((await product()).archived_at, null);
});
test("invalid prices, quantities of choices and availability cannot bypass RPC validation", async () => {
  const current = await product();
  for (const changes of [
    { price_minor: -1 },
    { price_minor: 1.5 },
    { price_minor: 1000001 },
    { ingredients: ["x".repeat(121)] },
  ])
    await assert.rejects(save(owner, current, changes), /MENU_INVALID/);
  await save(owner, current, { is_available: false });
  assert.equal((await product()).is_available, false);
});
test("category and product reordering persist without arbitrary sort payloads", async () => {
  await as(owner, () =>
    db.query("select public.move_menu_entry($1,$2,'product',1)", [r, p]),
  );
  await as(owner, () =>
    db.query("select public.move_menu_entry($1,$2,'category',1)", [r, c]),
  );
  await assert.rejects(
    as(staff, () =>
      db.query("select public.move_menu_entry($1,$2,'category',1)", [r, c]),
    ),
    /MANAGER_REQUIRED/,
  );
  await assert.rejects(
    as(owner, () =>
      db.query("select public.move_menu_entry($1,$2,'category',9)", [r, c]),
    ),
    /MENU_INVALID/,
  );
});
let asset;
async function register(
  id,
  changes = {},
  actor = owner,
  restaurant = r,
  product = p,
  kind = "glb",
  ready = true,
) {
  return as(
    actor,
    async () =>
      (
        await db.query(
          "select public.register_menu_media($1,$2,$3,$4,$5,$6,$7) a",
          [
            actor,
            restaurant,
            product,
            id,
            kind,
            JSON.stringify({
              sha256: "a".repeat(64),
              byte_size: 100,
              content_type: "model/gltf-binary",
              dimensions_m: [0.2, 0.05, 0.2],
              public_base:
                "https://test.supabase.co/storage/v1/object/public/restaurant-media/",
              ...changes,
            }),
            ready,
          ],
        )
      ).rows[0].a,
    false,
    "service_role",
  );
}
test("only trusted server can register validated, tenant-scoped, immutable media", async () => {
  asset = await register(randomUUID());
  assert.equal(asset.state, "ready");
  assert.match(
    asset.object_path,
    new RegExp(`^restaurants/${r}/products/${p}/models/`),
  );
  assert.equal((await register(asset.id)).id, asset.id);
  await assert.rejects(
    register(asset.id, { sha256: "b".repeat(64) }),
    /ASSET_INVALID/,
  );
  await assert.rejects(register(randomUUID(), {}, staff), /MANAGER_REQUIRED/);
  await assert.rejects(
    register(randomUUID(), {}, owner, other),
    /MANAGER_REQUIRED/,
  );
});
test("unverified model stays disabled; review and AR require documented human checks", async () => {
  await save(owner, await product(), { model_asset_id: asset.id });
  assert.equal((await product()).model_verified, false);
  await assert.rejects(
    save(owner, await product(), { model_ar_enabled: true }),
    /MODEL_REVIEW_REQUIRED/,
  );
  await assert.rejects(
    save(owner, await product(), {
      model_verified: true,
      review: { confirmed: true },
    }),
    /MODEL_REVIEW_REQUIRED|not-null/,
  );
  await save(owner, await product(), {
    model_verified: true,
    model_ar_enabled: true,
    review: {
      license: "Owned",
      provenance: "Scanned actual dish",
      measurement_notes: "Measured 20 x 5 x 20 cm; GLB and USDZ match.",
      confirmed: true,
    },
  });
  assert.equal((await product()).model_ar_enabled, true);
});
test("unverified model provenance and measurement drafts persist without enabling 3D or AR", async () => {
  await save(owner, await product(), {
    model_verified: false,
    model_ar_enabled: false,
    review: {
      license: "Draft license",
      provenance: "Draft source",
      measurement_notes: "Measurements still being checked",
      confirmed: false,
    },
  });
  const saved = await product();
  assert.equal(saved.model_verified, false);
  assert.equal(saved.model_ar_enabled, false);
  assert.equal(saved.review.license, "Draft license");
  assert.equal(
    saved.review.measurement_notes,
    "Measurements still being checked",
  );
});

test("replacing a model cannot reuse a foreign product asset or delete a referenced asset", async () => {
  await assert.rejects(
    as(owner, () =>
      db.query("select public.retire_menu_media($1,$2)", [r, asset.id]),
    ),
    /ASSET_IN_USE/,
  );
  const otherProduct = (await workspace()).products.find((x) => x.id !== p);
  await assert.rejects(
    save(owner, otherProduct, { model_asset_id: asset.id }),
    /ASSET_INVALID/,
  );
  const newAsset = await register(randomUUID());
  await save(owner, await product(), {
    model_asset_id: newAsset.id,
    model_verified: false,
    model_ar_enabled: false,
  });
  assert.equal(
    (
      await as(owner, () =>
        db.query("select public.retire_menu_media($1,$2) a", [r, asset.id]),
      )
    ).rows[0].a.state,
    "deleting",
  );
  await assert.rejects(
    save(owner, await product(), { model_asset_id: asset.id }),
    /ASSET_INVALID/,
  );
});
test("storage rejects direct public/owner/staff uploads despite broad pre-existing policies", async () => {
  for (const id of [owner, manager, staff, guest])
    await assert.rejects(
      as(id, () =>
        db.query(
          "insert into storage.objects(bucket_id,name)values('restaurant-media','evil.glb')",
        ),
      ),
      /row-level security/,
    );
  await db.query(
    "insert into storage.objects(bucket_id,name)values('restaurant-media','protected.glb')",
  );
  assert.equal(
    (
      await as(owner, () =>
        db.query(
          "delete from storage.objects where bucket_id='restaurant-media' returning id",
        ),
      )
    ).rows.length,
    0,
  );
});
test("restaurant presentation changes are optimistic and manager-only", async () => {
  const current = (await workspace()).restaurant,
    def = {
      name: "New public name",
      description: "New description",
      timezone: "Europe/Lisbon",
      is_published: true,
      is_accepting_orders: false,
      logo_asset_id: null,
      cover_asset_id: null,
      keep_legacy_logo: true,
      keep_legacy_cover: true,
    };
  await as(manager, () =>
    db.query("select public.save_restaurant_presentation($1,$2,$3)", [
      r,
      current.updated_at,
      JSON.stringify(def),
    ]),
  );
  assert.equal((await workspace()).restaurant.name, def.name);
  await assert.rejects(
    as(staff, () =>
      db.query("select public.save_restaurant_presentation($1,$2,$3)", [
        r,
        current.updated_at,
        JSON.stringify(def),
      ]),
    ),
    /MANAGER_REQUIRED/,
  );
  await assert.rejects(
    as(owner, () =>
      db.query("select public.save_restaurant_presentation($1,$2,$3)", [
        r,
        current.updated_at,
        JSON.stringify(def),
      ]),
    ),
    /MENU_CONFLICT/,
  );
});
