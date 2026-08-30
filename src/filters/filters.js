/* AdCuck - bundled filter data.
 *
 * These ship inside the package. They are kept as plain data, separate from
 * the code that consumes them, so that swapping to a remote feed later is a
 * change to one loader and nothing else.
 *
 * Isolated-world global: not visible to youtube.com's own scripts.
 */
var CB_FILTERS = {
  version: "2026.08.30",

  /* When this list was last edited. A published feed built before
   * this is stale, and is ignored rather than applied. */
  editedAt: "2026-08-30T14:44:47.737Z",

  /* Hidden with CSS. Cheap, reversible, no layout thrash. */
  hide: [
    "ytd-ads-engagement-panel-content-renderer",
    ".ad-created",
    ".video-ads",
    ".ytp-ad-module",
    ".ytp-featured-product-price-when-promotion-text-enabled",
    ".ytp-featured-product-promotion-text",
    ".ytp-featured-product-when-promotion-text-enabled",
    ".ytp-featured-product-affiliate-disclaimer-when-promotion-text-enabled",
    ".ytp-featured-product-vendor-when-promotion-text-enabled",
    ".ytp-ad-progress-list",
    ".ytd-ads-engagement-panel-content-renderer"
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
    "adPlacementRenderer",
    "clientForecastingAdRenderer",
    "adsEngagementPanelContentRenderer"
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
  /* SponsorBlock's categories and defaults are NOT here. They live in
   * src/filters/sponsors.js, which the feed builder does not read and the
   * update client cannot write, so pushing a new filter list can never change
   * what somebody's player skips. test/sponsors.mjs enforces that. */


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
