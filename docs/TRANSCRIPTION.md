# Transcription contract (T1), whisper.cpp (T3) and caption grouping (T4)

This is the reusable contract every transcription/alignment backend implements, the job
scheduler that arbitrates heavy work, and the real local whisper.cpp backend built on them
([whisper.cpp integration](#whispercpp-integration-t3) below). [T2 model management](MODELS.md)
supplies verified model files. See `docs/STATUS.md` for exactly what was verified.

## Source of truth

- `src/core/jobs.ts` — job state machine, progress schema, structured errors.
- `src/core/transcription.ts` — capabilities/options/output schemas and the source-time
  mapping/validation functions. Pure, no I/O.
- `workers/transcription/contract.ts` — `TranscriptionInput` and the `TranscriptionAdapter`
  interface a backend implements.
- `workers/transcription/run.ts` — the only supported way to call an adapter: validates
  before calling, guards progress, maps/validates output after.
- `electron/jobScheduler.ts` — main-owned FIFO queue with heavy-job arbitration. No
  Electron import; testable directly in Node.
- `electron/transcriptionJob.ts` — composes the scheduler with `run.ts`, gating the
  eventual project mutation behind an explicit commit step.

## Adapter contract

```ts
interface TranscriptionAdapter {
  capabilities(): Promise<TranscriptionCapabilities>
  transcribe(input, options, progress, cancellation): Promise<RawTranscriptionOutput>
  align?(input, segments, progress, cancellation): Promise<RawAlignmentOutput>
}
```

`capabilities()` declares, independently: supported transcription languages, whether
auto-detection is offered, devices (CPU must always be included as a fallback), accepted
input sample rates (16 kHz or 48 kHz mono), whether word timing is reported, whether
segment/word confidence is reported, and — separately, possibly `null` — the languages an
optional word aligner supports. **Alignment language support is never inferred from
transcription language support**; a model that transcribes Malayalam does not thereby
support Malayalam alignment.

`transcribe()`/`align()` report every timestamp **relative to the start of the audio file
they were given** (`input.audio.path`), never source-media time. `run.ts` performs the one
authoritative `sourceStartUs + relativeUs` mapping in `src/core/transcription.ts`; an
adapter never sees or computes source-media time itself. Adapters must:

- reap any child process before their returned promise settles or rejects;
- call `progress` only with values they can actually measure — never a fabricated percent;
- stop and reject promptly once `cancellation` aborts, rather than finishing silent work;
- never invent text for silence — a silent span simply produces no segment, and a long gap
  between segments must be preserved exactly, not compressed or drifted.

`align()` is present only when `capabilities().alignment` is non-null. Its word-level output
can time the text it was given; it can never introduce different text. `run.ts` validates
this: every aligned word's text must be found, in order, inside the original segment text
it was aligned against.

## Validation rules (fail closed, before any project mutation)

`validateTranscriptionOutput` (and `validateAlignmentOutput`) reject with `MALFORMED_OUTPUT`
on: schema failure or unknown keys; non-positive segment/word duration; timestamps outside
the audio window; unsorted or overlapping segments/words; a word outside its segment; empty,
whitespace-only, control-character or lone-surrogate text; words present when not requested
or not declared as supported; confidence present when not declared as available; a reported
engine/model/language that does not match declared capabilities (or, for auto-detect, a
language outside the declared set); and a mapped timestamp that overflows the safe-integer
range. Zero segments is valid — genuine silence produces no text. Alignment additionally
requires every requested segment id to be answered exactly once and every aligned word to
appear, in order, inside that segment's unchanged original text.

`checkTranscriptionOptions`/`checkAudioSampleRate`/the language-declared-for-alignment check
run **before** any adapter call, so unsupported input never reaches a backend at all.

## Jobs and cancellation

Every job kind currently defined (`transcription`, `alignment`, `export`) is resource-heavy
(`JOB_RESOURCE_CLASS`). `JobScheduler` runs at most `heavyConcurrency` (default 1) heavy jobs
at once in strict FIFO order — by default, transcription and export never run together — and
exposes `queued → running → {succeeded | failed | cancelled}` snapshots with structured
progress/errors through `subscribe()`.

Cancelling a **queued** job finalizes it `cancelled` immediately; `run()` is never called.
Cancelling a **running** job sets `cancelRequested` and aborts its `AbortSignal`, but the job
stays `running` until `run()` actually settles — cancellation never overtakes work already
under way, and cleanup (reaping a child process, for instance) always completes first.

A job's `run(ctx)` gates its eventual mutation behind `ctx.enterCommit()`, which returns
`false` (and performs no mutation) if cancellation was already requested. Once it returns
`true`, a later cancel is a no-op for that job — an in-progress commit is never retroactively
relabeled cancelled. `electron/transcriptionJob.ts`'s `enqueueTranscription`/`enqueueAlignment`
apply this: they validate and map backend output via `run.ts`, call `enterCommit()`, and only
then invoke the caller-supplied `commit()` — so a cancellation that lands after valid output
exists but before it is applied still prevents the project mutation, and a commit that throws
becomes a structured `COMMIT_FAILED` rather than a raw error.

Malformed or regressing progress (schema failure, or a later `completed` lower than an
earlier one for the same phase/unit) aborts the job's signal and fails it `INVALID_PROGRESS`
rather than ever forwarding a rewinding or nonsensical progress bar.

## whisper.cpp integration (T3)

Engine selection, build configuration, hashes, licenses and the Windows strategy are recorded
in [DEPENDENCIES.md](DEPENDENCIES.md). `./dev.sh` builds the pinned whisper-cli automatically (via `scripts/build-whisper.sh`, also runnable
directly as `npm run tools:whisper`) and writes `whisperCliPath` into the gitignored
`caption-studio.local.json` alongside the FFmpeg/ffprobe pair; `CAPTION_STUDIO_WHISPER_CLI_PATH`
overrides it. The app itself bundles, downloads and looks up nothing on PATH.

### Pipeline

One `transcription` job in `JobScheduler`, orchestrated by the Electron-free
`electron/transcriptionService.ts`. The renderer sends only a request ID, a media fingerprint
registered by a probe in this session, a catalog model ID, a language code or `auto`, and a device.

1. **Model**: `ModelManager.installedPath(id)` re-hashes the selected model immediately before
   use. Failure is `MODEL_UNAVAILABLE` with an action to download or recheck it in Models.
2. **Engine inspection** (`inspectWhisper`, cached per model path for the session; failures are
   not cached): `whisper-cli --version`, then the real model loaded on a generated one-second
   silent WAV twice — GPU allowed, then `-ng`. Devices come only from whisper.cpp's own
   `whisper_backend_init_gpu: using <device> backend` / `no GPU found` lines (`MTL0` → Metal);
   CPU is declared only after the `-ng` run confirms it. Text from the generated silence is ignored.
3. **Audio extraction** (`extractAudio`, `AUDIO_EXTRACTION_VERSION`) into a job-owned temporary
   directory: FFmpeg decodes the first audio stream of the source range to 16 kHz mono 16-bit WAV
   with `aresample=16000:async=1:first_pts=0`, so audio starting after the requested time (an MP4
   edit list, for example) is padded rather than shifted earlier, and timestamp gaps are filled.
   `-n` never overwrites. Duration comes from the WAV `data` chunk's sample count, bounded by the
   requested range (the last kept sample can end up to one sample past it; 20 µs was observed).
4. **Recognition** (`whisperTranscribe`, `SPEECH_GATING_VERSION`): the worker finds exact long
   silences in the samples (20 ms RMS windows below −45 dBFS for at least 2 s), pads each speech
   region by 300 ms, writes each region to its own WAV and runs
   `whisper-cli -m <model> -f <chunk> -l <lang> -t <n> -pp -sns -mc 0 -oj -of <base> [-ng]`. `-mc 0`
   disables whisper.cpp's default of carrying the previous 30-second window's decoded text forward
   as context for the next window *within* one chunk — observed to compound both repeated-text
   loops and whole-transcript wrong-script drift once one window went bad (see Limitations). Segment
   times are `chunk start + whisper offset` in microseconds relative to the extracted audio;
   `run.ts` then performs the single audio→source mapping and validation. With `auto`, the
   longest chunk runs first with `-l auto` and its detected language is used for the other chunks.
5. **Delivery** only after `ctx.enterCommit()`. The job directory is removed on success, failure
   and cancellation.
6. **Applying** (`src/core/transcriptionApply.ts`, one undoable history step): with no captions
   overlapping the transcribed range, captions are added directly. Otherwise nothing changes until
   the user chooses **Keep imported and edited captions** (replace only captions whose text *and*
   timing remain model-derived or automatically estimated, with no manual/aligned word edits; new captions overlapping a kept caption are skipped, never merged into
   its text), **Replace all in range**, or discards the transcript. Captions outside the range are kept.

### Why silence gating uses separate chunk files

Observed with this project's whisper-cli 1.9.4 build and `ggml-base.bin` on the synthetic smoke clip:
given only a silent 20-second window through `-ot 7000 -d 20000`, whisper.cpp returned repeated
invented text ("I'm sorry, I'm sorry, …") followed by speech from *after* the window, ending at
35.1 s — past both the window and the 32 s file. `-ot/-d` therefore do not isolate audio, and
silence can produce text. Starting at 6.42 s (inside the long pause) placed speech that begins at
27.2 s at 6.42 s, and whole-file output ended a segment at 34.0 s for 32.0 s of audio. Silence is
therefore never sent, and each chunk file contains only its own samples.

### Output parsing and normalization

`src/core/whisperCpp.ts` parses `-oj` JSON (`result.language`, integer millisecond
`transcription[].offsets`). whisper-cli 1.9.4 escapes only quotes and backslashes, so raw control
characters inside strings are re-escaped exactly; invalid UTF-8, JSON or shape fails `TOOL_FAILED`.
Text is only trimmed of surrounding whitespace. Explicit, never silent normalizations: an end past
the chunk is clamped (`end-clamped-to-chunk`), a zero-length segment is extended to the next
segment or chunk end (`zero-duration-extended`), and an overlap moves the start
(`start-moved-after-overlap`); those captions get `needsReview: true`. Empty text and text starting
past the chunk are dropped and counted in the run record.

Contract additions: `RawTranscriptionOutput.language` may be `null` only for `auto` with no
segments, and segments may carry `timingAdjustment`, which validation carries to
`SourceTimedTranscript`.

### Provenance, progress, cancellation and errors

The project gains an optional `transcriptionRuns[]` (schema 2 stays loadable): engine id/version,
model id/file/SHA-256, requested and detected language, requested device and the backends
whisper.cpp actually initialized (`MTL0`, `CPU`), source range, extraction and gating versions,
and chunk/silence/segment/adjusted/dropped counts. Each caption created from a run has
`transcriptionRunId` and `textSource: model`. T4 preserves the source-timed recognition before
grouping in `transcriptionRuns[].recognition`; segment-only whisper.cpp output receives explicitly
estimated words. Actual whisper-cli token timestamps are not exposed as word timing.

Progress is `loading-model`, then `extracting-audio` (measured from FFmpeg `out_time_us`), then
`recognizing`, measured in microseconds of detected speech audio from whisper.cpp's own `-pp`
percentages. whisper-cli prints in 5% steps and short chunks may print only 81%/100%, so the bar
moves in jumps; nothing is interpolated. Cancellation aborts the worker, which terminates the
running whisper-cli, and removes chunk files and job directories; a cancelled job never delivers
captions. Errors name the action: engine not configured, model not verified, executable cannot
start, model cannot load, media has no audio stream or no decodable samples, unexpected engine
output or language, and per-job worker deadlines that scale with duration.

### Running it

```sh
npm run smoke:transcription -- /abs/ffmpeg /abs/ffprobe /abs/whisper-cli '/abs/clip.mp4' \
  "$HOME/Library/Application Support/caption-studio/Models/whisper.cpp" whisper-base auto
```

The smoke passes a `fetch` that throws, so model verification is provably offline. For the
bundled main process, set the three tool variables plus `CAPTION_STUDIO_TRANSCRIPTION_SMOKE_PATH`
(and optionally `CAPTION_STUDIO_TRANSCRIPTION_SMOKE_MODEL`) and run `electron . --transcription-smoke`.
In the app, set the three tool variables before launch, open a video and choose **Transcribe**.

### Limitations

Energy gating is not voice-activity detection: music or noise above −45 dBFS is still sent (and
whisper.cpp may produce text for it), and speech quieter than the threshold for 2 s is skipped.
Base-model segment timing is coarse: on the smoke clip the first caption starts at 0.000 s although
audible speech starts at 1.497 s, and several boundaries fall on whole seconds. Auto-detection
chooses one language for the whole video. Malayalam speech recognition, `ggml-base.en.bin`,
`ggml-small.bin`, Windows and CUDA/Vulkan were not executed; Malayalam is covered only by
parser/mapping/apply tests with Malayalam text. Model quality and thresholds belong to T5.

Whisper's script choice for lower-resource languages is unstable even on large-v3: on a real
~70s English-code-switched Malayalam clip (no 2s+ silence, so one whisper-cli run covering three
internal 30s windows), repeated runs produced the Malayalam speech written phonetically in English
letters, degenerate repeated-phrase loops, and whole-transcript Gurmukhi — never the actual
Malayalam script. Seeding a native-script `--prompt` was tried and made this worse (it
deterministically reproduced the Gurmukhi drift plus a corrupted-UTF-8 repetition loop) and is not
used. `-mc 0` (above) measurably reduces the drift and removes the repetition loop, but does not
guarantee correct script. `src/core/scriptCheck.ts`'s check therefore treats a Latin-dominated
transcript (English terms, or Whisper writing the spoken language phonetically in English) as an
acceptable outcome rather than a wrong-script failure, and only fails closed when a wrong non-Latin
script actually dominates — code-switched Malayalam/English content should expect to need a manual
review pass regardless.

## Gemini transcription (optional BYOK)

A second engine behind the same contract, available only after the user saves their own Gemini API key in
**Settings → Gemini API key** (the same encrypted key **Align audio** uses). whisper.cpp stays the default, and
nothing about local transcription changes without a key. The Transcribe dialog's **Engine** choice switches the
disclosure text: the Gemini text states that speech audio is uploaded to Google.

1. **Request**: the renderer sends `engine: 'gemini'`, a registered media fingerprint and `auto | ml | en`. It never
   sends a key, path, model or device. Electron main loads the key from `GeminiSecretStore`.
2. **Audio**: the same `extractAudio` 16 kHz mono WAV in a job-owned directory. Then the worker's `speechChunks`
   operation applies the same `SPEECH_GATING_VERSION` long-silence detection whisper.cpp uses and writes each padded
   speech region to its own WAV. Silence is never uploaded. Speech with no 2 s pause for 20 minutes is split at a fixed
   point, which can fall inside a word.
3. **Recognition** (`electron/geminiRecognition.ts`, shared with alignment): each chunk is uploaded to the Files
   API and sent to `gemini-3.5-transcribe` in verbatim mode with word timestamps and `store: false`. The upload is
   deleted best-effort. Locale hints are `ml-IN` + `en-IN` for `auto` (mixed), `ml-IN` or `en-IN` otherwise.
4. **Segments** (`segmentsFromWords` in `electron/geminiTranscription.ts`): timed words become segments at pauses of
   ≥ 800 ms, at sentence-ending punctuation, or at 30 s. Segment text is the exact word texts joined by single spaces.
   Punctuation-only tokens join the previous word. A word overlapping its predecessor starts at the predecessor's end
   (`start-moved-after-overlap`); a word left with no duration joins the previous word. Ends past the chunk are
   clamped (`end-clamped-to-chunk`) and words starting past it are dropped and counted. Adjusted segments are review-flagged.
5. **Validation**: `GeminiTranscriptionAdapter` declares `wordTiming: 'model'`, languages `ml`/`en` and no confidence.
   It runs through `runTranscription`, so offsets, containment, whole-word matching and the script check are the same
   as whisper.cpp. Gemini reports no language; `auto` is recorded as `ml`, matching the alignment path.
6. **Provenance**: `transcriptionRuns[]` is now a union. Existing whisper.cpp records are unchanged. Gemini records carry
   `provider: 'gemini'`, engine/model ids, requested/recorded language, extraction and gating versions,
   chunk/silence/segment/adjusted/word/dropped-word counts, optional token usage and the original recognition. No key and
   no raw provider response are stored. Captions get real `model` word timing, so grouping uses real pauses.

Limitations: no live request has been run from this code (see STATUS.md). Provider availability, charges, annotation
compatibility and Malayalam accuracy are unverified. Cancellation aborts the in-flight request; deletion of an upload
the provider already accepted is best-effort.

## Translating captions with Gemini

An opt-in **"Translate to"** dropdown in the Transcribe dialog, offered for **both** engines, that translates the
recognized text into a chosen target language after recognition instead of creating captions in the spoken language.
Default is "None" (unchanged behavior). Choosing a target requires the same Gemini API key as Gemini transcription,
even when the engine is whisper.cpp — only the recognized **text**, never audio, is sent for translation.

1. **Request**: `translateTo` (a language code or `null`) travels alongside every transcription request for both
   engines; the renderer never sends a key. Electron main loads the stored key whenever `translateTo` is non-null.
2. **When it runs**: after `runTranscription` produces a validated `SourceTimedTranscript` and before
   `ctx.enterCommit()`, in a new `translating` job phase between `recognizing` and `aligning`.
3. **Translation** (`electron/geminiTranslation.ts`): segment texts are sent to `gemini-3.8-flash` via
   `ai.models.generateContent` with a JSON-schema-constrained response, in batches of up to 60 lines
   (`GEMINI_TRANSLATE_BATCH_SIZE`). Each batch line carries its original index; every index must come back exactly
   once with non-empty, clean text, or the batch is rejected as `MALFORMED_OUTPUT` — this is the same fail-closed
   posture as recognition/alignment, here preventing translated text from silently landing against the wrong
   segment's timing. Progress is measured in batches completed. The same `checkTranscriptScript` sanity check
   recognition uses reruns against the target language and the translated text; a wrong dominant script (e.g.
   Tamil for a Malayalam target) fails as `UNEXPECTED_SCRIPT`.
4. **Applying** (`translatedRecognitionToCaptions` in `src/core/recognition.ts`, called from `transcriptionApply.ts`):
   each caption takes the segment's recognized timing but the **translated** text. Word timing is always
   **estimated** (never inherited from the source language's word timestamps — a translated word does not
   correspond to the original audio's word position) and every such caption is `needsReview: true`. The
   spoken-language recognition is still stored unchanged in `transcriptionRuns[].recognition`; nothing about
   applying, keep-authored/replace-all or undo changes.
5. **Provenance**: an optional `translation` object on the run record — `provider: 'gemini'`, model, target
   language, segment count and token usage. No key and no raw response are stored. This is independent of the
   run's own `provider`/engine fields, so a whisper.cpp run can carry both local recognition provenance and
   Gemini translation provenance at once.

Limitations: no live request has been run from this code (see STATUS.md). The offered target languages are a
curated list of 15 ISO 639-1 codes (`src/core/translationLanguages.ts`), not the full set Gemini could plausibly
translate into. Transliteration (writing text in a non-native script) remains out of scope.

## What is deliberately not here

whisper.cpp still supplies no alignment backend or word timing. The optional Gemini BYOK paths are opt-in: **Align audio** aligns existing caption text from word timestamp annotations and never replaces that text, and **Transcribe with Gemini** (above) creates new captions only through the same explicit apply/keep-edits choice as local transcription.
`TranscriptionAdapter` implementations and worker tool runners used in tests are deterministic
test doubles defined inside `*.test.ts` files only, never imported by production code — they
prove lifecycle, validation, offset and cleanup rules, not real recognition quality or timing.


## Caption grouping, word provenance and corrections (T4)

The pure pipeline is deliberately separate:

1. `transcription.ts` validates recognition/alignment and maps timestamps to source microseconds.
   Words must match whole words and grapheme boundaries, in order, in the exact original text.
   Substrings such as `act` inside `React`, or `ക` inside `കി`, are rejected as word evidence.
2. `recognition.ts` assigns stable editable cue/word IDs and retains supplied model timestamps
   and optional confidence. `transcriptionApply.ts` stores an independent original recognition
   snapshot in the run record; correction and grouping commands never mutate that snapshot.
3. `wordTiming.ts` owns explicit estimates and safe timing retention through edits. A recognizer
   with no word output receives **estimated**, review-required word timing within each segment.
   Weights are grapheme counts; each edge is calculated from an absolute integer fraction using
   BigInt, with at least one microsecond per word and an exact final boundary. An impossibly short
   segment stays visible with missing timing and review required. No estimates cross segment gaps.
4. `captionGrouping.ts` groups a complete word list without changing any word ID, source boundary,
   timing source or review flag. Default limits are 7 words, 42 graphemes and 6 seconds; sentence
   punctuation and known word pauses of at least 800,000 µs also split groups. These are readability
   heuristics, not alignment or measured line layout. A single long token remains whole. Grouped
   cue boundaries come from their first/last words; mixed sources conservatively prefer estimated,
   then manual, then model, then aligned. Interior silence stays empty when actual word timing exists.

`captionText.ts` uses the runtime's `Intl.Segmenter` for words and graphemes, guards every text
boundary against grapheme splitting, and never normalizes/transliterates text. Grouping slices
original text, including punctuation and whitespace, so concatenating groups recovers it exactly.
Rejoining those groups does not insert extra whitespace. This is semantic segmentation only;
font shaping, line layout and animated rendering remain R1.

### Correction rules

- A text edit keeps cue boundaries exact, marks the cue `textSource: user` and `needsReview: true`.
- Exact, unique lexical matches retain IDs, source timestamps, provenance and existing review flags
  only when their relative order is unchanged. Reordered matches lose timing.
- Repeated words retain positional IDs only if the **entire lexical sequence** is unchanged,
  such as a punctuation-only edit. Adding/removing/changing repeated occurrences drops their timing
  instead of guessing which occurrence the user meant. Partial legacy lists need explicit offsets
  to identify repeated occurrences. This intentionally favors missing timing over wrong identity.
- Inserted, replaced and ambiguous words are shown as **without timing**; they receive no fabricated
  aligned/manual/model word records. Partial safe timings survive subsequent edits. Punctuation-bearing
  or multi-token legacy word records are conservatively discarded on text edits when they cannot be
  matched as exact lexical tokens. Nothing in editing upgrades estimates to aligned timing.
- A whole-cue move applies the same integer delta to words and marks those moved timings manual.
  Split/merge and explicit grouping preserve correction authority. The inspector preserves exact
  microseconds when an unchanged millisecond-formatted timestamp field loses focus.
- Retranscription requires an explicit choice whenever existing cues overlap its range. Keep-authored
  preserves imported/user/manual cues and manual/aligned word edits; incoming grouped captions that
  overlap protected cues are skipped. Only the clearly labeled replace-all action can replace edits.
  Applying, regrouping and editing remain one undo/redo step each.

### Schema and UI

Schema 2 stays compatible with valid existing projects. Words already had IDs, source microseconds,
`model | aligned | manual | estimated` and `needsReview`; T4 enforces safe integers, positive duration,
containment, ordering and project-wide ID uniqueness. Optional `textStart`/`textEnd` are offsets into
the original string, validated at whole-word/grapheme boundaries; optional confidence is retained
only if supplied by recognition. Original recognition snapshots are optional on old run records.
Malformed legacy word lists fail validation instead of being silently reattached or rewritten.

The scrollable inspector spells out each timing source, shows every timed word's exact microsecond
range and review state, and counts untimed words. **Regroup using word timings** uses only a complete
existing list. **Estimate all words & group** explicitly replaces the selected cue's word list with
review-required estimates before grouping; it discloses the replacement and boundary change.
Imported SRT receives no words or regrouping automatically; original cue text/timestamps remain
unchanged until that explicit action. The Transcribe dialog discloses estimated word timing before
recognition. No alignment/backend controls or word-level editor are implied by these labels.

Verification: unit/core and rendered-markup tests cover insertions, deletions, repeated words,
reordering, punctuation, Malayalam combining marks, containment, exact repeated merge/regroup,
long pauses, safe-integer extremes, SRT invariance, undo/redo, JSON reopen and correction-preserving
retranscription. Native macOS Electron smoke verifies actual labels/actions; details in STATUS.md.
There is still no local alignment backend or actual whisper.cpp word timing. The optional Gemini path can align exact matching words when explicitly invoked; estimates cannot find pauses
inside a recognition segment. Windows execution, Malayalam recognition quality, and shared animated
preview/export parity remain outside T4.
