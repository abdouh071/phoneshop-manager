import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivacyStore } from '../store/privacyStore';
import { usePosDensityStore } from '../store/posDensityStore';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Alt + P (or Option + P on Mac) to toggle Privacy Curtain Mode instantly
      if (e.altKey && (e.key.toLowerCase() === 'p' || e.code === 'KeyP')) {
        e.preventDefault();
        usePrivacyStore.getState().togglePrivacy();
        return;
      }

      // Alt + D (or Option + D on Mac) to cycle POS Layout Density (Compact / Standard / Touch)
      if (e.altKey && (e.key.toLowerCase() === 'd' || e.code === 'KeyD')) {
        e.preventDefault();
        usePosDensityStore.getState().cycleDensity();
        return;
      }

      // Alt + L (or Option + L on Mac) to trigger Quick Logout / Lock
      if (e.altKey && (e.key.toLowerCase() === 'l' || e.code === 'KeyL')) {
        e.preventDefault();
        const logoutBtn = document.querySelector<HTMLElement>('[data-logout-trigger]');
        if (logoutBtn) {
          logoutBtn.click();
        }
        return;
      }

      // Ctrl / Cmd + K or "/" to focus primary search input on current page
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="Search" i], input[placeholder*="search" i], input[data-search-input]'
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // If user is already typing inside an input/textarea, do not intercept function keys
      if (isInputFocused) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      // F-Keys navigation shortcuts for counter operations
      if (e.key === 'F1') {
        e.preventDefault();
        navigate('/pos');
      } else if (e.key === 'F2') {
        e.preventDefault();
        navigate('/repairs');
      } else if (e.key === 'F3') {
        e.preventDefault();
        navigate('/inventory');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}
