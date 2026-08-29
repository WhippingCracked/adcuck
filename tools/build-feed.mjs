#!/usr/bin/env node
/* Build the over-the-air filter feed.
 *
 *   node tools/build-feed.mjs          # writes ./feed
 *
 * Reads the filters that ship in the extension and emits the static JSON that
 * GitHub Pages serves. Every file is content-addressed by name and checksummed
 * in the manifest, so a client can verify what it downloaded before applying
 * any of it.
 *
 * The feed carries PARAMETERS ONLY - selector strings, field names, rule
 * objects. Never a function, never anything that gets executed. That is what
 * keeps it inside Chrome's remote-code rules.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "feed", "v1");

/* Dynamic rules must not collide with the ruleset that ships in the package,
 * so the feed re-numbers everything into its own reserved range. */
const RULE_ID_BASE = 1000;

function loadFilters() {
  const src = fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8");
  return new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/* Version is date + a hash of the inputs, so it is deterministic (CI and a
 * local build agree) and it changes exactly when the filters change. A
 * counter would give the same version to different content, and clients skip
 * an update whose version they already have. */
function versionFrom(inputs) {
  const d = new Date();
  const stamp = [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join(".");
  return `${stamp}-${sha256(inputs).slice(0, 8)}`;
}

const F = loadFilters();
const staticRules = JSON.parse(
  fs.readFileSync(path.join(ROOT, "rules/network.json"), "utf8")
);

const version = versionFrom(
  fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8") +
    fs.readFileSync(path.join(ROOT, "rules/network.json"), "utf8")
);

/* Rebuild from scratch: leftovers from an older list would be served too. */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const files = {
  cosmetic: {
    version,
    hide: F.hide,
    remove: F.remove,
    enforcement: F.enforcement,
    player: F.player,
    unlock: F.unlock
  },
  network: staticRules.map((r, i) => ({ ...r, id: RULE_ID_BASE + i })),
  player: {
    playerKeys: F.response.playerKeys,
    adMarkers: F.response.adMarkers,
    adGateReasons: F.response.adGateReasons,
    enforceText: F.enforcement.phrases
  }
};

const manifest = {
  listVersion: version,
  generatedAt: new Date().toISOString(),
  /* Raise this when the feed format changes in a way older clients cannot
   * read. They will stop applying updates and say so, rather than choking. */
  minExtensionVersion: "1.7.0",
  files: []
};

for (const [name, data] of Object.entries(files)) {
  const body = JSON.stringify(data, null, 2) + "\n";
  const filename = `${name}.${version}.json`;
  fs.writeFileSync(path.join(OUT, filename), body);
  manifest.files.push({
    name,
    url: filename, // relative: resolved against the manifest, so any path works
    sha256: sha256(body),
    bytes: Buffer.byteLength(body)
  });
}

fs.writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

/* A tiny index so the feed URL is browsable rather than a 404. */
fs.writeFileSync(
  path.join(ROOT, "feed", "index.html"),
  `<!doctype html><meta charset="utf-8"><title>AdCuck filter feed</title>
<style>body{font:14px/1.6 system-ui;margin:40px auto;max-width:38rem;padding:0 1rem}
code{background:#f2f2f2;padding:2px 5px;border-radius:4px}</style>
<h1>AdCuck filter feed</h1>
<p>Current list: <code>${version}</code>, built ${manifest.generatedAt}.</p>
<p>The extension reads <code>v1/manifest.json</code> from here every hour.
It carries selector strings and field names only - never code.</p>
<p><a href="v1/manifest.json">v1/manifest.json</a></p>\n`
);

console.log(`feed ${version}`);
for (const f of manifest.files) {
  console.log(`  ${f.name.padEnd(10)} ${String(f.bytes).padStart(6)} bytes  ${f.sha256.slice(0, 12)}…`);
}
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
console.log("commit ./feed and enable GitHub Pages on it, or let the workflow do it");
