/**
 * SampleCoversGallery — picker of public-domain / CC0 imagery for the
 * Brief cover slot, Upload-page hero, or any other spot that takes an
 * image and shouldn't burden the user with sourcing.
 *
 * Data: GET /api/sample_covers returns {covers: [{id, title, category,
 * thumbnailUrl, fullUrl, attribution, source}, ...]}. The backend
 * manifest lives at data/sample_covers.json and only carries entries
 * verified PD or CC0 (DOD / NASA / USGS / Wikimedia CC0).
 *
 * UX:
 *   - Grid of clickable thumbnails. Click → fetch the full image as a
 *     Blob, hand it back via onPick(blob, label).
 *   - Each tile shows the title + attribution chip so the licensing is
 *     visible at pick time, not hidden in a tooltip.
 *   - Broken thumbnails hide silently — a stale URL doesn't crash the
 *     whole gallery.
 *   - When the manifest is empty, the gallery prints a clear "no
 *     samples available yet" line so callers don't render an empty box.
 *
 * Use site:
 *   - Brief cover slot — replace the file input with this gallery as
 *     the primary path, file input as the fallback.
 *   - Upload page hero — same gallery, mounts when the user clicks
 *     "use a sample background".
 *
 * v1.19.35
 */

import { useEffect, useState } from 'react';

interface Cover {
  id: string;
  title: string;
  category: string;          // 'hornet' / 'carrier' / 'strike' / 'theater' / ...
  thumbnailUrl: string;
  fullUrl: string;
  attribution: string;       // "US Navy photo / Public Domain"
  source: string;            // origin URL for traceability
}

interface Props {
  /** Filter to a single category. Omit to show everything. */
  category?: string;
  /** Receives the picked image as a Blob + a short label derived from
   *  the cover's title (used as the default filename / alt text). */
  onPick: (blob: Blob, label: string, attribution: string) => void;
  /** Optional cap so the grid doesn't render 200 tiles when the
   *  manifest grows. Default 24. */
  limit?: number;
}

export function SampleCoversGallery({ category, onPick, limit = 24 }: Props) {
  const [covers, setCovers] = useState<Cover[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  // Track which thumbnails have failed to load so we can fade them
  // out — broken-image icons are uglier than a missing tile.
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/sample_covers');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setCovers((j.covers as Cover[]) || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = covers
    .filter((c) => !category || c.category === category)
    .filter((c) => !broken.has(c.id))
    .slice(0, limit);

  const handlePick = async (c: Cover) => {
    setPickingId(c.id);
    try {
      const r = await fetch(c.fullUrl, { mode: 'cors' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      onPick(blob, c.title, c.attribution);
    } catch (e) {
      // Browser blocked the cross-origin fetch — most likely the host
      // lacks CORS headers. Surface a hint and mark the entry broken
      // so the user can pick another.
      setBroken((prev) => new Set(prev).add(c.id));
      setErr(`${c.title}: ${e instanceof Error ? e.message : 'fetch blocked'}`);
    } finally {
      setPickingId(null);
    }
  };

  if (loading) return <div style={pad}>Loading sample images…</div>;

  if (filtered.length === 0) {
    return (
      <div style={{ ...pad, color: '#888', fontSize: 12 }}>
        No sample {category ? `${category} ` : ''}images yet — the
        manifest at <code style={mono}>data/sample_covers.json</code> is
        empty or pending verified entries. Upload your own image instead.
        {err && <div style={{ marginTop: 4, color: '#e0554f' }}>{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {filtered.map((c) => {
          const busy = pickingId === c.id;
          return (
            <button key={c.id}
                    onClick={() => handlePick(c)} disabled={busy}
                    title={`${c.title}\n${c.attribution}`}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                      gap: 4, padding: 6, background: '#1a1a1a',
                      border: `1px solid ${busy ? '#4a8fd4' : '#3a3a3a'}`, borderRadius: 4,
                      cursor: busy ? 'wait' : 'pointer', textAlign: 'left',
                      fontFamily: 'inherit', color: '#e0e0e0', overflow: 'hidden',
                    }}>
              <img src={c.thumbnailUrl} alt={c.title}
                   loading="lazy"
                   onError={() => setBroken((prev) => new Set(prev).add(c.id))}
                   style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 2, background: '#0d0d0d' }} />
              <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title}
              </div>
              <div style={{ fontSize: 9, color: '#888', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.attribution}
              </div>
            </button>
          );
        })}
      </div>
      {err && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#e0554f' }}>{err}</div>
      )}
    </div>
  );
}

const pad: React.CSSProperties = { padding: '12px 16px' };
const mono: React.CSSProperties = { fontFamily: "'B612 Mono', monospace", fontSize: 11, color: '#cfe6ff' };
