import type { CSSProperties } from 'react';
export default function ThemeArt({
  category,
  className = '',
  variant = 'tile',
  source,
}: {
  category: number;
  className?: string;
  variant?: 'tile' | 'banner';
  source?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={'theme-art ' + (variant === 'banner' ? 'theme-banner ' : '') + className}
      style={
        {
          ...(source
            ? {
                backgroundImage: `url("${new URL('./assets/' + source, window.location.href).href}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}),
          '--art-x': `${(category % 3) * 50}%`,
          '--art-y': `${Math.floor(category / 3) * 50}%`,
          ...(variant === 'banner'
            ? Object.fromEntries(
                [
                  'day',
                  'night',
                  'summer',
                  'autumn',
                  'winter',
                  'festive',
                  'tech',
                  'astral',
                  'marble',
                ].map((theme) => [
                  '--banner-' + theme,
                  `url("${new URL('./assets/' + (category === 0 && ['festive', 'tech', 'astral', 'marble'].includes(theme) ? 'welcome-' + theme + '.webp' : theme === 'autumn' && category === 0 ? 'welcome-autumn.png' : 'banner-' + theme + '-' + category + '.webp'), window.location.href).href}")`,
                ]),
              )
            : {}),
        } as CSSProperties
      }
    />
  );
}
