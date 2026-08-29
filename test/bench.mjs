/* Performance benchmark for the interceptor's scrub path.
 *
 * ytInitialData on a real YouTube home page is megabytes of deeply nested
 * renderers. The scrub runs on it synchronously, inside the assignment that
 * YouTube's own bootstrap makes, so anything slow here is time the user spends
 * staring at a blank page. This measures it.
 *
 *   node test/bench.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Build a payload shaped like ytInitialData: wide arrays of thin wrappers
 * around fat renderer objects, nested a dozen deep. */
function makeRenderer(i, depth) {
  return {
    videoId: "vid" + i,
    title: { runs: [{ text: "Video number " + i + " about something" }] },
    thumbnail: {
      thumbnails: Array.from({ length: 6 }, (_, k) => ({
        url: "https://i.ytimg.com/vi/x/" + k + ".jpg",
        width: 120 * k,
        height: 90 * k
      }))
    },
    longBylineText: { runs: [{ text: "Channel " + i, navigationEndpoint: {
      commandMetadata: { webCommandMetadata: { url: "/@c" + i, rootVe: 3611 } },
      browseEndpoint: { browseId: "UC" + i, canonicalBaseUrl: "/@c" + i }
    } }] },
    menu: { menuRenderer: { items: Array.from({ length: 5 }, (_, k) => ({
      menuServiceItemRenderer: {
        text: { runs: [{ text: "Action " + k }] },
        icon: { iconType: "ADD_TO_QUEUE_TAIL" },
        serviceEndpoint: { clickTrackingParams: "x".repeat(48) }
      }
    })) } },
    badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_SIMPLE", label: "New" } }],
    trackingParams: "y".repeat(64),
    depth
  };
}

function makeSection(n, depth) {
  return {
    richSectionRenderer: {
      content: {
        richShelfRenderer: {
          title: { runs: [{ text: "Shelf " + n }] },
          contents: Array.from({ length: 12 }, (_, i) => ({
            richItemRenderer: { content: { videoRenderer: makeRenderer(n * 100 + i, depth) } }
          }))
        }
      }
    }
  };
}

function makePayload(sections) {
  return {
    responseContext: { serviceTrackingParams: Array.from({ length: 8 }, (_, i) => ({
      service: "SVC" + i,
      params: Array.from({ length: 6 }, (_, k) => ({ key: "k" + k, value: "v".repeat(32) }))
    })) },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { richGridRenderer: {
          contents: [
            ...Array.from({ length: sections }, (_, n) => makeSection(n, 4)),
            // one real ad, so the walk has something to actually find
            { richItemRenderer: { content: { adSlotRenderer: { adSlotMetadata: {} } } } },
            // and one enforcement toast
            { openPopupAction: { popup: { someRenamedViewModel: {
              title: "Experiencing interruptions?", subtitle: "Find out why" } } } }
          ]
        } } } }]
      }
    }
  };
}

/* Load the interceptor into a fake page realm and grab its JSON.parse hook. */
function loadInterceptor() {
  const src = fs.readFileSync(path.join(ROOT, "src/inject/interceptor.js"), "utf8");
  const doc = {
    documentElement: {
      dataset: { cbState: "on", cbAllow: "", cbDiag: "off", cbVideo: "on" }
    },
    dispatchEvent() {},
    addEventListener() {},
    querySelector() { return null; }
  };
  const win = {
    setTimeout: (fn, d) => setTimeout(fn, d),
    Response: undefined,
    Object
  };
  const sandbox = {
    window: win,
    document: doc,
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    Date,
    console,
    RegExp,
    Object,
    Array,
    String
  };
  win.setTimeout = sandbox.setTimeout = (fn, d) => setTimeout(fn, d);
  const run = new Function(
    ...Object.keys(sandbox),
    src + "\nreturn JSON.parse;"
  );
  return run(...Object.values(sandbox));
}

const patchedParse = loadInterceptor();

const SIZES = [20, 60, 120];
const BUDGET_MS = 120; // hard ceiling for the largest payload
let worst = 0;

console.log("payload            bytes     parse    scrub    total");
console.log("--------------------------------------------------------");

for (const sections of SIZES) {
  const text = JSON.stringify(makePayload(sections));

  const t0 = process.hrtime.bigint();
  JSON.parse(text);
  const t1 = process.hrtime.bigint();
  patchedParse(text);
  const t2 = process.hrtime.bigint();

  const nativeMs = Number(t1 - t0) / 1e6;
  const totalMs = Number(t2 - t1) / 1e6;
  const scrubMs = totalMs - nativeMs;
  worst = Math.max(worst, scrubMs);

  console.log(
    `${String(sections + " sections").padEnd(18)}` +
    `${(text.length / 1e6).toFixed(2)}MB`.padEnd(10) +
    `${nativeMs.toFixed(1)}ms`.padEnd(9) +
    `${scrubMs.toFixed(1)}ms`.padEnd(9) +
    `${totalMs.toFixed(1)}ms`
  );
}

/* Sanity: the scrub must still be doing its job, not just being fast. */
const probe = patchedParse(JSON.stringify(makePayload(4)));
const asText = JSON.stringify(probe);
const stripped =
  !asText.includes("adSlotRenderer") && !asText.includes("Experiencing interruptions");
const kept = asText.includes("vid0") && asText.includes("Shelf 0");

console.log("");
console.log(`ads and enforcement removed: ${stripped ? "yes" : "NO"}`);
console.log(`real content preserved:      ${kept ? "yes" : "NO"}`);
console.log(`worst scrub overhead:        ${worst.toFixed(1)}ms (budget ${BUDGET_MS}ms)`);

const ok = stripped && kept && worst < BUDGET_MS;
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
