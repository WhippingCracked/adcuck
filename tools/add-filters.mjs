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
import { sync } from "./sync-interceptor.mjs";
import { verdict } from "./never-block.mjs";
import {
  ROOT, FILTERS, load, readFilters, rewriteArray, appendTo, writeChecked
} from "./edit-filters.mjs";

/* --auto adds what is unambiguously an advert without asking. 1-get-filters
 * uses it; `npm run add` without it still walks you through one at a time. */
const AUTO = process.argv.includes("--auto");

/* --fresh REPLACES the ad filters with what this run found, instead of adding
 * to what was already there. It is what keeps the list a picture of YouTube
 * as it is now rather than a pile of everything it has ever been.
 *
 * It only ever clears the two lists a run can rebuild. The player fields, the
 * removal rules and the enforcement wording are never touched - nothing on an
 * ordinary page would ever put those back. */
const FRESH = process.argv.includes("--fresh");

const FOUND = path.join(ROOT, "feed/discovered.json");

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
const { src, filters: current } = readFilters();

/* Anything already covered is not worth asking about - unless the list is
 * about to be replaced, in which case everything found has to be considered
 * again or it would be dropped for being "already there". */
const haveHide = FRESH ? new Set(current.remove) : new Set(current.hide.concat(current.remove));
const haveKeys = FRESH
  ? new Set(current.response.playerKeys)
  : new Set(current.response.adMarkers.concat(current.response.playerKeys));

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

const accept = { hide: [], adMarkers: [] };
const refused = [];
const setAside = [];
let stopped = false;

if (AUTO) {
  /* Nothing is asked. The protected list in never-block.mjs is what makes
   * that safe: it cannot add page structure, the player or its controls, so
   * the worst case is a filter that hides nothing rather than one that hides
   * YouTube. Anything ad-shaped whose ad-word is one of the unreliable ones
   * is set aside instead of added - that is where every false positive so far
   * has come from. */
  console.log(`\n  Found ${candidates.length} thing(s) you are not blocking yet.\n`);
  for (const c of candidates) {
    const v = verdict(c.v);
    if (v === "refuse") refused.push(c.v);
    else if (v === "unsure") setAside.push(c.v);
    else accept[c.kind].push(c.v);
  }
} else {
  console.log(`\n  Found ${candidates.length} thing(s) you are not blocking yet.\n`);
  console.log("  Some of these will be real videos that just have \"ad\" in the");
  console.log("  name. Blocking those would hide things you want to watch, so");
  console.log("  say no if you are unsure - you can always add it later.\n");
  console.log("  y = block it    n = leave it    q = stop here\n");

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
}

rl.close();

/* Say what was left out before saying what went in - the things not added are
 * the ones worth a second of attention. */
function reportSkipped() {
  if (refused.length) {
    console.log(`\n  Refused ${refused.length} - these are parts of YouTube, not adverts:`);
    refused.forEach((v) => console.log(`    ${v}`));
  }
  if (setAside.length) {
    console.log(`\n  Set aside ${setAside.length} - ad-shaped, but the word could`);
    console.log("  mean something else. To look at these yourself, run:  npm run add");
    setAside.forEach((v) => console.log(`    ${v}`));
  }
}

const total = accept.hide.length + accept.adMarkers.length;
if (!total) {
  reportSkipped();
  console.log(`\n  Nothing added${stopped ? " (stopped early)" : ""}. filters.js is unchanged.\n`);
  process.exit(0);
}

/* Write it, then prove the result still loads and says what it should. */
try {
  let next = src;
  if (FRESH) {
    next = rewriteArray(next, "hide", accept.hide);
    next = rewriteArray(next, "adMarkers", accept.adMarkers);
  } else {
    next = appendTo(next, "hide", accept.hide);
    next = appendTo(next, "adMarkers", accept.adMarkers);
  }

  const wantHide = FRESH ? accept.hide.length : current.hide.length + accept.hide.length;
  const wantKeys = FRESH
    ? accept.adMarkers.length
    : current.response.adMarkers.length + accept.adMarkers.length;

  writeChecked(src, next, (after) => {
    for (const v of accept.hide) {
      if (!after.hide.includes(v)) throw new Error(`${v} did not make it into the list`);
    }
    for (const v of accept.adMarkers) {
      if (!after.response.adMarkers.includes(v)) throw new Error(`${v} did not make it into the list`);
    }
    if (after.hide.length !== wantHide) throw new Error("the list came out the wrong length");
    if (after.response.adMarkers.length !== wantKeys) {
      throw new Error("the field names came out the wrong length");
    }
    /* Whatever else happens, these must survive a fresh run untouched. */
    if (after.response.playerKeys.length !== current.response.playerKeys.length) {
      throw new Error("the player fields were touched");
    }
    if (after.remove.length !== current.remove.length) {
      throw new Error("the removal rules were touched");
    }

    /* The part of the extension that runs first carries its own copy of the
     * field names - it starts before anything can hand it filters.js. Editing
     * one copy and not the other leaves new filters that quietly do nothing.
     *
     * It sits inside the check on purpose: anything that throws in here puts
     * filters.js back, so the two files are written together or neither is. */
    sync();
  });

  reportSkipped();
  console.log(
    FRESH
      ? `\n  Filter list replaced - ${total} filter(s), found on this run:\n`
      : `\n  Added ${total} filter(s) to src/filters/filters.js\n`
  );
  accept.hide.forEach((v) => console.log(`    ${v}`));
  accept.adMarkers.forEach((v) => console.log(`    ${v}`));
  console.log("\n  Next: run 2-check.bat, then 3-send-it.bat");
  console.log("  To undo all of it:  git checkout src/filters/filters.js\n");
} catch (err) {
  /* writeChecked has already put the original back. */
  console.error(`\n  Could not edit the file safely: ${err.message}`);
  console.error("  Nothing was changed - filters.js is exactly as it was.\n");
  process.exit(1);
}
