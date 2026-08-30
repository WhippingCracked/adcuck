/* End-to-end check for AdCuck.
 *
 * Loads the unpacked extension into Chromium and serves a synthetic YouTube
 * page at the real origin (so the content scripts actually match), then
 * asserts that each layer did its job.
 *
 *   node test/e2e.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
}

const FILTERS = new Function(
  "var globalThis = {};" +
    fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8") +
    "\nreturn CB_FILTERS;"
)();

/* The fixtures below used to hard-code "adSlotRenderer". That was fine while
 * the filter list only ever grew, but a run now rebuilds it from whatever
 * YouTube happened to show that day - so naming any one marker and demanding
 * the extension strip it tests the weather, not the code. Take the marker
 * from the list that actually shipped instead. */
if (!FILTERS.hide.length || !FILTERS.response.adMarkers.length) {
  console.error("\n  Your filter list is empty, so there is nothing here to test.");
  console.error("  Nothing would be blocked at all.\n");
  console.error("  Run 1-get-filters.bat to fill it back up, then check again.\n");
  process.exit(1);
}
const AD_MARKER = FILTERS.response.adMarkers[0];
/* A second, different marker where the fixture needs one - falling back to
 * the first if the list only has one entry. */
const AD_MARKER_2 = FILTERS.response.adMarkers[1] || AD_MARKER;

const PLAYER_RESPONSE = {
  responseContext: {},
  playabilityStatus: {
    status: "UNPLAYABLE",
    reason: "Ad blockers are not allowed on YouTube"
  },
  videoDetails: { videoId: "dQw4w9WgXcQ", channelId: "UCtest123", author: "Test Channel" },
  adPlacements: [{ adPlacementRenderer: { config: {} } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{ [AD_MARKER]: {} }],
  adBreakHeartbeatParams: "abc",
  streamingData: { formats: [{ itag: 18 }] },
  onResponseReceivedActions: [
    { openPopupAction: { popup: { someRenamedViewModel: {
        title: "Experiencing interruptions?",
        subtitle: "Find out why" } } } },
    { appendContinuationItemsAction: { items: [{ videoRenderer: { videoId: "keepme" } }] } }
  ]
};

/* An ad-gated response with no streamingData. Faking "OK" here would leave
 * the player with no URLs to fetch, so it polls and retries - which is the
 * long stall we are trying to remove, caused by us. */
const GATED_RESPONSE = {
  playabilityStatus: {
    status: "UNPLAYABLE",
    reason: "Ad blockers are not allowed on YouTube"
  },
  videoDetails: { videoId: "gated1", channelId: "UCgated", author: "Gated" }
};

/* What the embedded-player client returns: same video, no ads in it at all.
 * This is the whole point of the ad-free path - the player never arms its ad
 * module, so there is nothing for it to wait on. */
const AD_FREE_RESPONSE = {
  responseContext: {},
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "dQw4w9WgXcQ", channelId: "UCtest123", author: "Test Channel" },
  streamingData: { formats: [{ itag: 18 }] },
  cbSource: "embedded"
};

const INITIAL_DATA = {
  contents: {
    richGridRenderer: {
      contents: [
        { richItemRenderer: { content: { videoRenderer: { videoId: "real1" } } } },
        { richItemRenderer: { content: { [AD_MARKER]: { marked: true } } } },
        { richItemRenderer: { content: { videoRenderer: { videoId: "real2" } } } },
        { richSectionRenderer: { content: { [AD_MARKER_2]: { marked: true } } } },
        { richItemRenderer: { content: { videoRenderer: {
            videoId: "decoy",
            title: { runs: [{ text: "Why ad blockers are not allowed anymore - explained" }] } } } } },
        { openPopupAction: { popup: { someRenamedViewModel: {
            title: "Experiencing interruptions?", subtitle: "Find out why" } } } }
      ]
    }
  }
};

/* A real 20-second clip, so the sponsor skip can be tested by actually
 * playing something rather than by trusting the code. 3KB of black frames. */
const CLIP_B64 = "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WC/0AAiOgACjloEBkADRAQABEBAAGAAYWC/0AAiOgACjloECWADRAQABEBAAGAAYWC/0AAiOgACjloEDIADRAQABEBAAGAAYWC/0AAiOgACjloED6ADRAQABEBAAGAAYWC/0AAiOgACjloEEsADRAQABEBAAGAAYWC/0AAiOgACjloEFeADRAQABEBAAGAAYWC/0AAiOgACjloEGQADRAQABEBAAGAAYWC/0AAiOgACjloEHCADRAQABEBAAGAAYWC/0AAiOgACjloEH0ADRAQABEBAUYABhYL/QACI6AACjloEImADRAQABEBAAGAAYWC/0AAiOgACjloEJYADRAQABEBAAGAAYWC/0AAiOgACjloEKKADRAQABEBAAGAAYWC/0AAiOgACjloEK8ADRAQABEBAAGAAYWC/0AAiOgACjloELuADRAQABEBAAGAAYWC/0AAiOgACjloEMgADRAQABEBAAGAAYWC/0AAiOgACjloENSADRAQABEBAAGAAYWC/0AAiOgACjloEOEADRAQABEBAAGAAYWC/0AAiOgACjloEO2ADRAQABEBAAGAAYWC/0AAiOgACjloEPoADRAQABEBAAGAAYWC/0AAiOgACjloEQaADRAQABEBAUYABhYL/QACI6AACjloERMADRAQABEBAAGAAYWC/0AAiOgACjloER+ADRAQABEBAAGAAYWC/0AAiOgACjloESwADRAQABEBAAGAAYWC/0AAiOgACjloETiADRAQABEBAAGAAYWC/0AAiOgAAfQ7Z1QhTngjzwo5aBAAAA0QEAARAQABgAGFgv9AAIjoAAo5aBAMgA0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAo5aBAlgA0QEAARAQABgAGFgv9AAIjoAAo5aBAyAA0QEAARAQABgAGFgv9AAIjoAAo5aBA+gA0QEAARAQABgAGFgv9AAIjoAAo5aBBLAA0QEAARAQFGAAYWC/0AAiOgAAo5aBBXgA0QEAARAQABgAGFgv9AAIjoAAo5aBBkAA0QEAARAQABgAGFgv9AAIjoAAo5aBBwgA0QEAARAQABgAGFgv9AAIjoAAo5aBB9AA0QEAARAQABgAGFgv9AAIjoAAo5aBCJgA0QEAARAQABgAGFgv9AAIjoAAo5aBCWAA0QEAARAQABgAGFgv9AAIjoAAo5aBCigA0QEAARAQABgAGFgv9AAIjoAAo5aBCvAA0QEAARAQABgAGFgv9AAIjoAAo5aBC7gA0QEAARAQABgAGFgv9AAIjoAAo5aBDIAA0QEAARAQABgAGFgv9AAIjoAAo5aBDUgA0QEAARAQFGAAYWC/0AAiOgAAo5aBDhAA0QEAARAQABgAGFgv9AAIjoAAo5aBDtgA0QEAARAQABgAGFgv9AAIjoAAo5aBD6AA0QEAARAQABgAGFgv9AAIjoAAo5aBEGgA0QEAARAQABgAGFgv9AAIjoAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw==";

const SB_SEGMENTS = [
  {
    videoID: "dQw4w9WgXcQ",
    segments: [
      { UUID: "seg-1", segment: [4, 12], category: "sponsor", votes: 5, actionType: "skip" },
      { UUID: "seg-2", segment: [30, 40], category: "music_offtopic", votes: 2, actionType: "skip" }
    ]
  },
  { videoID: "someOtherVideo", segments: [{ UUID: "x", segment: [0, 99], category: "sponsor", votes: 1 }] }
];

const PAGE = `<!doctype html><html><head><title>Test - YouTube</title></head><body>
<ytd-app>
  <ytd-masthead><div id="end"><div id="buttons">avatar</div></div></ytd-masthead>
  <div id="masthead-ad">MASTHEAD AD</div>
  <ytd-ad-slot-renderer id="feedad">FEED AD</ytd-ad-slot-renderer>
  <ytd-rich-item-renderer id="richad"><ytd-ad-slot-renderer></ytd-ad-slot-renderer></ytd-rich-item-renderer>
  <ytd-video-renderer id="realvideo">REAL VIDEO</ytd-video-renderer>
  <div id="movie_player" class="ad-showing"><video id="v" src="/clip.webm" muted></video></div>
  <tp-yt-paper-toast id="toastmsg">Experiencing interruptions? Find out why.</tp-yt-paper-toast>
  <tp-yt-paper-toast id="toastok">Added to queue</tp-yt-paper-toast>
</ytd-app>
<script>
  window.ytInitialPlayerResponse = ${JSON.stringify(PLAYER_RESPONSE)};
  window.ytInitialData = ${JSON.stringify(INITIAL_DATA)};
</script>
</body></html>`;

/* --- versioning discipline --------------------------------------------
 * The changelog is the single source of truth for the version. These checks
 * are what make "always bump the version" impossible to forget rather than
 * merely intended. */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const CHANGELOG = new Function(
  "var globalThis = {};" +
    fs.readFileSync(path.join(ROOT, "src/changelog.js"), "utf8") +
    "\nreturn CHANGELOG;"
)();

check(
  "manifest version matches the top changelog entry",
  manifest.version === CHANGELOG[0].version,
  `manifest ${manifest.version} vs changelog ${CHANGELOG[0].version}`
);
check(
  "package.json version matches too",
  pkg.version === CHANGELOG[0].version,
  `package ${pkg.version}`
);
check(
  "changelog versions are unique and descending",
  CHANGELOG.every((r, i) => i === 0 || cmp(CHANGELOG[i - 1].version, r.version) > 0),
  CHANGELOG.map((r) => r.version).join(" > ")
);

/* The wording rules, enforced rather than remembered. */
const tooMany = CHANGELOG.filter((r) => r.changes.length > 3).map((r) => r.version);
check("No release lists more than 3 changes", tooMany.length === 0, tooMany.join(", "));

const tooLong = CHANGELOG.flatMap((r) =>
  r.changes.filter((c) => c.length > 64).map((c) => `${r.version}: ${c}`)
);
check("Every changelog line fits the popup (<=64 chars)", tooLong.length === 0, tooLong.join(" | "));

const jargon = /\b(refactor|quadratic|regex|async|API|JSON|selector|MutationObserver|manifest)\b/i;
const jargony = CHANGELOG.flatMap((r) => r.changes.filter((c) => jargon.test(c)));
check("Changelog stays free of jargon", jargony.length === 0, jargony.join(" | "));

function cmp(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/* --- the two copies of the response key lists must never drift ----------
 * interceptor.js needs them inline (it runs before anything async can load);
 * filters.js holds the copy the update feed ships. Duplication is only safe
 * while something checks it. */
const interceptorSrc = fs.readFileSync(
  path.join(ROOT, "src/inject/interceptor.js"), "utf8"
);
function inlineList(name) {
  const m = interceptorSrc.match(new RegExp("var " + name + " = \\[([\\s\\S]*?)\\];"));
  if (!m) return null;
  return m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}
for (const [listName, fromFilters] of [
  ["PLAYER_KEYS", FILTERS.response.playerKeys],
  ["AD_MARKERS", FILTERS.response.adMarkers],
  ["AD_GATE_REASONS", FILTERS.response.adGateReasons]
]) {
  const inline = inlineList(listName);
  check(
    `${listName} matches filters.js`,
    inline !== null && inline.join("|") === fromFilters.join("|"),
    inline === null ? "could not parse" : `${inline.length} vs ${fromFilters.length}`
  );
}

/* --- the feed the updater will actually read --------------------------- */
const feedDir = path.join(ROOT, "feed", "v1");
if (fs.existsSync(path.join(feedDir, "manifest.json"))) {
  const fm = JSON.parse(fs.readFileSync(path.join(feedDir, "manifest.json"), "utf8"));
  check("Feed manifest has a version and files", !!fm.listVersion && fm.files.length > 0);
  let hashesOk = true;
  for (const f of fm.files) {
    const body = fs.readFileSync(path.join(feedDir, f.url), "utf8");
    const got = crypto.createHash("sha256").update(body, "utf8").digest("hex");
    if (got !== f.sha256) hashesOk = false;
  }
  check("Every feed file matches its checksum", hashesOk);
  const net = JSON.parse(
    fs.readFileSync(path.join(feedDir, fm.files.find((f) => f.name === "network").url), "utf8")
  );
  check(
    "Feed rules use the reserved id range, so they cannot clash with the packaged ones",
    net.every((r) => r.id >= 1000 && r.id <= 9999),
    net.map((r) => r.id).join(",")
  );
  check(
    "No feed rule can block a page's main frame",
    net.every((r) => !(r.condition.resourceTypes || []).includes("main_frame"))
  );
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-profile-"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    /* Chrome 137 turned --load-extension off by default. Without this the
     * browser starts perfectly happily with no extension in it, and every
     * check below fails for a reason none of them mention. */
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-sandbox",
    "--no-first-run"
  ]
});

// Serve the synthetic page (and a synthetic innertube endpoint) at the real
// origin so the manifest's match patterns apply.
const sbRequests = [];
/* The extension checks the published filter feed as soon as it installs, and
 * whatever is live on GitHub then REPLACES the bundled list. That made this
 * suite depend on what happened to be published at the moment it ran: the
 * same commit passed here and failed on another machine, because one of them
 * could reach github.io and the other could not, and the published list was
 * older than the one in the repo.
 *
 * A test that asks the internet what it should expect is not a test. Block it
 * so what gets checked is the list actually in this working copy. */
let feedRequests = 0;
await ctx.route("**github.io/**", async (route) => {
  feedRequests++;
  await route.abort();
});

await ctx.route("**sponsor.ajay.app**", async (route) => {
  sbRequests.push(route.request().url());
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(SB_SEGMENTS)
  });
});

await ctx.route("**://*.youtube.com/**", async (route) => {
  const url = route.request().url();
  if (url.includes("/clip.webm")) {
    return route.fulfill({
      status: 200,
      contentType: "video/webm",
      body: Buffer.from(CLIP_B64, "base64")
    });
  }
  if (url.includes("gated=1")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(GATED_RESPONSE)
    });
  }
  if (url.includes("/youtubei/v1/player")) {
    /* Answer as YouTube would: the embedded client gets an ad-free copy,
     * everyone else gets the ad-bearing one. */
    let body = null;
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch (e) {
      body = {};
    }
    const client = body?.context?.client?.clientName;
    if (client === "WEB_EMBEDDED_PLAYER") {
      /* One video the embedded client is not allowed to play, so the
       * fallback path gets exercised too. */
      if (body.videoId === "members-only") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Members only" }
          })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(AD_FREE_RESPONSE)
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PLAYER_RESPONSE)
    });
  }
  return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
});

const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
  waitUntil: "domcontentloaded"
});
await page.waitForTimeout(1200);

/* --- L2: inline player response --------------------------------------- */
const pr = await page.evaluate(() => {
  const r = window.ytInitialPlayerResponse || {};
  return {
    adPlacements: r.adPlacements,
    playerAds: r.playerAds,
    adSlots: r.adSlots,
    heartbeat: r.adBreakHeartbeatParams,
    status: r.playabilityStatus && r.playabilityStatus.status,
    streamingKept: !!(r.streamingData && r.streamingData.formats)
  };
});
check("L2 strips adPlacements from inline player response", pr.adPlacements === undefined);
check("L2 strips playerAds", pr.playerAds === undefined);
check("L2 strips adSlots", pr.adSlots === undefined);
check("L2 strips adBreakHeartbeatParams", pr.heartbeat === undefined);
check("L2 clears the ad-gated UNPLAYABLE status", pr.status === "OK", `status=${pr.status}`);
check("L2 leaves streamingData intact", pr.streamingKept === true);

/* --- L2: recursive prune of ytInitialData ------------------------------ */
/* The marker names have to be handed across - page.evaluate runs in the
 * browser, where nothing from this file is in scope. */
const idata = await page.evaluate(([marker, marker2]) => {
  const c = window.ytInitialData.contents.richGridRenderer.contents;
  return {
    count: c.length,
    hasAd: JSON.stringify(c).includes(marker),
    hasBanner: JSON.stringify(c).includes(marker2),
    realKept: JSON.stringify(c).includes("real1") && JSON.stringify(c).includes("real2")
  };
}, [AD_MARKER, AD_MARKER_2]);
check("L2 prunes ad renderers from ytInitialData", !idata.hasAd && !idata.hasBanner);
check("L2 keeps real feed items", idata.realKept === true, `${idata.count} items left`);
check("L2 removes the whole ad wrapper, not just the inner key", idata.count === 3, `${idata.count} items left (real1, real2, decoy), expected 3`);

/* Regression: enforcement copy sitting inside the feed must take out the one
 * item carrying it, never the container holding the whole feed. */
const container = await page.evaluate(() => {
  const g = window.ytInitialData.contents && window.ytInitialData.contents.richGridRenderer;
  return {
    gridSurvives: !!(g && Array.isArray(g.contents)),
    toastItemGone: !JSON.stringify(g || {}).includes("Experiencing interruptions")
  };
});
check("Enforcement inside a feed does not delete the feed", container.gridSurvives === true);
check("...but the item carrying it is removed", container.toastItemGone === true);

/* --- L2: fetch + Response.json path (SPA navigation) ------------------- */
const fetched = await page.evaluate(async () => {
  const r = await fetch("/youtubei/v1/player", { method: "POST", body: "{}" });
  const j = await r.json();
  return { ads: j.adPlacements, video: j.videoDetails && j.videoDetails.videoId };
});
check("L2 strips ads from fetch/Response.json", fetched.ads === undefined);
check("L2 leaves videoDetails intact", fetched.video === "dQw4w9WgXcQ");

/* --- L2: unrelated JSON is untouched ----------------------------------- */
const untouched = await page.evaluate(() =>
  JSON.parse('{"keep":1,"nested":{"ok":true}}')
);
check("L2 passes unrelated JSON through unchanged", untouched.keep === 1 && untouched.nested.ok === true);

/* --- L2: malformed input fails open ------------------------------------ */
const failOpen = await page.evaluate(() => {
  try { JSON.parse("not json"); return "threw-as-expected"; }
  catch (e) { return e instanceof SyntaxError ? "threw-as-expected" : "wrong-error"; }
});
check("L2 preserves native JSON.parse errors", failOpen === "threw-as-expected");

/* --- ad-free source request -------------------------------------------- */
const WEB_BODY = (videoId) =>
  JSON.stringify({
    videoId,
    context: { client: { clientName: "WEB", clientVersion: "2.20260829" } }
  });

const adFree = await page.evaluate(async (body) => {
  const r = await fetch("/youtubei/v1/player", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  const j = await r.json();
  return { source: j.cbSource, ads: j.adPlacements, video: j.videoDetails?.videoId };
}, WEB_BODY("dQw4w9WgXcQ"));
check("Player request is answered with the ad-free copy", adFree.source === "embedded", String(adFree.source));
check("...which has no ads in it to begin with", adFree.ads === undefined);
check("...and is still the right video", adFree.video === "dQw4w9WgXcQ");

/* When the embedded client cannot play it, YouTube's own response must come
 * back instead - a broken video is worse than an ad. */
const fellBack = await page.evaluate(async (body) => {
  const r = await fetch("/youtubei/v1/player", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  const j = await r.json();
  return { source: j.cbSource, status: j.playabilityStatus?.status, video: j.videoDetails?.videoId };
}, WEB_BODY("members-only"));
check(
  "An unplayable ad-free copy falls back to YouTube's response",
  fellBack.source === undefined && fellBack.video === "dQw4w9WgXcQ",
  JSON.stringify(fellBack)
);

/* Everything that is not a player request must pass through untouched. */
const untouchedFetch = await page.evaluate(async () => {
  const r = await fetch("/results?search_query=test");
  return r.status;
});
check("Other requests are not rerouted", untouchedFetch === 200, String(untouchedFetch));

/* --- enforcement: "Experiencing interruptions?" ------------------------- */
const enf = await page.evaluate(() => {
  const r = window.ytInitialPlayerResponse || {};
  const actions = r.onResponseReceivedActions || [];
  return {
    payloadGone: !JSON.stringify(actions).includes("Experiencing interruptions"),
    realActionKept: JSON.stringify(actions).includes("keepme"),
    decoyKept: JSON.stringify(window.ytInitialData).includes("decoy")
  };
});
check("Enforcement payload removed from onResponseReceivedActions", enf.payloadGone === true);
check("Real continuation action left in place", enf.realActionKept === true);
check(
  "A video ABOUT ad blockers is not pruned (text-match fence holds)",
  enf.decoyKept === true
);

const toast = await page.evaluate(() => ({
  enforcementToast: document.getElementById("toastmsg") === null,
  normalToast: document.getElementById("toastok") !== null
}));
check("Enforcement toast removed from the DOM", toast.enforcementToast === true);
check("An ordinary toast is left alone", toast.normalToast === true);

/* The timer clamp is opt-in. Zeroing timers inside a player we do not control
 * can make it retry and start *slower*, so by default nothing is touched. */
const timers = await page.evaluate(async () => {
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 2000));
  return {
    long: performance.now() - t0,
    intervalIsNative: /native code/.test(String(setInterval)),
    textIsNative: /native code/.test(String(Response.prototype.text))
  };
});
check(
  "Timers are untouched while nothing has stalled",
  timers.long >= 1800,
  `${Math.round(timers.long)}ms`
);
check("setInterval is never patched", timers.intervalIsNative === true);
check(
  "Response.text is left native (patching it quadrupled the work)",
  timers.textIsNative === true
);

/* An ad-gated response with nothing to play must be left alone. */
const gated = await page.evaluate(async () => {
  const r = await fetch("/youtubei/v1/player?gated=1", { method: "POST", body: "{}" });
  const j = await r.json();
  return { status: j.playabilityStatus && j.playabilityStatus.status };
});
check(
  "Ad-gated response with no video is not faked to OK",
  gated.status === "UNPLAYABLE",
  `status=${gated.status}`
);

/* --- L3: cosmetic layer ------------------------------------------------ */

const cosmetic = await page.evaluate(() => {
  // "gone" = removed from the DOM, true = present but display:none
  const hidden = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display === "none" : "gone";
  };
  /* When this fails, "hidden=false" on its own tells you nothing. Collect
   * enough to name the cause: whether the sheet exists, whether it is
   * switched off, how many of the selectors the browser actually accepted,
   * and whether the one that matters is even in the list. */
  const el = document.getElementById("cb-cosmetic");
  let rules = null;
  let listed = null;
  try {
    if (el && el.sheet) {
      rules = el.sheet.cssRules.length;
      /* Ask the stylesheet, not the filter list. CB_FILTERS is a content
       * script global and this code runs in the page's own world, where it
       * does not exist - reading it here reports "missing" every time,
       * including when it is present, which is worse than not asking. */
      /* Exactly that selector, not merely a rule mentioning it - three other
       * entries contain it as part of a longer selector, so a substring test
       * answers "yes" even when the one being asked about is gone. */
      listed = [].slice.call(el.sheet.cssRules).some(
        (r) => (r.selectorText || "").trim() === "ytd-ad-slot-renderer"
      );
    }
  } catch (e) {
    rules = "unreadable";
  }
  return {
    style: !!el,
    disabled: el ? el.disabled : null,
    rules,
    accepted: document.documentElement.dataset.cbCss || "not reported",
    listed,
    state: document.documentElement.dataset.cbState || "(unset)",
    feedad: hidden("#feedad"),
    richad: document.getElementById("richad") === null,
    mastheadad: document.getElementById("masthead-ad") === null,
    realvideo: hidden("#realvideo")
  };
});
check(
  "L3 injects its stylesheet",
  cosmetic.style === true,
  cosmetic.style
    ? ""
    : "no stylesheet at all - Chrome may have started without the extension " +
      "(--load-extension is off by default from Chrome 137)"
);
/* The fixture page has a <ytd-ad-slot-renderer> on it, but the filter list is
 * now rebuilt from whatever YouTube happened to show on the day, so naming
 * any one selector and demanding it be there is a coin flip. What must always
 * hold is the mechanism: something that IS in the list gets hidden, and
 * something that is not does not. So take the probe from the live list. */
const probeSelector = FILTERS.hide.find((s) => /^[a-z][a-z0-9-]*$/.test(s)) || null;
const probe = probeSelector
  ? await page.evaluate((sel) => {
      const el = document.createElement(sel);
      el.textContent = "probe";
      document.body.appendChild(el);
      const hidden = getComputedStyle(el).display === "none";
      el.remove();
      return hidden;
    }, probeSelector)
  : null;
check(
  "L3 hides something that is in the list",
  probeSelector === null || probe === true,
  probeSelector ? `${probeSelector} hidden=${probe}` : "the list has no plain element selector"
);

const notListed = await page.evaluate(() => {
  const el = document.createElement("cb-definitely-not-an-ad");
  el.textContent = "real content";
  document.body.appendChild(el);
  const hidden = getComputedStyle(el).display === "none";
  el.remove();
  return hidden;
});
check("...and nothing that is not", notListed === false);

check(
  "L3 hides the in-feed ad slot",
  !FILTERS.hide.includes("ytd-ad-slot-renderer") ||
    cosmetic.feedad === true ||
    cosmetic.feedad === "gone",
  `hidden=${cosmetic.feedad}` +
    (cosmetic.feedad === false
      ? ` | selectors accepted ${cosmetic.accepted}, rules ${cosmetic.rules},` +
        ` sheet disabled=${cosmetic.disabled}, state=${cosmetic.state},` +
        ` ad-slot rule present=${cosmetic.listed}`
      : "")
);

/* A selector this browser cannot parse must cost only itself. Before, one bad
 * entry threw away the whole rule and every ad came back. */
const resilient = await page.evaluate(() => {
  const s = document.createElement("style");
  document.documentElement.appendChild(s);
  let ok = 0;
  for (const sel of ["ytd-ad-slot-renderer", "!!!not a selector!!!", "#realvideo"]) {
    try {
      s.sheet.insertRule(sel + " { display: none !important; }", s.sheet.cssRules.length);
      ok++;
    } catch (e) {
      /* expected for the middle one */
    }
  }
  const n = s.sheet.cssRules.length;
  s.remove();
  return { ok, n };
});
check(
  "A selector this browser rejects costs only itself",
  resilient.ok === 2 && resilient.n === 2,
  `${resilient.ok} accepted, ${resilient.n} rules`
);
check("L3 removes the ad-only grid cell", cosmetic.richad === true);
check("L3 removes the masthead ad", cosmetic.mastheadad === true);
check("L3 leaves real content visible", cosmetic.realvideo === false, `hidden=${cosmetic.realvideo}`);

/* --- a filter must never hide the player -------------------------------
 *
 * This is the "I can hear it but I cannot see it" bug. "ad-created" is not an
 * ad element, it is a state class on the player itself, so hiding it hid the
 * whole player - while the video carried on decoding, so the sound and the
 * ambient glow both looked perfectly normal. Nothing detected it: the player
 * reports no error, so the ad-free fallback never fires either.
 *
 * Here the rule is added at runtime rather than through the filter list,
 * because the point is that it works whatever the source - a local mistake,
 * or something that arrives from the feed later. */
const rescued = await page.evaluate(async () => {
  const sheet = document.getElementById("cb-cosmetic").sheet;
  sheet.insertRule("#movie_player { display: none !important; }", sheet.cssRules.length);

  const player = document.getElementById("movie_player");
  const before = getComputedStyle(player).display;

  /* Nudge the page so the sweep runs, the way playback would. */
  document.querySelector("video").dispatchEvent(new Event("timeupdate"));
  document.body.appendChild(document.createElement("div"));

  for (let i = 0; i < 60 && getComputedStyle(player).display === "none"; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    before,
    after: getComputedStyle(player).display,
    reported: document.documentElement.dataset.cbUnhid || ""
  };
});
check(
  "A filter that hides the player is thrown out",
  rescued.before === "none" && rescued.after !== "none",
  `${rescued.before} -> ${rescued.after}`
);
check(
  "...and it says which filter did it",
  rescued.reported.includes("#movie_player"),
  rescued.reported || "(nothing reported)"
);

/* --- L4: watchdog ------------------------------------------------------ */
const watchdog = await page.evaluate(() => {
  const v = document.getElementById("v");
  return { muted: v.muted };
});
check("L4 mutes while the player reports an ad", watchdog.muted === true);

/* --- on-page toggle ---------------------------------------------------- */
const pill = await page.evaluate(() => {
  const host = document.getElementById("cb-toggle-host");
  const end = document.querySelector("ytd-masthead #end");
  return { exists: !!host, inMasthead: !!(host && end && end.contains(host)) };
});
check("Masthead pill mounts", pill.exists === true);
check("Masthead pill mounts inside ytd-masthead #end", pill.inMasthead === true);

/* --- selector hygiene -------------------------------------------------- */
const filterSrc = fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8");
const filters = new Function(
  "var globalThis = {};" + filterSrc + "\nreturn CB_FILTERS;"
)();
const bad = await page.evaluate((sels) => {
  const out = [];
  for (const s of sels) {
    try { document.querySelector(s); } catch (e) { out.push(s); }
  }
  return out;
}, [...filters.hide, ...filters.remove, ...filters.player.skipButtons, ...filters.player.closeButtons]);
check("Every filter selector parses in Chromium", bad.length === 0, bad.join(", "));

/* --- no uncaught page errors ------------------------------------------- */
check("No uncaught page errors", consoleErrors.length === 0, consoleErrors.join(" | "));

/* --- service worker registered ----------------------------------------- */
await page.waitForTimeout(500);
let sw = ctx.serviceWorkers().find((w) => w.url().includes("service-worker.js"));
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 5000 }).catch(() => null);
check("Service worker registered", !!sw, sw ? sw.url() : "none");

const extId = sw ? new URL(sw.url()).host : null;

/* --- the toggle actually stops blocking -------------------------------- */
if (sw) {
  await sw.evaluate(() => chrome.storage.sync.set({ enabled: false }));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);

  const off = await page.evaluate(() => ({
    ads: !!(window.ytInitialPlayerResponse || {}).adPlacements,
    styleOff: (() => {
      const s = document.getElementById("cb-cosmetic");
      return s ? s.disabled : null;
    })(),
    feedAdVisible: (() => {
      const el = document.querySelector("#feedad");
      return el ? getComputedStyle(el).display !== "none" : false;
    })()
  }));
  check("Paused: ad payload is left in place", off.ads === true);
  check("Paused: cosmetic stylesheet is disabled", off.styleOff === true);
  check("Paused: in-feed ad becomes visible again", off.feedAdVisible === true);

  await sw.evaluate(() => chrome.storage.sync.set({ enabled: true }));
  await page.waitForTimeout(300);

  /* --- channel allowlist -------------------------------------------- */
  await sw.evaluate(() => chrome.storage.sync.set({ allowlist: ["UCtest123"] }));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);

  const allowed = await page.evaluate(
    () => !!(window.ytInitialPlayerResponse || {}).adPlacements
  );
  check("Allowlisted channel keeps its ads", allowed === true);

  await sw.evaluate(() => chrome.storage.sync.set({ allowlist: [] }));

  /* A reported stall is what arms the bypass. */
  const clamped = await page.evaluate(async () => {
    document.dispatchEvent(
      new CustomEvent("__cb_stall", { detail: { waited: 1300, readyState: 0 } })
    );
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 5000));
    return performance.now() - t0;
  });
  check("A reported stall arms the delay bypass", clamped < 1000, `${Math.round(clamped)}ms`);

  /* And the popup switch can still force it off entirely. */
  await sw.evaluate(() => chrome.storage.sync.set({ clamp: false }));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const notClamped = await page.evaluate(async () => {
    document.dispatchEvent(
      new CustomEvent("__cb_stall", { detail: { waited: 1300, readyState: 0 } })
    );
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 2000));
    return performance.now() - t0;
  });
  check(
    "Switching it off keeps timers native even after a stall",
    notClamped >= 1800,
    `${Math.round(notClamped)}ms`
  );
  await sw.evaluate(() => chrome.storage.sync.set({ clamp: true }));

  /* The cost the interceptor measures must reach the service worker, because
   * that is what the popup shows. */
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("__cb_perf", { detail: { ms: 12.3, calls: 4, bytes: 100 } })
    )
  );
  await page.waitForTimeout(400);
  const cost = await sw.evaluate(() =>
    chrome.storage.session.get({ lastCostMs: -1 }).then((r) => r.lastCostMs)
  );
  check("Measured cost reaches the service worker", cost === 12.3, `${cost}ms`);

  /* The fixture is a real 20-second clip, so this is a genuine end-to-end
   * measurement rather than a number we put there ourselves. */
  const measured = await sw.evaluate(() =>
    chrome.storage.session
      .get({ lastStartMs: 0, lastTrace: "" })
      .then((r) => r)
  );
  check(
    "A real video's start time is measured",
    measured.lastStartMs > 0 && measured.lastStartMs < 30000,
    `${measured.lastStartMs}ms`
  );
  check(
    "...and the stall trace records the player state",
    /rs\d/.test(measured.lastTrace),
    measured.lastTrace
  );

  /* The bisect switches must actually reach the layers they name. */
  await sw.evaluate(() => chrome.storage.sync.set({ videoAds: false }));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const l2off = await page.evaluate(
    () => !!(window.ytInitialPlayerResponse || {}).adPlacements
  );
  check("Turning off the video layer really disables it", l2off === true);

  await sw.evaluate(() => chrome.storage.sync.set({ videoAds: true }));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const l2on = await page.evaluate(
    () => !(window.ytInitialPlayerResponse || {}).adPlacements
  );
  check("...and turning it back on restores it", l2on === true);

  await sw.evaluate(() => chrome.storage.sync.set({ adFree: false }));
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const adFreeOff = await page.evaluate(async () => {
    const r = await fetch("/youtubei/v1/player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId: "dQw4w9WgXcQ",
        context: { client: { clientName: "WEB", clientVersion: "2.20260829" } }
      })
    });
    const j = await r.json();
    return j.cbSource;
  });
  check("Switching the ad-free request off restores the normal one", adFreeOff === undefined, String(adFreeOff));
  await sw.evaluate(() => chrome.storage.sync.set({ adFree: true }));

  const rulesetOff = await sw.evaluate(async () => {
    await chrome.storage.sync.set({ netRules: false });
    await new Promise((r) => setTimeout(r, 400));
    const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
    await chrome.storage.sync.set({ netRules: true });
    return ids;
  });
  check(
    "Turning off network rules disables the ruleset",
    Array.isArray(rulesetOff) && rulesetOff.length === 0,
    JSON.stringify(rulesetOff)
  );
}

/* --- popup renders in both themes -------------------------------------- */
if (extId) {
  /* Fixed values so the popup's formatting can be checked exactly. Set here,
   * immediately before the popup opens, because the watchdog writes real ones
   * every time the page reloads. */
  await ctx.serviceWorkers()[0]?.evaluate(() =>
    chrome.storage.session.set({
      lastStartMs: 3400,
      lastStartNudges: 2,
      lastCostMs: 12.3,
      lastTrace: "rs0 11.2s -> rs4 playing"
    })
  );

  const popup = await ctx.newPage();
  const shots = path.join(ROOT, "test", "screenshots");
  fs.mkdirSync(shots, { recursive: true });
  await popup.setViewportSize({ width: 320, height: 340 });

  for (const theme of ["light", "dark"]) {
    await popup.emulateMedia({ colorScheme: theme });
    await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(shots, `popup-${theme}.png`) });
  }

  const popupOk = await popup.evaluate(() => ({
    status: document.getElementById("status").textContent,
    credit: document.querySelector(".pf").textContent.includes("Made by Archie"),
    ink: getComputedStyle(document.body).color,
    bg: getComputedStyle(document.body).backgroundColor,
    channelRowShown:
      getComputedStyle(document.getElementById("channelRow")).display !== "none"
  }));
  check("Popup renders a status", !!popupOk.status, popupOk.status);
  check('Popup credits read "Made by Archie"', popupOk.credit === true);
  check(
    "Popup paints an explicit background (not transparent)",
    popupOk.bg !== "rgba(0, 0, 0, 0)",
    popupOk.bg
  );
  check(
    "Channel row is hidden when there is no channel",
    popupOk.channelRowShown === false
  );

  /* ---------------- sponsor segments ----------------
   * Only the opt-in gate is checked here. The lookup itself is unit-tested in
   * test/sponsors.mjs, because this harness cannot intercept a service
   * worker's network calls - a test that cannot fail is worse than none. */
  const sbOffResult = await popup.evaluate(
    () => new Promise((r) =>
      chrome.runtime.sendMessage({ type: "cb:segments", videoId: "dQw4w9WgXcQ" }, r))
  );
  check(
    "No sponsor lookup happens until it is switched on",
    Array.isArray(sbOffResult.segments) && sbOffResult.segments.length === 0 && sbRequests.length === 0,
    `${sbRequests.length} requests`
  );

  /* --- sponsor toggle and its licence credit ------------------------ */
  const sponsorUi = await popup.evaluate(() => {
    const tgl = document.getElementById("tglSponsor");
    return {
      exists: !!tgl,
      inMainView: !!document.getElementById("main").contains(tgl),
      checked: tgl.getAttribute("aria-checked"),
      creditHidden: document.getElementById("sponsorCredit").hidden,
      creditText: document.getElementById("sponsorCredit").textContent.trim(),
      creditLink: document.querySelector("#sponsorCredit a")?.href || ""
    };
  });
  check("Sponsor skipping has a switch in the main view", sponsorUi.exists && sponsorUi.inMainView);
  check("...off until asked for", sponsorUi.checked === "false", sponsorUi.checked);
  check("...with the credit hidden while unused", sponsorUi.creditHidden === true);
  check(
    "The credit names SponsorBlock and links to it",
    /SponsorBlock/.test(sponsorUi.creditText) && /sponsor\.ajay\.app/.test(sponsorUi.creditLink),
    sponsorUi.creditLink
  );

  /* Turning it on must show the credit (a licence condition) and warn about
   * the refresh rather than just doing it. */
  await popup.click("#tglSponsor");
  await popup.waitForTimeout(300);
  const afterToggle = await popup.evaluate(() => ({
    checked: document.getElementById("tglSponsor").getAttribute("aria-checked"),
    creditShown: !document.getElementById("sponsorCredit").hidden,
    noteShown: !document.getElementById("reloadNote").hidden,
    note: document.getElementById("reloadMeta").textContent
  }));
  check("Switching it on flips the switch", afterToggle.checked === "true");
  check("...shows the credit, as the licence requires", afterToggle.creditShown === true);
  check("...and warns before refreshing", afterToggle.noteShown && /refresh/i.test(afterToggle.note), afterToggle.note);
  check("...counting down rather than jumping", /\d/.test(afterToggle.note), afterToggle.note);

  /* --- the settings sub-view ---------------------------------------- */
  const optsBtn = await popup.evaluate(() => ({
    shown: !document.getElementById("sponsorOpts").hidden
  }));
  check("Settings appear once sponsor skipping is on", optsBtn.shown === true);

  await popup.click("#sponsorOpts");
  await popup.waitForTimeout(250);
  const opts = await popup.evaluate(() => {
    const rows = [...document.querySelectorAll("#sponsorList .row")];
    const byLabel = (t) =>
      rows.find((r) => r.querySelector("em")?.textContent === t);
    return {
      viewShown: !document.getElementById("sponsorView").hidden,
      mainHidden: document.getElementById("main").hidden,
      count: rows.length,
      labels: rows.map((r) => r.querySelector("em")?.textContent),
      sponsorOn: byLabel("Sponsors")?.querySelector("button")?.getAttribute("aria-checked"),
      introOn: byLabel("Intros")?.querySelector("button")?.getAttribute("aria-checked"),
      highlightOn: byLabel("Offer to jump to the best bit")
        ?.querySelector("button")
        ?.getAttribute("aria-checked"),
      credits: /SponsorBlock/.test(document.getElementById("sponsorView").textContent)
    };
  });
  check("The settings view opens over the main one", opts.viewShown && opts.mainHidden);
  check("Every category is listed, plus the highlight", opts.count === 9, `${opts.count} rows`);
  check("Advertising categories start on", opts.sponsorOn === "true");
  check("The creator's own video does not", opts.introOn === "false", `intros=${opts.introOn}`);
  check("The highlight is offered, not assumed", opts.highlightOn === "false");
  check("The credit follows into the settings view", opts.credits === true);

  /* Flipping one must actually be saved, not just redrawn. */
  const saved = await popup.evaluate(async () => {
    const row = [...document.querySelectorAll("#sponsorList .row")].find(
      (r) => r.querySelector("em")?.textContent === "Intros"
    );
    row.querySelector("button").click();
    await new Promise((r) => setTimeout(r, 300));
    const s = await chrome.storage.sync.get({ sponsorCategories: null });
    return s.sponsorCategories;
  });
  check("Turning a category on is remembered", saved && saved.intro === true, JSON.stringify(saved));
  check("...without disturbing the others", saved && saved.sponsor === true);

  const hlSaved = await popup.evaluate(async () => {
    const row = [...document.querySelectorAll("#sponsorList .row")].find(
      (r) => r.querySelector("em")?.textContent === "Offer to jump to the best bit"
    );
    row.querySelector("button").click();
    await new Promise((r) => setTimeout(r, 300));
    return (await chrome.storage.sync.get({ sponsorHighlight: null })).sponsorHighlight;
  });
  check("The highlight setting is remembered too", hlSaved === true, String(hlSaved));

  /* A popup must never scroll sideways - it cannot be widened by the user,
   * so anything overflowing is simply unreachable. */
  const overflow = await popup.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyW: document.body.getBoundingClientRect().width
  }));
  check(
    "The settings view does not overflow sideways",
    overflow.scrollW <= overflow.clientW,
    `${overflow.scrollW} vs ${overflow.clientW}`
  );

  await popup.setViewportSize({ width: 340, height: 620 });
  await popup.waitForTimeout(150);
  await popup.screenshot({ path: path.join(shots, "popup-sponsor-settings.png") });
  await popup.setViewportSize({ width: 320, height: 340 });

  await popup.click("#sponsorBack");
  await popup.waitForTimeout(200);
  const backOk = await popup.evaluate(() => ({
    view: document.getElementById("sponsorView").hidden,
    main: !document.getElementById("main").hidden
  }));
  check("Back leaves the settings view", backOk.view && backOk.main);

  await popup.evaluate(() =>
    chrome.storage.sync.set({
      sponsorBlock: false,
      sponsorHighlight: false,
      sponsorCategories: null
    })
  );

  /* --- filter status row -------------------------------------------- */
  const filterRow = await popup.evaluate(() => ({
    text: document.getElementById("filterMeta").textContent,
    hasCheck: !!document.getElementById("checkNow")
  }));
  check("Popup shows the filter version and when it was checked", /filters /.test(filterRow.text), filterRow.text);
  check("...with a Check now button", filterRow.hasCheck === true);

  /* Every answer the button can give must read as plain English. */
  const wording = await popup.evaluate(() => ({
    updated: __cbCheckMessage({ updated: "2026.08.29-abc" }),
    same: __cbCheckMessage({ upToDate: true }),
    old: __cbCheckMessage({ needsExtensionUpdate: "2.0.0" }),
    failed: __cbCheckMessage({ error: "Failed to fetch" }),
    nothing: __cbCheckMessage(null)
  }));
  check(
    "New filters are announced as new",
    wording.updated.text === "you just got new filters" && wording.updated.kind === "ok",
    wording.updated.text
  );
  check(
    "No change says you are up to date",
    wording.same.text === "you have the latest filters" && wording.same.kind === "ok",
    wording.same.text
  );
  check("A failed check is flagged, not silent", wording.failed.kind === "warn", wording.failed.text);
  check("An out-of-date extension says so", /update AdCuck/.test(wording.old.text), wording.old.text);
  check("A dead service worker still says something", !!wording.nothing.text, wording.nothing.text);

  /* An unreachable feed must fail quietly and keep the last good list. This
   * goes through the same message the button sends. */
  await sw.evaluate(() =>
    chrome.storage.sync.set({ feedUrl: "https://127.0.0.1:1/nope.json" })
  );
  const badFeed = await popup.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.runtime.sendMessage({ type: "cb:checkFilters" }, resolve)
      )
  );
  const afterBad = await sw.evaluate(() =>
    chrome.storage.local
      .get({ filtersError: "", filters: null })
      .then((r) => ({ err: r.filtersError, kept: r.filters }))
  );
  check("An unreachable feed fails without breaking anything", !!badFeed?.error, JSON.stringify(badFeed));
  check("...and records why, for the popup to show", !!afterBad.err, afterBad.err);

  /* And the row itself must actually change - the messages used to go only
   * to the screen-reader region, where nobody could see them. */
  const shown = await popup.evaluate(async () => {
    document.getElementById("checkNow").click();
    const meta = document.getElementById("filterMeta");
    const during = meta.textContent;
    for (let i = 0; i < 60 && meta.textContent === during; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return { during, after: meta.textContent, dot: document.getElementById("dot").style.background };
  });
  check("The row says it is checking while it checks", /checking/i.test(shown.during), shown.during);
  check("...then shows the result in the row itself", /couldn't|latest|new filters/i.test(shown.after), shown.after);
  check("...and colours the dot for a failure", /warn/.test(shown.dot), shown.dot);

  await sw.evaluate(() => chrome.storage.sync.set({ feedUrl: "" }));

  /* --- start-time readout ------------------------------------------ */
  const startRow = await popup.evaluate(() => {
    const row = document.getElementById("startRow");
    return {
      shown: !row.hidden,
      text: document.getElementById("startMeta").textContent,
      title: row.title
    };
  });
  check("Popup shows how long the video took to start", startRow.shown === true);
  check(
    "...with the extension's share of it",
    startRow.text === "video started in 3.4s \u00b7 extension 12ms",
    startRow.text
  );
  check("...and says if the player had to be nudged", /nudged/i.test(startRow.title), startRow.title);
  check(
    "...and carries the stall trace, so we can tell waiting from loading",
    /rs0 11\.2s/.test(startRow.title),
    startRow.title
  );

  /* The bisect switches are a maintainer's tool: hidden unless asked for. */
  const diagHidden = await popup.evaluate(
    () => document.getElementById("diagRow").hidden
  );
  check("Bisect switches stay hidden without diagnostics", diagHidden === true);

  /* --- changelog in the popup ------------------------------------- */
  const dotBefore = await popup.evaluate(
    () => !document.getElementById("newDot").hidden
  );
  check("Update dot shows before the changelog has been opened", dotBefore === true);

  /* "What's new" is its own control; the version beside it is a plain label. */
  const footer = await popup.evaluate(() => ({
    btnIsButton: document.getElementById("whatsNew").tagName === "BUTTON",
    versionIsNotAButton: document.getElementById("verText").tagName !== "BUTTON",
    dotInsideBtn: document
      .getElementById("whatsNew")
      .contains(document.getElementById("newDot")),
    order: [...document.querySelector(".pfend").children].map((el) => el.id)
  }));
  check("What's new is its own button", footer.btnIsButton === true);
  check("Version is a plain label, not a control", footer.versionIsNotAButton === true);
  check("Update dot belongs to the button", footer.dotInsideBtn === true);
  check(
    "Button sits next to the version",
    footer.order.join(",") === "whatsNew,verText",
    footer.order.join(",")
  );

  await popup.click("#verText");
  await popup.waitForTimeout(150);
  const versionInert = await popup.evaluate(
    () => document.getElementById("log").hidden
  );
  check("Clicking the version alone does nothing", versionInert === true);

  await popup.click("#whatsNew");
  await popup.waitForTimeout(250);
  await popup.screenshot({ path: path.join(shots, "popup-changelog.png") });

  const opened = await popup.evaluate(() => {
    const entries = [...document.querySelectorAll("#logBody .entry")];
    return {
      logShown: !document.getElementById("log").hidden,
      mainHidden: document.getElementById("main").hidden,
      count: entries.length,
      topVersion: entries[0] && entries[0].querySelector(".v b").textContent,
      firstLine: entries[0] && entries[0].querySelector("li").textContent,
      creditStillThere: document.querySelector(".pf").textContent.includes("Made by Archie"),
      dotCleared: document.getElementById("newDot").hidden
    };
  });
  check("Clicking What's new opens the changelog", opened.logShown === true);
  check("...and hides the main view", opened.mainHidden === true);
  /* The popup caps the list at 5; past that it would start scrolling. */
const shownReleases = Math.min(CHANGELOG.length, 5);
check("Changelog lists the releases", opened.count === shownReleases, `${opened.count} of ${CHANGELOG.length}`);
  check("Newest release is on top", opened.topVersion === CHANGELOG[0].version, opened.topVersion);
  check("Entry text comes from the changelog", opened.firstLine === CHANGELOG[0].changes[0], opened.firstLine);
  check("Credits stay visible on the changelog view", opened.creditStillThere === true);
  check("Opening the changelog clears the update dot", opened.dotCleared === true);

  await popup.click("#logBack");
  await popup.waitForTimeout(200);
  const closed = await popup.evaluate(() => ({
    logHidden: document.getElementById("log").hidden,
    mainShown: !document.getElementById("main").hidden
  }));
  check("Back returns to the main view", closed.logHidden && closed.mainShown);

  /* The dot must stay gone on the next open, not come back. */
  await popup.reload();
  await popup.waitForTimeout(400);
  const dotAfter = await popup.evaluate(
    () => document.getElementById("newDot").hidden
  );
  check("Dot stays cleared after reopening the popup", dotAfter === true);
  await popup.close();
}

await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
