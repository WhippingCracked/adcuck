/* AdCuck - skip sponsor segments, and offer the highlight.
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
 *
 * The highlight is offered, never taken: it puts a button on screen and waits
 * to be asked. Jumping someone past the start of a video they chose to open
 * is not a decision this should make on their behalf.
 */
(function () {
  "use strict";

  var enabled = false;
  var wantHighlight = false;
  var video = null;
  var segments = [];
  var highlight = null;
  var done = Object.create(null);   // uuid -> already skipped once
  var currentId = "";

  var host = null;
  var toastBox = null;
  var jumpBtn = null;
  var jumpUsed = false;

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
    if (!enabled || !video) return;

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

    /* Once you are past it, the offer is meaningless. */
    if (jumpBtn && highlight !== null && t >= highlight - 0.5) hideJump();
  }

  function label(category) {
    var names = {
      sponsor: "Skipped a sponsor",
      selfpromo: "Skipped self-promotion",
      interaction: "Skipped a reminder",
      intro: "Skipped the intro",
      outro: "Skipped the outro",
      music_offtopic: "Skipped a non-music bit",
      filler: "Skipped filler",
      preview: "Skipped a recap"
    };
    return names[category] || "Skipped a sponsor";
  }

  /* ------------------------------ the chrome ---------------------------- */

  var CSS =
    ":host{all:initial}" +
    ".wrap{display:flex;flex-direction:column;gap:8px;align-items:flex-start;" +
    "font:500 13px/1.2 Roboto,'Segoe UI',system-ui,sans-serif}" +
    ".t,.j{background:rgba(14,110,100,.95);color:#fff;padding:9px 13px;" +
    "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);" +
    "opacity:0;pointer-events:none;transition:opacity .2s ease}" +
    ".t.show,.j.show{opacity:1}" +
    ".j{border:0;cursor:pointer;font:inherit;display:flex;align-items:center;gap:7px}" +
    ".j.show{pointer-events:auto}" +
    ".j:hover{background:rgba(14,110,100,1)}" +
    ".j:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
    "@media (prefers-reduced-motion:reduce){.t,.j{transition:none}}";

  function chrome_() {
    if (host) return true;
    try {
      host = document.createElement("div");
      host.id = "cb-sponsor-ui";
      host.style.cssText = "position:fixed;left:16px;bottom:72px;z-index:2147483000;";
      var shadow = host.attachShadow({ mode: "closed" });

      var style = document.createElement("style");
      style.textContent = CSS;

      var wrap = document.createElement("div");
      wrap.className = "wrap";

      jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.className = "j";
      jumpBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M5 5l9 7-9 7V5Z" fill="currentColor"/>' +
        '<path d="M18 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
      jumpBtn.appendChild(document.createTextNode("Jump to the best bit"));
      jumpBtn.addEventListener("click", takeJump);

      toastBox = document.createElement("span");
      toastBox.className = "t";

      wrap.appendChild(jumpBtn);
      wrap.appendChild(toastBox);
      shadow.appendChild(style);
      shadow.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);
      return true;
    } catch (e) {
      host = null;
      return false;
    }
  }

  /* A jump with no explanation reads as a glitch, so say what happened. */
  var toastTimer = null;
  function toast(text) {
    if (!chrome_()) return;
    toastBox.textContent = text;
    toastBox.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastBox.classList.remove("show");
    }, 2600);
  }

  function showJump() {
    if (!wantHighlight || highlight === null || jumpUsed) return;
    if (!video || video.currentTime >= highlight - 0.5) return;
    if (!chrome_()) return;
    jumpBtn.classList.add("show");
  }

  function hideJump() {
    if (jumpBtn) jumpBtn.classList.remove("show");
  }

  function takeJump() {
    if (highlight === null || !video) return;
    jumpUsed = true;
    try {
      video.currentTime = highlight;
      if (video.paused) video.play().catch(function () {});
    } catch (e) {
      /* no-op */
    }
    hideJump();
    toast("Jumped to the best bit");
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

  function load(force) {
    var id = videoId();
    if (!id) return;
    if (id === currentId && !force) return;
    currentId = id;
    segments = [];
    highlight = null;
    jumpUsed = false;
    hideJump();
    done = Object.create(null);

    if (!enabled || !alive()) return;

    try {
      chrome.runtime.sendMessage({ type: "cb:segments", videoId: id }, function (res) {
        if (chrome.runtime.lastError || !res) return;
        if (videoId() !== id) return; // navigated away while we waited
        segments = res.segments || [];
        highlight = typeof res.highlight === "number" ? res.highlight : null;
        showJump();
      });
    } catch (e) {
      /* extension reloaded under us */
    }
  }

  function reset() {
    currentId = "";
    load();
  }

  window.addEventListener("yt-navigate-start", reset);
  window.addEventListener("yt-navigate-finish", reset);
  document.addEventListener("yt-navigate-finish", reset);

  document.addEventListener("__cb_sponsors", function (e) {
    var d = (e && e.detail) || {};
    var was = enabled;
    var wasHl = wantHighlight;
    enabled = !!d.enabled;
    wantHighlight = !!d.highlight;

    if (!enabled) {
      segments = [];
      highlight = null;
      hideJump();
      return;
    }
    /* Changing which categories are skipped means the answer we cached is the
     * wrong answer, so ask again rather than waiting for the next video. */
    load(true);
    if (wasHl !== wantHighlight || was !== enabled) showJump();
  });

  /* The player element arrives late and is replaced on navigation. */
  setInterval(function () {
    if (!alive()) return;
    attach();
    if (enabled) {
      load();
      showJump();
    }
  }, 1000);

  attach();
})();
