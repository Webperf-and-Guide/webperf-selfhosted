import type { OperatorTone } from '../types';

export function metricToneClass(tone: OperatorTone | undefined) {
  switch (tone) {
    case 'success':
      return 'border-success/25 bg-success/8';
    case 'warning':
      return 'border-accent/30 bg-accent/8';
    case 'danger':
      return 'border-danger/25 bg-danger/8';
    case 'accent':
      return 'border-accent/25 bg-accent/6';
    case 'muted':
      return 'border-line/50 bg-white/[0.028]';
    default:
      return 'border-line/55 bg-white/[0.018]';
  }
}

export function badgeTone(tone: OperatorTone | undefined): 'muted' | 'accent' | 'success' | 'danger' {
  switch (tone) {
    case 'success':
      return 'success';
    case 'danger':
      return 'danger';
    case 'warning':
    case 'accent':
      return 'accent';
    default:
      return 'muted';
  }
}
