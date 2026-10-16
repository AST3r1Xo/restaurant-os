import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const failures = new Set();
const secrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "PILOT_QA_ADMIN_KEY",
  "STAFF_TEST_PASSWORD",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
]
  .map((name) => process.env[name]?.trim())
  .filter((value) => value && value.length >= 8);
function scan(bytes, location) {
  const text = bytes.toString("utf8");
  if (secrets.some((secret) => text.includes(secret))) failures.add(location);
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) failures.add(location);
  for (const match of text.matchAll(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  )) {
    try {
      if (
        JSON.parse(Buffer.from(match[0].split(".")[1], "base64url")).role ===
        "service_role"
      )
        failures.add(location);
    } catch {
      /* A pattern match is not necessarily a credential. */
    }
  }
}
const tracked = execFileSync("git", ["ls-files", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean);
const working = execFileSync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
])
  .toString()
  .split("\0")
  .filter(Boolean);
for (const file of working) {
  try {
    scan(await readFile(file), `working tree: ${file}`);
  } catch {
    /* Deleted file. */
  }
}
for (const file of tracked) {
  if (/^\.env(\.|$)/.test(file) && file !== ".env.example")
    failures.add(`tracked env file: ${file}`);
}
// Also inspect committed blobs, including removed files and previous keys.
const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
  maxBuffer: 20_000_000,
})
  .toString()
  .split("\n")
  .filter(Boolean);
let blobs = 0;
for (const line of objects) {
  const [oid] = line.split(" ");
  const type = execFileSync("git", ["cat-file", "-t", oid]).toString().trim();
  if (type !== "blob") continue;
  blobs++;
  scan(
    execFileSync("git", ["cat-file", "blob", oid], { maxBuffer: 30_000_000 }),
    `committed blob ${oid.slice(0, 12)}`,
  );
}
let browserChunks = 0;
let checkedLogs = 0;
async function chunks(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) await chunks(path);
    else if (/\.(js|map)$/.test(e.name)) {
      browserChunks++;
      scan(await readFile(path), `browser chunk: ${path}`);
    }
  }
}
try {
  await chunks(".next/static");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (process.env.CHECK_SECRET_LOGS === "1") {
  const dir = process.platform === "darwin" ? "/private/tmp" : "/tmp";
  for (const name of await readdir(dir)) {
    if (!/^restaurant-os-pilot.*\.log$/.test(name)) continue;
    checkedLogs++;
    scan(await readFile(join(dir, name)), `pilot log: ${name}`);
  }
}
console.log(
  JSON.stringify({
    trackedFiles: tracked.length,
    committedBlobs: blobs,
    browserChunks,
    checkedLogs,
    privilegedCredentialFindings: failures.size,
  }),
);
if (failures.size) {
  // Locations only: never output matched bytes or credentials.
  for (const f of failures) console.error(f);
  process.exitCode = 1;
}
