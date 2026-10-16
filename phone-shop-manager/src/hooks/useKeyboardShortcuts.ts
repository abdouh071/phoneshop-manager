import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

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
