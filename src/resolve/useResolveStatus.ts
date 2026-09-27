import { useEffect, useState } from 'react'
import type { ResolveStatus } from '../core/resolveIpc'

/** Subscribes to the DaVinci Resolve bridge connection status, live. */
export function useResolveStatus(): ResolveStatus {
  const [status, setStatus] = useState<ResolveStatus>({ state: 'disconnected' })
  useEffect(() => {
    void window.captionStudio?.resolveStatus().then(setStatus).catch(() => {})
    return window.captionStudio?.onResolveStatus(setStatus)
  }, [])
  return status
}
