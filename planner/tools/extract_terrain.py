"""
Extract road/rail networks from a local DCS World install into static
per-theater overlay data for the planner map.

DCS ships each terrain's road network in Mods/terrains/<T>/roads/<Name>.rn4
(binary, `landscape4::lRoadNetwork`). The format is undocumented; this reads
it the proven way — run-shape detection, not structure walking:

  * The file opens with a length-prefixed class-name table (primary, track,
    rail_main, ...) — read normally.
  * Every road segment record ends its header with a fixed tail we can anchor
    on:  u32 6 | u8 flags | u8 class | u32 nodeA | u32 nodeB | u32 0 |
    u32 count | count x Vec3<f64>(north, alt, east) | count | tangents...
  * We find candidate point arrays by scanning for runs of plausible f64s
    (finite, |v| < 2e6, nonzero) at 4-byte alignments, keep runs that look
    like coordinates (median |north| > 5 km — rejects the tangent arrays,
    which are unit vectors), then validate the header tail: count matches the
    run, altitudes sane, signature u32 == 6, class byte < class count.

  Validated on Kola (2026-08-23): 13,591 segments / 350k points, class
  histogram matching reality (primary+track dominant, ~1,070 rail segs);
  rejects are graph-node records and 2-3 point link stubs.

Output: planner/backend/data/terrain/<theater>.roads.json.gz
  {"theater": ..., "classes": [names...],
   "lines": [[classIdx, [[lat, lon], ...]], ...]}

Runs LOCALLY (needs the DCS install); the gz output is committed so Railway
can serve it without DCS. Usage:

  python tools/extract_terrain.py            # all installed theaters
  python tools/extract_terrain.py Kola       # one theater
"""
from __future__ import annotations

import glob
import gzip
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from services.projection import THEATERS, _get_transformers  # noqa: E402

DCS_ROOT = os.environ.get(
    "DCS_ROOT", r"C:\Program Files\Eagle Dynamics\DCS World")

# terrain dir name -> canonical theater key (as .miz files report it)
TERRAIN_DIRS = {
    "Afghanistan": "Afghanistan",
    "Caucasus": "Caucasus",
    "Falklands": "Falklands",
    "GermanyColdWar": "GermanyCW",
    "Iraq": "Iraq",
    "Kola": "Kola",
    "MarianaIslands": "MarianaIslands",
    "Nevada": "Nevada",
    "PersianGulf": "PersianGulf",
    "Sinai": "SinaiMap",
    "Syria": "Syria",
}

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "terrain")

COORD_BOUND = 2.0e6
ALT_LO, ALT_HI = -600.0, 4000.0

# Size budget per theater. Dense maps (GermanyCW models every village
# street) blow past what a browser vector layer can render and what the
# repo should carry, so settings escalate until the theater fits:
# coarser Douglas-Peucker, longer minimum chain length, and finally
# dropping the dirt-track network. Rails and major roads always survive.
MAX_POINTS = 700_000
SETTINGS_LADDER = [
    # (dp_tolerance_m, min_chain_len_m, drop_minor)
    (20.0, 60.0, False),
    (35.0, 300.0, False),
    (35.0, 300.0, True),
    (60.0, 600.0, True),
]
MAX_CHAIN_PTS = 4000      # cap merged-chain size (feature granularity)


def class_kind(name: str) -> str:
    """Render-kind for a terrain road class. Naming differs per map
    (Kola: primary/track/rail_main; Iraq: asphalt_2l/dirt_2l/rail_2l)."""
    n = name.lower()
    if "rail" in n or "tram" in n:
        return "rail"
    if "track" in n or "dirt" in n:
        return "track"
    return "road"


def read_class_table(buf: bytes) -> tuple[list[str], int]:
    name_len = struct.unpack_from("<I", buf, 0x20)[0]
    off = 0x24 + name_len
    count = struct.unpack_from("<I", buf, off + 4)[0]
    off += 8
    names = []
    for _ in range(count):
        ln = struct.unpack_from("<I", buf, off)[0]
        names.append(buf[off + 4:off + 4 + ln].decode("ascii"))
        off += 4 + ln
    return names, off


def scan_segments(buf: bytes, n_classes: int):
    """Yield (class_idx, points ndarray (k,3) as north/alt/east).

    Anchored scan on the record-tail signature (relative to anchor q):
      u32(q)=6 | u8 flags | u8 class | u32 nodeA | u32 nodeB | u32 0 |
      u32 count | count x Vec3<f64> | u32 count (again) | tangents...
    The repeated count after the points makes false positives vanishingly
    unlikely; no alignment assumption (string properties shift records to
    arbitrary byte offsets).
    """
    n = len(buf)
    u8 = np.frombuffer(buf, dtype=np.uint8)
    cand = np.where(
        (u8[:n - 22] == 6) & (u8[1:n - 21] == 0)
        & (u8[2:n - 20] == 0) & (u8[3:n - 19] == 0)
        & (u8[5:n - 17] < n_classes)                    # class byte
        & (u8[14:n - 8] == 0) & (u8[15:n - 7] == 0)     # zero u32
        & (u8[16:n - 6] == 0) & (u8[17:n - 5] == 0)
    )[0]
    for q in cand:
        count = struct.unpack_from("<I", buf, q + 18)[0]
        if not 2 <= count <= 200_000:
            continue
        p0 = q + 22
        p_end = p0 + count * 24
        if p_end + 4 > n:
            continue
        if struct.unpack_from("<I", buf, p_end)[0] != count:
            continue
        pts = np.frombuffer(buf, dtype="<f8", count=count * 3,
                            offset=p0).reshape(-1, 3)
        if not np.all(np.isfinite(pts)):
            continue
        if np.abs(pts[:, [0, 2]]).max() >= COORD_BOUND:
            continue
        if pts[:, 1].min() <= ALT_LO or pts[:, 1].max() >= ALT_HI:
            continue
        if np.median(np.abs(pts[:, 0])) < 5000:         # tangents, params
            continue
        steps = np.abs(np.diff(pts[:, [0, 2]], axis=0)).sum(axis=1)
        if len(steps) and steps.max() > 5000:
            continue
        node_a, node_b = struct.unpack_from("<II", buf, q + 6)
        yield int(u8[q + 5]), node_a, node_b, pts


def douglas_peucker(pts: np.ndarray, tol: float) -> np.ndarray:
    """Iterative DP on (k,2) meter coordinates; returns kept-point mask."""
    k = len(pts)
    keep = np.zeros(k, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, k - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        seg = pts[i + 1:j]
        v = pts[j] - pts[i]
        L = np.hypot(*v)
        rel = seg - pts[i]
        if L < 1e-9:
            dist = np.hypot(*rel.T)
        else:
            dist = np.abs(v[0] * rel[:, 1] - v[1] * rel[:, 0]) / L
        mx = int(np.argmax(dist))
        if dist[mx] > tol:
            mid = i + 1 + mx
            keep[mid] = True
            stack.append((i, mid))
            stack.append((mid, j))
    return keep


def merge_chains(segs: list[tuple[int, int, np.ndarray]]) -> list[np.ndarray]:
    """Merge same-class segments that meet at degree-2 graph nodes.

    The .rn4 stores one record per graph edge — a rural through-road is
    dozens of junction-to-junction pieces, and city grids are thousands of
    single-block fragments. Connectivity lives in the record's node IDs,
    not in coordinates: segment endpoints do NOT coincide geometrically
    (the polyline stops short of the junction), so we chain by node id and
    let the drawn line jump the few-meter junction gap. Merging restores
    real polylines, slashes per-feature overhead, and lets Douglas-Peucker
    simplify across former joints. Chains stop at real intersections
    (node degree != 2).
    """
    from collections import defaultdict

    adj: dict = defaultdict(list)
    for i, (na, nb, _pts) in enumerate(segs):
        adj[na].append(i)
        adj[nb].append(i)
    used = [False] * len(segs)
    chains: list[np.ndarray] = []

    def walk(i: int, from_start: bool) -> np.ndarray:
        na, nb, pts = segs[i]
        used[i] = True
        parts = [pts if from_start else pts[::-1]]
        node = nb if from_start else na
        total = len(pts)
        while True:
            if len(adj[node]) != 2 or total > MAX_CHAIN_PTS:
                break
            nxt = [j for j in adj[node] if not used[j]]
            if not nxt:
                break
            j = nxt[0]
            ja, jb, jp = segs[j]
            step = jp if ja == node else jp[::-1]
            # Junction gaps are real (roads stop short of the node) and
            # typically <300 m — bridge those. A rare huge gap would draw a
            # false straight connector, so end the chain there instead.
            tail = parts[-1][-1]
            if abs(tail[0] - step[0][0]) + abs(tail[2] - step[0][2]) > 400:
                break
            used[j] = True
            parts.append(step)
            node = jb if ja == node else ja
            total += len(jp)
        return np.vstack(parts)

    for i, (na, nb, _pts) in enumerate(segs):
        if used[i]:
            continue
        if len(adj[na]) != 2:
            chains.append(walk(i, True))
        elif len(adj[nb]) != 2:
            chains.append(walk(i, False))
    for i in range(len(segs)):        # leftovers are closed loops
        if not used[i]:
            chains.append(walk(i, True))
    return chains


def extract_theater(terrain_dir: str, theater: str) -> dict | None:
    roads = glob.glob(os.path.join(
        DCS_ROOT, "Mods", "terrains", terrain_dir, "roads", "*.rn4"))
    if not roads:
        print(f"  {terrain_dir}: no .rn4 — skipped")
        return None
    buf = open(roads[0], "rb").read()
    classes, _ = read_class_table(buf)
    to_ll, _ = _get_transformers(theater)

    by_class: dict[int, list[tuple[int, int, np.ndarray]]] = {}
    pts_in = 0
    for cls, node_a, node_b, pts in scan_segments(buf, len(classes)):
        by_class.setdefault(cls, []).append((node_a, node_b, pts))
        pts_in += len(pts)
    seg_count = sum(len(v) for v in by_class.values())

    merged: list[tuple[int, np.ndarray]] = []
    for cls, segs in by_class.items():
        for chain in merge_chains(segs):
            merged.append((cls, chain[:, [0, 2]]))   # north, east — meters

    for tol, min_len, drop_minor in SETTINGS_LADDER:
        lines = []
        pts_out = 0
        for cls, xy in merged:
            if drop_minor and class_kind(classes[cls]) == "track":
                continue
            if len(xy) > 2:
                kept = xy[douglas_peucker(xy, tol)]
            else:
                kept = xy
            if np.hypot(*np.diff(kept, axis=0).T).sum() < min_len:
                continue
            pts_out += len(kept)
            lines.append((cls, kept))
        if pts_out <= MAX_POINTS:
            break

    out_lines = []
    for cls, kept in lines:
        lat, lon = to_ll.transform(kept[:, 0], kept[:, 1])
        out_lines.append([int(cls), np.round(
            np.column_stack([lat, lon]), 5).tolist()])

    print(f"  {terrain_dir} -> {theater}: {seg_count:,} segs / {pts_in:,} pts "
          f"-> merged {len(merged):,} chains -> kept {len(out_lines):,} "
          f"chains / {pts_out:,} pts (tol={tol}m min={min_len}m "
          f"dropTracks={drop_minor})")
    return {"theater": theater, "classes": classes, "lines": out_lines}


def main() -> None:
    only = set(sys.argv[1:])
    os.makedirs(OUT_DIR, exist_ok=True)
    for terrain_dir, theater in TERRAIN_DIRS.items():
        if only and theater not in only and terrain_dir not in only:
            continue
        if theater not in THEATERS:
            print(f"  {terrain_dir}: no projection params — skipped")
            continue
        data = extract_theater(terrain_dir, theater)
        if data is None:
            continue
        out = os.path.join(OUT_DIR, f"{theater}.roads.json.gz")
        raw = json.dumps(data, separators=(",", ":")).encode()
        with gzip.open(out, "wb", compresslevel=9) as f:
            f.write(raw)
        print(f"    wrote {out} ({os.path.getsize(out):,} B gz, {len(raw):,} raw)")


if __name__ == "__main__":
    main()
