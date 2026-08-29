/* Copy the response lists from filters.js into interceptor.js.
 *
 *   node tools/sync-interceptor.mjs
 *
 * Why there are two copies at all: interceptor.js runs in the page's own
 * world at document_start, before anything from the extension's side can
 * reach it. It cannot read filters.js, so it carries its own copy of the
 * three lists it needs before the first response arrives. Updated lists do
 * arrive later over the feed - but "later" is after the page has already
 * asked YouTube for the video, which is the moment that matters.
 *
 * Two copies of one truth always drift. test/e2e.mjs has always failed when
 * they disagree, which is the right safety net but leaves you to fix it by
 * hand in a file you should not have to open. So add-filters.mjs calls this
 * straight after it edits filters.js, and the copies cannot drift at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILTERS = path.join(ROOT, "src/filters/filters.js");
const INTERCEPTOR = path.join(ROOT, "src/inject/interceptor.js");

const LISTS = [
  ["PLAYER_KEYS", (F) => F.response.playerKeys],
  ["AD_MARKERS", (F) => F.response.adMarkers],
  ["AD_GATE_REASONS", (F) => F.response.adGateReasons]
];

function load(src) {
  return new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
}

/* The array literal for `name`, as e2e.mjs finds it - same pattern, so if one
 * can read the file the other can too. */
function spanOf(src, name) {
  const head = `var ${name} = [`;
  const from = src.indexOf(head);
  if (from === -1) return null;
  const open = from + head.length - 1;
  /* The index of the "]", not of the ";" after it - the closing bracket has
   * to survive the splice. */
  const close = src.indexOf("];", open);
  if (close === -1) return null;
  return { open, close };
}

export function sync() {
  const F = load(fs.readFileSync(FILTERS, "utf8"));
  const before = fs.readFileSync(INTERCEPTOR, "utf8");
  let src = before;
  const changed = [];

  for (const [name, pick] of LISTS) {
    const want = pick(F);
    const span = spanOf(src, name);
    if (!span) throw new Error(`could not find ${name} in interceptor.js`);

    const body = src.slice(span.open + 1, span.close);
    const indent = (body.match(/\n(\s*)\S/) || [, "    "])[1];
    const next =
      "\n" + want.map((v) => indent + JSON.stringify(v)).join(",\n") +
      "\n" + indent.slice(0, -2);
    if (body === next) continue;

    src = src.slice(0, span.open + 1) + next + src.slice(span.close);
    changed.push(`${name} (${want.length})`);
  }

  if (!changed.length) return { changed: [] };

  /* Prove the result still parses before it replaces anything. A player
   * script that throws at document_start takes the whole page with it. */
  new Function(src);

  const backup = INTERCEPTOR + ".backup";
  fs.writeFileSync(backup, before);
  try {
    fs.writeFileSync(INTERCEPTOR, src);
    for (const [name, pick] of LISTS) {
      const after = spanOf(fs.readFileSync(INTERCEPTOR, "utf8"), name);
      if (!after) throw new Error(`${name} went missing`);
    }
    fs.rmSync(backup);
  } catch (err) {
    fs.copyFileSync(backup, INTERCEPTOR);
    fs.rmSync(backup);
    throw err;
  }
  return { changed };
}

/* Run directly, or import sync() from add-filters.mjs. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { changed } = sync();
  console.log(changed.length
    ? `  Updated in interceptor.js: ${changed.join(", ")}`
    : "  interceptor.js already matches filters.js");
}
