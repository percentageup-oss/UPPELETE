import type { CaptionProjectV23 } from './model'

/** Schema 23 -> 24 adds language layers. A cue made from a transcription run that was translated is tagged with the
 * run's target language, and that language is shown, so an old translated project renders exactly as before. */
export function migrateV23(project: CaptionProjectV23): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  const targets = new Map<string, string>()
  for (const run of project.transcriptionRuns ?? []) if (run.translation) targets.set(run.id, run.translation.targetLanguage)
  let shownTranslation: string | undefined
  const cues = project.cues.map((cue) => {
    const language = cue.transcriptionRunId ? targets.get(cue.transcriptionRunId) : undefined
    if (!language) return cue
    shownTranslation ??= language
    return { ...cue, translationLanguage: language }
  })
  return { project: { ...rest, cues, ...(shownTranslation ? { shownTranslation } : {}), schemaVersion: 24 } }
}
