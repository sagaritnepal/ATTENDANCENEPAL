// Mirrors admin-web/tailwind.config.ts exactly — the single source of truth
// for brand colors, kept in sync by hand since Tailwind's config isn't
// something React Native can import directly.
export const colors = {
  ink: '#0f172a',
  sidebar: '#0f172a',
  slate50: '#f8fafc',
  slate200: '#e2e8f0',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',

  accent: '#0d9488',
  accentLight: '#ccfbf1',

  good: '#0d9488',
  goodBg: '#ccfbf1',
  goodText: '#0f766e',

  warning: '#f97316',
  warningBg: '#ffedd5',
  warningText: '#c2410c',

  critical: '#ef4444',
  criticalBg: '#fee2e2',
  criticalText: '#b91c1c',

  info: '#2563eb',
  infoBg: '#dbeafe',
  infoText: '#1d4ed8',
};
