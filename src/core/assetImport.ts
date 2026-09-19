import type { ProjectAsset } from './edit'
import type { ProjectMedia } from './media'

/** Result of inspecting one file dropped or picked for the media bin (electron/assetInspect.ts). */
export type InspectedFile =
  | { ok: true; kind: 'image' | 'audio' | 'video'; media: ProjectMedia; url: string }
  | { ok: true; kind: 'subtitle'; name: string; content: string }
  | { ok: false; name: string; message: string }

/** Matches an inspected file against the project's existing assets by sampled fingerprint, so
 * importing the same file twice reuses the asset instead of duplicating it (mirrors `overlay-add`
 * and `audio-add`'s inline-asset dedupe in itemCommands.ts). */
export function findAssetByFingerprint(assets: readonly ProjectAsset[], media: ProjectMedia): ProjectAsset | undefined {
  const fingerprintValue = media.fingerprint?.value
  if (!fingerprintValue) return undefined
  return assets.find((asset) => asset.fingerprint?.value === fingerprintValue)
}
