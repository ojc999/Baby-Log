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
  "last poop" cards reflect both of you.

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

What is **not** tested, and should be verified on real devices:

- A live cross-origin write from a browser to the GitHub API. Everything rests on it and
  the CORS header is documented, but I ran no browser.
- The 409/422 retry path, which needs two devices genuinely racing.
- iOS storage survival for an installed web app (§5).
- Anything visual. No browser rendered this page before it was published.

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
