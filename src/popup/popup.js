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
    tglSponsor: $("tglSponsor"),
    sponsorCredit: $("sponsorCredit"),
    reloadNote: $("reloadNote"),
    reloadMeta: $("reloadMeta"),
    sponsorOpts: $("sponsorOpts"),
    sponsorView: $("sponsorView"),
    sponsorList: $("sponsorList"),
    sponsorBack: $("sponsorBack"),
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
    adFree: true,
    sponsorBlock: false,
    sponsorCategories: null,
    sponsorHighlight: false
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
    if (e.key !== "Escape") return;
    if (!els.log.hidden) closeLog();
    else if (!els.sponsorView.hidden) closeSponsorView();
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

  /* ---------- sponsor segments ---------- */
  function renderSponsor() {
    els.tglSponsor.setAttribute("aria-checked", state.sponsorBlock ? "true" : "false");
    /* The licence requires the credit while the data is in use. */
    els.sponsorCredit.hidden = !state.sponsorBlock;
    /* Settings for something switched off would be a control that does
     * nothing, so it only appears once there is something to configure. */
    els.sponsorOpts.hidden = !state.sponsorBlock;
  }

  /* ---------- what to skip ---------- */
  function categoryList() {
    var f = globalThis.CB_FILTERS;
    return (f && f.sponsors && f.sponsors.available) || [];
  }

  function categories() {
    if (state.sponsorCategories) return state.sponsorCategories;
    var out = {};
    categoryList().forEach(function (c) { out[c.id] = c.on; });
    return out;
  }

  function categoryRow(id, labelText, checked, onFlip) {
    var row = document.createElement("div");
    row.className = "row";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sw sw--mini";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", checked ? "true" : "false");
    btn.setAttribute("aria-label", labelText);
    btn.dataset.cat = id;
    var knob = document.createElement("span");
    knob.className = "knob";
    btn.appendChild(knob);

    var label = document.createElement("em");
    label.textContent = labelText;

    btn.addEventListener("click", function () {
      var now = btn.getAttribute("aria-checked") !== "true";
      btn.setAttribute("aria-checked", now ? "true" : "false");
      onFlip(now);
    });

    row.appendChild(btn);
    row.appendChild(label);
    return row;
  }

  function renderSponsorList() {
    var cats = categories();
    els.sponsorList.textContent = "";

    categoryList().forEach(function (c) {
      els.sponsorList.appendChild(
        categoryRow(c.id, c.label, cats[c.id] === true, function (on) {
          var next = {};
          Object.keys(cats).forEach(function (k) { next[k] = cats[k]; });
          next[c.id] = on;
          state.sponsorCategories = next;
          chrome.storage.sync.set({ sponsorCategories: next });
          els.live.textContent = on ? c.label + " will be skipped" : c.label + " will play";
        })
      );
    });

    /* The highlight is not something to skip - it is the moment people scrub
     * forward to - so it sits apart, and it only ever offers a button. */
    var hr = categoryRow(
      "highlight",
      "Offer to jump to the best bit",
      state.sponsorHighlight === true,
      function (on) {
        state.sponsorHighlight = on;
        chrome.storage.sync.set({ sponsorHighlight: on });
        els.live.textContent = on
          ? "A jump button will appear on videos that have a highlight"
          : "The jump button is off";
      }
    );
    hr.style.borderTop = "1px solid var(--line)";
    els.sponsorList.appendChild(hr);
  }

  function openSponsorView() {
    renderSponsorList();
    els.main.hidden = true;
    els.sponsorView.hidden = false;
    els.sponsorBack.focus();
  }

  function closeSponsorView() {
    els.sponsorView.hidden = true;
    els.main.hidden = false;
    els.sponsorOpts.focus();
  }

  els.sponsorOpts.addEventListener("click", openSponsorView);
  els.sponsorBack.addEventListener("click", closeSponsorView);

  /* Switching this changes what the content scripts do at page load, so the
   * open tab has to start again. Counting down out loud beats a page
   * reloading under someone with no warning. */
  function countdownReload() {
    var left = 3;
    els.reloadNote.hidden = false;
    els.reloadMeta.textContent = "refreshing YouTube in " + left + "\u2026";
    els.live.textContent = "YouTube will refresh in 3 seconds.";

    var tick = setInterval(function () {
      left--;
      if (left > 0) {
        els.reloadMeta.textContent = "refreshing YouTube in " + left + "\u2026";
      } else {
        clearInterval(tick);
        els.reloadMeta.textContent = "refreshing\u2026";
      }
    }, 1000);

    /* The service worker does the actual reload, so it still happens if the
     * popup is closed before the count reaches zero. */
    chrome.runtime.sendMessage({ type: "cb:reloadYouTube" }, function () {
      void chrome.runtime.lastError;
    });
  }

  els.tglSponsor.addEventListener("click", function () {
    state.sponsorBlock = !state.sponsorBlock;
    renderSponsor();
    chrome.storage.sync.set({ sponsorBlock: state.sponsorBlock });
    countdownReload();
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
    renderSponsor();
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
