/* AdCuck - L2: player-response interceptor.
 *
 * Runs in the MAIN world at document_start, i.e. in YouTube's own JavaScript
 * realm, before any of YouTube's scripts execute. This is the layer that
 * removes pre-rolls and mid-rolls: YouTube's video ads are not separate
 * network requests, they are fields inside the same-origin JSON that also
 * carries the video you asked for. We delete those fields before the player
 * ever sees them.
 *
 * It also handles enforcement - the "Experiencing interruptions?" toast and
 * the artificial delay that ships with it. See ENFORCEMENT below.
 *
 * HARD RULE: every path fails open. If anything in here throws, the original
 * untouched value is returned. A blocker that throws inside JSON.parse does
 * not show ads, it shows a black page.
 */
(function () {
  "use strict";

  var STATE_ATTR = "cbState"; // dataset key written by bridge.js
  var ALLOW_ATTR = "cbAllow"; // comma-joined allowlisted channel ids
  var DIAG_ATTR = "cbDiag";   // "on" enables console diagnostics
  var CLAMP_ATTR = "cbClamp"; // "on" opts in to the timer clamp
  var EVT_BLOCKED = "__cb_blocked";
  var EVT_CHANNEL = "__cb_channel";
  var EVT_ENFORCE = "__cb_enforcement";

  // Top-level keys carrying ad payloads in a player response.
  var PLAYER_KEYS = [
    "adPlacements",
    "adSlots",
    "playerAds",
    "adBreakHeartbeatParams",
    "adParams",
    "adServingDataEntry"
  ];

  // Keys whose presence marks an object as an ad unit anywhere in a response.
  var AD_MARKERS = [
    "adSlotRenderer",
    "adSlotMetadata",
    "displayAdRenderer",
    "promotedSparklesWebRenderer",
    "promotedSparklesTextSearchRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "compactPromotedItemRenderer",
    "searchPyvRenderer",
    "bannerPromoRenderer",
    "statementBannerRenderer",
    "videoMastheadAdV3Renderer",
    "primetimePromoRenderer",
    "carouselAdRenderer",
    "actionCompanionAdRenderer",
    "instreamVideoAdRenderer",
    "adsEngagementPanelRenderer",
    "mealbarPromoRenderer",
    "brandVideoShelfRenderer",
    "brandVideoSingletonRenderer",
    "adPlacementRenderer",
    "adBreakServiceRenderer",
    "adAvatarViewModel",
    "adBadgeViewModel",
    "adButtonViewModel",
    "aboutThisAdRenderer",
    "playerBytesAdLayoutRenderer",
    "aboveFeedAdLayoutRenderer",
    "adImageViewModel",
    "adAvatarLockupViewModel",
    "adDetailsLineViewModel",
    "inPlayerAdLayoutRenderer",
    "adPreviewViewModel",
    "playerAdAvatarLockupCardButtonedViewModel",
    "visitAdvertiserLinkViewModel",
    "adBadgeRenderer",
    "adDurationRemainingRenderer",
    "adInfoRenderer",
    "adHoverTextButtonRenderer",
    "adPodIndexViewModel",
    "playerLegacyDesktopWatchAdsRenderer",
    "playerAdParams",
    "adsEngagementPanelContentRenderer",
    "clientForecastingAdRenderer",
    "skipAdViewModel",
    "skipAdButtonViewModel"
  ];

  /* ---------------------------- ENFORCEMENT -----------------------------
   * The "Experiencing interruptions?" toast and the hard "Ad blockers are not
   * allowed" modal are the same system. YouTube renames the carrier keys
   * freely, so matching exact key names dates badly. We match two ways:
   *
   *   1. A loose key pattern - anything mentioning enforcement or adblock.
   *   2. The user-visible copy, which changes far less often than the schema.
   *
   * Text matching is deliberately fenced: it only applies to small renderer
   * objects with no videoId, so a video *about* ad blockers is never pruned.
   */
  var ENFORCE_KEY = /enforcement|adblock|ad_?block|abcConfig/i;
  var ENFORCE_TEXT = new RegExp(
    [
      "experiencing interruptions",
      "ad ?blockers? (are not allowed|aren't allowed|violate)",
      "the use of ad ?blockers",
      "bloqueador(es)? de anuncios",
      "werbeblocker",
      "bloqueurs? de publicit",
      "\\u0431\\u043b\\u043e\\u043a\\u0438\\u0440\\u043e\\u0432\\u0449\\u0438\\u043a"
    ].join("|"),
    "i"
  );
  var RENDERER_KEY = /(ViewModel|Renderer|Action|Command)$/;

  /* Hot-path lookups. These run once per key of every object in a multi-
   * megabyte payload, so they must be O(1) map hits, never array scans. */
  var hasOwn = Object.prototype.hasOwnProperty;
  var AD_MARKER = Object.create(null);
  var PLAYER_KEY = Object.create(null);

  // playabilityStatus reasons that mean "we detected a blocker", not
  // "this video is genuinely unavailable". Never clear a real error.
  var AD_GATE_REASONS = [
    "Ad blockers are not allowed on YouTube",
    "Ad blockers violate YouTube's Terms of Service",
    "The use of ad blockers"
  ];

  /* Bounded delay bypass.
   *
   * This was off by default while it armed on "we spotted an enforcement
   * payload", because that fires on pages that are working fine and zeroing
   * timers in a healthy player can make it retry and start slower.
   *
   * It now arms on the symptom instead: the watchdog reports a stall, and
   * only then are timers touched. A page that starts normally never reaches
   * this code, so the risk is confined to pages that are already broken -
   * which is what makes it safe enough to have on.
   *
   * Turn it off from the popup (with diagnostics on) if it ever misbehaves. */
  var CLAMP = {
    enabled: true,
    minDelay: 1200,   // below this, timers are ordinary player work
    maxDelay: 15000,  // above this, they are long-lived housekeeping
    windowMs: 20000,  // only for 20s after enforcement is detected
    maxHits: 12       // and only the first few
  };

  // Cheap substring probes. If none appear in the raw text we skip the walk
  // entirely, which is the ~99% case and keeps JSON.parse effectively free.
  var PROBE = /adPlacements|adSlots|playerAds|adSlotRenderer|promotedSparkles|promotedVideoRenderer|searchPyvRenderer|mealbarPromo|brandVideo/;
  /* Enforcement is probed separately: when a payload has none of these, the
   * whole text-matching path stays switched off for that payload. */
  var ENFORCE_PROBE = /enforcement|interruptions|[aA]d[bB]lock|ad_block/;

  (function () {
    for (var i = 0; i < AD_MARKERS.length; i++) AD_MARKER[AD_MARKERS[i]] = 1;
    for (var j = 0; j < PLAYER_KEYS.length; j++) PLAYER_KEY[PLAYER_KEYS[j]] = 1;
  })();

  var MAX_NODES = 150000; // walk budget, guards against pathological payloads
  var SCAN_BUDGET = 120;  // node visits allowed per enforcement text test
  var SCAN_DEPTH = 4;     // enforcement copy sits shallow inside its renderer
  var SCAN_ARRAY = 3;     // anything longer is a container, not a message
  var THIN_KEYS = 8;      // wrappers are thin; content payloads are not
  var enforcementSeen = false;
  var checkEnforcement = true; // set per payload, see worthScrubbing()

  /* Self-measurement. Turns "it feels slow" into a number we can act on. */
  var perf = { calls: 0, bytes: 0, ms: 0, reported: false };

  function enabled() {
    try {
      var ds = document.documentElement.dataset;
      /* cbVideo is the bisect switch: with it off this layer does nothing at
       * all, so a slow start can be attributed to it or ruled out. */
      return ds[STATE_ATTR] !== "off" && ds.cbVideo !== "off";
    } catch (e) {
      return true; // default to blocking
    }
  }

  function diag() {
    try {
      return document.documentElement.dataset[DIAG_ATTR] === "on";
    } catch (e) {
      return false;
    }
  }

  function log() {
    if (!diag()) return;
    try {
      var args = ["%c[AdCuck]", "color:#0E6E64;font-weight:bold"];
      console.info.apply(console, args.concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  function isAllowed(channelId) {
    if (!channelId) return false;
    try {
      var raw = document.documentElement.dataset[ALLOW_ATTR];
      if (!raw) return false;
      return ("," + raw + ",").indexOf("," + channelId + ",") !== -1;
    } catch (e) {
      return false;
    }
  }

  function report(n) {
    if (!n) return;
    try {
      document.dispatchEvent(
        new CustomEvent(EVT_BLOCKED, { detail: { count: n } })
      );
    } catch (e) {
      /* no-op */
    }
  }

  /* ------------------------- enforcement detection ---------------------- */

  /* Bounded scan for enforcement copy. Never stringifies: serialising every
   * candidate re-walks its whole subtree, which on a feed of thousands of
   * renderers is quadratic and costs more than parsing the payload did.
   *
   * Instead: visit at most SCAN_BUDGET nodes, test only string leaves, and
   * bail the moment a videoId turns up - that marks the object as content,
   * so a video *titled* "why ad blockers are not allowed" is never mistaken
   * for the warning itself. */
  function scan(node, depth, st) {
    if (st.stop || st.tooBig) return;
    if (--st.budget <= 0) { st.tooBig = true; return; }
    if (depth > SCAN_DEPTH) { st.tooBig = true; return; }

    if (typeof node === "string") {
      if (node.length < 400 && ENFORCE_TEXT.test(node)) st.hit = true;
      return;
    }
    if (!node || typeof node !== "object") return;

    /* A long array means this is a container - a feed, a shelf, a list of
     * items - not a message. Enforcement copy found *inside* a container
     * belongs to one item in it, and deleting the container would take the
     * whole feed with it. That is the bug this fence exists to prevent. */
    if (Array.isArray(node)) {
      if (node.length > SCAN_ARRAY) { st.tooBig = true; return; }
      for (var i = 0; i < node.length; i++) {
        scan(node[i], depth + 1, st);
        if (st.stop || st.tooBig) return;
      }
      return;
    }

    for (var k in node) {
      if (!hasOwn.call(node, k)) continue;
      if (k === "videoId" || k === "videoDetails") {
        st.stop = true;
        st.hit = false;
        return;
      }
      scan(node[k], depth + 1, st);
      if (st.stop || st.tooBig) return;
    }
  }

  function countKeys(node, cap) {
    var n = 0;
    for (var k in node) {
      if (!hasOwn.call(node, k)) continue;
      if (++n > cap) return n;
    }
    return n;
  }

  function looksLikeEnforcement(key, value) {
    if (typeof key === "string" && ENFORCE_KEY.test(key)) return true;
    if (!checkEnforcement) return false;
    if (!value || typeof value !== "object") return false;
    if (!RENDERER_KEY.test(key)) return false;
    if (countKeys(value, THIN_KEYS) > THIN_KEYS) return false;

    var st = { budget: SCAN_BUDGET, hit: false, stop: false, tooBig: false };
    scan(value, 0, st);
    /* Only accept a hit from a subtree small enough to be a UI message. If
     * the scan ran out of room, we were looking at content. */
    return st.hit && !st.tooBig;
  }

  function noteEnforcement(where, key) {
    log("enforcement payload removed", { at: where, key: key });
    if (enforcementSeen) return;
    enforcementSeen = true;
    /* Deliberately does NOT arm the delay bypass. Spotting an enforcement
     * payload says nothing about whether this page is actually slow - it
     * fires on pages that start fine, and clamping timers in a healthy
     * player can make it retry and start slower. Only a reported stall
     * arms it (see the __cb_stall listener below). */
    try {
      document.dispatchEvent(new CustomEvent(EVT_ENFORCE, { detail: {} }));
    } catch (e) {
      /* no-op */
    }
  }

  /* ------------------------------ pruning ------------------------------- */

  function looksLikeAd(node) {
    for (var k in node) {
      if (hasOwn.call(node, k) && AD_MARKER[k]) return true;
    }
    return false;
  }

  /* Feed items wrap their payload: a promoted video arrives as
   *   { richItemRenderer: { content: { adSlotRenderer: {...} } } }
   * Deleting only the inner key leaves an empty grid cell behind, so look a
   * few levels down and drop the whole wrapper. Depth is capped at 3 - deep
   * enough for every wrapper YouTube uses, shallow enough that a real item
   * mentioning an ad renderer far below is never swept up with it. */
  function wrapsAd(node, depth) {
    if (!node || typeof node !== "object" || depth > 3) return false;
    if (Array.isArray(node)) return false;
    if (looksLikeAd(node)) return true;
    if (countKeys(node, 6) > 6) return false; // wrappers are thin; payloads are not
    for (var k in node) {
      if (!hasOwn.call(node, k)) continue;
      if (looksLikeEnforcement(k, node[k])) return true;
      if (wrapsAd(node[k], depth + 1)) return true;
    }
    return false;
  }

  function prune(node, depth, budget) {
    if (depth > 24 || budget.n > MAX_NODES) return 0;
    if (!node || typeof node !== "object") return 0;
    budget.n++;

    var removed = 0;
    var i;

    if (Array.isArray(node)) {
      for (i = node.length - 1; i >= 0; i--) {
        var item = node[i];
        if (item && typeof item === "object" && wrapsAd(item, 0)) {
          node.splice(i, 1);
          removed++;
        } else {
          removed += prune(item, depth + 1, budget);
        }
      }
      return removed;
    }

    for (var key in node) {
      if (!hasOwn.call(node, key)) continue;

      if (AD_MARKER[key]) {
        delete node[key];
        removed++;
        continue;
      }
      if (looksLikeEnforcement(key, node[key])) {
        delete node[key];
        noteEnforcement("response", key);
        removed++;
        continue;
      }
      removed += prune(node[key], depth + 1, budget);
    }
    return removed;
  }

  /* Scrub a decoded object in place. Returns the same reference. */
  function scrub(obj) {
    if (!obj || typeof obj !== "object") return obj;

    var removed = 0;
    var i;

    // A player response? Publish the channel to the isolated world (the popup
    // needs it for the allowlist row) and honour the allowlist before touching
    // anything.
    var details = obj.videoDetails;
    if (details && details.channelId) {
      try {
        document.dispatchEvent(
          new CustomEvent(EVT_CHANNEL, {
            detail: { id: details.channelId, name: details.author || "" }
          })
        );
      } catch (e) {
        /* no-op */
      }
      if (isAllowed(details.channelId)) return obj;
    }

    for (i = 0; i < PLAYER_KEYS.length; i++) {
      if (hasOwn.call(obj, PLAYER_KEYS[i])) {
        delete obj[PLAYER_KEYS[i]];
        removed++;
      }
    }

    // Ad-gated playability: hand the player a clean OK status, but only for
    // reasons we recognise as anti-adblock enforcement.
    var ps = obj.playabilityStatus;
    if (
      ps &&
      (ps.status === "UNPLAYABLE" || ps.status === "ERROR") &&
      typeof ps.reason === "string"
    ) {
      for (i = 0; i < AD_GATE_REASONS.length; i++) {
        if (ps.reason.indexOf(AD_GATE_REASONS[i]) === -1) continue;
        noteEnforcement("playabilityStatus", ps.reason);
        /* Only claim the video is playable when there is actually something
         * to play. Handing the player an OK status with no streamingData
         * leaves it with no URLs, so it polls and retries - which looks
         * exactly like the long stall we are trying to remove. */
        if (obj.streamingData) {
          /* Patch in place. Replacing the whole object throws away fields the
           * player still needs (context params, miniplayer config, offline
           * state) and a player missing those can sit and wait. */
          ps.status = "OK";
          delete ps.reason;
          delete ps.errorScreen;
          delete ps.messages;
          removed++;
        } else {
          log("ad-gated response has no streamingData; left alone");
        }
        break;
      }
    }

    removed += prune(obj, 0, { n: 0 });
    report(removed);
    return obj;
  }

  function worthScrubbing(text) {
    if (typeof text !== "string") {
      checkEnforcement = true; // unknown shape, walk it
      return true;
    }
    checkEnforcement = ENFORCE_PROBE.test(text);
    return checkEnforcement || PROBE.test(text);
  }

  /* --------------------- bounded artificial-delay bypass ----------------- */

  /* setTimeout only. Never setInterval: clamping a 5s poll to 0 turns it into
   * a tight loop that pegs a core for as long as the page is open. */
  var nativeSetTimeout = window.setTimeout;
  var clampArmedUntil = 0;
  var clampHits = 0;
  var clampInstalled = false;

  function clampWrap(native) {
    return function (fn, delay) {
      var args = arguments;
      try {
        if (
          Date.now() < clampArmedUntil &&
          clampHits < CLAMP.maxHits &&
          typeof delay === "number" &&
          delay >= CLAMP.minDelay &&
          delay <= CLAMP.maxDelay &&
          typeof fn === "function"
        ) {
          clampHits++;
          log("clamped a " + delay + "ms timer to 0");
          args = [].slice.call(arguments);
          args[1] = 0;
        }
      } catch (e) {
        args = arguments;
      }
      return native.apply(window, args);
    };
  }

  function clampAllowed() {
    try {
      /* The popup switch can force it off; absent means follow the default. */
      if (document.documentElement.dataset[CLAMP_ATTR] === "off") return false;
    } catch (e) {
      /* fall through to the default */
    }
    return CLAMP.enabled;
  }

  function armClamp() {
    if (!clampAllowed()) return;
    clampArmedUntil = Date.now() + CLAMP.windowMs;
    clampHits = 0;
    if (clampInstalled) return;
    clampInstalled = true;
    try {
      window.setTimeout = clampWrap(nativeSetTimeout);
      // Hand the native back once the window has passed, so nothing we did
      // outlives the stall it was meant to fix.
      nativeSetTimeout(function restore() {
        if (Date.now() < clampArmedUntil) {
          nativeSetTimeout(restore, 1000);
          return;
        }
        window.setTimeout = nativeSetTimeout;
        clampInstalled = false;
        log("timer clamp disarmed");
      }, CLAMP.windowMs + 500);
    } catch (e) {
      clampInstalled = false;
    }
  }

  /* ---------- 1. window.ytInitialPlayerResponse / ytInitialData ----------
   * On a cold page load YouTube inlines these as object literals in a
   * <script> tag, so JSON.parse never sees them. Intercept the assignment. */
  function guardGlobal(name) {
    var value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () {
          return value;
        },
        set: function (v) {
          try {
            value = enabled() ? timed(v, 0) : v;
          } catch (e) {
            value = v;
          }
        }
      });
    } catch (e) {
      /* another extension got here first; not fatal */
    }
  }

  guardGlobal("ytInitialPlayerResponse");
  guardGlobal("ytInitialData");

  /* ---------- 2. JSON.parse ---------- */
  var nativeParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    var out = nativeParse.call(this, text, reviver);
    try {
      if (!enabled()) return out;
      if (!worthScrubbing(text)) return out;
      return timed(out, typeof text === "string" ? text.length : 0);
    } catch (e) {
      return out;
    }
  };

  /* Wraps scrub with a stopwatch and reports the total once the page has
   * settled. If this number is small and the video is still slow, the delay
   * is not coming from this extension. */
  function timed(obj, bytes) {
    var t0 = performance.now();
    var out = scrub(obj);
    perf.ms += performance.now() - t0;
    perf.bytes += bytes;
    perf.calls++;
    if (!perf.reported) {
      perf.reported = true;
      nativeSetTimeout(function () {
        log(
          "page cost: " + perf.ms.toFixed(1) + "ms across " + perf.calls +
          " payloads (" + (perf.bytes / 1e6).toFixed(2) + "MB scanned)"
        );
        /* Published whether or not diagnostics are on: the popup shows this
         * so "is it the extension?" can be answered by looking, rather than
         * by opening a console. */
        try {
          document.dispatchEvent(
            new CustomEvent("__cb_perf", {
              detail: { ms: perf.ms, calls: perf.calls, bytes: perf.bytes }
            })
          );
        } catch (e) {
          /* no-op */
        }
      }, 5000);
    }
    return out;
  }

  /* ---------- 3. Response.prototype.json (fetch-based innertube calls) ---- */
  if (window.Response && Response.prototype && Response.prototype.json) {
    var nativeJson = Response.prototype.json;
    Response.prototype.json = function () {
      var self = this;
      return nativeJson.apply(self, arguments).then(function (data) {
        try {
          if (!enabled()) return data;
          var url = self.url || "";
          // Only walk innertube payloads; other JSON is left alone.
          if (url && url.indexOf("/youtubei/") === -1 && url.indexOf("youtube.com") === -1) {
            return data;
          }
          return timed(data, 0);
        } catch (e) {
          return data;
        }
      });
    };
  }

  /* ---------- 4. Response.prototype.text is deliberately NOT patched ------
   * It would be redundant: anything that reads a body as text and wants an
   * object goes through JSON.parse, which is already hooked above. Patching
   * it as well meant parse -> walk -> stringify here, then YouTube's own
   * parse -> walk again: four passes over a multi-megabyte payload instead
   * of one, including a full re-serialise. */

  /* ---------- 4b. Refreshed key lists from the filter feed ---------------
   * Data only: names of fields to delete and sentences to match. The engine
   * that uses them never comes from the network. */
  document.addEventListener("__cb_playercfg", function (e) {
    var cfg = e && e.detail;
    if (!cfg) return;
    try {
      if (cfg.playerKeys && cfg.playerKeys.length) {
        PLAYER_KEYS = cfg.playerKeys;
        PLAYER_KEY = Object.create(null);
        for (var i = 0; i < PLAYER_KEYS.length; i++) PLAYER_KEY[PLAYER_KEYS[i]] = 1;
      }
      if (cfg.adMarkers && cfg.adMarkers.length) {
        AD_MARKERS = cfg.adMarkers;
        AD_MARKER = Object.create(null);
        for (var j = 0; j < AD_MARKERS.length; j++) AD_MARKER[AD_MARKERS[j]] = 1;
      }
      if (cfg.adGateReasons && cfg.adGateReasons.length) {
        AD_GATE_REASONS = cfg.adGateReasons;
      }
      if (cfg.enforceText && cfg.enforceText.length) {
        ENFORCE_TEXT = new RegExp(cfg.enforceText.join("|"), "i");
      }
      log("filter list refreshed");
    } catch (err) {
      /* keep the bundled lists */
    }
  });

  /* ---------- 5. Arm the bypass when the watchdog reports a stall --------
   * The watchdog can see something this layer cannot: whether the video
   * actually started. A stall is a much better trigger than a payload
   * match, because it is the thing the user is complaining about. */
  document.addEventListener("__cb_stall", function (e) {
    var rs = e && e.detail ? e.detail.readyState : -1;
    log("stall reported (readyState " + rs + "); arming the delay bypass");
    armClamp();
  });

  /* ---------- 6. Diagnostics hook ----------
   * Enabled only when the user turns diagnostics on. Reports what enforcement
   * carriers actually showed up on this machine, which is how you fix the real
   * key name instead of guessing at it. */
  if (diag()) {
    log("diagnostics on. Enforcement signals will be logged here.");
  }
})();
