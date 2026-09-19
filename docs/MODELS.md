# Explicit local model management (T2)

The Models toolbar button opens a disk-only catalog/manager. The app never checks a remote
catalog, downloads weights on launch or resumes without an explicit Download/Resume click.
Only five reviewed, unquantized whisper.cpp custom GGML F16 artifacts are allowlisted:
base, base.en, small, large-v3-turbo and large-v3. No arbitrary file importer,
converted/community model compatibility claim, weights, speech executable or new npm
dependency is included.

`src/core/modelCatalog.ts` pins the publisher repository revision, exact filenames, byte
sizes and SHA-256 values. These are reviewed Hugging Face LFS metadata, obtained over HTTPS
from the upstream-recommended publisher; they are not checksums supplied by a download
response and are not a claim of cryptographically signed upstream provenance. Updates require
reviewing and shipping a new catalog. Source and license evidence is in DEPENDENCIES.md.
Multilingual capability (including Malayalam/English) is not a benchmark result or an
alignment guarantee. CPU/Metal/CUDA entries describe upstream execution modes and their
prerequisites, not detected/available devices. T3 detects devices from the configured engine's
real backend initialization and shows them in the Transcribe dialog; Core ML encoder bundles are
outside this catalog. Each model carries a `multilingual` flag: multilingual models accept all
whisper.cpp language codes and auto-detection, `.en` models accept only English.

## Files and states

Electron main owns `ModelManager`, under `app.getPath('userData')/Models/whisper.cpp`.
Paths use the host's `path.join`; the renderer can send only a validated managed model ID,
never a URL, checksum, executable or path. Both final and `.part` paths are visible.
Main uses asynchronous filesystem operations and bounded streaming SHA-256/download I/O,
so the renderer never hashes or downloads weights. No model/media data is uploaded.

| State | Meaning |
| --- | --- |
| absent | No final or partial file on disk |
| checking | Inspecting and, for a final file, hashing local bytes; inactive until verified |
| interrupted | A saved partial exists, including a complete unfinalized partial; inactive |
| downloading | Actual byte counts written to the partial file; inactive |
| verifying | Comparing complete bytes/size against the compiled trusted catalog; inactive |
| installed | Complete final file matches catalog SHA-256 and size |
| cancelled | Aborted operation settled and file handle closed; partial retained, inactive |
| failed | Structured network/source/checksum/disk/path error; inactive, retry/remove/recheck available |
| removing | Explicit selected-file removal in progress; inactive |

Listing/reopening hashes every final file locally; existence or an old installed flag is
never sufficient. T3 must call main-only `installedPath(id)` immediately before backend use
to reverify, and must not use a renderer-supplied location. No network is required for listing,
verification, removal or resolving an installed model. Offline subtitle editing remains usable.
T3 calls `installedPath(id)` at the start of every transcription job and availability check, so
a model changed on disk is never used ([TRANSCRIPTION.md](TRANSCRIPTION.md)).

## Download and recovery

Every download owns one `.part` beside its final file. Saved bytes trigger an HTTP Range
request on the next explicit retry, bound to the same immutable URL/checksum/size. A 206
must contain a matching start and pinned total in Content-Range; malformed ranges are
rejected before writing. A 200 response safely truncates/restarts the partial, since a source
may ignore Range. Pinned checksums protect against splicing changed bytes even when the source
has no ETag. Compressed responses and conflicting lengths are rejected; absent Content-Length
is allowed with stream byte bounds and exact final size. HTTPS redirects are supported.

Short/erroring streams and cancellation preserve already written bytes. A reopened manager
finds them from disk, with no sidecar state needed and no automatic network work. Cancellation
aborts fetch, cancels a blocked reader and waits for handle cleanup before reporting cancelled.
Checksum-invalid complete partials are deleted and never activated. A complete recovered partial
can be verified/finalized offline without another request. Flush file data, verify SHA-256/size,
then rename beside the final destination atomically. Cancellation before the commit gate prevents
activation; once atomic finalization begins, a later cancel cannot retroactively relabel success.
The manager serializes all operations on each selected model; app shutdown cancels/awaits its work.

A process/OS crash before rename leaves an inactive partial; after rename, next startup verifies
local bytes. Rename atomicity does not guarantee survival of a hardware power loss on every
filesystem. No directory-wide cleanup or automatic partial deletion is performed on startup.

## Removal

Remove opens a native dialog naming the exact selected artifact and both owned paths. Keep is
the default/cancel action; only the explicit removal choice deletes. Main preflights the final
and partial, refuses symlinks/hard links/nonregular files and symlinked managed directories/parents,
then unlinks just those two selected names. It never recursively removes a directory, another
model, arbitrary files, or source media. Failed removal reports an error rather than success;
Recheck reflects the remaining files. There is no quota/automatic cache eviction.

## Verification

`electron/modelManager.test.ts` uses tiny text-byte fixtures, real temporary disk I/O and mocked
fetch/HTTP streams. No model weights or live network access are needed. Tests cover explicit-only
network access, offline reopen/tamper detection, actual progress/state transitions, trusted-checksum
failure, cancellation races and blocked-reader recovery, process-interrupted partials, 206/200 and
malformed-source handling, disk/write/fsync/rename errors, serialized operations/shutdown, and
selected-file removal preserving other models/neighbors/linked targets. Four IPC tests also
verify ID-only requests and the default/cancel/explicit native removal choice. Final
`npm run check`: 210 tests across 26 files plus strict TypeScript and all builds on macOS arm64. T3 owns real inference
quality, executable compatibility and device detection; D2 owns Windows runtime/packaging tests.
