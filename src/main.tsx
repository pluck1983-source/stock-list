import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Earlier versions kept photos on the device; there are none now, so free that space.
try {
  indexedDB.deleteDatabase('stocklist-photos');
} catch {
  // Storage blocked - nothing to clear.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

