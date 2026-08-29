/* AdCuck - changelog.
 *
 * SINGLE SOURCE OF TRUTH for the version number. The top entry's version must
 * match manifest.json; test/e2e.mjs fails the build if it doesn't, so bumping
 * is not something that can be forgotten.
 *
 * Writing entries - keep to these three rules, they are why it stays readable:
 *   1. One short line per change. Three lines per version at most.
 *   2. Say what you would notice, not what the code does.
 *      "Fixed YouTube loading slowly", never "replaced the quadratic scan".
 *   3. No file names, no technical terms, no other products' version numbers.
 *
 * Newest first. Third digit for a fix, second for anything new or changed.
 */
var CHANGELOG = [
  {
    version: "1.9.1",
    date: "29 Aug 2026",
    changes: [
      "Skip settings are never changed by filter updates."
    ]
  },
  {
    version: "1.9.0",
    date: "29 Aug 2026",
    changes: [
      "Choose which kinds of sponsor bits get skipped.",
      "Can jump straight to the best bit of a video."
    ]
  },
  {
    version: "1.8.0",
    date: "29 Aug 2026",
    changes: [
      "Can now skip sponsor bits inside videos.",
      "Off until you switch it on in the popup."
    ]
  },
  {
    version: "1.7.3",
    date: "29 Aug 2026",
    changes: ["Check now tells you whether the filters changed."]
  },
  {
    version: "1.7.2",
    date: "29 Aug 2026",
    changes: ["Filters now check for updates every hour."]
  },
  {
    version: "1.7.1",
    date: "29 Aug 2026",
    changes: ["Filters now come from the right place."]
  },
  {
    version: "1.7.0",
    date: "29 Aug 2026",
    changes: [
      "Filters now update themselves in the background.",
      "Added a Check now button next to the filter version."
    ]
  },
  {
    version: "1.6.0",
    date: "29 Aug 2026",
    changes: [
      "Asks YouTube for a copy of the video with no ads.",
      "Videos that used to wait now start straight away."
    ]
  },
  {
    version: "1.5.0",
    date: "29 Aug 2026",
    changes: [
      "Starts stalled videos sooner.",
      "Skips the wait when YouTube holds a video back."
    ]
  },
  {
    version: "1.4.0",
    date: "29 Aug 2026",
    changes: [
      "Fixed the wrong start time shown after changing video.",
      "Stopped an error appearing when the add-on reloads.",
      "Added tools for tracking down a slow start."
    ]
  },
  {
    version: "1.3.0",
    date: "29 Aug 2026",
    changes: [
      "Nudges the video to start when YouTube stalls it.",
      "Shows how long the last video took to start."
    ]
  },
  {
    version: "1.2.0",
    date: "29 Aug 2026",
    changes: [
      "Videos start faster.",
      "Turned off a change that could make videos hang."
    ]
  },
  {
    version: "1.1.2",
    date: "29 Aug 2026",
    changes: ["Moved \u201cWhat's new\u201d to its own button."]
  },
  {
    version: "1.1.1",
    date: "29 Aug 2026",
    changes: ["Fixed YouTube loading slowly."]
  },
  {
    version: "1.1.0",
    date: "29 Aug 2026",
    changes: [
      "Skips the “Experiencing interruptions?” delay.",
      "Removes YouTube's anti-adblock popup."
    ]
  },
  {
    version: "1.0.0",
    date: "29 Aug 2026",
    changes: ["First release."]
  }
];

if (typeof globalThis !== "undefined") globalThis.CHANGELOG = CHANGELOG;
