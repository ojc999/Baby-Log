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
| **Hygiene** | Bath · Top and tail · Nails cut · Hair wash · Cord care · Cream |
| **More** | Weight · Length · Head · Temperature · Unsettled · Tummy time · Medicine · Vaccination · Milestone · Note |

Every category screen also has a **when** row — `now`, `−5`, `−15`, `−30`, `−60`, or a
time picker — and a **free-text box** for anything the buttons miss. The box shows what
it understood *before* saving, so a wrong reading is caught before it is in the record.

The **Summary** tab gives time since the last feed, poop, wet nappy and bath, then
today's totals, the last seven days, latest measurements, and everything logged.

## Why two phones never clash

Each device writes **only its own file**: `data/events/2026-10-01/simon-phone.jsonl`.
Nobody else ever writes that file, so there is nothing to merge and no collision that
could lose an entry. Each push rewrites that one file whole from the phone's own copy,
which makes a push idempotent — repeating one is always safe, and a failed one costs
nothing. On sync a phone also reads the other's file for today, so the shared
asleep/awake state and the summary reflect both of you, a minute or two behind.

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

### 5. Repeat 3–4 on the second phone

Each phone needs its own install and its own **device name**. The token can be shared.

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
| Amber strip says entries unsaved | They are safe on the phone. Tap **Sync now** and read any error. |
| `401 Token rejected` | Expired, revoked or mistyped. Make a new one. |
| `403 Forbidden` | Token is missing **Contents: Read and write**. |
| `404 Not found` | Wrong repo or branch, or the token was not granted that repo. A private repo returns 404 rather than 403 when a token cannot see it, so this usually means access, not a typo. |
| `409` / `422` | Handled automatically: re-reads the file version and retries once. If it sticks, use **Force full re-push**. |
| Nothing pushes, no error | The device name is blank, so the app does not know which file to write. |
| An entry is wrong | Tap its `×`. That marks it `deleted` and keeps it. To change one, undo and re-log with the right time. |
| Offline | Everything queues. The strip shows how many are waiting. They go up on the next sync. |

## Tests

```
node test/logic.test.js
```

Reads the script straight out of `index.html` under a stubbed DOM. Checks the parser
against its original 21 cases, the export schema against the archive format, Singapore
time and the day boundary, both forms of backdating, sleep pairing with a deliberate
gap, undo, and the two-phone merge. Run it after any edit.
