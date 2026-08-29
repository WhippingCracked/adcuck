/* AdCuck - sponsor segment lookup (SponsorBlock).
 *
 * Kept in its own module so it can be tested without a browser: the service
 * worker's network calls cannot be intercepted by the browser test harness,
 * and "it probably works" is not good enough for the one function whose whole
 * job is to not leak what you are watching.
 *
 * PRIVACY, which is the entire design:
 * The video id never leaves the machine. It is hashed, and only the first
 * four characters of that hash are sent. That bucket holds thousands of
 * videos, so the server cannot tell which one is being watched. Picking the
 * right one out of the reply happens locally.
 *
 * LICENCE: the database is CC BY-NC-SA 4.0. Attribution is shown in the popup
 * whenever this is switched on, and it must never be used commercially.
 */

export const SB_API = "https://sponsor.ajay.app/api/skipSegments/";
const TTL = 30 * 60 * 1000;
const MAX_CACHE = 50;

const cache = new Map(); // request signature -> { at, videos }

/* A highlight is not a segment to skip. It is a single moment - the bit
 * everyone scrubs forward to - and it arrives as a zero-length segment with
 * its own action type, so it has to travel a separate path through all of
 * this or the ordinary filters throw it away. */
export const HIGHLIGHT = "poi_highlight";

export const DEFAULT_CATEGORIES = {
  sponsor: true,
  selfpromo: true,
  interaction: true,
  intro: false,
  outro: false,
  filler: false,
  music_offtopic: false,
  preview: false
};

export function selected(categories) {
  const cats = categories || DEFAULT_CATEGORIES;
  return Object.keys(cats).filter((k) => cats[k]);
}

/* The four characters that stand in for the video id. */
export async function hashPrefix(videoId, chars = 4) {
  const bytes = new TextEncoder().encode(videoId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, chars);
}

export function buildQuery(cfg) {
  const cats = selected(cfg.categories);
  const actions = ["skip"];
  if (cfg.highlight) {
    cats.push(HIGHLIGHT);
    actions.push("poi");
  }
  return { cats, actions };
}

export function buildUrl(prefix, cfg) {
  const { cats, actions } = buildQuery(cfg);
  return (
    SB_API +
    prefix +
    "?categories=" + encodeURIComponent(JSON.stringify(cats)) +
    "&actionTypes=" + encodeURIComponent(JSON.stringify(actions))
  );
}

/* Nothing here trusts the response: it is third-party data arriving over the
 * network, and a malformed segment must be dropped rather than handed to a
 * function that will seek the player somewhere absurd. */
export function normalise(videos, videoId, cfg) {
  const out = { segments: [], highlight: null };
  if (!Array.isArray(videos)) return out;

  const entry = videos.find((v) => v && v.videoID === videoId);
  if (!entry || !Array.isArray(entry.segments)) return out;

  const wanted = selected(cfg.categories);

  for (const s of entry.segments) {
    if (!s || !Array.isArray(s.segment) || s.segment.length !== 2) continue;
    const [start, end] = s.segment;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0) continue;

    if (s.category === HIGHLIGHT) {
      /* One highlight per video, and only if asked for. Zero length is
       * correct here - it is a point, not a range. */
      if (!cfg.highlight) continue;
      if (out.highlight === null || start < out.highlight) out.highlight = start;
      continue;
    }

    if (end <= start) continue;
    if (!wanted.includes(s.category)) continue;
    if (s.actionType && s.actionType !== "skip") continue;
    if (typeof s.votes === "number" && s.votes < (cfg.minVotes || 0)) continue;

    out.segments.push({
      uuid: String(s.UUID || s.segment.join("-")),
      start,
      end,
      category: s.category
    });
  }

  out.segments.sort((a, b) => a.start - b.start);
  return out;
}

export async function sponsorSegments(videoId, cfg = {}, fetchImpl = fetch) {
  if (!videoId) return { segments: [], highlight: null };

  const prefix = await hashPrefix(videoId);
  const { cats, actions } = buildQuery(cfg);
  /* The reply depends on what was asked for, so the cache key has to as well -
   * otherwise turning a category on would keep serving the old answer. */
  const key = prefix + "|" + cats.sort().join(",") + "|" + actions.join(",");

  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL) {
    const res = await fetchImpl(buildUrl(prefix, cfg), { credentials: "omit" });
    /* 404 means nobody has submitted anything in this bucket yet. Ordinary. */
    if (res.status === 404) {
      hit = { at: Date.now(), videos: [] };
    } else if (res.ok) {
      hit = { at: Date.now(), videos: await res.json() };
    } else {
      throw new Error("HTTP " + res.status);
    }
    cache.set(key, hit);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  }

  return normalise(hit.videos, videoId, cfg);
}

export function clearCache() {
  cache.clear();
}
