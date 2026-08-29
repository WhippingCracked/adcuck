/* AdCuck - skip sponsor segments.
 *
 * Sponsor reads are advertising that lives inside the video file itself, so
 * none of the other layers can touch them. The timings come from
 * SponsorBlock, a shared list people submit and vote on.
 *
 * ATTRIBUTION IS A LICENCE CONDITION, not a courtesy: the database is
 * CC BY-NC-SA 4.0. The popup credits SponsorBlock whenever this is switched
 * on, and this must never be used in anything commercial.
 *
 * PRIVACY: the lookup never names the video. The service worker hashes the
 * video id and sends only the first four characters, so the server sees a
 * bucket of thousands of videos and cannot tell which one is being watched.
 * Matching the right one happens here, on the machine.
 */
(function () {
  "use strict";

  var F = globalThis.CB_FILTERS;
  if (!F) return;

  var enabled = false;
  var video = null;
  var segments = [];
  var done = Object.create(null);   // uuid -> already skipped once
  var currentId = "";
  var host = null;

  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function videoId() {
    try {
      if (location.pathname !== "/watch") return "";
      return new URL(location.href).searchParams.get("v") || "";
    } catch (e) {
      return "";
    }
  }

  /* --------------------------- the skip itself -------------------------- */

  function onTime() {
    if (!enabled || !video || !segments.length) return;

    var t = video.currentTime;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      if (done[s.uuid]) continue;
      /* The 0.3s tail stops a skip firing again on the far edge of a segment
       * when the seek lands a fraction short. */
      if (t >= s.start && t < s.end - 0.3) {
        done[s.uuid] = 1;
        try {
          video.currentTime = s.end;
        } catch (e) {
          return;
        }
        toast(label(s.category));
        if (window.__cbCount) window.__cbCount(1);
        return;
      }
    }
  }

  function label(category) {
    var names = {
      sponsor: "Skipped a sponsor",
      selfpromo: "Skipped self-promotion",
      interaction: "Skipped a reminder",
      intro: "Skipped the intro",
      outro: "Skipped the outro",
      music_offtopic: "Skipped a non-music bit",
      filler: "Skipped filler"
    };
    return names[category] || "Skipped a sponsor";
  }

  /* A jump with no explanation reads as a glitch, so say what happened.
   * Closed shadow root: YouTube's stylesheet cannot reach it, ours cannot
   * leak out. */
  var toastTimer = null;
  function toast(text) {
    try {
      if (!host) {
        host = document.createElement("div");
        host.id = "cb-sponsor-toast";
        host.style.cssText =
          "position:fixed;left:16px;bottom:72px;z-index:2147483000;";
        var shadow = host.attachShadow({ mode: "closed" });
        var style = document.createElement("style");
        style.textContent =
          ":host{all:initial}" +
          ".t{display:block;font:500 13px/1 Roboto,'Segoe UI',system-ui,sans-serif;" +
          "background:rgba(14,110,100,.95);color:#fff;padding:9px 13px;" +
          "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);" +
          "opacity:0;transition:opacity .2s ease}" +
          ".t.show{opacity:1}" +
          "@media (prefers-reduced-motion:reduce){.t{transition:none}}";
        var box = document.createElement("span");
        box.className = "t";
        shadow.appendChild(style);
        shadow.appendChild(box);
        host.__box = box;
        (document.body || document.documentElement).appendChild(host);
      }
      var box = host.__box;
      box.textContent = text;
      box.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        box.classList.remove("show");
      }, 2600);
    } catch (e) {
      /* a missing toast is not worth breaking playback over */
    }
  }

  /* ------------------------------ plumbing ------------------------------ */

  function attach() {
    var v = document.querySelector("video");
    if (!v || v === video) return;
    if (video) video.removeEventListener("timeupdate", onTime);
    video = v;
    /* timeupdate fires about four times a second - accurate enough that a
     * skip is not noticeable, and far cheaper than polling. */
    video.addEventListener("timeupdate", onTime);
  }

  function load() {
    var id = videoId();
    if (!id || id === currentId) return;
    currentId = id;
    segments = [];
    done = Object.create(null);

    if (!enabled || !alive()) return;

    try {
      chrome.runtime.sendMessage(
        { type: "cb:segments", videoId: id },
        function (res) {
          if (chrome.runtime.lastError || !res || !res.segments) return;
          if (videoId() !== id) return; // navigated away while we waited
          segments = res.segments;
        }
      );
    } catch (e) {
      /* extension reloaded under us */
    }
  }

  function reset() {
    currentId = "";
    segments = [];
    done = Object.create(null);
    load();
  }

  window.addEventListener("yt-navigate-finish", reset);
  document.addEventListener("yt-navigate-finish", reset);

  document.addEventListener("__cb_sponsors", function (e) {
    enabled = !!(e && e.detail && e.detail.enabled);
    if (enabled) {
      currentId = "";
      load();
    } else {
      segments = [];
    }
  });

  /* The player element arrives late and is replaced on navigation. */
  setInterval(function () {
    if (!alive()) return;
    attach();
    if (enabled) load();
  }, 1000);

  attach();
})();
