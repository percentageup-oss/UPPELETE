/**
 * Versioned FFmpeg extraction profile recorded in transcription provenance. `aresample` with `first_pts=0`
 * pads silence when the first audio sample starts after the requested source time (for example an MP4 audio
 * edit list), and `async=1` fills timestamp gaps, so a sample's index always equals its offset from the
 * requested source start. See docs/TRANSCRIPTION.md.
 */
export const AUDIO_EXTRACTION_VERSION = 'ffmpeg-aresample-async1-firstpts0-s16le-mono-wav-v1'
