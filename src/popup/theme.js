/* Synchronous theme seed. Must stay tiny and must run before popup.css.
 * chrome.storage is async, so reading it here would guarantee one frame of
 * the wrong theme every time the popup opens. popup.js keeps this mirror in
 * step with the authoritative value in chrome.storage.sync. */
(function () {
  var t;
  try {
    t = localStorage.getItem("cb_theme");
  } catch (e) {
    t = null;
  }
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
  }
})();
