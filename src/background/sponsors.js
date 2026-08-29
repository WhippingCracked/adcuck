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

const cache = new Map(); // hash prefix -> { at, videos }

export const DEFAULT_CFG = {
  categories: ["sponsor", "selfpromo", "interaction"],
  actionTypes: ["skip"],
  minVotes: 0
};

/* The four characters that stand in for the video id. */
export async function hashPrefix(videoId, chars = 4) {
  const bytes = new TextEncoder().encode(videoId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, chars);
}

export function buildUrl(prefix, cfg) {
  return (
    SB_API +
    prefix +
    "?categories=" + encodeURIComponent(JSON.stringify(cfg.categories)) +
    "&actionTypes=" + encodeURIComponent(JSON.stringify(cfg.actionTypes))
  );
}

/* Nothing here trusts the response: it is third-party data arriving over the
 * network, and a malformed segment must be dropped rather than handed to a
 * function that will seek the player somewhere absurd. */
export function normalise(videos, videoId, cfg) {
  if (!Array.isArray(videos)) return [];
  const entry = videos.find((v) => v && v.videoID === videoId);
  if (!entry || !Array.isArray(entry.segments)) return [];

  return entry.segments
    .filter((s) => {
      if (!s || !Array.isArray(s.segment) || s.segment.length !== 2) return false;
      const [start, end] = s.segment;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (start < 0 || end <= start) return false;
      if (!cfg.categories.includes(s.category)) return false;
      if (s.actionType && !cfg.actionTypes.includes(s.actionType)) return false;
      if (typeof s.votes === "number" && s.votes < cfg.minVotes) return false;
      return true;
    })
    .map((s) => ({
      uuid: String(s.UUID || s.segment.join("-")),
      start: s.segment[0],
      end: s.segment[1],
      category: s.category
    }))
    .sort((a, b) => a.start - b.start);
}

export async function sponsorSegments(videoId, cfg = DEFAULT_CFG, fetchImpl = fetch) {
  if (!videoId) return [];
  const prefix = await hashPrefix(videoId);

  let hit = cache.get(prefix);
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
    cache.set(prefix, hit);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  }

  return normalise(hit.videos, videoId, cfg);
}

export function clearCache() {
  cache.clear();
}
