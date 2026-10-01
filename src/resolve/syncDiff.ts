import type { ResolveLink } from '../core/model'

/**
 * Incremental Sync to Resolve (docs/plans/resolve-textplus/06-sync.md): pure diff between the Text+ clip specs
 * KathaCut wants on its track, what it last sent (`resolveLink.synced`) and what Resolve's track holds now
 * (`readClips`). No IPC here; main runs this against a fresh `readClips` for both the preview and the apply.
 */

export type SyncedEntry = ResolveLink['synced'][number]

/** The fields of a `TextPlusClipSpec` the diff needs; the rest travels along untouched. */
export type SyncSpecLike = { key: string; startFrame: number; endFrame: number; text: string; hash: string }

/** One item on the KathaCut track as `readClips` reports it. `key` is the `KathaCut.key` comp tag (null when the
 * clip wasn't made by KathaCut); `text` is null when the Text+ tool couldn't be read. */
export type RemoteClip = { clipId: string; startFrame: number; endFrame: number; key: string | null; text: string | null }

/**
 * `hash` of a synced entry the user chose to keep as Resolve's version. UPPELETE never updates or deletes that
 * clip again and never re-inserts its caption, while the entry stays in `synced`. (Dropping the entry instead, as
 * the brief first suggested, would make the still-tagged clip show up as a conflict again on every later sync.)
 */
export const RELEASED_HASH = 'uppelete:kept-resolve'
export const isReleasedHash = (hash: string | undefined): boolean => hash === RELEASED_HASH || hash === 'kathacut:kept-resolve'

export type SyncConflictKind =
  | 'changed-in-resolve' // edited (text or timing) in Resolve since the last sync
  | 'deleted-in-resolve' // gone from the track since the last sync
  | 'untracked-in-resolve' // tagged by KathaCut but missing from this project's sync record (e.g. after an undo) and different now

export type SyncConflict<S extends SyncSpecLike> = {
  key: string
  kind: SyncConflictKind
  clipId?: string
  /** The Resolve clip's current text, when it still exists. */
  resolveText?: string | null
  /** What KathaCut would send; null when the caption no longer exists in KathaCut (overwriting then deletes the clip). */
  keptText: string | null
  /** Where the clip is (or last was), for "Show in Resolve". */
  startFrame?: number
  spec?: S
  remote?: RemoteClip
}

export type SyncDiff<S extends SyncSpecLike> = {
  insert: S[]
  update: { clipId: string; spec: S }[]
  replace: { clipId: string; spec: S; previous: SyncedEntry }[]
  remove: { clipId: string; previous: SyncedEntry }[]
  conflicts: SyncConflict<S>[]
  /** Entries that stay as they are (unchanged or released), with the clip id Resolve reports now. */
  carried: SyncedEntry[]
  unchanged: number
  /** Untagged clips on the KathaCut track, or duplicates of a tag already matched. Never touched. */
  foreign: number
}

export type SyncDecision = 'keep-resolve' | 'overwrite'

const entryOf = (spec: SyncSpecLike, clipId: string, frames?: { startFrame: number; endFrame: number }): SyncedEntry => ({
  key: spec.key, clipId, hash: spec.hash, startFrame: frames?.startFrame ?? spec.startFrame, endFrame: frames?.endFrame ?? spec.endFrame, text: spec.text,
})

const releasedEntry = (key: string, remote: RemoteClip | undefined, fallback: SyncedEntry | undefined): SyncedEntry => ({
  key, clipId: remote?.clipId ?? fallback?.clipId ?? '', hash: RELEASED_HASH,
  startFrame: remote?.startFrame ?? fallback?.startFrame ?? 0, endFrame: remote?.endFrame ?? fallback?.endFrame ?? 0,
  text: (remote?.text ?? fallback?.text ?? '').slice(0, 4000),
})

export function diffSync<S extends SyncSpecLike>({ specs, synced, remote }: { specs: S[]; synced: SyncedEntry[]; remote: RemoteClip[] }): SyncDiff<S> {
  const result: SyncDiff<S> = { insert: [], update: [], replace: [], remove: [], conflicts: [], carried: [], unchanged: 0, foreign: 0 }
  const specByKey = new Map(specs.map((spec) => [spec.key, spec]))
  const remoteById = new Map(remote.map((clip) => [clip.clipId, clip]))
  const claimed = new Set<string>()
  const syncedKeys = new Set(synced.map((entry) => entry.key))

  /** Resolve can hand back a new unique id for a clip (e.g. after a project reload), so fall back to the comp tag. */
  const findRemote = (entry: SyncedEntry): RemoteClip | undefined => {
    const byId = entry.clipId ? remoteById.get(entry.clipId) : undefined
    if (byId && !claimed.has(byId.clipId)) return byId
    return remote.find((clip) => clip.key === entry.key && !claimed.has(clip.clipId))
  }

  for (const entry of synced) {
    const spec = specByKey.get(entry.key)
    const clip = findRemote(entry)
    if (clip) claimed.add(clip.clipId)

    if (isReleasedHash(entry.hash)) {
      // Kept as Resolve's version: never touched. Forget it only once both sides have let it go.
      if (clip || spec) { result.carried.push(clip ? { ...entry, clipId: clip.clipId } : entry); result.unchanged++ }
      continue
    }

    if (!clip) {
      if (spec) result.conflicts.push({ key: entry.key, kind: 'deleted-in-resolve', keptText: spec.text, startFrame: entry.startFrame, spec })
      // Deleted on both sides: nothing left to manage.
      continue
    }

    const changedInResolve = clip.startFrame !== entry.startFrame || clip.endFrame !== entry.endFrame || clip.text !== entry.text
    if (changedInResolve) {
      result.conflicts.push({ key: entry.key, kind: 'changed-in-resolve', clipId: clip.clipId, resolveText: clip.text, keptText: spec?.text ?? null, startFrame: clip.startFrame, spec, remote: clip })
      continue
    }
    if (!spec) { result.remove.push({ clipId: clip.clipId, previous: entry }); continue }
    const placedAsPlanned = spec.startFrame === entry.startFrame && spec.endFrame === entry.endFrame
    // A clip Resolve placed off its planned frames (recorded as placed) is replaced even when nothing changed locally.
    if (spec.hash === entry.hash && placedAsPlanned) { result.carried.push({ ...entry, clipId: clip.clipId }); result.unchanged++; continue }
    if (placedAsPlanned) result.update.push({ clipId: clip.clipId, spec })
    else result.replace.push({ clipId: clip.clipId, spec, previous: { ...entry, clipId: clip.clipId } })
  }

  for (const spec of specs) {
    if (syncedKeys.has(spec.key)) continue
    const clip = remote.find((candidate) => candidate.key === spec.key && !claimed.has(candidate.clipId))
    if (!clip) { result.insert.push(spec); continue }
    claimed.add(clip.clipId)
    // A clip KathaCut made whose record was lost (e.g. undo in KathaCut): adopt it when its text still matches.
    if (clip.text === spec.text) {
      const previous = entryOf(spec, clip.clipId, clip)
      if (clip.startFrame === spec.startFrame && clip.endFrame === spec.endFrame) result.update.push({ clipId: clip.clipId, spec })
      else result.replace.push({ clipId: clip.clipId, spec, previous })
    } else {
      result.conflicts.push({ key: spec.key, kind: 'untracked-in-resolve', clipId: clip.clipId, resolveText: clip.text, keptText: spec.text, startFrame: clip.startFrame, spec, remote: clip })
    }
  }

  for (const clip of remote) {
    if (claimed.has(clip.clipId)) continue
    if (clip.key !== null && !specByKey.has(clip.key) && !syncedKeys.has(clip.key)) {
      // Tagged by KathaCut, but its caption is gone and nothing records it.
      claimed.add(clip.clipId)
      result.conflicts.push({ key: clip.key, kind: 'untracked-in-resolve', clipId: clip.clipId, resolveText: clip.text, keptText: null, startFrame: clip.startFrame, remote: clip })
      continue
    }
    result.foreign++
  }
  return result
}

/** The work left after the user's conflict choices. `released` entries go straight into the new synced list. */
export type SyncPlan<S extends SyncSpecLike> = {
  insert: S[]
  update: { clipId: string; spec: S }[]
  replace: { clipId: string; spec: S; previous?: SyncedEntry }[]
  remove: { clipId: string; previous?: SyncedEntry }[]
  carried: SyncedEntry[]
}

/** Folds conflict decisions into the diff. A missing decision means **keep the Resolve version**. */
export function planSync<S extends SyncSpecLike>(diff: SyncDiff<S>, decisions: Record<string, SyncDecision>): SyncPlan<S> {
  const plan: SyncPlan<S> = { insert: [...diff.insert], update: [...diff.update], replace: [...diff.replace], remove: [...diff.remove], carried: [...diff.carried] }
  for (const conflict of diff.conflicts) {
    if (decisions[conflict.key] !== 'overwrite') { plan.carried.push(releasedEntry(conflict.key, conflict.remote, undefined)); continue }
    if (conflict.kind === 'deleted-in-resolve') { if (conflict.spec) plan.insert.push(conflict.spec); continue }
    if (!conflict.clipId) continue
    // Overwriting a clip edited in Resolve replaces it outright, so no Resolve-side input edits linger.
    if (conflict.spec) plan.replace.push({ clipId: conflict.clipId, spec: conflict.spec })
    else plan.remove.push({ clipId: conflict.clipId })
  }
  return plan
}

/**
 * "Replace all in Resolve": clear the KathaCut track and send every caption fresh. Every clip on the track is
 * removed, including ones KathaCut didn't make and ones kept as Resolve's version; nothing is carried or updated in
 * place. `previous` keeps a synced clip recorded if its delete never happens.
 */
export function replaceAllPlan<S extends SyncSpecLike>(specs: S[], synced: SyncedEntry[], remote: RemoteClip[]): SyncPlan<S> {
  const previousFor = (clip: RemoteClip) => synced.find((entry) => entry.clipId === clip.clipId) ?? (clip.key === null ? undefined : synced.find((entry) => entry.key === clip.key))
  return { insert: [...specs], update: [], replace: [], carried: [], remove: remote.map((clip) => ({ clipId: clip.clipId, previous: previousFor(clip) })) }
}

/** Changes a Sync would send, from local state only (no Resolve round trip): for the button's badge. */
export function countPendingChanges(specs: SyncSpecLike[], synced: SyncedEntry[]): number {
  const syncedByKey = new Map(synced.map((entry) => [entry.key, entry]))
  const specKeys = new Set(specs.map((spec) => spec.key))
  let count = 0
  for (const spec of specs) {
    const entry = syncedByKey.get(spec.key)
    if (!entry || (!isReleasedHash(entry.hash)
      && (entry.hash !== spec.hash || entry.startFrame !== spec.startFrame || entry.endFrame !== spec.endFrame))) count++
  }
  for (const entry of synced) if (!isReleasedHash(entry.hash) && !specKeys.has(entry.key)) count++
  return count
}
