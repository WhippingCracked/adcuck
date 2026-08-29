/* AdCuck - L3: cosmetic layer.
 *
 * Hides banner, in-feed and overlay ad units with a single stylesheet, and
 * physically removes the handful of nodes that hold the page hostage (the
 * anti-adblock dialog and its scroll-locking backdrop).
 *
 * Toggling sets styleEl.disabled, which is instant and fully reversible - no
 * reload, no re-injection, no leftover inline styles on YouTube's nodes.
 */
(function () {
  "use strict";

  var F = globalThis.CB_FILTERS;
  if (!F) return;

  var STYLE_ID = "cb-cosmetic";
  var styleEl = null;
  var observer = null;
  var scheduled = false;
  var removeSelectors = [];

  /* Drop any selector this Chrome build can't parse, individually, so one bad
   * selector never takes the whole stylesheet down with it. */
  function usable(sel) {
    try {
      document.querySelector(sel);
      return true;
    } catch (e) {
      return false;
    }
  }

  function buildStyle() {
    var valid = F.hide.filter(usable);
    if (!valid.length) return;

    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent =
      valid.join(",\n") +
      " { display: none !important; }\n" +
      /* The enforcement dialog locks scrolling on <html>/<body>. */
      "html[cb-unlocked], body[cb-unlocked] { overflow: auto !important; }\n";
    (document.head || document.documentElement).appendChild(styleEl);
  }

  /* Enforcement sweep. Matches on the visible copy inside a short list of
   * container types, not on element names, because YouTube renames the
   * renderer far more often than it rewrites the sentence. The container
   * list is what keeps this cheap and stops it touching real content. */
  var enforceRe = new RegExp(F.enforcement.phrases.join("|"), "i");

  function rebuild() {
    enforceRe = new RegExp(F.enforcement.phrases.join("|"), "i");
    removeSelectors = F.remove.filter(usable);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
    buildStyle();
    setEnabled(document.documentElement.dataset.cbState !== "off");
    schedule();
  }

  document.addEventListener("__cb_filters", function () {
    try {
      rebuild();
    } catch (e) {
      /* keep the bundled list rather than ending up with none */
    }
  });

  function sweepEnforcement() {
    var hit = 0;
    for (var i = 0; i < F.enforcement.containers.length; i++) {
      var nodes;
      try {
        nodes = document.querySelectorAll(F.enforcement.containers[i]);
      } catch (e) {
        continue;
      }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        var text = (el.textContent || "").slice(0, 400);
        if (!text || !enforceRe.test(text)) continue;
        try {
          el.remove();
          hit++;
        } catch (e) {
          /* detached already */
        }
      }
    }
    return hit;
  }

  function sweep() {
    scheduled = false;
    var removedAny = sweepEnforcement();

    for (var i = 0; i < removeSelectors.length; i++) {
      var nodes;
      try {
        nodes = document.querySelectorAll(removeSelectors[i]);
      } catch (e) {
        continue;
      }
      for (var j = 0; j < nodes.length; j++) {
        try {
          nodes[j].remove();
          removedAny++;
        } catch (e) {
          /* detached already */
        }
      }
    }

    /* If we just removed the enforcement dialog, undo its scroll lock. */
    if (removedAny) {
      try {
        var backdrop = document.querySelector(F.unlock.backdrop);
        if (backdrop) backdrop.remove();
        var b = document.body;
        if (b) {
          F.unlock.bodyAttrs.forEach(function (a) {
            b.removeAttribute(a);
          });
          F.unlock.bodyStyles.forEach(function (p) {
            b.style.removeProperty(p);
          });
          b.setAttribute("cb-unlocked", "");
        }
        var h = document.documentElement;
        F.unlock.bodyAttrs.forEach(function (a) {
          h.removeAttribute(a);
        });
        h.setAttribute("cb-unlocked", "");
      } catch (e) {
        /* no-op */
      }
      if (window.__cbCount) window.__cbCount(removedAny);
    }
  }

  /* The remove-list uses :has() selectors, which are expensive across a large
   * feed. YouTube mutates the DOM constantly while a page loads, so an
   * unthrottled observer would re-run them dozens of times a second. Hiding
   * is already handled by the stylesheet, which costs nothing; this sweep only
   * needs to catch up, not keep up. */
  var MIN_GAP = 400;
  var lastSweep = 0;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var wait = Math.max(0, MIN_GAP - (Date.now() - lastSweep));
    setTimeout(function () {
      lastSweep = Date.now();
      if (window.requestIdleCallback) requestIdleCallback(sweep, { timeout: 300 });
      else sweep();
    }, wait);
  }

  function start() {
    if (observer) return;
    removeSelectors = F.remove.filter(usable);
    observer = new MutationObserver(function (records) {
      /* Only nodes being added can introduce an ad. Attribute and text
       * changes - which is most of what YouTube does - are ignored. */
      for (var i = 0; i < records.length; i++) {
        if (records[i].addedNodes && records[i].addedNodes.length) {
          schedule();
          return;
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    schedule();
  }

  function stop() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function setEnabled(on) {
    if (styleEl) styleEl.disabled = !on;
    if (on) start();
    else stop();
  }

  buildStyle();
  setEnabled(document.documentElement.dataset.cbState !== "off");

  document.addEventListener("__cb_state", function (e) {
    setEnabled(!!(e && e.detail && e.detail.enabled));
  });
})();
