# Standing instructions for Claude

This repo is one app: a web page that logs a baby's day into a separate, private data
repo. The owner is a public-health physician with limited coding experience. Explain a
non-obvious choice; skip the tutorial for obvious ones.

Read `docs/background.md` before changing anything. It explains why the architecture is
what it is, and lists decisions that look arbitrary and are not.

## Never

- **Never put his data in this repo.** This repo is likely public and its GitHub Pages
  site is public regardless. Code, tests, synthetic examples only. No real entries, no
  timestamps from the real archive, no real names.
- **Never log entry content** to a console, a workflow log, or an error message. Counts
  and types, not values.
- **Never swallow a write error.** Surface it verbatim in Diagnostics and keep the entry
  queued. The predecessor to this app posted `Commit FAILED` into a chat, deliberately —
  that is how a silent breakage got noticed.
- **Never bring a past day back as foreign if it is this device's own file.** `jsonlFor()`
  exports own rows only, so a backfilled day marked foreign would be dropped the moment
  anything wrote to that day. Backfill uses `absorbOwn` for this device's own file.
- **Never overwrite a row this device has not seen.** A push rewrites a day's file whole,
  which is only safe while our copy is a superset of the remote one. `absorbOwn` takes in
  anything unknown first. Removing that check loses the other parent's night feeds.
- **Never write the other device's file.** One writer per file is the rule that makes a
  whole-file push safe. Either phone may now strike out the other's entries, and that is
  done by writing a `deleted` row carrying the other's `msg_id` into *our own* file —
  `supersede()`. Her file is left exactly as it was. Rewriting it from our copy would
  destroy any row of hers we had not pulled, which is the one failure this design exists
  to prevent.
- **Never resolve two copies of a `msg_id` by order.** The phones can now both hold a row
  with the same id — hers live, his struck. `compact.py` settles it with "a deleted row
  always wins", which is order-independent. Plain last-wins resolved it by filename, so
  whose undo survived depended on what the devices were called.
- **Never silently repair data.** An unpaired sleep entry is a missed message and must
  stay visible as a gap, named on the screen, not quietly paired with the next event.
  A breastfeed logged without its minutes is the same thing: it still counts as a feed,
  it is marked with a `*`, and the screen says the day's time at the breast is an
  undercount. That figure is load-bearing on the Pump tab — it is what explains a low
  expressing day — so guessing at it would make wrong the comparison the tab exists for.
- **Never invent a number the notebook does not have.** The notes reader fills in nothing.
  It places a session in the day when no time was written, and then says `time not
  recorded` on the entry, because a timestamp has to exist for the row to be filed at all.
  Everything else it cannot read with confidence — an ambiguous `23/41mL`, a left/right
  split, a duration — it leaves empty and names on the screen as unread. A wrong side is
  worse than no side.
- **Never total a subset without saying so.** The whole-story screen adds up what this
  phone holds, which is not what the repo holds. It names the days it counted, says how
  many more are in the repo, and offers to fetch them. A lifetime total that is quietly
  short by a week of nappies is worse than no total, because nobody checks a number that
  looks plausible.
- **Never add expressing to a feed.** `pump` is what came out of her; `feed/expressed` is
  what he drank. Summing them counts the same milk twice. The Pump tab's figures and the
  Log tab's figures are drawn from the two separately, and must stay that way.
- **Never delete an entry.** Undo marks `type: "deleted"` and keeps the row. A correction
  is the same thing twice over: mark the original `deleted`, write a new entry. Never
  edit a row in place, however much easier it looks. Undoing the *other* phone's entry
  adds a row rather than changing one, so the original survives in her file untouched —
  the audit trail is stronger across devices, not weaker.
  The one exception is **Setup → Clear this phone**, which empties the whole device on
  purpose. It exists so a scratch dataset does not become the first week of a child's
  record, it is two taps and named plainly, and it touches only this browser — never the
  repo, where history keeps everything anyway. Do not reuse it for anything narrower: if
  a single entry is wrong, that is what Fix and undo are for.
- **Never rename or repurpose a field** in the data contract. Add one if you must.
- **Never add a build step, a framework, or a bundler.** One HTML file, plain
  JavaScript, no dependencies. If something seems to need React, it does not.

## Always

- Run `node test/logic.test.js` and `python3 test/compact.test.py` before claiming a
  change works, and add a case for anything you fix.
- Run `test/browser/*.test.js` too for anything touching layout, colour or the GitHub
  calls. They need Playwright; the app still has no dependencies. Logic tests cannot see
  a viewport, a tap target, a colour or a request, and every bug in those four classes
  found so far was invisible to `logic.test.js`.
- **An optimisation that skips work must fail towards doing the work.** The poll's
  skip-if-unchanged check was written as `seen[path] !== f.sha`, which against a listing
  with no shas compares undefined with undefined, matches, and skips every file forever.
  A wasted request costs nothing; a missed entry costs the night.
- **The token may appear in a setup link, and nowhere else.** It belongs after the `#`,
  which browsers never send to a server, and the app strips it from the address bar as
  soon as it has read it. Never put it in a query string, a path, a log or a commit.
- **Never hard-code a wall-clock time in a test.** `e2e` and `crossdevice` corrected an
  entry to `04:30`, which the app correctly refuses between midnight and 04:30 because it
  has not happened yet. Both failed every night and passed every morning. Derive the time
  from the page's own clock — `earlier()` in those two files — or pin the clock with
  `page.clock.install`, as the Book, Pump and edit tests do.
- **iPhones run WebKit, and every other test here runs Chromium.** They differ on exactly
  what a phone app lives on: native form controls, safe areas, rubber-band scrolling.
  `test/browser/ios.test.js` runs the real engine, and the same checks on Chromium so an
  iOS fix cannot quietly cost Android. It needs `npx playwright install webkit` and
  `npx playwright install-deps webkit`; without them it says so and skips the iOS engine
  rather than passing quietly.
- **Keep the safe-area insets behind `--sat`/`--sar`/`--sab`/`--sal`.** `env()` cannot be
  set from a stylesheet or a test, so a notch was something only a real iPhone could show
  you — and the bug it causes, content hidden under the notch or the home indicator, is
  invisible everywhere else. Read through variables, a test can set an iPhone's real
  numbers and measure what happens. Never go back to `env()` at the point of use.
- **See a new test fail before trusting it.** The service worker's cache bug was first
  "proved fixed" by a test that passed against the broken worker too, because
  `page.reload()` forces revalidation and hid the fault. Revert the fix, watch the test
  fail, put it back.
- **Keep a stub as strict as the real API.** The GitHub stub once accepted a PUT to an
  existing file with no `sha`, which the real API refuses with 422. The overwrite
  protection was never exercised on the path that triggers it. A lenient stub hides the
  behaviour you are testing for.
- **Read the data repo first when sync looks wrong.** One commit per push, device name in
  the message, one file per phone. `list_commits` and a directory listing say in two
  requests which phones have ever written — which is usually a different question from
  the one the symptoms suggest.
- **Anchor an edit on text that exists once.** Two JS blocks have been inserted into the
  stylesheet by matching a section comment that exists in both the CSS and the script.
  Check which half of the file an anchor lives in, and check afterwards that the new code
  is inside `<script>`.
- **Render with data before judging a screen.** An empty app hides its own timeline rows,
  undo buttons and sheets. A whole round of UI bugs survived the first browser pass
  because every screenshot was of an empty app.
- Keep `LABELS` and `CAT_OF` in step with `CATS` and `SHEETS`. The tests fail otherwise,
  which is intended.
- Edit the parser in `docs/parser-source.gs`, run its tests, then copy it into
  `index.html`. That file is the source of truth for it, and it is shared with the older
  Telegram bot.
- Write deployment and troubleshooting instructions for someone who does not know the
  tooling: numbered, in order, saying what each step is for and what "it worked" looks
  like. The README is the standard to match.
- Derive timestamps from `Asia/Singapore`, not the device's zone, so an entry made
  abroad still lands on the right day.

## The data contract

One JSON object per line. Field names and order must not drift.

`ts` (ISO 8601, `+08:00`) · `sender` · `type` · `subtype` · `value` · `unit` · `note` ·
`raw` · `msg_id` · `dur_min` · `ml_l` · `ml_r` · `pump_dev`

The last four were **appended** for the pump tab, never inserted: the original nine keep
their names and their order, so anything reading these files by position still works. They
are written onto every row, null where they do not apply, so `data/raw/` has one shape
throughout rather than two. `dur_min` held how long a pump session took. It is **no longer collected**: the minutes
that belong beside the volume are his at the breast, not hers at the pump, because the
more he takes directly the less there is left to express. The field stays in the contract
and is written `null`, because removing it would leave the archive with two row shapes and
would throw away the sessions already logged with it. Do not reuse it for anything else.

`pump_dev` is which machine: `spectra`, `imani`, or empty for a hand expression. It is a
field rather than more `subtype` values because power pumping is a technique and the
Spectra is a thing — you can power pump on either machine, and folding the two into one
field would lose that pairing. It is a string, so its absent value is `""`, not `null`.

`type` is one of `sleep` `feed` `pump` `nappy` `hygiene` `measure` `vomit` `cry` `tummy`
`med` `vax` `milestone` `note` `deleted`.

`raw` is kept forever. `value` is `null`, never `""`, when absent, and so are `dur_min`,
`ml_l` and `ml_r`; `pump_dev` is a string and is `""`; on a pump session `value` is the total and is authoritative, with the
side split as detail beside it. `msg_id` must be
unique for all time — rows in the data repo's `data/derived/` point back at it. One id can
appear in **two** event files, once live and once struck, when one phone undoes the other's
entry; `compact.py` resolves that to a single row, so `data/raw/` still holds one row per
id and `data/derived/` still resolves.

## Writing style

- British / Singapore English. Dates as DD MMM YYYY.
- Plain words over jargon. Define a term the first time it appears.
- Separate what you verified from what you assume. Say what you did not check.
- Do not soften a finding to be agreeable. If something looks wrong, say so.

## Git

- Work on the branch you are given; never push to `main` without asking.
- Commit messages: what changed and why, in plain English.
