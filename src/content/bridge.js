/* AdCuck - the bridge between the extension and the page realm.
 *
 * The interceptor runs in the MAIN world, where chrome.storage does not exist.
 * This script runs in the isolated world at document_start and publishes state
 * onto <html> as data attributes, which the interceptor reads synchronously.
 *
 * The race this solves: chrome.storage is async, so reading it here would let
 * a frame or two of page script run before we know the user has paused
 * blocking. We mirror the flag into localStorage (synchronous) so the very
 * first read is already correct, then reconcile with chrome.storage.
 */
(function () {
  "use strict";

  var MIRROR_STATE = "__cb_state";
  var MIRROR_ALLOW = "__cb_allow";
  var MIRROR_DIAG = "__cb_diag";
  var MIRROR_CLAMP = "__cb_clamp";
  var MIRROR_VIDEO = "__cb_video";
  var MIRROR_ADFREE = "__cb_adfree";
  var EVT_BLOCKED = "__cb_blocked";
  var EVT_CHANNEL = "__cb_channel";

  var DEFAULTS = {
    enabled: true,
    allowlist: [],
    diagnostics: false,
    clamp: true,
    videoAds: true,
    adFree: true,
    sponsorBlock: false,
    sponsorCategories: null,
    sponsorHighlight: false
  };
  var root = document.documentElement;
  var channel = { id: "", name: "" };
  var pending = 0;
  var pageBlocked = 0;
  var flushTimer = null;

  function readMirror(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback; // storage partitioned or blocked; not fatal
    }
  }

  function writeMirror(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* no-op */
    }
  }

  // --- Seed synchronously, before the interceptor's first read. -----------
  root.dataset.cbState = readMirror(MIRROR_STATE, "on");
  root.dataset.cbAllow = readMirror(MIRROR_ALLOW, "");
  root.dataset.cbDiag = readMirror(MIRROR_DIAG, "off");
  root.dataset.cbClamp = readMirror(MIRROR_CLAMP, "off");
  root.dataset.cbVideo = readMirror(MIRROR_VIDEO, "on");
  root.dataset.cbAdFree = readMirror(MIRROR_ADFREE, "on");

  function apply(state) {
    var next = state.enabled === false ? "off" : "on";
    root.dataset.cbState = next;
    writeMirror(MIRROR_STATE, next);

    var allow = Array.isArray(state.allowlist) ? state.allowlist.join(",") : "";
    root.dataset.cbAllow = allow;
    writeMirror(MIRROR_ALLOW, allow);

    var diag = state.diagnostics ? "on" : "off";
    root.dataset.cbDiag = diag;
    writeMirror(MIRROR_DIAG, diag);

    var clamp = state.clamp ? "on" : "off";
    root.dataset.cbClamp = clamp;
    writeMirror(MIRROR_CLAMP, clamp);

    var video = state.videoAds === false ? "off" : "on";
    root.dataset.cbVideo = video;
    writeMirror(MIRROR_VIDEO, video);

    var adFree = state.adFree === false ? "off" : "on";
    root.dataset.cbAdFree = adFree;
    writeMirror(MIRROR_ADFREE, adFree);

    document.dispatchEvent(
      new CustomEvent("__cb_sponsors", {
        detail: {
          enabled: next === "on" && state.sponsorBlock === true,
          highlight: state.sponsorHighlight === true
        }
      })
    );
    document.dispatchEvent(
      new CustomEvent("__cb_state", { detail: { enabled: next === "on" } })
    );
  }

  // --- Authoritative state from storage. ----------------------------------
  chrome.storage.sync.get(DEFAULTS, function (state) {
    if (chrome.runtime.lastError) return;
    apply(state);
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    if (!changes.enabled && !changes.allowlist && !changes.diagnostics &&
        !changes.clamp && !changes.videoAds && !changes.adFree &&
        !changes.sponsorBlock && !changes.sponsorCategories &&
        !changes.sponsorHighlight) return;
    chrome.storage.sync.get(DEFAULTS, function (state) {
      if (chrome.runtime.lastError) return;
      apply(state);
    });
  });

  /* Updated filters arrive from the service worker's feed. The bundled copy
   * in filters.js is what runs at document_start; this refines it a few
   * milliseconds later, which is soon enough for anything that matters. */
  /* ...but only if it is actually newer than what shipped.
   *
   * The feed exists to deliver filters added since this build. It must never
   * hand back filters from BEFORE it. That is not a hypothetical: between
   * adding filters locally and remembering to push them, the published list
   * is older than the bundled one - and a fresh install would quietly throw
   * away the good list for the stale one, with nothing said anywhere.
   *
   * editedAt is stamped into filters.js whenever the list is edited;
   * generatedAt is when the feed was built from it. A feed built from this
   * list, or a later one, is always the newer of the two. Both are ISO
   * strings, so ordering them is a plain comparison. If either is missing -
   * an older extension, a hand-edited list - fall back to trusting the feed,
   * which is the behaviour this replaces. */
  function feedIsNewer(stored, base) {
    if (!stored.generatedAt || !base.editedAt) return true;
    return String(stored.generatedAt) >= String(base.editedAt);
  }

  function publishFilters(stored) {
    if (!stored || !stored.cosmetic) return;
    var base = globalThis.CB_FILTERS;
    if (!base) return;
    if (!feedIsNewer(stored, base)) {
      try {
        document.documentElement.dataset.cbFeed = "older-than-bundled";
      } catch (e) {
        /* the readout is a convenience, not a job */
      }
      return;
    }
    var c = stored.cosmetic;
    if (c.hide && c.hide.length) base.hide = c.hide;
    if (c.remove && c.remove.length) base.remove = c.remove;
    if (c.enforcement) base.enforcement = c.enforcement;
    if (c.player) base.player = c.player;
    if (c.unlock) base.unlock = c.unlock;
    base.version = stored.version || base.version;

    document.dispatchEvent(new CustomEvent("__cb_filters", { detail: {} }));
    if (stored.player) {
      document.dispatchEvent(
        new CustomEvent("__cb_playercfg", { detail: stored.player })
      );
    }
  }

  chrome.storage.local.get({ filters: null }, function (r) {
    if (chrome.runtime.lastError) return;
    publishFilters(r.filters);
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local" || !changes.filters) return;
    publishFilters(changes.filters.newValue);
  });

  // --- Counters. Batched so we never hammer storage. -----------------------
  function flush() {
    flushTimer = null;
    if (!pending) return;
    var n = pending;
    pending = 0;
    try {
      chrome.runtime.sendMessage({ type: "cb:blocked", count: n }, function () {
        void chrome.runtime.lastError; // service worker asleep; drop it
      });
    } catch (e) {
      /* extension context invalidated on reload; harmless */
    }
  }

  function count(n) {
    pending += n;
    pageBlocked += n;
    if (!flushTimer) flushTimer = setTimeout(flush, 2000);
  }

  document.addEventListener(EVT_BLOCKED, function (e) {
    var n = e && e.detail && e.detail.count;
    if (typeof n === "number" && n > 0) count(n);
  });

  document.addEventListener("__cb_perf", function (e) {
    if (!e || !e.detail) return;
    try {
      chrome.runtime.sendMessage(
        { type: "cb:perf", ms: e.detail.ms, bytes: e.detail.bytes },
        function () { void chrome.runtime.lastError; }
      );
    } catch (err) {
      /* context invalidated on reload */
    }
  });

  document.addEventListener(EVT_CHANNEL, function (e) {
    if (e && e.detail && e.detail.id) channel = e.detail;
  });

  window.addEventListener("pagehide", flush);

  // Expose to the other content scripts in this isolated world.
  window.__cbCount = count;
  window.__cbPageBlocked = function () {
    return pageBlocked;
  };

  // --- Answer the popup. ---------------------------------------------------
  chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || msg.type !== "cb:tabState") return;
    respond({
      host: location.hostname,
      isWatch: location.pathname === "/watch",
      channelId: channel.id,
      channelName: channel.name,
      pageBlocked: pageBlocked
    });
    return true;
  });
})();
