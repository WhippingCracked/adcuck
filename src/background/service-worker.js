/* AdCuck - service worker.
 *
 * Owns persistent state, the counters, the toolbar icon, and the enabled
 * state of the network ruleset. Does no work at idle: no polling, no timers,
 * only event handlers.
 */

import { checkForUpdates, scheduleUpdates, onAlarm } from "./updater.js";

const RULESET = "youtube-ads";
const DEFAULTS = {
  enabled: true,
  allowlist: [],
  theme: "auto",
  diagnostics: false,
  feedUrl: "",
  clamp: true,
  netRules: true,
  videoAds: true,
  adFree: true
};

const ICONS = {
  on: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png"
  },
  off: {
    16: "icons/icon-paused-16.png",
    32: "icons/icon-paused-32.png",
    48: "icons/icon-paused-48.png",
    128: "icons/icon-paused-128.png"
  }
};

async function getState() {
  return chrome.storage.sync.get(DEFAULTS);
}

/* Keep the toolbar icon, tooltip and badge in step with the master toggle.
 * State must be readable from the toolbar alone, without opening the popup. */
async function reflect(enabled, netRules) {
  try {
    await chrome.action.setIcon({ path: enabled ? ICONS.on : ICONS.off });
    await chrome.action.setTitle({
      title: enabled ? "AdCuck - blocking" : "AdCuck - paused"
    });
    await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
    await chrome.action.setBadgeBackgroundColor({ color: "#8A939B" });
  } catch (e) {
    /* icon files missing during development; not fatal */
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      enabled && netRules !== false
        ? { enableRulesetIds: [RULESET] }
        : { disableRulesetIds: [RULESET] }
    );
  } catch (e) {
    /* ruleset already in the requested state */
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.sync.get(null);
  const seed = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in current)) seed[k] = v;
  }
  if (Object.keys(seed).length) await chrome.storage.sync.set(seed);

  const state = await getState();
  await reflect(state.enabled, state.netRules);

  if (details.reason === "install") {
    await chrome.storage.local.set({ totalBlocked: 0, firstRun: true });
  }

  await scheduleUpdates();
  checkForUpdates();
});

chrome.alarms.onAlarm.addListener(onAlarm);

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  await reflect(state.enabled, state.netRules);
  await chrome.storage.session.set({ sessionBlocked: 0 });
  await scheduleUpdates();
  checkForUpdates();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && (changes.enabled || changes.netRules)) {
    const state = await getState();
    await reflect(state.enabled, state.netRules);
  }
});

/* Counters. Content scripts batch their reports, so this fires rarely. */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg) return;

  if (msg.type === "cb:blocked") {
    (async () => {
      const n = Number(msg.count) || 0;
      if (n <= 0) return;
      const local = await chrome.storage.local.get({ totalBlocked: 0 });
      const session = await chrome.storage.session.get({ sessionBlocked: 0 });
      await chrome.storage.local.set({ totalBlocked: local.totalBlocked + n });
      await chrome.storage.session.set({
        sessionBlocked: session.sessionBlocked + n
      });
    })();
    return; // fire and forget
  }

  if (msg.type === "cb:started") {
    chrome.storage.session.set({
      lastStartMs: Number(msg.ms) || 0,
      lastStartNudges: Number(msg.nudges) || 0,
      lastTrace: String(msg.trace || "")
    });
    return;
  }

  if (msg.type === "cb:perf") {
    chrome.storage.session.set({ lastCostMs: Number(msg.ms) || 0 });
    return;
  }

  if (msg.type === "cb:checkFilters") {
    checkForUpdates({ manual: true }).then(respond);
    return true;
  }

  if (msg.type === "cb:toggle") {
    (async () => {
      const state = await getState();
      const next = typeof msg.value === "boolean" ? msg.value : !state.enabled;
      await chrome.storage.sync.set({ enabled: next });
      respond({ enabled: next });
    })();
    return true;
  }

  if (msg.type === "cb:allowChannel") {
    (async () => {
      const state = await getState();
      const set = new Set(state.allowlist);
      if (msg.allow) set.add(msg.channelId);
      else set.delete(msg.channelId);
      const allowlist = [...set].slice(-500); // bound the attribute we publish
      await chrome.storage.sync.set({ allowlist });
      respond({ allowlist });
    })();
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-blocking") return;
  const state = await getState();
  await chrome.storage.sync.set({ enabled: !state.enabled });
});
