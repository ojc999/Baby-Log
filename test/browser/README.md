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
