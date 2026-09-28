# 02: Dub job + IPC, WAV assembly, file registration

Read `README.md` in this folder first (design, findings, rules, typecheck-only override). Brief 01 must have
landed: check `docs/STATUS.md`, and that `electron/dub/engine.ts`, `electron/dub/geminiTts.ts`,
`electron/dub/segmentCache.ts`, `src/core/dubPlan.ts` and the `fitAudio` worker operation exist.

## Goal
Add one IPC call that turns a list of cue lines for one video into a single registered dub WAV, plus a
voice-preview call. Nothing touches the project yet; that is brief 03.

## Read only these files
- `electron/captionTranslationIpc.ts` and `src/core/captionTranslationIpc.ts`: copy their structure.
- `electron/dub/*`, `src/core/dubPlan.ts`
- `src/core/jobs.ts` (`jobKindSchema`, `JOB_RESOURCE_CLASS`, progress phases), `electron/jobs.ts`
- `workers/media/client.ts`, `workers/media/wav.ts`
- `electron/assetInspect.ts`, `src/core/assetImport.ts` (`InspectedFile`)
- `electron/main.ts`: only around `knownProjectPaths` (~426), `lut:save-generated` (~620), where IPC
  registrars are called, and the `inspectedMedia` / fingerprint lookup helpers (~60-160).
- `electron/preload.ts` (~74-82), `src/env.d.ts` (~46-48)

## Steps

### 1. Job kind
- Add `'dub'` to `jobKindSchema`, and `dub: 'heavy'` to `JOB_RESOURCE_CLASS`.
- Reuse the existing progress phases if one fits. Otherwise add `'synthesis'`.
- Fix any exhaustive switch that the typecheck flags.

### 2. Schemas: `src/core/dubIpc.ts`
All request schemas are `z.strictObject`.
```ts
dubGenerateRequest = {
  requestId: uuid, videoFingerprint: <same fingerprint schema transcription/alignment requests use>,
  videoDurationUs: positive int, videoName: string (≤200), language: string (≤16),
  engine: z.literal('gemini'),   // brief 06 widens this to 'gemini' | 'local'
  voice: string (≤64), style: string (≤300) optional, maxTempo: number 1..1.5,
  projectPath: string | null,
  lines: array (1..5000) of { cueId: string (≤128), startUs: int ≥0, endUs: int > startUs, text: string (1..2000) },
}
dubPreviewRequest = { engine: 'gemini', language, voice, style?, text: string (1..300) }
```
- Outcome:
  - `{ state: 'succeeded', file: InspectedFile, model, engine, lines: Array<{ cueId, tempo, overflowUs, cached: boolean }>, inputTokens?, outputTokens? }`
  - or `{ state: 'failed', error }`
  - or `{ state: 'cancelled' }`
- Progress: `{ requestId, done, total }`.

### 3. Main: `electron/dubIpc.ts`
- **Channels:** `dub:generate`, `dub:cancel`, `dub:preview-voice`, and the event `dub:progress`.
- **Key.** Load it in main with `providerSecretStore().load('gemini')`. If it is missing, fail with "Add a
  Gemini API key in Settings before dubbing."
- **Video.** Resolve the fingerprint to a registered path exactly as the transcription and alignment IPC do.
  The renderer never sends a media path.
- **Enqueue a job** with `kind: 'dub'` on `getJobScheduler()`:
  1. Plan with `planDubWindows(lines)`.
  2. For each line, with **at most 3 in flight**, look up the segment cache. On a miss, call
     `engine.synthesize`, then `writeSegment`. Report progress after each line.
  3. For each segment, measure speech length with `readWavInfo` and pick a tempo with `fitTempo`.
     - If the tempo is above 1, run the worker's `fitAudio` into the job's temporary directory
       (`mkdtemp`, as `transcriptionService.ts` does).
     - If the sample rate isn't 24000, run `fitAudio` with tempo 1 to resample.
  4. **Assemble in Node.**
     - Allocate an `Int16Array` of `ceil(videoDurationUs * 24000 / 1e6)` samples.
     - Mix each segment in at `round(startUs * 24000 / 1e6)`, summing with clamping to ±32767. Drop samples
       past the end.
     - **Refuse** sources longer than 3 hours with a clear failure.
     - Write `pcm16MonoWavHeader` plus the data to a temporary file.
  5. `ctx.enterCommit()`, then move the file to its destination (next section). This is not cancellable
     after the commit, the same as export.
  6. Register the file with `inspectFileForBin(finalPath, deps)`, and return its `InspectedFile` in the
     outcome.
- **Destination.**
  - If `projectPath` is in `knownProjectPaths`: `path.join(dirname(projectPath), '<projectBaseName> Dubs')`.
  - Otherwise: `path.join(userData, 'generated-dubs')`.
  - Any other `projectPath` is treated as `null`. Never trust a path from the renderer that main doesn't
    already know.
  - File name: `<language>-<sanitized videoName>-<8 hex of the sha256 of all segment keys + tempos>.wav`.
    Sanitize with the same regex `lut:save-generated` uses.
  - If the file already exists, it has the same content by construction: register the existing file, don't
    rewrite it.
  - Create the directory with `mkdir(..., { recursive: true })`. Write to a temporary name, then rename.
- **Cleanup.** Remove the temporary directory in `finally`. On failure, keep the cached segments; they are
  useful for a retry.
- **Cancel** on renderer destruction, and through `dub:cancel`.
- **`dub:preview-voice`.** This is not a job. Synthesize the text, using the cache, and return
  `{ ok: true, wavBase64 }`. Reject results over 2 MB.
  - Return `{ ok: false, message }` on failure.
- **Wiring.** Register it in `electron/main.ts`. Expose `generateDub`, `cancelDub`, `onDubProgress` and
  `previewDubVoice` in preload, and type them in `src/env.d.ts`.

## Out of scope
Project schema and applying results (03). UI (04). Local engine (06). Gain changes to the original audio (03).

## Checks
- `npx tsc --noEmit -p .` passes. No tests.
- Confirm by reading:
  - request schemas are strict
  - no renderer-supplied path is ever written to or read from
  - the ffmpeg calls go only through the worker, with argv arrays

## Done
- [ ] `dub` job kind.
- [ ] `src/core/dubIpc.ts` schemas.
- [ ] `electron/dubIpc.ts` with caching, fitting, assembly, atomic placement, registration, progress and
      cancel.
- [ ] Preview-voice channel.
- [ ] preload, `env.d.ts`, main registration.
- [ ] Typecheck clean.
- [ ] `docs/STATUS.md` entry ("not tested, typecheck only", limitations such as the 3-hour cap). Next: brief
      03. Commit.
