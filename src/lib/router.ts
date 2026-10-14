import { useEffect, useState } from 'react';

// Hash routing keeps the app working on any static host (including GitHub Pages) without server settings.
const current = () => (location.hash.replace(/^#/, '') || '/');

export function useRoute(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => setPath(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export const navigate = (path: string): void => {
  location.hash = path;
};
