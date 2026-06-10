/**
 * Tab icon set — preview pass, not yet committed.
 *
 * Single monochrome stroke-only SVG icon family for the editor's
 * left-rail tabs. Replaces the 24 emoji glyphs at MissionEditor.tsx:
 * 59-134 that the Fable design review flagged as the #1 "looks
 * AI-generated" tell.
 *
 * Design rules:
 *   - 16×16 viewBox, 1.6 stroke, currentColor only.
 *   - No fills. Stroke-linecap=round / linejoin=round.
 *   - Chart / instrument idiom — no cute illustrations.
 *   - Distinguishable at 14px next to a 13px text label, since
 *     that's the actual size in the sidebar.
 *
 * Naming mirrors the existing tab keys so the swap is mechanical.
 */

import type { CSSProperties } from 'react';

type IconProps = { size?: number; style?: CSSProperties };

const base = (props: IconProps): CSSProperties => ({
  display: 'inline-block',
  verticalAlign: '-2px',
  ...props.style,
});

function Svg({ size = 16, children, style }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={base({ style })}
    >
      {children}
    </svg>
  );
}

// ── Setup section ────────────────────────────────────────────────────────

export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4 L6 2 L10 4 L14 2 V12 L10 14 L6 12 L2 14 Z" />
    <path d="M6 2 V12 M10 4 V14" />
  </Svg>
);

export const SopIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 2 H10 L13 5 V14 H3 Z" />
    <path d="M10 2 V5 H13" />
    <path d="M5 8 H11 M5 10.5 H11" />
  </Svg>
);

export const CoalitionsIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Two opposing shields */}
    <path d="M3 3 V8 Q3 11 6 13 Q4 11 4 8 V3 Z" />
    <path d="M13 3 V8 Q13 11 10 13 Q12 11 12 8 V3 Z" />
  </Svg>
);

export const MissionIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Bullseye */}
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="3.2" />
    <circle cx="8" cy="8" r="0.6" />
  </Svg>
);

export const GoalsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M5 8 L7 10 L11 6" />
  </Svg>
);

export const WeatherIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Wind arrow — meteorological barb */}
    <path d="M2 11 L14 11" />
    <path d="M11 8 L14 11 L11 14" />
    <path d="M5 4 L5 11" />
    <path d="M5 4 L8 5" />
    <path d="M5 7 L7 8" />
  </Svg>
);

// ── Entities section ─────────────────────────────────────────────────────

export const ScriptsIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Curly-brace pair — generic "code" */}
    <path d="M6 2 Q3 2 3 5 V7 Q3 8 2 8 Q3 8 3 9 V11 Q3 14 6 14" />
    <path d="M10 2 Q13 2 13 5 V7 Q13 8 14 8 Q13 8 13 9 V11 Q13 14 10 14" />
  </Svg>
);

export const TriggersIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Lightning bolt */}
    <path d="M9 1 L4 9 H8 L7 15 L12 7 H8 Z" />
  </Svg>
);

// ── Planning section ─────────────────────────────────────────────────────

export const ThreatsIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Warning triangle, stroke only */}
    <path d="M8 2 L14 13 H2 Z" />
    <path d="M8 6 V9" />
    <circle cx="8" cy="11.2" r="0.4" fill="currentColor" />
  </Svg>
);

export const DmpiIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Reticle / crosshair */}
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1 V4 M8 12 V15 M1 8 H4 M12 8 H15" />
  </Svg>
);

export const JtacIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Binoculars stylised — two circles linked */}
    <circle cx="4" cy="10" r="2.6" />
    <circle cx="12" cy="10" r="2.6" />
    <path d="M6.6 9 H9.4" />
    <path d="M3 5 L4.5 7.5 M13 5 L11.5 7.5" />
  </Svg>
);

// ── Flights section ──────────────────────────────────────────────────────

export const RosterIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Stack of pilot silhouettes — two heads + shoulders */}
    <circle cx="5.5" cy="5" r="1.8" />
    <path d="M2 12 Q5.5 8 9 12" />
    <circle cx="11" cy="6" r="1.4" />
    <path d="M8.5 13 Q11 10 14 13" />
  </Svg>
);

export const LoadoutIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Bomb / ordnance silhouette */}
    <path d="M5 11 Q5 5 8 5 Q11 5 11 11 Q11 14 8 14 Q5 14 5 11 Z" />
    <path d="M8 5 V2" />
    <path d="M6.5 3 L9.5 3" />
  </Svg>
);

export const DatalinkIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Broadcast — center dot + arcs */}
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <path d="M5.5 5.5 Q4.5 8 5.5 10.5" />
    <path d="M10.5 5.5 Q11.5 8 10.5 10.5" />
    <path d="M3.5 3.5 Q1.5 8 3.5 12.5" />
    <path d="M12.5 3.5 Q14.5 8 12.5 12.5" />
  </Svg>
);

export const RadioIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Waveform pulse */}
    <path d="M2 8 H4 L5 4 L7 12 L9 5 L11 11 L12 8 H14" />
  </Svg>
);

export const DtcIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Memory card / chip outline */}
    <path d="M4 2 H12 V14 H4 Z" />
    <path d="M6 2 V4 M8 2 V4 M10 2 V4" />
    <path d="M6 7 H10 M6 9 H10 M6 11 H10" />
  </Svg>
);

export const LiveryIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Aircraft top-down silhouette */}
    <path d="M8 1 L8 15" />
    <path d="M2 8 L14 8" />
    <path d="M6 11 L10 11" />
    <path d="M7 13 L9 13" />
  </Svg>
);

// ── Output section ───────────────────────────────────────────────────────

export const KneeboardIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Clipboard */}
    <path d="M4 3 H12 V14 H4 Z" />
    <path d="M6 2 H10 V4 H6 Z" />
    <path d="M6 7 H10 M6 9 H10 M6 11 H8" />
  </Svg>
);

export const BriefIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Presentation board on stand */}
    <path d="M2 3 H14 V11 H2 Z" />
    <path d="M5 11 L4 14 M11 11 L12 14" />
    <path d="M5 8 L7 6 L9 8 L12 5" />
  </Svg>
);

export const EditsIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Pencil — underline-with-tip */}
    <path d="M3 13 L13 3" />
    <path d="M11 1 L15 5 L13 7 L9 3 Z" />
    <path d="M2 14 L4 12" />
  </Svg>
);

// ── Mission maker section ────────────────────────────────────────────────

export const VisibilityIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Eye outline */}
    <path d="M1 8 Q4 4 8 4 Q12 4 15 8 Q12 12 8 12 Q4 12 1 8 Z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);

// ── Util section ─────────────────────────────────────────────────────────

export const DebugIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Insect-like — body + legs */}
    <path d="M5 6 Q5 4 8 4 Q11 4 11 6 V11 Q11 13 8 13 Q5 13 5 11 Z" />
    <path d="M3 5 L5 7 M13 5 L11 7" />
    <path d="M2 9 L5 9 M14 9 L11 9" />
    <path d="M3 13 L5 11 M13 13 L11 11" />
  </Svg>
);

export const ToolsIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Wrench */}
    <path d="M11 2 L14 5 L12 7 L10 5 Z" />
    <path d="M10 7 L4 13 L2 14 L3 12 L9 6" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Inbox arrow-up */}
    <path d="M3 8 L8 3 L13 8" />
    <path d="M8 3 V12" />
    <path d="M2 14 H14" />
  </Svg>
);
