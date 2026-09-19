Start implementing Caption Studio from this folder. Read AGENTS.md and all docs first; they contain the agreed product decisions, so do not restart discovery.

Initialize git if absent. Scaffold an Electron + React + TypeScript desktop application with a maintained toolchain and reproducible lockfile. Build the first vertical slice: native video selection, video playback, UTF-8 SRT import, synchronized transcript and caption timeline, editable text and cue start/end times, seeking by caption, caption overlay preview, undo/redo, project save/reopen and SRT export. Include a dark three-pane editor and bottom timeline, adapted to the available window width.

Validate this slice with meaningful tests and a desktop smoke test where the environment allows it. Update docs/STATUS.md with what works and exact commands. Then continue to waveform extraction and timeline boundary dragging, followed by local transcription in milestone 2. Local video-audio transcription is mandatory for the first usable release; do not stop at an SRT-only product.

Use a transcription adapter so whisper.cpp can be integrated first and faster-whisper evaluated later for NVIDIA. Preserve timing provenance and human corrections. Do not invent word-alignment accuracy. Keep preview and future export on a shared time-driven caption renderer.

Proceed with routine implementation choices without asking for repeated approvals. If dependencies or platform testing are blocked, document the specific limitation and complete the unblocked work. Do not publish a repository or release in this task.
