# AdCuck

A YouTube ad blocker for Chrome (Manifest V3). Made by Archie.

Removes video ad breaks, banner and in-feed ads, and YouTube's anti-adblock
notice. One master toggle, reachable from the popup, from a pill in YouTube's
own masthead, or with `Alt+Shift+Y`. Light and dark, following the OS by
default.

---

## Install (unpacked)

1. `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a YouTube video

The shield pill appears in the masthead, left of your avatar.

## How it works

YouTube's video ads are not a separate network request. They arrive as fields
inside the same same-origin JSON that carries the video you asked for, and the
media streams from `googlevideo.com` — the same host the real video uses. A
network-only blocker cannot touch them. So the work is split across four
layers, each independently toggleable and each failing open.

| Layer | File | Job |
|---|---|---|
| **L0** | `rules/network.json` | Static `declarativeNetRequest` rules. Third-party ad hosts and YouTube's `/pagead/`, `/ptracking`, `/api/stats/ads` paths. |
| **L1** | `src/inject/adfree.js` | **Asks for a copy with no ads.** Swaps the player request to the embedded-player client, which returns a response that never had ads in it. |
| **L2** | `src/inject/interceptor.js` | **The engine.** A `MAIN`-world script at `document_start` that intercepts the player response and deletes `adPlacements`, `playerAds`, `adSlots` and `adBreakHeartbeatParams` before the player sees them. This is what removes pre-rolls and mid-rolls. |
| **L2e** | `src/inject/interceptor.js` | **Enforcement.** Removes the "Experiencing interruptions?" / "Ad blockers are not allowed" payload. |
| **L3** | `src/content/cosmetic.js` | Stylesheet + `MutationObserver` for banners, in-feed promos, overlays, and the anti-adblock dialog. |
| **L5** | `src/content/sponsors.js` | **Sponsor reads.** Advertising baked into the video itself, skipped using timings from SponsorBlock. Off by default. |
| **L4** | `src/content/watchdog.js` | Safety net. If an ad plays anyway, mute, click skip, or seek the ad clip to its end. |

`src/content/bridge.js` connects the two worlds: the interceptor runs in the
page's JavaScript realm where `chrome.storage` does not exist, so the bridge
publishes state onto `<html>` as data attributes. It seeds those attributes
from `localStorage` synchronously, because reading `chrome.storage` (async)
would let a frame of page script run before we know blocking is paused.

**Fail-open is a hard rule.** Every layer wraps its work in `try/catch` and
returns the untouched original on error. A blocker that throws inside
`JSON.parse` does not show ads — it shows a black page.

## The four buttons

If you would rather not use a terminal, double-click these in order:

| File | What it does |
|---|---|
| `1-get-filters.bat` | Asks for a video link, sits through the ads on it, then adds what it found to `filters.js` by itself. Parts of YouTube are refused outright and listed |
| `2-check.bat` | Runs every test. Tells you plainly whether it is safe to send out |
| `npm run guard` | Checks the filter list is present, loads, and has not lost anything since your last save. `1`, `2` and `3` all run it first |
| `3-send-it.bat` | Sends **just the filter files** to GitHub, which republishes the list. Anything else you have been editing is listed and left alone unless you say otherwise |
| `4-make-zip.bat` | Packs just the extension files into `adcuck-<version>.zip` for the Chrome Web Store |

They install what they need on first run, so `1` and `2` will take a few
minutes the first time and seconds afterwards. Everything below is the same
thing from a terminal.

## Getting set up

You need **Node 20 or newer** ([nodejs.org](https://nodejs.org), take the LTS
build). Nothing else — no Python unless you want to regenerate the icons.

```bash
npm run setup     # installs Playwright, then downloads the Chromium it drives
```

That is the only dependency: Playwright, used by the tests and by
`tools/discover.mjs`. The extension itself ships zero dependencies — it is
plain files that Chrome loads directly.

`npx playwright install chromium` downloads a private copy of Chromium (a few
hundred MB) into Playwright's own cache. It does not touch the Chrome you
browse with.

## Tests

```bash
npm test          # Windows and macOS
npm run test:ci   # Linux, where there is no display to open a window on
```

A browser window flashes up while the tests run. That is expected: Chrome will
not load an extension in headless mode, so the suite needs a real one.

Loads the unpacked extension into Chromium and serves a synthetic YouTube page
at the real origin (so the content scripts actually match), then asserts each
layer's behaviour: ads stripped, real content untouched, the pause toggle
genuinely stopping every layer, the channel allowlist honoured, both popup
themes painting, and no uncaught errors. 122 checks, plus 27 in
`test/sponsors.mjs`. Screenshots of the popup
land in `test/screenshots/`.

`test/bench.mjs` measures the thing that decides how fast YouTube feels. The
scrub runs synchronously inside YouTube's own bootstrap, so every millisecond
it costs is a millisecond of blank page. It builds payloads shaped like real
`ytInitialData` (0.5-3MB of nested renderers) and fails if the overhead passes
120ms:

```
payload            bytes     parse    scrub    total
20 sections       0.48MB    3.3ms    17.9ms   21.2ms
60 sections       1.45MB   10.2ms     6.2ms   16.4ms
120 sections      2.89MB   18.7ms    13.3ms   31.9ms
```

Two rules the benchmark exists to protect:

- **Never `JSON.stringify` inside the walk.** Serialising a candidate
  re-walks its whole subtree; do that per renderer on a feed of thousands and
  the cost goes quadratic. An earlier build did exactly this and spent 130ms
  blocking the main thread on a 2.9MB payload.
- **Key lookups are map hits, not array scans.** `AD_MARKER[key]` runs once
  per key of every object in the payload.

## Releasing a change

`src/changelog.js` is the single source of truth for the version. Every change
gets an entry — third digit for a fix, second for anything new or changed.

1. Add an entry at the top of `src/changelog.js`
2. Set the same version in `manifest.json` and `package.json`
3. `npm test`

Step 3 is what makes step 2 impossible to forget: the suite fails if the three
versions disagree. It also enforces the house style for entries — three
changes per release at most, 64 characters per line so they fit the popup, and
no jargon. Write what someone would *notice*: "Fixed YouTube loading slowly",
never "replaced the quadratic enforcement scan".

Users open it with the **What's new** button in the popup footer. A small dot
sits on that button after an update until they open it once. The version
beside it is a plain label.

## Sponsor segments

Sponsor reads live inside the video file, so no other layer can touch them.
The timings come from [SponsorBlock](https://sponsor.ajay.app/), a list people
submit and vote on. **Off by default** — it contacts a third party, which is
not something to switch on for someone without asking.

**The video id never leaves the machine.** It is hashed, and only the first
four characters are sent. That bucket holds thousands of videos, so the server
cannot tell which one is playing; the right one is picked out locally. There
are unit tests asserting the id never appears in the request URL, because that
is the one property worth proving rather than assuming.

Eight categories are offered, under **Settings** next to the switch. Only the
three that are genuinely advertising start switched on — `sponsor`,
`selfpromo`, `interaction`. Intros, outros, filler, recaps and non-music
sections are the creator's own video, so they are there to be turned on rather
than discovered already running. The list lives in `filters.js`, so it ships
through the update feed.

**The highlight** — the moment everyone scrubs forward to — is handled apart
from all of them, because it is not a range to remove but a single point to
travel to. It arrives as a zero-length segment with its own action type, which
every one of the ordinary filters would throw away. Switched on, it puts a
**Jump to the best bit** button on the player and waits: jumping someone past
the start of a video they chose to open is not a decision to make for them.

**Attribution is a licence condition, not a courtesy.** The database is
CC BY-NC-SA 4.0, so the popup credits SponsorBlock whenever the feature is on,
and AdCuck must never be used commercially while it does.

`test/sponsors.mjs` covers the lookup outside the browser on purpose: the
browser harness cannot intercept a service worker's network calls, so a test
there could not fail and would have been worse than none.

## Where the filters come from

Three places, all of them plain data:

| What | Where | Size |
|---|---|---|
| Selectors for banners, promos, overlays, the anti-adblock toast | `src/filters/filters.js` | 38 hide, 5 remove |
| Network rules for third-party ad hosts and YouTube's `/pagead/` paths | `rules/network.json` | 12 rules |
| Field names to delete from the player response | `src/filters/filters.js` → `response` | 6 keys, 20 markers |

They were hand-written by reading real YouTube payloads. `interceptor.js` keeps
its own inline copy of the response lists because it has to run before anything
async can load — a test asserts the two copies never drift apart, which is what
makes that duplication safe.

### Finding new ones instead of guessing

```bash
node tools/discover.mjs                                  # a video, then the feeds
node tools/discover.mjs https://youtube.com/watch?v=…    # or one you choose
```

`tools/discover.mjs` opens real YouTube pages in a real browser, captures every
player and browse response plus the live DOM, and reports the ad-shaped things
it saw that the current list does **not** cover. It writes
`feed/discovered.json` and applies nothing.

**A watch page comes first, and that matters.** The ads worth catching — the
pre-roll, the skip button, the banner across the bottom of the player — only
exist while a video is playing. Discovery used to visit the home page, trending
and a search, none of which have any of that, so it was only ever seeing the
smaller banner-and-promo family. It now opens a video, starts playback, and
samples the DOM every 1.5s for about 18 seconds, keeping the union: a skip
button that lives for five seconds is invisible to a single snapshot taken at
the end.

It also reads element **classes** now, not just custom element names. Most of
the in-player ad furniture (`.ytp-ad-module` and friends) is plain `<div>`s
with a class, and a scan that only looked at tag names could never see any of
it.

A brand new browser profile in the UK or EU lands on the cookie wall instead of
YouTube. Discovery answers it with **Reject all** and carries on; if that
button isn't there it says so rather than reporting an empty result, because
"found nothing" and "never got there" look identical otherwise.

Every candidate is still a guess until you have looked at it, and a filter list
that eats real content is worse than one that misses an ad. Run it monthly, or
whenever something starts leaking through.

#### What counts as ad-shaped

`tools/discover-match.mjs`, kept separate so `test/discover.mjs` can hold it to
account without opening a browser. It splits a name into words —
`displayAdRenderer` → `display, ad, renderer` — and matches whole words only,
so `ad` is caught wherever it sits while `adjacent`, `download` and `add` are
left alone.

That test exists because the previous matcher was a regex that was
case-sensitive and anchored, and between them those two details meant it
matched almost nothing: `displayAdRenderer` was out because of the capital A,
`ytd-ad-slot-renderer` was out because `ad` is followed by a lowercase `s`. The
only names that got through were ones *ending* in a suspect word — which is why
a run would come back proposing `ytd-masthead`, the YouTube header bar, and
nothing else. None of that was visible from the outside, because "found nothing
new" is also what success looks like. The test now checks the matcher against
every renderer and element already in the shipped list: if it wouldn't have
found the ads we already know about, it won't find their replacements either.

### Adding what it found

```bash
node tools/add-filters.mjs --auto    # what 1-get-filters.bat runs
npm run add                          # or go through them one at a time
```

With `--auto` nothing is asked. Each candidate gets one of three answers from
`tools/never-block.mjs`:

| | |
|---|---|
| **Refused** | It is part of YouTube, not an advert. Never added, whatever its name looks like |
| **Added** | The name carries `ad`, `promo`, `sponsor` or `mealbar` as a whole word — in YouTube component names that means an advert essentially every time |
| **Set aside** | Ad-shaped, but by a word that has lied before (`paid`, `brand`, `premium`, `offer`, `pyv`). Listed at the end for you to look at with `npm run add` |

**The refused list is what makes adding things unattended defensible.** It
covers page structure, the player and every control on it, so the worst an
automatic run can do is add a filter that hides nothing — never one that hides
YouTube. It exists because the alternative already happened: a run proposed
`ytd-masthead` (the entire header bar) and `yt-progress-bar-playhead` (the dot
you drag on the scrubber), and both were accepted. `test/discover.mjs` checks
every one of those real names, so the list cannot quietly stop covering them.

Without `--auto` you get the old behaviour: one at a time, `y` to block it,
`n` to leave it, `q` to stop.

#### Fresh, not accumulated

`1-get-filters.bat` passes `--fresh`, which **replaces** `hide` and
`adMarkers` with what this run saw rather than adding to them. The list stays
a picture of YouTube as it is now instead of everything it has ever been.

Two things make that safe rather than lossy:

- **Discovery reports every ad it sees, not just the unfamiliar ones.** If it
  only reported what was missing from your list, a fresh run would drop the
  filter for every ad that is still on the page, and the list would rot a
  little each time you refreshed it. The `*` in its output marks the ones that
  are new to you.
- **A link you give is visited first, then the feeds anyway.** Watch pages and
  feeds carry different families of ad, and a fresh run that skipped the feeds
  would quietly throw away every banner filter.

`npm run reset` empties the two lists on demand, and `npm run add` still
appends rather than replacing.

**What a fresh run never clears**, because nothing on an ordinary page could
put it back:

| | |
|---|---|
| `response.playerKeys` | `adPlacements`, `adSlots`, `playerAds`… — this *is* the ad blocking. Clear these and the player goes back to playing adverts |
| `remove` | The anti-adblock dialog, and the grid cells that would otherwise be left as empty gaps |
| `enforcement` | The wording of "ad blockers are not allowed", which only appears once you are already blocking |
| `unlock` | Undoing the scroll lock that dialog leaves behind |

Both the reset and the fresh run check those survived and roll back if they
did not.

Either way, what you approve is written into the right list in
`src/filters/filters.js`, keeping that file's existing indentation, and
`git checkout src/filters/filters.js` undoes the lot.

The review is the safeguard, not the typing, so this does the editing itself.
It backs the file up first, writes, re-parses the result and checks every
approved entry actually landed and that the list came out exactly the right
length. If any of that fails it restores the backup and exits non-zero — a
filter list that will not load is worse than one that misses an ad.

`1-get-filters.bat` runs discovery and this review back to back, so the whole
loop is one double-click.

#### The second copy of the field names

`src/inject/interceptor.js` carries its own copy of `playerKeys`, `adMarkers`
and `adGateReasons`. It has to: it runs in the page's own world at
`document_start`, before anything from the extension's side can hand it
`filters.js`, and the updated lists that arrive over the feed arrive *after*
the page has already asked YouTube for the video — which is the moment that
matters.

Two copies of one truth always drift. `test/e2e.mjs` has always failed when
they disagree, which is the right safety net but leaves you to fix it by hand
in a file you should never have to open — and a new field name that only
exists in `filters.js` is a filter that quietly does nothing.

So `add-filters.mjs` calls `tools/sync-interceptor.mjs` immediately after it
edits `filters.js`: both files are written, or neither is. `npm run sync`
runs it on its own if you ever edit `filters.js` directly. It re-parses
`interceptor.js` before saving — a player script that throws at
`document_start` takes the whole page with it — and restores the original if
anything goes wrong.

`3-send-it.bat` treats `interceptor.js` as a filter file for the same reason,
so the two never travel separately.

## Over-the-air filter updates

Filters update themselves without a store release. The extension reads a static
JSON feed on GitHub Pages every hour, on browser start, and whenever you
press **Check now** in the popup.

**The rule that makes this legal:** the feed carries *parameters* — selector
strings, field names, rule objects. The engine that reads them ships in the
package and never comes from the network. Fetching a JavaScript function would
breach MV3's remote-code ban however it was encoded, and that is the fastest
route to removal from the store.

### What actually reaches people

Two different things, easy to conflate:

- **The repository** holds the whole project — code, tests, tools, notes. It
  has to, because GitHub Actions builds the feed *from* that source. A repo
  containing only filters could not build anything.
- **What gets published**, and therefore what anyone's browser ever downloads,
  is only `feed/` — three small JSON files. The workflow uploads that folder
  and nothing else (`upload-pages-artifact` with `path: feed`), so the rest of
  the repo is never served.

`3-send-it.bat` commits only `src/filters/filters.js` and `rules/network.json`
by default. Other edits are listed and left on your machine unless you say to
include them, so a half-finished change to the popup cannot ride along with a
filter fix.

### Setting it up

1. Push this repo to GitHub.
2. **Settings → Pages → Source: GitHub Actions.**
3. Push a change to `src/filters/filters.js` or `rules/network.json`. The
   `publish-feed` workflow builds the feed, verifies every checksum, and
   deploys it.
4. Nothing to configure: `DEFAULT_FEED` in `src/background/updater.js` already
   points at this repo's Pages address. To aim a build somewhere else (a fork,
   a test feed) without touching the code:

   ```js
   chrome.storage.sync.set({ feedUrl: "https://whippingcracked.github.io/adcuck/v1/manifest.json" })
   ```

`node tools/build-feed.mjs` builds the same thing locally. The version is the
date plus a hash of the inputs, so it is identical in CI and on your machine
and changes exactly when the filters change — a plain counter would hand the
same version to different content, and clients skip a version they already have.

### What the client does with it

1. Conditional `GET` on the manifest. A `304` costs nothing and is the common case.
2. Refuses the feed if `minExtensionVersion` is newer than the installed build,
   and says so in the popup rather than choking on a format it cannot read.
3. Fetches each file, verifies its **SHA-256** against the manifest, and aborts
   the whole update on any mismatch.
4. Validates everything before applying it. A malformed selector is dropped; a
   malformed file aborts. Fetched rules are re-numbered into ids 1000–9999 so
   they cannot collide with the packaged ruleset, `regexFilter` is refused
   outright, and **no fetched rule may block a page's main frame** — the one
   thing a hostile or broken feed could do that would really hurt.
5. Applies atomically and keeps the previous list for rollback.
6. On failure: backs off 1h → 3h → 6h and keeps blocking with the last good
   list throughout. A failed refresh is not an outage, and the popup says so in
   a tooltip rather than a red banner.

The one non-YouTube permission in the manifest — `https://*.github.io/*` —
exists solely for this.

## The "Experiencing interruptions?" delay

That toast is not just a message — it comes with a stall. Two things handle it:

1. **Remove the trigger.** The interceptor deletes the enforcement payload
   before the player reads it. YouTube renames the carrier keys often, so
   matching is done two ways: a loose key pattern, and the user-visible copy,
   which changes far less often than the schema. The text test only applies to
   small renderer subtrees containing no `"videoId"` — that fence is what
   stops a video *titled* "why ad blockers are not allowed" being pruned as if
   it were the warning itself.
2. **Remove the toast.** The cosmetic sweep matches the same phrases inside a
   short list of container elements, so a renamed renderer still gets caught.

Two things this deliberately does **not** do, both because they can cause the
very delay they were meant to remove:

- **It does not clamp timers by default.** Zeroing arbitrary timers inside a
  player we do not control is a guess: if YouTube uses one to sequence its own
  start-up, firing it early makes the player retry and back off, which is
  *slower*. To A/B it: `chrome.storage.sync.set({clamp: true})`. All the old
  bounds still apply, and it never touches `setInterval` — clamping a 5-second
  poll to zero turns it into a tight loop that pegs a core.
- **It does not fake a playable status when there is nothing to play.** An
  ad-gated response with no `streamingData` is left exactly as it arrived.
  Rewriting it to `OK` hands the player no URLs, so it polls and retries — a
  multi-second stall caused by us, wearing YouTube's clothes.

## Why the ad-free request exists

The measurement that settled it: videos **with** ads took ~12s to start, videos
**without** ads started instantly. If this were YouTube punishing the blocker,
every video would be slow. It is not punishment — it is that deleting the ad
mid-flight leaves the player's ad module waiting for something that will never
arrive. **The 12 seconds was a timeout, and we were causing it.**

So `src/inject/adfree.js` stops removing the ad after the fact and asks for a
copy that never had one. It intercepts the player request and re-issues it as
`WEB_EMBEDDED_PLAYER`, whose response carries no ad placements. The ad module
never arms; there is nothing to wait for.

**Why that client and not Android or iOS.** Those also come back ad-free, but
their playback URLs need a PO Token, and tokens cannot be reused across
platforms — the page cannot mint one, so the URLs would 403 and the video
would not play at all. Web Embedded needs no token for the player request and
stays inside the web family, so the URLs remain playable by the player already
on the page.

**The context is derived, never hardcoded.** It takes YouTube's own outgoing
request and changes only the client name and screen, so client version,
session parameters and visitor data are always whatever the page is currently
using. Nothing in it goes stale.

**Every unhappy path falls back** to YouTube's own response: an unreadable
body, a context we do not recognise, or a substitute that is not playable —
age-restricted and members-only videos are the expected cases. If playback
errors anyway, it switches itself off for the tab and reloads once, so the
viewer gets a working video rather than a dead player. A broken video is worse
than an ad.

Two things worth knowing before relying on it: this sends an authenticated
request identifying as a different client, which is a step beyond hiding ads
after they arrive; and only requests going through `fetch` are covered, so
clicking a video inside YouTube gets the fast path while a cold page load
still uses the old one. The switch is under diagnostics if you want it off.

## The slow start, and why nudging is the fix

The telling observation: with ads allowed, YouTube shows one within about a
second and the video plays *instantly* the moment it ends. So by then the
player already has everything it needs — the bytes are there, the decoder is
warm. When ads are blocked and the video still sits there, the player is not
fetching anything. It is waiting, deliberately.

That is why the answer is not more optimisation. The extension's own cost is
around 15ms; you cannot save four seconds from a 15ms budget. The answer is to
interrupt the wait.

`watchStart()` in `src/content/watchdog.js` does exactly that: if blocking is
on and no ad is showing, a player that has not started after 1.2s gets
`playVideo()`, up to six times, 700ms apart. It stops the moment the video has
genuinely played, so a pause is always the user's decision and never fought.

**It deliberately does not wait for `readyState >= 2`.** An earlier build did,
reasoning that a player with no data is "still loading" and not worth poking.
That was backwards: an unstarted YouTube player sits at `readyState 0`
*because* nothing has asked it to play yet — calling `playVideo()` is what
makes it fetch. The guard skipped the one case worth fixing.

A stall also arms the timer clamp. That bypass used to arm when an enforcement
payload was spotted, which fires on healthy pages, and zeroing timers in a
healthy player can make it retry and start *slower* — so it was off. Arming it
on the stall instead confines it to pages already misbehaving, which is what
makes it safe enough to have on. Turn it off with the third switch under
diagnostics if it ever misbehaves.

### Finding the cause when it is still slow

Turn on diagnostics (Alt+click the popup footer) and two switches appear:
**Block ad requests** (the network rules) and **Strip ads from the video** (the
interceptor). Turn one off, reload, and read the start time. That bisects the
problem in two reloads instead of a week of theories.

The start row's tooltip carries a **stall trace** — what the player was doing
while you waited:

- `rs0 11.2s -> rs4 playing` — the player had **no data** for eleven seconds.
  YouTube was not sending the video. Nothing in the browser fixes that.
- `rs4 11.2s -> rs4 playing` — the player **had the video the whole time** and
  chose not to start it. That is nudgeable, and if the nudge is not firing the
  thresholds in `SLOW` are the place to look.

`readyState` is the whole story: 0 means nothing buffered, 4 means it could
have played immediately.

**The popup tells you whether it worked.** After a video starts, a row appears:

```
● video started in 1.8s · extension 14ms
```

The dot is green when the extension is not the bottleneck, amber when it is
more than a quarter of the total. Hover it for the nudge count and the stall
trace.

That timing is measured from the in-app navigation, not from `performance.now()`
— YouTube is a single-page app, so the tab's clock keeps running between
videos. Measuring against it once reported a 15-second wait as 92 seconds. If that row says the video took 4s and the extension took 14ms, the
time is going to YouTube, not to us — and the honest answer is that no
extension can remove a wait the server is imposing.

## Known limits

- **Server-side stitched ads.** When YouTube splices an ad into the video
  stream itself there is no separate request and no separate element. L4 can
  sometimes seek past it; nothing removes it reliably client-side.
- **Embedded players.** L2 covers iframes and `youtube-nocookie.com`, but the
  masthead pill is desktop-YouTube only, so there is no visible control there.
- **YouTube Music, Shorts, live mid-rolls.** Different surfaces with their own
  renderers. Best effort; add selectors per surface as you meet them.
- **Premium accounts.** Nothing to strip; the counter correctly shows 0.

## Permissions

`storage` and `declarativeNetRequest`, plus host access to `youtube.com` and
`youtube-nocookie.com`. No `<all_urls>`, no `tabs`, no network calls of any
kind — nothing leaves the browser.

## Before you submit to the Chrome Web Store

- **The name will be a problem.** Chrome Web Store's content policy prohibits
  obscene, profane and vulgar names, and "AdCuck" is the kind of thing
  review flags. The name appears in exactly two places — `manifest.json` and
  the `.pill.title` strings in `src/content/toggle.js` — so it is a two-minute
  change if review pushes back. Also note a name may not lead with "YouTube":
  put the brand first, "for YouTube" in the description.
- **Declare the SSAI limit in the listing.** Users forgive a stated
  limitation; they leave one-star reviews for a surprise.
- **Single purpose:** "Blocks advertisements on youtube.com." That is the
  whole extension, which makes the justification easy.
- **Package for upload** with `4-make-zip.bat`, or on a Mac or Linux box:

  ```bash
  zip -r adcuck-store.zip manifest.json icons rules src
  ```

  Either way the zip holds four things and nothing else: `manifest.json` at the
  root, plus `icons/`, `rules/` and `src/`. Everything else in the repo is
  build-time only — the store rejects packages carrying files the extension
  never uses. The zip is verified by extracting it and loading *only* those
  files as an extension: service worker starts, content scripts run, popup
  opens, no errors.

## Layout

```
manifest.json
rules/network.json           L0 static DNR ruleset
src/
  inject/interceptor.js      L2 - MAIN world, the engine
  content/bridge.js          world bridge + counters
  content/cosmetic.js        L3
  content/watchdog.js        L4
  content/toggle.js          masthead pill
  filters/filters.js         bundled filter data
  background/service-worker.js
  popup/                     popup.html, popup.css, popup.js, theme.js
icons/                       generated by tools/make-icons.py
tools/
  discover.mjs               drives the browser, watches a video
  discover-match.mjs         decides what counts as ad-shaped
  add-filters.mjs            adds findings, edits filters.js
  never-block.mjs            what must never be added, and what is safe to
  guard-filters.mjs          refuses to run on a damaged or shrunken list
  reset-filters.mjs          empties the ad filters, keeps what can't be found
  edit-filters.mjs           the one safe way to rewrite filters.js
  sync-interceptor.mjs       keeps interceptor.js's copy in step
  build-feed.mjs             builds the published OTA feed
test/e2e.mjs                 32-check Chromium suite
```
