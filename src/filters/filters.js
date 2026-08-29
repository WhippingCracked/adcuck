/* AdCuck - bundled filter data.
 *
 * These ship inside the package. They are kept as plain data, separate from
 * the code that consumes them, so that swapping to a remote feed later is a
 * change to one loader and nothing else.
 *
 * Isolated-world global: not visible to youtube.com's own scripts.
 */
var CB_FILTERS = {
  version: "2026.08.29",

  /* Hidden with CSS. Cheap, reversible, no layout thrash. */
  hide: [
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-banner-promo-renderer",
    "ytd-banner-promo-renderer-background",
    "ytd-statement-banner-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-sparkles-text-search-renderer",
    "ytd-promoted-video-renderer",
    "ytd-compact-promoted-video-renderer",
    "ytd-compact-promoted-item-renderer",
    "ytd-search-pyv-renderer",
    "ytd-display-ad-renderer",
    "ytd-video-masthead-ad-v3-renderer",
    "ytd-video-masthead-ad-advertiser-info-renderer",
    "ytd-primetime-promo-renderer",
    "ytd-carousel-ad-renderer",
    "ytd-action-companion-ad-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    "ytm-promoted-sparkles-web-renderer",
    "ytm-promoted-video-renderer",
    "yt-mealbar-promo-renderer",
    "#masthead-ad",
    "#player-ads",
    "#panels-full-bleed-container ytd-ad-slot-renderer",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    ".ytp-ad-image-overlay",
    ".ytp-featured-product",
    ".ytp-suggested-action",
    ".ytd-video-masthead-ad-v3-renderer",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)",
    "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
    "ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)",
    "ytd-rich-section-renderer:has(ytd-brand-video-singleton-renderer)",
    "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    "ytd-popup-container:has(ytd-enforcement-message-view-model)",
    "ytd-masthead",
    "yt-progress-bar-playhead"
  ],

  /* Physically removed from the DOM. Reserved for nodes that hold the page
   * hostage (modal dialogs, scroll-locking backdrops) or that leave an empty
   * grid cell behind when merely hidden. */
  remove: [
    "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    "ytd-enforcement-message-view-model",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)",
    "#masthead-ad"
  ],

  /* Field names inside YouTube's player response. interceptor.js carries the
   * same lists inline, because it has to run before anything async can load -
   * a test asserts the two never drift apart. These are the copies the update
   * feed ships. */
  response: {
    playerKeys: [
      "adPlacements",
      "adSlots",
      "playerAds",
      "adBreakHeartbeatParams",
      "adParams",
      "adServingDataEntry"
    ],
    adMarkers: [
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
      "menuServiceItemDownloadRenderer",
      "adImageViewModel",
      "adBadgeViewModel",
      "adDetailsLineViewModel",
      "adButtonHoverOverlayViewModel",
      "adButtonViewModel",
      "adPlacementRenderer"
    ],
    adGateReasons: [
      "Ad blockers are not allowed on YouTube",
      "Ad blockers violate YouTube's Terms of Service",
      "The use of ad blockers"
    ]
  },

  /* Sponsor segments (SponsorBlock). Only the categories that are actually
   * advertising - intros, outros and filler are the creator's own video and
   * skipping them by default would surprise people. Feed-updatable, so the
   * list can change without a store release. */
  sponsors: {
    minVotes: 0,
    /* Everything SponsorBlock can label, with what to call it and whether it
     * is on to begin with. Only actual advertising defaults to on - intros,
     * outros and tangents are the creator's own video, and skipping those
     * uninvited would surprise people.
     *
     * The highlight is last and deliberately apart: it is not something to
     * skip, it is the moment everyone scrubs forward to. */
    available: [
      { id: "sponsor", label: "Sponsors", on: true },
      { id: "selfpromo", label: "Self-promotion", on: true },
      { id: "interaction", label: "Subscribe reminders", on: true },
      { id: "intro", label: "Intros", on: false },
      { id: "outro", label: "Outros and endcards", on: false },
      { id: "filler", label: "Tangents and filler", on: false },
      { id: "music_offtopic", label: "Non-music sections", on: false },
      { id: "preview", label: "Recaps and previews", on: false }
    ]
  },

  /* Player state and controls used by the watchdog. */
  player: {
    container: "#movie_player",
    adClasses: ["ad-showing", "ad-interrupting"],
    skipButtons: [
      ".ytp-ad-skip-button",
      ".ytp-ad-skip-button-modern",
      ".ytp-skip-ad-button",
      ".ytp-ad-survey-answer-text",
      "button.ytp-ad-skip-button-modern"
    ],
    closeButtons: [
      ".ytp-ad-overlay-close-button",
      ".ytp-ad-overlay-close-container"
    ]
  },

  /* Enforcement - the "Experiencing interruptions?" toast and the hard
   * "Ad blockers are not allowed" modal.
   *
   * YouTube renames these renderers freely, so the DOM sweep matches on the
   * user-visible copy inside a short list of container types rather than on
   * element names. Add translations here as you meet them; the container list
   * is what keeps the text test cheap and safe. */
  enforcement: {
    containers: [
      "tp-yt-paper-toast",
      "tp-yt-paper-dialog",
      "yt-notification-action-renderer",
      "ytd-enforcement-message-view-model",
      "ytd-popup-container > tp-yt-paper-dialog",
      "#toast",
      "yt-playability-error-supported-renderers"
    ],
    phrases: [
      "experiencing interruptions",
      "ad blockers are not allowed",
      "ad blocker are not allowed",
      "ad blockers violate",
      "the use of ad blockers",
      "bloqueadores de anuncios",
      "werbeblocker",
      "bloqueurs de publicit"
    ],
    /* If the player is still sitting unstarted or stalled this long after
     * enforcement was detected, nudge it. */
    nudgeAfterMs: 900,
    maxNudges: 4
  },

  /* Scroll-lock artefacts left behind by the enforcement dialog. */
  unlock: {
    backdrop: "tp-yt-iron-overlay-backdrop",
    bodyAttrs: ["scroll-lock"],
    bodyStyles: ["overflow", "position"]
  }
};

if (typeof globalThis !== "undefined") {
  globalThis.CB_FILTERS = CB_FILTERS;
  globalThis.CB_FILTERS_VERSION = CB_FILTERS.version;
}
