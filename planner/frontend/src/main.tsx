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
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
