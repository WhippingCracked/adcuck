/* Editing src/filters/filters.js safely.
 *
 * One place, because three tools now rewrite that file and three separate
 * copies of "find the array and splice it" is how they drift into disagreeing
 * about what a filter list looks like.
 *
 * Everything here is text surgery on the source rather than a parse-and-print
 * round trip, on purpose: the file is full of comments explaining WHY each
 * group of filters exists, and regenerating it from data would throw all of
 * them away the first time anything was added.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FILTERS = path.join(ROOT, "src/filters/filters.js");

export function load(src) {
  return new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
}

export function readFilters() {
  const src = fs.readFileSync(FILTERS, "utf8");
  return { src, filters: load(src) };
}

/* The span between the brackets of the array literal for `key`.
 *
 * Brackets inside string literals do not count. Selectors are full of them -
 * ytd-thing[target-id='x'] - and a naive bracket counter walks straight off
 * the end of the file and corrupts everything after it. */
export function arraySpan(src, key) {
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

/** Replace the contents of the `key` array with exactly `values`. */
export function rewriteArray(src, key, values, indentHint) {
  const span = arraySpan(src, key);
  if (!span) throw new Error(`could not find the ${key} list in filters.js`);

  const body = src.slice(span.from + 1, span.to);
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.some((l) => l.includes("//") || l.includes("/*"))) {
    throw new Error(`${key} has comments inside it - not rewriting blindly`);
  }
  const indent = lines.length
    ? (lines[0].match(/^\s*/) || ["    "])[0]
    : indentHint || "    ";

  const inner = values.length
    ? "\n" + values.map((v) => indent + JSON.stringify(v)).join(",\n") + "\n" + indent.slice(0, -2)
    : "";

  return src.slice(0, span.from + 1) + inner + src.slice(span.to);
}

/** Add `values` to the end of the `key` array, keeping what is there. */
export function appendTo(src, key, values) {
  if (!values.length) return src;
  const current = load(src);
  const existing = key === "hide" ? current.hide : current.response.adMarkers;
  return rewriteArray(src, key, existing.concat(values));
}

/* Record when the list was last edited.
 *
 * The extension replaces its bundled filters with whatever the published feed
 * has. Between editing this file and remembering to push it, the published
 * list is OLDER than the bundled one - and without a timestamp to compare, a
 * fresh install throws away the good list for the stale one and says nothing.
 * src/content/bridge.js refuses a feed built before this stamp, which only
 * works if the stamp is written. */
export function stampEdited(src) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, ".");
  const iso = now.toISOString();

  const out = src.replace(/version:\s*"[^"]*"/, `version: "${day}"`);
  if (/editedAt:\s*"[^"]*"/.test(out)) {
    return out.replace(/editedAt:\s*"[^"]*"/, `editedAt: "${iso}"`);
  }
  return out.replace(
    /(version:\s*"[^"]*",)/,
    `$1\n\n  /* When this list was last edited. A published feed built before\n` +
      `   * this is stale, and is ignored rather than applied. */\n` +
      `  editedAt: "${iso}",`
  );
}

/**
 * Write `next`, but only if it still loads and passes `verify`.
 * Restores the original and rethrows if anything is wrong - a filter list
 * that will not load is worse than one that misses an ad.
 */
export function writeChecked(before, next, verify) {
  const backup = FILTERS + ".backup";
  fs.writeFileSync(backup, before);
  try {
    fs.writeFileSync(FILTERS, stampEdited(next));
    const after = load(fs.readFileSync(FILTERS, "utf8"));
    if (!after.editedAt) throw new Error("the edit stamp did not get written");
    verify(after);
    try { fs.rmSync(backup); } catch (e) { /* left behind, harmless */ }
    return after;
  } catch (err) {
    fs.copyFileSync(backup, FILTERS);
    try { fs.rmSync(backup); } catch (e) { /* left behind, harmless */ }
    throw err;
  }
}
