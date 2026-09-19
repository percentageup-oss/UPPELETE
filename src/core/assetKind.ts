import type { MediaMetadata } from './media'

/** Extensions offered by the asset-import dialog filters (electron/main.ts). Classification itself
 * never trusts the extension — only the probed streams below — so a mislabeled file is refused. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff']
export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg']
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']
export const SUBTITLE_EXTENSIONS = ['srt']

const IMAGE_CODECS = new Set(['png', 'mjpeg', 'webp', 'gif', 'bmp', 'tiff'])

/**
 * An "image" is a single still frame: exactly one video stream carrying an image codec and no
 * audio. An "audio" file may still carry a video stream (embedded cover art), so classification
 * checks audio streams first. A "video" stream is any video stream that is *not* an image codec —
 * it wins over both, since a file with real video content is never an image or audio asset.
 */
export function classifyMedia(metadata: MediaMetadata): 'image' | 'audio' | 'video' | null {
  const videoStreams = metadata.streams.filter((stream) => stream.kind === 'video')
  const audioStreams = metadata.streams.filter((stream) => stream.kind === 'audio')
  if (videoStreams.some((stream) => !IMAGE_CODECS.has(stream.codec.name))) return 'video'
  const allVideoIsImageCodec = videoStreams.every((stream) => IMAGE_CODECS.has(stream.codec.name))
  if (audioStreams.length && allVideoIsImageCodec) return 'audio'
  if (!audioStreams.length && videoStreams.length === 1 && allVideoIsImageCodec) return 'image'
  return null
}

/** Today's asset bin only holds images and audio; a real video is refused (`null`), same as before
 * `classifyMedia` existed. Kept so every existing caller/test is unaffected by the video addition. */
export function classifyAsset(metadata: MediaMetadata): 'image' | 'audio' | null {
  const kind = classifyMedia(metadata)
  return kind === 'video' ? null : kind
}

export function isSubtitleFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return SUBTITLE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}
