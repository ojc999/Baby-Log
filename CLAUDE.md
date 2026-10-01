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
- **Never overwrite a row this device has not seen.** A push rewrites a day's file whole,
  which is only safe while our copy is a superset of the remote one. `absorbOwn` takes in
  anything unknown first. Removing that check loses the other parent's night feeds.
- **Never silently repair data.** An unpaired sleep entry is a missed message and must
  stay visible as a gap, named on the screen, not quietly paired with the next event.
- **Never delete an entry.** Undo marks `type: "deleted"` and keeps the row. A correction
  is the same thing twice over: mark the original `deleted`, write a new entry. Never
  edit a row in place, however much easier it looks.
- **Never rename or repurpose a field** in the data contract. Add one if you must.
- **Never add a build step, a framework, or a bundler.** One HTML file, plain
  JavaScript, no dependencies. If something seems to need React, it does not.

## Always

- Run `node test/logic.test.js` before claiming a change works, and add a case for
  anything you fix.
- Run `test/browser/*.test.js` too for anything touching layout, colour or the GitHub
  calls. They need Playwright; the app still has no dependencies. Logic tests cannot see
  a viewport, a tap target, a colour or a request, and every bug in those four classes
  found so far was invisible to `logic.test.js`.
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
`raw` · `msg_id`

`type` is one of `sleep` `feed` `pump` `nappy` `hygiene` `measure` `vomit` `cry` `tummy`
`med` `vax` `milestone` `note` `deleted`.

`raw` is kept forever. `value` is `null`, never `""`, when absent. `msg_id` must be
unique for all time — rows in the data repo's `data/derived/` point back at it.

## Writing style

- British / Singapore English. Dates as DD MMM YYYY.
- Plain words over jargon. Define a term the first time it appears.
- Separate what you verified from what you assume. Say what you did not check.
- Do not soften a finding to be agreeable. If something looks wrong, say so.

## Git

- Work on the branch you are given; never push to `main` without asking.
- Commit messages: what changed and why, in plain English.
