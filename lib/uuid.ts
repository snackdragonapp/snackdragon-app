/**
 * Generate a random UUID v4.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts) and falls back
 * to a `crypto.getRandomValues()` implementation for non-secure contexts
 * (e.g. HTTP on mobile).
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // crypto.getRandomValues is available in all contexts (including non-secure)
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
  );
}
