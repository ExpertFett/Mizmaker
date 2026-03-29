#!/bin/bash
set -e

SRTM_CACHE="/root/.cache/srtm"

# SRTM tiles download on-demand when users query elevation.
# Optional: prefetch all DCS theaters on first run (takes 10-20 min).
# Set PREFETCH_SRTM=1 to enable, otherwise tiles load lazily.
if [ "${PREFETCH_SRTM}" = "1" ]; then
    if [ ! -d "$SRTM_CACHE" ] || [ -z "$(ls -A $SRTM_CACHE 2>/dev/null)" ]; then
        echo "Pre-fetching SRTM elevation data for DCS theaters (this takes a while)..."
        python scripts/prefetch_srtm.py
        echo "SRTM data cached."
    else
        echo "SRTM cache found ($(ls $SRTM_CACHE | wc -l) files). Skipping prefetch."
    fi
else
    echo "SRTM tiles will download on-demand as needed. Set PREFETCH_SRTM=1 to pre-fetch."
fi

exec gunicorn app:app --bind 0.0.0.0:8080 --workers 1 --threads 8 --timeout 120
