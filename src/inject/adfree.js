/* AdCuck - ad-free source request.
 *
 * WHY THIS EXISTS
 *
 * Deleting ads from the player response turned out to be the cause of the
 * slow start, not the cure. Videos *with* ads took ~12s; videos with no ads
 * started instantly. The player arms its ad module from the response, and if
 * the ad it was promised then vanishes, it sits waiting for something that
 * will never arrive. The 12 seconds was a timeout.
 *
 * So instead of removing the ad after the fact, ask YouTube for a copy of the
 * video that never had one. The embedded-player client returns a response
 * with no ad placements, so the ad module never arms and there is nothing to
 * wait for.
 *
 * WHY THE EMBEDDED CLIENT SPECIFICALLY
 *
 * The Android and iOS clients also come back ad-free, but their playback URLs
 * require a PO Token, and tokens cannot be reused across platforms - the page
 * cannot mint one, so those URLs would simply 403 and the video would not
 * play at all. Web Embedded needs no token for the player request and stays
 * inside the web family, so the URLs remain playable by the player already on
 * the page.
 *
 * HOW IT FAILS
 *
 * Every unhappy path falls back to YouTube's original request: an unreadable
 * body, a context we do not recognise, a substitute that is not playable
 * (age-restricted and members-only videos are the expected cases). If
 * playback errors anyway, it switches itself off for the tab and reloads once
 * so the viewer gets a working video rather than a dead player.
 */
(function () {
  "use strict";

  var ATTR = "cbAdFree";
  var STATE_ATTR = "cbState";
  var DIAG_ATTR = "cbDiag";
  var CLIENT = "WEB_EMBEDDED_PLAYER";
  var EVT_FAIL = "__cb_adfree_fail";
  var RETRY_KEY = "__cb_adfree_retry";

  var nativeFetch = window.fetch;
  if (typeof nativeFetch !== "function") return;

  var nativeParse = JSON.parse; // captured before interceptor.js patches it
  var disabled = false;

  function on() {
    if (disabled) return false;
    try {
      var ds = document.documentElement.dataset;
      return ds[STATE_ATTR] !== "off" && ds[ATTR] !== "off";
    } catch (e) {
      return false;
    }
  }

  function log() {
    try {
      if (document.documentElement.dataset[DIAG_ATTR] !== "on") return;
      console.info.apply(console, ["%c[AdCuck]",
        "color:#0E6E64;font-weight:bold"].concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  function isPlayerRequest(url) {
    return (
      typeof url === "string" &&
      url.indexOf("/youtubei/v1/player") !== -1 &&
      url.indexOf("/ad_break") === -1 &&
      url.indexOf("/heartbeat") === -1
    );
  }

  function readBody(input, init) {
    if (init && typeof init.body === "string") {
      return Promise.resolve(init.body);
    }
    if (input && typeof input === "object" && typeof input.clone === "function") {
      try {
        return input.clone().text();
      } catch (e) {
        return Promise.resolve(null);
      }
    }
    return Promise.resolve(null);
  }

  /* Take YouTube's own outgoing request and change only the client identity.
   * Deriving the context from the live request rather than hardcoding one
   * means the client version, session parameters and visitor data are always
   * whatever the page is currently using - nothing here goes stale. */
  function asEmbedded(body) {
    var obj;
    try {
      obj = nativeParse(body);
    } catch (e) {
      return null;
    }
    if (!obj || !obj.context || !obj.context.client || !obj.videoId) return null;

    obj.context.client.clientName = CLIENT;
    obj.context.client.clientScreen = "EMBED";
    obj.thirdParty = { embedUrl: "https://www.youtube.com/" };
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return null;
    }
  }

  function usable(raw) {
    var data;
    try {
      data = nativeParse(raw);
    } catch (e) {
      return null;
    }
    if (!data || typeof data !== "object") return null;
    var ps = data.playabilityStatus;
    /* No streaming data means nothing to play; a status other than OK means
     * this client is not allowed to (age gates, members-only). Both are
     * ordinary and both fall back. */
    if (!ps || ps.status !== "OK" || !data.streamingData) return null;
    return data;
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (!on() || !isPlayerRequest(url)) {
      return nativeFetch.apply(this, arguments);
    }

    var self = this;
    var args = arguments;
    var original = function () {
      return nativeFetch.apply(self, args);
    };

    return readBody(input, init)
      .then(function (body) {
        if (!body) return original();

        var swapped = asEmbedded(body);
        if (!swapped) return original();

        var headers = (init && init.headers) || { "content-type": "application/json" };
        return nativeFetch
          .call(self, url, {
            method: "POST",
            headers: headers,
            body: swapped,
            credentials: (init && init.credentials) || "same-origin"
          })
          .then(function (res) {
            if (!res || !res.ok) return original();
            return res.text().then(function (raw) {
              var data = usable(raw);
              if (!data) {
                log("embedded copy not playable; using YouTube's own response");
                return original();
              }
              if (raw.indexOf('"adPlacements"') !== -1) {
                /* Worth knowing: the whole point of this path is a response
                 * that never had ads in it. */
                log("embedded copy still carried ads");
              } else {
                log("served an ad-free copy of the video");
              }
              return new Response(raw, {
                status: 200,
                statusText: "OK",
                headers: { "content-type": "application/json; charset=UTF-8" }
              });
            });
          })
          .catch(function () {
            return original();
          });
      })
      .catch(function () {
        return original();
      });
  };

  /* If the substitute plays badly anyway, stop using it and reload once so the
   * viewer ends up with a working video instead of a broken one. Guarded per
   * video id so it can never loop. */
  document.addEventListener(EVT_FAIL, function () {
    if (disabled) return;
    disabled = true;
    window.fetch = nativeFetch;
    log("playback failed on the ad-free copy; falling back");

    var id = "";
    try {
      id = new URL(location.href).searchParams.get("v") || "";
    } catch (e) {
      /* no-op */
    }
    try {
      var key = RETRY_KEY + id;
      if (sessionStorage.getItem(key)) return; // already retried this video
      sessionStorage.setItem(key, "1");
      location.reload();
    } catch (e) {
      /* storage unavailable; leave the page alone */
    }
  });
})();
