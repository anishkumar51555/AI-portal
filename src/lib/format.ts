/**
 * Display formatting helpers. Pure — no React, no server imports, so these are
 * safe in both Server and Client Components.
 */

const UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * Human-readable byte size.
 *
 * Uses 1024 rather than 1000 because these are file sizes, and every OS file
 * browser the user compares against does the same.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // One decimal below 10 (9.4 MB), none above (24 MB) — enough precision to be
  // useful without implying accuracy that does not matter here.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}
