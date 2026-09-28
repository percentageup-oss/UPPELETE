import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionProject, ResolveLink } from '../core/model'
import type { ResolveSyncPreview, ResolveSyncProgress, ResolveSyncSpec } from '../core/resolveIpc'
import { createDomMeasurer } from '../captions/CaptionPreview'
import { planTextPlus, type TextPlusPlan } from './textPlusPlan'
import { countPendingChanges, type SyncDecision } from './syncDiff'
import { useResolveStatus } from './useResolveStatus'
import { editSignature } from './editSignature'

type Phase =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'review'; preview: ResolveSyncPreview; specs: ResolveSyncSpec[]; synced: ResolveLink['synced']; notSent: string[] }
  | { kind: 'applying'; progress: ResolveSyncProgress | null }

type Pending = Omit<Extract<Phase, { kind: 'review' }>, 'kind'>
/** What the dialog asks for: an incremental sync (with conflict choices), or a fresh copy of the captions. */
export type SyncChoice = { replaceCaptions: boolean; decisions: Record<string, SyncDecision> }

const CONFLICT_LABEL = {
  'changed-in-resolve': 'Edited in Resolve',
  'deleted-in-resolve': 'Deleted in Resolve',
  'untracked-in-resolve': 'Not in this project’s sync record',
} as const

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** "2 added, 1 updated" for the notice after a sync; empty when nothing changed. */
export const changeSummary = (preview: ResolveSyncPreview, overwritten: number) => [
  preview.insert && `${preview.insert} added`,
  preview.update + preview.replace + overwritten && `${preview.update + preview.replace + overwritten} updated`,
  preview.remove && `${preview.remove} removed`,
].filter(Boolean).join(', ')

/** What the bridge needs from a planned clip (drops the planner-only `cueId`). */
const toSyncSpec = (spec: TextPlusPlan['specs'][number]): ResolveSyncSpec => ({
  key: spec.key, startFrame: spec.startFrame, endFrame: spec.endFrame, text: spec.text, inputs: spec.inputs,
  keyframes: spec.keyframes, styleRanges: spec.styleRanges, hash: spec.hash,
})

const errorText = (error: unknown) => error instanceof Error ? error.message : 'The sync to DaVinci Resolve failed.'

/**
 * Sync to Resolve (docs/plans/resolve-textplus/06-sync.md): the header button with a pending-change badge. A click
 * reads Resolve and opens a short dialog (what will change, conflicts if any, "Replace in Resolve" options);
 * progress then shows in the button and the outcome in a notice. Shown only for a linked project.
 */
export function ResolveSyncControl({ project, link, liveTimelineId, onSynced, onMessage }: {
  project: CaptionProject
  link: ResolveLink
  /** Resolve's current timeline id, or null while unknown. */
  liveTimelineId: string | null
  onSynced(synced: ResolveLink['synced']): void
  onMessage(tone: 'info' | 'warning' | 'error', text: string): void
}) {
  const status = useResolveStatus()
  const [plan, setPlan] = useState<TextPlusPlan | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // The planner wraps lines with the DOM measurer, so it runs here in the renderer, debounced.
  const measurer = useRef<ReturnType<typeof createDomMeasurer> | null>(null)
  useEffect(() => () => { measurer.current?.dispose(); measurer.current = null }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      measurer.current ??= createDomMeasurer(document)
      try { setPlan(planTextPlus(project, measurer.current.measure)) } catch { setPlan(null) }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [project])

  const pending = useMemo(() => plan ? countPendingChanges(plan.specs, link.synced) : null, [plan, link.synced])
  const currentEditSignature = useMemo(() => editSignature(project), [project.clips, project.tracks])
  const editChanged = currentEditSignature !== link.editSignature
  const proxyMissing = link.origin === 'proxy' && !project.assets.some((asset) => asset.id === link.proxyAssetId)
  const disabledReason = !window.captionStudio ? 'Sync to Resolve is available in the desktop app.'
    : proxyMissing ? 'The DaVinci proxy video was removed from this project.'
    : editChanged ? 'The video edit changed since this project was linked to DaVinci. Use Create in DaVinci to make a new timeline.'
    : status.state !== 'connected' ? 'DaVinci Resolve is not connected. In Resolve: Workspace → Scripts → KathaCut.'
    : liveTimelineId === null ? 'Checking which timeline Resolve has open…'
    : liveTimelineId !== link.timelineId ? `Resolve has a different timeline open. Switch to “${link.timelineName}” in Resolve.`
    : !plan ? 'Preparing captions…'
    : phase.kind !== 'idle' ? 'A sync is in progress.'
    : null

  const startSync = async () => {
    if (!plan || disabledReason) return
    const specs = plan.specs.map(toSyncSpec)
    const notSent = plan.support.filter((item) => item.level === 'not-sent').map((item) => item.feature)
    setPhase({ kind: 'previewing' })
    try {
      const preview = await window.captionStudio!.resolveSyncPreview({ timelineId: link.timelineId, trackName: link.trackName, specs, synced: link.synced })
      setPhase({ kind: 'review', preview, specs, synced: link.synced, notSent })
    } catch (error) {
      setPhase({ kind: 'idle' })
      onMessage('error', errorText(error))
    }
  }

  const apply = async ({ preview, specs, synced, notSent }: Pending, { replaceCaptions, decisions }: SyncChoice) => {
    setPhase({ kind: 'applying', progress: null })
    const unsubscribe = window.captionStudio!.onResolveSyncProgress((progress) => setPhase((current) => current.kind === 'applying' ? { kind: 'applying', progress } : current))
    try {
      const result = await window.captionStudio!.resolveSyncApply({ timelineId: link.timelineId, trackName: link.trackName, specs, synced,
        decisions: replaceCaptions ? {} : decisions, ...(replaceCaptions ? { replaceAll: true } : {}) })
      onSynced(result.synced)
      const fontNotes = result.fontNotes ?? []
      const skipped = (notSent.length ? ` Not sent (Resolve can’t show it): ${notSent.join(', ')}.` : '')
        + (fontNotes.length ? ` ${fontNotes.join(' ')}` : '')
      const level = notSent.length || fontNotes.length ? 'warning' : 'info'
      if (result.errors.length) onMessage('warning', `Synced to Resolve with problems: ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''}${fontNotes.length ? ` ${fontNotes.join(' ')}` : ''}`)
      else if (replaceCaptions) onMessage(level, `Replaced the captions on “${link.trackName}” in Resolve: ${plural(specs.length, 'caption')} sent.${skipped}`)
      else {
        const overwritten = Object.values(decisions).filter((decision) => decision === 'overwrite').length
        const summary = changeSummary(preview, overwritten)
        onMessage(level, `Synced to Resolve${summary ? `: ${summary}` : ''}.${skipped}`)
      }
    } catch (error) {
      onMessage('error', errorText(error))
    } finally {
      unsubscribe()
      setPhase({ kind: 'idle' })
    }
  }

  const busyLabel = phase.kind === 'previewing' ? 'Checking Resolve…'
    : phase.kind === 'applying' ? (phase.progress?.total ? `Syncing ${phase.progress.done}/${phase.progress.total}…` : 'Syncing…')
    : null
  const badge = pending === null ? '…' : pending === 0 ? 'Synced' : `${pending} change${pending === 1 ? '' : 's'}`
  return <>
    <button type="button" className="resolve-sync-button" disabled={disabledReason !== null} aria-busy={busyLabel !== null}
      title={disabledReason ?? `Send caption changes to the “${link.trackName}” track in DaVinci Resolve`} onClick={() => void startSync()}>
      {busyLabel ?? 'Sync to Resolve'}
      {!busyLabel && <span className={`resolve-sync-badge${pending ? ' pending' : ''}`}>{badge}</span>}
    </button>
    {phase.kind === 'review' && <ResolveSyncDialog pending={phase} trackName={link.trackName}
      onJump={(frame) => void window.captionStudio?.resolveJumpTo(link.timelineId, frame).catch((error: unknown) => onMessage('error', errorText(error)))}
      onCancel={() => setPhase({ kind: 'idle' })} onSync={(choice) => void apply(phase, choice)} />}
  </>
}

/**
 * The Sync dialog: one line on what will change, the conflicts (only when a clip changed in Resolve) and the
 * "Replace in Resolve" options. Replacing captions clears the whole track, so conflicts don't apply then.
 */
export function ResolveSyncDialog({ pending, trackName, onJump, onCancel, onSync }: {
  pending: Pending
  trackName: string
  onJump(frame: number): void
  onCancel(): void
  onSync(choice: SyncChoice): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { preview, specs } = pending
  const { conflicts } = preview
  const [decisions, setDecisions] = useState<Record<string, SyncDecision>>({})
  const [replaceCaptions, setReplaceCaptions] = useState(false)
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  const setAll = (value: SyncDecision) => setDecisions(Object.fromEntries(conflicts.map((conflict) => [conflict.key, value])))

  const summary = changeSummary(preview, 0)
  const inSync = !summary && !conflicts.length
  const status = replaceCaptions ? `Clears the “${trackName}” track and sends all ${plural(specs.length, 'caption')} again.`
    : inSync ? 'Resolve is already up to date.'
    : summary ? `Ready to send: ${summary}.`
    : 'Nothing else to send.'
  const replaceHint = `Deletes ${preview.trackClips ? `all ${plural(preview.trackClips, 'clip')}` : 'everything'} on “${trackName}”${preview.foreign ? `, including ${preview.foreign} not made by KathaCut` : ''}, then adds every caption fresh. Other tracks aren’t touched.`
  const showConflicts = !replaceCaptions && conflicts.length > 0

  return <dialog ref={dialog} className="model-dialog resolve-sync-dialog" aria-labelledby="resolve-sync-title" onClose={onCancel} onKeyDown={(event) => event.stopPropagation()}>
    <h2 id="resolve-sync-title">Sync to Resolve</h2>
    <p className="resolve-sync-status">{status}</p>
    {!replaceCaptions && preview.foreign > 0 && <p className="resolve-sync-note">{plural(preview.foreign, 'clip')} on “{trackName}” weren’t made by KathaCut and will be left alone.</p>}

    {showConflicts && <section aria-labelledby="resolve-sync-conflicts-title">
      <h3 id="resolve-sync-conflicts-title">{plural(conflicts.length, 'caption')} changed in Resolve</h3>
      <p className="resolve-sync-note">Choose which version to keep. A clip you keep from Resolve won’t be updated by KathaCut again.</p>
      {conflicts.length > 1 && <div className="resolve-sync-bulk">
        <button type="button" onClick={() => setAll('keep-resolve')}>Keep all from Resolve</button>
        <button type="button" onClick={() => setAll('overwrite')}>Use all from KathaCut</button>
      </div>}
      <div className="resolve-sync-conflict-list">
        {conflicts.map((conflict) => {
          const choice = decisions[conflict.key] ?? 'keep-resolve'
          const set = (value: SyncDecision) => setDecisions((current) => ({ ...current, [conflict.key]: value }))
          const canJump = conflict.startFrame !== undefined && conflict.kind !== 'deleted-in-resolve'
          return <fieldset key={conflict.key} className="resolve-sync-conflict">
            <legend>{CONFLICT_LABEL[conflict.kind]}</legend>
            {canJump && <button type="button" className="resolve-sync-jump" onClick={() => onJump(conflict.startFrame!)}>Show</button>}
            <label className={choice === 'keep-resolve' ? 'selected' : ''}>
              <input type="radio" name={`conflict-${conflict.key}`} checked={choice === 'keep-resolve'} onChange={() => set('keep-resolve')} />
              <span>Resolve</span>{conflict.resolveText != null ? <q>{conflict.resolveText}</q> : <em>clip deleted</em>}
            </label>
            <label className={choice === 'overwrite' ? 'selected' : ''}>
              <input type="radio" name={`conflict-${conflict.key}`} checked={choice === 'overwrite'} onChange={() => set('overwrite')} />
              <span>KathaCut</span>{conflict.keptText !== null ? <q>{conflict.keptText}</q> : <em>caption deleted</em>}
            </label>
          </fieldset>
        })}
      </div>
    </section>}

    <fieldset className="resolve-sync-replace">
      <legend>Replace in Resolve</legend>
      <label>
        <input type="checkbox" checked={replaceCaptions} onChange={(event) => setReplaceCaptions(event.target.checked)} />
        <span><strong>Replace captions</strong><small>{replaceHint}</small></span>
      </label>
    </fieldset>

    <div className="dialog-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="accent" disabled={!replaceCaptions && inSync} onClick={() => onSync({ replaceCaptions, decisions })}>
        {replaceCaptions ? 'Replace captions' : inSync ? 'Up to date' : 'Sync'}
      </button>
    </div>
  </dialog>
}
