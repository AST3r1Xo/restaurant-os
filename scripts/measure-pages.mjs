import { gzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
const origin = process.env.MEASURE_ORIGIN ?? "http://localhost:3000";
const slug = process.env.MEASURE_RESTAURANT ?? "mesa";
const paths = [`/r/${encodeURIComponent(slug)}`];
if (process.env.MEASURE_PRODUCT)
  paths.push(
    `${paths[0]}/products/${encodeURIComponent(process.env.MEASURE_PRODUCT)}`,
  );
const results = [];
for (const path of paths) {
  let html;
  const times = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(20000),
    });
    html = await response.text();
    if (response.status !== 200)
      throw new Error(`Measurement returned HTTP ${response.status}`);
    if (i) times.push(performance.now() - start);
  }
  const sources = [
    ...new Set(
      [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
    ),
  ];
  const scriptBytes = await Promise.all(
    sources.map(async (src) => {
      const response = await fetch(new URL(src, origin), {
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Initial script failed");
      return gzipSync(Buffer.from(await response.arrayBuffer())).length;
    }),
  );
  results.push({
    path,
    samples: times.length,
    medianWarmResponseMs: Math.round(times.sort((a, b) => a - b)[2]),
    htmlGzipBytes: gzipSync(html).length,
    initialScriptCount: sources.length,
    initialJsGzipBytes: scriptBytes.reduce((a, b) => a + b, 0),
  });
}
const report = {
  measuredAt: new Date().toISOString(),
  kind: "local HTTP production build; no mobile CPU/network throttling or Web Vitals",
  results,
};
if (process.env.MEASURE_OUTPUT)
  await writeFile(
    process.env.MEASURE_OUTPUT,
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(JSON.stringify(report, null, 2));
