import { useEffect, useRef, useState } from 'react'
import type { CaptionProject, ResolveLink } from '../core/model'
import type { ResolvePushTimelineRequest } from '../core/resolveIpc'
import { createDomMeasurer } from '../captions/CaptionPreview'
import { displayedCues } from '../core/captionLanguages'
import { captionClips, cuesInSequence } from '../core/timelineModel'
import { planPush, type PushPlan } from './pushPlan'
import { planTextPlus } from './textPlusPlan'
import { editSignature } from './editSignature'
import { useResolveStatus } from './useResolveStatus'

type Progress = { done: number; total: number }
type Phase =
  | { kind: 'idle' }
  | { kind: 'dialog'; plan: PushPlan; name: string; captionCount: number }
  | { kind: 'creating'; step: 'timeline' | 'captions'; progress: Progress | null }

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Creating the DaVinci timeline failed.'

/** How many captions the current sequence would send, without the full Text+ layout pass — a cheap
 * estimate for the dialog; `planTextPlus` (word-split, styling) runs only once Create is pressed. */
function captionCountOf(project: CaptionProject): number {
  const cues = displayedCues(project.cues, project.shownTranslation)
  return cuesInSequence(cues, captionClips(project.tracks, project.clips)).filter((cue) => cue.text.trim()).length
}

/**
 * "Create in DaVinci" (docs/plans/resolve-textplus/12-push-to-resolve.md): makes a new timeline in the
 * currently open Resolve project — never switches or creates a project — places KathaCut's video clips with
 * their cuts and the captions as Text+, and links the project to it (`origin: 'pushed'`) so Sync to Resolve
 * works afterward. Shown next to the connection pill whenever the project has captions.
 */
export function CreateInResolveControl({ project, onLinked, onMessage }: {
  project: CaptionProject
  onLinked(link: ResolveLink): void
  onMessage(tone: 'info' | 'warning' | 'error', text: string): void
}) {
  const status = useResolveStatus()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  if (project.cues.length === 0) return null

  const disabledReason = !window.captionStudio ? 'Create in DaVinci is available in the desktop app.'
    : status.state !== 'connected' ? 'DaVinci Resolve is not connected. In Resolve: Workspace → Scripts → UPPELETE.'
    : phase.kind !== 'idle' ? 'Already in progress.'
    : null

  const open = () => {
    if (disabledReason) return
    try {
      const plan = planPush(project)
      setPhase({ kind: 'dialog', plan, name: project.title || 'UPPELETE', captionCount: captionCountOf(project) })
    } catch (error) { onMessage('error', errorText(error)) }
  }

  const create = async (dialog: Extract<Phase, { kind: 'dialog' }>) => {
    const captionStudio = window.captionStudio
    if (!captionStudio) return
    const missing = dialog.plan.media.filter((assetId) => !project.assets.find((asset) => asset.id === assetId)?.fingerprint)
    if (missing.length) {
      onMessage('error', `${missing.map((id) => project.assets.find((asset) => asset.id === id)?.name ?? id).join(', ')} ${missing.length === 1 ? 'is' : 'are'} offline — relink before creating a DaVinci timeline.`)
      return
    }
    setPhase({ kind: 'creating', step: 'timeline', progress: null })
    const unsubscribe = captionStudio.onResolvePushProgress((progress) => setPhase((current) => current.kind === 'creating' ? { ...current, progress } : current))
    try {
      const request: ResolvePushTimelineRequest = {
        name: dialog.name, fps: dialog.plan.timeline.fps, width: dialog.plan.timeline.width, height: dialog.plan.timeline.height,
        assets: dialog.plan.media.map((assetId) => ({ assetId, fingerprint: project.assets.find((asset) => asset.id === assetId)!.fingerprint! })),
        clips: dialog.plan.clips,
      }
      const result = await captionStudio.resolvePushTimeline(request)
      const provisionalLink: ResolveLink = {
        projectName: result.projectName, timelineName: result.timelineName, timelineId: result.timelineId,
        startFrame: result.startFrame, fps: result.fps, width: result.width, height: result.height,
        origin: 'pushed', editSignature: editSignature(project), trackName: 'UPPELETE', synced: [],
      }
      setPhase({ kind: 'creating', step: 'captions', progress: null })
      const measurer = createDomMeasurer(document)
      let textPlan
      try { textPlan = planTextPlus({ ...project, resolveLink: provisionalLink }, measurer.measure) } finally { measurer.dispose() }
      const specs = textPlan.specs.map((spec) => ({
        key: spec.key, startFrame: spec.startFrame, endFrame: spec.endFrame, text: spec.text, inputs: spec.inputs,
        keyframes: spec.keyframes, styleRanges: spec.styleRanges, hash: spec.hash,
      }))
      const syncResult = specs.length
        ? await captionStudio.resolveSyncApply({ timelineId: result.timelineId, trackName: 'UPPELETE', specs, synced: [], decisions: {} })
        : { synced: [], errors: [] }
      onLinked({ ...provisionalLink, synced: syncResult.synced })
      const problems = [...result.errors, ...syncResult.errors]
      const summary = `“${result.timelineName}” with ${dialog.plan.clips.length} clip${dialog.plan.clips.length === 1 ? '' : 's'} and ${specs.length} caption${specs.length === 1 ? '' : 's'}`
      if (problems.length) onMessage('warning', `Created ${summary} in DaVinci, with problems: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}`)
      else onMessage('info', `Created ${summary} in DaVinci Resolve.`)
    } catch (error) { onMessage('error', errorText(error)) }
    finally { unsubscribe(); setPhase({ kind: 'idle' }) }
  }

  return <>
    <button type="button" className="resolve-push-button" disabled={disabledReason !== null}
      title={disabledReason ?? 'Create a new timeline in the open DaVinci Resolve project from this project'} onClick={open}>
      Create in DaVinci
    </button>
    {phase.kind === 'dialog' && <CreateInResolveDialog phase={phase} alreadyLinked={Boolean(project.resolveLink)}
      onNameChange={(name) => setPhase({ ...phase, name })}
      onCancel={() => setPhase({ kind: 'idle' })} onCreate={() => void create(phase)} />}
    {phase.kind === 'creating' && <CreateInResolveProgressDialog step={phase.step} progress={phase.progress} />}
  </>
}

function CreateInResolveDialog({ phase, alreadyLinked, onNameChange, onCancel, onCreate }: {
  phase: Extract<Phase, { kind: 'dialog' }>
  alreadyLinked: boolean
  onNameChange(name: string): void
  onCancel(): void
  onCreate(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  const { plan } = phase
  const fps = plan.timeline.fps.num / plan.timeline.fps.den
  return <dialog ref={dialog} className="model-dialog resolve-push-dialog" aria-labelledby="resolve-push-title" onClose={onCancel} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="resolve-push-title">Create in DaVinci</h2><button onClick={onCancel}>Close</button></div>
    <label>Timeline name <input type="text" value={phase.name} onChange={(event) => onNameChange(event.target.value)} /></label>
    <p>{plan.timeline.width}×{plan.timeline.height} at {Number(fps.toFixed(3))} fps, in the currently open Resolve project.</p>
    <p>Sends <strong>{plan.clips.length}</strong> video clip{plan.clips.length === 1 ? '' : 's'} and <strong>{phase.captionCount}</strong> caption{phase.captionCount === 1 ? '' : 's'} as Text+.</p>
    {alreadyLinked && <p className="resolve-sync-note">This makes a new timeline and moves the link to it. The old timeline isn’t changed.</p>}
    {plan.notSent.length > 0 && <section className="resolve-sync-support">
      <h3>Not sent yet</h3>
      <ul>{plan.notSent.map((item) => <li key={item.feature}>{item.feature} ({item.count})</li>)}</ul>
    </section>}
    <div className="dialog-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="accent" disabled={!phase.name.trim()} onClick={onCreate}>Create</button>
    </div>
  </dialog>
}

const STEP_LABEL: Record<'timeline' | 'captions', string> = {
  timeline: 'Creating the timeline and adding clips', captions: 'Adding captions',
}

function CreateInResolveProgressDialog({ step, progress }: { step: 'timeline' | 'captions'; progress: Progress | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  return <dialog ref={dialog} className="model-dialog resolve-push-dialog" aria-labelledby="resolve-push-progress-title" onCancel={(event) => event.preventDefault()}>
    <h2 id="resolve-push-progress-title">Creating the DaVinci timeline…</h2>
    <p>{STEP_LABEL[step]}{progress ? ` (${progress.done}/${progress.total})` : '…'}</p>
    <progress max={progress?.total || 1} value={progress?.done ?? 0} />
  </dialog>
}
