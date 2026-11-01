#!/usr/bin/env python3
"""Checks on compact.py's merge rule. Run: python3 test/compact.test.py

The rule that matters here is that a `deleted` row beats a live row with the same
msg_id whichever order the files were read in. The two phones strike out each other's
entries by writing a deleted row carrying the other's msg_id into their OWN file -
neither ever writes the other's - so both copies reach merge(). Plain last-wins would
settle it by filename order, which would make the outcome depend on what the devices
happen to be called.
"""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "compact", Path(__file__).resolve().parent.parent / "compact.py")
compact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compact)

fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + " -> " + repr(got) +
          ("" if ok else "   expected: " + repr(want)))


def row(**kw):
    base = {"ts": "2026-11-01T09:00:00+08:00", "sender": "Des", "type": "feed",
            "subtype": "bottle", "value": 60, "unit": "ml", "note": "", "raw": "60ml",
            "msg_id": "X1"}
    base.update(kw)
    return base


print("--- a strike beats the original, whichever file was read first ---")
live = row()
gone = row(sender="Simon", type="deleted", subtype="", value=None, unit="", raw="60ml")
for name, order in [("hers first", [live, gone]), ("his first", [gone, live])]:
    out = compact.merge([dict(r) for r in order])
    check(name + ": one row", len(out), 1)
    check(name + ": and it is struck out", out[0]["type"], "deleted")

print("\n--- a strike is not undone by a later copy of the original ---")
out = compact.merge([dict(gone), dict(live), dict(live)])
check("still struck out", out[0]["type"], "deleted")

print("\n--- ordinary last-wins still applies to live rows ---")
out = compact.merge([row(value=60), row(value=90)])
check("one row", len(out), 1)
check("the later value wins", out[0]["value"], 90)

print("\n--- struck rows are kept, never dropped ---")
out = compact.merge([dict(gone), row(msg_id="X2")])
check("both rows survive", len(out), 2)
check("the struck one is still there",
      sorted(r["type"] for r in out), ["deleted", "feed"])

print("\n--- field order and shape are unchanged ---")
out = compact.merge([row()])
check("field order", list(out[0].keys()), compact.FIELDS)
check('an absent value is null, never ""', compact.merge([row(value="")])[0]["value"], None)

print("\n--- the three fields added for the pump tab ---")
check("the original nine still come first, in order",
      list(out[0].keys())[:9],
      ["ts", "sender", "type", "subtype", "value", "unit", "note", "raw", "msg_id"])
check("and the added ones come after, in order",
      list(out[0].keys())[9:], ["dur_min", "ml_l", "ml_r"])
check("a row written before they existed gets them as null",
      [out[0]["dur_min"], out[0]["ml_l"], out[0]["ml_r"]], [None, None, None])
pumped = compact.merge([row(type="pump", subtype="", value=65, unit="ml", raw="pump 65",
                            dur_min=20, ml_l=30, ml_r=35)])[0]
check("a pump session keeps all three", [pumped["dur_min"], pumped["ml_l"], pumped["ml_r"]],
      [20, 30, 35])
check("zero minutes is kept as zero, not turned into null",
      compact.merge([row(dur_min=0)])[0]["dur_min"], 0)
check('an empty string in a number field becomes null',
      compact.merge([row(dur_min="", ml_l="")])[0]["dur_min"], None)
check("a note is still an empty string, not null",
      compact.merge([row(note="")])[0]["note"], "")

print("\n======== " + (str(fails) + " FAILURES" if fails else "ALL PASS") + " ========")
sys.exit(1 if fails else 0)
