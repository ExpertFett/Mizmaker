/**
 * Floating "?" Help button — opens the full GuidePanel overlay.
 *
 * Sibling of DiscordButton (App.tsx renders both at root). Sits just
 * above the Discord button so the bottom-right corner has a small
 * stack: Help / Discord. Same boxy look, smaller footprint since it's
 * a single glyph.
 *
 * Disambiguation: clicking opens the in-app multi-page walkthrough; for
 * tool-specific tooltips, hover the tool icon itself. The guide also
 * opens via `?guide=1` on any URL or a hash anchor like `#live-overview`.
 */

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Open the DCS:OPT guide (also accessible via ?guide=1 in the URL)"
      style={{
        position: 'fixed',
        bottom: 72,   // sits above the 16+~40 footprint of the Discord button
        right: 16,
        zIndex: 900,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: '#243349',
        color: '#ffd24a',
        border: '1px solid #3a6ea5',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.45)',
        fontSize: 20,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: "'B612', system-ui, sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      ?
    </button>
  );
}
