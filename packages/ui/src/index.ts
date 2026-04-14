export const brandPalette = {
  canvas: '#08111a',
  surface: 'rgba(10, 20, 32, 0.78)',
  surfaceStrong: 'rgba(7, 15, 24, 0.92)',
  accent: '#ff784f',
  accentSoft: '#ffc7b1',
  text: '#f6f4ef',
  muted: '#adc0cf',
  line: 'rgba(173, 192, 207, 0.16)'
} as const;

export const shellLinks = [
  { href: '#measure', label: 'Measure' },
  { href: '#regions', label: 'Regions' },
  { href: '#results', label: 'Results' },
  { href: '/api/control/health', label: 'Control Health' }
] as const;
