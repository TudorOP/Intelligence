export const coverColors = [
  ['Ivory', '#e8e3d6'],
  ['Slate', '#526170'],
  ['Charcoal', '#30343b'],
  ['Forest', '#355b49'],
  ['Sage', '#9bb59b'],
  ['Ocean', '#346b91'],
  ['Lavender', '#a398c4'],
  ['Plum', '#704a72'],
  ['Rose', '#c88691'],
  ['Terracotta', '#b76e50'],
] as const;
export const coverColor = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
