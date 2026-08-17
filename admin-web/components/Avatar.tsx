const AVATAR_TONES = [
  'bg-accent/15 text-accent',
  'bg-info-bg text-info-text',
  'bg-warning-bg text-warning-text',
  'bg-purple-50 text-purple-700',
  'bg-critical-bg text-critical-text',
];

function avatarTone(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** A consistent color per name (hashed, not random) so the same person's
 * initials circle looks the same everywhere it appears. */
export default function Avatar({ name, className = 'h-7 w-7 text-[11px]' }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('');
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${avatarTone(name)} ${className}`}>
      {initials || '?'}
    </span>
  );
}
