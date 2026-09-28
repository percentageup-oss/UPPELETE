# 01: Engine contract, Gemini TTS, segment cache, `fitAudio`, `dubPlan`

Read `README.md` in this folder first. It holds the design, the shared findings, the project rules and the
testing override (typecheck only; no tests).

## Goal
Build the parts in main, the worker and pure core that brief 02 wires into a job. No UI and no IPC in this
brief.

## Read only these files
- `electron/geminiRecognition.ts`: the Interactions API call shape, `store: false`, the signal, usage.
- `electron/geminiTranslation.ts`: error mapping (~86-89), the `GoogleGenAI` construction.
- `electron/geminiKey.ts`
- `electron/waveformCache.ts`: the pattern for atomic cache writes.
- `workers/media/protocol.ts`, `workers/media/operations.ts`, `workers/media/audio.ts` (`extractAudio`),
  `workers/media/wav.ts`, and `workers/media/exportArguments.ts` around `atempoChain` (~415).
- `src/core/jobs.ts`: `jobFailure` and the error codes.
- `node_modules/@google/genai`: only the type declarations for `interactions.create`, to confirm the TTS
  request and response fields.

## Steps

### 1. Engine contract: `electron/dub/engine.ts`
```ts
export type DubVoice = { id: string; label: string; gender?: 'female' | 'male' | 'neutral' }
export type SynthesisRequest = { text: string; languageCode: string; voice: string; style?: string }
export type SynthesisResult = { wav: Buffer; usage?: { inputTokens?: number; outputTokens?: number } }
export interface DubEngine {
  readonly id: 'gemini' | 'local'
  readonly model: string
  readonly voices: readonly DubVoice[]
  synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>
}
```
- Throw `jobFailure(...)`-shaped errors, the same as translation does.
- `languageCode` is a BCP-47 code. Add a small pure helper `ttsLanguageCode(target)` in
  `src/core/dubPlan.ts` that maps project language codes to BCP-47:
  - `ml` to `ml-IN`, `hi` to `hi-IN`, `en` to `en-US`, `ta` to `ta-IN`
  - the Latin-script targets `ml-latn` / `hi-latn` to `ml-IN` / `hi-IN`
  - any other code passes through as-is

### 2. Gemini adapter: `electron/dub/geminiTts.ts`
- Add `GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts'`, and export the 30-voice list from the README as
  `GEMINI_TTS_VOICES`.
- `geminiTtsEngine(apiKey)` returns a `DubEngine`. It calls `ai.interactions.create` with the model, the
  text, a voice from the prebuilt list and the optional style, with `store: false` and `{ signal }`.
  - **Confirm the exact field names** against the SDK types and the docs URL in the README. If the SDK has
    no TTS fields in `interactions`, fall back to `ai.models.generateContent` with
    `responseModalities: ['AUDIO']` and `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`.
  - Record which one you used in STATUS.
- Decode the base64 audio.
  - If it is RIFF WAV, check it with `parseWavHeader`.
  - If it is raw L16 PCM (the `audio/l16` mime type), wrap it with `pcm16MonoWavHeader(samples, 24000)`.
  - Reject empty audio with `BACKEND_FAILED`.
- Retry once, after about 1.5 s, on HTTP 429 or 5xx. Never retry after an abort.
- Report usage when the response has it.

### 3. Segment cache: `electron/dub/segmentCache.ts`
- `segmentKey({ engine, model, voice, style, languageCode, text })` returns the sha256 hex of a JSON array of
  those fields. The text goes in exactly as given; do not normalize it.
- `readSegment(dir, key)` returns the path, or `null`. Check that the file exists and that `readWavInfo`
  succeeds; delete a corrupt entry.
- `writeSegment(dir, key, wav)` writes to a temporary file, then renames.
- The directory is `path.join(app.getPath('userData'), 'Cache', 'dub-segments')`. Keep this module free of
  Electron by taking `dir` as an argument.

### 4. Worker operation `fitAudio`
- Task: `{ operation: 'fitAudio', inputPath, outputPath, tempo (1..2), sampleRate: 24000 }`.
- Result: `{ operation: 'fitAudio', path, sampleCount, sampleRate }`.
- Implement it in `workers/media/fitAudio.ts`, following `extractAudio`'s argv style:
  `-nostdin -hide_banner -i <in> -af <atempoChain(tempo)>,aresample=24000 -ac 1 -c:a pcm_s16le -n -fs <cap> <out>`.
  - Skip the `atempo` part when tempo is 1.
  - Validate the output with `readWavInfo`.
- Move `atempoChain` to a small shared module (for example `workers/media/atempo.ts`) and re-export it from
  `exportArguments.ts`, so existing imports keep working.
- Add it to `taskSchema`, `operationSchema` and `resultSchema`, and add a `case` in `operations.ts`.

### 5. Pure planning: `src/core/dubPlan.ts`
```ts
export const DUB_TAIL_US = 400_000
export type DubLine = { cueId: string; startUs: number; endUs: number; text: string }
export type PlannedLine = DubLine & { windowUs: number }
export function planDubWindows(lines: readonly DubLine[]): PlannedLine[] // sorted by startUs; window = min(next.startUs, endUs + tail) - startUs, at least 1
export function fitTempo(speechUs: number, windowUs: number, maxTempo: number): { tempo: number; overflowUs: number }
// tempo = clamp(speechUs / windowUs, 1, maxTempo); overflowUs = max(0, speechUs / tempo - windowUs)
export function dubLinesFromCues(cues: readonly Cue[]): DubLine[] // skip empty/whitespace text; join multiline text with a space
```
Keep everything in integer microseconds, rounded once at the end.

## Out of scope
Job, IPC, WAV assembly and file placement (02). Schema and apply (03). UI (04). The local engine (05, 06).

## Checks
- `npx tsc --noEmit -p .` passes. No tests (README override).
- Confirm by reading that the Gemini key only ever comes from an argument supplied by main.

## Done
- [ ] `engine.ts`, `geminiTts.ts` (with the API shape actually used noted in STATUS), `segmentCache.ts`.
- [ ] `fitAudio` worker operation; `atempoChain` shared.
- [ ] `dubPlan.ts` with `planDubWindows`, `fitTempo`, `dubLinesFromCues`, `ttsLanguageCode`.
- [ ] Typecheck clean.
- [ ] `docs/STATUS.md` entry: changes, "not tested, typecheck only", limitations, next task (brief 02).
      Commit.
