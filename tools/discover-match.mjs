/* What counts as ad-shaped.
 *
 * Kept apart from discover.mjs on purpose. discover.mjs needs a browser and
 * a live YouTube, so nothing in it can be tested on a build machine - and a
 * matcher that cannot be tested is a matcher that quietly stops matching.
 * Everything here is a pure function over strings, so test/discover.mjs can
 * hold it to account without opening anything.
 */

/* The previous version of this test was a single regex:
 *
 *   /(^|[A-Za-z])(ad|ads|promo|…|masthead)([A-Z]|$)/
 *
 * It was case-sensitive and it demanded a capital letter or the end of the
 * string straight after the word. Between them those two details meant it
 * matched almost nothing real: "displayAdRenderer" was out because of the
 * capital A, and "ytd-ad-slot-renderer" was out because "ad" is followed by
 * a lowercase "s". What survived was names ENDING in a suspect word - which
 * is how a discovery run came back proposing "ytd-masthead", the YouTube
 * header bar, and nothing else at all.
 *
 * Splitting into words and comparing whole words is wider AND stricter: "ad"
 * is caught wherever it sits, and it stops matching inside "adjacent",
 * "download" or "add". */
export const SUSPECT = new Set([
  "ad", "ads", "advert", "adverts", "advertise", "advertiser", "advertisement",
  "promo", "promos", "promoted", "promotion", "promotions",
  "sponsor", "sponsors", "sponsored", "sponsorship",
  "brand", "mealbar", "premium", "payment", "paid", "upsell", "offer",
  "pyv", "enforcement"
]);

/* Note what is deliberately absent: "masthead". YouTube's header is
 * <ytd-masthead>, while the ad unit sharing the word is
 * videoMastheadAdV3Renderer / #masthead-ad - both of which carry "ad" as a
 * word anyway. Keeping "masthead" would offer the whole navigation bar up as
 * something to block, and a list that suggests that is a list nobody trusts. */

/** someAdRenderer -> [some, ad, renderer]; ytd-ad-slot -> [ytd, ad, slot] */
export function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export const suspicious = (name) => words(name).some((w) => SUSPECT.has(w));

export const RENDERER = /(Renderer|ViewModel)$/;

/** Split the current filter list into the three things a lookup needs. */
export function knownFrom(F) {
  const selectors = F.hide.concat(F.remove);
  return {
    keys: new Set([...F.response.adMarkers, ...F.response.playerKeys]),

    /* The leading element name of each selector. */
    tags: new Set(
      selectors.map((s) => (s.match(/^([a-z][a-z0-9-]*)/) || [])[1]).filter(Boolean)
    ),

    /* Every class mentioned anywhere in each selector. The old code cut each
     * selector at its first "." instead, which turned ".ytp-ad-module" into
     * an empty string - so known classes counted as unknown forever and were
     * re-proposed on every single run. */
    classes: new Set(
      selectors.flatMap((s) => [...s.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]))
    )
  };
}

/** Walk a response body, counting ad-shaped renderer keys into `out`. */
export function collectKeys(node, known, out, samples, depth = 0) {
  if (!node || typeof node !== "object" || depth > 30) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, known, out, samples, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if ((RENDERER.test(k) || k.endsWith("Params")) && suspicious(k) && !known.keys.has(k)) {
      out.set(k, (out.get(k) || 0) + 1);
      if (samples && !samples.has(k)) {
        const s = JSON.stringify(v);
        samples.set(k, s.length > 220 ? s.slice(0, 220) + "…" : s);
      }
    }
    collectKeys(v, known, out, samples, depth + 1);
  }
  return out;
}

/** Fold one DOM snapshot into the running totals.
 *
 * Counts are kept as a maximum rather than a sum. The page is sampled many
 * times over, so adding would just report how long something sat on screen. */
export function collectDom(dom, known, seenTags, seenClasses) {
  for (const [tag, n] of Object.entries(dom.tags || {})) {
    if (known.tags.has(tag) || !suspicious(tag)) continue;
    seenTags.set(tag, Math.max(seenTags.get(tag) || 0, n));
  }
  for (const [cls, n] of Object.entries(dom.classes || {})) {
    if (known.classes.has(cls) || !suspicious(cls)) continue;
    seenClasses.set(cls, Math.max(seenClasses.get(cls) || 0, n));
  }
}
