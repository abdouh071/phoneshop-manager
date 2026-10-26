import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';

// Globally disable browser auto-correction, spellcheck, and auto-capitalization across all inputs
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
    }
  }, true);
}

// Auto-recover when a newer app version is deployed and older chunks fail to load
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[Vite] Newer deployment detected; auto-reloading stale chunk:', event);
    const lastReload = Number(sessionStorage.getItem('last_chunk_reload_ts') || 0);
    const now = Date.now();
    if (now - lastReload > 8000) {
      sessionStorage.setItem('last_chunk_reload_ts', String(now));
      window.location.reload();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event?.message?.toLowerCase() || '';
    if (
      msg.includes('is not a valid javascript mime type') ||
      msg.includes('failed to fetch dynamically imported') ||
      msg.includes('error loading dynamically imported')
    ) {
      const lastReload = Number(sessionStorage.getItem('last_chunk_reload_ts') || 0);
      const now = Date.now();
      if (now - lastReload > 8000) {
        sessionStorage.setItem('last_chunk_reload_ts', String(now));
        window.location.reload();
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
