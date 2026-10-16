// Existing isolated development tenant only; ordinary owner/guest authorization.
// Never reads a privileged key, deletes history, or changes Casa Mesa's service.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";
import { staffCookieOptions } from "../src/lib/supabase/staff-cookie.ts";
import { guestCookieOptions } from "../src/lib/supabase/guest-cookie.ts";
if (process.env.CONFIRM_OPENING_QA !== "development")
  throw new Error("Explicit development QA confirmation required.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (
  !/^[a-z0-9]{20}$/.test(process.env.OPENING_QA_PROJECT_REF ?? "") ||
  new URL(url).hostname !== `${process.env.OPENING_QA_PROJECT_REF}.supabase.co`
)
  throw new Error(
    "Set OPENING_QA_PROJECT_REF to the intended development project.",
  );
const r = process.env.OPENING_QA_RESTAURANT_ID;
if (!r || r === "11111111-1111-4111-8111-111111111111")
  throw new Error(
    "Use an existing isolated pilot QA restaurant, never Casa Mesa for lifecycle mutations.",
  );
const origin = process.env.OPENING_QA_ORIGIN ?? "http://localhost:3000",
  checks = [];
function make(staff) {
  const jar = new Map();
  return {
    jar,
    c: createServerClient(url, key, {
      cookieOptions: staff ? staffCookieOptions(url) : guestCookieOptions(url),
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (items) => items.forEach((x) => jar.set(x.name, x.value)),
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    }),
    cookie: () =>
      [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "),
  };
}
const staff = make(true),
  guest = make(false);
let original,
  table,
  session,
  order,
  changed = false,
  initialTableActive;
async function ok(p, label) {
  const { data, error } = await p;
  if (error)
    throw new Error(label + " failed (" + (error.code ?? "unavailable") + ")");
  return data;
}
const rpc = (c, name, args) => ok(c.rpc(name, args), name);
function pass(label) {
  checks.push(label);
  console.log("PASS " + label);
}
async function denied(name, args, message) {
  const { error } = await guest.c.rpc(name, args);
  assert.equal(error?.message, message);
  pass(name + " rejects " + message);
}
async function workspace() {
  return rpc(staff.c, "menu_workspace", { target_restaurant: r });
}
async function presentation(values) {
  const current = (await workspace()).restaurant;
  await rpc(staff.c, "save_restaurant_presentation", {
    target_restaurant: r,
    expected_version: current.updated_at,
    definition: {
      name: original.name,
      description: original.description,
      timezone: original.timezone,
      opening_hours: original.opening_hours,
      is_published: original.is_published,
      is_accepting_orders: original.is_accepting_orders,
      logo_asset_id: original.logo_asset_id,
      cover_asset_id: original.cover_asset_id,
      keep_legacy_logo: true,
      keep_legacy_cover: true,
      ...values,
    },
  });
}
async function transition(from, to) {
  await rpc(staff.c, "transition_order", {
    target_restaurant: r,
    target_order: order.id,
    expected_status: from,
    next_status: to,
  });
}
try {
  await ok(
    staff.c.auth.signInWithPassword({
      email: process.env.STAFF_TEST_EMAIL,
      password: process.env.STAFF_TEST_PASSWORD,
    }),
    "Owner login",
  );
  original = (await workspace()).restaurant;
  assert.match(original.slug, /^pilot-qa-/);
  assert.equal(original.is_published, false);
  assert.equal(original.is_accepting_orders, false);
  const initial = await rpc(staff.c, "get_table_workspace", {
    target_restaurant: r,
  });
  assert.ok(initial.tables.length);
  assert.ok(initial.tables.every((t) => !t.session));
  table = initial.tables[0];
  initialTableActive = table.isActive;
  const catalogs = await rpc(staff.c, "get_table_qr_codes", {
    target_restaurant: r,
  });
  let token = catalogs.find((t) => t.id === table.id).qr_token;
  staff.jar.set("restaurant-os-workspace", r);
  await ok(
    staff.c
      .from("dining_tables")
      .update({ is_active: true })
      .eq("id", table.id)
      .eq("restaurant_id", r),
    "Activate isolated table",
  );
  changed = true;
  await presentation({
    is_published: true,
    is_accepting_orders: true,
    opening_hours: "Demonstration service hours",
  });
  pass("Owner opens isolated restaurant and sets public hours");
  await ok(guest.c.auth.signInAnonymously(), "Guest login");
  const menu = await workspace(),
    p = menu.products.find(
      (p) => p.is_published && !p.archived_at && p.is_available,
    ),
    options = p.groups
      .filter((g) => g.is_active && g.min_selections > 0)
      .flatMap((g) =>
        g.options
          .filter((o) => o.is_available)
          .slice(0, g.min_selections)
          .map((o) => o.id),
      );
  const items = [{ productId: p.id, quantity: 1, optionIds: options }];
  const visit = (
    await rpc(guest.c, "resolve_table_visit", {
      restaurant_slug: original.slug,
      table_token: token,
    })
  )[0];
  const review = () =>
    rpc(guest.c, "review_visit_order", {
      restaurant_slug: original.slug,
      table_token: token,
      visit_key: visit.visit_key,
      items,
    });
  const quote = await review(),
    args = {
      restaurant_slug: original.slug,
      table_token: token,
      items,
      idempotency_key: randomUUID(),
      review_id: quote.reviewId,
    };
  order = await rpc(guest.c, "create_guest_order", args);
  session = (
    await rpc(staff.c, "get_table_workspace", { target_restaurant: r })
  ).tables.find((t) => t.id === table.id).session;
  const stale = await review();
  pass("Open restaurant creates a real customized order in an active visit");
  await rpc(staff.c, "set_restaurant_open", {
    target_restaurant: r,
    expected_open: true,
    next_open: false,
  });
  pass("Owner closes restaurant without closing its session");
  const closed = await fetch(`${origin}/r/${original.slug}?table=${token}`, {
      signal: AbortSignal.timeout(20000),
    }),
    html = await closed.text();
  assert.equal(closed.status, 200);
  assert.ok(html.includes("Currently closed"));
  assert.ok(html.includes("Demonstration service hours"));
  assert.ok(html.includes(original.name));
  pass("New QR visitor receives branded CLOSED HTTP 200 with configured hours");
  const productPage = await fetch(
    `${origin}/r/${original.slug}/products/${p.id}?table=${token}`,
    { signal: AbortSignal.timeout(20000) },
  );
  assert.equal(productPage.status, 200);
  assert.ok((await productPage.text()).includes("Currently closed"));
  pass("Closed product URLs remain branded, not generic 404");
  await denied(
    "review_visit_order",
    {
      restaurant_slug: original.slug,
      table_token: token,
      visit_key: visit.visit_key,
      items,
    },
    "RESTAURANT_UNAVAILABLE",
  );
  await denied(
    "create_guest_order",
    { ...args, idempotency_key: randomUUID(), review_id: stale.reviewId },
    "RESTAURANT_UNAVAILABLE",
  );
  assert.equal((await rpc(guest.c, "create_guest_order", args)).id, order.id);
  pass(
    "Committed same-key recovery still returns its existing current-visit order while closed",
  );
  const receipt = await fetch(
    `${origin}/r/${original.slug}/orders/${order.id}?table=${token}`,
    { headers: { cookie: guest.cookie() }, signal: AbortSignal.timeout(20000) },
  );
  assert.equal(receipt.status, 200);
  pass(
    "Authorized current guest retains its confirmation while restaurant is closed",
  );
  assert.equal(
    (
      await rpc(guest.c, "get_guest_visit_order_history", {
        restaurant_slug: original.slug,
        table_token: token,
      })
    ).totals.orderCount,
    1,
  );
  await transition("pending", "accepted");
  const bill = await rpc(guest.c, "get_guest_table_bill", {
    restaurant_slug: original.slug,
    table_token: token,
  });
  assert.equal(bill.totals.confirmedMinor, order.totalMinor);
  pass("Kitchen acceptance and stored shared bill continue while closed");
  await rpc(guest.c, "request_session_bill", {
    restaurant_slug: original.slug,
    target_session: session.id,
  });
  await rpc(staff.c, "manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    target_session: session.id,
    operation: "acknowledge",
  });
  pass("Guest bill request and staff acknowledgement continue while closed");
  for (const [from, to] of [
    ["accepted", "preparing"],
    ["preparing", "ready"],
    ["ready", "served"],
  ])
    await transition(from, to);
  await rpc(staff.c, "manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    target_session: session.id,
    operation: "close",
  });
  pass(
    "Kitchen completes the order and staff close service while restaurant remains closed",
  );
  const cannotOpen = await staff.c.rpc("manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    operation: "open",
  });
  assert.equal(cannotOpen.error?.message, "RESTAURANT_UNAVAILABLE");
  pass("CLOSED blocks a new empty dining session in the database");
  assert.equal(
    await rpc(guest.c, "get_guest_order", {
      restaurant_slug: original.slug,
      order_id: order.id,
    }),
    null,
  );
  assert.equal(
    (
      await rpc(staff.c, "get_staff_session_orders", {
        target_restaurant: r,
        target_session: session.id,
      })
    ).orders[0].id,
    order.id,
  );
  pass("Closure revokes guest access and preserves staff history");
  await rpc(staff.c, "set_restaurant_open", {
    target_restaurant: r,
    expected_open: false,
    next_open: true,
  });
  const reopened = await fetch(`${origin}/r/${original.slug}?table=${token}`, {
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(reopened.status, 200);
  assert.ok(!(await reopened.text()).includes("Currently closed"));
  pass("Reopening restores the live menu");
  const codes = await rpc(staff.c, "get_table_qr_codes", {
    target_restaurant: r,
  });
  const current = codes.find((t) => t.id === table.id);
  await rpc(staff.c, "rotate_table_qr", {
    target_restaurant: r,
    target_table: table.id,
    expected_version: current.updated_at,
  });
  const rotated = (
    await rpc(staff.c, "get_table_qr_codes", { target_restaurant: r })
  ).find((t) => t.id === table.id);
  assert.ok(rotated.qr_token !== token, "Rotation must produce a new token");
  assert.equal(
    (
      await rpc(guest.c, "resolve_table_visit", {
        restaurant_slug: original.slug,
        table_token: token,
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await rpc(guest.c, "resolve_table_visit", {
        restaurant_slug: original.slug,
        table_token: rotated.qr_token,
      })
    )[0].table_label,
    table.label,
  );
  pass(
    "Authorized rotation changes only an unused QA table code and invalidates the previous token",
  );
  const privateRead = await staff.c
    .from("dining_tables")
    .select("qr_token")
    .eq("restaurant_id", r);
  assert.ok(privateRead.error);
  pass(
    "Even owner API direct token enumeration is denied; manager RPC is required",
  );
  const mesa = "11111111-1111-4111-8111-111111111111",
    five = (
      await rpc(staff.c, "get_table_qr_codes", { target_restaurant: mesa })
    ).filter((t) => t.is_active);
  assert.deepEqual(
    five.map((t) => t.label),
    ["Table 01", "Table 02", "Table 03", "Table 04", "Table 05"],
  );
  assert.equal(new Set(five.map((t) => t.qr_token)).size, 5);
  for (const t of five)
    assert.equal(
      (
        await rpc(guest.c, "resolve_table_visit", {
          restaurant_slug: "mesa",
          table_token: t.qr_token,
        })
      )[0].table_label,
      t.label,
    );
  pass(
    "All five real Casa Mesa QR tokens resolve to their distinct active tables",
  );
  const unauthorized = await fetch(
    `${origin}/api/admin/table-qr?restaurant=${mesa}&format=pdf`,
    { redirect: "manual", signal: AbortSignal.timeout(20000) },
  );
  assert.equal(unauthorized.status, 403);
  pass("Unauthenticated QR download is denied before origin or token access");
  await writeFile(
    "/private/tmp/restaurant-os-opening-live.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks: checks.length,
        results: checks,
        restaurantId: r,
        orderId: order.id,
        sessionId: session.id,
        qrTokensLogged: false,
        actualBrowserTest: false,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  if (changed) {
    try {
      const ws = await rpc(staff.c, "get_table_workspace", {
        target_restaurant: r,
      });
      for (const t of ws.tables) {
        if (t.session) {
          const rows = await rpc(staff.c, "get_staff_session_orders", {
            target_restaurant: r,
            target_session: t.session.id,
          });
          for (const o of rows.orders) {
            if (o.status === "pending")
              await rpc(staff.c, "transition_order", {
                target_restaurant: r,
                target_order: o.id,
                expected_status: "pending",
                next_status: "cancelled",
                reason: "Isolated opening-control verification",
              });
            else if (!["served", "cancelled"].includes(o.status)) {
              const states = ["accepted", "preparing", "ready", "served"];
              for (let i = states.indexOf(o.status); i < 3; i++)
                await rpc(staff.c, "transition_order", {
                  target_restaurant: r,
                  target_order: o.id,
                  expected_status: states[i],
                  next_status: states[i + 1],
                });
            }
          }
          if (t.session.request?.status === "requested")
            await rpc(staff.c, "manage_table_session", {
              target_restaurant: r,
              target_table: t.id,
              target_session: t.session.id,
              operation: "acknowledge",
            });
          await rpc(staff.c, "manage_table_session", {
            target_restaurant: r,
            target_table: t.id,
            target_session: t.session.id,
            operation: "close",
          });
        }
      }
      await presentation({});
      await ok(
        staff.c
          .from("dining_tables")
          .update({ is_active: initialTableActive })
          .eq("id", table.id)
          .eq("restaurant_id", r),
        "Restore QA table",
      );
      console.log(
        "PASS restored original QA restaurant presentation/status and table activity; historical verification order retained",
      );
    } catch {
      console.error(
        "Isolated QA restoration needs inspection for restaurant " + r,
      );
      process.exitCode = 1;
    }
  }
  await Promise.allSettled([
    staff.c.auth.signOut({ scope: "local" }),
    guest.c.auth.signOut({ scope: "local" }),
  ]);
}
console.log("Completed " + checks.length + " hosted opening-control checks.");
