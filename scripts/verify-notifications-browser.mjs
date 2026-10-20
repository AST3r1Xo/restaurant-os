import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { DEMO_TABLE_TOKEN } from "../src/lib/routes.ts";

// Uses an isolated headless Chrome profile, never a personal browser profile.
// This is browser emulation, not physical-device or hosted Realtime evidence.
const origin = new URL(
  process.env.NOTIFICATION_TEST_ORIGIN ?? "http://127.0.0.1:3401",
);
const debuggerOrigin = new URL(
  process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9223",
);
for (const url of [origin, debuggerOrigin])
  assert.ok(
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.username &&
      !url.password,
  );
const target = await fetch(new URL("/json/new?about:blank", debuggerOrigin), {
  method: "PUT",
}).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let seq = 0,
  pageLoads = 0;
const pending = new Map(),
  errors = [],
  network = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const p = pending.get(message.id);
    pending.delete(message.id);
    if (p) {
      clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error.message));
      else p.resolve(message.result);
    }
  }
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails.text);
  if (message.method === "Network.requestWillBeSent")
    network.push(message.params.request.url);
  if (message.method === "Page.loadEventFired") pageLoads++;
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Browser condition not met: ${expression}`);
}
async function navigate(path) {
  const before = pageLoads;
  await cdp("Page.navigate", { url: new URL(path, origin).href });
  const end = Date.now() + 30000;
  while (pageLoads === before && Date.now() < end)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(pageLoads > before, "The new document finished loading");
  await until(
    'document.readyState === "complete" && !!document.querySelector("main")',
  );
}
async function viewport(width, height) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 800,
  });
}
async function noOverflow() {
  assert.ok(
    await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
    "No horizontal page overflow",
  );
}
async function screenshot(name) {
  await evaluate(
    "Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime < 2000).map(a=>a.finished.catch(()=>{})))",
  );
  const image = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    `/private/tmp/restaurant-os-notifications-${name}.png`,
    Buffer.from(image.data, "base64"),
  );
}
const passed = [];
try {
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Network.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Page.bringToFront");
  await viewport(360, 740);
  await navigate(`/r/mesa?table=${DEMO_TABLE_TOKEN}`);
  await until('!!document.querySelector("button[aria-label^=Notifications]")');
  assert.match(await evaluate("document.body.innerText"), /Demo menu/);
  await noOverflow();
  assert.ok(
    await evaluate(
      'document.querySelector("button[aria-label^=Notifications]").getBoundingClientRect().height >= 44',
    ),
  );
  await evaluate(
    'document.querySelector("button[aria-label^=Notifications]").click()',
  );
  await until('!!document.querySelector("dialog[open]")');
  assert.match(
    await evaluate('document.querySelector("dialog[open]").innerText'),
    /Demo mode never sends real notifications/,
  );
  await screenshot("mobile-inbox");
  await cdp("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await until('!document.querySelector("dialog[open]")');
  assert.ok(
    await evaluate(
      'document.activeElement?.getAttribute("aria-label")?.startsWith("Notifications")',
    ),
  );
  passed.push(
    "360px mobile inbox: accessible control, modal, Escape and focus restoration",
  );
  const href = await evaluate(
    'document.querySelector("a[aria-label^=\\"Choose \\"]").getAttribute("href")',
  );
  await navigate(href);
  await until(
    '!!document.querySelector("form button[type=submit]") && (document.body.innerText.includes("Ready to add") || document.body.innerText.includes("Choose your options"))',
  );
  await noOverflow();
  assert.match(
    await evaluate("document.body.innerText"),
    /Ready to add|Choose your options/,
  );
  // Optional modifiers are deliberately untouched; choose only required groups.
  await evaluate(
    `for(const fieldset of document.querySelectorAll("fieldset")){if(fieldset.querySelector("legend")?.textContent.includes("Required")){const controls=[...fieldset.querySelectorAll("input:not(:disabled)")];if(!controls.some(i=>i.checked))controls[0]?.click();}}`,
  );
  await evaluate(
    'const t=document.querySelector("#dish-special-request");t.focus();t.setSelectionRange(0,t.value.length);',
  );
  await cdp("Input.insertText", { text: "Sauce on the side" });
  // Use a real browser pointer after hydration, not a synthetic pre-hydration
  // click on streamed radio HTML. The visible guidance verifies React state.
  const choices = await evaluate(
    '(()=>{const result=[];for(const fieldset of document.querySelectorAll("fieldset")){if(fieldset.querySelector("legend")?.textContent.includes("Required")){const control=fieldset.querySelector("input:not(:disabled)");if(control){control.closest("label").scrollIntoView({block:"center"});const r=control.getBoundingClientRect();result.push({x:r.x+r.width/2,y:r.y+r.height/2});}}}return result;})()',
  );
  for (const point of choices) {
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  }
  await until('document.body.innerText.includes("Ready to add to your bag")');
  await evaluate(
    'document.querySelector("button[aria-label^=Notifications]").click()',
  );
  await until('!!document.querySelector("dialog[open]")');
  await evaluate(
    'document.querySelector("button[aria-label=\\"Close notifications\\"]").click()',
  );
  assert.equal(
    await evaluate('document.querySelector("#dish-special-request").value'),
    "Sauce on the side",
  );
  passed.push(
    "Opening notifications preserves product customizations and notes",
  );
  await screenshot("mobile-product");
  await evaluate('document.querySelector("form button[type=submit]").click()');
  await until('document.body.innerText.includes("Added to your bag")');
  assert.match(await evaluate("document.body.innerText"), /Not sent yet/);
  await screenshot("mobile-added");
  const bag = await evaluate(
    '[...document.querySelectorAll("a")].find(a=>a.textContent.includes("View bag") && a.href.includes("/cart")).getAttribute("href")',
  );
  await navigate(bag);
  await until('document.body.innerText.includes("Place Order · Demo preview")');
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Place Order"))?.disabled',
    ),
    true,
  );
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("textarea")].some(t=>t.value === "Sauce on the side")',
    ),
    "The saved bag retains the actual special-request intent",
  );
  await noOverflow();
  await screenshot("mobile-bag");
  passed.push(
    "Product → saved bag → single disabled demo submission; no fake order",
  );
  for (const [width, height] of [
    [320, 568],
    [430, 932],
    [740, 360],
  ]) {
    await viewport(width, height);
    await noOverflow();
    const rect = await evaluate(
      '(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Place Order"));const r=b.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,top:r.top,height:r.height};})()',
    );
    assert.ok(
      rect.left >= 0 &&
        rect.right <= width + 1 &&
        rect.top >= 0 &&
        rect.bottom <= height &&
        rect.height >= 44,
    );
    passed.push(
      `${width}×${height}: order button remains visible without horizontal scrolling`,
    );
  }
  await viewport(1024, 768);
  await navigate("/admin");
  await until('!!document.querySelector("button[aria-label^=Notifications]")');
  await noOverflow();
  await evaluate(
    'document.querySelector("button[aria-label^=Notifications]").click()',
  );
  await until('!!document.querySelector("dialog[open]")');
  assert.match(
    await evaluate('document.querySelector("dialog[open]").innerText'),
    /Sample table activity/,
  );
  assert.match(
    await evaluate('document.querySelector("dialog[open]").innerText'),
    /Open kitchen|Respond to request|You’re all caught up/,
  );
  await screenshot("tablet-staff-inbox");
  await evaluate(
    'document.querySelector("button[aria-label=\\"Close notifications\\"]").click()',
  );
  await screenshot("tablet-kitchen");
  passed.push(
    "Tablet staff inbox clearly labels demo mode and handles its empty queue without invented live alerts",
  );
  await viewport(768, 1024);
  await navigate("/admin/tables");
  await until('document.body.innerText.includes("Tables")');
  await noOverflow();
  await screenshot("tablet-tables");
  passed.push("Portrait tablet table management remains readable");
  assert.equal(
    errors.length,
    0,
    `No browser runtime exceptions: ${errors.join(", ")}`,
  );
  assert.ok(
    !network.some((url) => url.includes("supabase.co")),
    "Demo never connects to live Supabase",
  );
  console.log(
    JSON.stringify(
      {
        passed: passed.length,
        scenarios: passed,
        runtimeErrors: errors.length,
        liveSupabaseRequests: 0,
        physicalDeviceTesting: false,
        screenshots: "/private/tmp/restaurant-os-notifications-*.png",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      runtimeErrors: errors,
      diagnostic: await evaluate(
        '({visibility:document.visibilityState,ready:document.readyState,body:document.body.innerText.slice(0,1200),scripts:document.scripts.length,hiddenSuspense:document.querySelectorAll("[hidden]").length})',
      ).catch(() => null),
    }),
  );
  await screenshot("failed").catch(() => {});
  throw error;
} finally {
  ws.close();
  await fetch(new URL(`/json/close/${target.id}`, debuggerOrigin)).catch(
    () => {},
  );
}
