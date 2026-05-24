/**
 * Floating "Join Discord" button — community / feedback / support.
 *
 * Rendered once at the app root (App.tsx) so it's visible on every screen:
 * landing page, upload, and the mission editor. Fixed bottom-right, below
 * modal overlays (z-index 900 < the 1000 used by AiSettingsPanel) so a modal
 * still covers it. Opens the invite in a new tab.
 */

const DISCORD_INVITE = 'https://discord.gg/C9qpA5FfrQ';

export function DiscordButton() {
  return (
    <a
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      title="Join the DCS:OPT Discord — feedback & support"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#5865F2',
        color: '#ffffff',
        textDecoration: 'none',
        padding: '10px 14px',
        fontSize: 14,
        fontWeight: 700,
        fontFamily: "'B612', system-ui, sans-serif",
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.45)',
        border: '1px solid #4a54d0',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
      </svg>
      Discord
    </a>
  );
}
