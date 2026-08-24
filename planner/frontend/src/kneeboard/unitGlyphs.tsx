/**
 * Unit silhouettes for target imagery — oriented top-down shape glyphs.
 *
 * Real recon prints show unit SHAPES, not abstract markers: a tank reads
 * differently from a TEL or a fuel truck, and its facing matters to the
 * run-in. True-to-scale footprints are sub-pixel at chip zoom (a 7 m hull is
 * under 2 px on a 1.3 NM frame), so these draw at a fixed legible size,
 * rotated to the unit's actual mission heading — composition and facing are
 * real, size is not. The cards say so in their caption.
 *
 * Classification is keyword-based over DCS type strings ("SA-11 Buk LN
 * 9A310M1", "Ural-4320T"...). Unknown vehicles fall back to the truck
 * silhouette rather than vanishing.
 */

export type GlyphKind =
  | 'tank' | 'ifv' | 'artillery' | 'sam' | 'radar' | 'aaa'
  | 'truck' | 'infantry' | 'ship' | 'helo' | 'plane' | 'static';

const KW = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

export function classifyUnit(type: string, category: string): GlyphKind {
  const t = type.toLowerCase();
  if (category === 'ship') return 'ship';
  if (category === 'helicopter') return 'helo';
  if (category === 'plane') return 'plane';
  if (category === 'static') return 'static';

  // Radars before launchers — many SAM pieces carry both keywords and the
  // search/track piece is the one that matters visually.
  if (KW(t, 'ewr', 'radar', ' str', ' sr ', ' tr ', 'rls', '1l13', '55g6', 'dog ear', 'p-19', 'snr')
      || / (sr|tr|str)$/.test(t)) return 'radar';
  if (KW(t, 'sa-', 's-300', 's-200', 's300', 'buk', 'kub', 'osa', 'tor', 'strela', 'patriot',
          'hawk', 'nasams', 'roland', 'rapier', 'avenger', 'chaparral', 'linebacker',
          'hq-7', 'ln ', ' ln', 'launcher', 'tel')) return 'sam';
  if (KW(t, 'zsu', 'shilka', 'zu-23', 'vulcan', 'gepard', 'tunguska', '2s6', 'aaa',
          'flak', 'bofors', 'kdo', 's-60', 'gdu')) return 'aaa';
  if (KW(t, 'infantry', 'soldier', 'paratrooper', 'insurgent', 'manpads', 'stinger',
          'igla', 'rpg', 'mortar crew')) return 'infantry';
  if (KW(t, '2s1', '2s3', '2s9', '2s19', 'msta', 'm-109', 'm109', 'plz', 'spgh', 'dana',
          'grad', 'smerch', 'uragan', 'mlrs', 'm270', 'nona', 'gvozdika', 'akatsia',
          'howitzer', 'mortar', 'artillery')) return 'artillery';
  if (KW(t, 't-55', 't-72', 't-80', 't-90', 'm-1 ', 'm1a', 'abrams', 'leopard', 'leclerc',
          'challenger', 'merkava', 'chieftain', 'ztz', 'zbd', 'pt-76', 't55', 't72', 't80', 't90'))
    return 'tank';
  if (KW(t, 'bmp', 'btr', 'bmd', 'brdm', 'mtlb', 'mt-lb', 'marder', 'lav-', 'm-2 bradley',
          'bradley', 'stryker', 'warrior', 'aav', 'cobra', 'tpz', 'mcv')) return 'ifv';
  return 'truck';
}

/** Silhouette path data, nose-up (-y forward), centered on the origin.
 *  Each entry is a list of SVG sub-elements as [tag, attrs]. Sized ~16 px
 *  long for vehicles; ships and aircraft run larger. */
function glyphParts(kind: GlyphKind): [string, Record<string, string | number>][] {
  switch (kind) {
    case 'tank': return [
      ['rect', { x: -4.5, y: -7, width: 9, height: 14, rx: 2 }],
      ['circle', { cx: 0, cy: 0.5, r: 3 }],
      ['rect', { x: -0.7, y: -11, width: 1.4, height: 11 }],
    ];
    case 'ifv': return [
      ['rect', { x: -4, y: -7, width: 8, height: 14, rx: 3 }],
      ['circle', { cx: 0, cy: -2, r: 2.2 }],
      ['rect', { x: -0.5, y: -9.5, width: 1, height: 7 }],
    ];
    case 'artillery': return [
      ['rect', { x: -4, y: -6, width: 8, height: 13, rx: 2 }],
      ['rect', { x: -1, y: -13, width: 2, height: 13 }],
    ];
    case 'sam': return [
      ['rect', { x: -4, y: -7, width: 8, height: 14, rx: 2 }],
      ['rect', { x: -3.2, y: -10, width: 2.2, height: 12 }],
      ['rect', { x: 1, y: -10, width: 2.2, height: 12 }],
    ];
    case 'radar': return [
      ['rect', { x: -4, y: -3, width: 8, height: 9, rx: 2 }],
      ['path', { d: 'M0,-1 L-5.5,-9 A9.6,9.6 0 0 1 5.5,-9 Z' }],
    ];
    case 'aaa': return [
      ['circle', { cx: 0, cy: 1, r: 4 }],
      ['rect', { x: -2.2, y: -10, width: 1.2, height: 11 }],
      ['rect', { x: 1, y: -10, width: 1.2, height: 11 }],
    ];
    case 'truck': return [
      ['rect', { x: -3.5, y: -8, width: 7, height: 5, rx: 1.5 }],
      ['rect', { x: -4, y: -2, width: 8, height: 10, rx: 1 }],
    ];
    case 'infantry': return [
      ['circle', { cx: 0, cy: -2, r: 2.2 }],
      ['rect', { x: -3, y: 1, width: 6, height: 2, rx: 1 }],
    ];
    case 'ship': return [
      ['path', { d: 'M0,-15 L4.5,-6 L4.5,12 L-4.5,12 L-4.5,-6 Z' }],
      ['rect', { x: -2, y: -3, width: 4, height: 8, rx: 1 }],
    ];
    case 'helo': return [
      ['ellipse', { cx: 0, cy: 0, rx: 3, ry: 6.5 }],
      ['rect', { x: -0.7, y: 5, width: 1.4, height: 7 }],
      ['circle', { cx: 0, cy: -1, r: 8.5, fill: 'none', 'stroke-width': 1 }],
    ];
    case 'plane': return [
      ['path', { d: 'M0,-9 L1.6,-3 L8,2 L8,4 L1.3,2.5 L1,7 L3,9 L3,10.5 L0,9.6 L-3,10.5 L-3,9 L-1,7 L-1.3,2.5 L-8,4 L-8,2 L-1.6,-3 Z' }],
    ];
    case 'static': return [
      ['rect', { x: -5, y: -5, width: 10, height: 10 }],
    ];
  }
}

interface UnitGlyphProps {
  x: number;
  y: number;
  headingDeg?: number;
  kind: GlyphKind;
  color: string;
}

/** One oriented silhouette, with a white halo so it reads on the mono print. */
export function UnitGlyph({ x, y, headingDeg = 0, kind, color }: UnitGlyphProps) {
  const parts = glyphParts(kind);
  return (
    <g transform={`translate(${x}, ${y}) rotate(${headingDeg})`}
       style={{ filter: 'drop-shadow(0 0 1.2px rgba(255,255,255,0.95))' }}>
      {parts.map(([tag, attrs], i) => {
        const a: Record<string, string | number> = {
          fill: color, stroke: 'rgba(255,255,255,0.85)', strokeWidth: 0.6, ...attrs,
        };
        if (a.fill === 'none') { a.stroke = color; }
        const Tag = tag as 'rect';
        return <Tag key={i} {...(a as object)} />;
      })}
    </g>
  );
}
