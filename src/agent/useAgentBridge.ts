import { useEffect, useRef } from 'react'
import type { AgentRequest, AgentResponse, CaptionSummary, CommandOutcome, ProjectSummary } from '../core/agentProtocol'
import { summarizeCue } from '../core/agentProtocol'
import type { EditCommand } from '../core/commands'
import type { Selection } from '../core/timelineItems'
import type { Cue } from '../core/model'

export type GetCaptionsArgs = {
  range?: { startUs: number; endUs: number }
  cueIds?: string[]
  words?: boolean
  limit?: number
  offset?: number
}

/**
 * What `App.tsx` gives the bridge to act on its behalf. Every mutating handler (`seek`, `select`,
 * `undo`, `redo`, `runCommands`) returns the resulting `ProjectSummary` itself, computed from the
 * values it just set — it never asks the bridge to re-read React state, which would still be the
 * pre-update value within the same synchronous tick (docs/MCP.md).
 */
export type AgentBridgeHandlers = {
  getState: () => ProjectSummary
  getCaptions: (args: GetCaptionsArgs) => { cues: Cue[]; total: number }
  runCommands: (commands: EditCommand[]) => { outcomes: CommandOutcome[]; failedIndex: number | null; state: ProjectSummary }
  seek: (sequenceUs: number) => ProjectSummary
  select: (selection: Selection | null) => ProjectSummary
  undo: () => ProjectSummary
  redo: () => ProjectSummary
}

function paginate<T>(items: T[], limit: number | undefined, offset: number | undefined): { page: T[]; total: number } {
  const start = offset ?? 0
  const end = limit === undefined ? items.length : start + limit
  return { page: items.slice(start, end), total: items.length }
}

/** Exported for `useAgentBridge.test.ts`: the actual request → handler → response mapping, with no
 * React or IPC involved. The `useEffect` below is thin, untested glue over this, consistent with
 * how the app's other `onX(callback)` subscriptions are verified (typecheck plus manual smoke). */
export async function dispatch(request: AgentRequest, handlers: AgentBridgeHandlers): Promise<AgentResponse> {
  switch (request.kind) {
    case 'get-state':
      return { id: request.id, ok: true, state: handlers.getState() }
    case 'get-captions': {
      const { cues, total } = handlers.getCaptions(request)
      const { page } = paginate(cues, request.limit, request.offset)
      const captions: CaptionSummary[] = page.map((cue) => summarizeCue(cue, request.words ?? false))
      return { id: request.id, ok: true, captions, total }
    }
    case 'run-commands': {
      const { outcomes, failedIndex, state } = handlers.runCommands(request.commands)
      return { id: request.id, ok: true, outcomes, failedIndex, state }
    }
    case 'seek':
      return { id: request.id, ok: true, state: handlers.seek(request.sequenceUs) }
    case 'select':
      return { id: request.id, ok: true, state: handlers.select(request.selection) }
    case 'undo':
      return { id: request.id, ok: true, state: handlers.undo() }
    case 'redo':
      return { id: request.id, ok: true, state: handlers.redo() }
    case 'prepare-snapshot':
      // Wired up in the slice that adds `render_frame` (docs/MCP.md); every other request kind is
      // implemented today, so an agent asking for this one now gets an honest "not yet" rather than
      // a silent no-op.
      return { id: request.id, ok: false, message: 'render_frame is not available yet.' }
  }
}

/**
 * Subscribes once to `window.captionStudio.onAgentRequest` and answers every request against the
 * latest `handlers` — a plain object App.tsx recreates each render (cheap closures over that
 * render's `project`/`selection`/`commandContext`), captured here in a ref so the listener, set up
 * once, always acts on the current render's state rather than the one from when it subscribed.
 */
export function useAgentBridge(handlers: AgentBridgeHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const api = window.captionStudio
    if (!api) return
    return api.onAgentRequest((request) => {
      void dispatch(request, handlersRef.current)
        .catch((error): AgentResponse => ({ id: request.id, ok: false, message: error instanceof Error ? error.message : 'The request failed.' }))
        .then((response) => api.respondAgentRequest(response))
    })
  }, [])
}
