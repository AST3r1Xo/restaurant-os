import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ids = {
  restaurant: "11111111-1111-4111-8111-111111111111",
  table: "22222222-2222-4222-8222-222222222221",
  product: "44444444-4444-4444-8444-444444444441",
  pasta: "44444444-4444-4444-8444-444444444442",
  guest: "10000000-0000-4000-8000-000000000001",
  otherGuest: "10000000-0000-4000-8000-000000000002",
  registered: "10000000-0000-4000-8000-000000000003",
  otherRestaurant: "20000000-0000-4000-8000-000000000001",
  otherTable: "20000000-0000-4000-8000-000000000002",
  otherCategory: "20000000-0000-4000-8000-000000000003",
  otherProduct: "20000000-0000-4000-8000-000000000004",
  otherGroup: "20000000-0000-4000-8000-000000000005",
  otherOption: "20000000-0000-4000-8000-000000000006",
};
const options = {};
let token;
let otherToken;

before(async () => {
  // Supabase verifies these JWT claims before PostgreSQL receives a request.
  // The harness supplies that contract while running the real migration SQL.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    create publication supabase_realtime;
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(
    await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"),
  );
  await db.query(
    "update public.restaurants set is_accepting_orders=true where id=$1",
    [ids.restaurant],
  );
  await db.query(
    "insert into auth.users(id, is_anonymous) values ($1,true),($2,true),($3,false)",
    [ids.guest, ids.otherGuest, ids.registered],
  );
  await db.query(
    "insert into public.restaurants(id,slug,name,is_published,is_accepting_orders) values ($1,'other','Other Restaurant',true,true)",
    [ids.otherRestaurant],
  );
  await db.query(
    "insert into public.dining_tables(id,restaurant_id,label) values ($1,$2,'Table 09')",
    [ids.otherTable, ids.otherRestaurant],
  );
  await db.query(
    "insert into public.menu_categories(id,restaurant_id,name) values ($1,$2,'Other category')",
    [ids.otherCategory, ids.otherRestaurant],
  );
  await db.query(
    "insert into public.products(id,restaurant_id,category_id,name,price_minor) values ($1,$2,$3,'Other product',1000)",
    [ids.otherProduct, ids.otherRestaurant, ids.otherCategory],
  );
  await db.query(
    "insert into public.product_modifier_groups(id,restaurant_id,product_id,name,min_selections,max_selections) values ($1,$2,$3,'Other required group',1,1)",
    [ids.otherGroup, ids.otherRestaurant, ids.otherProduct],
  );
  await db.query(
    "insert into public.modifier_options(id,restaurant_id,group_id,name,price_adjustment_minor) values ($1,$2,$3,'Other option',100)",
    [ids.otherOption, ids.otherRestaurant, ids.otherGroup],
  );
  for (const row of (
    await db.query(
      "select o.id,o.name,g.name as group_name from public.modifier_options o join public.product_modifier_groups g on g.id=o.group_id where o.restaurant_id=$1",
      [ids.restaurant],
    )
  ).rows) {
    options[`${row.group_name}:${row.name}`] = row.id;
  }
  token = (
    await db.query("select qr_token from public.dining_tables where id=$1", [
      ids.table,
    ])
  ).rows[0].qr_token;
  otherToken = (
    await db.query("select qr_token from public.dining_tables where id=$1", [
      ids.otherTable,
    ])
  ).rows[0].qr_token;
});

after(async () => {
  await db.close();
});

async function identify(
  userId = ids.guest,
  anonymous = true,
  role = "authenticated",
) {
  assert.ok(["authenticated", "anon"].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      userId ?? "",
      JSON.stringify(
        userId ? { sub: userId, role, is_anonymous: anonymous } : { role },
      ),
    ],
  );
}

async function transaction(callback) {
  await db.exec("begin");
  try {
    return await callback();
  } finally {
    await db.exec("rollback");
  }
}

async function ownerQuery(sql, params = []) {
  await db.exec("reset role");
  return db.query(sql, params);
}

function eggs(quantity = 2, selected = undefined) {
  return {
    productId: ids.product,
    quantity,
    optionIds: selected ?? [
      options["Your bread:Toasted brioche"],
      options["A little extra:Avocado"],
    ],
  };
}

function pasta(quantity = 1) {
  return {
    productId: ids.pasta,
    quantity,
    optionIds: [
      options["Your sauce:Tomato & basil"],
      options["Finishing touches:Extra Parmesan"],
    ],
  };
}

async function review(items = [eggs()], slug = "mesa", qr = token) {
  return (
    await db.query(
      "select public.review_visit_order($1,$2,$3::jsonb,coalesce((select visit_key from public.resolve_table_visit($1,$2)),'00000000-0000-4000-8000-000000000001'::uuid)) as result",
      [slug, qr, JSON.stringify(items)],
    )
  ).rows[0].result;
}

async function submit(
  quote,
  items = [eggs()],
  key = randomUUID(),
  slug = "mesa",
  qr = token,
) {
  return (
    await db.query(
      "select public.create_guest_order($1,$2,$3::jsonb,$4,$5) as result",
      [slug, qr, JSON.stringify(items), key, quote.reviewId],
    )
  ).rows[0].result;
}

async function getOrder(id = null, key = null, slug = "mesa") {
  return (
    await db.query("select public.get_guest_order($1,$2,$3) as result", [
      slug,
      id,
      key,
    ])
  ).rows[0].result;
}

async function rejectsCode(callback, code) {
  await db.exec("savepoint expected_failure");
  try {
    await assert.rejects(callback, (error) => {
      assert.ok(
        [code].flat().some((value) => error.message.includes(value)),
        `Expected ${code}; received ${error.message}`,
      );
      return true;
    });
  } finally {
    await db.exec("rollback to savepoint expected_failure");
    await db.exec("release savepoint expected_failure");
  }
}

test("trusted guest order creation calculates totals and snapshots atomically", async () => {
  await transaction(async () => {
    await identify();
    const lines = [eggs(), pasta()];
    const quote = await review(lines);
    assert.equal(quote.totalMinor, 5650);
    assert.equal(quote.currency, "EUR");
    assert.equal(quote.restaurant.id, ids.restaurant);
    assert.equal(quote.restaurant.name, "Casa Mesa");
    assert.equal(quote.table.label, "Table 04");
    assert.ok(quote.reviewId);
    assert.ok(Date.parse(quote.expiresAt) > Date.now());
    const order = await submit(quote, lines);
    assert.equal(order.status, "pending");
    assert.equal(order.totalMinor, 5650);
    assert.equal(order.subtotalMinor, 5650);
    assert.equal(order.currency, "EUR");
    assert.equal(order.table.label, "Table 04");
    assert.ok(order.id && order.reference && order.createdAt);
    const eggLine = order.items.find((line) => line.productId === ids.product);
    assert.equal(eggLine.productName, "Smoked salmon eggs");
    assert.equal(eggLine.basePriceMinor, 1400);
    assert.equal(eggLine.unitPriceMinor, 1650);
    assert.equal(eggLine.quantity, 2);
    assert.equal(eggLine.lineTotalMinor, 3300);
    const avocado = eggLine.options.find(
      (option) => option.id === options["A little extra:Avocado"],
    );
    assert.equal(avocado.name, "Avocado");
    assert.equal(avocado.groupName, "A little extra");
    assert.equal(avocado.priceAdjustmentMinor, 250);
    assert.ok(avocado.groupId);
    const storedOrder = (
      await ownerQuery(
        "select customer_id,restaurant_id,table_id,status,total_minor from public.orders where id=$1",
        [order.id],
      )
    ).rows[0];
    assert.deepEqual(storedOrder, {
      customer_id: ids.guest,
      restaurant_id: ids.restaurant,
      table_id: ids.table,
      status: "pending",
      total_minor: 5650,
    });
    const storedItems = (
      await db.query(
        "select product_name,unit_price_minor,quantity,line_total_minor,selected_options from public.order_items where order_id=$1 order by product_name",
        [order.id],
      )
    ).rows;
    assert.equal(storedItems.length, 2);
    assert.equal(
      storedItems.reduce((total, line) => total + line.line_total_minor, 0),
      storedOrder.total_minor,
    );
    assert.ok(
      storedItems.every(
        (line) =>
          Array.isArray(line.selected_options) &&
          line.selected_options.length === 2,
      ),
    );
  });
});

test("optional selections and distinct customizations retain separate trusted order lines", async () => {
  await transaction(async () => {
    await identify();
    const plain = eggs(1, [options["Your bread:Toasted brioche"]]);
    const customized = eggs(1, [
      options["Your bread:Sourdough"],
      options["A little extra:Avocado"],
    ]);
    const quote = await review([plain, customized]);
    assert.equal(quote.items.length, 2);
    assert.equal(quote.totalMinor, 3050);
    const order = await submit(quote, [plain, customized]);
    assert.equal(order.items.length, 2);
    assert.deepEqual(
      order.items.map((line) => line.unitPriceMinor).sort((a, b) => a - b),
      [1400, 1650],
    );
  });
});

test("guest-owned confirmations survive catalog edits and do not expose table records", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    const key = randomUUID();
    const order = await submit(quote, [eggs()], key);
    await ownerQuery(
      "update public.products set name='New dish',price_minor=9900,is_available=false where id=$1",
      [ids.product],
    );
    await db.query(
      "update public.modifier_options set name='Changed avocado',price_adjustment_minor=1000 where id=$1",
      [options["A little extra:Avocado"]],
    );
    await db.query(
      "update public.product_modifier_groups set name='Changed group' where restaurant_id=$1 and name='A little extra'",
      [ids.restaurant],
    );
    await identify();
    const confirmation = await getOrder(order.id);
    assert.equal(confirmation.items[0].productName, "Smoked salmon eggs");
    assert.equal(confirmation.items[0].unitPriceMinor, 1650);
    assert.ok(
      confirmation.items[0].options.some(
        (option) =>
          option.name === "Avocado" &&
          option.groupName === "A little extra" &&
          option.priceAdjustmentMinor === 250,
      ),
    );
    assert.deepEqual(await getOrder(null, key), confirmation);
    assert.equal(
      (await db.query("select id from public.dining_tables")).rows.length,
      0,
    );
  });
});

test("deleting a guest identity preserves historical orders and immutable snapshots", async () => {
  await transaction(async () => {
    await identify();
    const order = await submit(await review());
    await ownerQuery("delete from auth.users where id=$1", [ids.guest]);
    const historical = (
      await db.query(
        "select customer_id,restaurant_name,table_label,total_minor from public.orders where id=$1",
        [order.id],
      )
    ).rows[0];
    assert.deepEqual(historical, {
      customer_id: null,
      restaurant_name: "Casa Mesa",
      table_label: "Table 04",
      total_minor: 3300,
    });
    const item = (
      await db.query(
        "select product_name,unit_price_minor,selected_options from public.order_items where order_id=$1",
        [order.id],
      )
    ).rows[0];
    assert.equal(item.product_name, "Smoked salmon eggs");
    assert.equal(item.unit_price_minor, 1650);
    assert.ok(
      item.selected_options.some(
        (option) =>
          option.name === "Avocado" && option.priceAdjustmentMinor === 250,
      ),
    );
    await identify(ids.otherGuest);
    assert.equal(await getOrder(order.id), null);
  });
});

test("a shared table QR never grants another guest access to orders or snapshots", async () => {
  await transaction(async () => {
    await identify();
    const key = randomUUID();
    const order = await submit(await review(), [eggs()], key);
    await identify(ids.otherGuest);
    assert.equal(await getOrder(order.id), null);
    assert.equal(await getOrder(null, key), null);
    assert.equal(
      (await db.query("select * from public.orders where id=$1", [order.id]))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from public.order_items where order_id=$1", [
          order.id,
        ])
      ).rows.length,
      0,
    );
    const own = await submit(await review());
    assert.notEqual(own.id, order.id);
    assert.equal(await getOrder(own.id, null, "other"), null);
    assert.equal(await getOrder(own.id, randomUUID()), null);
  });
});

test("anonymous guests never gain staff authority through an accidental membership", async () => {
  await transaction(async () => {
    await identify(ids.otherGuest);
    const anotherGuestsOrder = await submit(await review());
    await ownerQuery(
      "insert into public.restaurant_members(restaurant_id,user_id,role) values($1,$2,'manager')",
      [ids.restaurant, ids.guest],
    );
    await db.query(
      "update public.products set is_available=false where id=$1",
      [ids.pasta],
    );
    await identify();
    const ownOrder = await submit(await review());
    const privileges = (
      await db.query(
        "select private.is_member($1) as member,private.can_manage($1) as manager",
        [ids.restaurant],
      )
    ).rows[0];
    assert.deepEqual(privileges, { member: false, manager: false });
    assert.equal(
      (
        await db.query(
          "select id from public.dining_tables where restaurant_id=$1",
          [ids.restaurant],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.products where id=$1", [ids.pasta]))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from public.orders where id=$1", [
          anotherGuestsOrder.id,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from public.order_items where order_id=$1", [
          anotherGuestsOrder.id,
        ])
      ).rows.length,
      0,
    );
    assert.equal(await getOrder(anotherGuestsOrder.id), null);
    assert.equal((await getOrder(ownOrder.id)).id, ownOrder.id);
    await rejectsCode(
      () =>
        db.query("update public.products set price_minor=1 where id=$1", [
          ids.product,
        ]),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query(
          "update public.modifier_options set price_adjustment_minor=1 where id=$1",
          [options["A little extra:Avocado"]],
        ),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query(
          "update public.orders set status='served' where id in($1,$2) returning id",
          [anotherGuestsOrder.id, ownOrder.id],
        ),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query(
          "insert into public.menu_categories(restaurant_id,name) values($1,'Unauthorized guest category')",
          [ids.restaurant],
        ),
      "permission denied",
    );
  });
});

test("order RPCs reject absent, expired and traditional-account guest identities", async () => {
  await transaction(async () => {
    await identify(null, true, "authenticated");
    await rejectsCode(() => review(), "SESSION_REQUIRED");
    await identify(ids.registered, false);
    await rejectsCode(() => review(), "SESSION_REQUIRED");
    await rejectsCode(() => getOrder(randomUUID()), "SESSION_REQUIRED");
    await identify(ids.guest);
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: ids.guest, role: "authenticated" }),
    ]);
    await rejectsCode(() => review(), "SESSION_REQUIRED");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: ids.otherGuest,
        role: "authenticated",
        is_anonymous: true,
      }),
    ]);
    await rejectsCode(() => review(), "SESSION_REQUIRED");
    await identify(null, false, "anon");
    await rejectsCode(() => review(), "permission denied");
    await rejectsCode(() => getOrder(randomUUID()), "permission denied");
  });
});

test("invalid, inactive, rotated and cross-restaurant table QR tokens are rejected", async () => {
  await transaction(async () => {
    await identify();
    await rejectsCode(
      () => review([eggs()], "mesa", randomUUID()),
      "TABLE_INVALID",
    );
    await rejectsCode(
      () => review([eggs()], "mesa", otherToken),
      "TABLE_INVALID",
    );
    await ownerQuery(
      "update public.dining_tables set is_active=false where id=$1",
      [ids.table],
    );
    await identify();
    await rejectsCode(() => review(), "TABLE_INVALID");
    await ownerQuery(
      "update public.dining_tables set is_active=true,qr_token=gen_random_uuid() where id=$1",
      [ids.table],
    );
    await identify();
    await rejectsCode(() => review(), "TABLE_INVALID");
  });
});

test("unpublished restaurants and disabled ordering cannot be reviewed or submitted", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    await ownerQuery(
      "update public.restaurants set is_published=false where id=$1",
      [ids.restaurant],
    );
    await identify();
    await rejectsCode(() => review(), "RESTAURANT_UNAVAILABLE");
    await rejectsCode(() => submit(quote), "RESTAURANT_UNAVAILABLE");
    await ownerQuery(
      "update public.restaurants set is_published=true,is_accepting_orders=false where id=$1",
      [ids.restaurant],
    );
    await identify();
    await rejectsCode(() => review(), "RESTAURANT_UNAVAILABLE");
    await rejectsCode(() => submit(quote), "RESTAURANT_UNAVAILABLE");
  });
});

test("unavailable products, inactive categories and other-tenant products are rejected", async () => {
  await transaction(async () => {
    await identify();
    await rejectsCode(
      () =>
        review([
          {
            productId: ids.otherProduct,
            quantity: 1,
            optionIds: [ids.otherOption],
          },
        ]),
      "PRODUCT_UNAVAILABLE",
    );
    await rejectsCode(
      () => review([{ productId: randomUUID(), quantity: 1, optionIds: [] }]),
      "PRODUCT_UNAVAILABLE",
    );
    await ownerQuery(
      "update public.products set is_available=false where id=$1",
      [ids.product],
    );
    await identify();
    await rejectsCode(() => review(), "PRODUCT_UNAVAILABLE");
    await ownerQuery(
      "update public.products set is_available=true where id=$1",
      [ids.product],
    );
    await db.query(
      "update public.menu_categories set is_active=false where id=(select category_id from public.products where id=$1)",
      [ids.product],
    );
    await identify();
    await rejectsCode(() => review(), "PRODUCT_UNAVAILABLE");
  });
});

test("modifier membership, availability, required groups and selection bounds are enforced", async () => {
  await transaction(async () => {
    await identify();
    const bread = options["Your bread:Toasted brioche"];
    const sourdough = options["Your bread:Sourdough"];
    const avocado = options["A little extra:Avocado"];
    const extraEgg = options["A little extra:Extra poached egg"];
    const noSauce = options["A little extra:No hollandaise"];
    for (const selected of [
      [],
      [avocado],
      [bread, sourdough],
      [bread, avocado, extraEgg, noSauce],
      [bread, ids.otherOption],
      [bread, options["Your sauce:Tomato & basil"]],
      [bread, randomUUID()],
    ]) {
      await rejectsCode(() => review([eggs(1, selected)]), "OPTIONS_INVALID");
    }
    await ownerQuery(
      "update public.modifier_options set is_available=false where id=$1",
      [avocado],
    );
    await identify();
    await rejectsCode(() => review(), "OPTIONS_INVALID");
    await ownerQuery(
      "update public.modifier_options set is_available=true where id=$1",
      [avocado],
    );
    await db.query(
      "update public.product_modifier_groups set min_selections=2 where restaurant_id=$1 and name='A little extra'",
      [ids.restaurant],
    );
    await identify();
    await rejectsCode(() => review(), "OPTIONS_INVALID");
    const quote = await review([eggs(1, [bread, avocado, extraEgg])]);
    assert.equal(quote.totalMinor, 1850);
  });
});

test("a removed or deactivated customization is never accepted after review", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    await ownerQuery("delete from public.modifier_options where id=$1", [
      options["A little extra:Avocado"],
    ]);
    await identify();
    await rejectsCode(() => submit(quote), "OPTIONS_INVALID");
  });
  await transaction(async () => {
    await identify();
    const quote = await review();
    await ownerQuery(
      "update public.product_modifier_groups set is_active=false where restaurant_id=$1 and name='A little extra'",
      [ids.restaurant],
    );
    await identify();
    await rejectsCode(() => submit(quote), "OPTIONS_INVALID");
  });
});

test("request shape, size, item count and quantity limits cannot be bypassed", async () => {
  await transaction(async () => {
    await identify();
    for (const payload of [
      null,
      {},
      [],
      [null],
      [{ ...eggs(), extra: true }],
      [{ ...eggs(), productId: "not-a-uuid" }],
      [{ ...eggs(), optionIds: "none" }],
      Array.from({ length: 51 }, () => eggs(1)),
      [{ ...eggs(), unexpected: "x".repeat(65536) }],
    ]) {
      await rejectsCode(() => review(payload), "INVALID_REQUEST");
    }
    for (const selection of [
      [null],
      Array.from({ length: 51 }, () => randomUUID()),
      [
        options["Your bread:Toasted brioche"],
        options["Your bread:Toasted brioche"],
      ],
    ]) {
      await rejectsCode(
        () => review([{ ...eggs(), optionIds: selection }]),
        "OPTIONS_INVALID",
      );
    }
    for (const quantity of [
      0,
      -1,
      100,
      1.5,
      "2",
      null,
      Number.MAX_SAFE_INTEGER,
      1e100,
      "99999999999999999999999",
    ]) {
      await rejectsCode(
        () => review([eggs(quantity)]),
        ["INVALID_REQUEST", "QUANTITY_INVALID"],
      );
    }
    await rejectsCode(
      () => review(Array.from({ length: 6 }, () => eggs(99))),
      ["INVALID_REQUEST", "QUANTITY_INVALID"],
    );
    const bread = options["Your bread:Toasted brioche"];
    const sourdough = options["Your bread:Sourdough"];
    const avocado = options["A little extra:Avocado"];
    const extraEgg = options["A little extra:Extra poached egg"];
    const noSauce = options["A little extra:No hollandaise"];
    const uniqueChoices = [
      [bread],
      [sourdough],
      [bread, avocado],
      [bread, extraEgg],
      [bread, noSauce],
      [sourdough, avocado],
    ];
    await rejectsCode(
      () => review(uniqueChoices.map((choices) => eggs(99, choices))),
      "QUANTITY_INVALID",
    );
  });
});

test("integer overflow cannot create a partially priced or truncated order", async () => {
  await transaction(async () => {
    await ownerQuery(
      "update public.products set price_minor=2147483647 where id=$1",
      [ids.product],
    );
    await identify();
    await rejectsCode(() => review([eggs(1)]), "INVALID_REQUEST");
    await rejectsCode(
      () => review([eggs(2, [options["Your bread:Toasted brioche"]])]),
      "INVALID_REQUEST",
    );
    await ownerQuery(
      "update public.products set price_minor=1200000000 where id in($1,$2)",
      [ids.product, ids.pasta],
    );
    await identify();
    await rejectsCode(() => review([eggs(1), pasta()]), "INVALID_REQUEST");
  });
});

test("client-provided financial, table, identity or status fields are rejected", async () => {
  await transaction(async () => {
    await identify();
    for (const attempted of [
      { priceMinor: 1 },
      { unitPriceMinor: 1 },
      { totalMinor: 1 },
      { customerId: ids.otherGuest },
      { restaurantId: ids.otherRestaurant },
      { tableId: ids.otherTable },
      { status: "served" },
    ]) {
      await rejectsCode(
        () => review([{ ...eggs(), ...attempted }]),
        "INVALID_REQUEST",
      );
    }
    const quote = await review();
    await rejectsCode(
      () => submit(quote, [{ ...eggs(), totalMinor: 0 }]),
      "INVALID_REQUEST",
    );
    assert.equal(
      (await ownerQuery("select count(*)::int as count from public.orders"))
        .rows[0].count,
      0,
    );
  });
});

test("product or modifier price changes require a fresh explicit order review", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    await ownerQuery(
      "update public.products set price_minor=1500 where id=$1",
      [ids.product],
    );
    await identify();
    await rejectsCode(() => submit(quote), "ORDER_CHANGED");
    const updated = await review();
    assert.equal(updated.totalMinor, 3500);
    await ownerQuery(
      "update public.modifier_options set price_adjustment_minor=300 where id=$1",
      [options["A little extra:Avocado"]],
    );
    await identify();
    await rejectsCode(() => submit(updated), "ORDER_CHANGED");
    const accepted = await review();
    assert.equal(accepted.totalMinor, 3600);
    assert.equal((await submit(accepted)).totalMinor, 3600);
  });
});

test("modifier or group name changes require explicit review even when totals are unchanged", async () => {
  await transaction(async () => {
    await identify();
    const original = await review();
    await ownerQuery(
      "update public.modifier_options set name='Ripe avocado' where id=$1",
      [options["A little extra:Avocado"]],
    );
    await identify();
    await rejectsCode(() => submit(original), "ORDER_CHANGED");
    const renamedOption = await review();
    assert.equal(renamedOption.totalMinor, original.totalMinor);
    await ownerQuery(
      "update public.product_modifier_groups set name='Fresh additions' where id=(select group_id from public.modifier_options where id=$1)",
      [options["A little extra:Avocado"]],
    );
    await identify();
    await rejectsCode(() => submit(renamedOption), "ORDER_CHANGED");
    const accepted = await review();
    const order = await submit(accepted);
    assert.equal(order.totalMinor, original.totalMinor);
    assert.ok(
      order.items[0].options.some(
        (option) =>
          option.name === "Ripe avocado" &&
          option.groupName === "Fresh additions",
      ),
    );
  });
});

test("reviews are guest-bound, table-bound, expiring and inaccessible directly", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    await rejectsCode(
      () => db.query("select * from private.order_reviews"),
      "permission denied",
    );
    await identify(ids.otherGuest);
    await rejectsCode(() => submit(quote), "SESSION_REQUIRED");
    await identify();
    await rejectsCode(
      () => submit({ reviewId: randomUUID() }),
      ["REVIEW_EXPIRED", "INVALID_REQUEST"],
    );
    await rejectsCode(
      () => submit(quote, [eggs(1)]),
      ["ORDER_CHANGED", "INVALID_REQUEST"],
    );
    await ownerQuery(
      "insert into public.dining_tables(restaurant_id,label,qr_token) values($1,'Review binding QA',$2)",
      [ids.restaurant, randomUUID()],
    );
    const newToken = (
      await db.query(
        "select qr_token from public.dining_tables where restaurant_id=$1 and label='Review binding QA'",
        [ids.restaurant],
      )
    ).rows[0].qr_token;
    await identify();
    await rejectsCode(
      () => submit(quote, [eggs()], randomUUID(), "mesa", newToken),
      "INVALID_REQUEST",
    );
    await ownerQuery(
      "update private.order_reviews set expires_at=now()-interval '1 second' where id=$1",
      [quote.reviewId],
    );
    await identify();
    await rejectsCode(() => submit(quote), "REVIEW_EXPIRED");
  });
});

test("same-key retries return the original order despite later QR and catalog changes", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    const key = randomUUID();
    const original = await submit(quote, [eggs()], key);
    assert.deepEqual(await submit(quote, [eggs()], key), original);
    await ownerQuery(
      "update public.dining_tables set is_active=false where id=$1",
      [ids.table],
    );
    await db.query(
      "update public.products set is_available=false,price_minor=9900 where id=$1",
      [ids.product],
    );
    await db.query(
      "update private.order_reviews set expires_at=now()-interval '1 second' where id=$1",
      [quote.reviewId],
    );
    await identify();
    assert.deepEqual(await submit(quote, [eggs()], key), original);
    assert.deepEqual(await getOrder(null, key), original);
    assert.equal(
      (await ownerQuery("select count(*)::int as count from public.orders"))
        .rows[0].count,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::int as count from public.order_items"))
        .rows[0].count,
      1,
    );
  });
});

test("queued identical requests create one order and enforce persistent scoped uniqueness", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    const key = randomUUID();
    // PGlite is a single PostgreSQL session: these queued requests verify replay
    // semantics, while hosted integration verifies genuinely concurrent callers.
    const results = await Promise.all([
      submit(quote, [eggs()], key),
      submit(quote, [eggs()], key),
      submit(quote, [eggs()], key),
    ]);
    assert.ok(results.every((result) => result.id === results[0].id));
    const constraints = (
      await ownerQuery(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.orders'::regclass and contype='u'",
      )
    ).rows;
    assert.ok(
      constraints.some((row) =>
        row.definition.includes("customer_id, restaurant_id, idempotency_key"),
      ),
    );
    await identify(ids.otherGuest);
    const second = await submit(await review(), [eggs()], key);
    assert.notEqual(second.id, results[0].id);
  });
});

test("one guest can use independently scoped idempotency keys across restaurants", async () => {
  await transaction(async () => {
    await identify();
    const key = randomUUID();
    const first = await submit(await review(), [eggs()], key);
    const otherItems = [
      {
        productId: ids.otherProduct,
        quantity: 1,
        optionIds: [ids.otherOption],
      },
    ];
    const otherQuote = await review(otherItems, "other", otherToken);
    const second = await submit(
      otherQuote,
      otherItems,
      key,
      "other",
      otherToken,
    );
    assert.notEqual(first.id, second.id);
    assert.equal(second.restaurant.id, ids.otherRestaurant);
    assert.equal(second.table.label, "Table 09");
    assert.equal(second.totalMinor, 1100);
    assert.deepEqual(await getOrder(null, key, "mesa"), first);
    assert.deepEqual(await getOrder(null, key, "other"), second);
    assert.equal(await getOrder(second.id, null, "mesa"), null);
    assert.equal(await getOrder(first.id, null, "other"), null);
  });
});

test("same-key changed contents are rejected without duplicating the order", async () => {
  await transaction(async () => {
    await identify();
    const quote = await review();
    const key = randomUUID();
    await submit(quote, [eggs()], key);
    await rejectsCode(
      () => submit(quote, [eggs(1)], key),
      "IDEMPOTENCY_CONFLICT",
    );
    await rejectsCode(
      () => submit(quote, [eggs(2, [options["Your bread:Sourdough"]])], key),
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      (await ownerQuery("select count(*)::int as count from public.orders"))
        .rows[0].count,
      1,
    );
  });
});

test("canonical line and option ordering supports safe equivalent request retries", async () => {
  await transaction(async () => {
    await identify();
    const lines = [eggs(), pasta()];
    const quote = await review(lines);
    const key = randomUUID();
    const original = await submit(quote, lines, key);
    const equivalent = lines
      .toReversed()
      .map((line) => ({ ...line, optionIds: line.optionIds.toReversed() }));
    assert.deepEqual(await submit(quote, equivalent, key), original);
  });
});

test("item insertion failure rolls back the order and leaves idempotency retryable", async () => {
  await transaction(async () => {
    await ownerQuery(`create function public.test_fail_item() returns trigger language plpgsql as $$ begin
      if new.product_id='${ids.pasta}'::uuid then raise exception 'FORCED_ITEM_FAILURE'; end if;
      return new;
    end $$`);
    await db.exec(
      "create trigger test_fail_item before insert on public.order_items for each row execute function public.test_fail_item()",
    );
    await identify();
    const quote = await review([eggs(), pasta()]);
    const key = randomUUID();
    await rejectsCode(
      () => submit(quote, [eggs(), pasta()], key),
      "FORCED_ITEM_FAILURE",
    );
    assert.equal(
      (await ownerQuery("select count(*)::int as count from public.orders"))
        .rows[0].count,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int as count from public.order_items"))
        .rows[0].count,
      0,
    );
    await db.exec("drop trigger test_fail_item on public.order_items");
    await identify();
    const retry = await submit(quote, [eggs(), pasta()], key);
    assert.equal(retry.totalMinor, 5650);
  });
});

test("direct writes cannot bypass trusted order creation or rewrite snapshots", async () => {
  await transaction(async () => {
    await identify();
    const order = await submit(await review());
    await rejectsCode(
      () =>
        db.query(
          "insert into public.orders(restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor) values($1,$2,$3,'EUR',1,1)",
          [ids.restaurant, ids.table, ids.guest],
        ),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query(
          "insert into public.order_items(restaurant_id,order_id,product_id,product_name,unit_price_minor,quantity) values($1,$2,$3,'Forged',1,1)",
          [ids.restaurant, order.id, ids.product],
        ),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query("update public.orders set total_minor=0 where id=$1", [
          order.id,
        ]),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query(
          "update public.order_items set selected_options='[]'::jsonb where order_id=$1",
          [order.id],
        ),
      "permission denied",
    );
    await rejectsCode(
      () =>
        db.query(
          "update public.orders set status='served' where id=$1 returning id",
          [order.id],
        ),
      "permission denied",
    );
  });
});

test("successful review rate limits are guest-scoped across restaurants", async () => {
  await transaction(async () => {
    await identify();
    for (let index = 0; index < 20; index++) await review();
    await rejectsCode(() => review(), "RATE_LIMITED");
    await rejectsCode(
      () =>
        review(
          [
            {
              productId: ids.otherProduct,
              quantity: 1,
              optionIds: [ids.otherOption],
            },
          ],
          "other",
          otherToken,
        ),
      "RATE_LIMITED",
    );
    await identify(ids.otherGuest);
    assert.ok((await review()).reviewId);
  });
});

test("new-order rate limits block excess creations while allowing safe replay", async () => {
  await transaction(async () => {
    await identify();
    const originals = [];
    for (let index = 0; index < 5; index++) {
      const quote = await review();
      const key = randomUUID();
      originals.push({ quote, key, order: await submit(quote, [eggs()], key) });
    }
    const sixth = await review();
    await rejectsCode(() => submit(sixth), "RATE_LIMITED");
    const foreignItems = [
      {
        productId: ids.otherProduct,
        quantity: 1,
        optionIds: [ids.otherOption],
      },
    ];
    const foreignQuote = await review(foreignItems, "other", otherToken);
    await rejectsCode(
      () =>
        submit(foreignQuote, foreignItems, randomUUID(), "other", otherToken),
      "RATE_LIMITED",
    );
    assert.deepEqual(
      await submit(originals[0].quote, [eggs()], originals[0].key),
      originals[0].order,
    );
    assert.equal(
      (await ownerQuery("select count(*)::int as count from public.orders"))
        .rows[0].count,
      5,
    );
  });
});

test("table-wide order throttling applies across independent guest identities", async () => {
  await transaction(async () => {
    for (let guestIndex = 0; guestIndex < 8; guestIndex++) {
      const guest = randomUUID();
      await ownerQuery(
        "insert into auth.users(id,is_anonymous) values($1,true)",
        [guest],
      );
      await identify(guest);
      for (let orderIndex = 0; orderIndex < 5; orderIndex++) {
        await submit(await review([eggs(1)]), [eggs(1)]);
      }
    }
    await identify();
    const quote = await review([eggs(1)]);
    await rejectsCode(() => submit(quote, [eggs(1)]), "RATE_LIMITED");
    assert.equal(
      (await ownerQuery("select count(*)::int as count from public.orders"))
        .rows[0].count,
      40,
    );
  });
});

test("definer RPCs have fixed search paths and narrowly scoped execution grants", async () => {
  const { rows } =
    await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') as anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') as guest_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.proname in('review_guest_order','create_guest_order','get_guest_order','require_order_guest','normalize_order_items','order_request_fingerprint','build_order_snapshot')`);
  assert.equal(rows.length, 10);
  for (const row of rows) {
    assert.ok(row.proconfig.includes('search_path=""'));
    assert.equal(row.anon_execute, false);
    assert.equal(
      row.guest_execute,
      row.nspname === "public" && row.proname !== "review_guest_order",
    );
    if (row.nspname === "public") assert.equal(row.prosecdef, true);
  }
});
