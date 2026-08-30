#!/usr/bin/env node
/* Empty the ad filters so a run can fill them in fresh.
 *
 *   node tools/reset-filters.mjs          # ask first
 *   node tools/reset-filters.mjs --yes    # do it
 *
 * Clears the two lists that a discovery run rebuilds:
 *
 *   hide                 the selectors for ad elements on the page
 *   response.adMarkers   the field names for ad units inside YouTube's data
 *
 * and deliberately leaves alone the parts a run can NEVER find, because they
 * are not ad-shaped and never appear on an ordinary page:
 *
 *   response.playerKeys  adPlacements, adSlots, playerAds and friends. This
 *                        is the actual ad blocking - strip these and the
 *                        player goes back to playing adverts.
 *   remove               the anti-adblock dialog and the grid cells that
 *                        would otherwise be left behind as empty gaps.
 *   enforcement          the wording of the "ad blockers are not allowed"
 *                        message, which only appears once you are blocking.
 *   unlock               undoing the scroll lock that dialog leaves.
 *
 * Those eleven-odd entries are hand-written and do not go stale, so they were
 * never the clutter. The two lists above are the ones that churn - YouTube
 * renames those constantly - and those are the ones worth rebuilding.
 */
import readline from "node:readline";
import { readFilters, rewriteArray, writeChecked } from "./edit-filters.mjs";

const YES = process.argv.includes("--yes");

const { src, filters } = readFilters();
const hadHide = filters.hide.length;
const hadKeys = filters.response.adMarkers.length;

if (!hadHide && !hadKeys) {
  console.log("\n  Already empty - nothing to clear.\n");
  process.exit(0);
}

console.log(`\n  This clears ${hadHide} page filter(s) and ${hadKeys} field name(s).`);
console.log("\n  Kept, because a run can never find them again:");
console.log(`    ${filters.response.playerKeys.length} player fields  (${filters.response.playerKeys.slice(0, 3).join(", ")}...)`);
console.log(`    ${filters.remove.length} removal rules  (the anti-adblock popup)`);
console.log(`    ${filters.enforcement.phrases.length} enforcement phrases`);
console.log("\n  Undo at any point with:  git checkout -- src/filters/filters.js\n");

async function confirm() {
  if (YES) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => {
    rl.once("close", () => r("n"));
    rl.question("  Clear them? [y/N] ", (v) => r(v.trim().toLowerCase()));
  });
  rl.close();
  return a === "y";
}

if (!(await confirm())) {
  console.log("\n  Left alone. Nothing changed.\n");
  process.exit(0);
}

let next = rewriteArray(src, "hide", []);
next = rewriteArray(next, "adMarkers", []);

const after = writeChecked(src, next, (f) => {
  if (f.hide.length !== 0) throw new Error("hide did not clear");
  if (f.response.adMarkers.length !== 0) throw new Error("adMarkers did not clear");
  /* The whole point is that these survive. */
  if (f.response.playerKeys.length !== filters.response.playerKeys.length) {
    throw new Error("the player fields were touched");
  }
  if (f.remove.length !== filters.remove.length) throw new Error("the removal rules were touched");
  if (f.enforcement.phrases.length !== filters.enforcement.phrases.length) {
    throw new Error("the enforcement wording was touched");
  }
});

console.log(`  Cleared. ${after.response.playerKeys.length} player fields and`);
console.log(`  ${after.remove.length} removal rules kept.\n`);
console.log("  Run 1-get-filters.bat to fill it back up.\n");
