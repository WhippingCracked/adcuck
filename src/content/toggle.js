/* AdCuck - the on-page toggle.
 *
 * Lives inside YouTube's own masthead, left of the account avatar, rather than
 * floating over the player. A floating button collides with the player
 * controls and makes the extension feel bolted on; anchoring into the masthead
 * makes it read as part of the interface.
 *
 * Rendered inside a closed shadow root so YouTube's stylesheet cannot reach it
 * and ours cannot leak out.
 */
(function () {
  "use strict";

  var HOST_ID = "cb-toggle-host";
  var MOUNT = "ytd-masthead #end";
  var host = null;
  var shadow = null;
  var pill = null;
  var label = null;
  var enabled = document.documentElement.dataset.cbState !== "off";
  var flashTimer = null;
  var giveUpAt = Date.now() + 5000;
  var paintTimer = null;

  /* Reloading the extension orphans the content scripts already running in
   * open tabs: chrome.* still exists but every call throws "Extension context
   * invalidated". Check before calling, and shut ourselves down when it goes,
   * so a stale tab does not throw once a second forever. */
  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }


  var CSS = [
    ":host { all: initial; display: inline-flex; align-items: center; }",
    ".pill {",
    "  display: inline-flex; align-items: center; gap: 6px;",
    "  height: 28px; padding: 0 11px 0 8px; border: 0; border-radius: 999px;",
    "  font: 600 12px/1 Roboto, 'Segoe UI', system-ui, sans-serif;",
    "  letter-spacing: .2px; cursor: pointer; margin-right: 8px;",
    "  -webkit-font-smoothing: antialiased;",
    "  transition: background-color .18s ease, color .18s ease;",
    "}",
    "@media (prefers-reduced-motion: reduce) { .pill { transition: none; } }",
    ".pill:focus-visible { outline: 2px solid #0E6E64; outline-offset: 2px; }",
    /* Follows YouTube's theme, not the extension's own preference. */
    ".pill.light.on  { background: #0E6E64; color: #FFFFFF; }",
    ".pill.light.off { background: #F2F2F2; color: #606060; }",
    ".pill.dark.on   { background: #5BC8B8; color: #0B1211; }",
    ".pill.dark.off  { background: #272727; color: #AAAAAA; }",
    ".pill svg { display: block; flex: none; }",
    ".n { font-variant-numeric: tabular-nums; min-width: 8px; }"
  ].join("\n");

  var SHIELD =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 2.5 4.5 5.6v6.1c0 4.6 3.1 8.4 7.5 9.8 4.4-1.4 7.5-5.2 7.5-9.8V5.6L12 2.5Z" ' +
    'stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>';

  function ytDark() {
    return (
      document.documentElement.hasAttribute("dark") ||
      document.documentElement.getAttribute("dark") === "" ||
      document.querySelector("ytd-app[is-watch-page]") !== null &&
        getComputedStyle(document.body).backgroundColor === "rgb(15, 15, 15)"
    );
  }

  function paint() {
    if (!pill) return;
    var theme = ytDark() ? "dark" : "light";
    pill.className = "pill " + theme + " " + (enabled ? "on" : "off");
    pill.setAttribute("aria-pressed", enabled ? "true" : "false");
    var n = window.__cbPageBlocked ? window.__cbPageBlocked() : 0;
    pill.title = enabled
      ? "AdCuck - blocking. " + n + " blocked on this page."
      : "AdCuck - paused. Ads will play normally.";
    if (!flashTimer) label.textContent = enabled ? String(n) : "Off";
  }

  function flash(text) {
    label.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      flashTimer = null;
      paint();
    }, 900);
  }

  function build() {
    host = document.createElement("div");
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: "closed" });

    var style = document.createElement("style");
    style.textContent = CSS;

    pill = document.createElement("button");
    pill.type = "button";
    pill.setAttribute("aria-label", "Toggle AdCuck");
    pill.innerHTML = SHIELD;

    label = document.createElement("span");
    label.className = "n";
    pill.appendChild(label);

    pill.addEventListener("click", function () {
      enabled = !enabled;
      paint();
      flash(enabled ? "On" : "Off");
      if (!alive()) return;
      try {
        chrome.storage.sync.set({ enabled: enabled }, function () {
          void chrome.runtime.lastError;
        });
      } catch (e) {
        /* extension reloaded under us */
      }
    });

    shadow.appendChild(style);
    shadow.appendChild(pill);
    paint();
  }

  function mount() {
    if (document.getElementById(HOST_ID)) return true;
    var end = document.querySelector(MOUNT);
    if (!end) return false;
    if (!host) build();
    end.insertBefore(host, end.firstChild);
    paint();
    return true;
  }

  function mountFallback() {
    if (document.getElementById(HOST_ID)) return;
    if (!host) build();
    host.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:2147483000;";
    (document.body || document.documentElement).appendChild(host);
    paint();
  }

  /* YouTube is a single-page app and rebuilds the masthead on navigation, so
   * mounting once is never enough. */
  function ensure() {
    if (mount()) return;
    if (Date.now() > giveUpAt) mountFallback();
  }

  var mo = new MutationObserver(ensure);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("yt-navigate-finish", ensure);
  document.addEventListener("yt-navigate-finish", ensure);

  document.addEventListener("__cb_state", function (e) {
    enabled = !!(e && e.detail && e.detail.enabled);
    paint();
  });

  new MutationObserver(paint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dark"]
  });

  paintTimer = setInterval(function () {
    if (!alive()) {
      clearInterval(paintTimer);
      mo.disconnect();
      return;
    }
    paint();
  }, 2000);
  ensure();
})();
