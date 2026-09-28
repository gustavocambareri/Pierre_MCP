import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

console.log('[Pierre] Mounting app...');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.log('[Pierre] App mounted');
} else {
  console.error('[Pierre] No #root element found');
}
