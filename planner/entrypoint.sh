#!/bin/bash
set -e

# Pre-fetch SRTM data only if cache is empty
SRTM_CACHE="/root/.cache/srtm"
if [ ! -d "$SRTM_CACHE" ] || [ -z "$(ls -A $SRTM_CACHE 2>/dev/null)" ]; then
    echo "First run — pre-fetching SRTM elevation data for DCS theaters..."
    python scripts/prefetch_srtm.py
    echo "SRTM data cached."
else
    echo "SRTM cache found ($(ls $SRTM_CACHE | wc -l) files). Skipping prefetch."
fi

exec gunicorn app:app --bind 0.0.0.0:8080 --workers 2 --threads 4 --timeout 120
