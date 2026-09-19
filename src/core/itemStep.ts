import type { CaptionProject } from './model'
import type { CommandResult, ValidationIssue } from './captionCommands'
import type { Selection } from './timelineItems'

/** Shared by the item verb modules (`assetCommands.ts`, `trackCommands.ts`, `clipCommands.ts`) and
 * `itemCommands.ts`'s epilogue; kept separate so none of them imports another at load time. */
/** What an item verb hands back to the epilogue: the new project (or the same object for a no-op) and what to select. */
export type ItemStep = { project: CaptionProject; selection?: Selection | null }
export type ItemFailure = CommandResult & { ok: false }

export const issue = (kind: ValidationIssue['kind'], ids: string[], message: string): ValidationIssue => ({ kind, cueIds: ids, message })
export const failItem = (kind: ValidationIssue['kind'], ids: string[], message: string): ItemFailure =>
  ({ ok: false, errors: [issue(kind, ids, message)], warnings: [] })
export const isItemFailure = (value: ItemStep | ItemFailure): value is ItemFailure => 'ok' in value && value.ok === false

/** Deterministic ids for the pieces an edit creates, from one caller-minted prefix. */
export function serialIds(prefix: string): () => string {
  let serial = 0
  return () => `${prefix}-${++serial}`
}

export function replaceById<T extends { id: string }>(items: readonly T[], id: string, update: (item: T) => T): T[] | null {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return null
  return items.map((item, at) => at === index ? update(item) : item)
}

