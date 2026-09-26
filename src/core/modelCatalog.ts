import { z } from 'zod'

export const modelIdSchema = z.enum(['whisper-base', 'whisper-base-en', 'whisper-small', 'whisper-large-v3-turbo', 'whisper-large-v3'])
export type ManagedModelId = z.infer<typeof modelIdSchema>
export interface ModelArtifact {
  id: ManagedModelId
  /** Friendly tier shown in the UI (Small, Medium, Large…); the exact file is under Details. */
  name: string
  /** One-line trade-off shown under the name in Settings. */
  summary: string
  recommended: boolean
  fileName: string
  backend: 'whisper.cpp'
  format: 'GGML F16'
  languageCapability: string
  /** Multilingual Whisper weights accept every whisper.cpp language code and auto-detection; `.en` weights accept only English. */
  multilingual: boolean
  sizeBytes: number
  sha256: string
  url: string
  deviceModes: readonly string[]
}

// Reviewed publisher LFS metadata; never fetch a catalog/checksum at runtime.
export const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
const deviceModes = ['CPU (fallback)', 'Metal (macOS; Metal build and supported GPU required)', 'CUDA (NVIDIA; CUDA build required)'] as const
const artifact = (id: ManagedModelId, name: string, summary: string, fileName: string, sizeBytes: number, sha256: string, languageCapability: string, multilingual: boolean, recommended = false): ModelArtifact => ({
  id, name, summary, recommended, fileName, sizeBytes, sha256, languageCapability, multilingual, backend: 'whisper.cpp', format: 'GGML F16', deviceModes,
  url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/${fileName}`,
})
export const MODEL_CATALOG: readonly ModelArtifact[] = [
  artifact('whisper-base', 'Small', 'Fast, basic accuracy. Weak on Malayalam.', 'ggml-base.bin', 147951465, '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', 'Multilingual Whisper (99 languages, including Malayalam and English); auto-detection', true),
  artifact('whisper-base-en', 'Small · English only', 'Fastest. English only.', 'ggml-base.en.bin', 147964211, 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', 'English only; no Malayalam', false),
  artifact('whisper-small', 'Medium', 'Balanced speed and accuracy.', 'ggml-small.bin', 487601967, '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', 'Multilingual Whisper (99 languages, including Malayalam and English); auto-detection', true),
  artifact('whisper-large-v3-turbo', 'Large', 'Good Malayalam accuracy at a reasonable speed.', 'ggml-large-v3-turbo.bin', 1624555275, '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', 'Multilingual Whisper (99 languages, including Malayalam and English); auto-detection. Much more accurate than base/small on lower-resource languages such as Malayalam; slower and a larger download.', true, true),
  artifact('whisper-large-v3', 'Extra large', 'Most accurate and slowest.', 'ggml-large-v3.bin', 3095033483, '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2', 'Multilingual Whisper (99 languages, including Malayalam and English); auto-detection. The most accurate size for lower-resource languages such as Malayalam; slowest and largest download.', true),
]

export const modelStateSchema = z.object({
  id: modelIdSchema,
  location: z.string(),
  partialLocation: z.string(),
  status: z.enum(['absent', 'checking', 'downloading', 'verifying', 'installed', 'interrupted', 'cancelled', 'failed', 'removing']),
  installed: z.boolean(),
  partialPresent: z.boolean(),
  downloadedBytes: z.number().int().nonnegative().safe(),
  cancelRequested: z.boolean(),
  error: z.object({ code: z.enum(['NETWORK', 'CHECKSUM', 'DISK', 'UNSAFE_PATH', 'INVALID_SOURCE', 'BUSY']), message: z.string() }).strict().nullable(),
}).strict()
export type ModelState = z.infer<typeof modelStateSchema>
/** `backendAvailable` reports only whether a whisper-cli executable is configured; detection happens per model in T3. */
export type ModelListing = { catalog: readonly ModelArtifact[]; states: ModelState[]; backendAvailable: boolean }
