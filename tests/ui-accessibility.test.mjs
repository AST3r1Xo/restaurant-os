import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile("src/components/action-button.tsx", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(createRequire(import.meta.url), loaded, loaded.exports);
const { ActionButton } = loaded.exports;

test("routine action buttons never accidentally submit the surrounding form", () => {
  const html = renderToStaticMarkup(createElement(ActionButton, null, "Start cooking"));
  assert.match(html, /type="button"/);
  assert.match(html, /Start cooking/);
});

test("explicit form submission and accessible disabled states remain available", () => {
  const html = renderToStaticMarkup(createElement(ActionButton, {
    type: "submit", disabled: true, "aria-describedby": "reason", tone: "danger",
  }, "Decline order"));
  assert.match(html, /type="submit"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-describedby="reason"/);
  assert.match(html, /Decline order/);
});

test("action and status colours meet WCAG AA contrast without relying on colour alone", async () => {
  const css = await readFile("src/app/globals.css", "utf8");
  const colour = (name) => css.match(new RegExp(`--color-${name}: (#[0-9a-f]{6});`))?.[1];
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((n) => parseInt(n, 16) / 255)
      .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    return channels.reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const name of ["accent", "progress", "attention", "danger"]) {
    assert.ok(contrast(colour(name), "#ffffff") >= 4.5, `${name} on white`);
    assert.ok(contrast(colour(name), colour(`${name}-soft`)) >= 4.5, `${name} status badge`);
    const html = renderToStaticMarkup(createElement(ActionButton, { tone: name === "accent" ? "confirm" : name }, "Clearly labelled action"));
    assert.match(html, /Clearly labelled action/);
  }
});
