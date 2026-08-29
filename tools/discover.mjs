#!/usr/bin/env node
/* Find filters instead of inventing them.
 *
 *   node tools/discover.mjs                        # a default set of pages
 *   node tools/discover.mjs https://www.youtube.com/watch?v=… …
 *
 * Loads real YouTube pages in a real browser, captures every player/browse
 * response and the live DOM, and reports the ad-shaped things it saw that the
 * current filter list does NOT cover. Output is a JSON block ready to paste
 * into src/filters/filters.js.
 *
 * Why this exists: hand-guessing renderer names ages badly, and YouTube renames
 * them freely. Reading what actually came down the wire is the only way to keep
 * a list honest. Run it monthly, or whenever something starts leaking through.
 *
 * It reads only; it changes nothing. Nothing is applied without you looking at
 * it first, because a filter list is exactly the kind of thing that should not
 * be updated by a machine unattended.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://www.youtube.com/",
      "https://www.youtube.com/feed/trending",
      "https://www.youtube.com/results?search_query=news"
    ];

/* Anything whose name reads like an advert. Deliberately wide - this is a
 * candidate list for a human to filter, not something applied automatically. */
const SUSPECT = /(^|[A-Za-z])(ad|ads|advert|promo|promoted|sponsor|masthead|payment|premium|mealbar|enforcement)([A-Z]|$)/;
const RENDERER = /(Renderer|ViewModel)$/;

function loadCurrent() {
  const src = fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8");
  return new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
}

const F = loadCurrent();
const known = new Set([...F.response.adMarkers, ...F.response.playerKeys]);
const knownTags = new Set(
  F.hide.concat(F.remove).map((s) => s.toLowerCase().replace(/[[:.].*$/, ""))
);

const seenKeys = new Map();   // renderer name -> times seen
const seenTags = new Map();   // element name  -> times seen
const samples = new Map();    // renderer name -> one small example

function walk(node, depth) {
  if (!node || typeof node !== "object" || depth > 20) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if ((RENDERER.test(k) || k.endsWith("Params")) && SUSPECT.test(k) && !known.has(k)) {
      seenKeys.set(k, (seenKeys.get(k) || 0) + 1);
      if (!samples.has(k)) {
        const s = JSON.stringify(v);
        samples.set(k, s.length > 220 ? s.slice(0, 220) + "…" : s);
      }
    }
    walk(v, depth + 1);
  }
}

const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("response", async (res) => {
  const url = res.url();
  if (!/\/youtubei\/v1\/(player|browse|next|search)/.test(url)) return;
  try {
    walk(await res.json(), 0);
  } catch (e) {
    /* not JSON, or already consumed */
  }
});

for (const url of PAGES) {
  process.stdout.write(`visiting ${url}\n`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(3000);

    /* The inline bootstrap payloads never travel as a response. */
    const inline = await page.evaluate(() => ({
      player: window.ytInitialPlayerResponse || null,
      data: window.ytInitialData || null
    }));
    walk(inline.player, 0);
    walk(inline.data, 0);

    /* And whatever ad-shaped custom elements actually rendered. */
    const tags = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("*")) {
        const t = el.tagName.toLowerCase();
        if (!t.includes("-")) continue;
        out[t] = (out[t] || 0) + 1;
      }
      return out;
    });
    for (const [tag, n] of Object.entries(tags)) {
      if (!SUSPECT.test(tag.replace(/-/g, "")) ) continue;
      if (knownTags.has(tag)) continue;
      seenTags.set(tag, (seenTags.get(tag) || 0) + n);
    }
  } catch (e) {
    console.error(`  failed: ${e.message}`);
  }
}

await browser.close();

const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

console.log("\n=== response fields not in the current list ===");
if (!seenKeys.size) console.log("  none - the list covers everything seen");
for (const [k, n] of byCount(seenKeys)) {
  console.log(`  ${String(n).padStart(4)}x  ${k}`);
  console.log(`        ${samples.get(k)}`);
}

console.log("\n=== elements not in the current list ===");
if (!seenTags.size) console.log("  none");
for (const [t, n] of byCount(seenTags)) console.log(`  ${String(n).padStart(4)}x  ${t}`);

const proposal = {
  adMarkers: byCount(seenKeys).map(([k]) => k),
  hide: byCount(seenTags).map(([t]) => t)
};
const outFile = path.join(ROOT, "feed", "discovered.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(proposal, null, 2) + "\n");

console.log(`\nwrote ${path.relative(ROOT, outFile)}`);
console.log("Read it before using it. Every entry is a guess until you have");
console.log("checked what it actually is - some of these will be real content.");
