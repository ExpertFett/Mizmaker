import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Reset default styles
const style = document.createElement('style');
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { overflow: hidden; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0a1520; }
  ::-webkit-scrollbar-thumb { background: #1a3a5a; border-radius: 3px; }
  input:focus, select:focus { outline: 1px solid #4a8fd4; }
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
