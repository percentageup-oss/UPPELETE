/**
 * Deterministic JSON serialization: object keys sorted recursively, array order preserved. Used to hash a
 * `TextPlusClipSpec` (minus its own `hash` field) so 06's sync can tell an unchanged cue from one that needs
 * re-sending without re-sending everything every time.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** FNV-1a, 32-bit, hex-encoded. A cheap, stable change-detection hash — not cryptographic. */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
