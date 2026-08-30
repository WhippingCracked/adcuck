#!/usr/bin/env node
/* Find filters instead of inventing them.
 *
 *   node tools/discover.mjs                        # a video, then the feeds
 *   node tools/discover.mjs https://www.youtube.com/watch?v=… …
 *
 * Loads real YouTube pages in a real browser, captures every player/browse
 * response and the live DOM, and reports the ad-shaped things it saw that the
 * current filter list does NOT cover. It writes feed/discovered.json, which
 * tools/add-filters.mjs then walks you through one at a time.
 *
 * Why this exists: hand-guessing renderer names ages badly, and YouTube
 * renames them freely. Reading what actually came down the wire is the only
 * way to keep a list honest. Run it monthly, or whenever something starts
 * leaking through.
 *
 * A watch page comes first on purpose. The ads worth catching - the pre-roll,
 * the skip button, the banner across the bottom of the player - only exist
 * while a video is actually playing. A run that never opened a video was only
 * ever seeing the smaller banner-and-promo family that lives on the feeds.
 *
 * What counts as ad-shaped lives in discover-match.mjs, where it can be
 * tested without a browser. This file is only the browser driving.
 *
 * It reads only; it changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { knownFrom, collectKeys, collectDom } from "./discover-match.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* A video first, because that is where the ads are. The feeds afterwards
 * catch the banner/promo family, which never appears on a watch page. */
const DEFAULT_PAGES = [
  "https://www.youtube.com/watch?v=mehJEqGjFAQ",
  "https://www.youtube.com/",
  "https://www.youtube.com/results?search_query=news"
];

const isWatch = (u) => /[?&]v=|\/shorts\//.test(u);

/* A link you give is visited FIRST, and the feeds are still visited after it.
 *
 * They find different families of ad: the pre-roll and the in-player
 * furniture only exist on a watch page, and the banner/promo units only exist
 * on the feeds. That did not matter much when runs piled onto an existing
 * list, but a fresh run writes down only what it sees - so a run that skipped
 * the feeds would silently drop every banner filter you had. */
const given = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const PAGES = given.length
  ? [...given, ...DEFAULT_PAGES.filter((p) => !isWatch(p))]
  : DEFAULT_PAGES;

function loadCurrent() {
  const src = fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8");
  return new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
}

const known = knownFrom(loadCurrent());

/* Collect EVERYTHING ad-shaped, not just what is missing from the current
 * list.
 *
 * This used to skip anything already covered, which was right when a run only
 * ever added to the list. It is wrong now that a run can replace it: an ad
 * that is still on the page but already in your filters would be left out of
 * the findings, and a fresh run would then drop the filter for it. The list
 * would get worse every single time you refreshed it.
 *
 * So the findings are the whole picture of what this run saw, and deciding
 * what is new is left to the report below and to add-filters.mjs. */
const nothingKnown = { keys: new Set(), tags: new Set(), classes: new Set() };
const isNew = (v) =>
  !known.keys.has(v) && !known.tags.has(v) && !known.classes.has(v.replace(/^\./, ""));

const seenKeys = new Map();     // renderer name -> times seen
const seenTags = new Map();     // element name  -> most seen at once
const seenClasses = new Map();  // class name    -> most seen at once
const samples = new Map();      // renderer name -> one small example

/* Runs inside the page. Returns every custom element name and every class
 * currently in the DOM, with counts; the deciding happens out here. */
function scrapeDom() {
  const tags = {};
  const classes = {};
  for (const el of document.querySelectorAll("*")) {
    const t = el.tagName.toLowerCase();
    if (t.includes("-")) tags[t] = (tags[t] || 0) + 1;
    const cl = el.getAttribute("class");
    if (!cl) continue;
    for (const c of cl.split(/\s+/)) if (c) classes[c] = (classes[c] || 0) + 1;
  }
  return { tags, classes };
}

/* ------------------------------------------------------------------ *
 * The cookie wall
 *
 * A brand new browser profile in the UK or EU lands on consent.youtube.com
 * and never reaches YouTube at all, so the run finds nothing and cannot say
 * why. Answer it the privacy-preserving way - Reject all - and if that button
 * is not there, say so plainly rather than reporting an empty result.
 * ------------------------------------------------------------------ */
const onConsent = (page) => /consent\.|\/consent/.test(page.url());

async function clearCookieWall(page) {
  if (!onConsent(page)) return true;
  process.stdout.write("  cookie wall - choosing Reject all\n");
  for (const name of [/^Reject all$/i, /^Reject$/i, /^Decline$/i]) {
    try {
      const b = page.getByRole("button", { name }).first();
      if (await b.isVisible({ timeout: 1500 })) {
        await b.click();
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
        return !onConsent(page);
      }
    } catch (e) {
      /* not this variant of the page */
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */

const browser = await chromium.launch({
  headless: false,
  args: [
    "--no-sandbox",
    /* Without this the pre-roll never starts, and an ad that never plays is
     * an ad we never see. Muted so it is not startling. */
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio"
  ]
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("response", async (res) => {
  if (!/\/youtubei\/v1\/(player|browse|next|search|reel)/.test(res.url())) return;
  try {
    collectKeys(await res.json(), nothingKnown, seenKeys, samples);
  } catch (e) {
    /* not JSON, or the page went away mid-flight */
  }
});

for (const url of PAGES) {
  const watch = isWatch(url);
  process.stdout.write(`visiting ${url}${watch ? "  (watching for ads)" : ""}\n`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    if (!(await clearCookieWall(page))) {
      console.error("  stuck on the cookie page - skipping this one");
      continue;
    }
    await page.waitForTimeout(2500);

    if (watch) {
      /* Ask the player to start. Pre-rolls are the whole reason for opening a
       * watch page, and they do not exist until playback begins. */
      await page.evaluate(() => {
        const v = document.querySelector("video");
        if (v && v.paused) v.play().catch(() => {});
      });
    }

    /* Ad overlays appear and vanish - the skip button lives for five seconds,
     * the banner goes when you dismiss it. A single snapshot at the end would
     * miss every one of them, so sample repeatedly and keep the union. */
    const rounds = watch ? 12 : 4;
    for (let i = 0; i < rounds; i++) {
      collectDom(await page.evaluate(scrapeDom), nothingKnown, seenTags, seenClasses);
      if (!watch && i === 1) await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(1500);
    }
    collectDom(await page.evaluate(scrapeDom), nothingKnown, seenTags, seenClasses);

    /* The inline bootstrap payloads never travel as a response. */
    const inline = await page.evaluate(() => ({
      player: window.ytInitialPlayerResponse || null,
      data: window.ytInitialData || null
    }));
    collectKeys(inline.player, nothingKnown, seenKeys, samples);
    collectKeys(inline.data, nothingKnown, seenKeys, samples);
  } catch (e) {
    console.error(`  failed: ${e.message}`);
  }
}

await browser.close();

const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

console.log("\n=== ad fields seen  (* = not in your current list) ===");
if (!seenKeys.size) console.log("  none");
for (const [k, n] of byCount(seenKeys)) {
  console.log(`  ${isNew(k) ? "*" : " "} ${String(n).padStart(4)}x  ${k}`);
  console.log(`        ${samples.get(k)}`);
}

console.log("\n=== ad elements seen  (* = not in your current list) ===");
if (!seenTags.size && !seenClasses.size) console.log("  none");
for (const [t, n] of byCount(seenTags)) console.log(`  ${isNew(t) ? "*" : " "} ${String(n).padStart(4)}x  ${t}`);
for (const [c, n] of byCount(seenClasses)) console.log(`  ${isNew("." + c) ? "*" : " "} ${String(n).padStart(4)}x  .${c}`);

const proposal = {
  adMarkers: byCount(seenKeys).map(([k]) => k),
  hide: [
    ...byCount(seenTags).map(([t]) => t),
    ...byCount(seenClasses).map(([c]) => `.${c}`)
  ]
};
const outFile = path.join(ROOT, "feed", "discovered.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(proposal, null, 2) + "\n");

const total = proposal.adMarkers.length + proposal.hide.length;
console.log(`\nwrote ${path.relative(ROOT, outFile)} - ${total} candidate(s)`);
console.log("Every entry is a guess until you have looked at it. Run");
console.log("add-filters.mjs next and it will ask you about each one.");
