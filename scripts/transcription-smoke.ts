import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JobScheduler } from '../electron/jobScheduler'
import { ModelManager } from '../electron/modelManager'
import { TranscriptionService, type TranscriptionJobValue } from '../electron/transcriptionService'
import { applyCaptionCommand } from '../src/core/captionCommands'
import { createProject } from '../src/core/model'
import { MODEL_CATALOG, modelIdSchema } from '../src/core/modelCatalog'
import { serializeSrt } from '../src/core/srt'
import { languageCodeSchema } from '../src/core/transcription'
import { applyTranscription, TranscriptionChoiceRequired } from '../src/core/transcriptionApply'
import type { TranscriptionDevice } from '../src/core/transcriptionIpc'
import { MediaWorkerClient } from '../workers/media/client'

/**
 * Real offline transcription smoke (T3): explicit model files only (network access throws), the bundled worker
 * process, the configured FFmpeg/ffprobe pair and whisper-cli, every detected device, applying captions to a
 * project, a human correction preserved through retranscription, real cancellation and cleanup checks.
 */

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

async function jobDirectories(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => /^caption-studio-(transcription|whisper)-/.test(name))
}

async function main() {
  const [ffmpegPath, ffprobePath, whisperCliPath, mediaPath, modelDirectory, modelArgument = 'whisper-base', languageArgument = 'auto'] = process.argv.slice(2)
  if (!ffmpegPath || !ffprobePath || !whisperCliPath || !mediaPath || !modelDirectory) {
    throw new Error('Usage: npm run smoke:transcription -- <ffmpeg> <ffprobe> <whisper-cli> <media> <model directory> [model id] [language code | auto]')
  }
  const modelId = modelIdSchema.parse(modelArgument)
  const language = languageArgument === 'auto' ? 'auto' : languageCodeSchema.parse(languageArgument)
  const offlineFetch = (async () => { throw new Error('Network access is disabled for the offline transcription smoke') }) as typeof fetch
  const models = new ModelManager(modelDirectory, MODEL_CATALOG, { fetch: offlineFetch })
  const client = new MediaWorkerClient({ workerPath: path.join(__dirname, 'server.cjs'), tools: { ffmpegPath, ffprobePath, whisperCliPath } })
  const scheduler = new JobScheduler()
  const service = new TranscriptionService({ worker: client, scheduler, whisperConfigured: true, temporaryRoot: tmpdir(), installedModelPath: (id) => models.installedPath(id) })
  try {
    // Finalizes a complete, explicitly downloaded partial or re-verifies an installed file; never requests the network.
    const modelState = await models.download(modelId)
    if (!modelState.installed) throw new Error(`Model is not installed: ${JSON.stringify(modelState)}`)
    console.log(JSON.stringify({ step: 'model', state: modelState }))

    const directoriesBefore = await jobDirectories()
    const sourceHash = await sha256File(mediaPath)
    const probe = await client.start({ operation: 'probe', inputPath: mediaPath }).result
    const durationUs = probe.metadata.durationUs
    if (!durationUs) throw new Error('Media has no probed duration')
    console.log(JSON.stringify({ step: 'probe', media: path.basename(mediaPath), durationUs, streams: probe.metadata.streams.map((stream) => ({ kind: stream.kind, codec: stream.codec.name })) }))

    const availability = await service.availability(modelId)
    if (!availability.available) throw new Error(availability.reason)
    console.log(JSON.stringify({ step: 'availability', engine: availability.engine, devices: availability.devices, gpuBackend: availability.gpuBackend,
      systemInfo: availability.systemInfo, autoDetectLanguage: availability.autoDetectLanguage, languageCount: availability.languages.length }))

    const transcribe = async (device: TranscriptionDevice): Promise<TranscriptionJobValue> => {
      const started = performance.now()
      const progress: string[] = []
      const handle = service.start({ mediaPath, sourceRange: { startUs: 0, endUs: durationUs }, modelId, language, device, translateTo: null }, (job) => {
        if (job.progress) progress.push(job.progress.kind === 'measured' ? `${job.progress.phase}:${job.progress.completed}/${job.progress.total}` : job.progress.phase)
      })
      const outcome = await handle.outcome
      if (outcome.state !== 'succeeded') throw new Error(`Transcription on ${device} ${outcome.state}: ${JSON.stringify(outcome)}`)
      console.log(JSON.stringify({ step: 'transcribe', device, elapsedMs: Math.round(performance.now() - started), progress, run: outcome.value.run, segments: outcome.value.transcript.segments }))
      return outcome.value
    }
    const results: TranscriptionJobValue[] = []
    for (const device of availability.devices) results.push(await transcribe(device))

    let project = applyTranscription(createProject(), results[0].transcript, results[0].run, null, randomUUID).project
    console.log(JSON.stringify({ step: 'captions', cues: project.cues.map(({ startUs, endUs, text, timingSource, textSource, needsReview, transcriptionRunId }) => ({ startUs, endUs, text, timingSource, textSource, needsReview, transcriptionRunId })) }))
    if (project.cues.length === 0) throw new Error('No captions were produced from the media audio')

    const first = project.cues[0]
    const correctedText = `${first.text} [corrected]`
    const edited = applyCaptionCommand(project, { type: 'update-text', cueId: first.id, text: correctedText }, { mediaDurationUs: durationUs })
    if (!edited.ok) throw new Error(`Caption edit failed: ${JSON.stringify(edited.errors)}`)
    project = edited.project
    const latest = results[results.length - 1]
    let choiceRequired = false
    try { applyTranscription(project, latest.transcript, latest.run, null, randomUUID) }
    catch (error) { choiceRequired = error instanceof TranscriptionChoiceRequired }
    const merged = applyTranscription(project, latest.transcript, latest.run, 'keep-authored', randomUUID)
    const corrected = merged.project.cues.find((cue) => cue.id === first.id)
    console.log(JSON.stringify({ step: 'retranscribe', choiceRequired, summary: merged.summary, correctedPreserved: corrected?.text === correctedText && corrected.textSource === 'user' }))
    console.log(serializeSrt(merged.project.cues))

    // Cancel once whisper.cpp itself has reported recognition progress, so a running engine process is stopped.
    let cancel = () => {}
    let cancelledAt: string | null = null
    const cancelHandle = service.start({ mediaPath, sourceRange: { startUs: 0, endUs: durationUs }, modelId, language, device: 'cpu', translateTo: null }, (job) => {
      if (cancelledAt === null && job.progress?.kind === 'measured' && job.progress.phase === 'recognizing' && job.progress.completed > 0) {
        cancelledAt = `${job.progress.completed}/${job.progress.total}`
        cancel()
      }
    })
    cancel = () => cancelHandle.cancel()
    const cancelOutcome = await cancelHandle.outcome
    console.log(JSON.stringify({ step: 'cancel', cancelledAt, outcome: cancelOutcome.state }))

    const leftovers = (await jobDirectories()).filter((name) => !directoriesBefore.includes(name))
    console.log(JSON.stringify({ step: 'cleanup', newJobDirectories: leftovers, sourceUnchanged: (await sha256File(mediaPath)) === sourceHash }))
  } finally {
    await scheduler.close()
    await client.close()
    await models.close()
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
