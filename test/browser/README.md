# Browser checks

`node test/logic.test.js` and `python3 test/compact.test.py` are the required checks and
need nothing installed. These three
are extra, and need Playwright and a copy of Chromium:

```
npm install playwright && npx playwright install chromium
```

They are not part of the app. The app itself still has no dependencies and no build step.
Run them when you change the layout, the stylesheet, or anything that talks to GitHub.

| | |
| --- | --- |
| `layout.test.js` | Loads the page at five real phone sizes and fails on quirks mode, a viewport that is not honoured, sideways overflow, a tap target under 44px, a text field under 16px, or a JavaScript error. |
| `e2e.test.js` | Drives the real page against a stubbed `api.github.com`: checks the exact PUT the app sends, the base64 round trip, the 409 retry, an entry surviving a failed push, the other phone's entries arriving, and that nothing is requested from any other host. |
| `pages-subdir.test.js` | Serves the app from a subdirectory, the way GitHub Pages serves a project repo (`/<repo>/`, not the domain root), and checks every relative path, the manifest, the icons and the service worker's scope still resolve. |
| `sharing.test.js` | The two-phone story: his phone makes a setup link, her phone opens it and is configured with nothing typed, the token is stripped from the URL, she gets his history instead of an empty week, and an entry he makes afterwards reaches her phone while she does not touch it. Also measures what an idle poll costs. |
| `firstrun.test.js` | The unconfigured app in a browser tab and as a home-screen app. On iOS those have separate storage, so the app has to say which one you are in rather than just "Not connected". |
| `daynav.test.js` | Scrolling back through the log: it opens on today, loads earlier days as you reach the bottom, fetches a day that exists only in the repo on the way past, stops after a run of empty days, and keeps your scroll position when the ten-second poll redraws. |
| `midnight.test.js` | Logging last night's feed after midnight, with the clock pinned to 00:30. Checks the entry lands on yesterday rather than today, that the backdate chips agree, how far back the picker can reach at all, and that the other phone picks the entry up from the poll rather than only on a fresh setup. |
| `update.test.js` | Whether a deploy actually reaches a phone. Serves the app with the headers GitHub Pages really sends, changes the file, navigates back, and checks the new build is what runs — and that it still opens offline. Must be a navigation, not a reload: Chromium's reload forces revalidation and hides the bug. |
| `yesterday.test.js` | Reaching yesterday from the middle of today. Shows which times the picker reaches on its own, that the yesterday chip reaches the rest, that it never produces a future time, and that the row disarms after a save. Verified to fail before the fix. |
| `book.test.js` | The Book tab: every day on record from one listing, opening a day three weeks back, adding a record at a chosen date and time and seeing it pushed to that day's file, the other phone's file for that day left alone, the future refused, writing to a day that had no folder at all, and a note kept word for word. |
| `edit.test.js` | Editing after the fact. Moving an entry to another day and checking the strike stays in the old day's file while the correction goes to the new one, giving an entry a number it was logged without and the unit that comes with it, and adding a full hand-expression session — minutes and side split — for a day gone by from the Book tab. |
| `doses.test.js` | Doses per day. The Simeticone card and the per-addition columns on the seven-day table, which appear only in a week that had any, with the colspan moving to match; an undone feed taking its dose with it. Vitamin D as a *daily*: its card shows amber from midnight, because a day without it is a missed dose rather than a quiet day. The table's width — a day seeded widest in every column at once, asserting eight columns are all on screen at 375px and 390px and that a 320px phone scrolls the table and not the page. The Feed page's hint checked against `ADDS`, so the prose cannot name an option the pickers no longer offer. Then BioGaia after its removal: no button, no prompt after a bath, no card, the word nowhere on the Summary or the whole story, and the toast's Undo working again now the reminder's button shape has gone — while a seeded row from the days it was given is still in the record and still reads `BioGaia`, because the two dictionary entries stay. Last, the home screen's "Last bath" reading both the app's `hygiene/bath` and the retired bot's bare `bath`, newest of either winning. |
| `stats.test.js` | The whole-story screen. Mostly that it stays out of the way: still five tabs, the app still opens on Log, the way in is below the fold on Summary, and a nappy still logs in three taps with the screen open. Then that it counts what it says it counts, names the days it is missing rather than totalling a subset, fetches them on request, and writes nothing — checked against the live dirty queue, not the saved one. |
| `ios.test.js` | iPhones on the real engine. Runs WebKit where it is installed and the same checks on Chromium so an iOS fix cannot cost Android. Forces an iPhone's safe-area insets through the `--sat`/`--sar`/`--sab`/`--sal` variables and measures what the notch and the home indicator cut off, in portrait and landscape; checks the form controls are not left as native iOS ones, that no box is under 16px or 44px, that a pull does not chain into pull-to-refresh, and that nothing flashes grey on tap. Needs `npx playwright install webkit && npx playwright install-deps webkit`; without them it says so and skips the iOS engine rather than passing quietly. |
| `pump.test.js` | The Pump tab. Logging a session with its minutes and side split, the split-does-not-add-up refusal, production counted apart from the bottle of expressed milk he drank, the chart's two scales, the `*` on a day with an untimed session, Fix adding minutes after the event, and the notes reader: what it reads, what it refuses to guess at, that nothing is written before the preview is confirmed, and that pasting the same page twice cannot double a month. |
| `crossdevice.test.js` | One phone undoing and correcting the other's entries. Checks the other phone's file is byte-identical afterwards, that the strike lands in this phone's file carrying her id, that a later poll does not resurrect the row, that her phone catches up without being forced into a push, and what compaction makes of the pair. |
| `contrast.test.js` | Measures every text node against its own background in both light and dark, and reports anything under WCAG AA. |

Each writes screenshots to the system temp directory, or to `$SHOTS` if you set it.

## Why these exist

`docs/background.md` §9 listed four things that no browser had ever checked. They were
checked here, and three of them were broken:

- the page had no viewport meta, so a phone rendered it at 980px and scaled it down;
- a phone with nothing to push never read the other phone's entries back;
- a push could silently destroy rows written by a second phone sharing one device name.

The point of keeping these is that the next person to change the app does not have to
rediscover that a browser is the only thing that can catch any of it.
