#!/usr/bin/env node
/* Is the filter list actually all right?
 *
 *   node tools/guard-filters.mjs           # complain and exit 1 if not
 *   node tools/guard-filters.mjs --fix     # put it back from the last commit
 *
 * This exists because src/filters/filters.js has now gone wrong three times
 * on a live machine: twice losing most of its contents, once disappearing
 * altogether. I do not know what is doing it. What I can do is make sure the
 * damage is noticed at the two moments it matters - before a run adds to it,
 * and before it is pushed to everyone - instead of surfacing as a stack trace
 * or, far worse, as a published list that quietly blocks nothing.
 *
 * Everything it compares against is git, so there is nothing extra to keep up
 * to date: the last commit is the record of what the list should look like.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REL = "src/filters/filters.js";
const FILE = path.join(ROOT, REL);
const FIX = process.argv.includes("--fix");
/* A deliberate fresh run replaces the list, so it is smaller by design.
 * Shrinking then is not a fault - it just must never happen silently. */
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");

const load = (src) =>
  new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();

function fromGit() {
  try {
    const src = execFileSync("git", ["show", "HEAD:" + REL], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return { src, filters: load(src) };
  } catch (e) {
    return null;
  }
}

function restore() {
  execFileSync("git", ["checkout", "--", REL], { cwd: ROOT, stdio: "ignore" });
}

function die(lines, code = 1) {
  console.error("");
  for (const l of lines) console.error("  " + l);
  console.error("");
  process.exit(code);
}

/* --- is it even there? ------------------------------------------------- */

if (!fs.existsSync(FILE)) {
  const head = fromGit();
  if (FIX && head) {
    restore();
    console.log(`\n  src\\filters\\filters.js was missing - put back from your`);
    console.log(`  last save. ${head.filters.hide.length} filters restored.\n`);
    process.exit(0);
  }
  die([
    "Your filter list is missing.",
    "",
    "  src\\filters\\filters.js is not there at all. Something deleted it.",
    "",
    "  Nothing is lost - it is in your last save. To put it back:",
    "",
    "      git checkout -- src/filters/filters.js",
    "",
    "  If this keeps happening, check whether antivirus or a backup",
    "  program is removing it."
  ]);
}

/* --- does it still load? ----------------------------------------------- */

let now;
try {
  now = load(fs.readFileSync(FILE, "utf8"));
} catch (e) {
  die([
    "Your filter list is damaged and will not load.",
    "",
    "  " + e.message,
    "",
    "  To go back to your last save:",
    "",
    "      git checkout -- src/filters/filters.js"
  ]);
}

/* --- empty ------------------------------------------------------------
 *
 * Empty is not damaged. It is exactly what a reset leaves behind, and
 * 1-get-filters is the thing that fills it back up - so refusing to run on an
 * empty list locks you out of the only way to fix it. (It did. Sorry.)
 *
 * Before a run: say so and carry on. Before a push: stop, because an empty
 * list published to everyone turns their ad blocking off. */
if (!Array.isArray(now.hide)) {
  die(["Your filter list is damaged - the hide list is not a list at all."]);
}

if (!now.hide.length) {
  if (ALLOW_SHRINK) {
    console.log("  Filter list is empty - a run will fill it back up.");
  } else {
    die([
      "Your filter list is empty.",
      "",
      "  Nothing would be blocked. Sending this to everyone would turn",
      "  their ad blocking off.",
      "",
      "  Run 1-get-filters.bat to fill it back up, or put your old list",
      "  back with:",
      "",
      "      git checkout -- src/filters/filters.js"
    ], 2);
  }
}

/* --- has it shrunk since the last save? --------------------------------
 *
 * Filters get added, essentially never removed. A list that has got shorter
 * on its own is the shape of every problem so far, and it is the one worth
 * catching before a push: nobody notices missing filters until the ads come
 * back, and by then everyone has the bad list. */

const head = fromGit();
if (head) {
  const lost = head.filters.hide.filter((s) => !now.hide.includes(s));
  const lostKeys = head.filters.response.adMarkers.filter(
    (s) => !now.response.adMarkers.includes(s)
  );
  if (lost.length || lostKeys.length) {
    if (ALLOW_SHRINK) {
      console.log(
        `  Note: ${lost.length + lostKeys.length} filter(s) are no longer in the ` +
          `list compared with your last save.`
      );
    } else die([
      `${lost.length + lostKeys.length} filter(s) have gone missing since your last save.`,
      "",
      ...lost.slice(0, 12).map((s) => "    " + s),
      ...(lost.length > 12 ? [`    ...and ${lost.length - 12} more`] : []),
      ...lostKeys.slice(0, 6).map((s) => "    " + s),
      "",
      "  If you meant to remove them, save that change first and run again.",
      "  If you did not, put them back with:",
      "",
      "      git checkout -- src/filters/filters.js"
    ], 2);
  }
}

/* Saying "looks fine - 0 to hide" two lines after "the list is empty" reads
 * as the tool contradicting itself. It already said its piece. */
if (now.hide.length) {
  console.log(
    `  Filter list looks fine - ${now.hide.length} to hide, ` +
      `${now.response.adMarkers.length} field names.`
  );
}
