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
  | { kind: 'review'; preview: ResolveSyncPreview; specs: ResolveSyncSpec[]; synced: ResolveLink['synced']; support: TextPlusPlan['support'] }
  | { kind: 'applying'; progress: ResolveSyncProgress | null }

const PHASE_LABEL: Record<ResolveSyncProgress['phase'], string> = {
  template: 'Checking the Text+ template', track: 'Preparing the track', delete: 'Removing clips', insert: 'Adding clips', update: 'Updating clips',
}
const CONFLICT_LABEL = {
  'changed-in-resolve': 'Changed in Resolve',
  'deleted-in-resolve': 'Deleted in Resolve',
  'untracked-in-resolve': 'Made by KathaCut, not in this project’s sync record',
} as const
const LEVEL_LABEL = { sent: 'Sent', approximated: 'Approximated', 'not-sent': 'Not sent' } as const

/** What the bridge needs from a planned clip. Keyframes and style ranges are brief 07's. */
const toSyncSpec = (spec: TextPlusPlan['specs'][number]): ResolveSyncSpec => ({
  key: spec.key, startFrame: spec.startFrame, endFrame: spec.endFrame, text: spec.text, inputs: spec.inputs, hash: spec.hash,
})

const errorText = (error: unknown) => error instanceof Error ? error.message : 'The sync to DaVinci Resolve failed.'

/**
 * Sync to Resolve (docs/plans/resolve-textplus/06-sync.md): the header button with a pending-change badge, the
 * review dialog (counts, conflicts, support list) and apply progress. Shown only for a linked project.
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

  const startPreview = async () => {
    if (!plan || disabledReason) return
    const specs = plan.specs.map(toSyncSpec)
    setPhase({ kind: 'previewing' })
    try {
      const preview = await window.captionStudio!.resolveSyncPreview({ timelineId: link.timelineId, trackName: link.trackName, specs, synced: link.synced })
      setPhase({ kind: 'review', preview, specs, synced: link.synced, support: plan.support })
    } catch (error) {
      setPhase({ kind: 'idle' })
      onMessage('error', errorText(error))
    }
  }

  const apply = async (review: Extract<Phase, { kind: 'review' }>, decisions: Record<string, SyncDecision>) => {
    setPhase({ kind: 'applying', progress: null })
    const unsubscribe = window.captionStudio!.onResolveSyncProgress((progress) => setPhase((current) => current.kind === 'applying' ? { kind: 'applying', progress } : current))
    try {
      const result = await window.captionStudio!.resolveSyncApply({ timelineId: link.timelineId, trackName: link.trackName, specs: review.specs, synced: review.synced, decisions })
      onSynced(result.synced)
      if (result.errors.length) onMessage('warning', `Synced to Resolve with problems: ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''}`)
      else onMessage('info', `Synced ${review.specs.length} caption${review.specs.length === 1 ? '' : 's'} to the “${link.trackName}” track in DaVinci Resolve.`)
    } catch (error) {
      onMessage('error', errorText(error))
    } finally {
      unsubscribe()
      setPhase({ kind: 'idle' })
    }
  }

  const badge = pending === null ? '…' : pending === 0 ? 'Synced' : `${pending} change${pending === 1 ? '' : 's'}`
  return <>
    <button type="button" className="resolve-sync-button" disabled={disabledReason !== null}
      title={disabledReason ?? `Send caption changes to the “${link.trackName}” track in DaVinci Resolve`} onClick={() => void startPreview()}>
      {phase.kind === 'previewing' ? 'Reading Resolve…' : 'Sync to Resolve'}
      <span className={`resolve-sync-badge${pending ? ' pending' : ''}`}>{badge}</span>
    </button>
    {phase.kind === 'review' && <ResolveSyncDialog review={phase} trackName={link.trackName}
      onJump={(frame) => void window.captionStudio?.resolveJumpTo(link.timelineId, frame).catch((error: unknown) => onMessage('error', errorText(error)))}
      onCancel={() => setPhase({ kind: 'idle' })} onSync={(decisions) => void apply(phase, decisions)} />}
    {phase.kind === 'applying' && <ResolveSyncProgressDialog progress={phase.progress} />}
  </>
}

function ResolveSyncDialog({ review, trackName, onJump, onCancel, onSync }: {
  review: Extract<Phase, { kind: 'review' }>
  trackName: string
  onJump(frame: number): void
  onCancel(): void
  onSync(decisions: Record<string, SyncDecision>): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [decisions, setDecisions] = useState<Record<string, SyncDecision>>({})
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  const { preview } = review
  const overwriting = preview.conflicts.filter((conflict) => decisions[conflict.key] === 'overwrite').length
  const nothingToDo = !preview.insert && !preview.update && !preview.replace && !preview.remove && !overwriting
  const levels = (['sent', 'approximated', 'not-sent'] as const).map((level) => ({ level, items: review.support.filter((item) => item.level === level) })).filter((group) => group.items.length)

  return <dialog ref={dialog} className="model-dialog resolve-sync-dialog" aria-labelledby="resolve-sync-title" onClose={onCancel} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="resolve-sync-title">Sync to Resolve</h2><button onClick={onCancel}>Close</button></div>
    <p>Track: <strong>{trackName}</strong>{preview.trackExists ? '' : ' (will be created at the top)'}</p>
    <ul className="resolve-sync-counts">
      <li><strong>{preview.insert}</strong> add</li>
      <li><strong>{preview.update + preview.replace}</strong> update</li>
      <li><strong>{preview.remove}</strong> remove</li>
      <li><strong>{preview.unchanged}</strong> unchanged</li>
    </ul>
    {preview.foreign > 0 && <p className="resolve-sync-note">{preview.foreign} clip{preview.foreign === 1 ? '' : 's'} on the {trackName} track weren’t made by KathaCut and won’t be touched.</p>}
    {preview.conflicts.length > 0 && <section className="resolve-sync-conflicts">
      <h3>Conflicts ({preview.conflicts.length})</h3>
      <p className="resolve-sync-note">These clips changed in Resolve since the last sync. Keeping the Resolve version stops KathaCut from managing that clip.</p>
      {preview.conflicts.map((conflict) => {
        const choice = decisions[conflict.key] ?? 'keep-resolve'
        const set = (value: SyncDecision) => setDecisions((current) => ({ ...current, [conflict.key]: value }))
        return <div key={conflict.key} className="resolve-sync-conflict">
          <div className="resolve-sync-conflict-head">
            <span>{CONFLICT_LABEL[conflict.kind]}</span>
            {conflict.startFrame !== undefined && conflict.kind !== 'deleted-in-resolve' && <button type="button" onClick={() => onJump(conflict.startFrame!)}>Show in Resolve</button>}
          </div>
          {conflict.resolveText != null && <div>Resolve: “{conflict.resolveText}”</div>}
          <div>KathaCut: {conflict.keptText === null ? <em>caption deleted</em> : `“${conflict.keptText}”`}</div>
          <label><input type="radio" name={`conflict-${conflict.key}`} checked={choice === 'keep-resolve'} onChange={() => set('keep-resolve')} /> Keep Resolve version</label>
          <label><input type="radio" name={`conflict-${conflict.key}`} checked={choice === 'overwrite'} onChange={() => set('overwrite')} /> Overwrite{conflict.keptText === null ? ' (delete the clip)' : ''}</label>
        </div>
      })}
    </section>}
    {levels.length > 0 && <section className="resolve-sync-support">
      <h3>What Resolve gets</h3>
      <p className="resolve-sync-note">Text+ is Resolve’s own renderer, so the result won’t match the KathaCut preview exactly.</p>
      {levels.map(({ level, items }) => <div key={level}>
        <h4>{LEVEL_LABEL[level]}</h4>
        <ul>{items.map((item) => <li key={item.feature}><strong>{item.feature}</strong>{item.note ? ` — ${item.note}` : ''}</li>)}</ul>
      </div>)}
    </section>}
    <div className="dialog-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="accent" disabled={nothingToDo} onClick={() => onSync(decisions)}>{nothingToDo ? 'Nothing to sync' : 'Sync'}</button>
    </div>
  </dialog>
}

function ResolveSyncProgressDialog({ progress }: { progress: ResolveSyncProgress | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  return <dialog ref={dialog} className="model-dialog resolve-sync-dialog" aria-labelledby="resolve-sync-progress-title" onCancel={(event) => event.preventDefault()}>
    <h2 id="resolve-sync-progress-title">Syncing to Resolve…</h2>
    <p>{progress ? `${PHASE_LABEL[progress.phase]} (${progress.done}/${progress.total})` : 'Reading the Resolve track…'}</p>
    <progress max={progress?.total || 1} value={progress?.done ?? 0} />
  </dialog>
}
