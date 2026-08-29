/* AdCuck popup. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var THEMES = ["auto", "light", "dark"];

  var els = {
    status: $("status"),
    statusSub: $("statusSub"),
    master: $("master"),
    session: $("sessionCount"),
    total: $("totalCount"),
    theme: $("theme"),
    channelRow: $("channelRow"),
    allowChannel: $("allowChannel"),
    channelLabel: $("channelLabel"),
    whatsNew: $("whatsNew"),
    verText: $("verText"),
    footer: document.querySelector(".pf"),
    newDot: $("newDot"),
    main: $("main"),
    log: $("log"),
    logBody: $("logBody"),
    logBack: $("logBack"),
    startRow: $("startRow"),
    startDot: $("startDot"),
    startMeta: $("startMeta"),
    diagRow: $("diagRow"),
    tglNet: $("tglNet"),
    tglVideo: $("tglVideo"),
    tglClamp: $("tglClamp"),
    tglAdFree: $("tglAdFree"),
    traceRow: $("traceRow"),
    traceMeta: $("traceMeta"),
    dot: $("dot"),
    filterMeta: $("filterMeta"),
    checkNow: $("checkNow"),
    live: $("live")
  };

  var VERSION = chrome.runtime.getManifest().version;

  var DEFAULTS = {
    enabled: true,
    allowlist: [],
    theme: "auto",
    diagnostics: false,
    netRules: true,
    videoAds: true,
    clamp: true,
    adFree: true
  };
  var state = {
    enabled: true,
    allowlist: [],
    theme: "auto",
    diagnostics: false,
    netRules: true,
    videoAds: true
  };
  var tab = null;

  /* Diagnostics is a maintainer's tool, not a feature - Alt+click the version
   * to turn it on. It makes the interceptor log which enforcement carriers
   * actually appeared, which is how you fix the real key name instead of
   * guessing at it. */
  /* Two switches for bisecting a slow start: turn one layer off, reload, and
   * see whether the "video started in" reading changes. They only appear with
   * diagnostics on, so the normal popup stays a status light and a switch. */
  function renderLayers() {
    els.diagRow.hidden = !state.diagnostics;
    els.tglNet.setAttribute("aria-checked", state.netRules ? "true" : "false");
    els.tglVideo.setAttribute("aria-checked", state.videoAds ? "true" : "false");
    els.tglClamp.setAttribute("aria-checked", state.clamp ? "true" : "false");
    els.tglAdFree.setAttribute("aria-checked", state.adFree ? "true" : "false");
  }

  function layerToggle(el, key) {
    el.addEventListener("click", function () {
      state[key] = !state[key];
      renderLayers();
      chrome.storage.sync.set(pick(key));
      els.live.textContent = "Reload YouTube to apply.";
    });
  }

  function pick(key) {
    var o = {};
    o[key] = state[key];
    return o;
  }

  layerToggle(els.tglNet, "netRules");
  layerToggle(els.tglVideo, "videoAds");
  layerToggle(els.tglClamp, "clamp");
  layerToggle(els.tglAdFree, "adFree");

  function renderDiag() {
    els.verText.textContent = state.diagnostics ? "DIAG ON" : "v" + VERSION;
    els.footer.title = state.diagnostics
      ? "Diagnostics on - open the console on youtube.com. Alt+click to turn off."
      : "";
  }

  /* ---------- changelog ---------- */
  function renderLog() {
    var list = (globalThis.CHANGELOG || []).slice(0, 5);
    els.logBody.textContent = "";

    list.forEach(function (rel) {
      var entry = document.createElement("div");
      entry.className = "entry";

      var head = document.createElement("div");
      head.className = "v";
      var v = document.createElement("b");
      v.textContent = rel.version;
      head.appendChild(v);
      if (rel.date) {
        var d = document.createElement("span");
        d.textContent = rel.date;
        head.appendChild(d);
      }
      entry.appendChild(head);

      var ul = document.createElement("ul");
      rel.changes.forEach(function (line) {
        var li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      });
      entry.appendChild(ul);
      els.logBody.appendChild(entry);
    });
  }

  function openLog() {
    renderLog();
    els.main.hidden = true;
    els.log.hidden = false;
    els.logBack.focus();
    /* Seeing it is what clears the dot. */
    els.newDot.hidden = true;
    chrome.storage.local.set({ lastSeenVersion: VERSION });
  }

  function closeLog() {
    els.log.hidden = true;
    els.main.hidden = false;
    els.whatsNew.focus();
  }

  els.logBack.addEventListener("click", closeLog);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !els.log.hidden) closeLog();
  });

  els.whatsNew.addEventListener("click", function (e) {
    if (e.altKey) return; // let the footer handle it
    openLog();
  });

  /* Diagnostics has no control of its own on purpose - it is a maintainer's
   * tool, not a feature. Alt+click anywhere in the footer. */
  els.footer.addEventListener("click", function (e) {
    if (!e.altKey) return;
    state.diagnostics = !state.diagnostics;
    renderDiag();
    chrome.storage.sync.set({ diagnostics: state.diagnostics });
    renderLayers();
    els.live.textContent = state.diagnostics
      ? "Diagnostics on. Reload YouTube and open the console."
      : "Diagnostics off.";
  });

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    els.theme.textContent = theme.toUpperCase();
    try { localStorage.setItem("cb_theme", theme); } catch (e) { /* no-op */ }
  }

  els.theme.addEventListener("click", function () {
    var next = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    state.theme = next;
    applyTheme(next);
    chrome.storage.sync.set({ theme: next });
  });

  /* ---------- master toggle ---------- */
  function renderMaster() {
    var on = state.enabled;
    document.body.classList.toggle("paused", !on);
    els.master.setAttribute("aria-checked", on ? "true" : "false");

    if (!tab || !tab.onYouTube) {
      els.status.textContent = "Not on YouTube";
      els.statusSub.textContent = on
        ? "Open youtube.com to see activity"
        : "Blocking is paused";
      return;
    }
    els.status.textContent = on ? "Blocking" : "Paused";
    els.statusSub.textContent = on
      ? "Active on " + tab.host
      : "Ads will play normally";
  }

  els.master.addEventListener("click", function () {
    state.enabled = !state.enabled;
    renderMaster();
    els.live.textContent = state.enabled
      ? "Ad blocking on"
      : "Ad blocking paused";
    chrome.storage.sync.set({ enabled: state.enabled });
  });

  /* ---------- channel allowlist ---------- */
  function renderChannel() {
    if (!tab || !tab.channelId) {
      els.channelRow.hidden = true; // hide, never disable - an inert control is noise
      return;
    }
    els.channelRow.hidden = false;
    var allowed = state.allowlist.indexOf(tab.channelId) !== -1;
    els.allowChannel.setAttribute("aria-checked", allowed ? "true" : "false");
    els.channelLabel.textContent = tab.channelName
      ? "Allow ads on " + tab.channelName
      : "Allow ads on this channel";
  }

  els.allowChannel.addEventListener("click", function () {
    if (!tab || !tab.channelId) return;
    var allowed = els.allowChannel.getAttribute("aria-checked") === "true";
    var next = !allowed;
    els.allowChannel.setAttribute("aria-checked", next ? "true" : "false");
    chrome.runtime.sendMessage(
      { type: "cb:allowChannel", channelId: tab.channelId, allow: next },
      function (res) {
        if (chrome.runtime.lastError || !res) return;
        state.allowlist = res.allowlist;
        els.live.textContent = next
          ? "Ads allowed on this channel. Reload to apply."
          : "Ads blocked on this channel again.";
      }
    );
  });

  /* ---------- filter list ---------- */
  function ago(ms) {
    if (!ms) return "never checked";
    var mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 48) return hrs + "h ago";
    return Math.round(hrs / 24) + "d ago";
  }

  function renderFilters(f) {
    var version = f.filtersVersion || (globalThis.CB_FILTERS_VERSION || "bundled");
    els.filterMeta.textContent = "filters " + version + " \u00b7 " + ago(f.filtersCheckedAt);

    /* Green: fresh. Muted: stale. Amber: the last check failed - which is not
     * an outage, the last good list is still blocking. */
    var stale = !f.filtersCheckedAt || Date.now() - f.filtersCheckedAt > 48 * 3600e3;
    els.dot.style.background = f.filtersError
      ? "var(--warn)"
      : stale
      ? "var(--muted-state)"
      : "var(--accent)";
    els.filterMeta.title = f.filtersError
      ? "Last check failed: " + f.filtersError + ". Still blocking with the list from before."
      : "";
  }

  function loadFilters() {
    chrome.storage.local.get(
      { filtersVersion: "", filtersCheckedAt: 0, filtersError: "" },
      function (f) {
        if (chrome.runtime.lastError) return;
        renderFilters(f);
      }
    );
  }

  /* What "Check now" says afterwards. Kept as a plain function of the
   * result so the wording is testable and lives in one place. */
  function checkMessage(res) {
    if (!res) return { text: "couldn't reach the filter list", kind: "warn" };
    if (res.updated) return { text: "you just got new filters", kind: "ok" };
    if (res.upToDate) return { text: "you have the latest filters", kind: "ok" };
    if (res.needsExtensionUpdate) {
      return { text: "update AdCuck to get newer filters", kind: "warn" };
    }
    if (res.error) return { text: "couldn't check \u2014 using the last list", kind: "warn" };
    return { text: "you have the latest filters", kind: "ok" };
  }
  globalThis.__cbCheckMessage = checkMessage; // used by the tests

  /* Show the answer where the version normally sits, then put the version
   * back. The row is the natural place for it - no new UI, and the thing it
   * is telling you about is right there. */
  var metaTimer = null;
  function flashMeta(msg) {
    clearTimeout(metaTimer);
    els.filterMeta.textContent = msg.text;
    els.dot.style.background =
      msg.kind === "warn" ? "var(--warn)" : "var(--accent)";
    els.live.textContent = msg.text; // and say it out loud for screen readers
    metaTimer = setTimeout(loadFilters, 5000);
  }

  els.checkNow.addEventListener("click", function () {
    clearTimeout(metaTimer);
    els.checkNow.disabled = true;
    els.checkNow.textContent = "Checking\u2026";
    els.filterMeta.textContent = "checking for new filters\u2026";

    chrome.runtime.sendMessage({ type: "cb:checkFilters" }, function (res) {
      els.checkNow.disabled = false;
      els.checkNow.textContent = "Check now";
      flashMeta(checkMessage(chrome.runtime.lastError ? null : res));
    });
  });

  loadFilters();

  /* ---------- counters ---------- */
  function renderCounts(session, total) {
    els.session.textContent = session.toLocaleString();
    els.total.textContent = total.toLocaleString();
  }

  /* ---------- boot ---------- */
  renderDiag();

  chrome.storage.sync.get(DEFAULTS, function (s) {
    state = s;
    applyTheme(s.theme);
    renderDiag();
    renderLayers();
    renderMaster();
    renderChannel();
  });

  chrome.storage.local.get({ lastSeenVersion: null }, function (l) {
    els.newDot.hidden = l.lastSeenVersion === VERSION;
  });

  /* How long the last video took to start, and how much of that was us.
   * This is here so "is the extension making YouTube slow?" can be answered
   * by looking at the popup instead of opening a console. */
  chrome.storage.session.get(
    { lastStartMs: 0, lastStartNudges: 0, lastCostMs: 0, lastTrace: "" },
    function (t) {
      if (!t.lastStartMs) return;
      els.startRow.hidden = false;
      var secs = (t.lastStartMs / 1000).toFixed(1);
      var cost = Math.round(t.lastCostMs);
      els.startMeta.textContent =
        "video started in " + secs + "s \u00b7 extension " + cost + "ms";
      /* Green when we are clearly not the bottleneck. */
      var ours = t.lastCostMs / t.lastStartMs;
      els.startDot.style.background =
        ours > 0.25 ? "var(--warn)" : "var(--accent)";
      var bits = [];
      if (t.lastStartNudges) {
        bits.push("Nudged the player " + t.lastStartNudges + " time(s)");
      }
      /* readyState 0 for the whole wait means YouTube sent no video data -
       * nothing in the browser can shorten that. Anything else means the
       * player had data and chose to wait. */
      if (t.lastTrace) bits.push(t.lastTrace);
      els.startRow.title = bits.join("  |  ");

      /* With diagnostics on the trace is shown outright rather than hidden in
       * a tooltip - it is the one reading that says whether the player was
       * waiting on YouTube or waiting on nothing at all. */
      if (t.lastTrace && state.diagnostics) {
        els.traceRow.hidden = false;
        els.traceMeta.textContent = t.lastTrace;
      }
    }
  );

  chrome.storage.local.get({ totalBlocked: 0 }, function (l) {
    chrome.storage.session.get({ sessionBlocked: 0 }, function (ss) {
      renderCounts(ss.sessionBlocked, l.totalBlocked);
    });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var t = tabs && tabs[0];
    tab = { onYouTube: false, host: "", channelId: "", channelName: "" };

    if (t && t.url) {
      try {
        var u = new URL(t.url);
        tab.host = u.hostname.replace(/^www\./, "");
        tab.onYouTube = /(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname);
      } catch (e) { /* about:blank and friends */ }
    }

    if (!tab.onYouTube || !t) {
      renderMaster();
      renderChannel();
      return;
    }

    chrome.tabs.sendMessage(t.id, { type: "cb:tabState" }, function (res) {
      if (chrome.runtime.lastError || !res) {
        renderMaster();
        renderChannel();
        return; // content script not injected yet (tab predates install)
      }
      tab.channelId = res.channelId || "";
      tab.channelName = res.channelName || "";
      renderMaster();
      renderChannel();
    });
  });
})();
