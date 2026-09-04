/* AdCuck - bundled filter data.
 *
 * These ship inside the package. They are kept as plain data, separate from
 * the code that consumes them, so that swapping to a remote feed later is a
 * change to one loader and nothing else.
 *
 * Isolated-world global: not visible to youtube.com's own scripts.
 */
var CB_FILTERS = {
  version: "2026.09.04",

  /* When this list was last edited. A published feed built before
   * this is stale, and is ignored rather than applied. */
  editedAt: "2026-09-04T23:03:08.249Z",

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
    "ad-image-view-model",
    "ad-avatar-lockup-view-model",
    "ad-avatar-view-model",
    "ad-badge-view-model",
    "ad-details-line-view-model",
    "ad-button-view-model",
    "ytd-ads-engagement-panel-content-renderer",
    ".ad-simple-attributed-string",
    ".ytp-ad-component--clickable",
    ".ytd-player-legacy-desktop-watch-ads-renderer",
    ".ytwAdImageViewModelHostIsClickableAdComponent",
    ".ytwAdImageViewModelHostImageContainer",
    ".ytwAdAvatarLockupViewModelHostIsClickableAdComponent",
    ".ytwAdAvatarLockupViewModelHostAvatarStyleCompact",
    ".ytwAdAvatarViewModelHostIsClickableAdComponent",
    ".ytwAdAvatarLockupViewModelHostTextsStyleCompact",
    ".ytwAdAvatarLockupViewModelHostTextsStyleCompactHeadlineWidthUnlocked",
    ".ytwAdAvatarLockupViewModelHostTextsStyleCompactDescriptionWidthUnlocked",
    ".ytwAdBadgeViewModelHost",
    ".ytwAdBadgeViewModelHostStyleStandard",
    ".ytBadgeShapeAd",
    ".ytBadgeShapeAdsIncludeDot",
    ".ytwAdDetailsLineViewModelHost",
    ".ytwAdDetailsLineViewModelHostTextStyleStandard",
    ".ytwAdButtonViewModelHost",
    ".video-ads",
    ".ytp-featured-product-price-when-promotion-text-enabled",
    ".ytp-featured-product-promotion-text",
    ".ytp-featured-product-when-promotion-text-enabled",
    ".ytp-featured-product-affiliate-disclaimer-when-promotion-text-enabled",
    ".ytp-featured-product-vendor-when-promotion-text-enabled",
    ".ytp-autonav-endscreen-premium-badge",
    ".ytp-ad-progress-list",
    ".ytd-ads-engagement-panel-content-renderer",
    ".ytp-ad-player-overlay-layout",
    ".ytp-ad-player-overlay-layout__player-card-container",
    ".ytp-ad-avatar-lockup-card--inactive",
    ".ytp-ad-avatar-lockup-card",
    ".ytp-ad-avatar",
    ".ytp-ad-avatar--size-m",
    ".ytp-ad-avatar--circular",
    ".ytp-ad-avatar-lockup-card__avatar_and_text_container",
    ".ytp-ad-avatar-lockup-card__text_container",
    ".ytp-ad-avatar-lockup-card__headline",
    ".ytp-ad-avatar-lockup-card__description",
    ".ytp-ad-button-vm",
    ".ytp-ad-button-vm--style-filled-white",
    ".ytp-ad-button-vm--size-default",
    ".ytp-ad-button-vm__text",
    ".ytp-ad-player-overlay-layout__ad-info-container",
    ".ytp-ad-badge--clean-player",
    ".ytp-ad-badge--stark-clean-player",
    ".ytp-ad-badge__text--clean-player",
    ".ytp-ad-hover-text-button",
    ".ytp-ad-info-hover-text-button",
    ".ytp-ad-button",
    ".ytp-ad-button-link",
    ".ytp-ad-clickable",
    ".ytp-ad-hover-text-button--clean-player",
    ".ytp-ad-button-icon",
    ".ytp-ad-hover-text-container",
    ".ytp-ad-info-hover-text-short",
    ".ytp-ad-hover-text-callout",
    ".ytp-ad-pod-index",
    ".ytp-ad-pod-index--stark",
    ".ytp-visit-advertiser-link",
    ".ytp-visit-advertiser-link__text",
    ".ytp-ad-player-overlay-layout__skip-or-preview-container",
    ".ytp-ad-player-overlay-layout__ad-disclosure-banner-container",
    ".ytp-ad-persistent-progress-bar-container",
    ".ytp-ad-persistent-progress-bar-container--clean-player",
    ".ytp-ad-persistent-progress-bar",
    ".yt-mealbar-promo-renderer-content",
    ".yt-mealbar-promo-renderer-message-title",
    ".yt-mealbar-promo-renderer-message-text",
    ".yt-mealbar-promo-renderer-supplemental-text",
    ".yt-mealbar-promo-renderer-modern-icon",
    ".yt-mealbar-promo-renderer",
    ".ytp-ad-skip-button",
    ".ytp-ad-avatar-lockup-card__description--hidden--in--small--player",
    ".ytp-ad-pod-index--autohide"
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
    "adPlacementRenderer",
    "adBreakServiceRenderer",
    "adAvatarViewModel",
    "adBadgeViewModel",
    "adButtonViewModel",
    "aboutThisAdRenderer",
    "playerBytesAdLayoutRenderer",
    "aboveFeedAdLayoutRenderer",
    "adImageViewModel",
    "adAvatarLockupViewModel",
    "adDetailsLineViewModel",
    "inPlayerAdLayoutRenderer",
    "adPreviewViewModel",
    "playerAdAvatarLockupCardButtonedViewModel",
    "visitAdvertiserLinkViewModel",
    "adBadgeRenderer",
    "adDurationRemainingRenderer",
    "adInfoRenderer",
    "adHoverTextButtonRenderer",
    "adPodIndexViewModel",
    "playerLegacyDesktopWatchAdsRenderer",
    "playerAdParams",
    "adsEngagementPanelContentRenderer",
    "clientForecastingAdRenderer",
    "skipAdViewModel",
    "skipAdButtonViewModel"
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
