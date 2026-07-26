#!/usr/bin/env python3
"""
Regenerates gridfall-sprite-review.html (repo root) straight from the live
data.js/state.js/ui.js — the roster, its sprite status, and even the render
scale are extracted at build time via dump_sprites.js run through jsc, never
hand-copied. The only hand-maintained input is candidates.json (in-progress
redesigns not yet ported into data.js).

Usage: python3 tools/sprite-review/build.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
JSC_CANDIDATES = [
    "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc",
    "jsc",
]

# Story order for display within each section — purely presentational, falls
# back to appending anything not listed (so new content never gets dropped).
BOSS_ORDER = ["voraxx", "warden", "broodmarshal", "proteus", "voidSoulEater",
              "sunGod", "phthora", "cagedGod", "chthon"]
HERO_ORDER = ["merc", "mechRunner", "netrunner", "mentalist", "dreadKnight", "saboteur"]
TIER_ORDER = {"elite": 0, "standard": 1, "fodder": 2}


def find_jsc():
    for cand in JSC_CANDIDATES:
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
        found = subprocess.run(["which", cand], capture_output=True, text=True)
        if found.returncode == 0 and found.stdout.strip():
            return found.stdout.strip()
    sys.exit("Couldn't find jsc — is JavaScriptCore installed at the usual path?")


def run_dump():
    jsc = find_jsc()
    srcs = [os.path.join(REPO, f) for f in ("data.js", "state.js", "ui.js")]
    srcs.append(os.path.join(HERE, "dump_sprites.js"))
    combined = "\n".join(open(s, encoding="utf-8").read() for s in srcs)
    tmp_path = os.path.join(HERE, "_combined_dump.tmp.js")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(combined)
    try:
        result = subprocess.run([jsc, tmp_path], capture_output=True, text=True)
    finally:
        os.remove(tmp_path)
    if result.returncode != 0 or not result.stdout.strip():
        sys.exit("dump_sprites.js failed:\n" + result.stderr)
    return json.loads(result.stdout)


def order_key(order_list):
    def key(entry):
        k = entry["key"]
        return (order_list.index(k) if k in order_list else len(order_list), k)
    return key


def modal_hero_dims(roster):
    dims_count = {}
    for e in roster:
        if e["kind"] == "hero" and e["dims"]:
            d = (e["dims"]["w"], e["dims"]["h"])
            dims_count[d] = dims_count.get(d, 0) + 1
    if not dims_count:
        return None
    return max(dims_count.items(), key=lambda kv: kv[1])[0]


def apply_candidate_scale_overrides(dump, candidates):
    # A candidate may pin its own render scale (e.g. a wider/taller grid than
    # its target's current shape) — same mechanism as ui.js's real
    # SHAPE_SCALE_OVERRIDE, just applied to a key that doesn't exist in
    # data.js yet.
    for c in candidates:
        if c.get("scale"):
            dump["scale"]["overrideByShape"][c["key"]] = c["scale"]


def build_html(dump, candidates):
    apply_candidate_scale_overrides(dump, candidates)
    roster = dump["roster"]
    bosses = sorted([e for e in roster if e["tier"] == "boss"], key=order_key(BOSS_ORDER))
    heroes = sorted([e for e in roster if e["kind"] == "hero"], key=order_key(HERO_ORDER))
    mobs = sorted(
        [e for e in roster if e["kind"] == "enemy" and e["tier"] != "boss"],
        key=lambda e: (TIER_ORDER.get(e["tier"], 9), e["key"])
    )

    std_dims = modal_hero_dims(roster)
    for e in heroes:
        e["nonstandardSize"] = bool(e["dims"] and std_dims and
                                     (e["dims"]["w"], e["dims"]["h"]) != std_dims)

    payload = {
        "bosses": bosses,
        "heroes": heroes,
        "mobs": mobs,
        "spriteShapes": dump["spriteShapes"],
        "genericPalettes": dump["genericPalettes"],
        "scale": dump["scale"],
        "standardHeroDims": {"w": std_dims[0], "h": std_dims[1]} if std_dims else None,
        "candidates": candidates,
        "counts": {
            "bossesDone": sum(1 for e in bosses if e["status"] == "bespoke"),
            "bossesTotal": len(bosses),
            "mobsBlob": sum(1 for e in mobs if e["status"] == "blob"),
            "mobsTotal": len(mobs),
            "heroesNonstandard": sum(1 for e in heroes if e["nonstandardSize"]),
        }
    }

    template_path = os.path.join(HERE, "template.html")
    template = open(template_path, encoding="utf-8").read()
    # Defensive: escape "<" so a stray "</script>" inside any authored string
    # (name/role/note text) can never break out of the inline <script> block.
    json_blob = json.dumps(payload).replace("<", "\\u003c")
    out = template.replace("__SPRITE_DATA_JSON__", json_blob)
    return out


def main():
    dump = run_dump()
    candidates = json.load(open(os.path.join(HERE, "candidates.json"), encoding="utf-8"))
    html = build_html(dump, candidates)
    out_path = os.path.join(REPO, "gridfall-sprite-review.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", out_path)
    print("bosses: %d/%d bespoke" % (
        sum(1 for e in dump["roster"] if e["tier"] == "boss" and e["status"] == "bespoke"),
        sum(1 for e in dump["roster"] if e["tier"] == "boss")))


if __name__ == "__main__":
    main()
