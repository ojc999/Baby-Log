# Why the Telegram bot could not be hosted on GitHub

> Kept as history. Paths in this document refer to the private data repo,
> not to this one. The app that replaced the bot is in this repository.

> **Superseded, 01 Oct 2026.** Telegram is being dropped in favour of a tappable web
> app. See `2026-10-01-baby-log-web-app-brief.md`. The analysis below of why GitHub
> cannot host a Telegram webhook still stands, and is summarised in the newer brief.

**Written** 01 Oct 2026. **For** a fresh Claude Code session in a new repository.
**Source of truth for the current system** `apps/baby-log-bot/` in the private
`<owner>/<private-data-repo>` repo.

Read this whole file before writing any code. It contains a decision that reverses the
brief as it was first put, and the reason for it.

---

## 1. What exists today, and what must survive the move

A Telegram bot that turns short messages — `30ml then down`, `poo`, `3.4kg`,
`got his 6-in-1 today, bit grizzly after` — into structured rows, and commits one file
per day into a git repo.

```
you → Telegram → Google Apps Script → Google Sheet → (daily, 2pm) → data/raw/YYYY-MM-DD.jsonl
                   parse rules          live store                    the archive
```

Three files, about 980 lines in total:

| File | Role |
| --- | --- |
| `Parser.gs` | 270 lines. Text in, event objects out. No network, no Sheet, no Apps Script API. |
| `Code.gs` | 476 lines. Telegram webhook, Sheet writes, GitHub commit, setup functions. |
| `README.md` | 236 lines. Deployment, vocabulary, troubleshooting. |

**`Parser.gs` is the asset and it ports verbatim.** It is plain ES5 with no platform
dependencies — the only Apps Script thing in it is `console.log` inside the test
function. Copy it into the new repo unchanged as step one, before designing anything.
Do not rewrite it. It encodes a lot of 3am decisions that are not obvious from the
outside, and it has a test suite (`runParserTests`) that must keep passing.

`Code.gs` is the part being replaced. Everything in it is platform plumbing.

### Design choices that are load-bearing, not incidental

Reproduce all seven. Each exists because the alternative went wrong or would go wrong.

1. **`raw` — the original message text — is kept on every row, forever.** The schema is
   not a bet that has to be right now. If in March he wants something nobody thought to
   track, October can be re-parsed for it.
2. **Undo marks a row `type: "deleted"`. It never removes it.** The audit trail stays
   intact. Every consumer filters `type != "deleted"`.
3. **Sleep is stored as separate `start` and `end` events, never as intervals.**
   Intervals are derived at chart time by pairing. A missed message then shows up as one
   unpaired event rather than silently corrupting every interval after it.
4. **An unrecognised message is stored as `type: "note"`, word for word, and the bot
   says so.** It is never dropped and never guessed at. This is why the user never has
   to remember a format.
5. **Notes are structured later, by a supervised Claude session, not by the bot.**
   The bot only applies rules it can be certain about. Extracted rows go to
   `data/derived/`, each carrying `from_raw` (the source note's `msg_id`), `from_ts` and
   `extracted`. `data/raw/` is never modified.
6. **Expressing (`pump`) is its own type, not a feed.** Expressing 80 ml and the baby
   drinking 80 ml are different events and must never be summed.
7. **A whole day is rewritten on every commit, never appended to.** So a correction or
   an undo produces a correct file instead of a duplicate, and re-running a failed
   commit is always safe.

---

## 2. The ask, and the answer

> *Can this be hosted on GitHub instead, in a public repo?*

**Technically yes. In practice no — don't.** The reasoning matters, so here it is in
full. If you disagree after reading it, section 6 has the GitHub-only build specced out.

### Why it doesn't work

**GitHub cannot receive the webhook.** Telegram delivers updates by POSTing to an HTTPS
URL you nominate. GitHub has no endpoint that accepts an arbitrary POST and starts a
workflow. The one that comes closest, `repository_dispatch`, needs an
`Authorization: Bearer <token>` header, and `setWebhook` only lets you set a URL and a
`secret_token` — you cannot make Telegram send an arbitrary header, and GitHub stopped
accepting tokens as URL query parameters in 2021. So the only way in is to **poll**
`getUpdates` on a schedule. Everything below follows from that.

**The schedule floor is five minutes, and it is not honoured.** GitHub's own
documentation: *"The shortest interval you can run scheduled workflows is once every 5
minutes"*, and *"The `schedule` event can be delayed during periods of high loads …
some queued jobs may be dropped."* In practice a `*/5` cron fires every 10–20 minutes
and sometimes not at all.

That is the fatal part, and it is not about tidiness. The bot's reply **is** the
feedback loop. `30ml then down` coming back as *"Feed (bottle) 30 ml at 03:14. Asleep
03:14."* is how you know it parsed correctly and that you can put the phone down. A
confirmation that arrives fifteen minutes later, after you are asleep, is not a
confirmation. And `/undo` — the whole correction mechanism — depends on a round trip.

**Private repo, useful frequency, real money.** Actions minutes are free on public
repos but not private ones. GitHub Free includes 2,000 minutes/month on private repos;
Linux 2-core is $0.006/minute. A 5-minute cron is 288 runs/day. Assuming billing rounds
each job up to one minute, that is ~8,760 minutes/month, so ~6,760 billable —
**roughly US$40 a month** to run a bot that still replies ten minutes late. At a
30-minute cron you come in under the free allowance, and have something unusable.

> Confirm the per-minute rate and the minute-rounding rule at
> <https://docs.github.com/en/billing/concepts/product-billing/github-actions> before
> quoting these figures to anyone. The free-public / 2,000-private / $0.006 figures are
> from that page on 01 Oct 2026; the per-job round-up is an assumption.

**A public repo silently stops after two months.** Also GitHub's documentation:
*"In a public repository, scheduled workflows are automatically disabled when no
repository activity has occurred in 60 days."* GitHub emails you and you click to
re-enable. A baby log that quietly stops logging, and tells you by email, is worse than
no baby log — you find out when you go looking for the data.

**And a public repo is the wrong place for the data anyway.** See section 5. That one is
not a trade-off to weigh; it is a line.

So the three ways out are: pay ~$40/month, publish his data, or accept a bot that
replies late and dies every two months. None of those is the current system.

---

## 3. What to build instead

Keep the architecture exactly as it is. Replace Google with Cloudflare. The shape is
one-to-one, which is why this is a port and not a rewrite.

```
you → Telegram → Cloudflare Worker → Workers KV → (daily, Worker cron) → private repo
                   Parser.gs, as-is   live store                          data/raw/*.jsonl
```

| Today | Tomorrow | Note |
| --- | --- | --- |
| Apps Script web app | Cloudflare Worker | Real webhook. Instant reply. |
| `Parser.gs` | `parser.js` | Same file, `var` and all. Don't touch it. |
| Google Sheet `events` | Workers KV, one key per day | The ~24h buffer before the repo. |
| Script Properties | Worker secrets + KV | Secrets via `wrangler secret put`. |
| Apps Script time trigger | Worker Cron Trigger | Independent of any repo's activity. |
| Commits to `Baby-Stuff` | Commits to the private data repo | Same Git Data API code. |

**Cost: nothing.** Workers free tier is 100,000 requests/day and 10 ms CPU per
invocation, no card required. KV free tier is 100,000 reads and 1,000 writes/day, 1 GB
stored. A heavy day is maybe 60 messages. The 10 ms is *CPU* time, not wall-clock, so
waiting on the Telegram and GitHub APIs doesn't count against it — but check this early,
because it is the one free-tier limit that could bite.

> Limits from <https://developers.cloudflare.com/workers/platform/pricing/> on
> 01 Oct 2026. Re-check before relying on them.

**Where GitHub comes in.** The code lives in a public GitHub repo, and a GitHub Actions
workflow deploys it to Cloudflare on every push to `main` (`cloudflare/wrangler-action`,
with a Cloudflare API token as a repo secret). So the repo is still the source of truth
and the deployment mechanism — which is most of what "host it on GitHub" was asking
for. What GitHub is *not* is the thing Telegram talks to, because it can't be.

This also fixes two existing weaknesses rather than carrying them over:

- The daily commit is no longer the only path out of the live store. KV is readable
  directly, so a `/flush` is cheap and the 24-hour exposure window can be shortened.
- `setup_registerWebhook` no longer has to be re-run after every deployment. A Worker's
  URL is stable, so the single commonest failure mode of the current bot — a stale
  webhook after a redeploy — disappears.

**One thing the move loses.** The Sheet is currently the correction surface: a wrongly
parsed row can be edited by hand and its `flushed` flag set back to `FALSE`, and the
next commit rewrites that day. KV has no such UI. Replace it deliberately — either a
`/fix` command, or accept that corrections happen in a Claude session against the
committed JSONL. Do not leave this as an afterthought; it is used.

---

## 4. The data contract

This is the part that must not drift. `charts/babydata.py` in the private repo already
reads this format, and there is committed data in it from 29 Sep 2026 onward.

One file per day, `data/raw/YYYY-MM-DD.jsonl`, one JSON object per line:

```json
{"ts":"2026-09-29T03:14:00+08:00","sender":"Simon","type":"feed","subtype":"bottle","value":30,"unit":"ml","note":"","raw":"30ml then down","msg_id":"1482"}
```

| Field | Notes |
| --- | --- |
| `ts` | ISO 8601 with the `+08:00` offset. Timezone is `Asia/Singapore` throughout. |
| `sender` | Telegram first name — so you can see who did which night feed. |
| `type` | `sleep` · `feed` · `pump` · `nappy` · `measure` · `vomit` · `cry` · `tummy` · `bath` · `med` · `vax` · `milestone` · `note` · `deleted` |
| `subtype` | `start`/`end` · `bottle`/`breast`/`formula`/`expressed` · `wet`/`dirty`/`both` · `weight`/`length`/`head`/`temp` |
| `value`, `unit` | Number and `ml`/`min`/`kg`/`cm`/`C`, where there is one. `value` is `null`, not `""`, when absent. |
| `note` | Leftover free text. |
| `raw` | The original message. Always present. |
| `msg_id` | Telegram message id. |

`flushed` is a live-store column only and never appears in the JSONL.

Breaking this format breaks existing charts and existing data. If a change is genuinely
needed, add a field — never rename or repurpose one.

---

## 5. Privacy — read this before creating the repo

The private repo's standing instructions permit routine caregiving logs (sleep, feeds,
nappies, weight and length, milestones) as ordinary repo content. That permission is
for **storing them in a private repo**. It explicitly does not extend to sending his
data anywhere else, and publishing to the open internet is further than anywhere else:
irrevocable, indexable, and permanent in git history even after a later deletion.

So:

- **Public repo: code only.** Parser, Worker, workflows, README, tests, synthetic
  sample data.
- **Private repo: all of his data.** Either the existing `<owner>/<private-data-repo>` or a new
  private one. The Worker commits there using a fine-grained PAT, repo-scoped, Contents:
  Read and write.
- **Workflow logs on a public repo are public.** Never echo a message body, a chat id, a
  sender name or a token into a log. Log event *types* and counts, not content. This is
  easy to get wrong while debugging; put it in the new repo's CLAUDE.md.
- Clinical records — hospital reports, lab or imaging results, diagnoses, anything from
  a doctor — are not covered by that permission at all and must not go near either repo
  without asking first, each time.

Also: Telegram is already a third party holding every message. That is the status quo
and not a reason to relax anything here, but worth stating so the comparison is honest.

---

## 6. If you want the GitHub-Actions-only build anyway

Specced here so the choice is real. Accept these four things or don't build it.

1. Replies arrive 5–20 minutes late, sometimes not at all.
2. The repo must be public for the Actions minutes to be free, so his data goes in a
   separate private repo (section 5 still applies in full).
3. The schedule dies after 60 days of no activity in the public repo. The least-bad
   mitigation: have the workflow commit the Telegram update offset back into the public
   repo whenever it processes new messages. The offset is a bare integer and carries no
   information about him, and the commit doubles as the activity that keeps the cron
   alive. It will not save you during a quiet week.
4. `/undo` becomes unreliable in practice, because "immediately after" no longer exists.

Build notes if you go ahead:

- `.github/workflows/poll.yml`, `on: schedule: - cron: "*/5 * * * *"`, plus
  `workflow_dispatch` so you can force a run.
- `concurrency: { group: baby-log, cancel-in-progress: false }`. Without this two runs
  can overlap and push conflicting commits.
- Persist the `getUpdates` offset between runs — a repo variable is cleanest, a
  committed file is what keeps the cron alive. Pick one knowingly.
- Don't persist sleep state. Derive "is he asleep" from the last `sleep` row in the
  data. That is more robust than the current Script Property and should be ported back
  into any version.
- Node 20 on `ubuntu-latest`, `actions/checkout`, no build step. The parser is plain JS
  and needs no transpiling.

---

## 7. Commands and vocabulary to reproduce

Every slash command is rewritten into its typed equivalent and handed to the same
parser, so the two can never drift apart. Keep that property — it is why there is only
one set of rules to test.

| Command | Rewrites to | Description shown in Telegram |
| --- | --- | --- |
| `/sleep` | `down` | Fell asleep |
| `/wake` | `up` | Woke up |
| `/pee` | `pee` | Wet nappy |
| `/poo` | `poo` | Dirty nappy |
| `/both` | `both` | Wet and dirty |
| `/bottle 60` | `60 ml` | Bottle, ml |
| `/bf 20` | `bf 20` | Breastfeed, min — `/bf left 20` records the side |
| `/formula 90` | `formula 90 ml` | Formula, ml |
| `/pump 80` | `pumped 80 ml` | Expressed, ml |
| `/vomit` | `vomit` | Vomit or large posset |
| `/cry 30` | `cried 30` | Crying or unsettled, min |
| `/bath` | `bath` | Bath |

Handled directly, not by the parser: `/status` (asleep or awake, today's totals, rows
not yet committed), `/undo`, `/flush`, `/help`.

Typed-only, because they happen weekly or once and don't earn a menu slot:
`3.4kg` · `50cm` · `head 35cm` · `temp 37.8` · `ebm 40` · `latched 15` ·
`tummy time 10` · `med vitamin D` · `milestone first social smile` · and anything at
all, kept as a note.

Three parser behaviours that are easy to lose in a port:

- **Compounds** split on `,` `+` or `then` — `30ml then down` is two events.
- **Backdating** with `-N` minutes (`down -20`) or an absolute time (`up @0214`, `up
  @2.14am`). An absolute time that would be in the future is read as yesterday. A
  backdate of more than a minute is acknowledged in the reply.
- **Consuming keywords** — `note`, `milestone`, `vax`/`vaccine`, `med`/`meds`/
  `medicine` — swallow everything after them and are never split or re-parsed. This is
  why `note why is he not pooping` does not log a dirty nappy. Test this case
  explicitly; it is the one that bites.

Order of resolution inside a clause matters. Measurements are checked first because they
are most specific; `pump` is checked before the `ml` rule so expressing isn't logged as
a feed; sleep is checked last because `up` and `down` are short and hide inside other
words. `runParserTests` covers 21 cases including these. Keep it and run it.

---

## 8. Build order, and what the new repo needs

1. Create the public repo. Copy `Parser.gs` → `src/parser.js` **unchanged**. Get
   `runParserTests` running under `node --test` or equivalent, green, before anything
   else exists. That is the safety net for every later step.
2. Create or nominate the private data repo. Mint the fine-grained PAT (repo-scoped,
   Contents: Read and write).
3. Worker skeleton: `POST /` → verify `X-Telegram-Bot-Api-Secret-Token`, check the chat
   allowlist, return 200 fast. A non-200 makes Telegram retry the same update, so catch
   everything and still return 200. De-duplicate on `update_id` — Telegram re-delivers.
4. KV writes, then the reply text. Keep the replies terse; they are read half-asleep.
5. Port `commitFiles_` — the Git Data API sequence (ref → commit → blobs → tree →
   commit → patch ref) transfers almost unchanged. Only the HTTP client differs.
6. Worker Cron Trigger for the daily flush, and `/flush` for on demand.
7. GitHub Actions deploy workflow.
8. README with the full deployment steps, and a CLAUDE.md carrying the seven design
   choices from section 1, the data contract from section 4 and the logging rule from
   section 5.

**Non-negotiables for the new repo, to put in its CLAUDE.md:**

- Error logs and troubleshooting are part of the build, not added later. The current bot
  posts `Committed N days` or `Commit FAILED: …` into the chat after every run,
  deliberately — silence for two days is how you learn the trigger stopped firing. Keep
  that. Add a `/diag` or equivalent that reports: webhook registered, secrets present,
  KV reachable, rows pending, last commit time and result.
- A failed commit must lose nothing. Rows stay unflushed and the next run picks them up.
  Whole days are rewritten, so re-running is always safe.
- Deployment instructions written for someone who does not know the tooling: numbered,
  in order, saying what each step is for and what "it worked" looks like. The current
  README is the standard to match — including its warning that step 6 stops working
  once step 7 is done.
- Secrets never in code, never in logs, never in git.

---

## 9. Open questions

- **Which private repo takes the data** — the existing `<owner>/<private-data-repo>`, or a new
  one? Keeping it in `Baby-Stuff` means the charts and the research notes stay beside
  the data, which is the current arrangement and probably right.
- **Does the old Sheet data get migrated**, or does the new bot start clean on its
  cutover date? There is committed data from 29 Sep 2026 and possibly uncommitted rows
  in the Sheet. Run `/flush` on the old bot before switching anything off.
- **What replaces the Sheet as the correction surface** (section 3, last paragraph).
- **Is Cloudflare acceptable as the host**, or is the point of this exercise to reduce
  the number of third parties rather than swap one for another? If the latter, say so —
  the honest answer then is to keep Apps Script, because it works, is free, and is
  already deployed.

## 10. Not verified

- The per-job minute round-up used in the ~US$40/month figure is an assumption. The
  rate, the free allowances and the public-repo exemption are from GitHub's billing
  page on 01 Oct 2026.
- Cloudflare's free-tier limits are from its pricing page on 01 Oct 2026. The claim that
  time spent awaiting `fetch` does not count against the 10 ms CPU budget is my reading
  of how Workers accounts for CPU time, not something I confirmed in the documentation.
  Verify it with a trivial Worker before committing to the design.
- Whether a push made by `GITHUB_TOKEN` counts as "repository activity" for the 60-day
  rule in section 6 is unconfirmed. The documentation does not say.
- I did not test any of this. Nothing here has been run.

---

## Bottom line

The port is straightforward and the parser transfers unchanged — but GitHub cannot be
the host, because it cannot receive a webhook, and polling on a 5-minute-floor cron
turns an instant confirmation into a fifteen-minute one. Put the code in a public GitHub
repo, deploy it from there to a Cloudflare Worker, and keep every byte of his data in a
private repo.
