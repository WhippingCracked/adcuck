/* AdCuck - over-the-air filter updates.
 *
 * Filters are data, not code: selector strings, key names and rule objects.
 * That distinction is the whole reason this can exist. The engine that reads
 * them ships in the package and never changes here; only the parameters it
 * reads are fetched. Fetching a JavaScript function instead would breach
 * MV3's remote-code ban however it was encoded, and that is the fastest route
 * to removal from the store.
 *
 * The feed is static JSON on GitHub Pages. No server to run, no server to be
 * down. See tools/build-feed.mjs for how it is produced.
 */

const DEFAULT_FEED = "https://whippingcracked.github.io/adcuck/v1/manifest.json";
const ALARM = "adcuck-filters";
const PERIOD_MIN = 360;          // 6 hours
const BACKOFF = [6, 12, 24];     // hours, after consecutive failures
const RULE_ID_MIN = 1000;        // dynamic rules live above the static ones
const RULE_ID_MAX = 9999;
const MAX_BYTES = 512 * 1024;    // a YouTube-only list has no business being bigger

const ACTIONS = new Set(["block", "allow", "allowAllRequests"]);
const RESOURCES = new Set([
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket",
  "webtransport", "webbundle", "other"
]);

async function feedUrl() {
  const { feedUrl } = await chrome.storage.sync.get({ feedUrl: DEFAULT_FEED });
  return feedUrl || DEFAULT_FEED;
}

/* ------------------------------ validation ------------------------------
 * Everything below runs on data fetched from the network, so none of it may
 * be trusted. A malformed field drops that field; a malformed file aborts the
 * whole update and leaves the last-good list in place. */

const isStr = (v) => typeof v === "string" && v.length > 0 && v.length < 400;
const strArray = (v) => (Array.isArray(v) ? v.filter(isStr) : []);

function validCosmetic(o) {
  if (!o || typeof o !== "object") return null;
  const out = {
    version: isStr(o.version) ? o.version : "unknown",
    hide: strArray(o.hide),
    remove: strArray(o.remove)
  };
  if (!out.hide.length) return null; // an empty list is a broken list

  if (o.enforcement && typeof o.enforcement === "object") {
    out.enforcement = {
      containers: strArray(o.enforcement.containers),
      phrases: strArray(o.enforcement.phrases),
      nudgeAfterMs: Number(o.enforcement.nudgeAfterMs) || 900,
      maxNudges: Number(o.enforcement.maxNudges) || 4
    };
  }
  if (o.player && typeof o.player === "object") {
    out.player = {
      container: isStr(o.player.container) ? o.player.container : "#movie_player",
      adClasses: strArray(o.player.adClasses),
      skipButtons: strArray(o.player.skipButtons),
      closeButtons: strArray(o.player.closeButtons)
    };
  }
  if (o.unlock && typeof o.unlock === "object") {
    out.unlock = {
      backdrop: isStr(o.unlock.backdrop) ? o.unlock.backdrop : "tp-yt-iron-overlay-backdrop",
      bodyAttrs: strArray(o.unlock.bodyAttrs),
      bodyStyles: strArray(o.unlock.bodyStyles)
    };
  }
  return out;
}

function validNetwork(rules) {
  if (!Array.isArray(rules)) return null;
  const seen = new Set();
  const out = [];
  for (const r of rules) {
    if (!r || typeof r !== "object") continue;
    const id = Number(r.id);
    if (!Number.isInteger(id) || id < RULE_ID_MIN || id > RULE_ID_MAX) continue;
    if (seen.has(id)) continue;
    if (!r.action || !ACTIONS.has(r.action.type)) continue;
    if (!r.condition || typeof r.condition !== "object") continue;
    if (r.condition.urlFilter !== undefined && !isStr(r.condition.urlFilter)) continue;
    if (r.condition.regexFilter !== undefined) continue; // not worth the risk
    const types = Array.isArray(r.condition.resourceTypes)
      ? r.condition.resourceTypes.filter((t) => RESOURCES.has(t))
      : undefined;
    /* Never let a fetched rule block a page's main frame. */
    if (types && types.includes("main_frame")) continue;

    seen.add(id);
    out.push({
      id,
      priority: Number(r.priority) || 1,
      action: { type: r.action.type },
      condition: { ...r.condition, ...(types ? { resourceTypes: types } : {}) }
    });
  }
  return out;
}

function validPlayer(o) {
  if (!o || typeof o !== "object") return null;
  return {
    playerKeys: strArray(o.playerKeys),
    adMarkers: strArray(o.adMarkers),
    adGateReasons: strArray(o.adGateReasons),
    enforceText: strArray(o.enforceText)
  };
}

/* ------------------------------- fetching ------------------------------- */

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getText(url, etag) {
  const headers = {};
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(url, { headers, credentials: "omit", cache: "no-cache" });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("payload too large");
  return { text, etag: res.headers.get("etag") || "" };
}

async function applyNetwork(rules) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .map((r) => r.id)
    .filter((id) => id >= RULE_ID_MIN && id <= RULE_ID_MAX);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rules
  });
}

/* --------------------------------- check -------------------------------- */

export async function checkForUpdates({ manual = false } = {}) {
  const now = Date.now();
  const state = await chrome.storage.local.get({
    filtersEtag: "",
    filtersVersion: "",
    filtersFailures: 0,
    filtersBackoffUntil: 0
  });

  if (!manual && state.filtersBackoffUntil > now) {
    return { skipped: "backoff" };
  }

  const base = await feedUrl();

  try {
    const manifestRes = await getText(base, manual ? "" : state.filtersEtag);
    if (manifestRes.notModified) {
      await chrome.storage.local.set({
        filtersCheckedAt: now,
        filtersFailures: 0,
        filtersError: ""
      });
      return { upToDate: true };
    }

    const manifest = JSON.parse(manifestRes.text);
    if (!manifest || !Array.isArray(manifest.files)) throw new Error("bad manifest");

    /* Version gate: an old client must not try to read a newer format. */
    const min = manifest.minExtensionVersion;
    if (min && cmpVersion(chrome.runtime.getManifest().version, min) < 0) {
      await chrome.storage.local.set({
        filtersCheckedAt: now,
        filtersError: "needs-update",
        filtersFailures: 0
      });
      return { needsExtensionUpdate: min };
    }

    if (manifest.listVersion && manifest.listVersion === state.filtersVersion) {
      await chrome.storage.local.set({
        filtersCheckedAt: now,
        filtersEtag: manifestRes.etag,
        filtersFailures: 0,
        filtersError: ""
      });
      return { upToDate: true };
    }

    /* Fetch and verify every file before applying any of it. */
    const parts = {};
    for (const file of manifest.files) {
      if (!isStr(file?.name) || !isStr(file?.url)) throw new Error("bad file entry");
      const url = new URL(file.url, base).toString();
      const { text } = await getText(url, "");
      if (file.sha256) {
        const got = await sha256(text);
        if (got !== file.sha256) throw new Error(`hash mismatch on ${file.name}`);
      }
      parts[file.name] = JSON.parse(text);
    }

    const cosmetic = parts.cosmetic ? validCosmetic(parts.cosmetic) : null;
    const network = parts.network ? validNetwork(parts.network) : null;
    const player = parts.player ? validPlayer(parts.player) : null;
    if (!cosmetic && !network && !player) throw new Error("nothing usable in feed");

    /* Keep the last-good copy so a bad list can be rolled back. */
    const current = await chrome.storage.local.get({ filters: null });
    const next = {
      version: manifest.listVersion || "unknown",
      generatedAt: manifest.generatedAt || "",
      cosmetic,
      player
    };

    if (network) await applyNetwork(network);
    await chrome.storage.local.set({
      filtersPrev: current.filters,
      filters: next,
      filtersNetwork: network || [],
      filtersVersion: next.version,
      filtersEtag: manifestRes.etag,
      filtersCheckedAt: now,
      filtersFailures: 0,
      filtersError: ""
    });

    return { updated: next.version };
  } catch (err) {
    const failures = state.filtersFailures + 1;
    const hours = BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)];
    await chrome.storage.local.set({
      filtersCheckedAt: now,
      filtersFailures: failures,
      filtersBackoffUntil: now + hours * 3600 * 1000,
      filtersError: String(err && err.message ? err.message : err)
    });
    /* The last-good list is still installed and still blocking. A failed
     * refresh is not an outage. */
    return { error: String(err && err.message ? err.message : err) };
  }
}

function cmpVersion(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function scheduleUpdates() {
  await chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
}

export function onAlarm(alarm) {
  if (alarm.name !== ALARM) return;
  checkForUpdates();
}

export { ALARM, DEFAULT_FEED };
