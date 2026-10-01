# Baby Log — why it is built this way

**Written** 01 Oct 2026, inside the private data repo; paths rewritten for this
repository. **For** anyone — human or Claude — about to change the app.
**Supersedes** `docs/why-not-telegram-on-github.md` (the Telegram-on-GitHub
assessment) and the first draft of this document (a design that has since been built and
changed in two real ways — see §7).

**The app exists and works.** It is not a proposal. The code is this repository;
deployment steps are in its README. This document is the *why*.

A second repo is involved throughout: the **private data repo**, which holds the
entries the app writes and which this repo never contains. Where this document says
`data/events/` or `data/raw/`, it means paths in that repo.

---

## 1. What it is

A static web page. Four categories at the top — **Sleep**, **Feed**, **Diapers**,
**Hygiene**, plus **More** — each opening onto buttons, a backdate row and a free-text
box. A Summary tab answers "how long since the last feed / poop / wet / bath", then
today's totals, the last seven days, latest measurements, and the full log.

```
phone home screen  →  static page on GitHub Pages      (public repo: app only)
                        │ writes direct to the GitHub API; token held in the browser
                        ▼
                      data/events/<date>/<device>.jsonl (private repo)
                        │ compact.py --write
                        ▼
                      data/raw/<date>.jsonl             (the archive, format unchanged)
```

No server. The browser calls GitHub directly, which works because GitHub's REST API
returns `Access-Control-Allow-Origin: *`. That reversal is the whole reason this
succeeds where hosting the Telegram bot on GitHub failed: Telegram had to *call in* to
GitHub, and GitHub has no endpoint that accepts an arbitrary POST. A browser only ever
calls out.

Files: `index.html` (one file, no build step, no dependencies), `sw.js`,
`manifest.webmanifest`, `icons/`, `test/logic.test.js`, `compact.py`.

---

## 2. One file per device per day

This is the load-bearing decision. Each device writes **only its own file**:
`data/events/2026-10-01/simon-phone.jsonl`.

- **Exactly one writer per file**, so two phones can log at the same moment and there is
  nothing to merge and no collision to lose an entry to.
- **Each push rewrites that file whole** from the phone's local copy — the bot's design
  choice of rewriting whole days, which also makes a push idempotent. Repeating one is
  always safe; a failed one costs nothing.
- **Reading the other phone is one fetch**, so the shared asleep/awake state and the
  "last poop" cards reflect both of you. That fetch happens on open, focus and after a
  push, throttled to once a minute — not only on a manual sync, which was the original
  behaviour and meant a phone with an empty queue never saw the other one at all.
- **A push never overwrites a row it has not seen.** Rewriting the file whole is only
  safe if our copy is a superset of the remote one. When it is not — a cleared browser,
  or two phones sharing one device name — `absorbOwn` takes the unknown rows in first
  and pushes the union. The alternative was silent loss of the other parent's night
  feeds, which is the one failure this design must not have.

The app caches each file's blob SHA so a push needs no read first. A stale SHA returns
409 or 422; the app re-reads the SHA and retries once. If that sticks, **Force full
re-push** in Setup clears every cached SHA and re-sends every day.

Commit noise: one commit per entry, roughly 40 a day. `compact.py --prune` clears the
shards once they are folded into `data/raw/`.

---

## 3. Compaction is on demand, not scheduled

`compact.py` merges a day's device files into `data/raw/<date>.jsonl`. Run by hand, or
by asking a Claude Code session.

There is **no GitHub Actions cron**, deliberately. Actions' five-minute floor and
dropped jobs were fatal when an Action had to *receive* data; here the data is already
committed by the phone and compaction is only tidying. Making it scheduled would add a
moving part that can fail silently, to save a command that takes two seconds. If it is
ever wanted, a nightly run is about 30 Actions-minutes a month against GitHub Free's
2,000 on private repos — but it is not wanted now.

`compact.py` is deliberately timid: reports by default, writes only with `--write`,
deletes only with `--prune`, keeps `type:"deleted"` rows, de-duplicates on `msg_id`
(last wins), and reports an unparseable line rather than dropping it — the line stays in
the event file, so nothing is lost. Tested against fabricated two-device data including
a duplicate id, a malformed line, a row with missing fields and an undone entry.

---

## 4. The token

A fine-grained personal access token, pasted once per device, kept in `localStorage`.
Scoped to **Only select repositories** → the one private data repo, **Contents: Read and
write**, nothing else.

**Why not a proxy.** A small server (a Cloudflare Worker) holding the token instead
sounds safer but buys less than it looks: the proxy must itself be protected or anyone
who finds its URL can write to the repo, so there is a shared secret in the browser
anyway — plus a second service to deploy and keep alive. One secret in one place beats
one secret in two.

**Blast radius**: read and write one private repository's contents. Not the account, not
other repos, not settings. Revocable in one click. The realistic threat is a lost
unlocked phone, which is also a phone with the owner's email on it.

**There is no login.** A GitHub Pages site is public whatever the repo's visibility —
publishing privately needs Enterprise Cloud — so anyone with the URL can open the page.
They see buttons that do nothing. The token is the only lock, and the page contains no
secret and no data.

**Serve Pages from a separate public repo, never from the private data repo.** A Pages
build pointed at the data repo's root would publish `data/` to the open internet. The
separate repo removes the footgun rather than relying on getting a path right.

---

## 5. Offline

Every entry is written to local storage and rendered immediately, then pushed. The day
stays marked as owing a push until GitHub confirms it, so nothing is lost to a failed
write. The amber strip at the top shows the count of unsaved entries — in the header,
not buried on another tab, because a silent queue is how data is lost. Flushes happen on
open, on focus, on `visibilitychange`, on the `online` event, after each entry, and on
demand. The service worker caches the app shell so the page opens with no signal.

**The main remaining risk** is a phone clearing site data with entries still unsaved.
Keep the queue short by syncing eagerly; it is usually empty.

**A correction to the earlier draft.** It said to use IndexedDB rather than
`localStorage` for eviction resistance. That was wrong: both are script-writable storage
and Safari treats them alike — what matters is whether the app is *installed to the home
screen*, which exempts it. localStorage's real limit is size (~5 MB, or roughly 20,000
entries here), which is not a constraint. So the app uses localStorage, and the install
step in the README is the thing that actually protects the queue. Still worth testing on
the iPhone: queue an entry offline, leave it a week, check it survived.

---

## 6. The data contract

Unchanged from the bot, and checked by the test suite against the committed
29 Sep 2026 file. One object per line:

```json
{"ts":"2026-01-02T03:14:00+08:00","sender":"EXAMPLE","type":"sleep","subtype":"start","value":null,"unit":"","note":"","raw":"asleep now","msg_id":"web-example-0001"}
```

| Field | Notes |
| --- | --- |
| `ts` | ISO 8601, `+08:00`. Derived from the `Asia/Singapore` zone, not the device's, so an entry made abroad still lands on the right day. Singapore has no daylight saving, so the offset is constant. |
| `sender` | Who logged it. |
| `type` | `sleep` · `feed` · `pump` · `nappy` · **`hygiene`** · `measure` · `vomit` · `cry` · `tummy` · `med` · `vax` · `milestone` · `note` · `deleted` |
| `subtype` | `start`/`end` · `bottle`/`breast`/`formula`/`expressed` · `wet`/`dirty`/`both` · **`bath`/`wipe`/`nails`/`hair`/`cord`/`cream`** · `weight`/`length`/`head`/`temp` |
| `value`, `unit` | Number and `ml`/`min`/`kg`/`cm`/`C`. `null`, not `""`, when absent. |
| `note` | Leftover text, or `left`/`right` for a breastfeed side. |
| `raw` | What was entered — the button's own words, or the typed text. |
| `msg_id` | **Now a generated id** (`web-<base36>-<random>`), not a Telegram message id. Still the key `data/derived/` rows point at via `from_raw`, so it must stay unique forever. |

**Two additions, both safe.** `type: "hygiene"` is new. The bot's `type: "bath"` is still
read wherever it appears, but new baths are logged as `hygiene/bath`. Nothing in
`charts/` in the data repo keyed off any specific type — `babydata.py` only special-cases `deleted` and
sleep pairing — and the archive held 4 rows when this was decided, all `sleep/start`, so
there was nothing to migrate.

Field names and order must not drift. If a change is genuinely needed, add a field —
never rename or repurpose one.

---

## 7. The seven choices that are load-bearing

Each exists because the alternative went wrong, or would. All seven survive in the app.

1. **`raw` is kept on every entry, forever.** The schema is not a bet that has to be
   right now. If in March he wants something nobody thought to track, October can be
   re-read for it.
2. **Undo marks `type: "deleted"` and never removes.** The audit trail is the point.
   Undone entries stay visible, struck through. Everything downstream filters
   `type != "deleted"`.
3. **Sleep is `start` and `end` events, never intervals.** Paired at read time, so a
   missed entry shows as one unpaired event instead of corrupting every interval after
   it. The Summary tab names the unpaired entries and marks the day `*` in the week
   table, so the total is visibly an undercount rather than quietly wrong. **Never
   silently pair.**
4. **Anything unrecognised is kept as a `note`, word for word.** Never dropped, never
   guessed at. The free-text box previews its reading *before* saving, which the bot
   could not do.
5. **Notes are structured later, by a supervised session**, into `data/derived/` with
   `from_raw`, `from_ts` and `extracted`. `data/raw/` is never modified.
6. **Expressing (`pump`) is its own type, not a feed.** Expressing 80 ml and him
   drinking 80 ml are different events and must never be summed. The app puts it under a
   "Mum" heading in its own colour for that reason.
7. **A day is rewritten whole, never appended to.** A correction produces a correct file
   rather than a duplicate, and re-running is safe.

**The parser** (`docs/parser-source.gs`) is ported into `index.html`,
behaviourally identical — the only edits are cosmetic — and still passes its original 21
cases, which the test suite runs against the copy inside `index.html`. Its role is now
only the free-text box. Keep `docs/parser-source.gs` as the source: edit there, re-run its tests,
re-copy. Three behaviours are easy to lose in a port and are each tested: compounds
split on `,` `+` `then`; backdating with `-N` or `@0214`; and the consuming keywords
`note`/`milestone`/`vax`/`med`, which swallow everything after them — which is why
`note why is he not pooping` does not log a dirty nappy.

---

## 7a. What the commercial trackers do, and which of it was worth taking

Checked against Huckleberry, Nara, Baby Tracker, Glow Baby, ParentLove, BoobieTime and
Amme, plus their review pages. Three things are near-universal and were missing here.

**Which breast comes next.** Every breastfeeding tracker surfaces it, because it is the
one thing nobody can recall at 3am. It needed no new field — the side was already kept
in `note` on a `feed/breast` row — so it is derived, not stored: the opposite of the last
side used, shown on the Last feed card and pre-selected on the Breast screen. Pre-selected
rather than merely suggested, because one tap is the point; still a chip, so a guess is
never written in as fact.

**Correcting an entry.** The single most-requested feature across every tracker's
reviews, where the complaint is having to throw away a day to fix one row. It does not
bend §7.2: nothing is edited in place and nothing is removed. A correction marks the
original `deleted` and writes a new entry — exactly the undo-and-re-log those reviews
describe as the workaround, behind one button. The record still shows what was first
logged, so a correction reads as a correction rather than a rewrite.

**An Undo in reach of the thing just logged.** The other recurring complaint is
mis-tapping while holding the baby. A five-second strip with Undo answers it; hunting a
small × in a list does not.

Deliberately **not** taken: running timers, charts and sleep-trend prediction, multiple
child profiles, and anything that needs a server or an account. They are what the paid
tiers are for, and each would cost the thing this app is — one file, no dependencies, and
a record you own.

## 7b. Sharing between the two phones

Three things, added once the app was actually being set up on a second phone.

**The setup link.** Everything the other phone needs — repo, branch, token, and the
device name it should take — packed into the part of the URL after the `#`. Browsers
never send that part to any server, so the token travels between the two phones and
nowhere else. The app reads it, saves it, and strips it from the address bar with
`history.replaceState` so it is not left sitting there or re-read on a refresh.

The device name in the link is only taken by a phone that has not got one. A phone that
already has a name keeps it and says so. Changing it would move which file that phone
writes while leaving its earlier entries in the old one under the same ids — two copies
of the same rows, in two files.

The link is a secret in a URL, which is a real cost, accepted deliberately: it is the
only thing that makes a new phone work without typing a token. The mitigation is that it
is revocable in one click and that losing it costs nothing but a re-link.

**Polling while on screen.** The read-back used to happen only on open and on focus, so
an app left open never refreshed. It now polls every ten seconds while the page is
visible and stops on `visibilitychange`. A quiet poll is one request: the directory
listing carries each file's sha, so an unchanged file is not downloaded again. Measured
at two requests per twelve idle seconds, against a limit of 5,000 an hour.

A read that fails while `navigator.onLine` is false is swallowed rather than painted
red — at one poll per ten seconds it would otherwise never stop shouting. A failed
*write* still surfaces verbatim, as §10 requires.

**History.** The app only ever fetched today, so a phone set up from scratch opened on
an empty week while the days sat in the repo. It now pulls `BACKFILL_DAYS` (7) on setup
or on opening a link, with a button for 90 days. Measured: 60 days of history is 150
requests and finishes in about a second against a local stub.

One subtlety worth keeping. A past day's file belonging to *this* device must come back
marked as ours. If it came back as the other phone's, `jsonlFor()` would leave those rows
out, and any later write to that day — backdating an entry into it — would rewrite the
file without them. `absorbOwn` already does the right thing, so backfill reuses it,
quietly. Backfill never marks a day as owing a push: it is reading, not writing.

## 8. Privacy

- **Public repo: the app only.** No data, ever.
- **Private repo: all of his data.**
- The permission covering routine caregiving logs — sleep, feeds, nappies, weight and
  length, milestones — is permission to keep them in a *private* repo. It does not
  extend to publishing them. Clinical records (hospital reports, lab or imaging results,
  diagnoses, anything from a doctor) are not covered at all and need asking each time.
- Never log entry content to a console or a workflow log. Counts and types, not values.
- The app sends data to GitHub and nowhere else. No analytics, no third-party scripts;
  the only external request is to `api.github.com`. The one other network dependency is
  Google Fonts for the typeface, which loads no data and can be dropped for a system
  font stack if even that is unwanted.

---

## 9. Tests

`node test/logic.test.js` — reads the script straight out of
`index.html` under a stubbed DOM and checks: the parser's original 21 cases, the
consuming-keyword trap, that every catalogue button maps to a real label and category,
writing and undo, the export schema against the committed archive, Singapore time and
the day boundary, both forms of backdating, sleep pairing with a deliberate gap, and the
two-phone merge (including that re-pulling today does not clobber the other phone's
earlier days). All pass. Run it after any edit.

`node test/browser/*.test.js` — optional, needs Playwright and Chromium. These render
the real page at five phone sizes and drive it against a stubbed `api.github.com`.
See `test/browser/README.md`.

**This section used to list four things no browser had checked. Three of them were
broken.** Written up here because the lesson generalises: logic tests cannot catch any
of it.

- The page had **no doctype, no charset and no viewport meta**. A phone laid it out at a
  virtual 980px and scaled it down — text about 5px tall, unusable without pinch-zoom.
  It had been designed for a phone throughout; it just never said so to the browser. The
  stylesheet's `env(safe-area-inset-*)` rules were dead for the same reason: they only
  resolve with `viewport-fit=cover`.
- **A phone with nothing to push never read the other phone back.** `pullToday` ran only
  on a manual sync, and the Sync now button is hidden whenever everything is saved — so
  there was no way to ask for it either. If one parent did the night feeds, the other
  opened the app and saw none of them. `flush` now reads back regardless, throttled.
- **A push could silently destroy the other phone's entries.** A push rewrites the
  device's file whole; if that file held rows this browser had not seen, they were gone.
  Two ways in: a cleared browser, or — the dangerous one — both phones given the same
  device name. `absorbOwn` now takes unknown rows into the local copy first and pushes
  the union. See §2.
- Text fields were under 16px, which makes iOS Safari zoom the page in on focus and
  never zoom back out; tap targets were under the published 44px floor; twelve bits of
  secondary text were below WCAG AA, worst at 2.75:1. All fixed.

Now verified in Chromium: the cross-origin PUT and its exact shape, headers, base64
round trip (including non-ASCII), the 409 retry, an entry surviving a failed push and
recovering, the two-phone read-back, that nothing is requested from any host but
`api.github.com`, and that Diagnostics shows the error without leaking entry content.

A second pass, with a day of entries seeded before each render — an empty app hides most
of its own UI, which is why the first pass missed all of these:

- **The selected chip on every amount sheet rendered at about 1.1:1 — invisible.**
  `.sheet-row .chip` and `.chip[aria-pressed="true"]` have equal specificity and the
  first came later, so it overrode the pressed background while leaving the pressed text
  colour. The selected amount and the selected side are the two things you must be able
  to read before tapping Save. Fixed with a `:not()` so the pressed state wins whatever
  the order.
- **`--ink-faint` failed AA on all five category tints** (4.12–4.42:1). It had been
  checked against the plain backgrounds only.
- **The undo `×` was 24×34px** — under the tap floor, and destructive.
- **The other phone's rows carried an `×` that could only refuse**, because that file is
  not ours to write.
- **`toast()` was not a toast.** It set `lastErr`, which painted the sync strip red and
  said "sync failed" — so being told you cannot undo the other phone's entry looked like
  a network fault. It is a real toast now, and errors still go to `lastErr`.

A third pass, after the app was first set up on a second phone and said it was not
connected:

- **The token was the one field that did not save.** Config was written only when "Save
  and test" was tapped; a `change` listener would not have helped either, because
  `change` fires on blur and the token is the last box on the page, so it never blurred.
  Everything else was kept, which is the worst version of the bug: five boxes correctly
  filled in and the app insisting it is not connected. Now saved on `input`, and the
  tidying of the device name and repo happens only on blur so it does not fight the
  typist.
- **A successful "Save and test" produced no sign at all.** The strip hides itself when
  everything is fine, so success and failure looked identical. It now says so, and names
  the file this phone writes.
- **Two phones on one device name were invisible.** Each skips the file named after
  itself, so neither sees the other — while `absorbOwn` quietly keeps both sets of rows.
  Diagnostics now names it when it sees entries by someone else in this device's own
  file.
- **The test stub was more permissive than GitHub**, accepting a PUT to an existing file
  with no `sha`. The real API returns 422. The overwrite protection therefore was not
  being exercised on the path that actually triggers it. Worth remembering when writing
  any stub: a lenient one hides the behaviour you are trying to test.

A fourth pass, while adding the sharing above:

- **A skip-if-unchanged check written the wrong way round skipped everything.** The poll
  compared `seenShas[path] !== f.sha` to decide whether to download a file. Against a
  listing with no shas that is `undefined !== undefined`, which is false, so every file
  was skipped forever and no entry from the other phone ever arrived. Real GitHub does
  send shas, so this would have worked in production and failed silently anywhere that
  did not — including the test stub, which is what caught it. Written now as "skip only
  when we positively know it has not moved": a wasted request costs nothing, a missed
  entry costs the night.

A fifth pass, from the first real two-phone setup. The repo is the thing to read first:
one commit per push, carrying the device name in its message, and one file per phone. That
answered in two requests what the symptoms could not — one commit, one device, so the
second phone had never written at all, and there was nothing to merge rather than a merge
going wrong.

- **The iPhone home-screen app has its own storage, separate from Safari.** Set up in
  Safari, add to the home screen, and the home-screen copy opens empty: no token, and
  none of the entries you watched arrive. It reads as the app forgetting everything, or
  as the other parent's entries vanishing. §5 had this the right way round for eviction
  but never drew out that the two are different jars from the start. The app now detects
  which it is running as and says so, because "Not connected" sends you hunting for a
  token you already pasted.
- **`sender` falls back to `me` when the name box is empty**, so every row in the first
  real day reads `me` and you cannot tell who logged what. Harmless to the data and
  recorded here because it looks like a bug.

Still **not** verified, and only a real device can:

- **Safari specifically.** Everything above was checked in Chromium. The viewport,
  16px-field and safe-area fixes are all aimed at Safari behaviour, so they are the
  likeliest place for a surprise.
- **A genuinely live write to GitHub.** The API was stubbed. The request the app builds
  is checked against the documented contract, but no real token was used.
- **iOS storage survival for an installed web app** (§5). Queue an entry offline, leave
  it a week, check it survived.
- **Two devices actually racing.** The 409 path is exercised by a stub that returns 409
  on demand, which is not the same as two phones pushing in the same second.

---

## 10. If you are changing it

- `CATS` at the top of the script defines the categories and every button. `SHEETS`
  defines the amount pickers and their presets. `LABELS` and `CAT_OF` must gain an entry
  for any new type or subtype — the test suite fails if they do not, which is the point.
- Diagnostics on the Setup tab shows the last error verbatim, what is unsaved, and the
  exact path being written. Keep it. The bot's equivalent — posting `Commit FAILED` into
  the chat — was how a broken trigger got noticed. **Never swallow a write error.**
- Keep it one HTML file with no build step. It is about 1,650 lines including the parser,
  which is the right size for this.
- Deployment instructions are written for someone who does not know the tooling:
  numbered, in order, saying what each step is for and what "it worked" looks like.
  Match that standard.

## Bottom line

Four categories, buttons inside, each phone writing its own file so the two never clash,
and a Python script to fold those into the archive when asked. The app is built and
tested; what remains is to deploy it to a public repo's Pages, install it on both phones,
and confirm on real devices the four things in §9 that only a browser can prove.
