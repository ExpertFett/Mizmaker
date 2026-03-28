#!/usr/bin/env python3
"""
Pre-download SRTM HGT tiles for all DCS theater regions.
Run once before deployment so elevation lookups never hit the network.

Usage:
  cd backend && source venv/bin/activate && python scripts/prefetch_srtm.py
"""

import srtm
import sys

# Bounding boxes for each DCS theater [lat_min, lat_max, lon_min, lon_max]
THEATER_BOUNDS = {
    "Caucasus":        [41.0, 44.0, 38.0, 47.0],
    "PersianGulf":     [22.0, 28.0, 51.0, 60.0],
    "Syria":           [32.0, 38.0, 34.0, 42.0],
    "Nevada":          [34.0, 39.0, -119.0, -114.0],
    "SinaiMap":        [27.0, 32.0, 31.0, 36.0],
    "Normandy":        [48.0, 50.0, -3.0, 1.0],
    "TheChannel":      [49.0, 52.0, -1.0, 4.0],
    "MarianaIslands":  [13.0, 16.0, 143.0, 147.0],
    "Falklands":       [-53.0, -50.0, -62.0, -57.0],
    "Kola":            [67.0, 71.0, 28.0, 40.0],
    "Afghanistan":     [31.0, 37.0, 60.0, 70.0],
    "Iraq":            [30.0, 37.0, 40.0, 48.0],
    "TopEndAustralia": [-15.0, -10.0, 128.0, 137.0],
    "SouthEastAsia":   [10.0, 18.0, 100.0, 110.0],
    "GermanyCW":       [49.0, 54.0, 8.0, 15.0],
}

def prefetch():
    data = srtm.get_data()
    total = 0
    for theater, bounds in THEATER_BOUNDS.items():
        lat_min, lat_max, lon_min, lon_max = bounds
        # SRTM tiles are 1x1 degree — sample one point per tile
        count = 0
        for lat in range(int(lat_min), int(lat_max) + 1):
            for lon in range(int(lon_min), int(lon_max) + 1):
                try:
                    elev = data.get_elevation(lat + 0.5, lon + 0.5)
                    count += 1
                except Exception as e:
                    print(f"  Warning: {lat},{lon} — {e}")
        total += count
        print(f"  {theater}: {count} tiles cached")

    print(f"\nDone. {total} total SRTM tiles cached at ~/.cache/srtm/")


if __name__ == "__main__":
    print("Pre-fetching SRTM elevation data for all DCS theaters...\n")
    prefetch()
