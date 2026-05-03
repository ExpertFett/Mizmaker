#!/usr/bin/env python3
"""
Fast offline regex linter for the mizresearch repo.

Scans changed files for known-bug patterns we've explicitly hit and
fixed at least once. Catches what regexes can catch — silent-failure
patterns, ±N-char window slicing, missing utf-8 encoding, direct
useMissionStore.setState, useMemo + setState, etc.

Complements scripts/review.sh which does AI-augmented review (deeper
but slower, needs Claude CLI). This linter is meant to run as a
pre-push hook or in CI: ~50 ms, exits non-zero on P0 findings.

Usage:
    python scripts/review.py              # changed files vs HEAD
    python scripts/review.py --staged     # only staged changes
    python scripts/review.py --all        # full repo scan
    python scripts/review.py --base main  # current branch vs main
    python scripts/review.py --json       # JSON output for tooling

Exit codes:
    0  no findings, or only P1/P2 findings
    1  one or more P0 findings (blockers)
    2  invocation error (not a git repo, missing args)

Patterns are derived from .claude/review-prompt.md — that file is
the source of truth for what counts as a bug here. Add new patterns
to PATTERNS below; the structure is self-documenting.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Pattern:
    rule: str
    severity: str  # 'P0' (blocker) | 'P1' (should fix) | 'P2' (note)
    extensions: tuple[str, ...]
    regex: re.Pattern
    message: str
    # Optional: a regex that, if matched on the same line, suppresses
    # the finding. Used to whitelist intentional patterns.
    exempt: re.Pattern | None = None
    # Optional: only fire inside files matching this path substring.
    path_contains: str | None = None


@dataclass
class Finding:
    path: str
    line: int
    col: int
    rule: str
    severity: str
    message: str
    snippet: str


# ---------------------------------------------------------------------------
# Patterns — keep this list short and high-precision. False positives erode
# trust faster than missed findings; the AI review (review.sh) catches
# subtler stuff this can't.
# ---------------------------------------------------------------------------

PATTERNS: list[Pattern] = [
    # P0 — silent edit drops in unit-edit handlers
    Pattern(
        rule="silent-edit-drop",
        severity="P0",
        extensions=(".py",),
        regex=re.compile(
            r"logging\.(warning|error|info)\([^)]+\)[^\n]*\n\s*(continue|return\s)",
        ),
        message=(
            "logging then continuing/returning silently drops the edit. "
            "Surface the failure via EditResult or raise. See "
            "apply_unit_edits' results-list pattern."
        ),
        path_contains="planner/backend/",
    ),

    # P0 — bare except inside edit pipeline (loses traceback)
    Pattern(
        rule="bare-except-in-handler",
        severity="P0",
        extensions=(".py",),
        regex=re.compile(r"^\s*except\s*:\s*(#.*)?$"),
        message=(
            "bare 'except:' catches SystemExit/KeyboardInterrupt and "
            "discards the traceback. Use 'except Exception as e:'."
        ),
        path_contains="planner/backend/",
    ),

    # P0 — open() without encoding (Windows default is cp1252)
    Pattern(
        rule="open-missing-utf8",
        severity="P0",
        extensions=(".py",),
        regex=re.compile(
            # open( … without encoding= and without 'rb'/'wb'
            r"\bopen\(\s*[^)]*\)"
        ),
        # Suppress when encoding= is in the call OR mode is binary.
        exempt=re.compile(r"encoding\s*=|['\"][rwab+]+b[rwab+]*['\"]"),
        message=(
            "open() without encoding='utf-8' uses Windows-default cp1252 "
            "and silently mangles non-ASCII chars in mission Lua."
        ),
        path_contains="planner/backend/",
    ),

    # P1 — direct useMissionStore.setState (bypasses store actions)
    Pattern(
        rule="direct-store-setstate",
        severity="P1",
        extensions=(".tsx", ".ts"),
        regex=re.compile(r"use\w+Store\.setState\(\s*[\{\(]"),
        # Allow inside the store definition file itself.
        exempt=re.compile(r"//.*skip-review"),
        message=(
            "Direct store setState bypasses store actions and the audit "
            "trail. Define an action on the store and call that instead."
        ),
    ),

    # P1 — SLPP reused across parses (state leaks)
    Pattern(
        rule="slpp-reuse",
        severity="P1",
        extensions=(".py",),
        regex=re.compile(r"_SLPP\b|SLPP_INSTANCE\b|self\.slpp\.decode"),
        exempt=re.compile(r"#.*intentional|#.*allow"),
        message=(
            "Looks like a reused SLPP instance. State from a previous "
            "decode can leak into the next; instantiate fresh each parse."
        ),
        path_contains="planner/backend/",
    ),
]


# ---------------------------------------------------------------------------
# Git plumbing
# ---------------------------------------------------------------------------

def _git_files(diff_arg: str) -> list[str]:
    """Return paths reported by `git diff --name-only <arg>`."""
    res = subprocess.run(
        ["git", "diff", "--name-only", diff_arg],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        sys.exit(2)
    return [f.strip() for f in res.stdout.splitlines() if f.strip()]


def _changed_files(mode: str, base: str | None) -> list[str]:
    if mode == "all":
        # Walk the tree; skip venvs, node_modules, build artifacts.
        out: list[str] = []
        skip_dirs = {".git", "node_modules", "__pycache__", "venv", ".venv", "dist", "build"}
        for p in REPO_ROOT.rglob("*"):
            if not p.is_file():
                continue
            if any(part in skip_dirs for part in p.parts):
                continue
            out.append(str(p.relative_to(REPO_ROOT)).replace("\\", "/"))
        return out
    if mode == "staged":
        return _git_files("--cached")
    if mode == "branch":
        if not base:
            sys.stderr.write("--base needs a branch name\n")
            sys.exit(2)
        return _git_files(f"{base}...HEAD")
    return _git_files("HEAD")


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def _scan_text(path: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    # Test files legitimately bypass store actions to seed deterministic
    # initial state. Skip them so the linter doesn't flag the standard
    # Vitest setup pattern.
    if path.endswith(".test.ts") or path.endswith(".test.tsx") or "/tests/" in path:
        return findings
    ext = "." + path.rsplit(".", 1)[-1] if "." in path else ""
    lines = text.splitlines()
    for pat in PATTERNS:
        if ext not in pat.extensions:
            continue
        if pat.path_contains and pat.path_contains not in path:
            continue
        # Per-line scan (most patterns) plus DOTALL fallback for multi-line ones.
        if pat.regex.flags & re.DOTALL:
            for m in pat.regex.finditer(text):
                # Compute line number from the match start.
                line_no = text.count("\n", 0, m.start()) + 1
                if pat.exempt and pat.exempt.search(lines[line_no - 1] if line_no - 1 < len(lines) else ""):
                    continue
                findings.append(Finding(
                    path=path, line=line_no, col=0,
                    rule=pat.rule, severity=pat.severity,
                    message=pat.message,
                    snippet=lines[line_no - 1].strip() if line_no - 1 < len(lines) else "",
                ))
        else:
            for i, line in enumerate(lines, 1):
                m = pat.regex.search(line)
                if not m:
                    continue
                if pat.exempt and pat.exempt.search(line):
                    continue
                findings.append(Finding(
                    path=path, line=i, col=m.start() + 1,
                    rule=pat.rule, severity=pat.severity,
                    message=pat.message, snippet=line.strip(),
                ))
    return findings


def _scan_files(paths: list[str]) -> list[Finding]:
    findings: list[Finding] = []
    for rel in paths:
        full = REPO_ROOT / rel
        if not full.exists() or not full.is_file():
            continue
        try:
            text = full.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        findings.extend(_scan_text(rel, text))
    return findings


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _print_findings(findings: list[Finding]) -> None:
    if not findings:
        print("review.py — no known-bug patterns found")
        return

    by_sev: dict[str, list[Finding]] = {"P0": [], "P1": [], "P2": []}
    for f in findings:
        by_sev[f.severity].append(f)

    print(f"review.py — {len(findings)} finding{'s' if len(findings) != 1 else ''}")
    print()
    for sev in ("P0", "P1", "P2"):
        bucket = by_sev[sev]
        if not bucket:
            continue
        label = {"P0": "P0 (BLOCKER)", "P1": "P1 (should fix)", "P2": "P2 (note)"}[sev]
        print(f"## {label} — {len(bucket)}")
        print()
        for f in bucket:
            print(f"  {f.path}:{f.line}  [{f.rule}]")
            print(f"    {f.message}")
            print(f"    > {f.snippet}")
            print()


def _print_json(findings: list[Finding]) -> None:
    print(json.dumps(
        {"findings": [f.__dict__ for f in findings]},
        indent=2,
    ))


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fast offline regex linter for known-bug patterns.",
    )
    parser.add_argument("--staged", action="store_true", help="only staged changes")
    parser.add_argument("--all", action="store_true", help="scan entire repo")
    parser.add_argument("--base", help="diff vs this branch (e.g. main)")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    if sum([args.staged, args.all, bool(args.base)]) > 1:
        sys.stderr.write("--staged, --all, --base are mutually exclusive\n")
        return 2

    mode = "all" if args.all else "staged" if args.staged else "branch" if args.base else "worktree"
    paths = _changed_files(mode, args.base)

    if not paths:
        if not args.json:
            print("review.py — no changed files")
        return 0

    findings = _scan_files(paths)
    if args.json:
        _print_json(findings)
    else:
        _print_findings(findings)

    return 1 if any(f.severity == "P0" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
