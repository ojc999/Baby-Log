# Baby Log

Tap to log sleep, feeds, diapers and hygiene. A static web page that writes straight
into a private GitHub repo. No server, no app store, no third-party service.

```
phone home screen  →  this page               (static hosting)
                        │ writes direct to the GitHub API, token held in the browser
                        ▼
                      data/events/<date>/<device>.jsonl   (your private data repo)
                        │ python3 compact.py --repo ../path-to-data-repo --write
                        ▼
                      data/raw/<date>.jsonl               (the archive)
```

There is no server in that diagram because there does not need to be one. The browser
calls GitHub directly — GitHub's REST API allows cross-origin requests — so the page is
just a static file, and an entry is in the repo within a second of the tap.

## What's here

| | |
| --- | --- |
| `index.html` | The whole app. One file, no build step, no dependencies. |
| `sw.js` | Service worker. Caches the shell so it opens with no signal. |
| `manifest.webmanifest`, `icons/` | What makes it installable to a home screen. |
| `test/logic.test.js` | Logic tests. Run them after any edit. |
| `compact.py` | Folds the per-device files into the archive. Runs against the data repo. |
| `docs/background.md` | **Read this first.** Why it is built this way, and the seven decisions not to undo. |
| `docs/parser-source.gs` | The canonical free-text parser. Edit here, test, re-copy into `index.html`. |
| `docs/why-not-telegram-on-github.md` | History: why the original Telegram bot could not be hosted on GitHub. |
| `optional/pages-single-repo.yml` | Only if you serve the page from the data repo itself. See below. |

## What you tap

| | |
| --- | --- |
| **Sleep** | Asleep now · Awake now |
| **Feed** | Bottle · Breast (minutes, and which side) · Formula · EBM — then Mum's expressing, kept separate, and Vomit |
| **Diapers** | Wet · Dirty · Both |
| **Tummy time** | How long was it (minutes) · Just log it, when you did not time it |
| **More** | Bath · Top and tail · Nails cut · Hair wash · Cord care · Cream · Weight · Length · Head · Temperature · Unsettled · Medicine · Vaccination · Milestone · Note |

Four tiles for the things that happen many times a day, and **More** for everything else.
The split is frequency, not importance: anything in More is two taps rather than one, which
is the right trade for something done once a day or once a week. **Last bath** stays on the
home screen even so — the input moved, the readout did not, because how long since the last
bath is exactly the sort of thing you forget.

Breastfeeds show **which side comes next** — on the Last feed card, and on the Breast
screen itself, where the side opposite the last one is already selected. It is a chip,
so a guess is never forced into the record.

Every category screen also has a **when** row — `now`, `−5`, `−15`, `−30`, `−60`, or a
time picker — and a **free-text box** for anything the buttons miss. The box shows what
it understood *before* saving, so a wrong reading is caught before it is in the record.

The **Summary** tab gives time since the last feed, poop, wet nappy and bath, then
today's totals, the last seven days, latest measurements, and everything logged.

Every entry you logged carries two buttons: **Fix** and **×**. `×` undoes it. **Fix**
opens the time, the amount and the side so a wrong one can be put right — it keeps the
original, marked undone, and saves the correction as a new entry, so the record still
shows what was first logged and when it changed. You can change the time within the
entry's own day; to move one to a different day, undo it and log it again.

Entries logged on the other phone have neither button. That file is not this phone's to
write.

Right after you log something a strip appears at the bottom with **Undo** on it, for
about five seconds. A mis-tap while holding the baby is the commonest way a wrong row
gets in, and that is quicker than finding the row again.

## Why two phones never clash

Each device writes **only its own file**: `data/events/2026-10-01/simon-phone.jsonl`.
Nobody else ever writes that file, so there is nothing to merge and no collision that
could lose an entry. Each push rewrites that one file whole from the phone's own copy,
which makes a push idempotent — repeating one is always safe, and a failed one costs
nothing.

Each phone also reads the other's file. While the app is **on screen** it checks every
ten seconds; it stops the moment the app is backgrounded, so it costs nothing in a
pocket. A check where nothing has changed is a single request — the folder listing
carries each file's version, so a file that has not moved is not downloaded again.

In practice: one of you logs "asleep", the other sees it within about ten seconds
without touching anything, or instantly on opening the app. Sleep pairs across the two
phones — she can log the down, you can log the up, and the Summary shows one complete
sleep rather than two orphaned events.

**Give the two phones different device names.** If you do not, both write the same file.
The app will not lose anything if that happens — before overwriting, it takes in any
rows it has not seen and writes the union — but it is a muddle, and Diagnostics will
say `recovered …` every time it happens. That line is the signal to go and fix the
names.

## Hosting: public or private?

**The site is public either way.** GitHub's own documentation: *"GitHub Pages sites are
publicly available on the internet, even if the repository for the site is private."*
Making one privately needs GitHub Enterprise Cloud. That is fine — the page holds no
secret and no data, and there is no login. **The token is the only lock.**

**The repository can be private only on a paid plan.** Again from the docs: *"If the
account that owns the repository uses GitHub Free or GitHub Free for organizations, the
repository must be public."* So:

| Your plan | This repo can be |
| --- | --- |
| GitHub Free | public only |
| GitHub Pro / Team | public or private |

Since the site is public regardless and the code holds nothing sensitive, a private app
repo buys very little. Keep your **data** repo private; this one does not matter much.

If you would rather avoid GitHub Pages entirely, Cloudflare Pages and Netlify both serve
a static site from a private repo on their free tiers — at the cost of adding a third
party.

## Deployment

About 20 minutes. In order.

### 1. Push this folder to a repo

Its contents go at the repo **root**, not in a subfolder.

### 2. Turn on Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch
`main`, folder `/ (root)`. Save.

A minute later it is live at `https://<username>.github.io/<repo>/`.
*It worked if* that URL shows four coloured tiles.

No workflow needed — Pages serves the files as they are.

### 3. Make the token

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ Generate new token**.

- Repository access: **Only select repositories** → your **private data repo**
- Permissions → Repository permissions → **Contents: Read and write**
- Nothing else
- Expiry: your choice, one year maximum. **Put the date in your calendar** — when it
  expires the app keeps logging but stops pushing, and says so.

*It worked if* the token starts `github_pat_`. Copy it now; GitHub will not show it again.

### 4. Install it on the phone

- **iPhone:** open the URL in **Safari** (not Chrome) → Share → **Add to Home Screen**.
  Safari gives no install prompt, so this has to be done by hand.
- **Android:** open in Chrome → **Install app**, or menu → Add to Home Screen.

*It worked if* launching from the home screen fills the screen with no address bar.

Installing it matters for more than looks: an installed web app is exempt from the
storage eviction that would otherwise clear an unsynced entry on iOS.

### 5. Set up the second phone with a link

Do steps 3–4 and 6 on your phone first. Then, on the **Setup** tab, under **Set up the
other phone**: type a name for it (`wife-phone`), tap **Make the link**, tap **Copy it**,
and send it across.

She opens the link once. The app configures itself — repo, branch, token and her device
name — pulls the last week of entries, and is ready. Nothing to type.

*It worked if* her app shows your entries from the past few days rather than an empty
summary, and Setup shows her own device name.

**The link is the key.** Everything after the `#` is the token, and that part is never
sent to any server — but anyone holding the link can write to the repo. Send it, let her
open it, then delete the message. If it goes astray, revoke the token on GitHub and make
a new one; nothing is lost, both phones just queue until you re-link them.

**On iPhone, do not tap the link.** Tapping a link opens Safari, and a home-screen web app
on iOS keeps its own storage, separate from Safari — so setting up by tapping the link sets
up *Safari*, not the app on the home screen. The home-screen copy then opens with nothing
in it: no token, and none of the entries you just watched arrive. Nothing is lost, but it
reads exactly like the app forgetting everything.

There is no address bar inside a home-screen app, so the link cannot be opened in it
either. The way in is to paste it:

1. Open the site in Safari once and **Add to Home Screen**.
2. **Copy** the setup link (long-press the message → Copy).
3. Open the app **from the home-screen icon**.
4. **Setup → Paste a setup link →** paste → **Use this link**.

The app says which of the two it is running as, so it is obvious if you set up the wrong
one. On Android this does not arise — Chrome and the installed app share storage — so
tapping the link is fine there.

### 6. Set it up in the app

**Setup** tab:

| Field | Value |
| --- | --- |
| Your name | goes on every entry, so you can see who did which night feed |
| This device | e.g. `simon-phone` — **must differ on each phone**, lowercase, no spaces |
| Private data repo | `owner/repo` |
| Branch | `main`, or another if you would rather keep data off main |
| GitHub token | from step 3 |

Tap **Save and test**. *It worked if* the amber strip disappears and Diagnostics shows a
`last push` timestamp — then check the data repo for a new
`data/events/<today>/<device>.jsonl`.

### 7. Prove it end to end

Log a nappy on one phone and a feed on the other, then **Sync now** on both. Each should
show the other's entry on the Summary tab.

### 8. Fold it into the archive, whenever

From a clone of this repo, pointed at a clone of the data repo:

```
python3 compact.py --repo ../your-data-repo              # report only
python3 compact.py --repo ../your-data-repo --write      # write data/raw/
python3 compact.py --repo ../your-data-repo --write --prune   # and clear the shards
```

With no `--repo` it assumes it is sitting at `apps/baby-log-web/` inside the data repo,
which is where it also lives there.

It reports and writes nothing until `--write`, deletes nothing without `--prune`, keeps
`type:"deleted"` rows, de-duplicates on `msg_id` (last wins), and is safe to re-run. A
line it cannot parse is reported and skipped but **left in the event file**, so nothing
is lost. Look at any such line before pruning.

## Keeping one repo instead of two

If you are on a paid plan and would rather the app live inside the private data repo
(at `apps/baby-log-web/`), you cannot use branch-based Pages: it only offers `/` or
`/docs`, and pointing it at `/` would **publish your `data/` folder to the open
internet**.

Use `optional/pages-single-repo.yml` instead. Copy it to
`.github/workflows/pages.yml` in the data repo and set **Settings → Pages → Source:
GitHub Actions**. It uploads only `apps/baby-log-web/`, so nothing else is published.
Read it before you trust it — this is the one place where a mistake exposes data.

## When something breaks

Everything below is on the **Setup** tab under Diagnostics, including the last error
verbatim.

| | |
| --- | --- |
| **`Not connected — kept on this phone only`** | One of **device**, **repo** or **token** is empty. It never means a wrong token — a wrong token says `sync failed` instead. Open **Setup → Diagnostics**: the empty one is marked `MISSING`. Fill it in and tap **Save and test**. |
| Everything is filled in but it still says Not connected | Check the **token** box in particular. Scroll Diagnostics: if it says `token none`, the token did not save. Paste it again and tap **Save and test**. |
| Amber strip says entries unsaved | They are safe on the phone. Tap **Sync now** and read any error. |
| `401 Token rejected` | Expired, revoked or mistyped. Make a new one. |
| `403 Forbidden` | Token is missing **Contents: Read and write**. |
| `404 Not found` | Wrong repo or branch, or the token was not granted that repo. A private repo returns 404 rather than 403 when a token cannot see it, so this usually means access, not a typo. |
| `409` / `422` | Handled automatically: re-reads the file version and retries once. If it sticks, use **Force full re-push**. |
| Nothing pushes, no error | The device name is blank, so the app does not know which file to write. |
| An entry is wrong | Tap **Fix** on it to change the time, amount or side, or `×` to undo it. Either way the original is kept, marked `deleted` — nothing is ever removed. |
| You just mis-tapped | **Undo** on the strip at the bottom, for five seconds after logging. |
| She saw your entries, then they vanished | Almost certainly the iPhone storage split: she set up in Safari, then opened the home-screen app, which has its own empty storage. The Setup tab says so when it detects it. Open the setup link again from the home-screen app. Nothing is lost. |
| Every entry says `me` instead of a name | The **Your name** box on Setup is empty. Fill it in and tap Save and test. It only affects entries logged from then on — earlier ones keep `me`. |
| Nothing from the other phone is in the repo at all | Check the repo itself: `data/events/<today>/` should hold **one file per phone**. If there is only one, the other phone has never pushed — it is not connected, not merely slow. Read its Diagnostics. |
| Diagnostics says `recovered N row(s)` | The file held entries this phone had not seen, and they were kept rather than overwritten. Once, after clearing the browser, is expected. Every sync means **both phones are using the same device name** — change one of them on the Setup tab. |
| The app is only showing today | The app reads today automatically. For older days, **Setup → Load 90 days of history**. A phone set up from a link pulls the last seven days by itself. |
| The other phone's entries are not showing | Four things to check, in order. **1.** Both phones must have **different device names** — if they share one, each skips the file named after itself and neither sees the other. Diagnostics says `SAME DEVICE NAME ON BOTH PHONES` when it can tell. **2.** Both must have the same **repo** and **branch**. **3.** Only **today** is read back, so yesterday's entries from the other phone never appear. **4.** They arrive on open and when you return to the app, at most once a minute — not instantly. |
| Offline | Everything queues. The strip shows how many are waiting. They go up on the next sync. |

## Tests

```
node test/logic.test.js
```

Needs nothing installed. Reads the script straight out of `index.html` under a stubbed
DOM. Checks the parser against its original 21 cases, the export schema against the
archive format, Singapore time and the day boundary, both forms of backdating, sleep
pairing with a deliberate gap, undo, and the two-phone merge. Run it after any edit.

```
npm install playwright && npx playwright install chromium
node test/browser/layout.test.js     # five phone sizes
node test/browser/e2e.test.js        # the real page against a stubbed GitHub
node test/browser/contrast.test.js   # text contrast, light and dark
```

Optional, and the only ones that can catch a layout or a network bug — the first run of
these found three. See `test/browser/README.md`. The app itself still has no
dependencies and no build step; these are development tools that sit beside it.
