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
  var dropped = [];
  var applied = 0;

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

  /* The enforcement dialog locks scrolling on <html>/<body>. */
  var UNLOCK_RULE = "html[cb-unlocked], body[cb-unlocked] { overflow: auto !important; }";

  /* One rule per selector, not one rule for all of them.
   *
   * The old version joined every selector with commas into a single rule. In
   * CSS a selector list is all-or-nothing: one selector the browser will not
   * parse throws away the entire rule, and every ad in the list stops being
   * hidden. Nothing reports it - the <style> element is still sitting there,
   * looking fine - so the first sign is ads coming back.
   *
   * Filtering with querySelector first was meant to prevent that, but the two
   * are not the same test: a selector querySelector accepts can still be
   * dropped by the stylesheet parser, and browsers keep changing which. Since
   * the whole point of the list is that it grows with whatever YouTube ships
   * next, it must not be possible for one entry to silence the rest.
   *
   * insertRule throws per rule instead, so a bad selector loses only itself,
   * and we keep the names to say which. */
  function buildStyle() {
    dropped = [];
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(styleEl);

    var sheet = styleEl.sheet;
    if (!sheet) {
      /* No CSSOM yet - fall back to the old single-rule form rather than no
       * blocking at all, and say so in the readout. */
      styleEl.textContent =
        F.hide.filter(usable).join(",\n") + " { display: none !important; }\n" + UNLOCK_RULE;
      applied = -1;
      report();
      return;
    }

    applied = 0;
    for (var i = 0; i < F.hide.length; i++) {
      try {
        sheet.insertRule(F.hide[i] + " { display: none !important; }", sheet.cssRules.length);
        applied++;
      } catch (e) {
        dropped.push(F.hide[i]);
      }
    }
    try {
      sheet.insertRule(UNLOCK_RULE, sheet.cssRules.length);
    } catch (e) {
      /* nothing to unlock is survivable; hiding is not */
    }
    report();
  }

  /* Leave the count where anything can read it - the test suite turns a bare
   * "it did not get hidden" into "3 of 118 selectors applied", and you can
   * check it yourself from the console on a real page. */
  function report() {
    try {
      document.documentElement.dataset.cbCss = applied + "/" + F.hide.length;
      if (dropped.length) {
        console.warn(
          "AdCuck: " + dropped.length + " filter(s) this browser will not accept:",
          dropped.slice(0, 20).join(", ")
        );
      }
    } catch (e) {
      /* documentElement not ready; the counts are a convenience, not a job */
    }
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

  /* ------------------------------------------------------------------ *
   * Never hide the thing people came here to watch
   *
   * A filter list is a list of guesses, and one of them will eventually match
   * the player. It already has: "ad-created" is not an ad element, it is a
   * state class YouTube puts ON the player once its ad module exists - so
   * hiding it hid the whole player. The video kept decoding, so the sound
   * carried on and the ambient glow (which is drawn outside the player) kept
   * moving. Everything looked alive except the picture.
   *
   * Nothing catches that: the player reports no error, so the ad-free
   * fallback never fires, and the extension has no idea anything is wrong.
   *
   * So rather than try to guess every such class in advance - the last three
   * were all things nobody thought of - check the outcome. If the player is
   * not visible and one of OUR rules is why, drop that rule and say which.
   * That holds for filters from the feed as well as ones added locally.
   * ------------------------------------------------------------------ */
  function guardPlayer() {
    if (!styleEl || !styleEl.sheet || styleEl.disabled) return;

    var video = document.querySelector("video");
    if (!video || !video.duration) return; // nothing playing yet

    /* Walk up from the video. Anything between it and the document that our
     * stylesheet hides is a mistake, whatever its name looked like. */
    var culprits = [];
    for (var el = video; el && el.nodeType === 1; el = el.parentElement) {
      if (getComputedStyle(el).display !== "none") continue;
      var rules = styleEl.sheet.cssRules;
      for (var i = rules.length - 1; i >= 0; i--) {
        var sel = rules[i].selectorText;
        if (!sel) continue;
        try {
          if (!el.matches(sel)) continue;
        } catch (e) {
          continue;
        }
        culprits.push(sel);
        styleEl.sheet.deleteRule(i);
      }
    }
    if (!culprits.length) return;

    /* Keep it out of the list for the rest of the page, so a rebuild from the
     * feed does not put it straight back. */
    F.hide = F.hide.filter(function (s) { return culprits.indexOf(s) === -1; });
    dropped = dropped.concat(culprits);
    applied = Math.max(0, applied - culprits.length);
    console.warn(
      "AdCuck: dropped " + culprits.length + " filter(s) that were hiding the " +
        "video player, not an advert:", culprits.join(", ")
    );
    try {
      document.documentElement.dataset.cbUnhid = culprits.join(",");
    } catch (e) {
      /* the readout is a convenience, not a job */
    }
  }

  function sweep() {
    scheduled = false;
    guardPlayer();
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

    /* Check the moment playback starts, not just when the page happens to
     * mutate. A hidden player is exactly the case where YouTube may stop
     * updating the DOM, so waiting for a mutation to notice a hidden player
     * is waiting for the thing that will not come. Media events do not
     * bubble, hence the capture phase. */
    ["loadeddata", "playing", "timeupdate"].forEach(function (e) {
      document.addEventListener(e, schedule, true);
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
