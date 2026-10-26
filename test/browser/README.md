# Browser checks

`node test/logic.test.js` is the required check and needs nothing installed. These three
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
