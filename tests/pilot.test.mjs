import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { validateDeployment, securityHeaders } from "../src/lib/deployment.ts";
import { refreshForRouting } from "../src/lib/supabase/refresh.ts";
const ref = "abcdefghijklmnopqrst";
const live = {
  VERCEL: "1",
  APP_DATA_MODE: "live",
  NEXT_PUBLIC_APP_URL: "https://staging.example.com",
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_EXPECTED_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "test-only",
};
test("hosted QA never repurposes the media key for administrative provisioning", () => {
  for (const script of [
    "verify-pilot-live.mjs",
    "verify-menu-admin.mjs",
    "verify-menu-admin-followup.mjs",
  ]) {
    const run = spawnSync(process.execPath, [`scripts/${script}`], {
      encoding: "utf8",
      env: {
        CONFIRM_PILOT_QA: "development",
        CONFIRM_MENU_ADMIN_QA: "development",
        PILOT_QA_PROJECT_REF: ref,
        NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        SUPABASE_SERVICE_ROLE_KEY: "test-media-only-key",
      },
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /separately authorized PILOT_QA_ADMIN_KEY/);
  }
});
test("Vercel fails closed instead of silently choosing demo or another project", () => {
  assert.doesNotThrow(() => validateDeployment(live));
  for (const change of [
    { APP_DATA_MODE: undefined },
    { APP_DATA_MODE: "auto" },
    { SUPABASE_EXPECTED_PROJECT_REF: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
  ])
    assert.throws(() => validateDeployment({ ...live, ...change }));
  assert.doesNotThrow(() =>
    validateDeployment({
      VERCEL: "1",
      APP_DATA_MODE: "demo",
      NEXT_PUBLIC_APP_URL: "https://demo.example.com",
    }),
  );
  assert.doesNotThrow(() => validateDeployment({}));
});
test("hosted configuration rejects insecure, credential-bearing and malformed origins", () => {
  for (const value of [
    "http://staging.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?token=bad",
    "https://example.com#fragment",
    "",
  ])
    assert.throws(() =>
      validateDeployment({ ...live, NEXT_PUBLIC_APP_URL: value }),
    );
});
test("security headers prevent framing and referrer leakage while allowing optional AR", () => {
  const h = Object.fromEntries(
    securityHeaders(true).map((x) => [x.key, x.value]),
  );
  assert.equal(h["Referrer-Policy"], "same-origin");
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(h["Permissions-Policy"], /xr-spatial-tracking=\(self\)/);
  assert.match(h["Permissions-Policy"], /camera=\(self\)/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.ok(h["Strict-Transport-Security"]);
  assert.ok(
    !securityHeaders(false).some((x) => x.key === "Strict-Transport-Security"),
  );
});
test("Auth refresh outages reach recovery routes without granting authorization", async () => {
  let calls = 0;
  assert.equal(
    await refreshForRouting(async () => {
      calls++;
      throw new Error("simulated unavailable Auth");
    }),
    undefined,
  );
  assert.equal(calls, 1);
  assert.equal(
    await refreshForRouting(async () => ({
      data: { claims: null },
      error: null,
    })),
    undefined,
  );
});
test("all route recovery buttons use Next's refetching retry contract", async () => {
  const files = [
    "error.tsx",
    "global-error.tsx",
    "(staff)/admin/error.tsx",
    "(customer)/r/[restaurantSlug]/error.tsx",
    "(confirmation)/r/[restaurantSlug]/orders/[orderId]/error.tsx",
    "(confirmation)/r/[restaurantSlug]/bill/error.tsx",
    "(history)/r/[restaurantSlug]/orders/error.tsx",
  ];
  for (const f of files) {
    const source = await readFile(`src/app/${f}`, "utf8");
    assert.match(source, /retry: \(\) => void/, f);
    assert.match(source, /onClick={retry}/, f);
    assert.doesNotMatch(source, /onClick={reset}/, f);
  }
});
test("root-layout recovery renders independently and invokes the supplied retry", async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile("src/app/global-error.tsx", "utf8");
  let output = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  output = output.replace(
    '"react/jsx-runtime"',
    JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href),
  );
  const { default: ErrorPage } = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  let count = 0;
  const tree = ErrorPage({ retry: () => count++ });
  const nodes = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    nodes.push(n);
    for (const child of [n.props?.children].flat(2)) walk(child);
  }
  walk(tree);
  assert.equal(tree.type, "html");
  const button = nodes.find((n) => n.type === "button");
  assert.ok(button);
  button.props.onClick();
  assert.equal(count, 1);
});
