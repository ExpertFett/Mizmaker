import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Reset default styles
const style = document.createElement('style');
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* Sharpen the visual language — no rounded corners anywhere by default.
     Override per-element with inline borderRadius if a curve is intentional
     (uses !important so the 300+ existing inline borderRadius styles flatten
     to square corners without touching every file). */
  *, *::before, *::after { border-radius: 0 !important; }
  html { font-size: 15px; }
  body {
    overflow: hidden;
    font-size: 15px;
    /* Carrier-light theme background — prevents a white flash during
       app boot and matches the editor chrome behind the scrollbar
       track. See theme/dark-grey-backup.md for the prior dark-theme
       palette + revert instructions. */
    background: #7a8a92;
    color: #1a1f25;
    /* B612 = Airbus cockpit display font; falls back through technical
       sans options before generic. */
    font-family: 'B612', 'IBM Plex Sans', 'Inter', system-ui, -apple-system, sans-serif;
    /* Slightly tighter tracking reads more "instrument panel". */
    letter-spacing: 0.005em;
  }
  /* Tabular data — coords, frequencies, channel numbers — stays mono. */
  pre, code, kbd, samp { font-family: 'B612 Mono', 'Consolas', monospace; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #8c9ba2; }
  ::-webkit-scrollbar-thumb { background: #4a5258; }
  input, select, button, textarea { font-size: inherit; font-family: inherit; }
  input:focus, select:focus { outline: 1px solid #d49a30; }
  /* Hide number input spinners (the up/down arrows) */
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
`;
document.head.appendChild(style);

// Prevent scroll from interacting with any focused input or select
document.addEventListener('wheel', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
    target.blur();
  }
}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
