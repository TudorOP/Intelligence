import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Settings } from './types';
export default function AppBackground({ settings }: { settings: Settings }) {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)'),
      change = () => setDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  if (settings.decorativeBackgrounds === false) return null;
  const theme = settings.theme === 'system' ? (dark ? 'night' : 'day') : settings.theme;
  const choice =
    !settings.backgroundArtwork || settings.backgroundArtwork === 'theme'
      ? theme
      : settings.backgroundArtwork;
  const detailed = ['festive', 'tech', 'astral', 'marble'].includes(choice);
  const source =
    choice === 'custom'
      ? settings.backgroundImage
      : new URL(
          './assets/background-' + (detailed ? 'detail-' : '') + choice + '.webp',
          window.location.href,
        ).href;
  if (!source) return null;
  const blur = settings.backgroundBlur ?? 0;
  return (
    <div
      aria-hidden="true"
      className="app-background-art"
      style={
        {
          backgroundImage: `url("${source}")`,
          opacity: (settings.backgroundOpacity ?? 7) / 100,
          filter: blur > 0 ? `blur(${blur}px)` : 'none',
        } as CSSProperties
      }
    />
  );
}
