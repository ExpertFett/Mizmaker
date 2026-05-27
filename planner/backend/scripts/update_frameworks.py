#!/usr/bin/env python3
"""
Update the bundled DCS scripting frameworks (MOOSE, MIST) from upstream.

The editor's Scripts library embeds these .lua files into a downloaded .miz
(see services/miz_editor.py). Railway's filesystem is ephemeral and rebuilt
from git on every deploy, so the canonical copies live in the repo at
planner/backend/assets/scripts/. Keeping them current means updating those
committed files — this script does exactly that, then you review the diff,
commit, and push (or let the scheduled GitHub Action open a PR for you).

Sources (verified):
  MOOSE — FlightControl-Master/MOOSE GitHub *release* asset `Moose_.lua`
          (the standalone single-file build; the release tag is the version).
  MIST  — mrSkortch/MissionScriptingTools raw `master/mist.lua`
          (releases only ship a .rar; the repo source is the canonical .lua).
          Version comes from mist.majorVersion/minorVersion/build in the file.

Usage:
  cd backend && python scripts/update_frameworks.py            # download + write
  cd backend && python scripts/update_frameworks.py --check    # report only, no writes
  cd backend && python scripts/update_frameworks.py --only MIST

Pure stdlib (urllib/json) — no extra dependencies. Each framework is handled
independently; a failure on one is reported but does not abort the others.
Exit code: 0 = success (even if already current); 1 = a fetch/parse failed.
"""

import argparse
import json
import os
import re
import sys
import urllib.request

ASSET_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "assets", "scripts"))
_UA = {"User-Agent": "mizmaker-framework-updater", "Accept": "application/vnd.github+json"}
_TIMEOUT = 60


def _http_get(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": _UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return r.read()


def _gh_latest_release(repo: str) -> dict:
    """GET the latest release JSON for owner/name."""
    data = _http_get(f"https://api.github.com/repos/{repo}/releases/latest", _UA)
    return json.loads(data.decode("utf-8"))


def _moose_version(content: bytes) -> str:
    """MOOSE banner: '*** MOOSE GITHUB Commit Hash ID: <date>-<hash> ***'."""
    m = re.search(rb"MOOSE GITHUB Commit Hash ID:\s*([^\s*]+)", content[:2000])
    return m.group(1).decode("latin1") if m else "?"


def _mist_version(content: bytes) -> str:
    head = content[:4000]
    maj = re.search(rb"mist\.majorVersion\s*=\s*(\d+)", head)
    minr = re.search(rb"mist\.minorVersion\s*=\s*(\d+)", head)
    bld = re.search(rb"mist\.build\s*=\s*(\d+)", head)
    if maj and minr and bld:
        return f"{maj.group(1).decode()}.{minr.group(1).decode()}.{bld.group(1).decode()}"
    return "?"


# Per-framework config. resolve() -> (latest_tag, download_url); version() reads
# a human version string out of the .lua content (for the report).
FRAMEWORKS = {
    "MOOSE": {
        "filename": "Moose_.lua",
        "version": _moose_version,
        "resolve": lambda: _moose_resolve(),
        "repo": "FlightControl-Master/MOOSE",
    },
    "MIST": {
        "filename": "mist.lua",
        "version": _mist_version,
        "resolve": lambda: _mist_resolve(),
        "repo": "mrSkortch/MissionScriptingTools",
    },
}


def _moose_resolve():
    rel = _gh_latest_release("FlightControl-Master/MOOSE")
    tag = rel.get("tag_name", "?")
    url = next((a["browser_download_url"] for a in rel.get("assets", [])
                if a.get("name") == "Moose_.lua"), None)
    if not url:
        raise RuntimeError("release has no Moose_.lua asset")
    return tag, url


def _mist_resolve():
    # Releases only ship a .rar; the raw repo source is the canonical .lua.
    tag = "?"
    try:
        tag = _gh_latest_release("mrSkortch/MissionScriptingTools").get("tag_name", "?")
    except Exception:
        pass  # tag is cosmetic; the raw file carries its own version fields
    return tag, "https://raw.githubusercontent.com/mrSkortch/MissionScriptingTools/master/mist.lua"


def update_one(name: str, cfg: dict, check: bool) -> bool:
    """Returns True on success (including 'already current'), False on failure."""
    path = os.path.join(ASSET_DIR, cfg["filename"])
    have = b""
    if os.path.exists(path):
        with open(path, "rb") as f:
            have = f.read()
    old_ver = cfg["version"](have) if have else "(not bundled)"

    try:
        tag, url = cfg["resolve"]()
        new = _http_get(url)
    except Exception as e:
        print(f"  [X] {name}: fetch failed - {e}")
        return False
    if not new or len(new) < 1000:
        print(f"  [X] {name}: download looked empty ({len(new)} bytes)")
        return False

    new_ver = cfg["version"](new)
    changed = new != have
    label = f"{name} ({cfg['filename']})"
    if not changed:
        print(f"  [OK] {label}: up to date - {old_ver} (release {tag})")
        return True
    if check:
        print(f"  [UPDATE] {label}: {old_ver} -> {new_ver} (release {tag}, {len(new)//1024} KB) [--check, not written]")
        return True

    with open(path, "wb") as f:
        f.write(new)
    verb = "ADDED" if not have else "UPDATED"
    print(f"  [{verb}] {label}: {old_ver} -> {new_ver} (release {tag}, {len(new)//1024} KB)")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Update bundled DCS frameworks (MOOSE, MIST).")
    ap.add_argument("--check", action="store_true", help="report available updates without writing")
    ap.add_argument("--only", metavar="NAME", help="update only this framework (e.g. MOOSE, MIST)")
    args = ap.parse_args()

    names = [args.only.upper()] if args.only else list(FRAMEWORKS)
    unknown = [n for n in names if n not in FRAMEWORKS]
    if unknown:
        print(f"Unknown framework(s): {', '.join(unknown)}. Known: {', '.join(FRAMEWORKS)}")
        return 1

    print(("Checking" if args.check else "Updating") + f" frameworks in {ASSET_DIR}\n")
    ok = True
    for name in names:
        ok = update_one(name, FRAMEWORKS[name], args.check) and ok
    print("\nDone." + ("" if ok else " (one or more failed — see above)"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
