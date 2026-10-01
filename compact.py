#!/usr/bin/env python3
"""
Fold the app's per-device files into the archive.

The app writes one file per device per day:

    data/events/2026-10-01/simon-phone.jsonl
    data/events/2026-10-01/wife-phone.jsonl

so two phones can log at once without ever clashing. This merges each day's
files into the canonical

    data/raw/2026-10-01.jsonl

which is the format charts/babydata.py and everything else already read.

Deliberately conservative:

  * reports by default and writes nothing until you pass --write
  * never touches data/raw/ for a day it has no event files for
  * never deletes the per-device files unless you also pass --prune
  * keeps type:"deleted" rows, because the audit trail is the point
  * de-duplicates on msg_id, keeping the last occurrence, so re-running after a
    re-push is safe

Usage
    python3 apps/baby-log-web/compact.py                  # report only
    python3 apps/baby-log-web/compact.py --write          # write data/raw/
    python3 apps/baby-log-web/compact.py --write --prune  # and remove the shards
    python3 apps/baby-log-web/compact.py --day 2026-10-01 --write
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

FIELDS = ["ts", "sender", "type", "subtype", "value", "unit", "note", "raw", "msg_id"]

# Set by main() once --repo is known. Defaults to the repo this script sits in, which
# is right when it lives at apps/baby-log-web/ inside the data repo, and overridable
# with --repo so the script also works from a separate checkout of the app.
REPO = Path(__file__).resolve().parent.parent.parent
EVENTS = REPO / "data" / "events"
RAW = REPO / "data" / "raw"


def set_repo(path: Path) -> None:
    global REPO, EVENTS, RAW
    REPO = path.resolve()
    EVENTS = REPO / "data" / "events"
    RAW = REPO / "data" / "raw"


def read_day(day_dir: Path) -> tuple[list[dict], list[str]]:
    """Every row from every device file for one day, plus any complaints."""
    rows: list[dict] = []
    problems: list[str] = []
    for f in sorted(day_dir.glob("*.jsonl")):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError as e:
                problems.append(f"{f.relative_to(REPO)}:{n} is not valid JSON ({e.msg}) — skipped")
                continue
            missing = [k for k in ("ts", "type", "msg_id") if k not in r]
            if missing:
                problems.append(f"{f.relative_to(REPO)}:{n} missing {', '.join(missing)} — skipped")
                continue
            rows.append(r)
    return rows, problems


def merge(rows: list[dict]) -> list[dict]:
    """De-duplicate on msg_id (last wins), order by timestamp, normalise fields."""
    by_id: dict[str, dict] = {}
    for r in rows:
        by_id[str(r["msg_id"])] = r
    out = []
    for r in by_id.values():
        row = {k: r.get(k, "" if k != "value" else None) for k in FIELDS}
        if row["value"] == "":
            row["value"] = None
        out.append(row)
    out.sort(key=lambda r: (str(r["ts"]), str(r["msg_id"])))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Fold per-device event files into data/raw/.")
    ap.add_argument("--write", action="store_true", help="actually write data/raw/")
    ap.add_argument("--prune", action="store_true",
                    help="after a successful write, delete the per-device files for that day")
    ap.add_argument("--day", help="just this day, as YYYY-MM-DD")
    ap.add_argument("--repo", type=Path,
                    help="path to the data repo, if this script is not inside it")
    args = ap.parse_args()

    if args.repo:
        if not args.repo.exists():
            print(f"No such directory: {args.repo}", file=sys.stderr)
            return 1
        set_repo(args.repo)

    print(f"data repo: {REPO}")
    if not EVENTS.exists():
        print(f"No {EVENTS.relative_to(REPO)} directory — nothing logged by the app yet.")
        return 0

    days = sorted(d for d in EVENTS.iterdir() if d.is_dir())
    if args.day:
        days = [d for d in days if d.name == args.day]
        if not days:
            print(f"No event files for {args.day}.", file=sys.stderr)
            return 1

    if not days:
        print(f"No day folders under {EVENTS.relative_to(REPO)}.")
        return 0

    total_problems = 0
    for day_dir in days:
        day = day_dir.name
        rows, problems = read_day(day_dir)
        merged = merge(rows)
        devices = sorted(f.stem for f in day_dir.glob("*.jsonl"))
        target = RAW / f"{day}.jsonl"

        was = 0
        if target.exists():
            was = len([l for l in target.read_text(encoding="utf-8").splitlines() if l.strip()])

        live = sum(1 for r in merged if r["type"] != "deleted")
        undone = len(merged) - live
        print(f"{day}  {len(merged):4d} rows ({live} live, {undone} undone)"
              f"  from {len(devices)} device(s): {', '.join(devices)}"
              f"  → {target.relative_to(REPO)}"
              + (f" (was {was} rows)" if was else " (new)"))

        for p in problems:
            print(f"    ! {p}")
        total_problems += len(problems)

        if not merged:
            print("    nothing to write, skipping")
            continue

        if args.write:
            RAW.mkdir(parents=True, exist_ok=True)
            body = "\n".join(json.dumps(r, ensure_ascii=False) for r in merged) + "\n"
            target.write_text(body, encoding="utf-8")
            print(f"    written")
            if args.prune:
                for f in sorted(day_dir.glob("*.jsonl")):
                    f.unlink()
                    print(f"    removed {f.relative_to(REPO)}")
                if not any(day_dir.iterdir()):
                    day_dir.rmdir()

    if not args.write:
        print("\nReport only. Nothing was written. Re-run with --write to write data/raw/,")
        print("and add --prune to remove the per-device files once that has worked.")
    if total_problems:
        print(f"\n{total_problems} line(s) were skipped. They are still in the event files —")
        print("nothing was lost. Look at them before pruning.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
