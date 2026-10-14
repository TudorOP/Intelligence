export const iconChoices = [
  { id: 'original', label: 'Original' },
  { id: 'prism', label: 'Prism' },
  { id: 'aurora', label: 'Aurora' },
] as const;
export function logoPath(style?: string) {
  return style === 'prism' || style === 'aurora'
    ? `./assets/icon-${style}.png`
    : './assets/intelligence-mark.png';
}
