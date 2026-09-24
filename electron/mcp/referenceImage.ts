import path from 'node:path'

/**
 * Pure rules for the reference picture `match_color_to_reference` accepts (no Electron import, so they
 * are unit-testable). The picture is only ever decoded to derive a grade; its pixels are never
 * returned to the agent and the path is never opened for anything but reading an image.
 */
export type ReferenceMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp'

const MIME_BY_EXTENSION: Record<string, ReferenceMime> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}

/** Largest reference file main will read. A photo is a few MB; anything bigger is not a reference still. */
export const MAX_REFERENCE_BYTES = 25 * 1024 * 1024

export function referenceMimeForPath(filePath: string): ReferenceMime | null {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null
}

/** Throws a user-readable message when `filePath` is not an acceptable reference image path. */
export function assertReferencePath(filePath: string): ReferenceMime {
  if (!path.isAbsolute(filePath)) throw new Error('imagePath must be an absolute path to an image file.')
  const mime = referenceMimeForPath(filePath)
  if (!mime) throw new Error('imagePath must be a .png, .jpg, .jpeg, .webp, .gif or .bmp image.')
  return mime
}

export function assertReferenceSize(bytes: number): void {
  if (bytes <= 0) throw new Error('The reference image is empty.')
  if (bytes > MAX_REFERENCE_BYTES) throw new Error(`The reference image is larger than ${MAX_REFERENCE_BYTES / (1024 * 1024)} MB.`)
}
