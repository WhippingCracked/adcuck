#!/usr/bin/env node
/* Review what discover.mjs found, and add what you approve.
 *
 *   node tools/add-filters.mjs
 *
 * The point of the earlier "read it before using it" warning was never that a
 * human must retype things into a source file - it was that a human must
 * DECIDE. This asks about each candidate one at a time and does the editing
 * itself, which is the same safeguard with none of the fiddling.
 *
 * Nothing is written until every question is answered, the file is backed up
 * first, and the result is re-parsed before the backup is dropped. A filter
 * list that will not load is worse than one that misses an ad.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILTERS = path.join(ROOT, "src/filters/filters.js");
const FOUND = path.join(ROOT, "feed/discovered.json");

function load(src) {
  return new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
}

/* Find the array literal for `key` and return the span between its brackets.
 * Brackets inside string literals do not count - selectors like
 * ytd-thing[target-id='x'] are full of them, and a naive counter walks
 * straight off the end of the file. */
function arraySpan(src, key) {
  const open = src.indexOf(key + ": [");
  if (open === -1) return null;
  let i = src.indexOf("[", open);
  const from = i;
  let depth = 0;
  let quote = null;

  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return { from, to: i };
    }
  }
  return null;
}

function insertInto(src, key, items) {
  if (!items.length) return src;
  const span = arraySpan(src, key);
  if (!span) throw new Error(`could not find the ${key} list in filters.js`);

  const body = src.slice(span.from + 1, span.to);
  const lines = body.split("\n").filter((l) => l.trim());
  const last = lines[lines.length - 1] || '    ""';
  const indent = (last.match(/^\s*/) || ["    "])[0];

  const additions = items.map((v) => `${indent}${JSON.stringify(v)}`).join(",\n");
  const joined = body.trimEnd().replace(/,\s*$/, "") + ",\n" + additions + "\n" + indent.slice(0, -2);

  return src.slice(0, span.from + 1) + joined + src.slice(span.to);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/* If the input goes away mid-question - the console is closed, or this was
 * run with nothing piped in - `rl.question` never calls back and the process
 * hangs on an await that can never settle. Resolving to "q" turns that into
 * the ordinary stop-here path, which changes nothing. */
let closed = false;
rl.on("close", () => { closed = true; });
const ask = (q) =>
  new Promise((r) => {
    if (closed) return r("q");
    const bail = () => r("q");
    rl.once("close", bail);
    rl.question(q, (a) => {
      rl.off("close", bail);
      r(a.trim().toLowerCase());
    });
  });

/* ---------------------------------------------------------------------- */

if (!fs.existsSync(FOUND)) {
  console.log("\n  Nothing to review yet.\n");
  console.log("  Run 1-get-filters.bat first - it looks at YouTube and writes");
  console.log("  down anything ad-shaped that you are not blocking.\n");
  rl.close();
  process.exit(0);
}

const found = JSON.parse(fs.readFileSync(FOUND, "utf8"));
const src = fs.readFileSync(FILTERS, "utf8");
const current = load(src);

/* Anything already covered is not worth asking about. */
const haveHide = new Set(current.hide.concat(current.remove));
const haveKeys = new Set(current.response.adMarkers.concat(current.response.playerKeys));

const candidates = [
  ...(found.hide || [])
    .filter((v) => !haveHide.has(v))
    .map((v) => ({ v, kind: "hide", what: "An element on the page" })),
  ...(found.adMarkers || [])
    .filter((v) => !haveKeys.has(v))
    .map((v) => ({ v, kind: "adMarkers", what: "A field inside YouTube's data" }))
];

if (!candidates.length) {
  console.log("\n  Nothing new - your list already covers everything found.\n");
  rl.close();
  process.exit(0);
}

console.log(`\n  Found ${candidates.length} thing(s) you are not blocking yet.\n`);
console.log("  Some of these will be real videos that just have \"ad\" in the");
console.log("  name. Blocking those would hide things you want to watch, so");
console.log("  say no if you are unsure - you can always add it later.\n");
console.log("  y = block it    n = leave it    q = stop here\n");

const accept = { hide: [], adMarkers: [] };
let stopped = false;

for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  console.log(`  ${"-".repeat(52)}`);
  console.log(`  ${i + 1} of ${candidates.length}   ${c.what}`);
  console.log(`  ${c.v}\n`);

  let a = "";
  while (!["y", "n", "q"].includes(a)) a = await ask("  Block it? [y/n/q] ");
  if (a === "q") { stopped = true; break; }
  if (a === "y") accept[c.kind].push(c.v);
  console.log("");
}

rl.close();

const total = accept.hide.length + accept.adMarkers.length;
if (!total) {
  console.log(`\n  Nothing added${stopped ? " (stopped early)" : ""}. filters.js is unchanged.\n`);
  process.exit(0);
}

/* Back up, write, then prove the result still loads. */
const backup = FILTERS + ".backup";
fs.writeFileSync(backup, src);

try {
  let next = src;
  next = insertInto(next, "hide", accept.hide);
  next = insertInto(next, "adMarkers", accept.adMarkers);
  fs.writeFileSync(FILTERS, next);

  const after = load(fs.readFileSync(FILTERS, "utf8"));
  for (const v of accept.hide) {
    if (!after.hide.includes(v)) throw new Error(`${v} did not make it into the list`);
  }
  for (const v of accept.adMarkers) {
    if (!after.response.adMarkers.includes(v)) throw new Error(`${v} did not make it into the list`);
  }
  if (after.hide.length !== current.hide.length + accept.hide.length) {
    throw new Error("the list came out the wrong length");
  }

  fs.rmSync(backup);
  console.log(`\n  Added ${total} filter(s) to src/filters/filters.js\n`);
  accept.hide.forEach((v) => console.log(`    ${v}`));
  accept.adMarkers.forEach((v) => console.log(`    ${v}`));
  console.log("\n  Next: run 2-check.bat, then 3-send-it.bat\n");
} catch (err) {
  fs.copyFileSync(backup, FILTERS);
  fs.rmSync(backup);
  console.error(`\n  Could not edit the file safely: ${err.message}`);
  console.error("  Nothing was changed - filters.js is exactly as it was.\n");
  process.exit(1);
}
