/* AdCuck - L4: player watchdog.
 *
 * The safety net. If an ad is playing despite the interceptor - because
 * YouTube changed a key name, or because the break was stitched in on the
 * server - this notices and gets past it: click the skip button if one exists,
 * otherwise seek the ad clip to its end.
 *
 * Deliberately conservative. It only acts while the player is actually
 * flagged as showing an ad, it never touches the real video's currentTime,
 * and it restores volume state it changed.
 */
(function () {
  "use strict";

  var F = globalThis.CB_FILTERS;
  if (!F) return;

  var P = F.player;
  var E = F.enforcement;

  document.addEventListener("__cb_filters", function () {
    P = F.player;
    E = F.enforcement;
  });
  var enabled = document.documentElement.dataset.cbState !== "off";
  var timer = null;
  var mutedByUs = false;
  var lastAdSeenAt = 0;
  var enforcedAt = 0;
  var nudges = 0;

  /* Slow-start watch.
   *
   * When ads are allowed to run, the player shows one within about a second
   * and the video follows instantly - so by then it already has everything it
   * needs. When ads are blocked and the video still sits there, the player is
   * not fetching, it is waiting. That wait is the thing to interrupt.
   *
   * Asking a player that is ready to play to start playing is about as gentle
   * an intervention as exists, which is why this is on by default and the
   * timer clamp is not. */
  var SLOW = { after: 1200, gap: 700, max: 6 };
  var startedAt = 0;   // when a player first appeared in this frame
  var startNudges = 0;
  var lastNudgeAt = 0;
  var reported = false;

  /* YouTube is a single-page app: performance.now() counts from when the TAB
   * opened, not from when you clicked this video. Measuring against it turned
   * a 15-second wait into a reported 92 seconds. Everything is measured
   * against navAt instead, which is reset on each in-app navigation. */
  var navAt = 0;
  var sawStopped = false; // proof we watched this video start, not the last one
  var everPlayed = false; // once true the user is in control; hands off
  var stallSignalled = false;
  var trace = [];
  var lastRs = -1;
  var lastRsAt = 0;

  function sinceNav() {
    return Math.round(performance.now() - navAt);
  }

  /* A compact record of what the player was doing while we waited. This is
   * the difference between "it has the video and refuses to play it" (which a
   * nudge fixes) and "it has nothing" (which nothing in the browser fixes). */
  function sample(video, player) {
    var rs = video ? video.readyState : -1;
    if (rs === lastRs) return;
    if (lastRs !== -1) {
      trace.push("rs" + lastRs + " " + ((sinceNav() - lastRsAt) / 1000).toFixed(1) + "s");
      if (trace.length > 12) trace.shift();
    }
    lastRs = rs;
    lastRsAt = sinceNav();
    if (player && diagOn()) {
      log("player " + (player.className || "").slice(0, 80) + " rs=" + rs +
          " at " + (sinceNav() / 1000).toFixed(1) + "s");
    }
  }

  function diagOn() {
    try {
      return document.documentElement.dataset.cbDiag === "on";
    } catch (e) {
      return false;
    }
  }

  function log() {
    if (!diagOn()) return;
    try {
      console.info.apply(console, ["%c[AdCuck]",
        "color:#0E6E64;font-weight:bold"].concat([].slice.call(arguments)));
    } catch (e) { /* no-op */ }
  }

  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /* The "Experiencing interruptions?" flow does two things: it shows a toast,
   * and it stalls playback. The interceptor removes the payload and the
   * cosmetic layer removes the toast; this restarts a player that was already
   * told to wait before either of those landed. */
  document.addEventListener("__cb_enforcement", function () {
    enforcedAt = Date.now();
    nudges = 0;
    if (enabled) start();
  });

  function nudge(player) {
    if (!enforcedAt || nudges >= E.maxNudges) return;
    if (Date.now() - enforcedAt < E.nudgeAfterMs) return;
    if (Date.now() - enforcedAt > 20000) {
      enforcedAt = 0; // window closed; stop trying
      return;
    }
    if (!player) return;

    var video = player.querySelector("video");
    if (!video) return;

    var stalled =
      video.paused ||
      video.readyState < 3 ||
      player.classList.contains("unstarted-mode") ||
      player.classList.contains("buffering-mode");
    if (!stalled) {
      enforcedAt = 0; // playing fine now
      return;
    }

    nudges++;
    try {
      if (typeof player.playVideo === "function") player.playVideo();
      else video.play().catch(function () {});
    } catch (e) {
      /* no-op */
    }
  }

  var failReported = false;

  /* A dead player is worse than a slow one. If the video errors, say so, so
   * the ad-free path can stand down and reload with YouTube's own response. */
  function checkFailure(player, video) {
    if (failReported) return;
    var broken =
      (video && video.error) ||
      player.classList.contains("ytp-error") ||
      !!player.querySelector(".ytp-error");
    if (!broken) return;
    failReported = true;
    log("playback error detected");
    try {
      document.dispatchEvent(new CustomEvent("__cb_adfree_fail", { detail: {} }));
    } catch (e) { /* no-op */ }
  }

  function watchStart(player) {
    if (reported || !player) return;

    var video = player.querySelector("video");
    if (!video) return;

    checkFailure(player, video);

    sample(video, player);

    var playing = !video.paused && video.currentTime > 0.15;

    /* Do not report until we have actually seen this video sitting stopped.
     * Without that, an SPA navigation while the previous video is still
     * playing reports an instant start that never happened. */
    if (!playing) sawStopped = true;

    if (playing) everPlayed = true;

    if (playing && sawStopped) {
      reported = true;
      trace.push("rs" + lastRs + " playing");
      try {
        if (alive()) {
          chrome.runtime.sendMessage(
            {
              type: "cb:started",
              ms: sinceNav(),
              nudges: startNudges,
              trace: trace.join(" -> ")
            },
            function () { void chrome.runtime.lastError; }
          );
        }
      } catch (e) {
        /* context invalidated on reload */
      }
      log("started in " + (sinceNav() / 1000).toFixed(1) + "s  " + trace.join(" -> "));
      return;
    }
    if (playing) return;

    if (adShowing(player)) return;      // an ad is running; not a stall
    if (!startedAt) startedAt = Date.now();

    var waited = Date.now() - startedAt;
    if (waited < SLOW.after) return;

    /* Tell the interceptor we are stalled. That is a far better trigger for
     * the delay bypass than trying to spot an enforcement payload: it fires
     * on the symptom we actually care about, and only on a page that is
     * already misbehaving. */
    if (!stallSignalled) {
      stallSignalled = true;
      try {
        document.dispatchEvent(new CustomEvent("__cb_stall", {
          detail: { waited: waited, readyState: video.readyState }
        }));
      } catch (e) { /* no-op */ }
      log("stalled at " + (sinceNav() / 1000).toFixed(1) + "s, rs=" + video.readyState);
    }

    if (startNudges >= SLOW.max) return;
    if (Date.now() - lastNudgeAt < SLOW.gap) return;

    /* Never fight the user. Once the video has genuinely played, a pause is
     * their decision, not a stall. */
    if (everPlayed || video.currentTime > 0.2) return;

    /* An unstarted player sits at readyState 0 precisely BECAUSE nothing has
     * asked it to play yet - calling playVideo() is what makes it fetch. An
     * earlier build refused to nudge below readyState 2, which meant the one
     * case worth fixing was the one case it skipped. */
    startNudges++;
    lastNudgeAt = Date.now();
    try {
      if (typeof player.playVideo === "function") player.playVideo();
      if (video.paused) video.play().catch(function () {});
    } catch (e) {
      /* no-op */
    }
  }

  function adShowing(player) {
    if (!player) return false;
    for (var i = 0; i < P.adClasses.length; i++) {
      if (player.classList.contains(P.adClasses[i])) return true;
    }
    return false;
  }

  function clickFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el;
      try {
        el = document.querySelector(selectors[i]);
      } catch (e) {
        continue;
      }
      if (el && el.offsetParent !== null) {
        try {
          el.click();
          return true;
        } catch (e) {
          /* no-op */
        }
      }
    }
    return false;
  }

  function tick() {
    if (!enabled) return;

    var player;
    try {
      player = document.querySelector(P.container);
    } catch (e) {
      return;
    }

    /* Overlay banners have their own close button and can be dismissed
     * whether or not a video ad is running. */
    clickFirst(P.closeButtons);

    nudge(player);
    watchStart(player);

    if (!adShowing(player)) {
      if (mutedByUs) {
        var v0 = player && player.querySelector("video");
        if (v0) v0.muted = false;
        mutedByUs = false;
      }
      lastAdSeenAt = 0;
      return;
    }

    if (!lastAdSeenAt) lastAdSeenAt = Date.now();

    var video = player.querySelector("video");
    if (!video) return;

    /* Mute immediately - seeking is not instantaneous and nobody wants two
     * seconds of an ad's audio. */
    if (!video.muted) {
      video.muted = true;
      mutedByUs = true;
    }

    if (clickFirst(P.skipButtons)) {
      if (window.__cbCount) window.__cbCount(1);
      return;
    }

    /* No skip button: jump to the end of the ad clip. Guarded on a finite,
     * sane duration so we can never seek the real video. */
    var d = video.duration;
    if (isFinite(d) && d > 0 && d < 900 && video.currentTime < d - 0.15) {
      try {
        video.currentTime = d;
        if (video.paused) video.play().catch(function () {});
        if (window.__cbCount) window.__cbCount(1);
      } catch (e) {
        /* no-op */
      }
    }
  }

  /* Two tiers. YouTube pages carry several iframes and most of them will
   * never hold a player, so a 350ms interval in every frame is pure waste.
   * Frames without a player just check whether one appeared, slowly. */
  var idleTimer = null;

  function hasPlayer() {
    try {
      return !!document.querySelector(P.container);
    } catch (e) {
      return false;
    }
  }

  function goActive() {
    if (timer) return;
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    timer = setInterval(function () {
      if (!hasPlayer()) { goIdle(); return; }
      tick();
    }, 500);
  }

  function goIdle() {
    if (timer) { clearInterval(timer); timer = null; }
    if (idleTimer) return;
    idleTimer = setInterval(function () {
      if (hasPlayer()) goActive();
    }, 2000);
  }

  function start() {
    if (hasPlayer()) goActive();
    else goIdle();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  }

  function resetWatch() {
    navAt = performance.now();
    startedAt = 0;
    startNudges = 0;
    reported = false;
    sawStopped = false;
    everPlayed = false;
    stallSignalled = false;
    failReported = false;
    trace = [];
    lastRs = -1;
    lastRsAt = 0;
  }

  window.addEventListener("yt-navigate-start", resetWatch);
  window.addEventListener("yt-navigate-finish", function () {
    /* navigate-start is the honest zero, but it does not always fire (back
     * button, some in-app links), so only reset here if nothing has yet. */
    if (reported || sawStopped) resetWatch();
  });

  document.addEventListener("__cb_state", function (e) {
    enabled = !!(e && e.detail && e.detail.enabled);
    if (enabled) start();
    else stop();
  });

  if (enabled) start();
})();
