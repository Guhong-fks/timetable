/**
 * Course card color palette + name-hash hue.
 *
 * Single source of truth shared by the grid renderer (index.tsx) and the
 * course editor (CourseEditModal.tsx) — they used to carry duplicate copies
 * that had to be kept "in sync manually".
 *
 * 8 hues keep same-day collisions rare and stay readable over both light and
 * dark backgrounds.
 */
export const COURSE_PALETTE = [
  '#4A90D9', // blue
  '#5BAE6E', // green
  '#E0913C', // orange
  '#9B6FD4', // purple
  '#D96A9C', // pink
  '#42AFA5', // teal
  '#C9A227', // gold
  '#6C7BD9', // indigo
] as const;

/** Deterministic name-hash hue: the same course keeps one stable color
 * across renders/restarts, and the same course on different days shares
 * its hue. */
export function courseHue(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_PALETTE[hash % COURSE_PALETTE.length];
}

/** '#RRGGBB' + alpha -> 'rgba(...)' — works on every RN version. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
